/**
 * The set of `ChartOfAccount.systemKey` values this codebase knows about (Sprint 7,
 * docs/domains/accounting.md). Every account id this system ever needs is resolved by
 * looking up `(organisationId, systemKey)` — never hardcoded — so each tenant can use
 * whatever account codes/names they like as long as exactly one account per key is
 * marked as that system account.
 *
 * `AR`/`SALES_REVENUE`/`SALES_RETURNS`/`CASH`/`BANK` are the five keys Sprint 7's
 * Finance integration posts to. `INVENTORY`/`AP` are posted to starting Sprint 8
 * (Goods Receipt → Inventory/Accounts Payable, see `GoodsReceiptRepository.receive`).
 * `COGS` remains unposted — reserved for the documented future Production integration
 * (docs/domains/accounting.md "Future Integrations").
 *
 * `GRNI_PENDING_APPROVAL` (Sprint 8, docs/domains/accounting.md "Accepted vs.
 * Payable") is a distinct liability/clearing account for goods physically accepted
 * into inventory whose value exceeds what the Purchase Order's own ordered quantity
 * commercially covers — that excess is deliberately never posted to `AP`, which
 * represents only the commercially-agreed, PO-capped liability. A future AP/
 * three-way-matching module would move value out of `GRNI_PENDING_APPROVAL` into `AP`
 * once the excess is explicitly approved for payment.
 */
export const SYSTEM_ACCOUNT_KEYS = {
  AR: 'AR',
  SALES_REVENUE: 'SALES_REVENUE',
  SALES_RETURNS: 'SALES_RETURNS',
  CASH: 'CASH',
  BANK: 'BANK',
  INVENTORY: 'INVENTORY',
  COGS: 'COGS',
  AP: 'AP',
  GRNI_PENDING_APPROVAL: 'GRNI_PENDING_APPROVAL',
} as const;

export type SystemAccountKey = (typeof SYSTEM_ACCOUNT_KEYS)[keyof typeof SYSTEM_ACCOUNT_KEYS];
