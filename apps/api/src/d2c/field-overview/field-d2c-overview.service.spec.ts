import { CollectionPointFulfillmentRepository } from '../fulfillment/collection-point-fulfillment.repository';
import { EmployeeService } from '../../hr/employee.service';
import { EffectiveAccessResolver } from '../../identity/authorization/effective-access-resolver';
import { OutletRepository } from '../../retail/outlet/outlet.repository';
import { SalesOrderRepository } from '../../sales/sales-order.repository';
import { FieldD2COverviewService } from './field-d2c-overview.service';

const ORG = 'org-1';

function makeService() {
  const salesOrderRepository = {
    findManyByOrganisation: jest.fn(),
  } as unknown as jest.Mocked<SalesOrderRepository>;
  const collectionPointFulfillmentRepository = {
    findManyBySalesOrderIds: jest.fn().mockResolvedValue([]),
    findManyByOutlet: jest.fn().mockResolvedValue([]),
  } as unknown as jest.Mocked<CollectionPointFulfillmentRepository>;
  const outletRepository = {
    findManyByOrganisation: jest.fn().mockResolvedValue([]),
  } as unknown as jest.Mocked<OutletRepository>;
  const employeeService = {
    getByUserId: jest.fn(),
  } as unknown as jest.Mocked<EmployeeService>;
  const effectiveAccessResolver = {
    resolve: jest.fn(),
  } as unknown as jest.Mocked<EffectiveAccessResolver>;

  const service = new FieldD2COverviewService(
    salesOrderRepository,
    collectionPointFulfillmentRepository,
    outletRepository,
    employeeService,
    effectiveAccessResolver,
  );
  return {
    service,
    salesOrderRepository,
    collectionPointFulfillmentRepository,
    outletRepository,
    employeeService,
    effectiveAccessResolver,
  };
}

