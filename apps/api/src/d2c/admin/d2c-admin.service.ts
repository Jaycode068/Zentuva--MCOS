import { ForbiddenException, Injectable } from '@nestjs/common';
import {
  Consumer,
  CollectionPointFulfillmentStatus,
  PaymentStatus,
  SalesOrderSource,
  SalesOrderStatus,
} from '@prisma/client';

import { EffectiveAccessResolver } from '../../identity/authorization/effective-access-resolver';
import { PrismaService } from '../../prisma/prisma.service';
import { OutletRepository } from '../../retail/outlet/outlet.repository';
import { TerritoryRepository } from '../../retail/territory/territory.repository';
import { SalesOrderWithRelations } from '../../sales/sales-order.repository';
import { SalesOrderService } from '../../sales/sales-order.service';
import { ListConsumersParams } from '../consumer/consumer.repository';
import { ConsumerService } from '../consumer/consumer.service';
import { CollectionPointFulfillmentRepository } from '../fulfillment/collection-point-fulfillment.repository';
import { CollectionPointFulfillmentService } from '../fulfillment/collection-point-fulfillment.service';
import { D2CAdminOverview, D2CAttentionItem, D2CTerritorySummaryRow } from './d2c-admin.types';

const SALES_CUSTOMER_MANAGE = 'sales.customer.manage';

/** A stuck fulfilment (`ASSIGNED`/`PREPARING` for longer than this) is surfaced as
 *  "Action Required" — the same operational threshold Sprint 38's Field screen used for
 *  its own "Waiting" badge (`ATTENTION_WAITING_MINUTES`), scaled up here from a single
 *  Collection Point's own queue to an org-wide admin view. */
const STUCK_FULFILLMENT_HOURS = 24;
/** Bounded read for the attention computation — an operational dashboard, not a report;
 *  genuinely exceeding this many simultaneously-open fulfilments across an entire
 *  organisation would itself be a signal worth a separate, paginated investigation, not
 *  something this summary needs to enumerate exhaustively. */
const ATTENTION_SCAN_PAGE_SIZE = 200;

/**
 * Sprint 39 — D2C Sales Administration & Operations Dashboard (docs/domains/d2c.md).
 * Pure read-aggregation across EXISTING D2C/Sales/Retail services — no table of its own,
 * no parallel order/payment/exception entity. Every admin-only check here is the SAME
 * `sales.customer.manage`-or-owner-bypass signal `CollectionPointFulfillmentService`
 * already established (Sprint 37/38) for "is this an admin, not just a rep" — no new
 * permission, no new concept.
 */
@Injectable()
export class D2CAdminService {
  constructor(
    private readonly salesOrderService: SalesOrderService,
    private readonly consumerService: ConsumerService,
    private readonly collectionPointFulfillmentService: CollectionPointFulfillmentService,
    private readonly collectionPointFulfillmentRepository: CollectionPointFulfillmentRepository,
    private readonly outletRepository: OutletRepository,
    private readonly territoryRepository: TerritoryRepository,
    private readonly effectiveAccessResolver: EffectiveAccessResolver,
    private readonly prisma: PrismaService,
  ) {}

