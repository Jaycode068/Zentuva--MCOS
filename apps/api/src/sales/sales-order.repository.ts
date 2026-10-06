import { Injectable } from '@nestjs/common';
import {
  Prisma,
  PaymentStatus,
  SalesOrder,
  SalesOrderSource,
  SalesOrderStatus,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

export interface ListSalesOrdersParams {
  status?: SalesOrderStatus;
  customerId?: string;
  outletId?: string;
  /** Sprint 25.1 (docs/architecture/authorization-coverage.md) — `sales.order.view`'s
   *  `OWN_RECORDS` scope filter, using the already-existing `salesAgentId` column
   *  ("always the authenticated caller", per its own schema comment). No new data. */
  salesAgentId?: string;
  /** Sprint 25.1 — `sales.order.view`'s `OWN_TEAM` scope filter: the `User.id`s of the
   *  caller's direct reports (resolved by the controller via `EmployeeService`'s
   *  existing `managerEmployeeId` relationship, then each report's linked `User.id`).
   *  Mutually exclusive with `salesAgentId` — the controller sends at most one. */
  salesAgentIds?: string[];
  /** Simple case-insensitive substring match against the order code or the customer's
   *  name — same convention as every other domain's `search` filter. Sprint 39's
   *  paginated admin query widens this further (also matching the consumer's name/code)
   *  without touching this flag's existing B2B-only meaning here. */
  search?: string;
  /** Added Sprint 38 — the Field D2C overview's own filter (`B2B`/`D2C`, Sprint 34's
   *  `SalesOrderSource`). No existing caller passed this before; every pre-existing
   *  query is unaffected. */
  source?: SalesOrderSource;
  /** Added Sprint 38 — the server-enforced territory scope for a field Sales
   *  Representative's D2C order visibility (`FieldD2COverviewService`). Filters by the
   *  D2C order's own `Consumer.territoryId` — never trusted from a request, always
   *  computed server-side from the caller's own `Employee.territoryId`. */
  consumerTerritoryId?: string;
  /** Added Sprint 39 — the D2C Admin order list's consumer filter (docs/domains/d2c.md).
   *  No existing caller passed this before. */
  consumerId?: string;
  /** Added Sprint 39 — admin order-date-range filter, inclusive. */
  dateFrom?: Date;
  dateTo?: Date;
  /** Added Sprint 39 — "has any payment with this status" (`payments: {some: ...}`); a
   *  D2C order has at most one payment today, so this is equivalent to "latest payment
   *  status" without needing a second, more complex query. `'NONE'` means "no payment
   *  row at all" (`payments: {none: {}}`) — a genuinely different, also-useful filter
   *  (never attempted vs. attempted-and-failed). Never applied to a B2B list — only the
   *  new paginated admin method below builds this condition. */
  paymentStatus?: PaymentStatus | 'NONE';
  /** Added Sprint 39 — the D2C Admin order list's Collection Point filter resolves to
   *  this: `D2CAdminService.listOrders` first looks up matching
   *  `CollectionPointFulfillment.salesOrderId`s for the requested outlet, then passes
   *  them here (`id: {in: ids}`) — the same two-step shape `SalesOrderController.list`'s
   *  own `OWN_TEAM` scope resolution already uses for `salesAgentIds`. */
  ids?: string[];
}

/** Added Sprint 39 — the D2C Admin order list's own pagination contract
 *  (`@zentuva/validation`'s shared `paginationSchema`, same convention as
 *  `EmployeeRepository`). A SEPARATE method from `findManyByOrganisation` below
 *  (never retrofitted onto it) — that method's existing callers
 *  (`FieldD2COverviewService`, etc.) expect a bare array of EVERY matching row, and
 *  changing its return shape or silently capping it at a page size would be a breaking,
 *  undetected regression for them. */
export interface ListSalesOrdersPaginatedParams extends ListSalesOrdersParams {
  page: number;
  pageSize: number;
}

const PRODUCT_SELECT = { id: true, code: true, name: true, unit: true };

export type SalesOrderWithRelations = SalesOrder & {
  /** `null` for a `D2C` order (Sprint 34) — see `SalesOrder.customerId`'s schema doc
   *  comment. Every pre-existing B2B caller keeps getting a real object here. */
  customer: { id: string; customerCode: string; customerName: string } | null;
  outlet: { id: string; outletCode: string; name: string } | null;
  /** Added Sprint 34 — `null` for a `B2B` order. */
  consumer: {
    id: string;
    consumerCode: string;
    fullName: string;
    territoryId: string | null;
    territory: { name: string } | null;
  } | null;
  items: {
    id: string;
    productId: string;
    quantity: number;
    /** Cumulative quantity fulfilled so far (Sprint 4.9) — see
     *  `SalesOrderItem.quantityFulfilled`'s schema doc comment. */
    quantityFulfilled: number;
    unitPrice: number;
    lineTotal: number;
    product: { id: string; code: string; name: string; unit: string };
  }[];
};

const RELATIONS_INCLUDE = {
  customer: { select: { id: true, customerCode: true, customerName: true } },
  outlet: { select: { id: true, outletCode: true, name: true } },
  consumer: {
    select: {
      id: true,
      consumerCode: true,
      fullName: true,
      territoryId: true,
      territory: { select: { name: true } },
    },
  },
  items: {
    include: { product: { select: PRODUCT_SELECT } },
    orderBy: { createdAt: 'asc' as const },
  },
};

/**
 * Thin Prisma access for the `SalesOrder` aggregate (Sprint 4.8, docs/domains/sales.md).
 * No business logic — customer/outlet/product validation, total calculation, and
 * status-transition rules live in `SalesOrderService`; this file only knows how to
 * read/write rows. Flat, single-module shape (no separate `SalesOrderItem` controller) —
 * same as `BillOfMaterial`+`BillOfMaterialItem`.
 */
@Injectable()
export class SalesOrderRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Prisma's nested `items: { create: [...] }` write is already atomic — no explicit
   *  `$transaction` needed for a pure create, same as `ProductionOrderRepository.create`. */
  create(data: Prisma.SalesOrderCreateInput): Promise<SalesOrderWithRelations> {
    return this.prisma.salesOrder.create({ data, include: RELATIONS_INCLUDE });
  }

  findById(organisationId: string, id: string): Promise<SalesOrderWithRelations | null> {
    return this.prisma.salesOrder.findFirst({
      where: { id, organisationId },
      include: RELATIONS_INCLUDE,
    });
  }

  /** Added Sprint 34 — the idempotency-before-precheck lookup
   *  (`SalesOrderService.createForConsumer`), same shape as
   *  `CustomerReturnRepository`/`SalesFulfilmentRepository`'s own
   *  `findByIdempotencyKey`, generalised here to sales-order creation itself rather
   *  than a downstream event against an existing order. */
  findByIdempotencyKey(
    organisationId: string,
    idempotencyKey: string,
  ): Promise<SalesOrderWithRelations | null> {
    return this.prisma.salesOrder.findFirst({
      where: { organisationId, idempotencyKey },
      include: RELATIONS_INCLUDE,
    });
  }

  findManyByOrganisation(
    organisationId: string,
    params: ListSalesOrdersParams = {},
  ): Promise<SalesOrderWithRelations[]> {
    return this.prisma.salesOrder.findMany({
      where: {
        organisationId,
        ...(params.status ? { status: params.status } : {}),
        ...(params.customerId ? { customerId: params.customerId } : {}),
        ...(params.outletId ? { outletId: params.outletId } : {}),
        ...(params.salesAgentId ? { salesAgentId: params.salesAgentId } : {}),
        ...(params.salesAgentIds ? { salesAgentId: { in: params.salesAgentIds } } : {}),
        ...(params.source ? { source: params.source } : {}),
        ...(params.consumerTerritoryId
          ? { consumer: { territoryId: params.consumerTerritoryId } }
          : {}),
        ...(params.search
          ? {
              OR: [
                { orderCode: { contains: params.search, mode: 'insensitive' } },
                { customer: { customerName: { contains: params.search, mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      include: RELATIONS_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Added Sprint 39 — the D2C Admin order list (docs/domains/d2c.md). Builds the SAME
   *  kind of `where` clause as `findManyByOrganisation`, plus the admin-only filters
   *  (`consumerId`/date range/`paymentStatus`) and a widened `search` that also matches
   *  a D2C order's `Consumer.fullName`/`.consumerCode` (the B2B-only method above is left
   *  untouched — its `search` still only matches `Customer.customerName`). Runs the
   *  `findMany`+`count` pair in parallel, same convention as `EmployeeRepository.list`. */
  async findManyPaginated(
    organisationId: string,
    params: ListSalesOrdersPaginatedParams,
  ): Promise<{ items: SalesOrderWithRelations[]; total: number }> {
    const where: Prisma.SalesOrderWhereInput = {
      organisationId,
      ...(params.status ? { status: params.status } : {}),
      ...(params.customerId ? { customerId: params.customerId } : {}),
      ...(params.outletId ? { outletId: params.outletId } : {}),
      ...(params.salesAgentId ? { salesAgentId: params.salesAgentId } : {}),
      ...(params.salesAgentIds ? { salesAgentId: { in: params.salesAgentIds } } : {}),
      ...(params.source ? { source: params.source } : {}),
      ...(params.consumerId ? { consumerId: params.consumerId } : {}),
      ...(params.ids ? { id: { in: params.ids } } : {}),
      ...(params.consumerTerritoryId
        ? { consumer: { territoryId: params.consumerTerritoryId } }
        : {}),
      ...(params.dateFrom || params.dateTo
        ? {
            orderDate: {
              ...(params.dateFrom ? { gte: params.dateFrom } : {}),
              ...(params.dateTo ? { lte: params.dateTo } : {}),
            },
          }
        : {}),
      ...(params.paymentStatus === 'NONE'
        ? { payments: { none: {} } }
        : params.paymentStatus
          ? { payments: { some: { status: params.paymentStatus } } }
          : {}),
      ...(params.search
        ? {
            OR: [
              { orderCode: { contains: params.search, mode: 'insensitive' } },
              { customer: { customerName: { contains: params.search, mode: 'insensitive' } } },
              { consumer: { fullName: { contains: params.search, mode: 'insensitive' } } },
              { consumer: { consumerCode: { contains: params.search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.salesOrder.findMany({
        where,
        include: RELATIONS_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
      }),
      this.prisma.salesOrder.count({ where }),
    ]);
    return { items, total };
  }

  /** Globally unique (see `SalesOrder.orderCode` schema comment) — checked without an
   *  `organisationId` filter, same convention as every other auto-numbered code in this
   *  codebase. */
  async existsByCode(orderCode: string): Promise<boolean> {
    const count = await this.prisma.salesOrder.count({ where: { orderCode } });
    return count > 0;
  }

  /** Added Sprint 40 — the `FIRST_QUALIFYING_ORDER` promotion condition
   *  (`PromotionEvaluationService`): "has this consumer had any OTHER genuinely
   *  qualifying D2C order besides the one being evaluated." `CONFIRMED` or later
   *  (`PARTIALLY_FULFILLED`/`FULFILLED`) only — a `DRAFT` (never paid) or `CANCELLED`
   *  order was never a real purchase and must never count, matching the exact
   *  "qualifying event must be an authoritative paid/confirmed state, not merely cart
   *  creation" rule the brief's own Sprint 40 instructions require. */
  async countOtherQualifyingD2COrders(
    organisationId: string,
    consumerId: string,
    excludeOrderId: string,
  ): Promise<number> {
    return this.prisma.salesOrder.count({
      where: {
        organisationId,
        consumerId,
        source: SalesOrderSource.D2C,
        id: { not: excludeOrderId },
        status: {
          in: [
            SalesOrderStatus.CONFIRMED,
            SalesOrderStatus.PARTIALLY_FULFILLED,
            SalesOrderStatus.FULFILLED,
          ],
        },
      },
    });
  }

  /** Updates header fields and, when `items` is provided, replaces the entire item list
   *  within the same transaction (only reachable while `status === DRAFT`, enforced by
   *  `SalesOrderService`, not here). Delete-then-recreate, same shape as
   *  `ProductionOrderRepository.update`. */
  async update(
    organisationId: string,
    id: string,
    headerData: Prisma.SalesOrderUncheckedUpdateManyInput,
    items?: { productId: string; quantity: number; unitPrice: number; lineTotal: number }[],
  ): Promise<SalesOrderWithRelations | null> {
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.salesOrder.updateMany({
        where: { id, organisationId },
        data: headerData,
      });
      if (result.count === 0) {
        return null;
      }

      if (items) {
        await tx.salesOrderItem.deleteMany({ where: { salesOrderId: id } });
        await tx.salesOrderItem.createMany({
          data: items.map((item) => ({ ...item, salesOrderId: id })),
        });
      }

      return tx.salesOrder.findUniqueOrThrow({ where: { id }, include: RELATIONS_INCLUDE });
    });
  }

  /** Tenant-scoped conditional status transition — `updateMany` only matches when the
   *  order's current status is one of `fromStatuses`, closing the race against a
   *  concurrent transition, same as `ProductionOrderRepository.updateStatus`. Returns
   *  `null` on no match; the service turns that into a specific `BadRequestException`. */
  async updateStatus(
    organisationId: string,
    id: string,
    fromStatuses: SalesOrderStatus[],
    toStatus: SalesOrderStatus,
    /** Added Sprint 35 — `null` when the transition is system-triggered
     *  (a verified OPay payment confirming a D2C order), never a human
     *  actor — same `null`-means-"no human actor" convention `createdById`
     *  already uses throughout this codebase. */
    actorUserId: string | null,
  ): Promise<SalesOrderWithRelations | null> {
    const result = await this.prisma.salesOrder.updateMany({
      where: { id, organisationId, status: { in: fromStatuses } },
      data: { status: toStatus, updatedById: actorUserId },
    });
    if (result.count === 0) {
      return null;
    }
    return this.prisma.salesOrder.findUniqueOrThrow({ where: { id }, include: RELATIONS_INCLUDE });
  }
}
