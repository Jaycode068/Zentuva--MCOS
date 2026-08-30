import { Injectable } from '@nestjs/common';
import {
  InventoryTransactionType,
  JournalEntryStatus,
  Prisma,
  SalesFulfilment,
  SalesOrderStatus,
} from '@prisma/client';

import { SYSTEM_ACCOUNT_KEYS } from '../finance/accounting/chart-of-account-keys';
import { postSystemJournalEntry } from '../finance/accounting/journal-posting';
import { PrismaService } from '../prisma/prisma.service';
import { SalesOrderWithRelations } from './sales-order.repository';

const PRODUCT_SELECT = { id: true, code: true, name: true, unit: true };
const LOCATION_SELECT = { id: true, name: true };

export type SalesFulfilmentWithItems = SalesFulfilment & {
  location: { id: string; name: string };
  items: {
    id: string;
    productId: string;
    salesOrderItemId: string;
    quantityFulfilled: number;
    /** Cumulative quantity dispatched so far (Sprint 5) — see
     *  `SalesFulfilmentItem.quantityDispatched`'s schema doc comment. */
    quantityDispatched: number;
    /** Added Sprint 10 — the `InventoryStock.averageUnitCost` this item was actually
     *  costed at, at the moment of fulfilment. A snapshot, not a live re-read — see
     *  `SalesFulfilmentItem.unitCost`'s schema doc comment. */
    unitCost: number;
    /** Added Sprint 10 — `quantityFulfilled × unitCost`, rounded. Every sibling
     *  item's `costAmount` on one `SalesFulfilment` sums to exactly the posted
     *  Journal Entry's amount. */
    costAmount: number;
    product: { id: string; code: string; name: string; unit: string };
  }[];
};

/** Minimal Journal Entry summary surfaced on the fulfilment response, same shape as
 *  `ProductionMaterialIssueRepository`'s `JournalEntrySummary`. `totalAmount` is the
 *  posting's total debit (== total credit, by construction). */
export interface JournalEntrySummary {
  id: string;
  journalNumber: string;
  status: JournalEntryStatus;
  totalAmount: number;
}

/** Adds the parent Sales Order's own identity fields (Sprint 5) — `DispatchService`
 *  needs `customerId`/`outletId` to resolve a Dispatch's destination without a second
 *  round trip through `SalesOrderRepository`. */
export type SalesFulfilmentWithOrder = SalesFulfilmentWithItems & {
  salesOrder: { id: string; customerId: string; outletId: string | null };
};

const RELATIONS_INCLUDE = {
  location: { select: LOCATION_SELECT },
  items: { include: { product: { select: PRODUCT_SELECT } } },
};

const ORDER_RELATIONS_INCLUDE = {
  customer: { select: { id: true, customerCode: true, customerName: true } },
  outlet: { select: { id: true, outletCode: true, name: true } },
  items: {
    include: { product: { select: PRODUCT_SELECT } },
    orderBy: { createdAt: 'asc' as const },
  },
};

export interface FulfilItemData {
  salesOrderItemId: string;
  productId: string;
  quantity: number;
}

export interface FulfilSalesOrderData {
  organisationId: string;
  salesOrderId: string;
  /** Added Sprint 10 — used only in the Journal Entry's `description`; cheap to pass
   *  since the caller already has it, avoids a second in-transaction read. */
  salesOrderNumber: string;
  locationId: string;
  fulfilmentDate: Date;
  fulfilledById: string;
  notes?: string;
  idempotencyKey?: string;
  items: FulfilItemData[];
}