  async getOverview(organisationId: string, actorUserId: string): Promise<D2CAdminOverview> {
    await this.assertAdmin(organisationId, actorUserId);

    const [totalD2C, pending, failed, enabledOutlets, consumers, recent, attention] =
      await Promise.all([
        this.salesOrderService.listPaginated(organisationId, {
          source: SalesOrderSource.D2C,
          page: 1,
          pageSize: 1,
        }),
        this.salesOrderService.listPaginated(organisationId, {
          source: SalesOrderSource.D2C,
          paymentStatus: 'PENDING',
          page: 1,
          pageSize: 1,
        }),
        this.salesOrderService.listPaginated(organisationId, {
          source: SalesOrderSource.D2C,
          paymentStatus: 'FAILED',
          page: 1,
          pageSize: 1,
        }),
        this.outletRepository.findManyByOrganisation(organisationId, {
          collectionPointStatus: 'ENABLED',
        }),
        this.consumerService.listPaginated(organisationId, { page: 1, pageSize: 1 }),
        this.salesOrderService.listPaginated(organisationId, {
          source: SalesOrderSource.D2C,
          page: 1,
          pageSize: 10,
        }),
        this.computeAttentionItems(organisationId, actorUserId),
      ]);

    const unassignedOrders = attention.filter((item) => item.type === 'UNASSIGNED_ORDER').length;

    return {
      summary: {
        totalD2COrders: totalD2C.total,
        consumersTotal: consumers.total,
        activeCollectionPoints: enabledOutlets.length,
        pendingPayments: pending.total,
        failedPayments: failed.total,
        unassignedOrders,
      },
      attention,
      recentOrders: recent.items.map((order) => ({
        id: order.id,
        orderCode: order.orderCode,
        consumerName: order.consumer?.fullName ?? null,
        status: order.status,
        total: order.total,
        orderDate: order.orderDate,
      })),
    };
  }

  /** The standalone, full Attention/Exception view (brief §"Exception Handling") — the
   *  same underlying computation `getOverview` already truncates into counts, returned
   *  here in full. */
  async getAttention(organisationId: string, actorUserId: string): Promise<D2CAttentionItem[]> {
    await this.assertAdmin(organisationId, actorUserId);
    return this.computeAttentionItems(organisationId, actorUserId);
  }

  /** Territory operational summary (brief: "not full Demand Intelligence — that's
   *  Sprint 41"). Two bounded `groupBy` queries (consumer counts, D2C-order counts via a
   *  consumer-id -> territory-id map) plus one outlet query — never N+1 per territory. */
  async getTerritorySummary(
    organisationId: string,
    actorUserId: string,
  ): Promise<D2CTerritorySummaryRow[]> {
    await this.assertAdmin(organisationId, actorUserId);

    const [territories, consumerCounts, consumerTerritoryMap, orderCountsByConsumer, outlets] =
      await Promise.all([
        this.territoryRepository.findManyByOrganisation(organisationId),
        this.prisma.consumer.groupBy({
          by: ['territoryId'],
          where: { organisationId, territoryId: { not: null } },
          _count: { _all: true },
        }),
        this.prisma.consumer.findMany({
          where: { organisationId, territoryId: { not: null } },
          select: { id: true, territoryId: true },
        }),
        this.prisma.salesOrder.groupBy({
          by: ['consumerId'],
          where: { organisationId, source: SalesOrderSource.D2C, consumerId: { not: null } },
          _count: { _all: true },
        }),
        this.outletRepository.findManyByOrganisation(organisationId, {}),
      ]);

    const consumerToTerritory = new Map(
      consumerTerritoryMap.map((row) => [row.id, row.territoryId as string]),
    );
    const d2cOrdersByTerritory = new Map<string, number>();
    for (const row of orderCountsByConsumer) {
      const territoryId = row.consumerId ? consumerToTerritory.get(row.consumerId) : undefined;
      if (!territoryId) {
        continue;
      }
      d2cOrdersByTerritory.set(
        territoryId,
        (d2cOrdersByTerritory.get(territoryId) ?? 0) + row._count._all,
      );
    }
    const consumerCountByTerritory = new Map(
      consumerCounts.map((row) => [row.territoryId as string, row._count._all]),
    );
    const outletsByTerritory = new Map<string, { total: number; enabled: number }>();
    for (const outlet of outlets) {
      // `collectionPointStatus` defaults to `DISABLED` for EVERY outlet, including ones
      // never configured as a Collection Point at all (`Outlet.collectionPointStatus`
      // schema comment) — `collectionPointResponsibleUserId` set (or already `ENABLED`)
      // is the real "this outlet was deliberately configured as a Collection Point"
      // signal; without this check every ordinary B2B outlet with a territory would be
      // miscounted as a "disabled Collection Point".
      const isConfiguredCollectionPoint =
        outlet.collectionPointStatus === 'ENABLED' || outlet.collectionPointResponsibleUserId;
      if (!outlet.territoryId || !isConfiguredCollectionPoint) {
        continue;
      }
      const existing = outletsByTerritory.get(outlet.territoryId) ?? { total: 0, enabled: 0 };
      existing.total += 1;
      if (outlet.collectionPointStatus === 'ENABLED') {
        existing.enabled += 1;
      }
      outletsByTerritory.set(outlet.territoryId, existing);
    }

    return territories.map((territory) => ({
      territoryId: territory.id,
      territoryName: territory.name,
      consumerCount: consumerCountByTerritory.get(territory.id) ?? 0,
      d2cOrderCount: d2cOrdersByTerritory.get(territory.id) ?? 0,
      collectionPointCount: outletsByTerritory.get(territory.id)?.total ?? 0,
      enabledCollectionPointCount: outletsByTerritory.get(territory.id)?.enabled ?? 0,
    }));
  }

