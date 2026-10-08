import { ForbiddenException, Injectable } from '@nestjs/common';
import {
  Consumer,
  CollectionPointFulfillmentStatus,
  ConsumerStatus,
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
import { ConsumerWhatsAppDeliveryRepository } from '../messaging/consumer-whatsapp-delivery.repository';
import { D2COperationalExceptionsService } from '../operations/d2c-operational-exceptions.service';
import { D2CAdminOverview, D2CAttentionItem, D2CTerritorySummaryRow } from './d2c-admin.types';

const SALES_CUSTOMER_MANAGE = 'sales.customer.manage';

/** Bounded read for the dashboard's own order-status counts — an operational
 *  dashboard, not a report; mirrors `D2COperationalExceptionsService`'s own
 *  `EXCEPTION_SCAN_PAGE_SIZE` reasoning. */
const DASHBOARD_SCAN_PAGE_SIZE = 200;

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
    private readonly collectionPointFulfillmentRepository: CollectionPointFulfillmentRepository,
    private readonly outletRepository: OutletRepository,
    private readonly territoryRepository: TerritoryRepository,
    private readonly effectiveAccessResolver: EffectiveAccessResolver,
    private readonly prisma: PrismaService,
    private readonly consumerWhatsAppDeliveryRepository: ConsumerWhatsAppDeliveryRepository,
    private readonly exceptionsService: D2COperationalExceptionsService,
  ) {}

  async getOverview(organisationId: string, actorUserId: string): Promise<D2CAdminOverview> {
    await this.assertAdmin(organisationId, actorUserId);

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const [
      totalD2C,
      pending,
      failed,
      enabledOutlets,
      consumers,
      recent,
      attention,
      ordersToday,
      preparingQueue,
      readyQueue,
      collectedToday,
      newConsumersToday,
      activeConsumers,
      whatsappCounts,
      whatsappEligibleForRetry,
    ] = await Promise.all([
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
      this.exceptionsService.compute(organisationId),
      this.salesOrderService.listPaginated(organisationId, {
        source: SalesOrderSource.D2C,
        dateFrom: startOfToday,
        page: 1,
        pageSize: 1,
      }),
      this.collectionPointFulfillmentRepository.findManyPaginated(organisationId, {
        status: CollectionPointFulfillmentStatus.PREPARING,
        page: 1,
        pageSize: DASHBOARD_SCAN_PAGE_SIZE,
      }),
      this.collectionPointFulfillmentRepository.findManyPaginated(organisationId, {
        status: CollectionPointFulfillmentStatus.READY_FOR_COLLECTION,
        page: 1,
        pageSize: DASHBOARD_SCAN_PAGE_SIZE,
      }),
      this.collectionPointFulfillmentRepository.findManyPaginated(organisationId, {
        status: CollectionPointFulfillmentStatus.COLLECTED,
        dateFrom: startOfToday,
        page: 1,
        pageSize: 1,
      }),
      this.prisma.consumer.count({
        where: { organisationId, createdAt: { gte: startOfToday } },
      }),
      this.prisma.consumer.count({
        where: { organisationId, status: ConsumerStatus.ACTIVE },
      }),
      this.consumerWhatsAppDeliveryRepository.countSinceByStatus(organisationId, startOfToday),
      this.consumerWhatsAppDeliveryRepository.countEligibleForRetry(organisationId),
    ]);

    const unassignedOrders = attention.filter((item) => item.type === 'UNASSIGNED_ORDER').length;

    return {
      summary: {
        totalD2COrders: totalD2C.total,
        ordersToday: ordersToday.total,
        ordersPreparing: preparingQueue.total,
        ordersReadyForCollection: readyQueue.total,
        ordersCollectedToday: collectedToday.total,
        consumersTotal: consumers.total,
        activeConsumers,
        newConsumersToday,
        activeCollectionPoints: enabledOutlets.length,
        pendingPayments: pending.total,
        failedPayments: failed.total,
        unassignedOrders,
        exceptionsCount: attention.length,
        whatsappSentToday: whatsappCounts.sent,
        whatsappFailedToday: whatsappCounts.failed,
        whatsappEligibleForRetry,
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
    return this.exceptionsService.compute(organisationId);
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
