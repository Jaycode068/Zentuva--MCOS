import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CollectionPointFulfillmentStatus,
  SalesOrderSource,
  SalesOrderStatus,
} from '@prisma/client';

import { ConsumerWhatsAppDeliveryRepository } from '../messaging/consumer-whatsapp-delivery.repository';
import {
  CollectionPointFulfillmentRepository,
  CollectionPointFulfillmentWithRelations,
} from '../fulfillment/collection-point-fulfillment.repository';
import { OutletRepository } from '../../retail/outlet/outlet.repository';
import { SalesOrderService } from '../../sales/sales-order.service';
import { D2CExceptionItem, D2CExceptionScope } from './d2c-operational-exceptions.types';

/** Bounded read for the exception computation — an operational dashboard, not a
 *  report; genuinely exceeding this many simultaneously-open orders/fulfilments for one
 *  scope would itself be a signal worth a separate, paginated investigation, not
 *  something this summary needs to enumerate exhaustively. Unchanged from Sprint 39's
 *  own `ATTENTION_SCAN_PAGE_SIZE`. */
const EXCEPTION_SCAN_PAGE_SIZE = 200;

/**
 * Sprint 43 — D2C Operations, Notifications & Production Hardening
 * (docs/domains/d2c.md "Operational Exceptions"). Extracted from
 * `D2CAdminService.computeAttentionItems` (Sprint 39) — the exact same detection rules,
 * now parameterized by an optional territory scope so `FieldD2COverviewService` can
 * reuse it for a field rep's own territory-scoped exceptions, rather than maintaining a
 * second, independently-drifting copy. Performs NO authorization itself — see
 * `D2CExceptionScope`'s own doc comment; every caller must have already authorized the
 * actor for whatever scope it passes in.
 *
 * Every threshold below is configuration (`d2cOperationalAlerts.*`,
 * `D2C_OPERATIONAL_ALERT_*` env vars), never a scattered hardcoded constant — brief
 * §Phase 7. Two NEW checks beyond Sprint 39's original four: `STUCK_READY_FOR_COLLECTION`
 * (an order a consumer was told is ready, but nobody collected) and
 * `NOTIFICATION_FAILED` (the Sprint 43 `ConsumerWhatsAppDelivery` record for an order's
 * most recent consumer notification is `FAILED`) — both genuinely new operational
 * blind spots this sprint's audit found, not invented business rules.
 */
@Injectable()
export class D2COperationalExceptionsService {
  constructor(
    private readonly salesOrderService: SalesOrderService,
    private readonly collectionPointFulfillmentRepository: CollectionPointFulfillmentRepository,
    private readonly outletRepository: OutletRepository,
    private readonly consumerWhatsAppDeliveryRepository: ConsumerWhatsAppDeliveryRepository,
    private readonly config: ConfigService,
  ) {}

