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
 * `WIP`/`FINISHED_GOODS_INVENTORY`/`PRODUCTION_LOSS` are posted to starting Sprint 9
 * (Material Issue/Production Completion, see
 * `ProductionMaterialIssueRepository.issue`/`ProductionRunRepository.complete`).
 * `COGS` is posted to starting Sprint 10 (Sales Fulfilment, `DR Cost of Goods Sold /
 * CR Finished Goods Inventory`, see `SalesFulfilmentRepository.create` and
 * docs/domains/accounting.md "Sales Fulfilment Accounting").
 *
 * `GRNI_PENDING_APPROVAL` (Sprint 8, docs/domains/accounting.md "Accepted vs.
 * Payable") is a distinct liability/clearing account for goods physically accepted
 * into inventory whose value exceeds what the Purchase Order's own ordered quantity
 * commercially covers — that excess is deliberately never posted to `AP`, which
 * represents only the commercially-agreed, PO-capped liability. A future AP/
 * three-way-matching module would move value out of `GRNI_PENDING_APPROVAL` into `AP`
 * once the excess is explicitly approved for payment.
 *
 * `WIP` (Sprint 9) holds the value of raw material issued into an in-progress
 * Production Order, cleared to `FINISHED_GOODS_INVENTORY`/`PRODUCTION_LOSS` on
 * completion. `FINISHED_GOODS_INVENTORY` elevates the Chart of Accounts row Sprint 7
 * already seeded ("1330 Finished Goods") to a real system account, distinct from the
 * general `INVENTORY` key raw materials/packaging/consumables share. `PRODUCTION_LOSS`
 * ("Production Loss / Scrap") carries the portion of a production run's material cost
 * attributable to rejected output — see docs/domains/accounting.md "Production
 * Accounting".
 *
 * `CASH_BANK_PARENT` (Sprint 14, docs/domains/cash-management.md) elevates the
 * already-seeded, previously-non-system "1100 Cash & Bank" row — the parent a new
 * `CashAccount` of type `OTHER_CASH_EQUIVALENT` provisions its own dedicated child
 * account under (`CASH`/`BANK`-typed cash accounts provision under the existing
 * `CASH`/`BANK` keys instead). `OPENING_BALANCE_EQUITY` elevates the already-seeded,
 * previously-non-system "3100 Owner's Capital" row — the credit side of a new
 * `CashAccount`'s opening-balance posting (`DR <its own CoA row> / CR
 * OPENING_BALANCE_EQUITY`), reusing the existing Equity concept rather than
 * inventing a parallel "Capital Contribution" mechanism.
 *
 * `INVENTORY_ADJUSTMENT` (Stage 4E.4D, docs/domains/accounting.md §16.7/§16.8) — the
 * offsetting leg for a manual Inventory Adjustment's value (`InventoryStockRepository.
 * adjustStock`), one `EXPENSE`-type account that nets both directions: debited for a
 * value-decreasing adjustment (loss), credited for a value-increasing one (gain), the
 * same way a real "Inventory Shrinkage/Adjustment" expense line nets in ordinary
 * small-business bookkeeping. Deliberately **not** `PRODUCTION_LOSS` — that key is
 * scoped to a Production Run's own rejected-output cost (a manufacturing yield
 * variance); folding unrelated manual-adjustment shrinkage/gain into it would pollute
 * that metric. The other leg of the same posting reuses the existing `INVENTORY`/
 * `FINISHED_GOODS_INVENTORY` keys, chosen dynamically by the adjusted product's own
 * type — the first call site that needs that choice made dynamically, since Goods
 * Receipt (`INVENTORY`, always) and Production Completion (`FINISHED_GOODS_INVENTORY`,
 * always) each only ever need one side of that choice.
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
  WIP: 'WIP',
  FINISHED_GOODS_INVENTORY: 'FINISHED_GOODS_INVENTORY',
  PRODUCTION_LOSS: 'PRODUCTION_LOSS',
  CASH_BANK_PARENT: 'CASH_BANK_PARENT',
  OPENING_BALANCE_EQUITY: 'OPENING_BALANCE_EQUITY',
  INVENTORY_ADJUSTMENT: 'INVENTORY_ADJUSTMENT',
} as const;

export type SystemAccountKey = (typeof SYSTEM_ACCOUNT_KEYS)[keyof typeof SYSTEM_ACCOUNT_KEYS];
