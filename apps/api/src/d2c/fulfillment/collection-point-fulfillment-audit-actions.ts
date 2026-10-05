/**
 * Audit action strings for `CollectionPointFulfillment` (Sprint 37,
 * docs/domains/d2c.md). Same `<entity>.<event>` naming convention as every
 * other domain's `*_AUDIT_ACTIONS` map.
 */
export const COLLECTION_POINT_FULFILLMENT_AUDIT_ACTIONS = {
  ASSIGNED: 'collection_point_fulfillment.assigned',
  ASSIGNMENT_FAILED_NO_ELIGIBLE_OUTLET: 'collection_point_fulfillment.assignment_failed',
  PREPARING_STARTED: 'collection_point_fulfillment.preparing_started',
  READY_FOR_COLLECTION: 'collection_point_fulfillment.ready_for_collection',
  COLLECTED: 'collection_point_fulfillment.collected',
  /** Added Sprint 39 — the admin-only reassignment override (docs/domains/d2c.md). */
  REASSIGNED: 'collection_point_fulfillment.reassigned',
} as const;