  private async computeAttentionItems(
    organisationId: string,
    actorUserId: string,
  ): Promise<D2CAttentionItem[]> {
    const items: D2CAttentionItem[] = [];

    // Unassigned: CONFIRMED D2C orders with no CollectionPointFulfillment row yet.
    const confirmed = await this.salesOrderService.listPaginated(organisationId, {
      source: SalesOrderSource.D2C,
      status: SalesOrderStatus.CONFIRMED,
      page: 1,
      pageSize: ATTENTION_SCAN_PAGE_SIZE,
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
            message: `Order ${order.orderCode} is confirmed but not yet assigned to a Collection Point`,
            entityType: 'SalesOrder',
            entityId: order.id,
          });
        }
      }
    }

    // Unpaid / failed payment D2C orders (informational — a pending payment is often just
    // mid-checkout; failed is worth a human look).
    const failedPayment = await this.salesOrderService.listPaginated(organisationId, {
      source: SalesOrderSource.D2C,
      paymentStatus: 'FAILED',
      page: 1,
      pageSize: ATTENTION_SCAN_PAGE_SIZE,
    });
    for (const order of failedPayment.items) {
      items.push({
        category: 'ACTION_REQUIRED',
        type: 'FAILED_PAYMENT',
        message: `Order ${order.orderCode}'s payment failed`,
        entityType: 'SalesOrder',
        entityId: order.id,
      });
    }

    // Stuck fulfilments + disabled Collection Points with a queue — both derived from the
    // same bounded org-wide fulfilment read.
    const disabledOutlets = await this.outletRepository.findManyByOrganisation(organisationId, {
      collectionPointStatus: 'DISABLED',
    });
    const disabledOutletIds = new Set(disabledOutlets.map((outlet) => outlet.id));
    const cutoff = new Date(Date.now() - STUCK_FULFILLMENT_HOURS * 60 * 60 * 1000);

    const [assignedQueue, preparingQueue] = await Promise.all([
      this.collectionPointFulfillmentService.listAll(organisationId, actorUserId, {
        status: CollectionPointFulfillmentStatus.ASSIGNED,
        page: 1,
        pageSize: ATTENTION_SCAN_PAGE_SIZE,
      }),
      this.collectionPointFulfillmentService.listAll(organisationId, actorUserId, {
        status: CollectionPointFulfillmentStatus.PREPARING,
        page: 1,
        pageSize: ATTENTION_SCAN_PAGE_SIZE,
      }),
    ]);
    const queueAtDisabledOutlet = new Map<string, number>();
    for (const row of [...assignedQueue.items, ...preparingQueue.items]) {
      const startedAt = row.preparingAt ?? row.assignedAt;
      if (startedAt < cutoff) {
        items.push({
          category: 'ACTION_REQUIRED',
          type: 'STUCK_FULFILLMENT',
          message: `Order ${row.orderReference} has been ${row.status.replace(/_/g, ' ').toLowerCase()} for over ${STUCK_FULFILLMENT_HOURS}h at ${row.outletName}`,
          // `entityId` is the underlying `SalesOrder.id` (never this fulfilment row's own
          // id) — the frontend deep-links straight to `/settings/d2c/orders/:id`, which
          // reads `GET /sales/orders/:id`, not a Collection Point fulfilment lookup.
          entityType: 'CollectionPointFulfillment',
          entityId: row.salesOrderId,
        });
      }
      if (disabledOutletIds.has(row.outletId)) {
        queueAtDisabledOutlet.set(row.outletId, (queueAtDisabledOutlet.get(row.outletId) ?? 0) + 1);
      }
    }
    for (const [outletId, count] of queueAtDisabledOutlet) {
      const outlet = disabledOutlets.find((candidate) => candidate.id === outletId);
      items.push({
        category: 'ACTION_REQUIRED',
        type: 'DISABLED_COLLECTION_POINT_WITH_QUEUE',
        message: `${outlet?.name ?? 'A Collection Point'} is disabled with ${count} order${count === 1 ? '' : 's'} still queued`,
        entityType: 'Outlet',
        entityId: outletId,
      });
    }

    return items;
  }

  /** The D2C Admin Consumer list (brief §"Consumer List") — admin-only paginated read,
   *  reusing `ConsumerService.listPaginated` (Sprint 39) unchanged. */
  async listConsumers(
    organisationId: string,
    actorUserId: string,
    params: ListConsumersParams & { page: number; pageSize: number },
  ): Promise<{ items: Consumer[]; total: number }> {
    await this.assertAdmin(organisationId, actorUserId);
    return this.consumerService.listPaginated(organisationId, params);
  }

  /** The D2C Admin Order list (brief §"D2C Order List") — admin-only, always
   *  `source: D2C` (never exposes B2B orders through this surface), reusing
   *  `SalesOrderService.listPaginated` (Sprint 39) unchanged. `collectionPointOutletId`
   *  is NOT `SalesOrder.outletId` (that B2B field is always `null` for a D2C order) — it
   *  resolves via the separate `CollectionPointFulfillment.outletId` relation, the exact
   *  same two-step "resolve matching ids first, then filter by `id: {in: ...}`" shape
   *  `SalesOrderController.list`'s own `OWN_TEAM` scope resolution already uses. */
  async listOrders(
    organisationId: string,
    actorUserId: string,
    params: {
      status?: SalesOrderStatus;
      consumerId?: string;
      consumerTerritoryId?: string;
      collectionPointOutletId?: string;
      paymentStatus?: PaymentStatus | 'NONE';
      dateFrom?: Date;
      dateTo?: Date;
      search?: string;
      page: number;
      pageSize: number;
    },
  ): Promise<{ items: SalesOrderWithRelations[]; total: number }> {
    await this.assertAdmin(organisationId, actorUserId);

    let ids: string[] | undefined;
    if (params.collectionPointOutletId) {
      const assignments = await this.collectionPointFulfillmentRepository.findManyByOutlet(
        organisationId,
        params.collectionPointOutletId,
      );
      ids = assignments.map((cpf) => cpf.salesOrderId);
      if (ids.length === 0) {
        return { items: [], total: 0 };
      }
    }

    return this.salesOrderService.listPaginated(organisationId, {
      status: params.status,
      consumerId: params.consumerId,
      consumerTerritoryId: params.consumerTerritoryId,
      paymentStatus: params.paymentStatus,
      dateFrom: params.dateFrom,
      dateTo: params.dateTo,
      search: params.search,
      page: params.page,
      pageSize: params.pageSize,
      ...(ids ? { ids } : {}),
      source: SalesOrderSource.D2C,
    });
  }

  private async assertAdmin(organisationId: string, actorUserId: string): Promise<void> {
    const access = await this.effectiveAccessResolver.resolve(organisationId, actorUserId);
    if (access.isOwnerBypass || access.grants.has(SALES_CUSTOMER_MANAGE)) {
      return;
    }
    throw new ForbiddenException('You are not authorized to view this organisation-wide data');
  }
}
