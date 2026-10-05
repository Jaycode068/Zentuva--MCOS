import { ForbiddenException } from '@nestjs/common';
import { CollectionPointFulfillmentStatus } from '@prisma/client';

import { EffectiveAccessResolver } from '../../identity/authorization/effective-access-resolver';
import { PrismaService } from '../../prisma/prisma.service';
import { OutletRepository } from '../../retail/outlet/outlet.repository';
import { TerritoryRepository } from '../../retail/territory/territory.repository';
import { SalesOrderService } from '../../sales/sales-order.service';
import { ConsumerService } from '../consumer/consumer.service';
import { CollectionPointFulfillmentRepository } from '../fulfillment/collection-point-fulfillment.repository';
import { CollectionPointFulfillmentService } from '../fulfillment/collection-point-fulfillment.service';
import { D2CAdminService } from './d2c-admin.service';

/**
 * Sprint 39 — D2C Sales Administration & Operations Dashboard (docs/domains/d2c.md).
 * Every underlying read is mocked at the SERVICE/repository boundary (never a real
 * Prisma call) — same convention as `field-d2c-overview.service.spec.ts`. The focus
 * here is the aggregation/attention-derivation LOGIC this service owns, not the
 * already-tested behaviour of the services it composes.
 */
describe('D2CAdminService', () => {
  const orgId = 'org-1';
  const emptyPage = { items: [], total: 0 };

  function makeService() {
    const salesOrderService = {
      listPaginated: jest.fn().mockResolvedValue(emptyPage),
    } as unknown as jest.Mocked<SalesOrderService>;
    const consumerService = {
      listPaginated: jest.fn().mockResolvedValue(emptyPage),
    } as unknown as jest.Mocked<ConsumerService>;
    const collectionPointFulfillmentService = {
      listAll: jest.fn().mockResolvedValue(emptyPage),
    } as unknown as jest.Mocked<CollectionPointFulfillmentService>;
    const collectionPointFulfillmentRepository = {
      findManyBySalesOrderIds: jest.fn().mockResolvedValue([]),
      findManyByOutlet: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<CollectionPointFulfillmentRepository>;
    const outletRepository = {
      findManyByOrganisation: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<OutletRepository>;
    const territoryRepository = {
      findManyByOrganisation: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<TerritoryRepository>;
    const effectiveAccessResolver = {
      resolve: jest.fn().mockResolvedValue({
        isOwnerBypass: false,
        grants: new Map([['sales.customer.manage', {}]]),
      }),
    } as unknown as jest.Mocked<EffectiveAccessResolver>;
    const prisma = {
      consumer: {
        groupBy: jest.fn().mockResolvedValue([]),
        findMany: jest.fn().mockResolvedValue([]),
      },
      salesOrder: { groupBy: jest.fn().mockResolvedValue([]) },
    } as unknown as jest.Mocked<PrismaService>;

    const service = new D2CAdminService(
      salesOrderService,
      consumerService,
      collectionPointFulfillmentService,
      collectionPointFulfillmentRepository,
      outletRepository,
      territoryRepository,
      effectiveAccessResolver,
      prisma,
    );
    return {
      service,
      salesOrderService,
      consumerService,
      collectionPointFulfillmentService,
      collectionPointFulfillmentRepository,
      outletRepository,
      territoryRepository,
      effectiveAccessResolver,
      prisma,
    };
  }

  describe('admin-only enforcement', () => {
    it('rejects every entry point for a non-admin caller', async () => {
      const { service, effectiveAccessResolver } = makeService();
      effectiveAccessResolver.resolve.mockResolvedValue({
        isOwnerBypass: false,
        grants: new Map(),
      } as never);

      await expect(service.getOverview(orgId, 'rep-1')).rejects.toThrow(ForbiddenException);
      await expect(service.getAttention(orgId, 'rep-1')).rejects.toThrow(ForbiddenException);
      await expect(service.getTerritorySummary(orgId, 'rep-1')).rejects.toThrow(ForbiddenException);
      await expect(
        service.listConsumers(orgId, 'rep-1', { page: 1, pageSize: 20 }),
      ).rejects.toThrow(ForbiddenException);
      await expect(service.listOrders(orgId, 'rep-1', { page: 1, pageSize: 20 })).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('an owner-bypass caller (no explicit grant) is treated as admin too', async () => {
      const { service, effectiveAccessResolver, salesOrderService } = makeService();
      effectiveAccessResolver.resolve.mockResolvedValue({
        isOwnerBypass: true,
        grants: new Map(),
      } as never);

      await service.getOverview(orgId, 'owner-1');
      expect(salesOrderService.listPaginated).toHaveBeenCalled();
    });
  });

  describe('getOverview', () => {
    it('assembles summary counts, recent orders, and attention from the composed reads', async () => {
      const { service, salesOrderService, consumerService, outletRepository } = makeService();
      salesOrderService.listPaginated.mockImplementation((_org, params) => {
        if (params.pageSize === 10) {
          return Promise.resolve({
            items: [
              {
                id: 'so-1',
                orderCode: 'SO-000001',
                consumer: { fullName: 'Ada Okafor' },
                status: 'CONFIRMED',
                total: 5000,
                orderDate: new Date('2026-09-01'),
              },
            ],
            total: 1,
          } as never);
        }
        if (params.paymentStatus === 'PENDING') {
          return Promise.resolve({ items: [], total: 3 } as never);
        }
        if (params.paymentStatus === 'FAILED') {
          return Promise.resolve({ items: [], total: 2 } as never);
        }
        if (params.status === 'CONFIRMED') {
          return Promise.resolve({ items: [], total: 0 } as never);
        }
        return Promise.resolve({ items: [], total: 42 } as never);
      });
      consumerService.listPaginated.mockResolvedValue({ items: [], total: 17 } as never);
      outletRepository.findManyByOrganisation.mockResolvedValue([{ id: 'outlet-1' }] as never);

      const overview = await service.getOverview(orgId, 'admin-1');

      expect(overview.summary).toEqual({
        totalD2COrders: 42,
        consumersTotal: 17,
        activeCollectionPoints: 1,
        pendingPayments: 3,
        failedPayments: 2,
        unassignedOrders: 0,
      });
      expect(overview.recentOrders).toEqual([
        {
          id: 'so-1',
          orderCode: 'SO-000001',
          consumerName: 'Ada Okafor',
          status: 'CONFIRMED',
          total: 5000,
          orderDate: new Date('2026-09-01'),
        },
      ]);
    });
  });

  describe('computeAttentionItems (via getAttention)', () => {
    it('flags a CONFIRMED D2C order with no CollectionPointFulfillment row as UNASSIGNED_ORDER', async () => {
      const { service, salesOrderService, collectionPointFulfillmentRepository } = makeService();
      salesOrderService.listPaginated.mockImplementation((_org, params) => {
        if (params.status === 'CONFIRMED') {
          return Promise.resolve({
            items: [{ id: 'so-1', orderCode: 'SO-000001' }],
            total: 1,
          } as never);
        }
        return Promise.resolve(emptyPage as never);
      });
      collectionPointFulfillmentRepository.findManyBySalesOrderIds.mockResolvedValue([]);

      const items = await service.getAttention(orgId, 'admin-1');

      expect(items).toContainEqual(
        expect.objectContaining({ type: 'UNASSIGNED_ORDER', entityId: 'so-1' }),
      );
    });

    it('does NOT flag a CONFIRMED D2C order that already has a CollectionPointFulfillment row', async () => {
      const { service, salesOrderService, collectionPointFulfillmentRepository } = makeService();
      salesOrderService.listPaginated.mockImplementation((_org, params) => {
        if (params.status === 'CONFIRMED') {
          return Promise.resolve({
            items: [{ id: 'so-1', orderCode: 'SO-000001' }],
            total: 1,
          } as never);
        }
        return Promise.resolve(emptyPage as never);
      });
      collectionPointFulfillmentRepository.findManyBySalesOrderIds.mockResolvedValue([
        { salesOrderId: 'so-1' } as never,
      ]);

      const items = await service.getAttention(orgId, 'admin-1');

      expect(items.filter((item) => item.type === 'UNASSIGNED_ORDER')).toHaveLength(0);
    });

    it('flags a D2C order with a FAILED payment as FAILED_PAYMENT', async () => {
      const { service, salesOrderService } = makeService();
      salesOrderService.listPaginated.mockImplementation((_org, params) => {
        if (params.paymentStatus === 'FAILED') {
          return Promise.resolve({
            items: [{ id: 'so-2', orderCode: 'SO-000002' }],
            total: 1,
          } as never);
        }
        return Promise.resolve(emptyPage as never);
      });

      const items = await service.getAttention(orgId, 'admin-1');

      expect(items).toContainEqual(
        expect.objectContaining({ type: 'FAILED_PAYMENT', entityId: 'so-2' }),
      );
    });

    it('flags an ASSIGNED fulfilment older than 24h as STUCK_FULFILLMENT, but not a fresh one', async () => {
      const { service, collectionPointFulfillmentService } = makeService();
      const stale = {
        id: 'cpf-1',
        salesOrderId: 'so-3',
        orderReference: 'SO-000003',
        status: CollectionPointFulfillmentStatus.ASSIGNED,
        assignedAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
        preparingAt: null,
        outletId: 'outlet-1',
        outletName: 'Bodija Supermart',
      };
      const fresh = {
        ...stale,
        id: 'cpf-2',
        orderReference: 'SO-000004',
        assignedAt: new Date(),
      };
      collectionPointFulfillmentService.listAll.mockImplementation((_org, _actor, params) => {
        if (params.status === CollectionPointFulfillmentStatus.ASSIGNED) {
          return Promise.resolve({ items: [stale, fresh], total: 2 } as never);
        }
        return Promise.resolve(emptyPage as never);
      });

      const items = await service.getAttention(orgId, 'admin-1');

      const stuck = items.filter((item) => item.type === 'STUCK_FULFILLMENT');
      expect(stuck).toHaveLength(1);
      expect(stuck[0]?.entityId).toBe('so-3');
    });

    it('flags a disabled outlet with a queued order as DISABLED_COLLECTION_POINT_WITH_QUEUE', async () => {
      const { service, collectionPointFulfillmentService, outletRepository } = makeService();
      outletRepository.findManyByOrganisation.mockImplementation((_org, params) => {
        if (params?.collectionPointStatus === 'DISABLED') {
          return Promise.resolve([{ id: 'outlet-9', name: 'Shuttered Shop' }] as never);
        }
        return Promise.resolve([] as never);
      });
      const queuedAtDisabled = {
        id: 'cpf-9',
        salesOrderId: 'so-9',
        orderReference: 'SO-000009',
        status: CollectionPointFulfillmentStatus.ASSIGNED,
        assignedAt: new Date(),
        preparingAt: null,
        outletId: 'outlet-9',
        outletName: 'Shuttered Shop',
      };
      collectionPointFulfillmentService.listAll.mockImplementation((_org, _actor, params) => {
        if (params.status === CollectionPointFulfillmentStatus.ASSIGNED) {
          return Promise.resolve({ items: [queuedAtDisabled], total: 1 } as never);
        }
        return Promise.resolve(emptyPage as never);
      });

      const items = await service.getAttention(orgId, 'admin-1');

      expect(items).toContainEqual(
        expect.objectContaining({
          type: 'DISABLED_COLLECTION_POINT_WITH_QUEUE',
          entityId: 'outlet-9',
          message: expect.stringContaining('Shuttered Shop'),
        }),
      );
    });
  });

  describe('getTerritorySummary', () => {
    it('rolls up consumer/order/collection-point counts per territory without N+1, and excludes a never-configured outlet from the collection-point count', async () => {
      const { service, territoryRepository, outletRepository, prisma } = makeService();
      territoryRepository.findManyByOrganisation.mockResolvedValue([
        { id: 'territory-1', name: 'Bodija' },
        { id: 'territory-2', name: 'Agodi' },
      ] as never);
      (prisma.consumer.groupBy as jest.Mock).mockResolvedValue([
        { territoryId: 'territory-1', _count: { _all: 5 } },
      ]);
      (prisma.consumer.findMany as jest.Mock).mockResolvedValue([
        { id: 'consumer-1', territoryId: 'territory-1' },
        { id: 'consumer-2', territoryId: 'territory-1' },
      ]);
      (prisma.salesOrder.groupBy as jest.Mock).mockResolvedValue([
        { consumerId: 'consumer-1', _count: { _all: 3 } },
        { consumerId: 'consumer-2', _count: { _all: 2 } },
      ]);
      outletRepository.findManyByOrganisation.mockResolvedValue([
        {
          id: 'outlet-1',
          territoryId: 'territory-1',
          collectionPointStatus: 'ENABLED',
          collectionPointResponsibleUserId: 'rep-1',
        },
        {
          id: 'outlet-2',
          territoryId: 'territory-1',
          // Never configured as a Collection Point — defaults to DISABLED with no
          // responsible user. Must NOT be counted (the bug this test guards against).
          collectionPointStatus: 'DISABLED',
          collectionPointResponsibleUserId: null,
        },
      ] as never);

      const result = await service.getTerritorySummary(orgId, 'admin-1');

      expect(result).toEqual([
        {
          territoryId: 'territory-1',
          territoryName: 'Bodija',
          consumerCount: 5,
          d2cOrderCount: 5, // 3 + 2, both consumers map to territory-1
          collectionPointCount: 1, // only outlet-1 — outlet-2 was never configured
          enabledCollectionPointCount: 1,
        },
        {
          territoryId: 'territory-2',
          territoryName: 'Agodi',
          consumerCount: 0,
          d2cOrderCount: 0,
          collectionPointCount: 0,
          enabledCollectionPointCount: 0,
        },
      ]);
    });
  });

  describe('listOrders', () => {
    it('resolves collectionPointOutletId to matching salesOrderIds before delegating, and forces source=D2C', async () => {
      const { service, collectionPointFulfillmentRepository, salesOrderService } = makeService();
      collectionPointFulfillmentRepository.findManyByOutlet.mockResolvedValue([
        { salesOrderId: 'so-1' },
        { salesOrderId: 'so-2' },
      ] as never);

      await service.listOrders(orgId, 'admin-1', {
        collectionPointOutletId: 'outlet-1',
        page: 1,
        pageSize: 20,
      });

      expect(salesOrderService.listPaginated).toHaveBeenCalledWith(
        orgId,
        expect.objectContaining({ ids: ['so-1', 'so-2'], source: 'D2C' }),
      );
    });

    it('short-circuits to an empty page when the Collection Point has no assignments, without querying SalesOrder', async () => {
      const { service, collectionPointFulfillmentRepository, salesOrderService } = makeService();
      collectionPointFulfillmentRepository.findManyByOutlet.mockResolvedValue([]);

      const result = await service.listOrders(orgId, 'admin-1', {
        collectionPointOutletId: 'outlet-1',
        page: 1,
        pageSize: 20,
      });

      expect(result).toEqual({ items: [], total: 0 });
      expect(salesOrderService.listPaginated).not.toHaveBeenCalled();
    });
  });
});
