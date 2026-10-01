import { Prisma } from '@prisma/client';

/**
 * Sprint 37.1 — Inventory Fulfillment Concurrency Integrity Hardening
 * (docs/domains/inventory.md "Concurrent Stock Mutation").
 *
 * A plain, transaction-scoped utility function — not an `@Injectable()` service —
 * taking `tx: Prisma.TransactionClient` directly, the exact same shape
 * `postSystemJournalEntry(tx, ...)` (`finance/accounting/journal-posting.ts`) already
 * establishes for a cross-domain operation that MUST participate in the caller's own
 * larger transaction rather than being called through an injected service (which would
 * open its own transaction and break atomicity with the caller's other writes). This is
 * a shared PRIMITIVE, never a domain boundary violation: each call site still owns its
 * own domain-specific error class/message (`InsufficientStockError` in Sales/Production/
 * Maintenance is deliberately three separate local classes, unchanged by this file) —
 * only the underlying atomic SQL pattern is shared.
 *
 * Replaces the `findUnique()` → calculate `newQuantity` in application code → `upsert`
 * with a precomputed absolute value pattern that five call sites across this codebase
 * shared (Sales Fulfilment, Supplier Return, Production Material Issue, Maintenance Part
 * Usage, and the general Inventory Adjustment). That pattern was empirically proven
 * (Sprint 37 live verification, docs/domains/d2c.md §78) to lose updates under genuine
 * concurrent decrements of the SAME `InventoryStock` row: two concurrent transactions
 * could both read the same `quantityOnHand`, both independently compute the "new"
 * value, and whichever committed last would silently overwrite the other's
 * already-applied decrement — recording more total consumption than actually left the
 * warehouse.
 *
 * The fix makes the database itself the authority on whether enough stock exists at the
 * moment of the write, via a single conditional `UPDATE ... WHERE quantityOnHand >= $x`
 * statement — never a value read moments earlier in application code. Under Postgres,
 * concurrent `UPDATE`s to the same row are serialized by the row's own lock: the second
 * transaction's `UPDATE` blocks until the first commits, then evaluates its own `WHERE`
 * clause against the now-current (post-first-commit) row — there is no window in which
 * both can succeed against a value one of them never actually saw.
 *
 * Three call sites (`CustomerReturnRepository`, `GoodsReceiptRepository`,
 * `ProductionRunRepository`) have a DIFFERENT shape — an INCREMENT that also
 * recomputes a moving weighted-average `averageUnitCost` from the prior quantity and
 * prior cost — and are NOT converted by this file. A plain conditional `increment`
 * cannot express "new weighted average = f(prior quantity, prior cost, incoming
 * quantity, incoming cost)" atomically the same way a guarded decrement can; that
 * requires its own carefully-designed single-statement fix (or an explicit row lock)
 * and deserves dedicated review rather than being folded into this hardening pass — see
 * docs/domains/inventory.md "Known Limitations" and the Sprint 37.1 completion report.
 */

export interface StockLocationRef {
  organisationId: string;
  productId: string;
  locationId: string;
}

/**
 * Atomically decrements `InventoryStock.quantityOnHand` by `quantity`, guarded by a
 * conditional `WHERE quantityOnHand >= quantity`. Returns `true` only when the
 * decrement was actually applied (exactly one row matched and was updated); `false`
 * when either no stock row exists for this `(organisationId, productId, locationId)`
 * triple, or the row exists but doesn't hold enough quantity. The caller is
 * responsible for throwing its own domain-specific error on `false` — this function
 * makes no assumption about which error class/message a given domain wants.
 *
 * MUST be called with the SAME transaction client the caller uses for its other
 * writes in the same operation (the fulfilment/return/issue record, the paired
 * `InventoryTransaction` row, any accounting posting) — this is one statement inside a
 * larger atomic unit, not a standalone operation with its own transaction.
 */
