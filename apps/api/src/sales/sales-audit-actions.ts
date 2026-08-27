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
  /** Added Sprint 11 (docs/domains/sales.md "Customer Returns") — the request step,
   *  no inventory/accounting effect yet. */
  RETURN_REQUESTED: 'sales.customer-return-requested',
  /** Fired only when a fresh (non-idempotent-replay) `receive()` actually ran —
   *  covers disposition + inventory movement, mirrors `ORDER_FULFILLED`'s own
   *  "wasCreated-gated" convention. */
  RETURN_RECEIVED: 'sales.customer-return-received',
  /** Fired alongside `RETURN_RECEIVED` only when a COGS-reversal Journal Entry was
   *  actually posted (non-zero resalable value) — mirrors `FULFILMENT_COGS_POSTED`. */
  RETURN_COGS_REVERSED: 'sales.customer-return-cogs-reversed',
  /** Fired alongside `RETURN_RECEIVED` only when a Credit Note was actually issued
   *  (non-zero credited amount). */
  RETURN_CREDIT_NOTE_ISSUED: 'sales.customer-return-credit-note-issued',
  RETURN_CANCELLED: 'sales.customer-return-cancelled',
  RETURN_PHOTO_UPLOADED: 'sales.customer-return-photo-uploaded',
} as const;
