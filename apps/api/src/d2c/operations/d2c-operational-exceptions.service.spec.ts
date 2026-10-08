import { ConfigService } from '@nestjs/config';
import { CollectionPointFulfillmentStatus } from '@prisma/client';

import { CollectionPointFulfillmentRepository } from '../fulfillment/collection-point-fulfillment.repository';
import { ConsumerWhatsAppDeliveryRepository } from '../messaging/consumer-whatsapp-delivery.repository';
import { OutletRepository } from '../../retail/outlet/outlet.repository';
import { SalesOrderService } from '../../sales/sales-order.service';
import { D2COperationalExceptionsService } from './d2c-operational-exceptions.service';

/**
 * Sprint 43 — extracted from `D2CAdminService.computeAttentionItems` (Sprint 39), with
 * its own dedicated test suite. The first four `describe` blocks are the EXACT Sprint 39
 * scenarios, re-homed here unchanged in intent; the rest are genuinely new Sprint 43
 * coverage (configurable thresholds, STUCK_READY_FOR_COLLECTION, NOTIFICATION_FAILED,
 * STALE_PENDING_PAYMENT, territory scoping).
 */
describe('D2COperationalExceptionsService', () => {
  const orgId = 'org-1';
  const emptyPage = { items: [], total: 0 };

  const CONFIG_DEFAULTS: Record<string, number> = {
    'd2cOperationalAlerts.assignedHours': 24,
    'd2cOperationalAlerts.preparingMinutes': 120,
    'd2cOperationalAlerts.readyForCollectionHours': 48,
    'd2cOperationalAlerts.paymentPendingHours': 2,
  };

  function makeService(configOverrides: Record<string, number> = {}) {
    const salesOrderService = {
      listPaginated: jest.fn().mockResolvedValue(emptyPage),
    } as unknown as jest.Mocked<SalesOrderService>;
    const collectionPointFulfillmentRepository = {
      findManyBySalesOrderIds: jest.fn().mockResolvedValue([]),
      findManyPaginated: jest.fn().mockResolvedValue(emptyPage),
    } as unknown as jest.Mocked<CollectionPointFulfillmentRepository>;
    const outletRepository = {
      findManyByOrganisation: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<OutletRepository>;
    const consumerWhatsAppDeliveryRepository = {
      findLatestBySalesOrderIds: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<ConsumerWhatsAppDeliveryRepository>;
    const config = {
      get: jest.fn((key: string) => configOverrides[key] ?? CONFIG_DEFAULTS[key]),
    } as unknown as jest.Mocked<ConfigService>;

    const service = new D2COperationalExceptionsService(
      salesOrderService,
      collectionPointFulfillmentRepository,
      outletRepository,
      consumerWhatsAppDeliveryRepository,
      config,
    );
    return {
      service,
      salesOrderService,
      collectionPointFulfillmentRepository,
      outletRepository,
      consumerWhatsAppDeliveryRepository,
      config,
    };
  }

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

    const items = await service.compute(orgId);

    expect(items).toContainEqual(
      expect.objectContaining({ type: 'UNASSIGNED_ORDER', entityId: 'so-1', severity: 'MEDIUM' }),
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

    const items = await service.compute(orgId);
    expect(items.filter((item) => item.type === 'UNASSIGNED_ORDER')).toHaveLength(0);
  });

  it('flags a D2C order with a FAILED payment as FAILED_PAYMENT, severity HIGH', async () => {
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

    const items = await service.compute(orgId);
    expect(items).toContainEqual(
      expect.objectContaining({ type: 'FAILED_PAYMENT', entityId: 'so-2', severity: 'HIGH' }),
    );
  });

  it('flags an ASSIGNED fulfilment older than the configured assignedHours as STUCK_FULFILLMENT, but not a fresh one', async () => {
    const { service, collectionPointFulfillmentRepository } = makeService();
    const stale = {
      id: 'cpf-1',
      salesOrderId: 'so-3',
      status: CollectionPointFulfillmentStatus.ASSIGNED,
      assignedAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
      preparingAt: null,
      readyAt: null,
      outletId: 'outlet-1',
      outlet: { name: 'Bodija Supermart' },
      salesOrder: { orderCode: 'SO-000003', consumer: null },
    };
    const fresh = { ...stale, id: 'cpf-2', salesOrderId: 'so-4', assignedAt: new Date() };
    collectionPointFulfillmentRepository.findManyPaginated.mockImplementation((_org, params) => {
      if (params.status === CollectionPointFulfillmentStatus.ASSIGNED) {
        return Promise.resolve({ items: [stale, fresh], total: 2 } as never);
      }
      return Promise.resolve(emptyPage as never);
    });

    const items = await service.compute(orgId);
    const stuck = items.filter((item) => item.type === 'STUCK_FULFILLMENT');
    expect(stuck).toHaveLength(1);
    expect(stuck[0]?.entityId).toBe('so-3');
  });

  it('flags a disabled outlet with a queued order as DISABLED_COLLECTION_POINT_WITH_QUEUE', async () => {
    const { service, collectionPointFulfillmentRepository, outletRepository } = makeService();
    outletRepository.findManyByOrganisation.mockImplementation((_org, params) => {
      if (params?.collectionPointStatus === 'DISABLED') {
        return Promise.resolve([{ id: 'outlet-9', name: 'Shuttered Shop' }] as never);
      }
      return Promise.resolve([] as never);
    });
    const queuedAtDisabled = {
      id: 'cpf-9',
      salesOrderId: 'so-9',
      status: CollectionPointFulfillmentStatus.ASSIGNED,
      assignedAt: new Date(),
      preparingAt: null,
      readyAt: null,
      outletId: 'outlet-9',
      outlet: { name: 'Shuttered Shop' },
      salesOrder: { orderCode: 'SO-000009', consumer: null },
    };
    collectionPointFulfillmentRepository.findManyPaginated.mockImplementation((_org, params) => {
      if (params.status === CollectionPointFulfillmentStatus.ASSIGNED) {
        return Promise.resolve({ items: [queuedAtDisabled], total: 1 } as never);
      }
      return Promise.resolve(emptyPage as never);
    });

    const items = await service.compute(orgId);
    expect(items).toContainEqual(
      expect.objectContaining({
        type: 'DISABLED_COLLECTION_POINT_WITH_QUEUE',
        entityId: 'outlet-9',
        message: expect.stringContaining('Shuttered Shop'),
      }),
    );
  });

  // --- Sprint 43: genuinely new checks ---

  it('flags a READY_FOR_COLLECTION fulfilment older than readyForCollectionHours as STUCK_READY_FOR_COLLECTION, severity HIGH', async () => {
    const { service, collectionPointFulfillmentRepository } = makeService();
    const stuckReady = {
      id: 'cpf-5',
      salesOrderId: 'so-5',
      status: CollectionPointFulfillmentStatus.READY_FOR_COLLECTION,
      assignedAt: new Date(Date.now() - 72 * 60 * 60 * 1000),
      preparingAt: new Date(Date.now() - 60 * 60 * 60 * 1000),
      readyAt: new Date(Date.now() - 49 * 60 * 60 * 1000),
      outletId: 'outlet-1',
      outlet: { name: 'Bodija Supermart' },
      salesOrder: { orderCode: 'SO-000005', consumer: { fullName: 'Ada Okafor', territory: null } },
    };
    collectionPointFulfillmentRepository.findManyPaginated.mockImplementation((_org, params) => {
      if (params.status === CollectionPointFulfillmentStatus.READY_FOR_COLLECTION) {
        return Promise.resolve({ items: [stuckReady], total: 1 } as never);
      }
      return Promise.resolve(emptyPage as never);
    });

    const items = await service.compute(orgId);
    expect(items).toContainEqual(
      expect.objectContaining({
        type: 'STUCK_READY_FOR_COLLECTION',
        entityId: 'so-5',
        severity: 'HIGH',
        consumerName: 'Ada Okafor',
      }),
    );
  });

  it('does not flag a READY_FOR_COLLECTION fulfilment within the threshold', async () => {
    const { service, collectionPointFulfillmentRepository } = makeService();
    const freshReady = {
      id: 'cpf-6',
      salesOrderId: 'so-6',
      status: CollectionPointFulfillmentStatus.READY_FOR_COLLECTION,
      assignedAt: new Date(),
      preparingAt: new Date(),
      readyAt: new Date(),
      outletId: 'outlet-1',
      outlet: { name: 'Bodija Supermart' },
      salesOrder: { orderCode: 'SO-000006', consumer: null },
    };
    collectionPointFulfillmentRepository.findManyPaginated.mockImplementation((_org, params) => {
      if (params.status === CollectionPointFulfillmentStatus.READY_FOR_COLLECTION) {
        return Promise.resolve({ items: [freshReady], total: 1 } as never);
      }
      return Promise.resolve(emptyPage as never);
    });

    const items = await service.compute(orgId);
    expect(items.filter((item) => item.type === 'STUCK_READY_FOR_COLLECTION')).toHaveLength(0);
  });

  it('flags a PENDING-payment D2C order older than paymentPendingHours as STALE_PENDING_PAYMENT', async () => {
    const { service, salesOrderService } = makeService();
    salesOrderService.listPaginated.mockImplementation((_org, params) => {
      if (params.paymentStatus === 'PENDING') {
        return Promise.resolve({
          items: [
            {
              id: 'so-7',
              orderCode: 'SO-000007',
              orderDate: new Date(Date.now() - 3 * 60 * 60 * 1000),
              consumer: null,
            },
          ],
          total: 1,
        } as never);
      }
      return Promise.resolve(emptyPage as never);
    });

    const items = await service.compute(orgId);
    expect(items).toContainEqual(
      expect.objectContaining({ type: 'STALE_PENDING_PAYMENT', entityId: 'so-7', severity: 'LOW' }),
    );
  });

  it('does not flag a PENDING-payment order still within paymentPendingHours', async () => {
    const { service, salesOrderService } = makeService();
    salesOrderService.listPaginated.mockImplementation((_org, params) => {
      if (params.paymentStatus === 'PENDING') {
        return Promise.resolve({
          items: [{ id: 'so-8', orderCode: 'SO-000008', orderDate: new Date(), consumer: null }],
          total: 1,
        } as never);
      }
      return Promise.resolve(emptyPage as never);
    });

    const items = await service.compute(orgId);
    expect(items.filter((item) => item.type === 'STALE_PENDING_PAYMENT')).toHaveLength(0);
  });

  it('flags a FAILED consumer WhatsApp delivery for an order still in the fulfilment queue as NOTIFICATION_FAILED', async () => {
    const { service, collectionPointFulfillmentRepository, consumerWhatsAppDeliveryRepository } =
      makeService();
    const row = {
      id: 'cpf-10',
      salesOrderId: 'so-10',
      status: CollectionPointFulfillmentStatus.READY_FOR_COLLECTION,
      assignedAt: new Date(),
      preparingAt: new Date(),
      readyAt: new Date(),
      outletId: 'outlet-1',
      outlet: { name: 'Bodija Supermart' },
      salesOrder: { orderCode: 'SO-000010', consumer: null },
    };
    collectionPointFulfillmentRepository.findManyPaginated.mockImplementation((_org, params) => {
      if (params.status === CollectionPointFulfillmentStatus.READY_FOR_COLLECTION) {
        return Promise.resolve({ items: [row], total: 1 } as never);
      }
      return Promise.resolve(emptyPage as never);
    });
    consumerWhatsAppDeliveryRepository.findLatestBySalesOrderIds.mockResolvedValue([
      {
        id: 'delivery-1',
        salesOrderId: 'so-10',
        status: 'FAILED',
        kind: 'COLLECTION_READY',
      } as never,
    ]);

    const items = await service.compute(orgId);
    expect(items).toContainEqual(
      expect.objectContaining({
        type: 'NOTIFICATION_FAILED',
        entityType: 'ConsumerWhatsAppDelivery',
        entityId: 'delivery-1',
        severity: 'HIGH',
      }),
    );
  });

  it('does not flag a SENT consumer WhatsApp delivery', async () => {
    const { service, collectionPointFulfillmentRepository, consumerWhatsAppDeliveryRepository } =
      makeService();
    const row = {
      id: 'cpf-11',
      salesOrderId: 'so-11',
      status: CollectionPointFulfillmentStatus.READY_FOR_COLLECTION,
      assignedAt: new Date(),
      preparingAt: new Date(),
      readyAt: new Date(),
      outletId: 'outlet-1',
      outlet: { name: 'Bodija Supermart' },
      salesOrder: { orderCode: 'SO-000011', consumer: null },
    };
    collectionPointFulfillmentRepository.findManyPaginated.mockImplementation((_org, params) => {
      if (params.status === CollectionPointFulfillmentStatus.READY_FOR_COLLECTION) {
        return Promise.resolve({ items: [row], total: 1 } as never);
      }
      return Promise.resolve(emptyPage as never);
    });
    consumerWhatsAppDeliveryRepository.findLatestBySalesOrderIds.mockResolvedValue([
      {
        id: 'delivery-2',
        salesOrderId: 'so-11',
        status: 'SENT',
        kind: 'COLLECTION_READY',
      } as never,
    ]);

    const items = await service.compute(orgId);
    expect(items.filter((item) => item.type === 'NOTIFICATION_FAILED')).toHaveLength(0);
  });

  it('respects a custom, shorter preparingMinutes threshold from configuration', async () => {
    const { service, collectionPointFulfillmentRepository } = makeService({
      'd2cOperationalAlerts.preparingMinutes': 5,
    });
    const row = {
      id: 'cpf-12',
      salesOrderId: 'so-12',
      status: CollectionPointFulfillmentStatus.PREPARING,
      assignedAt: new Date(Date.now() - 10 * 60 * 1000),
      preparingAt: new Date(Date.now() - 10 * 60 * 1000),
      readyAt: null,
      outletId: 'outlet-1',
      outlet: { name: 'Bodija Supermart' },
      salesOrder: { orderCode: 'SO-000012', consumer: null },
    };
    collectionPointFulfillmentRepository.findManyPaginated.mockImplementation((_org, params) => {
      if (params.status === CollectionPointFulfillmentStatus.PREPARING) {
        return Promise.resolve({ items: [row], total: 1 } as never);
      }
      return Promise.resolve(emptyPage as never);
    });

    const items = await service.compute(orgId);
    expect(items.filter((item) => item.type === 'STUCK_FULFILLMENT')).toHaveLength(1);
  });

  it('passes the scope territoryId through to every territory-filterable read', async () => {
    const { service, salesOrderService, collectionPointFulfillmentRepository, outletRepository } =
      makeService();

    await service.compute(orgId, { territoryId: 'territory-1' });

    expect(salesOrderService.listPaginated).toHaveBeenCalledWith(
      orgId,
      expect.objectContaining({ consumerTerritoryId: 'territory-1' }),
    );
    expect(collectionPointFulfillmentRepository.findManyPaginated).toHaveBeenCalledWith(
      orgId,
      expect.objectContaining({ territoryId: 'territory-1' }),
    );
    expect(outletRepository.findManyByOrganisation).toHaveBeenCalledWith(
      orgId,
      expect.objectContaining({ territoryId: 'territory-1' }),
    );
  });
});
