/**
 * Audit action strings for the "My Account" surface (Sprint 3.3 brief §8). Session
 * revocation and logout reuse `AUTH_AUDIT_ACTIONS.SESSION_REVOKED`/`LOGOUT` (Sprint 1B.2)
 * rather than duplicating them here — a session being revoked is the same event whether
 * it's triggered from `/account/sessions` or the password-reset flow. Password reset
 * requested/completed likewise reuse `AUTH_AUDIT_ACTIONS.PASSWORD_RESET_REQUESTED`/
 * `PASSWORD_RESET`. Only the two events genuinely new to this sprint are defined here.
 */
export const ACCOUNT_AUDIT_ACTIONS = {
  PROFILE_UPDATED: 'account.profile.updated',
  PASSWORD_CHANGED: 'account.password.changed',
  AVATAR_UPLOADED: 'account.avatar.uploaded',
  AVATAR_REMOVED: 'account.avatar.removed',
} as const;
