/**
 * Audit action strings for `Invoice`, `Payment`, and `CreditNote` (Sprint 6, docs/domains/
 * finance.md). Same `<entity>.<event>` naming convention as every other domain's
 * `*_AUDIT_ACTIONS`.
 */
export const FINANCE_AUDIT_ACTIONS = {
  INVOICE_CREATED: 'invoice.created',
  INVOICE_ISSUED: 'invoice.issued',
  INVOICE_VOIDED: 'invoice.voided',
  PAYMENT_RECORDED: 'payment.recorded',
  PAYMENT_VOIDED: 'payment.voided',
  CREDIT_NOTE_CREATED: 'credit-note.created',
  CREDIT_NOTE_ISSUED: 'credit-note.issued',
  CREDIT_NOTE_VOIDED: 'credit-note.voided',
} as const;
