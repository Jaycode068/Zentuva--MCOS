/**
 * Audit action strings for Sprint 12's Accounts Payable & Supplier Invoice Management
 * (docs/domains/finance.md "Accounts Payable") — `SupplierInvoice`, `SupplierPayment`,
 * `SupplierCreditNote`. Same `<entity>.<event>` naming convention as every other
 * domain's own `*_AUDIT_ACTIONS` file (e.g. `supplier-invoice.*`, not a generic
 * `finance.*` — see `INVENTORY_AUDIT_ACTIONS`'s own `JOURNAL_ENTRY_POSTED` doc
 * comment for why events stay namespaced under their originating business entity).
 */
export const ACCOUNTS_PAYABLE_AUDIT_ACTIONS = {
  SUPPLIER_INVOICE_CREATED: 'supplier-invoice.created',
  SUPPLIER_INVOICE_UPDATED: 'supplier-invoice.updated',
  /** Fired only when a fresh (non-idempotent-replay) `post()` actually ran. */
  SUPPLIER_INVOICE_POSTED: 'supplier-invoice.posted',
  /** Fired alongside `SUPPLIER_INVOICE_POSTED` only when the invoice has at least one
   *  Path B (no Goods Receipt reference) line and its journal entry actually posted. */
  SUPPLIER_INVOICE_JOURNAL_POSTED: 'supplier-invoice.journal-entry-posted',
  /** Fired alongside `SUPPLIER_INVOICE_POSTED` only when the freshly-computed
   *  `matchStatus` is `DISCREPANCY` — mirrors `payable-discrepancy.created`. */
  PAYABLE_DISCREPANCY_CREATED: 'payable-discrepancy.created',
  PAYABLE_DISCREPANCY_RESOLVED: 'payable-discrepancy.resolved',
  SUPPLIER_INVOICE_VOIDED: 'supplier-invoice.voided',
  SUPPLIER_PAYMENT_RECORDED: 'supplier-payment.recorded',
  SUPPLIER_PAYMENT_VOIDED: 'supplier-payment.voided',
  SUPPLIER_CREDIT_NOTE_CREATED: 'supplier-credit-note.created',
  SUPPLIER_CREDIT_NOTE_ISSUED: 'supplier-credit-note.issued',
  SUPPLIER_CREDIT_NOTE_VOIDED: 'supplier-credit-note.voided',
} as const;
