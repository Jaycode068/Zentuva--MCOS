import { Injectable } from '@nestjs/common';
import {
  AdjustmentReason,
  InventoryStock,
  InventoryTransaction,
  InventoryTransactionType,
  Prisma,
  ProductStatus,
  ProductType,
  StockArrangement,
  StockOwnership,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { SYSTEM_ACCOUNT_KEYS } from '../finance/accounting/chart-of-account-keys';
import { postSystemJournalEntry } from '../finance/accounting/journal-posting';
import { applyStockAdjustmentIfNonNegative } from './inventory-stock-concurrency.util';

export interface ListInventoryStockParams {
  /** Simple case-insensitive substring match against the product's name or code (same
   *  convention as `ProductRepository.findManyByOrganisation`). */
  search?: string;
  productType?: ProductType;
  /** Added Sprint 4.5 brief §11 — filter by the Product Catalogue's own lifecycle
   *  status (Draft/Active/Archived), not this table's own status (it has none). */
  productStatus?: ProductStatus;
  /** Added Sprint 4.5 — narrow the summary to one physical location. */
  locationId?: string;
}

export type InventoryStockWithProduct = InventoryStock & {
  product: {
    id: string;
    code: string;
    name: string;
    type: ProductType;
    unit: string;
    status: ProductStatus;
  };
  location: { id: string; name: string };
};

const PRODUCT_SELECT = { id: true, code: true, name: true, type: true, unit: true, status: true };
const LOCATION_SELECT = { id: true, name: true };

export interface AdjustStockData {
  organisationId: string;
  productId: string;
  locationId: string;
  /** Signed delta to apply — positive increases `quantityOnHand`, negative decreases
   *  it. Never a new absolute balance (brief: "the system must NOT simply overwrite
   *  quantityOnHand"). */
  quantity: number;
  reason: AdjustmentReason;
  notes?: string;
  createdById: string;
  /** Added Stage 4E.4B — optional, client-supplied double-submit protection, same
   *  convention as `InventoryTransfer.idempotencyKey`/`SalesFulfilment.idempotencyKey`.
   *  Persisted on the resulting `InventoryTransaction` row (see that model's own doc
   *  comment for why adjustments carry it there rather than on a dedicated parent
   *  record). A caller that never sends one is never blocked. */
  idempotencyKey?: string;
}

export interface AdjustStockResult {
  stock: InventoryStockWithProduct;
  transaction: InventoryTransaction;
  /** Added Stage 4E.4B — `false` when this call resolved to an already-committed
   *  adjustment from a prior request with the same `idempotencyKey` (no stock was
   *  touched this call), same convention as `InventoryTransfer`'s `wasCreated`. Always
   *  `true` when no `idempotencyKey` was supplied. */
  wasCreated: boolean;
  /** Added Stage 4E.4D — the `JournalEntry.id` posted for this adjustment's value, or
   *  `null` when nothing was posted (zero-cost, `CUSTOMER`-owned stock — the
   *  organisation does not carry that stock as its own asset — or a conflicting-key
   *  rejection never reaches this point at all). See `adjustStock`'s own doc comment
   *  for the full posting rule. Always populated correctly on a retry too, read from
   *  the already-committed `JournalEntry`, never re-derived. */
  journalEntryId: string | null;
}

/** Added Stage 4E.4B — thrown when a request reuses an `idempotencyKey` that is already
 *  attached to a committed `InventoryTransaction` for this organisation, but the
 *  request's own `productId`/`locationId`/`quantity`/`reason` do not match that
 *  transaction's recorded values. A reused key is only ever a safe no-op retry when the
 *  two requests describe the SAME intended operation — a mismatch means the caller is
 *  either reusing a key across unrelated adjustments (a client bug) or the key
 *  collided, and either way silently returning the old result (or silently applying a
 *  second, different change under the same key) would be wrong. Rejected outright,
 *  mirroring `OpeningStockAlreadyRecordedError`'s "never merge, never overwrite"
 *  posture. */
export class AdjustmentIdempotencyKeyConflictError extends Error {}

/** Thrown when an adjustment would leave `quantityOnHand` negative (brief §8: "For MVP,
 *  do not allow an adjustment that would result in negative available/on-hand stock...
 *  Do not silently clamp it to zero"). Its own `Error` subclass (not
 *  `BadRequestException`) because this file has no Nest HTTP context — same
 *  "repository stays framework-agnostic, service throws HTTP exceptions" convention as
 *  `GoodsReceiptRepository`'s `GoodsReceiptConflictError`. */
export class NegativeStockError extends Error {}

/** Added Phase 2B — thrown when `recordOpeningStock` is called for a
 *  `(organisation, product, location)` that already has an `InventoryStock` row. The
 *  existence of a row IS the "this location's balance for this product is already
 *  confirmed" marker (brief §6: "Distinguish a confirmed opening balance from an
 *  unconfirmed location") — a second attempt is never merged into the existing
 *  balance, only rejected, which is also what makes a duplicate/retried submission
 *  safe without any separate `idempotencyKey` column (see `recordOpeningStock`'s own
 *  doc comment). */
export class OpeningStockAlreadyRecordedError extends Error {}

export interface RecordOpeningStockData {
  organisationId: string;
  productId: string;
  locationId: string;
  /** May be zero — a confirmed physical count of zero is a legitimate, deliberate
   *  reconciliation outcome, distinct from no count ever having been recorded. */
  quantity: number;
  ownership: StockOwnership;
  arrangement: StockArrangement;
  notes?: string;
  createdById: string;
}

/**
 * Thin Prisma access for the live `InventoryStock` balance (Sprint 4.4, extended Sprint
 * 4.5 for locations + controlled adjustments, docs/domains/inventory.md). Writes happen
 * in exactly two places: inside `GoodsReceiptRepository.receive`'s transaction
 * (receiving), and inside this file's own `adjustStock` transaction (corrections) — both
 * always paired with an `InventoryTransaction` row, per the brief's "Do NOT directly
 * mutate stock quantities without creating the corresponding transaction."
 */
@Injectable()
export class InventoryStockRepository {
  constructor(private readonly prisma: PrismaService) {}

  findManyByOrganisation(
    organisationId: string,
    params: ListInventoryStockParams = {},
  ): Promise<InventoryStockWithProduct[]> {
    return this.prisma.inventoryStock.findMany({
      where: {
        organisationId,
        ...(params.locationId ? { locationId: params.locationId } : {}),
        product: {
          ...(params.productType ? { type: params.productType } : {}),
          ...(params.productStatus ? { status: params.productStatus } : {}),
          ...(params.search
            ? {
                OR: [
                  { name: { contains: params.search, mode: 'insensitive' } },
                  { code: { contains: params.search, mode: 'insensitive' } },
                ],
              }
            : {}),
        },
      },
      include: { product: { select: PRODUCT_SELECT }, location: { select: LOCATION_SELECT } },
      orderBy: { updatedAt: 'desc' },
    });
  }

  /** Every `InventoryStock` row for this product, across every location — the caller
   *  (`InventoryService.getStockByProduct`) sums them into one aggregate view, since
   *  that endpoint predates locations and existing callers expect a single balance per
   *  product. */
  findManyByProduct(
    organisationId: string,
    productId: string,
  ): Promise<InventoryStockWithProduct[]> {
    return this.prisma.inventoryStock.findMany({
      where: { organisationId, productId },
      include: { product: { select: PRODUCT_SELECT }, location: { select: LOCATION_SELECT } },
    });
  }

  findByProductAndLocation(
    organisationId: string,
    productId: string,
    locationId: string,
  ): Promise<InventoryStockWithProduct | null> {
    return this.prisma.inventoryStock.findUnique({
      where: { organisationId_productId_locationId: { organisationId, productId, locationId } },
      include: { product: { select: PRODUCT_SELECT }, location: { select: LOCATION_SELECT } },
    });
  }

  /** Batch read for a Production Order's material-availability check and material-issue
   *  pre-validation (Sprint 4.6) — one query for every BOM component instead of N.
   *  Consumed by `ProductionOrderService` via `InventoryModule`'s exported repository. */
  findManyByProductsAndLocation(
    organisationId: string,
    productIds: string[],
    locationId: string,
  ): Promise<InventoryStockWithProduct[]> {
    return this.prisma.inventoryStock.findMany({
      where: { organisationId, locationId, productId: { in: productIds } },
      include: { product: { select: PRODUCT_SELECT }, location: { select: LOCATION_SELECT } },
    });
  }

  /** The one write path for stock corrections (brief §7 "Atomicity": validate stock →
   *  create `InventoryTransaction` → update `InventoryStock`, all inside one
   *  transaction, rolled back together on any failure). Reads the current balance
   *  *inside* the transaction (not from a pre-check the caller already did) so the
   *  negative-stock guard is evaluated against a fresh, transaction-scoped value —
   *  closing the race between two concurrent adjustments a pre-check alone couldn't.
   *
   *  Added Stage 4E.4B — idempotency when `data.idempotencyKey` is supplied. Two layers,
   *  same reasoning as `recordOpeningStock`'s own doc comment:
   *   1. A pre-check (`findUnique` on `(organisationId, idempotencyKey)` before opening
   *      the transaction) short-circuits the common case — a sequential retry after the
   *      first request already committed — without taking a row lock or touching stock
   *      at all.
   *   2. A `P2002` catch around the in-transaction `create()` is the actual safety net
   *      for two genuinely concurrent requests that both pass the pre-check (neither can
   *      see the other's not-yet-committed row): exactly one `create()` wins the unique
   *      constraint, the other's transaction aborts — rolling back ITS stock mutation —
   *      and that caller falls through to the same "resolve existing" path as a
   *      sequential retry. Net effect: however many identical concurrent requests
   *      arrive, stock moves exactly once.
   *  Either path validates the reused key's request against the already-committed
   *  transaction's own recorded values and throws `AdjustmentIdempotencyKeyConflictError`
   *  on any mismatch, rather than silently returning stale results for a different
   *  operation. */
  async adjustStock(data: AdjustStockData): Promise<AdjustStockResult> {
    const stockRef = {
      organisationId: data.organisationId,
      productId: data.productId,
      locationId: data.locationId,
    };

    if (data.idempotencyKey) {
      const existing = await this.prisma.inventoryTransaction.findUnique({
        where: {
          organisationId_idempotencyKey: {
            organisationId: data.organisationId,
            idempotencyKey: data.idempotencyKey,
          },
        },
      });
      if (existing) {
        return this.resolveExistingAdjustment(existing, data);
      }
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        // Sprint 37.1 — atomic conditional adjustment, the database's own row lock is
        // the concurrency guard (see `inventory-stock-concurrency.util.ts`). Replaces a
        // read-then-upsert-with-precomputed-value pattern that shared the exact defect
        // class live-verified in `SalesFulfilmentRepository.create()`
        // (docs/domains/d2c.md §78) — two concurrent negative adjustments against the
        // same row could previously both read the same balance and lose one decrement.
        const applied = await applyStockAdjustmentIfNonNegative(tx, stockRef, data.quantity);
        if (!applied) {
          const current = await tx.inventoryStock.findUnique({
            where: { organisationId_productId_locationId: stockRef },
            select: { quantityOnHand: true },
          });
          throw new NegativeStockError(
            `Adjustment would result in negative stock (current: ${current?.quantityOnHand ?? 0}, adjustment: ${data.quantity})`,
          );
        }

        const stock = await tx.inventoryStock.findUniqueOrThrow({
          where: { organisationId_productId_locationId: stockRef },
          include: { product: { select: PRODUCT_SELECT }, location: { select: LOCATION_SELECT } },
        });

        const transaction = await tx.inventoryTransaction.create({
          data: {
            organisationId: data.organisationId,
            productId: data.productId,
            locationId: data.locationId,
            transactionType: InventoryTransactionType.ADJUSTMENT,
            quantity: data.quantity,
            referenceType: 'ManualAdjustment',
            referenceId: null,
            adjustmentReason: data.reason,
            notes: data.notes,
            createdById: data.createdById,
            idempotencyKey: data.idempotencyKey,
          },
        });

        // Stage 4E.4D (docs/sprint-stage-4e4c-inventory-adjustment-accounting-policy.md)
        // — every adjustment reason is value-bearing by default; the only exemptions
        // are structural, never based on `data.reason`'s label: `CUSTOMER`-owned stock
        // (ownership already transferred — not this organisation's own asset) and a
        // zero cost (nothing to recognise, same "skip the journal entirely, never a
        // ₦0 one" precedent Production/Sales Fulfilment already established). `stock`
        // here is read AFTER `applyStockAdjustmentIfNonNegative` already locked this
        // row — `averageUnitCost` is never written by this method, so that lock
        // already serialises this read against any concurrent cost-changing writer;
        // no separate pre-mutation read is needed or safer.
        let journalEntryId: string | null = null;
        const value = roundCurrency(Math.abs(data.quantity) * stock.averageUnitCost);
        if (stock.ownership === StockOwnership.ORGANISATION && value > 0) {
          const inventorySystemKey =
            stock.product.type === ProductType.FINISHED_PRODUCT
              ? SYSTEM_ACCOUNT_KEYS.FINISHED_GOODS_INVENTORY
              : SYSTEM_ACCOUNT_KEYS.INVENTORY;
          // Positive quantity = a gain: DR Inventory / CR Inventory Adjustment.
          // Negative quantity = a loss: DR Inventory Adjustment / CR Inventory.
          // Linked to the canonical, idempotency-deduplicated `transaction.id` as
          // `sourceId` — `JournalEntry`'s own `@@unique([organisationId, sourceType,
          // sourceId])` then guarantees at most one journal per adjustment for free,
          // with no new idempotency mechanism of its own.
          const posted = await postSystemJournalEntry(tx, {
            organisationId: data.organisationId,
            date: transaction.createdAt,
            description: data.notes
              ? `Inventory adjustment (${data.reason}): ${data.notes}`
              : `Inventory adjustment (${data.reason})`,
            sourceType: 'INVENTORY_ADJUSTMENT',
            sourceId: transaction.id,
            actorUserId: data.createdById,
            lines:
              data.quantity > 0
                ? [
                    { systemKey: inventorySystemKey, debit: value },
                    { systemKey: SYSTEM_ACCOUNT_KEYS.INVENTORY_ADJUSTMENT, credit: value },
                  ]
                : [
                    { systemKey: SYSTEM_ACCOUNT_KEYS.INVENTORY_ADJUSTMENT, debit: value },
                    { systemKey: inventorySystemKey, credit: value },
                  ],
          });
          journalEntryId = posted.journalEntry.id;
        }

        return { stock, transaction, wasCreated: true, journalEntryId };
      });
    } catch (error) {
      if (
        data.idempotencyKey &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const winner = await this.prisma.inventoryTransaction.findUnique({
          where: {
            organisationId_idempotencyKey: {
              organisationId: data.organisationId,
              idempotencyKey: data.idempotencyKey,
            },
          },
        });
        if (winner) {
          return this.resolveExistingAdjustment(winner, data);
        }
      }
      throw error;
    }
  }

  /** Shared by both idempotency paths in `adjustStock` above — validates that a reused
   *  key's request describes the same intended operation as the already-committed
   *  transaction it maps to, then returns that transaction's result without touching
   *  stock again. */
  private async resolveExistingAdjustment(
    existing: InventoryTransaction,
    data: AdjustStockData,
  ): Promise<AdjustStockResult> {
    if (
      existing.productId !== data.productId ||
      existing.locationId !== data.locationId ||
      existing.quantity !== data.quantity ||
      existing.adjustmentReason !== data.reason
    ) {
      throw new AdjustmentIdempotencyKeyConflictError(
        'This idempotency key was already used for a different adjustment',
      );
    }

    const stock = await this.prisma.inventoryStock.findUniqueOrThrow({
      where: {
        organisationId_productId_locationId: {
          organisationId: data.organisationId,
          productId: data.productId,
          locationId: data.locationId,
        },
      },
      include: { product: { select: PRODUCT_SELECT }, location: { select: LOCATION_SELECT } },
    });

    // Stage 4E.4D — a retry never re-attempts journal posting (see `adjustStock`'s own
    // doc comment); it reads back whatever the ORIGINAL creating call already posted
    // (or correctly skipped), from the already-committed `JournalEntry`, keyed by the
    // same `(organisationId, sourceType, sourceId)` that call used.
    const journalEntry = await this.prisma.journalEntry.findUnique({
      where: {
        organisationId_sourceType_sourceId: {
          organisationId: data.organisationId,
          sourceType: 'INVENTORY_ADJUSTMENT',
          sourceId: existing.id,
        },
      },
      select: { id: true },
    });

    return {
      stock,
      transaction: existing,
      wasCreated: false,
      journalEntryId: journalEntry?.id ?? null,
    };
  }

  /**
   * Added Phase 2B (brief §6 "Opening Stock and Reconciliation") — establishes the
   * FIRST confirmed physical count of a product at a location. Deliberately a
   * dedicated method, not a widened `adjustStock`: an opening count is not a delta
   * against an existing balance, it IS the balance, and it carries `ownership`/
   * `arrangement` (which `adjustStock` has no reason to touch — see that method's own
   * "never touches averageUnitCost" rationale, now extended to these two fields).
   *
   * Idempotency/duplicate-prevention needs no new column: the attempted `create()`
   * either succeeds (no prior row existed — this really is the first count) or hits
   * `InventoryStock`'s own `@@unique([organisationId, productId, locationId])`
   * constraint, which this method catches and translates to
   * `OpeningStockAlreadyRecordedError` rather than silently merging into, or
   * overwriting, whatever balance already exists — the same "find-then-create-then-
   * recover-from-P2002" convention `SalesOrder.idempotencyKey`'s own schema comment
   * already documents elsewhere in this codebase, specialised here to a natural
   * uniqueness check instead of a client-supplied key.
   *
   * `averageUnitCost` is always recorded as `0` — there is no reliable cost basis for
   * a manual physical count (brief: "Do not fabricate... where reliable evidence is
   * missing"). This is a deliberate, conservative simplification: opening stock
   * recorded this way contributes nothing to inventory valuation until a later, COSTED
   * movement (e.g. a `Transfer` FROM a costed warehouse location) establishes a real
   * cost at that location — see the Phase 2B completion report's "Known Limitations".
   */
  async recordOpeningStock(data: RecordOpeningStockData): Promise<AdjustStockResult> {
    return this.prisma.$transaction(async (tx) => {
      let stock: InventoryStock;
      try {
        stock = await tx.inventoryStock.create({
          data: {
            organisationId: data.organisationId,
            productId: data.productId,
            locationId: data.locationId,
            quantityOnHand: data.quantity,
            averageUnitCost: 0,
            ownership: data.ownership,
            arrangement: data.arrangement,
          },
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new OpeningStockAlreadyRecordedError(
            'An opening balance has already been recorded for this product at this location',
          );
        }
        throw error;
      }

      const stockWithRelations = await tx.inventoryStock.findUniqueOrThrow({
        where: { id: stock.id },
        include: { product: { select: PRODUCT_SELECT }, location: { select: LOCATION_SELECT } },
      });

      const transaction = await tx.inventoryTransaction.create({
        data: {
          organisationId: data.organisationId,
          productId: data.productId,
          locationId: data.locationId,
          transactionType: InventoryTransactionType.ADJUSTMENT,
          quantity: data.quantity,
          referenceType: 'OpeningStock',
          referenceId: null,
          adjustmentReason: AdjustmentReason.PHYSICAL_COUNT,
          notes: data.notes,
          createdById: data.createdById,
        },
      });

      // Stage 4E.4D — opening-stock establishment never posts a journal, categorically,
      // regardless of cost: it is not a correction to an existing GL-relevant balance,
      // it is the first-ever establishment of one, and `averageUnitCost` is always `0`
      // here anyway (this method's own rule above), so this would never be value-
      // bearing even under `adjustStock`'s general rule.
      return { stock: stockWithRelations, transaction, wasCreated: true, journalEntryId: null };
    });
  }
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}
