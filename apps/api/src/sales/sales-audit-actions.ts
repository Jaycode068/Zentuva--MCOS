/**
 * Audit action strings for `SalesOrder` (Sprint 4.8) and `SalesFulfilment` (Sprint 4.9),
 * docs/domains/sales.md. Same `<entity>.<event>` naming convention as every other
 * domain's `*_AUDIT_ACTIONS`.
 */
export const SALES_AUDIT_ACTIONS = {
  ORDER_CREATED: 'sales-order.created',
  ORDER_UPDATED: 'sales-order.updated',
  ORDER_CONFIRMED: 'sales-order.confirmed',
  ORDER_CANCELLED: 'sales-order.cancelled',
  /** Covers both partial and full fulfilment events — metadata's `newStatus` field
   *  distinguishes them, same as `ORDER_CONFIRMED` has no separate "reconfirmed"
   *  variant. */
  ORDER_FULFILLED: 'sales-order.fulfilled',
  /** Added Sprint 10 — fired only when a fresh (non-idempotent-replay) fulfilment
   *  actually posted a COGS Journal Entry (docs/domains/accounting.md "Sales
   *  Fulfilment Accounting"). Mirrors Production's
   *  `production.material-issue-journal-posted`/`.completion-journal-posted`
   *  pattern: a distinct audit action per new accounting event. */
  FULFILMENT_COGS_POSTED: 'sales.fulfilment-cogs-posted',
} as const;