export async function decrementStockIfAvailable(
  tx: Prisma.TransactionClient,
  ref: StockLocationRef,
  quantity: number,
): Promise<boolean> {
  const result = await tx.inventoryStock.updateMany({
    where: {
      organisationId: ref.organisationId,
      productId: ref.productId,
      locationId: ref.locationId,
      quantityOnHand: { gte: quantity },
    },
    data: { quantityOnHand: { decrement: quantity } },
  });
  return result.count > 0;
}

/**
 * Applies a signed `delta` to `InventoryStock.quantityOnHand` — positive (increase) or
 * negative (decrease) — used by the general Inventory Adjustment path, which allows
 * both directions from a single input, unlike every other call site's pure decrement.
 * A positive delta is always safe (can never make quantity negative) and is applied
 * via `upsert` since no stock row may exist yet at this location. A negative delta is
 * guarded exactly like `decrementStockIfAvailable` above and returns `false` rather
 * than throwing — including when no stock row exists at all, since a negative
 * adjustment against zero stock is definitionally an attempt to go negative. Never
 * touches `averageUnitCost` — adjustments carry no cost recalculation, matching the
 * pre-existing behaviour this replaces exactly.
 */
export async function applyStockAdjustmentIfNonNegative(
  tx: Prisma.TransactionClient,
  ref: StockLocationRef,
  delta: number,
): Promise<boolean> {
  if (delta >= 0) {
    await tx.inventoryStock.upsert({
      where: {
        organisationId_productId_locationId: {
          organisationId: ref.organisationId,
          productId: ref.productId,
          locationId: ref.locationId,
        },
      },
      create: {
        organisationId: ref.organisationId,
        productId: ref.productId,
        locationId: ref.locationId,
        quantityOnHand: delta,
      },
      update: { quantityOnHand: { increment: delta } },
    });
    return true;
  }
  const result = await tx.inventoryStock.updateMany({
    where: {
      organisationId: ref.organisationId,
      productId: ref.productId,
      locationId: ref.locationId,
      quantityOnHand: { gte: -delta },
    },
    data: { quantityOnHand: { increment: delta } },
  });
  return result.count > 0;
}

/**
 * A non-authoritative read of the current `quantityOnHand`, used ONLY to build a
 * helpful "available: X, requested: Y" error message after
 * `decrementStockIfAvailable`/`applyStockAdjustmentIfNonNegative` already returned
 * `false` — the real decision was already made atomically by the database above; this
 * value can be stale by the time it's read (another transaction may commit between the
 * failed update and this read) and must never be used to decide anything, only to
 * describe what the caller saw.
 */
export async function getCurrentQuantityOnHand(
  tx: Prisma.TransactionClient,
  ref: StockLocationRef,
): Promise<number> {
  const stock = await tx.inventoryStock.findUnique({
    where: {
      organisationId_productId_locationId: {
        organisationId: ref.organisationId,
        productId: ref.productId,
        locationId: ref.locationId,
      },
    },
    select: { quantityOnHand: true },
  });
  return stock?.quantityOnHand ?? 0;
}

/**
 * A non-authoritative read of the current `averageUnitCost`, used for costing at the
 * moment of consumption (Sprint 10's own documented moving-weighted-average
 * behaviour — see each call site's own comment). Deliberately separate from the
 * quantity decrement above: `averageUnitCost` is never WRITTEN by any decrement/issue
 * path (only by the three increment-with-cost-recompute paths this file doesn't
 * touch), so reading it outside the atomic decrement does not reintroduce the
 * concurrency defect this file fixes — there is no write-write race on this field
 * during an issue/decrement, only a (pre-existing, accepted, documented) read-timing
 * variance in which exact moving-average snapshot a given fulfilment is costed at.
 */
export async function getCurrentAverageUnitCost(
  tx: Prisma.TransactionClient,
  ref: StockLocationRef,
): Promise<number> {
  const stock = await tx.inventoryStock.findUnique({
    where: {
      organisationId_productId_locationId: {
        organisationId: ref.organisationId,
        productId: ref.productId,
        locationId: ref.locationId,
      },
    },
    select: { averageUnitCost: true },
  });
  return stock?.averageUnitCost ?? 0;
}
