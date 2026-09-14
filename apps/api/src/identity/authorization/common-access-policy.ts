/**
 * Sprint 25 — Configurable Access Control (docs/domains/access-control.md §6). The
 * organisation-level policy for common employee self-service capabilities — sign-in/
 * out, viewing your own schedule/attendance, submitting a correction, viewing/
 * completing assigned training, viewing/acknowledging policies, viewing your own
 * profile.
 *
 * These are **not** granted simply because a user is an employee, and they are **not**
 * a `Role` (a role is an explicit administrative assignment — access-control.md §2.5;
 * common access applies to every active, linked employee uniformly, which is a
 * fundamentally different shape than "assign this bundle to specific users"). Instead
 * this is exactly one more `Organisation.settings` JSON sub-key, following the same
 * `mergeWorkspaceSettings`-style deep-merge convention `workspace-settings.ts`
 * established (Sprint 3.4) — a small, fixed set of booleans doesn't warrant a new
 * table, and every organisation created before this sprint already reads a defaulted,
 * complete object with no null-checks required.
 *
 * Checked by `CommonAccessGuard`/`@RequireCommonAccess(...)` on the specific HR
 * self-service endpoints this sprint wires it into (sign-in, sign-out, correction
 * request, policy self-acknowledge) — never a substitute for the module-level
 * `hr.attendance.self_*` permissions, which every employee's `Employee Self-Service`
 * role grants by default (access-control.md §6): a capability must be BOTH permitted by
 * the org-wide policy AND granted by the user's own permissions to be usable. Disabling
 * a capability here takes it away from literally everyone in the organisation
 * regardless of their individual role grants — the intended behaviour for an
 * organisation-wide policy switch.
 */
export interface CommonEmployeeAccessPolicy {
  selfSignIn: boolean;
  selfSignOut: boolean;
  viewOwnSchedule: boolean;
  viewOwnAttendance: boolean;
  submitAttendanceCorrection: boolean;
  viewAssignedTraining: boolean;
  completeAssignedTraining: boolean;
  viewApplicablePolicies: boolean;
  acknowledgePolicies: boolean;
  viewOwnProfile: boolean;
}

export const DEFAULT_COMMON_EMPLOYEE_ACCESS_POLICY: CommonEmployeeAccessPolicy = {
  selfSignIn: true,
  selfSignOut: true,
  viewOwnSchedule: true,
  viewOwnAttendance: true,
  submitAttendanceCorrection: true,
  viewAssignedTraining: true,
  completeAssignedTraining: true,
  viewApplicablePolicies: true,
  acknowledgePolicies: true,
  viewOwnProfile: true,
};

const SETTINGS_KEY = 'commonEmployeeAccess';

export function mergeCommonEmployeeAccessPolicy(stored: unknown): CommonEmployeeAccessPolicy {
  const storedObj = (stored && typeof stored === 'object' ? stored : {}) as Record<string, unknown>;
  const policy = (
    storedObj[SETTINGS_KEY] && typeof storedObj[SETTINGS_KEY] === 'object'
      ? storedObj[SETTINGS_KEY]
      : {}
  ) as Partial<CommonEmployeeAccessPolicy>;

  return { ...DEFAULT_COMMON_EMPLOYEE_ACCESS_POLICY, ...policy };
}

/** Read-modify-write helper mirroring `withLogoStorageKey`'s "preserve every other
 *  top-level settings key" pattern — never used with `updateWorkspaceSettings`'s
 *  (now-fixed) narrower merge. */
export function withCommonEmployeeAccessPolicy(
  stored: unknown,
  policy: CommonEmployeeAccessPolicy,
): Record<string, unknown> {
  const existing = (stored && typeof stored === 'object' ? stored : {}) as Record<string, unknown>;
  return { ...existing, [SETTINGS_KEY]: policy };
}
