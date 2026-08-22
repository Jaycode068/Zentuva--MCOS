/**
 * Audit action strings for `Outlet`/`OutletPhoto` (Sprint 4.8, docs/domains/outlets.md).
 * Same `<entity>.<event>` naming convention as every other domain's `*_AUDIT_ACTIONS` —
 * one file covering both entities in this module, same as `production-audit-actions.ts`
 * covering BOM+Order.
 */
export const OUTLET_AUDIT_ACTIONS = {
  CREATED: 'outlet.created',
  UPDATED: 'outlet.updated',
  ACTIVATED: 'outlet.activated',
  DEACTIVATED: 'outlet.deactivated',
  PHOTO_ADDED: 'outlet.photo_added',
  PHOTO_REMOVED: 'outlet.photo_removed',
} as const;