  async compute(
    organisationId: string,
    scope: D2CExceptionScope = {},
  ): Promise<D2CExceptionItem[]> {
    const items: D2CExceptionItem[] = [];
    const now = new Date();

    const assignedHours = this.config.get<number>('d2cOperationalAlerts.assignedHours') ?? 24;
    const preparingMinutes =
      this.config.get<number>('d2cOperationalAlerts.preparingMinutes') ?? 120;
    const readyForCollectionHours =
      this.config.get<number>('d2cOperationalAlerts.readyForCollectionHours') ?? 48;
    const paymentPendingHours =
      this.config.get<number>('d2cOperationalAlerts.paymentPendingHours') ?? 2;

    // Unassigned: CONFIRMED D2C orders with no CollectionPointFulfillment row yet.
    const confirmed = await this.salesOrderService.listPaginated(organisationId, {
      source: SalesOrderSource.D2C,
      status: SalesOrderStatus.CONFIRMED,
      consumerTerritoryId: scope.territoryId,
      page: 1,
      pageSize: EXCEPTION_SCAN_PAGE_SIZE,
    });
    if (confirmed.items.length > 0) {
      const assigned = await this.collectionPointFulfillmentRepository.findManyBySalesOrderIds(
        organisationId,
        confirmed.items.map((order) => order.id),
      );
      const assignedOrderIds = new Set(assigned.map((cpf) => cpf.salesOrderId));
      for (const order of confirmed.items) {
        if (!assignedOrderIds.has(order.id)) {
          items.push({
            category: 'ACTION_REQUIRED',
            type: 'UNASSIGNED_ORDER',
            severity: 'MEDIUM',
            message: `Order ${order.orderCode} is confirmed but not yet assigned to a Collection Point`,
            entityType: 'SalesOrder',
            entityId: order.id,
            detectedAt: now,
            orderCode: order.orderCode,
            consumerName: order.consumer?.fullName ?? null,
            territoryName: order.consumer?.territory?.name ?? null,
            collectionPointName: null,
          });
        }
      }
    }

    // Failed-payment D2C orders — always worth a human look.
    const failedPayment = await this.salesOrderService.listPaginated(organisationId, {
      source: SalesOrderSource.D2C,
      paymentStatus: 'FAILED',
      consumerTerritoryId: scope.territoryId,
      page: 1,
      pageSize: EXCEPTION_SCAN_PAGE_SIZE,
    });
    for (const order of failedPayment.items) {
      items.push({
        category: 'ACTION_REQUIRED',
        type: 'FAILED_PAYMENT',
        severity: 'HIGH',
        message: `Order ${order.orderCode}'s payment failed`,
        entityType: 'SalesOrder',
        entityId: order.id,
        detectedAt: now,
        orderCode: order.orderCode,
        consumerName: order.consumer?.fullName ?? null,
        territoryName: order.consumer?.territory?.name ?? null,
        collectionPointName: null,
      });
    }

    // Stale PENDING-payment D2C orders (brief §Phase 7 "Payment initiated but not
    // completed"). `orderDate` is used as the "payment initiated" proxy — a D2C order's
    // payment is always initiated synchronously right after confirmation (Sprint 35),
    // so there is no separate Payment-row date to read without a second query this
    // dashboard doesn't otherwise need.
    const pendingPayment = await this.salesOrderService.listPaginated(organisationId, {
      source: SalesOrderSource.D2C,
      paymentStatus: 'PENDING',
      consumerTerritoryId: scope.territoryId,
      page: 1,
      pageSize: EXCEPTION_SCAN_PAGE_SIZE,
    });
    const paymentPendingCutoff = new Date(now.getTime() - paymentPendingHours * 60 * 60 * 1000);
    for (const order of pendingPayment.items) {
      if (order.orderDate < paymentPendingCutoff) {
        items.push({
          category: 'ACTION_REQUIRED',
          type: 'STALE_PENDING_PAYMENT',
          severity: 'LOW',
          message: `Order ${order.orderCode}'s payment has been pending for over ${paymentPendingHours}h`,
          entityType: 'SalesOrder',
          entityId: order.id,
          detectedAt: now,
          orderCode: order.orderCode,
          consumerName: order.consumer?.fullName ?? null,
          territoryName: order.consumer?.territory?.name ?? null,
          collectionPointName: null,
        });
      }
    }

    // Stuck fulfilments (ASSIGNED/PREPARING past their own threshold),
    // STUCK_READY_FOR_COLLECTION (past a longer threshold — a consumer was already told
    // their order is ready), and disabled Collection Points with a queue — all derived
    // from the same bounded, scope-filtered fulfilment read.
    const disabledOutlets = await this.outletRepository.findManyByOrganisation(organisationId, {
      collectionPointStatus: 'DISABLED',
      ...(scope.territoryId ? { territoryId: scope.territoryId } : {}),
    });
    const disabledOutletIds = new Set(disabledOutlets.map((outlet) => outlet.id));
    const assignedCutoff = new Date(now.getTime() - assignedHours * 60 * 60 * 1000);
    const preparingCutoff = new Date(now.getTime() - preparingMinutes * 60 * 1000);
    const readyCutoff = new Date(now.getTime() - readyForCollectionHours * 60 * 60 * 1000);

    const [assignedQueue, preparingQueue, readyQueue] = await Promise.all([
      this.collectionPointFulfillmentRepository.findManyPaginated(organisationId, {
        status: CollectionPointFulfillmentStatus.ASSIGNED,
        territoryId: scope.territoryId,
        page: 1,
        pageSize: EXCEPTION_SCAN_PAGE_SIZE,
      }),
      this.collectionPointFulfillmentRepository.findManyPaginated(organisationId, {
        status: CollectionPointFulfillmentStatus.PREPARING,
        territoryId: scope.territoryId,
        page: 1,
        pageSize: EXCEPTION_SCAN_PAGE_SIZE,
      }),
      this.collectionPointFulfillmentRepository.findManyPaginated(organisationId, {
        status: CollectionPointFulfillmentStatus.READY_FOR_COLLECTION,
        territoryId: scope.territoryId,
        page: 1,
        pageSize: EXCEPTION_SCAN_PAGE_SIZE,
      }),
    ]);

    const queueAtDisabledOutlet = new Map<string, number>();
    for (const row of [...assignedQueue.items, ...preparingQueue.items, ...readyQueue.items]) {
      if (disabledOutletIds.has(row.outletId)) {
        queueAtDisabledOutlet.set(row.outletId, (queueAtDisabledOutlet.get(row.outletId) ?? 0) + 1);
      }
    }

    for (const row of assignedQueue.items) {
      if (row.assignedAt < assignedCutoff) {
        items.push(this.stuckFulfilmentItem(row, assignedHours, 'h'));
      }
    }
    for (const row of preparingQueue.items) {
      const startedAt = row.preparingAt ?? row.assignedAt;
      if (startedAt < preparingCutoff) {
        items.push(this.stuckFulfilmentItem(row, preparingMinutes, 'm'));
      }
    }
    for (const row of readyQueue.items) {
      const readySince = row.readyAt ?? row.assignedAt;
      if (readySince < readyCutoff) {
        items.push({
          category: 'ACTION_REQUIRED',
          type: 'STUCK_READY_FOR_COLLECTION',
          severity: 'HIGH',
          message: `Order ${row.salesOrder.orderCode} has been Ready for Collection for over ${readyForCollectionHours}h at ${row.outlet.name} — the consumer has not collected it`,
          entityType: 'CollectionPointFulfillment',
          entityId: row.salesOrderId,
          detectedAt: now,
          orderCode: row.salesOrder.orderCode,
          consumerName: row.salesOrder.consumer?.fullName ?? null,
          territoryName: row.salesOrder.consumer?.territory?.name ?? null,
          collectionPointName: row.outlet.name,
        });
      }
    }

    for (const [outletId, count] of queueAtDisabledOutlet) {
      const outlet = disabledOutlets.find((candidate) => candidate.id === outletId);
      items.push({
        category: 'ACTION_REQUIRED',
        type: 'DISABLED_COLLECTION_POINT_WITH_QUEUE',
        severity: 'MEDIUM',
        message: `${outlet?.name ?? 'A Collection Point'} is disabled with ${count} order${count === 1 ? '' : 's'} still queued`,
        entityType: 'Outlet',
        entityId: outletId,
        detectedAt: now,
        territoryName: outlet?.territory?.name ?? null,
        collectionPointName: outlet?.name ?? null,
      });
    }

    // Notification failures (Sprint 43's new, genuine gap) — the most recent consumer
    // WhatsApp delivery for every order currently in this scope's fulfilment queues is
    // `FAILED`. Reuses the SAME order ids already fetched above — no second order scan.
    const orderIdsInScope = [
      ...assignedQueue.items,
      ...preparingQueue.items,
      ...readyQueue.items,
    ].map((row) => row.salesOrderId);
    if (orderIdsInScope.length > 0) {
      const latestDeliveries =
        await this.consumerWhatsAppDeliveryRepository.findLatestBySalesOrderIds(
          organisationId,
          orderIdsInScope,
        );
      const rowBySalesOrderId = new Map(
        [...assignedQueue.items, ...preparingQueue.items, ...readyQueue.items].map((row) => [
          row.salesOrderId,
          row,
        ]),
      );
      for (const delivery of latestDeliveries) {
        if (delivery.status !== 'FAILED') {
          continue;
        }
        const row = rowBySalesOrderId.get(delivery.salesOrderId);
        items.push({
          category: 'ACTION_REQUIRED',
          type: 'NOTIFICATION_FAILED',
          severity: 'HIGH',
          message: `The ${delivery.kind === 'COLLECTION_READY' ? 'Ready for Collection' : 'Collected'} WhatsApp notification failed for order ${row?.salesOrder.orderCode ?? delivery.salesOrderId}`,
          entityType: 'ConsumerWhatsAppDelivery',
          entityId: delivery.id,
          detectedAt: now,
          orderCode: row?.salesOrder.orderCode ?? null,
          consumerName: row?.salesOrder.consumer?.fullName ?? null,
          territoryName: row?.salesOrder.consumer?.territory?.name ?? null,
          collectionPointName: row?.outlet.name ?? null,
        });
      }
    }

    return items;
  }

  private stuckFulfilmentItem(
    row: CollectionPointFulfillmentWithRelations,
    threshold: number,
    unit: 'h' | 'm',
  ): D2CExceptionItem {
    return {
      category: 'ACTION_REQUIRED',
      type: 'STUCK_FULFILLMENT',
      severity: 'MEDIUM',
      message: `Order ${row.salesOrder.orderCode} has been ${row.status.replace(/_/g, ' ').toLowerCase()} for over ${threshold}${unit} at ${row.outlet.name}`,
      // `entityId` is the underlying `SalesOrder.id` (never this fulfilment row's own
      // id) — the frontend deep-links straight to `/settings/d2c/orders/:id`.
      entityType: 'CollectionPointFulfillment',
      entityId: row.salesOrderId,
      detectedAt: new Date(),
      orderCode: row.salesOrder.orderCode,
      consumerName: row.salesOrder.consumer?.fullName ?? null,
      territoryName: row.salesOrder.consumer?.territory?.name ?? null,
      collectionPointName: row.outlet.name,
    };
  }
}
