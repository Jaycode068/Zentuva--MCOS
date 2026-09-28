/**
 * Audit action strings for `Consumer`/`ConsumerLocationRequest` (Sprint 32,
 * docs/domains/d2c.md). Same `<entity>.<event>` naming convention as every
 * other domain's `*_AUDIT_ACTIONS`.
 */
export const CONSUMER_AUDIT_ACTIONS = {
  REGISTERED: 'consumer.registered',
  PROFILE_UPDATED: 'consumer.profile_updated',
  LOCATION_UPDATED: 'consumer.location_updated',
  ACTIVATED: 'consumer.activated',
  SUSPENDED: 'consumer.suspended',
  DEACTIVATED: 'consumer.deactivated',
  LOCATION_REQUEST_CREATED: 'consumer.location_request_created',
  LOCATION_REQUEST_RESOLVED: 'consumer.location_request_resolved',
} as const;
