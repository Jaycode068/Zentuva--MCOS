/**
 * Audit action strings for `Dispatch` and `Delivery` (Sprint 5, docs/domains/
 * distribution.md). Same `<entity>.<event>` naming convention as every other domain's
 * `*_AUDIT_ACTIONS`.
 */
export const DISTRIBUTION_AUDIT_ACTIONS = {
  DISPATCH_CREATED: 'dispatch.created',
  DISPATCH_DISPATCHED: 'dispatch.dispatched',
  DISPATCH_IN_TRANSIT: 'dispatch.in-transit',
  DISPATCH_CANCELLED: 'dispatch.cancelled',
  DISPATCH_FAILED: 'dispatch.failed',
  /** Covers both partial and full delivery events — metadata's `newStatus` field
   *  distinguishes them, same as `ORDER_FULFILLED` has no separate "reconfirmed"
   *  variant. */
  DELIVERY_RECORDED: 'dispatch.delivery-recorded',
  DELIVERY_PHOTO_UPLOADED: 'dispatch.delivery-photo-uploaded',
} as const;
