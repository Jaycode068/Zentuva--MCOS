import { Injectable } from '@nestjs/common';
import {
  InventoryTransactionType,
  JournalEntryStatus,
  Prisma,
  ProductionMaterialIssue,
  ProductionOrderStatus,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { SYSTEM_ACCOUNT_KEYS } from '../finance/accounting/chart-of-account-keys';
import { postSystemJournalEntry } from '../finance/accounting/journal-posting';

const PRODUCT_SELECT = { id: true, code: true, name: true, unit: true };

export type ProductionMaterialIssueWithItems = ProductionMaterialIssue & {
  items: {
    id: string;
    componentProductId: string;
    quantityIssued: number;
    componentProduct: { id: string; code: string; name: string; unit: string };
  }[];
};

const RELATIONS_INCLUDE = {
  items: { include: { componentProduct: { select: PRODUCT_SELECT } } },
};

export interface IssueMaterialItemData {
  componentProductId: string;
  quantity: number;
}

export interface IssueMaterialData {
  organisationId: string;
  productionOrderId: string;
  /** The order's own `locationId`, resolved by `ProductionOrderService` — every
   *  component in one issue batch is consumed from the same location as the order
   *  itself. */
  locationId: string;
  /** Added Sprint 9 — used only in the Journal Entry's `description`; cheap to pass
   *  since the caller already has it, avoids a second in-transaction read. */
  productionOrderNumber: string;
  issuedDate: Date;
  issuedById: string;
  notes?: string;
  /** Added Sprint 9 — same double-submit protection `GoodsReceipt` already has.
   *  Optional: a caller that omits it gets no dedup protection, same convention as
   *  `GoodsReceiptRepository.receive`. */
  idempotencyKey?: string;
  items: IssueMaterialItemData[];
}

/** Minimal Journal Entry summary surfaced on the material-issue response, same shape
 *  as `GoodsReceiptRepository`'s `JournalEntrySummary`. `totalAmount` is the
 *  posting's total debit (== total credit, by construction). */
export interface JournalEntrySummary {
  id: string;
  journalNumber: string;
  status: JournalEntryStatus;
  totalAmount: number;
}

export interface IssueMaterialResult {
  materialIssue: ProductionMaterialIssueWithItems;
  /** Whether this call is what moved the order from `PLANNED` to `IN_PROGRESS` — drives
   *  the conditional `production.order.started` audit event. `false` when the order was
   *  already `IN_PROGRESS` (a later, partial issue), and `false` on an idempotent
   *  replay (nothing transitioned — the original call already did). */
  transitionedToInProgress: boolean;
  /** Added Sprint 9 — the automatically-posted Journal Entry for this issue's
   *  material value (`DR WIP / CR Inventory`), `null` only when every issued
   *  component had a `0` average cost (stock built entirely from un-costed
   *  Adjustments — see docs/domains/accounting.md "Production Accounting"). */
  journalEntry: JournalEntrySummary | null;
  /** Added Sprint 9 — `true` only on a fresh issue, `false` on an idempotent replay. */
  wasCreated: boolean;
}

/** Thrown when a component's current `quantityOnHand` at the issue location can't cover
 *  the requested issue quantity. Its own `Error` subclass (not `BadRequestException`)
 *  because this file has no Nest HTTP context — same "repository stays
 *  framework-agnostic, service throws HTTP exceptions" convention as
 *  `InventoryStockRepository`'s `NegativeStockError`. */
export class InsufficientStockError extends Error {}

/** Thrown when the Production Order isn't in `PLANNED`/`IN_PROGRESS` at the moment the
 *  transaction actually runs — re-checked here to close the race against a concurrent
 *  status change between `ProductionOrderService`'s pre-check and this transaction, same
 *  role as `GoodsReceiptConflictError`. */
export class ProductionMaterialIssueConflictError extends Error {}

/**
 * Thin Prisma access for the `ProductionMaterialIssue` aggregate (Sprint 4.6, extended
 * Sprint 9 with automatic accounting posting and idempotency, docs/domains/production.md).
 *
 * `issue()` runs the entire "consume raw materials against a Production Order" operation
 * inside a single `$transaction`: an idempotency check-then-return, a conditional
 * `updateMany` that both re-validates the order is still eligible and performs the
 * `PLANNED -> IN_PROGRESS` transition (idempotently, if already `IN_PROGRESS`) in one
 * call, then for each component reads the current `InventoryStock` balance *inside* the
 * transaction (not from a pre-check the caller already did — closing the race between
 * two concurrent issues a stale pre-check couldn't), decrements it, and appends a paired
 * `InventoryTransaction` `ISSUE` row. If any one component is short, the whole
 * transaction throws and every prior write in it rolls back — brief §13's "never
 * partially issue materials." Finally — new in Sprint 9 — posts a Journal Entry
 * (`DR WIP / CR Inventory`) for the batch's total material value, valued at each
 * component's *current* `InventoryStock.averageUnitCost` (read in the same loop that
 * already validates stock availability), sharing this same transaction so a closed
 * accounting period or missing system account rolls back the entire issue, quantity
 * movement included.
 *
 * Writing directly to `inventory_stock`/`inventory_transactions` here is a deliberate,
 * narrow exception to ADR-002's domain-ownership convention, made for atomicity — the
 * exact same rationale and shape as `GoodsReceiptRepository.receive`'s own
 * `purchaseOrder.updateMany` call into Procurement's table. `postSystemJournalEntry` is
 * the same narrow, documented exception applied to Finance's tables — a plain, non-DI
 * function import (not a NestJS module dependency), exactly the pattern
 * `GoodsReceiptRepository.receive` already established in Sprint 8. See
 * docs/domains/production.md "Integration Points".
 */
@Injectable()
export class ProductionMaterialIssueRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Looks up the Journal Entry (if any) posted for a given Material Issue, via the
   *  same polymorphic `sourceType`/`sourceId` `JournalEntry` design every system
   *  posting already uses — no FK exists (deliberately, see `journal-posting.ts`). */
  private async findJournalEntry(
    tx: Prisma.TransactionClient,
    organisationId: string,
    materialIssueId: string,
  ): Promise<JournalEntrySummary | null> {
    const journalEntry = await tx.journalEntry.findUnique({
      where: {
        organisationId_sourceType_sourceId: {
          organisationId,
          sourceType: 'PRODUCTION_MATERIAL_ISSUE',
          sourceId: materialIssueId,
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

  /** Added Sprint 9 — looks up an already-recorded issue by its idempotency key,
   *  outside any transaction (a plain read). Callers (`ProductionOrderService`) use
   *  this to short-circuit a retried request *before* running any business-rule
   *  pre-check (over-issue, stock, status) — those checks are only valid against a
   *  request that hasn't already been recorded, and a genuine retry's own prior
   *  effects (its own issued quantity, its own status transition) would otherwise
   *  cause those same pre-checks to reject the very call that should idempotently
   *  succeed. See `issue()`'s own identical check-then-return inside its
   *  transaction, which this mirrors for the pre-transaction, service-level case. */
  async findByIdempotencyKey(
    organisationId: string,
    productionOrderId: string,
    idempotencyKey: string,
  ): Promise<{
    materialIssue: ProductionMaterialIssueWithItems;
    journalEntry: JournalEntrySummary | null;
  } | null> {
    const existing = await this.prisma.productionMaterialIssue.findUnique({
      where: {
        productionOrderId_idempotencyKey: { productionOrderId, idempotencyKey },
      },
      include: RELATIONS_INCLUDE,
    });
    if (!existing || existing.organisationId !== organisationId) {
      return null;
    }
    const journalEntry = await this.findJournalEntry(this.prisma, organisationId, existing.id);
    return { materialIssue: existing, journalEntry };
  }

  async issue(data: IssueMaterialData): Promise<IssueMaterialResult> {
    return this.prisma.$transaction(async (tx) => {
      if (data.idempotencyKey) {
        const existing = await tx.productionMaterialIssue.findUnique({
          where: {
            productionOrderId_idempotencyKey: {
              productionOrderId: data.productionOrderId,
              idempotencyKey: data.idempotencyKey,
            },
          },
          include: RELATIONS_INCLUDE,
        });
        if (existing) {
          const journalEntry = await this.findJournalEntry(tx, data.organisationId, existing.id);
          return {
            materialIssue: existing,
            transitionedToInProgress: false,
            journalEntry,
            wasCreated: false,
          };
        }
      }

      const priorOrder = await tx.productionOrder.findUniqueOrThrow({
        where: { id: data.productionOrderId },
        select: { status: true },
      });

      const transition = await tx.productionOrder.updateMany({
        where: {
          id: data.productionOrderId,
          organisationId: data.organisationId,
          status: { in: [ProductionOrderStatus.PLANNED, ProductionOrderStatus.IN_PROGRESS] },
        },
        data: { status: ProductionOrderStatus.IN_PROGRESS, updatedById: data.issuedById },
      });
      if (transition.count === 0) {
        throw new ProductionMaterialIssueConflictError(
          'Production order is not eligible for material issue',
        );
      }

      let totalValue = 0;
      for (const item of data.items) {
        const existing = await tx.inventoryStock.findUnique({
          where: {
            organisationId_productId_locationId: {
              organisationId: data.organisationId,
              productId: item.componentProductId,
              locationId: data.locationId,
            },
          },
        });
        const currentQuantity = existing?.quantityOnHand ?? 0;
        const newQuantity = roundQuantity(currentQuantity - item.quantity);
        if (newQuantity < 0) {
          throw new InsufficientStockError(
            `Insufficient stock for component ${item.componentProductId} (available: ${currentQuantity}, requested: ${item.quantity})`,
          );
        }
        // Sprint 9 — the component's cost is read here, at the moment of
        // consumption, not passed in by the caller: three issues at three different
        // times can legitimately value the same component differently if stock was
        // replenished at a different price in between — the correct, standard
        // behaviour of a moving weighted average.
        totalValue += item.quantity * (existing?.averageUnitCost ?? 0);
        await tx.inventoryStock.upsert({
          where: {
            organisationId_productId_locationId: {
              organisationId: data.organisationId,
              productId: item.componentProductId,
              locationId: data.locationId,
            },
          },
          create: {
            organisationId: data.organisationId,
            productId: item.componentProductId,
            locationId: data.locationId,
            quantityOnHand: newQuantity,
          },
          update: { quantityOnHand: newQuantity },
        });
      }

      const materialIssue = await tx.productionMaterialIssue.create({
        data: {
          organisationId: data.organisationId,
          productionOrderId: data.productionOrderId,
          issuedDate: data.issuedDate,
          issuedById: data.issuedById,
          notes: data.notes,
          idempotencyKey: data.idempotencyKey,
          items: {
            create: data.items.map((item) => ({
              componentProductId: item.componentProductId,
              quantityIssued: item.quantity,
            })),
          },
        },
        include: RELATIONS_INCLUDE,
      });

      await tx.inventoryTransaction.createMany({
        data: data.items.map((item) => ({
          organisationId: data.organisationId,
          productId: item.componentProductId,
          locationId: data.locationId,
          transactionType: InventoryTransactionType.ISSUE,
          quantity: item.quantity,
          referenceType: 'ProductionMaterialIssue',
          referenceId: materialIssue.id,
        })),
      });

      // Accounting posting (Sprint 9, docs/domains/accounting.md "Production
      // Accounting") — shares this same transaction, so it either succeeds together
      // with everything above or rolls back together with it. Skipped entirely (no
      // journal, not a zero-amount one) when every issued component had a `0`
      // average cost — stock built entirely from un-costed Adjustments, a real but
      // rare edge case, not silently misrepresented as a real transaction.
      let journalEntry: JournalEntrySummary | null = null;
      const roundedTotalValue = roundCurrency(totalValue);
      if (roundedTotalValue > 0) {
        const posted = await postSystemJournalEntry(tx, {
          organisationId: data.organisationId,
          date: data.issuedDate,
          description: `Material issue ${materialIssue.id} — Production Order ${data.productionOrderNumber}`,
          reference: data.productionOrderNumber,
          sourceType: 'PRODUCTION_MATERIAL_ISSUE',
          sourceId: materialIssue.id,
          actorUserId: data.issuedById,
          lines: [
            { systemKey: SYSTEM_ACCOUNT_KEYS.WIP, debit: roundedTotalValue },
            { systemKey: SYSTEM_ACCOUNT_KEYS.INVENTORY, credit: roundedTotalValue },
          ],
        });
        journalEntry = {
          id: posted.journalEntry.id,
          journalNumber: posted.journalEntry.journalNumber,
          status: posted.journalEntry.status,
          totalAmount: roundedTotalValue,
        };
      }

      return {
        materialIssue,
        transitionedToInProgress: priorOrder.status !== ProductionOrderStatus.IN_PROGRESS,
        journalEntry,
        wasCreated: true,
      };
    });
  }

  /** Cumulative issued quantity per component, across every `ProductionMaterialIssue`
   *  ever recorded against this order — mirrors
   *  `GoodsReceiptRepository.getReceivingTotals`'s `groupBy` shape. */
  async getIssuedTotals(
    organisationId: string,
    productionOrderId: string,
  ): Promise<Map<string, number>> {
    const rows = await this.prisma.productionMaterialIssueItem.groupBy({
      by: ['componentProductId'],
      where: { productionMaterialIssue: { organisationId, productionOrderId } },
      _sum: { quantityIssued: true },
    });
    return new Map(rows.map((row) => [row.componentProductId, row._sum.quantityIssued ?? 0]));
  }

  findManyByProductionOrder(
    organisationId: string,
    productionOrderId: string,
  ): Promise<ProductionMaterialIssueWithItems[]> {
    return this.prisma.productionMaterialIssue.findMany({
      where: { organisationId, productionOrderId },
      include: RELATIONS_INCLUDE,
      orderBy: { issuedDate: 'desc' },
    });
  }

  /** Added Sprint 9 — the total value already posted to `WIP` across every Material
   *  Issue ever recorded against this Production Order, summed directly from the
   *  Journal Entry lines themselves (never recomputed from current, possibly
   *  since-changed `averageUnitCost` figures — the ledger is the source of truth for
   *  what was actually posted). Used by `ProductionOrderService.completeProduction`
   *  to determine how much value to clear out of WIP on completion. Returns `0` if
   *  no issue for this order ever posted a journal (e.g. every component had a `0`
   *  cost, or no material was ever issued). */
  async getTotalWipValue(organisationId: string, productionOrderId: string): Promise<number> {
    const issueIds = await this.prisma.productionMaterialIssue.findMany({
      where: { organisationId, productionOrderId },
      select: { id: true },
    });
    if (issueIds.length === 0) {
      return 0;
    }
    const lines = await this.prisma.journalEntryLine.findMany({
      where: {
        journalEntry: {
          organisationId,
          sourceType: 'PRODUCTION_MATERIAL_ISSUE',
          sourceId: { in: issueIds.map((row) => row.id) },
        },
        account: { systemKey: SYSTEM_ACCOUNT_KEYS.WIP },
      },
      select: { debit: true },
    });
    return roundCurrency(lines.reduce((sum, line) => sum + line.debit, 0));
  }

  /** Added Sprint 9 — every Journal Entry posted for a Material Issue against this
   *  Production Order, for the accounting-summary read path (brief §14/§15's
   *  traceability requirement) — see `ProductionOrderService.getAccountingSummary`. */
  async findJournalEntriesByProductionOrder(
    organisationId: string,
    productionOrderId: string,
  ): Promise<JournalEntrySummary[]> {
    const issueIds = await this.prisma.productionMaterialIssue.findMany({
      where: { organisationId, productionOrderId },
      select: { id: true },
    });
    if (issueIds.length === 0) {
      return [];
    }
    const journalEntries = await this.prisma.journalEntry.findMany({
      where: {
        organisationId,
        sourceType: 'PRODUCTION_MATERIAL_ISSUE',
        sourceId: { in: issueIds.map((row) => row.id) },
      },
      include: { lines: { select: { debit: true } } },
      orderBy: { journalNumber: 'asc' },
    });
    return journalEntries.map((journalEntry) => ({
      id: journalEntry.id,
      journalNumber: journalEntry.journalNumber,
      status: journalEntry.status,
      totalAmount: roundCurrency(journalEntry.lines.reduce((sum, line) => sum + line.debit, 0)),
    }));
  }
}

/** Rounds to 6 decimal places purely to clear floating-point noise — same convention as
 *  `InventoryStockRepository.adjustStock`'s own rounding helper. */
function roundQuantity(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

/** Same 2-decimal-place money rounding convention as every other file that computes
 *  currency values in this codebase (`journal-posting.ts`, `goods-receipt.repository.ts`). */
function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}
