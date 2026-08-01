# Sprint 3.3 Completion Report — Account Management & Authentication Experience

**Date:** 2026-07-31
**Status:** Complete

## 1. Objective

Complete the end-user authentication experience by implementing password recovery,
first-time password change, account profile management, and session management — so
every user can securely manage their own account entirely from the browser without
administrator intervention, before operational domain modules begin. Explicit constraints
from the brief: reuse the existing Identity Domain, existing services, existing
repositories, existing JWT authentication, and the password-reset infrastructure built in
Sprint 1B.2; extend only where necessary; do not redesign or replace any authentication
already implemented.

## 2. Implementation Summary

### Backend — a new Account surface, built entirely on existing services

`apps/api/src/identity/account/` (`AccountController` + `AccountModule`) exposes
`GET`/`PATCH /api/account/profile`, `POST /api/account/change-password`, and
`GET`/`DELETE /api/account/sessions[/:id]`. Every route requires only authentication
(`JwtAuthGuard`, no `RolesGuard`) since every action is scoped to the caller's own
account. The controller injects `UserService`, `OrganisationService`, `AuthService`, and
`AuditService` — all already existing — and adds no new repository or direct Prisma
access, per the brief's reuse constraint. `AuthService` was exported from `AuthModule`
(it previously wasn't) so `AccountModule` could reuse it rather than duplicating
session/password orchestration.

Two new methods were added to `AuthService`, both following its existing pattern (verify
→ mutate → audit):

- **`changePassword`** verifies the current password, hashes and stores the new one, then
  revokes every _other_ active session for that user via a new
  `SessionRepository.revokeAllForUserExcept` (extends the existing `revokeAllForUser`
  rather than replacing it — reset-password still needs "revoke everything including the
  requester," which is a different, already-correct behaviour). The session making the
  request stays signed in.
- **`revokeSession`** checks that the session being revoked actually belongs to the
  calling user (loaded via the existing `SessionStore.findSessionById`, comparing
  `session.userId`) before revoking it — a `NotFoundException` either way (nonexistent id
  or someone else's session) so the response never confirms whose session a given id
  belongs to.

### Schema — three additive `User` columns, one migration

`phoneNumber` (optional profile field), `mustChangePassword` (`@default(false)`), and
`passwordChangedAt` (nullable) were added via
`migrations/20260731000000_add_user_account_management_fields`. `mustChangePassword` is
only ever set `true` in one place: `UserService.createUser` (Sprint 2.2's admin-creates-a-
user-with-a-temporary-password flow) — self-registration (Sprint 3.2) and invitation
acceptance both leave it at the schema default `false`, since in both of those flows the
user already chose their own password. `passwordChangedAt` is stamped by
`UserRepository.updatePasswordHash`, extended this sprint to also clear
`mustChangePassword` in the same write — this method is shared by both change-password
and reset-password, so both flows get the stamp/clear for free rather than repeating it at
each call site.

### First Login Password Change

`POST /api/auth/login`'s response now includes `mustChangePassword` on the user object.
The frontend checks it in exactly two places: immediately after a successful login
(`/login/page.tsx` redirects to `/change-password` instead of `/settings/organisation`
when the flag is `true`), and inside `AuthenticatedNav` (rendered on every `/settings/*`
and `/account/*` page) via a `GET /api/account/profile` fetch — so a user who is still
mid-forced-change and navigates directly to a bookmarked settings URL gets redirected
there too, not just immediately post-login. `/change-password` is the same page and same
`POST /api/account/change-password` endpoint for both the forced case and voluntary
changes from `/account/security` — there is exactly one change-password implementation,
not two.

### Frontend — five new pages, two new shared components, one brand-consistent dropdown

- `/change-password` — Current/New/Confirm Password fields, a live `PasswordStrength`
  checklist, `PasswordInput` show/hide toggles, and a note that other devices will be
  signed out. Redirects to `/settings/organisation` on success either way (forced or
  voluntary) — "continue normally," per the brief.
- `/reset-password/[token]` — completes the forgot-password flow Sprint 3.2 started (it
  built the _request_ page but never a page to consume the resulting token).
  `/login/forgot-password` was also extended: in development, the API's `resetToken` (no
  email service exists — "mock for now" per the brief) is now surfaced as a clickable
  dev-only link, since without it the reset flow would be untestable end-to-end from the
  browser at all.
- `/account/profile`, `/account/security`, `/account/sessions` — wrapped in a shared
  `AccountTabs` sub-nav. Profile is an editable First/Last Name + Phone Number form
  alongside read-only Employee Code/Email/Role/Organisation/Joined Date and a Profile
  Photo placeholder (no upload endpoint — explicitly a placeholder per the brief). Security
  shows Last Login, Failed Login Attempts, Account Status, and Password Last Changed, all
  pulled from the same `GET /api/account/profile` response (no separate endpoint — "these
  can initially come from existing data," per the brief), plus a Change Password button.
  Sessions lists every active session (Browser — parsed from the stored `userAgent` via a
  small new `parseUserAgent` helper, not a library — IP, Created, Last Active, a Current
  Device badge) with a per-row Logout button that revokes that session; revoking the
  current one clears local tokens and redirects to `/login` immediately, per the brief.
- `AuthenticatedNav` (Sprint 3.2) now renders a dropdown menu (My Profile / Security /
  Active Sessions / Logout) instead of a bare Logout button, and fetches
  `GET /api/account/profile` instead of Sprint 3.2's `GET /api/users/:id` + client-side JWT
  decode — one request now covers both the avatar's display data and the
  `mustChangePassword` guard. The now-unused `getUser` (in `settings/users/api.ts`) and
  `getCurrentUserId` (in `api-client.ts`) were deleted rather than left as dead code.
- `packages/ui/src/components/dropdown-menu.tsx` — hand-rolled (no Radix), same rationale
  as `Dialog` (Sprint 2.2): this is the first dropdown in the app, so a small controlled
  component is simpler than a new dependency for one use, at the cost of Radix-level
  accessibility (Escape/click-outside-to-close are implemented; full roving focus is not).
- Login page improvements: Remember Me (backed by a new `remember` parameter on
  `api-client.ts`'s `setTokens` — `true` persists to `localStorage`, `false` uses
  `sessionStorage`, always clearing the other so switching choices across logins doesn't
  leave a stale copy behind), show/hide password, autofocus on email, and a "password
  updated" success banner after a completed reset.

### Password strength policy

A new `strongPasswordSchema` in `@zentuva/validation` (min 8 characters + upper/lower/
number/special character) backs both `changePasswordSchema` (new) and — as a consistency
fix — `resetPasswordSchema` (Sprint 1B.2, previously just `min(8)`), so every "set a new
password" path in the product enforces the same policy. Registration's password field
(Sprint 3.2) was deliberately left untouched, since strengthening it isn't part of this
sprint's scope and the brief says not to redesign already-implemented flows.

## 3. Testing / Verification Performed

- Full monorepo quality gate from a clean state (`dist`/`.next`/`.turbo` wiped and
  rebuilt): `pnpm lint`, `pnpm type-check`, `pnpm test`, `pnpm build` all green across all
  7 workspace packages. 89/89 backend unit tests pass (77 pre-existing + 12 new: 3 in
  `auth.service.spec.ts` for `changePassword`, 3 for `revokeSession`, and a full
  `account.controller.spec.ts` covering all five endpoints).
- Manual verification directly against the live API (`curl`) before any frontend existed
  for these endpoints: profile GET/PATCH, sessions list, wrong-current-password rejection,
  a full two-session change-password scenario confirming the _other_ session is revoked
  while the _current_ one keeps working, session-ownership 404 on both a nonexistent id
  and another (simulated) user's session, `mustChangePassword` correctly `true` for an
  admin-created temp-password account and `false` after that account completes
  change-password, and the weak-password-rejected / strong-password-accepted validation
  boundary.
- Live end-to-end browser verification of the full journey:
  1. Logged in as an admin-created temporary-password user → correctly redirected straight
     to `/change-password` (not the normal landing page).
  2. Filled the form, watched the strength checklist update live to all-green/"Strong",
     submitted → redirected to `/settings/organisation`, nav showing the correct avatar
     initials — confirming "continue normally" after a forced change.
  3. Opened the nav dropdown → confirmed name/email header and all four menu items render
     correctly.
  4. `/account/profile`: edited and saved the phone number, confirmed "Changes saved" and
     persistence on reload.
  5. `/account/security`: confirmed Last Changed/Last Login/Failed Attempts/Status all
     populated correctly from real data.
  6. `/account/sessions`: confirmed "Chrome on macOS" parsed correctly from the real
     browser's user agent, Current Device badge present; revoked the current session and
     confirmed immediate redirect to `/login`.
  7. Forgot-password → dev-mode reset link → `/reset-password/[token]` → strength
     checklist → submit → redirected to `/login?passwordReset=1` showing the success
     banner → logged in with the new password successfully.
  8. Regression check: `/settings/users` (Sprint 2.2) still lists all users with correct
     roles/status; `/settings/organisation` (Sprint 2.1) unaffected.
  9. Verified at mobile viewport (375px): `/account/profile` reflows to a single column
     with the active tab, purple avatar, and pink accents all correctly present — no
     overflow.

## 4. Known Limitations

- **Pre-existing refresh-token race, discovered (not introduced) this sprint.** Rapidly
  calling `POST /auth/refresh` within the same wall-clock second as the token it's
  rotating was issued can throw a 500 (Prisma unique-constraint collision on
  `tokenHash`), because refresh JWTs are signed deterministically from
  `{sub, organisationId, sessionId, iat}` and `iat` only has second granularity — two
  tokens for the same session issued in the same second are byte-identical. Only
  reachable via back-to-back scripted requests (this sprint's `curl` verification hit it
  while testing rapidly in sequence), not normal browser use, where requests are seconds
  apart. Not fixed here, per the brief's "do not redesign already-implemented
  authentication" — flagged as a follow-up task instead.
- **`GET /auth/sessions` (Sprint 1B.2) still exists alongside the new
  `GET /api/account/sessions`.** Both return the same shape. The old route was left in
  place rather than removed, since nothing in the frontend or elsewhere ever called it —
  removing genuinely dead, unused code would have been fine, but leaving a harmless
  duplicate was judged the lower-risk choice for an authentication-adjacent route this
  sprint was told not to redesign.
- **"Profile Photo" is a placeholder only**, per the brief — the Upload Photo button is
  disabled and there is no upload endpoint, storage, or CDN wiring.
- **RBAC is still name-based** (`RolesGuard` from Sprint 2.1) — unaffected by this sprint,
  since every `/account/*` route only requires authentication, not role authorization.

## 5. Deferred / Future Work

A fix for the refresh-token same-second race (add a random `jti`/nonce to the token
payload so two tokens for the same session are never byte-identical), removing the
now-redundant `GET /auth/sessions` once it's confirmed nothing depends on it, real photo
upload storage for the Profile page, and the full RBAC/Permission evaluation engine
remain candidates for future sprints but were out of scope here.
