/**
 * Audit action strings for the Authentication Layer (Sprint 1B.2 brief §10). Most match
 * docs/domains/identity.md §8 exactly; four are new (marked below) — identity.md's audit
 * event table wasn't fully exhaustive, and implementing the events this sprint requires
 * revealed the gap. See docs/sprint-1B.2-completion-report.md "Deviations".
 */
export const AUTH_AUDIT_ACTIONS = {
  LOGIN_SUCCESS: 'auth.login.success',
  LOGIN_FAILURE: 'auth.login.failure',
  LOGOUT: 'auth.logout',
  /** New — "logout all devices" is one user action, distinct from a single-session logout. */
  LOGOUT_ALL: 'auth.logout_all',
  /** New — distinct from `PASSWORD_RESET` (the request vs. the completed change). */
  PASSWORD_RESET_REQUESTED: 'auth.password.reset_requested',
  PASSWORD_RESET: 'auth.password.reset',
  REFRESH_REUSE_DETECTED: 'auth.refresh.reuse_detected',
  INVITATION_ACCEPTED: 'invitation.accepted',
  /** New — account locking wasn't in identity.md's original event table. */
  ACCOUNT_LOCKED: 'user.locked',
  /** New — fired alongside a more specific event whenever a session is force-revoked
   *  outside a normal single-session logout (refresh-token reuse, password reset). */
  SESSION_REVOKED: 'auth.session.revoked',
} as const;
