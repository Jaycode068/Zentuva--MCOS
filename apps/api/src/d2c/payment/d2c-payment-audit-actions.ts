/**
 * Audit action strings for D2C OPay payments (Sprint 35, docs/domains/d2c.md
 * "Finance Boundary"). Same `<entity>.<event>` naming convention as every
 * other domain's `*_AUDIT_ACTIONS` — reuses the existing `AuditService`,
 * never a parallel audit mechanism.
 */
export const D2C_PAYMENT_AUDIT_ACTIONS = {
  PAYMENT_INITIATED: 'd2c_payment.initiated',
  PAYMENT_SUCCEEDED: 'd2c_payment.succeeded',
  PAYMENT_RESOLVED: 'd2c_payment.resolved',
  CALLBACK_AMOUNT_MISMATCH: 'd2c_payment.callback_amount_mismatch',
} as const;
