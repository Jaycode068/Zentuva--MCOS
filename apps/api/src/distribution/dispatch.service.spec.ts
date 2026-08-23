import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DispatchStatus } from '@prisma/client';

import { InventoryLocationRepository } from '../inventory/inventory-location.repository';
import { OutletRepository } from '../retail/outlet/outlet.repository';
import {
  SalesFulfilmentRepository,
  SalesFulfilmentWithOrder,
} from '../sales/sales-fulfilment.repository';
import {
  CreateDispatchResult,
  DispatchConflictError,
  DispatchRepository,
  DispatchWithRelations,
  OverDispatchError,
} from './dispatch.repository';
import { DispatchService } from './dispatch.service';

describe('DispatchService', () => {
  const fulfilment: SalesFulfilmentWithOrder = {
    id: 'fulfilment-1',
    organisationId: 'org-1',
    salesOrderId: 'order-1',
    locationId: 'location-1',
    fulfilmentDate: new Date('2026-08-20'),
    fulfilledById: 'user-1',
    notes: null,
    idempotencyKey: null,
    createdAt: new Date('2026-08-20'),
    location: { id: 'location-1', name: 'Main Warehouse' },
    salesOrder: { id: 'order-1', customerId: 'customer-1', outletId: 'outlet-1' },
    items: [
      {
        id: 'fulfilment-item-1',
        productId: 'product-1',
        salesOrderItemId: 'order-item-1',
        quantityFulfilled: 500,
        quantityDispatched: 0,
        product: { id: 'product-1', code: 'PRD-000027', name: 'Plantain Chips 500g', unit: 'Pack' },
      },
    ],
  } as unknown as SalesFulfilmentWithOrder;

  const dispatch: DispatchWithRelations = {
    id: 'dispatch-1',
    organisationId: 'org-1',
    dispatchCode: 'DSP-000001',
    salesFulfilmentId: 'fulfilment-1',
    salesOrderId: 'order-1',
    customerId: 'customer-1',
    outletId: 'outlet-1',
    sourceLocationId: 'location-1',
    dispatchDate: new Date('2026-08-22'),
    status: DispatchStatus.READY,
    notes: null,
    idempotencyKey: null,
    createdById: 'user-1',
    updatedById: 'user-1',
    createdAt: new Date('2026-08-22'),
    updatedAt: new Date('2026-08-22'),
    salesFulfilment: { id: 'fulfilment-1', fulfilmentDate: new Date('2026-08-20') },
    salesOrder: { id: 'order-1', orderCode: 'SO-000010' },
    customer: {
      id: 'customer-1',
      customerCode: 'CUS-000010',
      customerName: 'Mama Nkechi Stores',
      territoryId: 'territory-ibadan-north',
    },
    outlet: {
      id: 'outlet-1',
      outletCode: 'OUT-000008',
      name: 'Mama Nkechi Stores – Bodija',
      territoryId: 'territory-bodija',
    },
    sourceLocation: { id: 'location-1', name: 'Main Warehouse' },
    items: [
      {
        id: 'dispatch-item-1',
        productId: 'product-1',
        salesFulfilmentItemId: 'fulfilment-item-1',
        quantityDispatched: 500,
        quantityDelivered: 0,
        product: { id: 'product-1', code: 'PRD-000027', name: 'Plantain Chips 500g', unit: 'Pack' },
      },
    ],
  } as unknown as DispatchWithRelations;

  function makeService() {
    const dispatchRepository = {
      findById: jest.fn(),
      findManyByOrganisation: jest.fn(),
      existsByCode: jest.fn().mockResolvedValue(false),
      updateStatus: jest.fn(),
      create: jest.fn(),
    } as unknown as jest.Mocked<DispatchRepository>;
    const salesFulfilmentRepository = {
      findById: jest.fn(),
    } as unknown as jest.Mocked<SalesFulfilmentRepository>;
    const outletRepository = {
      findById: jest.fn(),
    } as unknown as jest.Mocked<OutletRepository>;
    const inventoryLocationRepository = {
      findById: jest.fn(),
    } as unknown as jest.Mocked<InventoryLocationRepository>;

    const service = new DispatchService(
      dispatchRepository,
      salesFulfilmentRepository,
      outletRepository,
      inventoryLocationRepository,
    );
    return {
      service,
      dispatchRepository,
      salesFulfilmentRepository,
      outletRepository,
      inventoryLocationRepository,
    };
  }

  describe('create', () => {
    it('resolves customerId from the fulfilment order and creates the dispatch', async () => {
      const {
        service,
        salesFulfilmentRepository,
        inventoryLocationRepository,
        dispatchRepository,
      } = makeService();
      salesFulfilmentRepository.findById.mockResolvedValue(fulfilment);
      inventoryLocationRepository.findById.mockResolvedValue({ id: 'location-1' } as never);
      const createResult: CreateDispatchResult = { dispatch, wasCreated: true };
      dispatchRepository.create.mockResolvedValue(createResult);

      const result = await service.create(
        'org-1',
        {
          salesFulfilmentId: 'fulfilment-1',
          sourceLocationId: 'location-1',
          dispatchDate: new Date('2026-08-22'),
          items: [{ salesFulfilmentItemId: 'fulfilment-item-1', quantity: 500 }],
        },
        'user-1',
      );

      expect(dispatchRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          organisationId: 'org-1',
          customerId: 'customer-1',
          outletId: 'outlet-1',
        }),
      );
      expect(result.dispatch.dispatchCode).toBe('DSP-000001');
    });

    it('allows dispatching a partial quantity within remaining', async () => {
      const {
        service,
        salesFulfilmentRepository,
        inventoryLocationRepository,
        dispatchRepository,
      } = makeService();
      salesFulfilmentRepository.findById.mockResolvedValue(fulfilment);
      inventoryLocationRepository.findById.mockResolvedValue({ id: 'location-1' } as never);
      dispatchRepository.create.mockResolvedValue({ dispatch, wasCreated: true });

      await service.create(
        'org-1',
        {
          salesFulfilmentId: 'fulfilment-1',
          sourceLocationId: 'location-1',
          dispatchDate: new Date('2026-08-22'),
          items: [{ salesFulfilmentItemId: 'fulfilment-item-1', quantity: 200 }],
        },
        'user-1',
      );

      expect(dispatchRepository.create).toHaveBeenCalled();
    });

    it('rejects an over-dispatch beyond the remaining fulfilled quantity', async () => {
      const {
        service,
        salesFulfilmentRepository,
        inventoryLocationRepository,
        dispatchRepository,
      } = makeService();
      salesFulfilmentRepository.findById.mockResolvedValue(fulfilment);
      inventoryLocationRepository.findById.mockResolvedValue({ id: 'location-1' } as never);

      await expect(
        service.create(
          'org-1',
          {
            salesFulfilmentId: 'fulfilment-1',
            sourceLocationId: 'location-1',
            dispatchDate: new Date('2026-08-22'),
            items: [{ salesFulfilmentItemId: 'fulfilment-item-1', quantity: 600 }],
          },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(dispatchRepository.create).not.toHaveBeenCalled();
    });

    it('translates a repository OverDispatchError into a BadRequestException', async () => {
      const {
        service,
        salesFulfilmentRepository,
        inventoryLocationRepository,
        dispatchRepository,
      } = makeService();
      salesFulfilmentRepository.findById.mockResolvedValue(fulfilment);
      inventoryLocationRepository.findById.mockResolvedValue({ id: 'location-1' } as never);
      dispatchRepository.create.mockRejectedValue(new OverDispatchError('race'));

      await expect(
        service.create(
          'org-1',
          {
            salesFulfilmentId: 'fulfilment-1',
            sourceLocationId: 'location-1',
            dispatchDate: new Date('2026-08-22'),
            items: [{ salesFulfilmentItemId: 'fulfilment-item-1', quantity: 500 }],
          },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('translates a repository DispatchConflictError into a BadRequestException', async () => {
      const {
        service,
        salesFulfilmentRepository,
        inventoryLocationRepository,
        dispatchRepository,
      } = makeService();
      salesFulfilmentRepository.findById.mockResolvedValue(fulfilment);
      inventoryLocationRepository.findById.mockResolvedValue({ id: 'location-1' } as never);
      dispatchRepository.create.mockRejectedValue(new DispatchConflictError('conflict'));

      await expect(
        service.create(
          'org-1',
          {
            salesFulfilmentId: 'fulfilment-1',
            sourceLocationId: 'location-1',
            dispatchDate: new Date('2026-08-22'),
            items: [{ salesFulfilmentItemId: 'fulfilment-item-1', quantity: 500 }],
          },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an unknown source location', async () => {
      const { service, salesFulfilmentRepository, inventoryLocationRepository } = makeService();
      salesFulfilmentRepository.findById.mockResolvedValue(fulfilment);
      inventoryLocationRepository.findById.mockResolvedValue(null);

      await expect(
        service.create(
          'org-1',
          {
            salesFulfilmentId: 'fulfilment-1',
            sourceLocationId: 'bad-location',
            dispatchDate: new Date('2026-08-22'),
            items: [{ salesFulfilmentItemId: 'fulfilment-item-1', quantity: 100 }],
          },
          'user-1',
        ),
      ).rejects.toThrow('Source location not found');
    });

    it('validates an overridden outlet belongs to the resolved customer', async () => {
      const { service, salesFulfilmentRepository, inventoryLocationRepository, outletRepository } =
        makeService();
      salesFulfilmentRepository.findById.mockResolvedValue(fulfilment);
      inventoryLocationRepository.findById.mockResolvedValue({ id: 'location-1' } as never);
      outletRepository.findById.mockResolvedValue({
        id: 'other-outlet',
        customerId: 'other-customer',
      } as never);

      await expect(
        service.create(
          'org-1',
          {
            salesFulfilmentId: 'fulfilment-1',
            outletId: 'other-outlet',
            sourceLocationId: 'location-1',
            dispatchDate: new Date('2026-08-22'),
            items: [{ salesFulfilmentItemId: 'fulfilment-item-1', quantity: 100 }],
          },
          'user-1',
        ),
      ).rejects.toThrow('The selected outlet does not belong to this customer');
    });

    it('throws NotFoundException for an unknown/cross-tenant sales fulfilment', async () => {
      const { service, salesFulfilmentRepository } = makeService();
      salesFulfilmentRepository.findById.mockResolvedValue(null);

      await expect(
        service.create(
          'org-1',
          {
            salesFulfilmentId: 'unknown',
            sourceLocationId: 'location-1',
            dispatchDate: new Date('2026-08-22'),
            items: [{ salesFulfilmentItemId: 'fulfilment-item-1', quantity: 100 }],
          },
          'user-1',
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('dispatch / markInTransit', () => {
    it('rejects dispatching a dispatch that has already left READY', async () => {
      const { service, dispatchRepository } = makeService();
      dispatchRepository.findById.mockResolvedValue({
        ...dispatch,
        status: DispatchStatus.DISPATCHED,
      });

      await expect(service.dispatch('org-1', 'dispatch-1', 'user-1')).rejects.toThrow(
        'This dispatch has already left the source location',
      );
    });

    it('rejects marking in transit a dispatch that is not yet DISPATCHED', async () => {
      const { service, dispatchRepository } = makeService();
      dispatchRepository.findById.mockResolvedValue({ ...dispatch, status: DispatchStatus.READY });

      await expect(service.markInTransit('org-1', 'dispatch-1', 'user-1')).rejects.toThrow(
        'Only a dispatched shipment can be marked in transit',
      );
    });

    it('rejects operating on a cancelled dispatch', async () => {
      const { service, dispatchRepository } = makeService();
      dispatchRepository.findById.mockResolvedValue({
        ...dispatch,
        status: DispatchStatus.CANCELLED,
      });

      await expect(service.dispatch('org-1', 'dispatch-1', 'user-1')).rejects.toThrow(
        'This dispatch has already been cancelled',
      );
    });
  });

  describe('cancel', () => {
    it.each([DispatchStatus.READY, DispatchStatus.DISPATCHED, DispatchStatus.IN_TRANSIT])(
      'cancels a dispatch from %s',
      async (status) => {
        const { service, dispatchRepository } = makeService();
        dispatchRepository.findById.mockResolvedValue({ ...dispatch, status });
        dispatchRepository.updateStatus.mockResolvedValue({
          ...dispatch,
          status: DispatchStatus.CANCELLED,
        });

        const result = await service.cancel('org-1', 'dispatch-1', 'user-1');
        expect(result.status).toBe(DispatchStatus.CANCELLED);
      },
    );

    it.each([DispatchStatus.PARTIALLY_DELIVERED, DispatchStatus.DELIVERED])(
      'blocks cancellation once delivery has started (%s)',
      async (status) => {
        const { service, dispatchRepository } = makeService();
        dispatchRepository.findById.mockResolvedValue({ ...dispatch, status });

        await expect(service.cancel('org-1', 'dispatch-1', 'user-1')).rejects.toThrow(
          'Cannot cancel a dispatch once delivery has started',
        );
      },
    );

    it('rejects cancelling an already-cancelled dispatch', async () => {
      const { service, dispatchRepository } = makeService();
      dispatchRepository.findById.mockResolvedValue({
        ...dispatch,
        status: DispatchStatus.CANCELLED,
      });

      await expect(service.cancel('org-1', 'dispatch-1', 'user-1')).rejects.toThrow(
        'This dispatch has already been cancelled',
      );
    });

    it('rejects cancelling an already-failed dispatch', async () => {
      const { service, dispatchRepository } = makeService();
      dispatchRepository.findById.mockResolvedValue({ ...dispatch, status: DispatchStatus.FAILED });

      await expect(service.cancel('org-1', 'dispatch-1', 'user-1')).rejects.toThrow(
        'This dispatch has already failed',
      );
    });
  });

  describe('fail', () => {
    it.each([DispatchStatus.DISPATCHED, DispatchStatus.IN_TRANSIT])(
      'fails a dispatch from %s and persists the required notes',
      async (status) => {
        const { service, dispatchRepository } = makeService();
        dispatchRepository.findById.mockResolvedValue({ ...dispatch, status });
        dispatchRepository.updateStatus.mockResolvedValue({
          ...dispatch,
          status: DispatchStatus.FAILED,
          notes: 'Truck broke down',
        });

        const result = await service.fail(
          'org-1',
          'dispatch-1',
          { notes: 'Truck broke down' },
          'user-1',
        );

        expect(dispatchRepository.updateStatus).toHaveBeenCalledWith(
          'org-1',
          'dispatch-1',
          [DispatchStatus.DISPATCHED, DispatchStatus.IN_TRANSIT],
          DispatchStatus.FAILED,
          'user-1',
          { notes: 'Truck broke down' },
        );
        expect(result.notes).toBe('Truck broke down');
      },
    );

    it('rejects failing a dispatch still in READY', async () => {
      const { service, dispatchRepository } = makeService();
      dispatchRepository.findById.mockResolvedValue({ ...dispatch, status: DispatchStatus.READY });

      await expect(
        service.fail('org-1', 'dispatch-1', { notes: 'reason' }, 'user-1'),
      ).rejects.toThrow('Only a dispatched or in-transit shipment can be marked failed');
    });
  });

  describe('tenant isolation', () => {
    it('getById throws NotFoundException for a cross-tenant dispatch', async () => {
      const { service, dispatchRepository } = makeService();
      dispatchRepository.findById.mockResolvedValue(null);

      await expect(service.getById('org-2', 'dispatch-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getDispatchAvailability', () => {
    it('computes fulfilled/dispatched/remaining per line', async () => {
      const { service, salesFulfilmentRepository } = makeService();
      salesFulfilmentRepository.findById.mockResolvedValue(fulfilment);

      const rows = await service.getDispatchAvailability('org-1', 'fulfilment-1');

      expect(rows).toEqual([
        expect.objectContaining({
          salesFulfilmentItemId: 'fulfilment-item-1',
          fulfilled: 500,
          dispatched: 0,
          remaining: 500,
        }),
      ]);
    });
  });
});
