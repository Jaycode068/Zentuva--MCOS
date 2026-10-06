/**
 * Audit action strings for `ConsumerRewardGrant` (Sprint 40, docs/domains/d2c.md). Same
 * `<entity>.<event>` naming convention as every other domain's `*_AUDIT_ACTIONS` map.
 * `GRANTED` is recorded with `actorUserId: null` for the normal, system-triggered path
 * (a qualifying D2C order confirming) — the same "null means no human actor" convention
 * `CollectionPointFulfillmentService.autoAssign()`'s own audit record already
 * establishes for an automatic, payment-webhook-triggered event.
 */
export const REWARD_GRANT_AUDIT_ACTIONS = {
  GRANTED: 'consumer_reward_grant.granted',
} as const;
