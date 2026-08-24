/**
 * The set of `ChartOfAccount.systemKey` values this codebase knows about (Sprint 7,
 * docs/domains/accounting.md). Every account id this system ever needs is resolved by
 * looking up `(organisationId, systemKey)` — never hardcoded — so each tenant can use
 * whatever account codes/names they like as long as exactly one account per key is
 * marked as that system account.
 *
 * `AR`/`SALES_REVENUE`/`SALES_RETURNS`/`CASH`/`BANK` are the five keys Sprint 7's
 * Finance integration actually posts to. `INVENTORY`/`COGS`/`AP` are seeded now but
 * not yet posted to by any code — reserved for the documented future Procurement/
 * Production/Inventory integrations (docs/domains/accounting.md "Future
 * Integrations").
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
} as const;

export type SystemAccountKey = (typeof SYSTEM_ACCOUNT_KEYS)[keyof typeof SYSTEM_ACCOUNT_KEYS];
