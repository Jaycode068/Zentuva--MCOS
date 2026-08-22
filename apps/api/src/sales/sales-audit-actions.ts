/**
 * Audit action strings for `SalesOrder` (Sprint 4.8, docs/domains/sales.md). Same
 * `<entity>.<event>` naming convention as every other domain's `*_AUDIT_ACTIONS`.
 */
export const SALES_AUDIT_ACTIONS = {
  ORDER_CREATED: 'sales-order.created',
  ORDER_UPDATED: 'sales-order.updated',
  ORDER_CONFIRMED: 'sales-order.confirmed',
  ORDER_CANCELLED: 'sales-order.cancelled',
} as const;
