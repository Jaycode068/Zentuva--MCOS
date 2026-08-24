/**
 * First shared money-formatting helper in this codebase (Sprint 6) — Sales uses raw
 * `.toFixed(2)` (no currency symbol), Procurement has a module-local version hardcoded
 * to NGN. Finance records snapshot their own `currency` field per-transaction, so this
 * accepts it as a parameter rather than hardcoding one.
 */
export function formatCurrency(value: number, currency: string): string {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(value);
}
