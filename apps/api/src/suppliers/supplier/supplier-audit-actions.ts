/**
 * Audit action strings for Supplier Management (Sprint 4.2 brief: "Record: Supplier
 * Created, Supplier Updated, Supplier Activated, Supplier Deactivated"). Same
 * `<entity>.<event>` naming convention as `PRODUCT_AUDIT_ACTIONS`/`USER_AUDIT_ACTIONS`.
 */
export const SUPPLIER_AUDIT_ACTIONS = {
  CREATED: 'supplier.created',
  UPDATED: 'supplier.updated',
  ACTIVATED: 'supplier.activated',
  DEACTIVATED: 'supplier.deactivated',
} as const;
