import { Prisma } from '@prisma/client';

/**
 * Sprint 40 — Configurable Promotions, Loyalty, Rewards & Consumer Incentives
 * (docs/domains/d2c.md). A plain, transaction-scoped utility function — not an
 * `@Injectable()` service — taking `tx: Prisma.TransactionClient` directly, the exact
 * same shape `inventory-stock-concurrency.util.ts`'s `applyStockAdjustmentIfNonNegative`
 * (Sprint 37.1) and `postSystemJournalEntry(tx, ...)` already establish for a primitive
 * that MUST participate in the caller's own larger transaction.
 *
 * `LoyaltyAccount.balance` is a MAINTAINED running total — never itself the source of
 * truth (`LoyaltyLedgerEntry` is) — exactly like `InventoryStock.quantityOnHand`. This
 * function makes the database itself the authority on whether a debit would take the
 * balance negative, via a single conditional `UPDATE ... WHERE balance >= -delta`
 * statement for a negative delta — never a value read moments earlier in application
 * code. Under Postgres, concurrent `UPDATE`s to the same row serialize on the row's own
 * lock, closing the exact lost-update race Sprint 37.1 found and fixed in Inventory.
 */

/**
 * Applies a signed `delta` to a consumer's `LoyaltyAccount.balance` — positive (an EARN,
 * or a positive ADJUSTMENT) always succeeds and upserts the account into existence if
 * this is the consumer's first ever credit; negative (a debiting ADJUSTMENT) is guarded
 * by a conditional `WHERE balance >= -delta` and returns `null` rather than throwing,
 * including when no account exists at all (a debit against zero balance is definitionally
 * an attempt to go negative).
 *
 * Returns the resulting account's `id`/`balance` so the caller can build the paired
 * `LoyaltyLedgerEntry.balanceAfter` snapshot inside the SAME transaction — `null` only on
 * a rejected negative delta.
 *
 * MUST be called with the SAME transaction client the caller uses for its other writes
 * in the same operation (the `ConsumerRewardGrant`/`LoyaltyLedgerEntry` row) — this is
 * one statement inside a larger atomic unit, not a standalone operation with its own
 * transaction.
 */
export async function applyLoyaltyDelta(
  tx: Prisma.TransactionClient,
  organisationId: string,
  consumerId: string,
  delta: number,
): Promise<{ id: string; balance: number } | null> {
  if (delta >= 0) {
    return tx.loyaltyAccount.upsert({
      where: { consumerId },
      create: { organisationId, consumerId, balance: delta },
      update: { balance: { increment: delta } },
      select: { id: true, balance: true },
    });
  }
  const result = await tx.loyaltyAccount.updateMany({
    where: { organisationId, consumerId, balance: { gte: -delta } },
    data: { balance: { increment: delta } },
  });
  if (result.count === 0) {
    return null;
  }
  return tx.loyaltyAccount.findUniqueOrThrow({
    where: { consumerId },
    select: { id: true, balance: true },
  });
}

/**
 * A non-authoritative read of the current balance, used ONLY to build a helpful
 * "available: X, requested: Y" message after `applyLoyaltyDelta` already returned `null`
 * — the real decision was already made atomically by the database above; this value can
 * be stale by the time it's read and must never be used to decide anything.
 */
export async function getCurrentBalance(
  tx: Prisma.TransactionClient,
  consumerId: string,
): Promise<number> {
  const account = await tx.loyaltyAccount.findUnique({
    where: { consumerId },
    select: { balance: true },
  });
  return account?.balance ?? 0;
}