export interface FulfilSalesOrderResult {
  fulfilment: SalesFulfilmentWithItems;
  order: SalesOrderWithRelations;
  /** Added Sprint 10 — the automatically-posted Journal Entry for this fulfilment's
   *  COGS value (`DR Cost of Goods Sold / CR Finished Goods Inventory`), `null` only
   *  when every fulfilled item had a `0` average cost (finished-goods stock built
   *  entirely from un-costed Adjustments — see docs/domains/accounting.md "Sales
   *  Fulfilment Accounting"). */
  journalEntry: JournalEntrySummary | null;
  /** `true` only when THIS call created a new row; `false` when an existing
   *  `idempotencyKey` match was returned instead — lets the controller skip re-emitting
   *  the audit event on a replay. */
  wasCreated: boolean;
}

/** Thrown when a product's current `quantityOnHand` at the fulfilment location can't
 *  cover the requested quantity. Its own `Error` subclass (not `BadRequestException`)
 *  because this file has no Nest HTTP context — same convention as
 *  `ProductionMaterialIssueRepository`'s `InsufficientStockError`. */
export class InsufficientStockError extends Error {}

/** Thrown when the Sales Order isn't `CONFIRMED`/`PARTIALLY_FULFILLED` at the moment the
 *  transaction actually runs — re-checked here to close the race against a concurrent
 *  status change between `SalesFulfilmentService`'s pre-check and this transaction, same
 *  role as `ProductionMaterialIssueConflictError`. */
export class SalesFulfilmentConflictError extends Error {}

/**
 * Thin Prisma access for the `SalesFulfilment` aggregate (Sprint 4.9,
 * docs/domains/sales.md "Fulfilment") — THE one place a Sales Order's inventory is ever
 * deducted.
 *
 * `create()` runs the entire "physically supply this order" operation inside a single
 * `$transaction`, mirroring `ProductionMaterialIssueRepository.issue()`'s shape exactly:
 * an idempotency check-then-return, a conditional read re-validating the order is still
 * eligible, a per-item read-guard-write against `InventoryStock` (evaluated *inside* the
 * transaction, not from a pre-check the caller already did — closing the race between two
 * concurrent fulfilments a stale pre-check couldn't), the paired `InventoryTransaction`
 * `ISSUE` rows, and the order's own status recomputation — all rolled back together on any
 * failure.
 *
 * Writing directly to `inventory_stock`/`inventory_transactions` here is the same
 * deliberate, narrow exception to ADR-002's domain-ownership convention that
 * `ProductionMaterialIssueRepository`/`GoodsReceiptRepository` already establish, made for
 * atomicity. See docs/domains/sales.md "Fulfilment".
 */
