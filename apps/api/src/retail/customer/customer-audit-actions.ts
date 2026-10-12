/**
 * Audit action strings for `Customer` (Sprint 4.8, docs/domains/customers.md). Same
 * `<entity>.<event>` naming convention as every other domain's `*_AUDIT_ACTIONS`.
 */
export const CUSTOMER_AUDIT_ACTIONS = {
  CREATED: 'customer.created',
  UPDATED: 'customer.updated',
  ACTIVATED: 'customer.activated',
  DEACTIVATED: 'customer.deactivated',
  /** Added Phase 1 — Customer Account Management
   *  (docs/customer-account-inventory-audit.md §5.1/§7.1). */
  CREDIT_LIMIT_UPDATED: 'customer.credit_limit_updated',
} as const;
