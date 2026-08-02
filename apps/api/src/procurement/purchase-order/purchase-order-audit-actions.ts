/**
 * Audit action strings for Procurement (Sprint 4.3 brief: "Record: Purchase Order
 * Created, Purchase Order Updated, Purchase Order Cancelled"). Same `<entity>.<event>`
 * naming convention as `SUPPLIER_AUDIT_ACTIONS`/`PRODUCT_AUDIT_ACTIONS`.
 */
export const PURCHASE_ORDER_AUDIT_ACTIONS = {
  CREATED: 'purchase-order.created',
  UPDATED: 'purchase-order.updated',
  CANCELLED: 'purchase-order.cancelled',
} as const;