@Injectable()
export class SalesFulfilmentRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Looks up the Journal Entry (if any) posted for a given Sales Fulfilment, via the
   *  same polymorphic `sourceType`/`sourceId` `JournalEntry` design every system
   *  posting already uses — no FK exists (deliberately, see `journal-posting.ts`). */
  private async findJournalEntry(
    tx: Prisma.TransactionClient,
    organisationId: string,
    fulfilmentId: string,
  ): Promise<JournalEntrySummary | null> {
    const journalEntry = await tx.journalEntry.findUnique({
      where: {
        organisationId_sourceType_sourceId: {
          organisationId,
          sourceType: 'SALES_FULFILMENT',
          sourceId: fulfilmentId,
        },
      },
      include: { lines: { select: { debit: true } } },
    });
    if (!journalEntry) {
      return null;
    }
    return {
      id: journalEntry.id,
      journalNumber: journalEntry.journalNumber,
      status: journalEntry.status,
      totalAmount: roundCurrency(journalEntry.lines.reduce((sum, line) => sum + line.debit, 0)),
    };
  }

  /** Added Sprint 10 — looks up an already-recorded fulfilment by its idempotency
   *  key, outside any transaction (a plain read). `SalesFulfilmentService` uses this
   *  to short-circuit a retried request *before* running any business-rule pre-check
   *  (over-fulfilment, stock, order status) — those checks are only valid against a
   *  request that hasn't already been recorded, and a genuine retry's own prior
   *  effects (its own fulfilled quantity, its own order-status transition) would
   *  otherwise cause those same pre-checks to reject the very call that should
   *  idempotently succeed. See `create()`'s own identical check-then-return inside
   *  its transaction, which this mirrors for the pre-transaction, service-level case. */
  async findByIdempotencyKey(
    organisationId: string,
    salesOrderId: string,
    idempotencyKey: string,
  ): Promise<{
    fulfilment: SalesFulfilmentWithItems;
    journalEntry: JournalEntrySummary | null;
  } | null> {
    const existing = await this.prisma.salesFulfilment.findUnique({
      where: {
        salesOrderId_idempotencyKey: { salesOrderId, idempotencyKey },
      },
      include: RELATIONS_INCLUDE,
    });
    if (!existing || existing.organisationId !== organisationId) {
      return null;
    }
    const journalEntry = await this.findJournalEntry(this.prisma, organisationId, existing.id);
    return { fulfilment: existing, journalEntry };
  }

  async create(data: FulfilSalesOrderData): Promise<FulfilSalesOrderResult> {
    return this.prisma.$transaction(async (tx) => {
      if (data.idempotencyKey) {
        const existing = await tx.salesFulfilment.findUnique({
          where: {
            salesOrderId_idempotencyKey: {
              salesOrderId: data.salesOrderId,
              idempotencyKey: data.idempotencyKey,
            },
          },
          include: RELATIONS_INCLUDE,
        });
        if (existing) {
          const order = await tx.salesOrder.findUniqueOrThrow({
            where: { id: data.salesOrderId },
            include: ORDER_RELATIONS_INCLUDE,
          });
          const journalEntry = await this.findJournalEntry(tx, data.organisationId, existing.id);
          return { fulfilment: existing, order, journalEntry, wasCreated: false };
        }
      }

      const eligibleOrder = await tx.salesOrder.findFirst({
        where: {
          id: data.salesOrderId,
          organisationId: data.organisationId,
          status: { in: [SalesOrderStatus.CONFIRMED, SalesOrderStatus.PARTIALLY_FULFILLED] },
        },
        select: { id: true },
      });
      if (!eligibleOrder) {
        throw new SalesFulfilmentConflictError('Sales order is not eligible for fulfilment');
      }

      // Sprint 10 — cost is read here, at the moment of consumption, not passed in
      // by the caller: two fulfilments at two different times can legitimately value
      // the same finished-good differently if stock was replenished (via Production
      // Completion or a Goods Receipt) at a different cost in between — the correct,
      // standard behaviour of a moving weighted average, not a bug to special-case.
      let totalCogsValue = 0;
      const itemCosts = new Map<string, { unitCost: number; costAmount: number }>();

      for (const item of data.items) {
        const existingStock = await tx.inventoryStock.findUnique({
          where: {
            organisationId_productId_locationId: {
              organisationId: data.organisationId,
              productId: item.productId,
              locationId: data.locationId,
            },
          },
        });
        const currentQuantity = existingStock?.quantityOnHand ?? 0;
        const newQuantity = roundQuantity(currentQuantity - item.quantity);
        if (newQuantity < 0) {
          throw new InsufficientStockError(
            `Insufficient stock for product ${item.productId} (available: ${currentQuantity}, requested: ${item.quantity})`,
          );
        }
        const unitCost = existingStock?.averageUnitCost ?? 0;
        const costAmount = roundCurrency(item.quantity * unitCost);
        // Running rounded sum, not a single round of the raw grand total at the
        // end — guarantees the sum of every item's own costAmount always equals
        // exactly the journal's posted total, with no rounding-drift gap.
        totalCogsValue = roundCurrency(totalCogsValue + costAmount);
        itemCosts.set(item.productId, { unitCost, costAmount });
        await tx.inventoryStock.upsert({
          where: {
            organisationId_productId_locationId: {
              organisationId: data.organisationId,
              productId: item.productId,
              locationId: data.locationId,
            },
          },
          create: {
            organisationId: data.organisationId,
            productId: item.productId,
            locationId: data.locationId,
            quantityOnHand: newQuantity,
          },
          update: { quantityOnHand: newQuantity },
        });
      }

      const fulfilment = await tx.salesFulfilment.create({
        data: {
          organisationId: data.organisationId,
          salesOrderId: data.salesOrderId,
          locationId: data.locationId,
          fulfilmentDate: data.fulfilmentDate,
          fulfilledById: data.fulfilledById,
          notes: data.notes,
          idempotencyKey: data.idempotencyKey,
          items: {
            create: data.items.map((item) => {
              const cost = itemCosts.get(item.productId)!;
              return {
                productId: item.productId,
                salesOrderItemId: item.salesOrderItemId,
                quantityFulfilled: item.quantity,
                unitCost: cost.unitCost,
                costAmount: cost.costAmount,
              };
            }),
          },
        },
        include: RELATIONS_INCLUDE,
      });

      await tx.inventoryTransaction.createMany({
        data: data.items.map((item) => ({
          organisationId: data.organisationId,
          productId: item.productId,
          locationId: data.locationId,
          transactionType: InventoryTransactionType.ISSUE,
          quantity: item.quantity,
          referenceType: 'SalesFulfilment',
          referenceId: fulfilment.id,
        })),
      });

      for (const item of data.items) {
        await tx.salesOrderItem.update({
          where: { id: item.salesOrderItemId },
          data: { quantityFulfilled: { increment: item.quantity } },
        });
      }

      const updatedItems = await tx.salesOrderItem.findMany({
        where: { salesOrderId: data.salesOrderId },
      });
      const totalOrdered = updatedItems.reduce((sum, item) => sum + item.quantity, 0);
      const totalFulfilled = updatedItems.reduce((sum, item) => sum + item.quantityFulfilled, 0);
      const newStatus =
        totalFulfilled >= totalOrdered
          ? SalesOrderStatus.FULFILLED
          : SalesOrderStatus.PARTIALLY_FULFILLED;

      const order = await tx.salesOrder.update({
        where: { id: data.salesOrderId },
        data: { status: newStatus, updatedById: data.fulfilledById },
        include: ORDER_RELATIONS_INCLUDE,
      });

      // Accounting posting (Sprint 10, docs/domains/accounting.md "Sales Fulfilment
      // Accounting") — shares this same transaction, so it either succeeds together
      // with everything above or rolls back together with it. Skipped entirely (no
      // journal, not a zero-amount one) when every fulfilled item had a `0` average
      // cost — finished-goods stock built entirely from un-costed Adjustments, a
      // real but rare edge case, not silently misrepresented as a real transaction.
      let journalEntry: JournalEntrySummary | null = null;
      if (totalCogsValue > 0) {
        const posted = await postSystemJournalEntry(tx, {
          organisationId: data.organisationId,
          date: data.fulfilmentDate,
          description: `Sales fulfilment ${fulfilment.id} — Sales Order ${data.salesOrderNumber}`,
          reference: data.salesOrderNumber,
          sourceType: 'SALES_FULFILMENT',
          sourceId: fulfilment.id,
          actorUserId: data.fulfilledById,
          lines: [
            { systemKey: SYSTEM_ACCOUNT_KEYS.COGS, debit: totalCogsValue },
            { systemKey: SYSTEM_ACCOUNT_KEYS.FINISHED_GOODS_INVENTORY, credit: totalCogsValue },
          ],
        });
        journalEntry = {
          id: posted.journalEntry.id,
          journalNumber: posted.journalEntry.journalNumber,
          status: posted.journalEntry.status,
          totalAmount: totalCogsValue,
        };
      }

      return { fulfilment, order, journalEntry, wasCreated: true };
    });
  }

  findManyBySalesOrder(
    organisationId: string,
    salesOrderId: string,
  ): Promise<SalesFulfilmentWithItems[]> {
    return this.prisma.salesFulfilment.findMany({
      where: { organisationId, salesOrderId },
      include: RELATIONS_INCLUDE,
      orderBy: { fulfilmentDate: 'desc' },
    });
  }

  /** Added Sprint 10 — batch lookup of every Journal Entry posted for a list of
   *  Sales Fulfilments, one query rather than N — mirrors
   *  `ProductionMaterialIssueRepository.findJournalEntriesByProductionOrder`'s exact
   *  shape. Used by the controller to attach each fulfilment's own `journalEntry` to
   *  the `GET :id/fulfilments` response without a second round trip per row. */
  async findJournalEntriesForFulfilments(
    organisationId: string,
    fulfilmentIds: string[],
  ): Promise<Map<string, JournalEntrySummary>> {
    if (fulfilmentIds.length === 0) {
      return new Map();
    }
    const journalEntries = await this.prisma.journalEntry.findMany({
      where: {
        organisationId,
        sourceType: 'SALES_FULFILMENT',
        sourceId: { in: fulfilmentIds },
      },
      include: { lines: { select: { debit: true } } },
    });
    return new Map(
      journalEntries.map((journalEntry) => [
        journalEntry.sourceId!,
        {
          id: journalEntry.id,
          journalNumber: journalEntry.journalNumber,
          status: journalEntry.status,
          totalAmount: roundCurrency(journalEntry.lines.reduce((sum, line) => sum + line.debit, 0)),
        },
      ]),
    );
  }

  /** Single-fulfilment lookup with its parent order's identity fields (Sprint 5) — used
   *  read-only by `DistributionModule` via `SalesModule`'s export, to resolve a
   *  Dispatch's destination and to compute per-line dispatch availability. */
  findById(organisationId: string, id: string): Promise<SalesFulfilmentWithOrder | null> {
    return this.prisma.salesFulfilment.findFirst({
      where: { id, organisationId },
      include: {
        ...RELATIONS_INCLUDE,
        salesOrder: { select: { id: true, customerId: true, outletId: true } },
      },
    });
  }

  /** Per-product COGS breakdown for a date range (Sprint 13, docs/domains/
   *  accounting.md §16.4) — sums `SalesFulfilmentItem.costAmount`, the exact,
   *  already-posted per-line contribution to each fulfilment's `DR COGS` journal
   *  (see that field's own doc comment). Read-only, exported via `SalesModule` for
   *  Finance's `RevenueCogsService` to call — the org-wide/date-ranged **total**
   *  COGS figure a P&L reconciles against always comes from `JournalEntryLine`
   *  instead (ties exactly to the GL); this by-product view is a supplementary
   *  drill-down, never a second source of truth for that headline number. */
  async getCogsBreakdownByProduct(
    organisationId: string,
    params: { from?: Date; to?: Date } = {},
  ): Promise<{ productId: string; totalCogs: number }[]> {
    const grouped = await this.prisma.salesFulfilmentItem.groupBy({
      by: ['productId'],
      where: {
        salesFulfilment: {
          organisationId,
          ...(params.from || params.to
            ? {
                fulfilmentDate: {
                  ...(params.from ? { gte: params.from } : {}),
                  ...(params.to ? { lte: params.to } : {}),
                },
              }
            : {}),
        },
      },
      _sum: { costAmount: true },
    });
    return grouped.map((group) => ({
      productId: group.productId,
      totalCogs: roundCurrency(group._sum.costAmount ?? 0),
    }));
  }
}

/** Rounds to 6 decimal places purely to clear floating-point noise — same convention as
 *  `InventoryStockRepository.adjustStock`'s own rounding helper. */
function roundQuantity(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

/** Rounds to 2 decimal places (currency) — same convention as every other file's own
 *  local `roundCurrency` helper in this codebase (e.g.
 *  `production-material-issue.repository.ts`). */
function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}
