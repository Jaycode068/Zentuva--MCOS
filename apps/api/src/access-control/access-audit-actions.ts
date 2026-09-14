/**
 * Sprint 25 — Configurable Access Control (docs/domains/access-control.md §14). The
 * `<entity>.<event>` naming convention every prior domain's own audit catalog uses
 * (`HR_AUDIT_ACTIONS`, `MAINTENANCE_AUDIT_ACTIONS`, ...).
 */
export const ACCESS_AUDIT_ACTIONS = {
  ROLE_CREATED: 'access.role.created',
  ROLE_UPDATED: 'access.role.updated',
  ROLE_ARCHIVED: 'access.role.archived',
  ROLE_RESTORED: 'access.role.restored',
  ROLE_DUPLICATED: 'access.role.duplicated',
  ROLE_PERMISSIONS_UPDATED: 'access.role.permissions_updated',
  USER_ROLE_ASSIGNED: 'access.user_role.assigned',
  USER_ROLE_REMOVED: 'access.user_role.removed',
  COMMON_POLICY_UPDATED: 'access.common_policy.updated',
} as const;
