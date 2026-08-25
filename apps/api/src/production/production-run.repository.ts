import { Injectable } from '@nestjs/common';
import {
  InventoryTransactionType,
  Prisma,
  ProductionOrderStatus,
  ProductionRejectionReason,
  ProductionRun,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { SYSTEM_ACCOUNT_KEYS } from '../finance/accounting/chart-of-account-keys';
import { postSystemJournalEntry } from '../finance/accounting/journal-posting';
import { JournalEntrySummary } from './production-material-issue.repository';

export interface CompleteProductionData {
  organisationId: string;
  productionOrderId: string;
  /** Used only in the Journal Entry's `description`; cheap to pass since the caller
   *  already has it. */
  productionOrderNumber: string;
  /** The order's own finished `productId`/`locationId` — resolved by
   *  `ProductionOrderService`, not re-derived here. */
  productId: string;
  locationId: string;
  producedQuantity: number;
  rejectedQuantity: number;
  /** Computed by `ProductionOrderService` as `producedQuantity - rejectedQuantity`
   *  before this method is ever called — never recomputed here, since this file has no
   *  business-rule responsibility, only atomic persistence. */
  acceptedQuantity: number;
  rejectionReason?: ProductionRejectionReason;
  rejectionNotes?: string;
  completedById: string;
  /** Added Sprint 9 — same double-submit protection every other multi-fire-risk
   *  write in this codebase has. Optional. */
  idempotencyKey?: string;
  /** Added Sprint 9 — the total value already posted to `WIP` across every Material
   *  Issue ever recorded against this order (see
   *  `ProductionMaterialIssueRepository.getTotalWipValue`), computed by
   *  `ProductionOrderService` before this method is called. The completion journal
   *  clears exactly this amount out of `WIP`. */
  totalWipValue: number;
}

export interface CompleteProductionResult {
  productionRun: ProductionRun;
  /** Added Sprint 9 — the automatically-posted Journal Entry clearing this order's
   *  accumulated WIP value into Finished Goods/Production Loss, `null` when
   *  `totalWipValue` is `0` (no material was ever issued with a known cost). */
  journalEntry: JournalEntrySummary | null;
  /** Added Sprint 9 — `true` only on a fresh completion, `false` on an idempotent
   *  replay. */
  wasCreated: boolean;
}

/** Thrown when the Production Order isn't `IN_PROGRESS` at the moment the transaction
 *  actually runs — same "re-check inside the transaction to close a concurrency race"
 *  role as `ProductionMaterialIssueConflictError`/`GoodsReceiptConflictError`. */
export class ProductionCompletionConflictError extends Error {}

/**
 * Thin Prisma access for the `ProductionRun` aggregate (Sprint 4.6, extended Sprint 9
 * with automatic accounting posting and idempotency, docs/domains/production.md).
 *
 * `complete()` runs the entire "finish a Production Order" operation inside one
 * `$transaction`: an idempotency check-then-return (see decision #8 in the Sprint 9
 * plan — `productionOrderId` is already `@@unique`, so a genuine retry is detected by
 * comparing the *existing* run's own stored `idempotencyKey`, not a separate composite
 * unique index), a conditional `updateMany` that re-validates the order is still
 * `IN_PROGRESS` and performs the `IN_PROGRESS -> COMPLETED` transition, then the
 * `ProductionRun` row is created, and — only when `acceptedQuantity > 0` — the finished
 * product's `InventoryStock` increases (now also updating `averageUnitCost`, Sprint 9)
 * and a paired `InventoryTransaction` `RECEIPT` row is appended, exact mirror of
 * `GoodsReceiptRepository.receive`'s "only the accepted portion of a receipt ever
 * upserts `InventoryStock`" rule. Finally — new in Sprint 9 — posts a Journal Entry
 * clearing the order's entire accumulated WIP value: to `FinishedGoodsInventory` for
 * the accepted share, to `ProductionLoss` for the rejected share, split proportionally
 * by `producedQuantity` (see docs/domains/accounting.md "Production Accounting" for the
 * costing assumption this makes explicit). Sharing this transaction means a closed
 * accounting period or missing system account rolls back the *entire* completion,
 * quantity movement included.
 */
@Injectable()
export class ProductionRunRepository {
  constructor(private readonly prisma: PrismaService) {}

  private async findJournalEntry(
    tx: Prisma.TransactionClient,
    organisationId: string,
    productionRunId: string,
  ): Promise<JournalEntrySummary | null> {
    const journalEntry = await tx.journalEntry.findUnique({
      where: {
        organisationId_sourceType_sourceId: {
          organisationId,
          sourceType: 'PRODUCTION_RUN',
          sourceId: productionRunId,
        },
      },
      include: { lines: { select: { debit: true, credit: true } } },
    });
    if (!journalEntry) {
      return null;
    }
    return {
      id: journalEntry.id,
      journalNumber: journalEntry.journalNumber,
      status: journalEntry.status,
      totalAmount: roundCurrency(journalEntry.lines.reduce((sum, line) => sum + line.credit, 0)),
    };
  }

  /** Added Sprint 9 — looks up an already-recorded run by its idempotency key,
   *  outside any transaction (a plain read). `ProductionOrderService` uses this to
   *  short-circuit a retried request *before* checking `order.status ===
   *  IN_PROGRESS` — a genuine retry arrives after the original call already flipped
   *  the order to `COMPLETED`, so that status check would otherwise reject the very
   *  call that should idempotently succeed. Mirrors `complete()`'s own identical
   *  check-then-return inside its transaction, for the pre-transaction, service-level
   *  case. */
  async findByIdempotencyKey(
    organisationId: string,
    productionOrderId: string,
    idempotencyKey: string,
  ): Promise<{ productionRun: ProductionRun; journalEntry: JournalEntrySummary | null } | null> {
    const existing = await this.prisma.productionRun.findUnique({
      where: { productionOrderId },
    });
    if (
      !existing ||
      existing.organisationId !== organisationId ||
      existing.idempotencyKey !== idempotencyKey
    ) {
      return null;
    }
    const journalEntry = await this.findJournalEntry(this.prisma, organisationId, existing.id);
    return { productionRun: existing, journalEntry };
  }

  async complete(data: CompleteProductionData): Promise<CompleteProductionResult> {
    return this.prisma.$transaction(async (tx) => {
      if (data.idempotencyKey) {
        const existing = await tx.productionRun.findUnique({
          where: { productionOrderId: data.productionOrderId },
        });
        if (existing && existing.idempotencyKey === data.idempotencyKey) {
          const journalEntry = await this.findJournalEntry(tx, data.organisationId, existing.id);
          return { productionRun: existing, journalEntry, wasCreated: false };
        }
      }

      const transition = await tx.productionOrder.updateMany({
        where: {
          id: data.productionOrderId,
          organisationId: data.organisationId,
          status: ProductionOrderStatus.IN_PROGRESS,
        },
        data: { status: ProductionOrderStatus.COMPLETED, updatedById: data.completedById },
      });
      if (transition.count === 0) {
        throw new ProductionCompletionConflictError(
          'Production order is not eligible for completion',
        );
      }

      const productionRun = await tx.productionRun.create({
        data: {
          organisationId: data.organisationId,
          productionOrderId: data.productionOrderId,
          producedQuantity: data.producedQuantity,
          rejectedQuantity: data.rejectedQuantity,
          acceptedQuantity: data.acceptedQuantity,
          rejectionReason: data.rejectionReason,
          rejectionNotes: data.rejectionNotes,
          completedById: data.completedById,
          idempotencyKey: data.idempotencyKey,
        },
      });

      if (data.acceptedQuantity > 0) {
        // Sprint 9 — the finished product's own per-unit cost is the accepted
        // share's own portion of the total WIP value transferred, spread evenly
        // across every produced unit (accepted and rejected alike) — see decision
        // #6 in the Sprint 9 plan for the "proportional by produced quantity"
        // costing assumption this makes.
        const perUnitCost =
          data.producedQuantity > 0 ? data.totalWipValue / data.producedQuantity : 0;
        const existingStock = await tx.inventoryStock.findUnique({
          where: {
            organisationId_productId_locationId: {
              organisationId: data.organisationId,
              productId: data.productId,
              locationId: data.locationId,
            },
          },
        });
        const priorQuantity = existingStock?.quantityOnHand ?? 0;
        const priorCost = existingStock?.averageUnitCost ?? 0;
        const newQuantity = priorQuantity + data.acceptedQuantity;
        const newAverageCost =
          newQuantity > 0
            ? roundCurrency(
                (priorQuantity * priorCost + data.acceptedQuantity * perUnitCost) / newQuantity,
              )
            : 0;
        await tx.inventoryStock.upsert({
          where: {
            organisationId_productId_locationId: {
              organisationId: data.organisationId,
              productId: data.productId,
              locationId: data.locationId,
            },
          },
          create: {
            organisationId: data.organisationId,
            productId: data.productId,
            locationId: data.locationId,
            quantityOnHand: data.acceptedQuantity,
            averageUnitCost: newAverageCost,
          },
          update: { quantityOnHand: newQuantity, averageUnitCost: newAverageCost },
        });
        await tx.inventoryTransaction.create({
          data: {
            organisationId: data.organisationId,
            productId: data.productId,
            locationId: data.locationId,
            transactionType: InventoryTransactionType.RECEIPT,
            quantity: data.acceptedQuantity,
            referenceType: 'ProductionRun',
            referenceId: productionRun.id,
          },
        });
      }

      // Accounting posting (Sprint 9, docs/domains/accounting.md "Production
      // Accounting") — clears the order's entire accumulated WIP value, splitting
      // it into the accepted share (Finished Goods) and the rejected share
      // (Production Loss/Scrap), proportional to `producedQuantity`. Skipped
      // entirely when `totalWipValue` is `0` (no material was ever issued with a
      // known cost) — same "no zero-value journal" rule Material Issue follows.
      let journalEntry: JournalEntrySummary | null = null;
      const totalWipValue = roundCurrency(data.totalWipValue);
      if (totalWipValue > 0) {
        const acceptedValue =
          data.producedQuantity > 0
            ? roundCurrency((totalWipValue * data.acceptedQuantity) / data.producedQuantity)
            : 0;
        // Subtraction, not a second multiplication, so the two lines always sum to
        // exactly `totalWipValue` — no rounding-drift gap between the two shares.
        const rejectedValue = roundCurrency(totalWipValue - acceptedValue);

        const posted = await postSystemJournalEntry(tx, {
          organisationId: data.organisationId,
          date: productionRun.completedAt,
          description: `Production completion — Production Order ${data.productionOrderNumber}`,
          reference: data.productionOrderNumber,
          sourceType: 'PRODUCTION_RUN',
          sourceId: productionRun.id,
          actorUserId: data.completedById,
          lines: [
            { systemKey: SYSTEM_ACCOUNT_KEYS.WIP, credit: totalWipValue },
            ...(acceptedValue > 0
              ? [{ systemKey: SYSTEM_ACCOUNT_KEYS.FINISHED_GOODS_INVENTORY, debit: acceptedValue }]
              : []),
            ...(rejectedValue > 0
              ? [{ systemKey: SYSTEM_ACCOUNT_KEYS.PRODUCTION_LOSS, debit: rejectedValue }]
              : []),
          ],
        });
        journalEntry = {
          id: posted.journalEntry.id,
          journalNumber: posted.journalEntry.journalNumber,
          status: posted.journalEntry.status,
          totalAmount: totalWipValue,
        };
      }

      return { productionRun, journalEntry, wasCreated: true };
    });
  }

  findByProductionOrder(
    organisationId: string,
    productionOrderId: string,
  ): Promise<ProductionRun | null> {
    return this.prisma.productionRun.findFirst({ where: { organisationId, productionOrderId } });
  }

  /** Added Sprint 9 — the completion Journal Entry (if any) for this order's
   *  `ProductionRun`, for the accounting-summary read path. `null` both when no run
   *  exists yet and when a run exists but posted no journal (`totalWipValue` was
   *  `0`). */
  async findJournalEntryForOrder(
    organisationId: string,
    productionOrderId: string,
  ): Promise<JournalEntrySummary | null> {
    const run = await this.findByProductionOrder(organisationId, productionOrderId);
    if (!run) {
      return null;
    }
    return this.findJournalEntry(this.prisma, organisationId, run.id);
  }
}

/** Same 2-decimal-place money rounding convention as every other file that computes
 *  currency values in this codebase. */
function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}