describe('FieldD2COverviewService — territory scoping (Sprint 38)', () => {
  describe('listOrders', () => {
    it('an admin (isOwnerBypass) sees every territory — no consumerTerritoryId filter applied', async () => {
      const { service, salesOrderRepository, effectiveAccessResolver } = makeService();
      effectiveAccessResolver.resolve.mockResolvedValue({
        isOwnerBypass: true,
        grants: new Map(),
      } as never);
      salesOrderRepository.findManyByOrganisation.mockResolvedValue([]);

      await service.listOrders(ORG, 'admin-1');

      expect(salesOrderRepository.findManyByOrganisation).toHaveBeenCalledWith(ORG, {
        source: 'D2C',
      });
    });

    it('an admin via sales.customer.manage grant also sees every territory', async () => {
      const { service, salesOrderRepository, effectiveAccessResolver } = makeService();
      effectiveAccessResolver.resolve.mockResolvedValue({
        isOwnerBypass: false,
        grants: new Map([['sales.customer.manage', {}]]),
      } as never);
      salesOrderRepository.findManyByOrganisation.mockResolvedValue([]);

      await service.listOrders(ORG, 'admin-2');

      expect(salesOrderRepository.findManyByOrganisation).toHaveBeenCalledWith(ORG, {
        source: 'D2C',
      });
    });

    it('a field rep with an assigned territory sees only that territory, filter passed server-side', async () => {
      const { service, salesOrderRepository, employeeService, effectiveAccessResolver } =
        makeService();
      effectiveAccessResolver.resolve.mockResolvedValue({
        isOwnerBypass: false,
        grants: new Map(),
      } as never);
      employeeService.getByUserId.mockResolvedValue({
        id: 'emp-1',
        territoryId: 'territory-1',
      } as never);
      salesOrderRepository.findManyByOrganisation.mockResolvedValue([]);

      await service.listOrders(ORG, 'rep-1');

      expect(salesOrderRepository.findManyByOrganisation).toHaveBeenCalledWith(ORG, {
        source: 'D2C',
        consumerTerritoryId: 'territory-1',
      });
    });

    it('a field rep with NO assigned territory sees nothing — deny-by-default, never unrestricted', async () => {
      const { service, salesOrderRepository, employeeService, effectiveAccessResolver } =
        makeService();
      effectiveAccessResolver.resolve.mockResolvedValue({
        isOwnerBypass: false,
        grants: new Map(),
      } as never);
      employeeService.getByUserId.mockResolvedValue({ id: 'emp-1', territoryId: null } as never);

      const result = await service.listOrders(ORG, 'rep-1');

      expect(result).toEqual([]);
      expect(salesOrderRepository.findManyByOrganisation).not.toHaveBeenCalled();
    });

    it('a user with no linked Employee record at all sees nothing', async () => {
      const { service, salesOrderRepository, employeeService, effectiveAccessResolver } =
        makeService();
      effectiveAccessResolver.resolve.mockResolvedValue({
        isOwnerBypass: false,
        grants: new Map(),
      } as never);
      employeeService.getByUserId.mockResolvedValue(null);

      const result = await service.listOrders(ORG, 'stranger');

      expect(result).toEqual([]);
      expect(salesOrderRepository.findManyByOrganisation).not.toHaveBeenCalled();
    });

    it('merges each order with its CollectionPointFulfillment status when one exists', async () => {
      const {
        service,
        salesOrderRepository,
        collectionPointFulfillmentRepository,
        effectiveAccessResolver,
      } = makeService();
      effectiveAccessResolver.resolve.mockResolvedValue({
        isOwnerBypass: true,
        grants: new Map(),
      } as never);
      salesOrderRepository.findManyByOrganisation.mockResolvedValue([
        {
          id: 'so-1',
          orderCode: 'SO-000001',
          orderDate: new Date('2026-01-01'),
          total: 3000,
          status: 'CONFIRMED',
          consumer: { fullName: 'Ada Okafor', territory: { name: 'Bodija' } },
        },
      ] as never);
      collectionPointFulfillmentRepository.findManyBySalesOrderIds.mockResolvedValue([
        {
          salesOrderId: 'so-1',
          outletId: 'outlet-1',
          outlet: { name: 'Bodija Supermart' },
          status: 'PREPARING',
          assignedAt: new Date('2026-01-01'),
        },
      ] as never);

      const result = await service.listOrders(ORG, 'admin-1');

      expect(result).toEqual([
        expect.objectContaining({
          id: 'so-1',
          consumer: { name: 'Ada Okafor', territoryName: 'Bodija' },
          collectionPoint: expect.objectContaining({
            outletId: 'outlet-1',
            outletName: 'Bodija Supermart',
            fulfillmentStatus: 'PREPARING',
          }),
        }),
      ]);
    });

    it('reports collectionPoint as null for an order not yet assigned', async () => {
      const { service, salesOrderRepository, effectiveAccessResolver } = makeService();
      effectiveAccessResolver.resolve.mockResolvedValue({
        isOwnerBypass: true,
        grants: new Map(),
      } as never);
      salesOrderRepository.findManyByOrganisation.mockResolvedValue([
        {
          id: 'so-2',
          orderCode: 'SO-000002',
          orderDate: new Date('2026-01-01'),
          total: 1500,
          status: 'CONFIRMED',
          consumer: { fullName: 'Bola', territory: null },
        },
      ] as never);

      const result = await service.listOrders(ORG, 'admin-1');

      expect(result[0]!.collectionPoint).toBeNull();
    });
  });

  describe('listCollectionPoints', () => {
    it('scopes the outlet query by the field rep own territory, never trusting a client-supplied territoryId', async () => {
      const { service, outletRepository, employeeService, effectiveAccessResolver } = makeService();
      effectiveAccessResolver.resolve.mockResolvedValue({
        isOwnerBypass: false,
        grants: new Map(),
      } as never);
      employeeService.getByUserId.mockResolvedValue({
        id: 'emp-1',
        territoryId: 'territory-1',
      } as never);
      outletRepository.findManyByOrganisation.mockResolvedValue([]);

      await service.listCollectionPoints(ORG, 'rep-1');

      expect(outletRepository.findManyByOrganisation).toHaveBeenCalledWith(ORG, {
        collectionPointStatus: 'ENABLED',
        territoryId: 'territory-1',
      });
    });

    it('an admin sees every enabled Collection Point tenant-wide', async () => {
      const { service, outletRepository, effectiveAccessResolver } = makeService();
      effectiveAccessResolver.resolve.mockResolvedValue({
        isOwnerBypass: true,
        grants: new Map(),
      } as never);
      outletRepository.findManyByOrganisation.mockResolvedValue([]);

      await service.listCollectionPoints(ORG, 'admin-1');

      expect(outletRepository.findManyByOrganisation).toHaveBeenCalledWith(ORG, {
        collectionPointStatus: 'ENABLED',
      });
    });

    it('a field rep with no territory sees no Collection Points', async () => {
      const { service, outletRepository, employeeService, effectiveAccessResolver } = makeService();
      effectiveAccessResolver.resolve.mockResolvedValue({
        isOwnerBypass: false,
        grants: new Map(),
      } as never);
      employeeService.getByUserId.mockResolvedValue({ id: 'emp-1', territoryId: null } as never);

      const result = await service.listCollectionPoints(ORG, 'rep-1');

      expect(result).toEqual([]);
      expect(outletRepository.findManyByOrganisation).not.toHaveBeenCalled();
    });

    it('computes ordersAwaitingFulfilment (ASSIGNED+PREPARING) and ordersReadyForCollection counts separately', async () => {
      const {
        service,
        outletRepository,
        collectionPointFulfillmentRepository,
        effectiveAccessResolver,
      } = makeService();
      effectiveAccessResolver.resolve.mockResolvedValue({
        isOwnerBypass: true,
        grants: new Map(),
      } as never);
      outletRepository.findManyByOrganisation.mockResolvedValue([
        {
          id: 'outlet-1',
          name: 'Bodija Supermart',
          territory: { name: 'Bodija' },
          collectionPointStatus: 'ENABLED',
          collectionPointResponsibleUserId: 'rep-1',
          collectionPointOperatingHours: 'Mon-Sat 9am-6pm',
        },
      ] as never);
      collectionPointFulfillmentRepository.findManyByOutlet.mockResolvedValue([
        { status: 'ASSIGNED' },
        { status: 'PREPARING' },
        { status: 'READY_FOR_COLLECTION' },
        { status: 'READY_FOR_COLLECTION' },
      ] as never);

      const result = await service.listCollectionPoints(ORG, 'admin-1');

      expect(result).toEqual([
        expect.objectContaining({
          outletId: 'outlet-1',
          ordersAwaitingFulfilment: 2,
          ordersReadyForCollection: 2,
        }),
      ]);
    });
  });
});
