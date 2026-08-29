import { AccountType, SupplierInvoiceMatchStatus } from '@prisma/client';

/**
 * Pure, DI-free formulas for Sprint 12's two invoice-line paths (docs/domains/
 * accounting.md "Supplier Invoice Matching") — shared by both the live UI preview
 * (`SupplierInvoiceService.previewMatch()`) and the immutable snapshot
 * `SupplierInvoiceRepository.post()` freezes onto each line/header. One formula, every
 * call site, never duplicated.
 *
 * **Path A** (line references a `GoodsReceiptItem`): Goods Receipt (Sprint 8) already
 * posted `DR Inventory / CR AP` (+ `CR GRNI_PENDING_APPROVAL` for any excess) for the
 * payable portion at receiving time. A matching invoice line needs no new journal — it
 * only reconciles against, and is capped by, what's still un-returned and
 * un-invoiced from that existing liability. `recognizedAmount` can therefore never
 * exceed what Goods Receipt already recognised: AP can never be silently inflated by
 * an invoice, by construction, not as a special case.
 *
 * **Path B** (line has no `GoodsReceiptItem`): there is no pre-existing liability, so
 * the line instead names an explicit `debitAccountId` from the Chart of Accounts and
 * is recognised in full — `computeLineMatch` is not involved; `validatePathBAccount`
 * is the only policy check, restricting the account to a non-system `ASSET`/`EXPENSE`
 * account so this stays a narrow AP-accounting capability, never an
 * arbitrary-posting/expense-management surface.
 */

const PATH_B_ALLOWED_ACCOUNT_TYPES: AccountType[] = [AccountType.ASSET, AccountType.EXPENSE];

/** Thrown when a Path B line's `debitAccountId` doesn't resolve, is a system account,
 *  or isn't an `ASSET`/`EXPENSE` account — never defaulted/guessed. */
export class InvalidDebitAccountError extends Error {}

export interface GoodsReceiptItemPayableSnapshot {
  payableQuantity: number;
  returnedQuantity: number;
  returnedExcessQuantity: number;
  invoicedQuantity: number;
}

export interface LineMatchResult {
  /** The capped, AP-eligible portion of this line's `lineTotal` — never more than
   *  what Goods Receipt already recognised as payable for the remaining quantity. */
  recognizedAmount: number;
  /** `lineTotal - recognizedAmount`, always >= 0. */
  varianceAmount: number;
  /** The quantity this line actually draws from the Goods Receipt line's remaining
   *  payable pool (`min(item quantity, remaining payable quantity)`) — what
   *  `GoodsReceiptItem.invoicedQuantity` should be incremented by. */
  invoicedQuantityDelta: number;
}

/** Decision #2 — the Path A cap. `remainingPayable` is the payable pool minus
 *  whatever Sprint 11 Returns already pulled out of the *payable* bucket specifically
 *  (`returnedQuantity - returnedExcessQuantity`), minus what prior invoices already
 *  claimed (`invoicedQuantity`) — never negative by construction, clamped defensively
 *  regardless. */
export function computeLineMatch(
  goodsReceiptItem: GoodsReceiptItemPayableSnapshot,
  purchaseOrderItemUnitPrice: number,
  item: { quantity: number; lineTotal: number },
): LineMatchResult {
  const remainingPayable = Math.max(
    0,
    roundQuantity(
      goodsReceiptItem.payableQuantity -
        (goodsReceiptItem.returnedQuantity - goodsReceiptItem.returnedExcessQuantity) -
        goodsReceiptItem.invoicedQuantity,
    ),
  );
  const remainingPayableValue = roundCurrency(remainingPayable * purchaseOrderItemUnitPrice);
  const recognizedAmount = roundCurrency(Math.min(item.lineTotal, remainingPayableValue));
  const varianceAmount = roundCurrency(item.lineTotal - recognizedAmount);
  const invoicedQuantityDelta = roundQuantity(Math.min(item.quantity, remainingPayable));
  return { recognizedAmount, varianceAmount, invoicedQuantityDelta };
}

/** Header `matchStatus` is computed from Path A lines only — Path B lines carry no
 *  match concept (a direct, explicit entry the user chose is never "unverified" or
 *  "in discrepancy"). */
export function computeHeaderMatchStatus(
  pathAVarianceAmounts: number[],
): SupplierInvoiceMatchStatus {
  if (pathAVarianceAmounts.length === 0) {
    return SupplierInvoiceMatchStatus.UNVERIFIED;
  }
  return pathAVarianceAmounts.some((variance) => roundCurrency(variance) > 0)
    ? SupplierInvoiceMatchStatus.DISCREPANCY
    : SupplierInvoiceMatchStatus.MATCHED;
}

/** Decision #3 — the Path B policy check. Never defaults/guesses an account; the
 *  caller must have already resolved `account` tenant-scoped (`null` means "not
 *  found for this organisation"). */
export function validatePathBAccount(
  account: { type: AccountType; isSystemAccount: boolean } | null,
): void {
  if (!account) {
    throw new InvalidDebitAccountError('The selected debit account was not found');
  }
  if (account.isSystemAccount) {
    throw new InvalidDebitAccountError(
      'Cannot post a supplier invoice line against a system-reserved account',
    );
  }
  if (!PATH_B_ALLOWED_ACCOUNT_TYPES.includes(account.type)) {
    throw new InvalidDebitAccountError(
      `Debit account must be an Asset or Expense account (got ${account.type})`,
    );
  }
}

/** Rounds to 6 decimal places purely to clear floating-point noise — same convention
 *  used throughout Inventory/Production/Sales. */
function roundQuantity(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

/** Rounds to 2 decimal places (currency) — same convention as every other file's own
 *  local `roundCurrency` helper in this codebase. */
function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}
