/**
 * Audit action strings for Workspace Configuration (Sprint 3.4). Distinct from
 * `ORGANISATION_AUDIT_ACTIONS.UPDATED` (Sprint 2.1, `/api/organisation/me`) — a workspace
 * settings change and a general-profile change are different surfaces even though both
 * ultimately touch the same `Organisation` row.
 */
export const WORKSPACE_AUDIT_ACTIONS = {
  UPDATED: 'workspace.settings.updated',
  LOGO_UPLOADED: 'workspace.logo.uploaded',
  LOGO_REMOVED: 'workspace.logo.removed',
} as const;
