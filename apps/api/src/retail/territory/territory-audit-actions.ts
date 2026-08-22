/**
 * Audit action strings for `Territory` (Sprint 4.8, docs/domains/territories.md). Same
 * `<entity>.<event>` naming convention as every other domain's `*_AUDIT_ACTIONS`.
 */
export const TERRITORY_AUDIT_ACTIONS = {
  CREATED: 'territory.created',
  UPDATED: 'territory.updated',
  ACTIVATED: 'territory.activated',
  DEACTIVATED: 'territory.deactivated',
} as const;
