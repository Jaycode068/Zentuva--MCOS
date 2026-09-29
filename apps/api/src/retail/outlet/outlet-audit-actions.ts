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
  /** Sprint 36 — Collection Point capability (docs/domains/d2c.md). */
  COLLECTION_POINT_ENABLED: 'outlet.collection_point_enabled',
  COLLECTION_POINT_DISABLED: 'outlet.collection_point_disabled',
  COLLECTION_POINT_CONFIG_UPDATED: 'outlet.collection_point_configuration_updated',
} as const;
