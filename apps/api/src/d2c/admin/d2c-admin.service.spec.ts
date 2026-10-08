import { ForbiddenException } from '@nestjs/common';

import { EffectiveAccessResolver } from '../../identity/authorization/effective-access-resolver';
import { PrismaService } from '../../prisma/prisma.service';
import { OutletRepository } from '../../retail/outlet/outlet.repository';
import { TerritoryRepository } from '../../retail/territory/territory.repository';
import { SalesOrderService } from '../../sales/sales-order.service';
import { ConsumerService } from '../consumer/consumer.service';
import { CollectionPointFulfillmentRepository } from '../fulfillment/collection-point-fulfillment.repository';
import { ConsumerWhatsAppDeliveryRepository } from '../messaging/consumer-whatsapp-delivery.repository';
import { D2COperationalExceptionsService } from '../operations/d2c-operational-exceptions.service';
import { D2CAdminService } from './d2c-admin.service';

/**
 * Sprint 39 — D2C Sales Administration & Operations Dashboard (docs/domains/d2c.md).
 * Every underlying read is mocked at the SERVICE/repository boundary (never a real
 * Prisma call) — same convention as `field-d2c-overview.service.spec.ts`. The focus
 * here is the aggregation LOGIC this service owns, not the already-tested behaviour of
 * the services it composes.
 *
 * Sprint 43 — exception-detection logic (`UNASSIGNED_ORDER`/`STUCK_FULFILLMENT`/etc.)
 * was extracted to `D2COperationalExceptionsService`; its own dedicated tests now live
 * in `d2c-operational-exceptions.service.spec.ts`. This file now only tests that
 * `getAttention`/`getOverview` correctly delegate to it after the admin-only check.
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
    const collectionPointFulfillmentRepository = {
      findManyBySalesOrderIds: jest.fn().mockResolvedValue([]),
      findManyByOutlet: jest.fn().mockResolvedValue([]),
      findManyPaginated: jest.fn().mockResolvedValue(emptyPage),
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
        count: jest.fn().mockResolvedValue(0),
      },
      salesOrder: { groupBy: jest.fn().mockResolvedValue([]) },
    } as unknown as jest.Mocked<PrismaService>;
    const consumerWhatsAppDeliveryRepository = {
      countSinceByStatus: jest.fn().mockResolvedValue({ sent: 0, failed: 0 }),
      countEligibleForRetry: jest.fn().mockResolvedValue(0),
    } as unknown as jest.Mocked<ConsumerWhatsAppDeliveryRepository>;
    const exceptionsService = {
      compute: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<D2COperationalExceptionsService>;

    const service = new D2CAdminService(
      salesOrderService,
      consumerService,
      collectionPointFulfillmentRepository,
      outletRepository,
      territoryRepository,
      effectiveAccessResolver,
      prisma,
      consumerWhatsAppDeliveryRepository,
      exceptionsService,
    );
    return {
      service,
      salesOrderService,
      consumerService,
      collectionPointFulfillmentRepository,
      outletRepository,
      territoryRepository,
      effectiveAccessResolver,
      prisma,
      consumerWhatsAppDeliveryRepository,
      exceptionsService,
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
      const { service, salesOrderService, consumerService, outletRepository, exceptionsService } =
        makeService();
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
        if (params.dateFrom) {
          return Promise.resolve({ items: [], total: 4 } as never);
        }
        return Promise.resolve({ items: [], total: 42 } as never);
      });
      consumerService.listPaginated.mockResolvedValue({ items: [], total: 17 } as never);
      outletRepository.findManyByOrganisation.mockResolvedValue([{ id: 'outlet-1' }] as never);
      exceptionsService.compute.mockResolvedValue([
        { type: 'UNASSIGNED_ORDER', entityId: 'so-9' } as never,
      ]);

      const overview = await service.getOverview(orgId, 'admin-1');

      expect(overview.summary).toMatchObject({
        totalD2COrders: 42,
        ordersToday: 4,
        consumersTotal: 17,
        activeCollectionPoints: 1,
        pendingPayments: 3,
        failedPayments: 2,
        unassignedOrders: 1,
        exceptionsCount: 1,
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

    it('surfaces WhatsApp communication counts from ConsumerWhatsAppDeliveryRepository', async () => {
      const { service, consumerWhatsAppDeliveryRepository } = makeService();
      consumerWhatsAppDeliveryRepository.countSinceByStatus.mockResolvedValue({
        sent: 12,
        failed: 3,
      });
      consumerWhatsAppDeliveryRepository.countEligibleForRetry.mockResolvedValue(3);

      const overview = await service.getOverview(orgId, 'admin-1');

      expect(overview.summary.whatsappSentToday).toBe(12);
      expect(overview.summary.whatsappFailedToday).toBe(3);
      expect(overview.summary.whatsappEligibleForRetry).toBe(3);
    });
  });

  describe('getAttention', () => {
    it('delegates to D2COperationalExceptionsService.compute with no territory scope (org-wide)', async () => {
      const { service, exceptionsService } = makeService();
      exceptionsService.compute.mockResolvedValue([{ type: 'FAILED_PAYMENT' } as never]);

      const items = await service.getAttention(orgId, 'admin-1');

      expect(exceptionsService.compute).toHaveBeenCalledWith(orgId);
      expect(items).toEqual([{ type: 'FAILED_PAYMENT' }]);
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
