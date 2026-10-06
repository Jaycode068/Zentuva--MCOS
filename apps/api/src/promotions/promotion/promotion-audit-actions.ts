/**
 * Audit action strings for `Promotion` (Sprint 40, docs/domains/d2c.md). Same
 * `<entity>.<event>` naming convention as every other domain's `*_AUDIT_ACTIONS` map.
 */
export const PROMOTION_AUDIT_ACTIONS = {
  CREATED: 'promotion.created',
  UPDATED: 'promotion.updated',
  ACTIVATED: 'promotion.activated',
  PAUSED: 'promotion.paused',
  RESUMED: 'promotion.resumed',
} as const;
