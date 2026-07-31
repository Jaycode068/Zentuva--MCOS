/**
 * Audit action strings for User Management (Sprint 2.2). `user.created` / `user.updated`
 * match docs/domains/identity.md §8's existing table exactly. `user.activated` /
 * `user.deactivated` are new — the brief asks for them as distinct events, more granular
 * than identity.md's single `user.status_changed` (see the Sprint 2.2 completion report
 * "Deviations" for the reconciliation).
 */
export const USER_AUDIT_ACTIONS = {
  CREATED: 'user.created',
  UPDATED: 'user.updated',
  ACTIVATED: 'user.activated',
  DEACTIVATED: 'user.deactivated',
} as const;
