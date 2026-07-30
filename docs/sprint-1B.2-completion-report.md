# Sprint 1B.2 Completion Report — Identity Domain Implementation (Authentication Layer)

**Sprint:** 1B.2 — Identity Domain Implementation (Authentication Layer)
**Date:** 2026-07-30
**Scope:** Password hashing, JWT authentication, login, refresh token rotation, logout,
password reset, invitation acceptance, session management, account locking, audit logging,
and the `/auth/*` HTTP surface. No RBAC evaluation, permission guards, role/organisation/
user-management APIs, email delivery, MFA, OAuth, or SSO — per the Sprint 1B.2 brief.

## Summary

The Identity Domain can now authenticate users end-to-end: login, JWT access/refresh
tokens, refresh rotation with reuse detection, logout (single + all devices), password
reset (dev-mode token return), invitation acceptance, session listing, and automatic
account locking after repeated failed logins — every one of the brief's ten scope items
was implemented and manually exercised against a live server and a live Postgres database,
not just unit-tested in isolation. All three requested abstractions (`PasswordHasher`,
`TokenService`, `SessionStore`) exist as real interfaces with dependency-injected
implementations; `AuthService` depends on none of bcrypt, `@nestjs/jwt`, or Prisma directly.

## Features implemented

### 1. Password hashing

`apps/api/src/identity/crypto/`: `PasswordHasher` interface + `BcryptPasswordHasher`,
bound via the `PASSWORD_HASHER` DI token in a small `CryptoModule` (imported by both
`IdentityModule` and `AuthModule` — see [Security decisions](#security-decisions) for why
it's a separate module). Salt rounds come from `BCRYPT_SALT_ROUNDS` (default 12). Plaintext
passwords are never persisted — `User.passwordHash` is the only place a password ever
lands, and only after hashing.

### 2. JWT authentication

`apps/api/src/identity/auth/ports/token.port.ts` (`TokenService` interface) +
`infrastructure/jwt-token.service.ts` (`@nestjs/jwt`-backed implementation), bound via the
`TOKEN_SERVICE` token. `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET` are required, independently
validated to be ≥32 characters, and a Zod `.refine()` at boot (`env.validation.ts`) rejects
startup if they're equal. `JWT_ACCESS_EXPIRES_IN`/`JWT_REFRESH_EXPIRES_IN` default to
`15m`/`30d`.

### 3. Login

`AuthService.login()`: looks up the user by email, rejects non-`ACTIVE` statuses with a
generic message (no enumeration), verifies the password, resets the failed-attempt
counter, records `lastLoginAt`, issues a Session + access/refresh token pair, and records
an audit event. Returns `{ accessToken, refreshToken, expiresIn, user }` — `user` is a
hand-mapped summary (id/email/firstName/lastName/organisationId/status) that never
includes `passwordHash`.

### 4. Refresh token rotation

`AuthService.refresh()`: verifies the refresh token's JWT signature, looks up its hash in
`SessionStore`, and handles three cases — unknown/expired/revoked (reject), already-rotated
(**reuse detected**: revoke the whole session, audit `auth.refresh.reuse_detected` +
`auth.session.revoked`, reject), or valid (rotate to a new token, `touchSession`, return
new access+refresh pair). See [Security decisions](#security-decisions) for how "refresh
token is a JWT" and "refresh token is stored hashed and rotated" were reconciled.

### 5. Logout

`AuthService.logout()` revokes the current session (from the access token's `sessionId`
claim); `logoutAll()` revokes every session for the user. Both record an audit event
(`auth.logout` / `auth.logout_all`).

### 6. Password reset

`AuthService.requestPasswordReset()` always resolves without revealing whether the email
exists; a `PasswordResetToken` is only actually created if the user does. The raw token is
returned in the response **only when `NODE_ENV=development`** — in every other environment
the response body never contains it. `resetPassword()` validates the token (exists, unused,
unexpired), hashes the new password, marks the token used, and revokes every session for
that user. **No email integration exists** — sending the reset link is a future sprint's
job; this is stated here and in `apps/api/.env.example`'s comments.

### 7. Invitation acceptance

`AuthService.acceptInvitation()`: validates the token (exists, `PENDING`, unexpired) via
`InvitationService.validateToken`, creates the `User` (`UserService.
createFromInvitationAcceptance`, password hashed), assigns the invited `Role`
(`RoleService.assignRoleToUser` — a capability that didn't exist after Sprint 1B.1, added
this sprint), marks the `Invitation` `ACCEPTED`, and issues a session — logging the new
user in immediately, same as login. Invitation _creation_ (token generation + email)
remains a stub; only _acceptance_ was in scope.

### 8. Session management

`GET /auth/sessions` returns the caller's active sessions with `id`, `ipAddress`,
`userAgent`, `createdAt`, `lastActivityAt`, and `isCurrent`. Session metadata capture
(IP/User Agent/timestamps) was already part of the Sprint 1B.1 schema; this sprint added
the read path and the `SessionStore` port for the write paths used by login/refresh/logout.

### 9. Account locking

`User.failedLoginAttempts` (new column — see [Deviations](#deviations-from-design))
increments atomically on each failed login; a successful login resets it to `0`. Reaching
`MAX_LOGIN_ATTEMPTS` (default 5) transitions the user to `LOCKED` and records a `user.locked`
audit event. Locked users are rejected at login with the same generic message as any other
non-`ACTIVE` status (no enumeration of _why_ a login failed).

### 10. Audit logging

Every event the brief lists is recorded via `AuditService.record` (implemented in Sprint
1B.1, used here for the first time): login success/failure, logout, logout-all, password
reset requested, password changed, invitation accepted, account locked, refresh token
reused, session revoked. Four of these action strings didn't exist in `identity.md`'s
original table — see [Deviations](#deviations-from-design).

### API surface

All eight suggested endpoints, exactly as named in the brief, under `AuthController`
(`/api/auth/*` — the existing global `api` prefix from Sprint 0 applies):

| Endpoint                            | Auth required?             | Validation                              |
| ----------------------------------- | -------------------------- | --------------------------------------- |
| `POST /auth/login`                  | No                         | `loginSchema`                           |
| `POST /auth/logout`                 | Yes (`JwtAuthGuard`)       | —                                       |
| `POST /auth/logout-all`             | Yes                        | —                                       |
| `POST /auth/refresh`                | No (refresh token in body) | `refreshTokenSchema`                    |
| `POST /auth/password/request-reset` | No                         | `forgotPasswordSchema`                  |
| `POST /auth/password/reset`         | No                         | `resetPasswordSchema`                   |
| `POST /auth/invitations/accept`     | No                         | `acceptInvitationWithTokenSchema` (new) |
| `GET /auth/sessions`                | Yes                        | —                                       |

No role, permission, or organisation-management endpoints exist. `JwtAuthGuard` is pure
authentication (decodes and validates the access token, attaches it to `request.user`) —
it does not check roles or permissions, per the brief's explicit RBAC exclusion.

### Validation

Reused the existing shared Zod schemas from `packages/validation/src/identity.ts`
(`loginSchema`, `refreshTokenSchema`, `forgotPasswordSchema`, `resetPasswordSchema`) via a
small `ZodValidationPipe`. One new schema was added —
`acceptInvitationWithTokenSchema` — by **extending** `acceptInvitationSchema` rather than
duplicating it (adds `token`, `firstName`, `lastName`; see
[Deviations](#deviations-from-design) for why the latter two were needed). No
class-validator DTOs were created for auth endpoints.

## Security decisions

1. **Bcrypt, not Argon2id.** The Sprint 1A report flagged argon2id as an _unconfirmed
   assumption_; this sprint's brief explicitly specified bcrypt. Implemented behind
   `PasswordHasher` specifically so this choice is revisitable without touching call sites.
2. **Refresh tokens are JWTs, still stored hashed, rotated, and reuse-detected.** The brief
   requires `JWT_REFRESH_SECRET`/`JWT_REFRESH_EXPIRES_IN` (implying a _signed_ refresh
   token), while identity.md originally described an _opaque_ random refresh token. Both
   were honoured: the refresh token's raw form is a JWT (self-contained signature/expiry
   check, no DB round-trip needed just to reject a garbage token), but it's SHA-256-hashed
   before being stored in `RefreshToken.tokenHash` (§9's "never store the raw token"
   requirement), and the existing rotation-chain (`replacedByTokenId`) and reuse-detection
   design from identity.md §5 apply completely unchanged. Being a JWT only changes what the
   raw value looks like before hashing — not how it's persisted, revoked, or reused-detected.
3. **SHA-256 for opaque tokens, bcrypt only for passwords.** Refresh tokens (post-hash),
   password-reset tokens, and invitation tokens are hashed with SHA-256
   (`token-hash.util.ts`), not bcrypt. These are high-entropy random values, not low-entropy
   human passwords — a slow salted hash buys no security here and only adds latency to every
   refresh/reset/accept request. bcrypt is reserved for the one place its slowness is the
   point: actual user passwords.
4. **Generic failure messages everywhere in login.** Unknown email, wrong password, and
   every non-`ACTIVE` status (`LOCKED`/`SUSPENDED`/`DEACTIVATED`/`INVITED`) all return the
   identical `"Invalid email or password"` — the real reason is only ever in the audit log,
   never the HTTP response, preventing user enumeration and status probing.
5. **`resetFailedLoginAttempts` and account status are checked _before_ password
   verification runs.** A locked/suspended/deactivated user is rejected without ever calling
   `PasswordHasher.compare`, so no bcrypt work (or timing signal) is spent on accounts that
   can't log in regardless.
6. **`CryptoModule` split out to avoid a circular dependency, not for its own sake.**
   `UserService` (in `IdentityModule`) needs `PasswordHasher` for `verifyPassword`/
   `createFromInvitationAcceptance`; `AuthModule` needs `IdentityModule`'s services.
   `IdentityModule → AuthModule → IdentityModule` would cycle, so `PasswordHasher`'s binding
   lives in its own tiny module that both import independently.
7. **`SessionRepository` is exported from `IdentityModule`** (the only repository that is —
   every other one stays internal). `DatabaseSessionStore` needs token-material methods
   (`issueRefreshToken`, `rotateRefreshToken`, ...) that were deliberately kept off
   `SessionService` (see next point), so it needs the repository directly.
8. **`SessionService`'s writes stayed split, not all filled in.** `revoke`/
   `revokeAllForUser` are pure session-revocation with no token material and are now real.
   `create`/`rotateRefreshToken` still throw — issuing/rotating a token is auth-layer secret
   generation, which lives in `DatabaseSessionStore` (behind the `SessionStore` port), not
   the general-purpose domain service. `AuthService` depends on `SessionStore` for those
   operations, not `SessionService`.
9. **Never expose password hash or refresh hash.** `UserSummary` (returned from login/
   refresh/accept) is a hand-built object, not a spread of the Prisma `User` row — there is
   no code path that can accidentally leak `passwordHash`. Refresh token hashes never leave
   `SessionStore`/the database at all; only the raw (pre-hash) token is ever returned to a
   client, and only once, at issuance.

## Deviations from design

1. **`User.failedLoginAttempts` added** (migration
   `20260730173455_add_user_failed_login_attempts`). identity.md's `LOCKED` status (added
   1A.1) explicitly deferred "exact triggering/unlocking rules" as "a Sprint 1B
   implementation detail, not decided here" — this is that detail. `identity.md` §4/§9
   updated accordingly.
2. **Refresh token implemented as a JWT, not an opaque string** — see
   [Security decisions](#security-decisions) point 2. `identity.md` §5 updated with an
   inline note explaining the reconciliation; the security properties (hashed storage,
   rotation, reuse detection) are unchanged.
3. **Bcrypt instead of argon2id** — see [Security decisions](#security-decisions) point 1.
   `identity.md` §5 updated. As a direct consequence, `apps/api/prisma/seed.ts` (which
   hashed the seeded admin's password with argon2 in Sprint 1B.1, before this sprint settled
   the question) was switched to bcrypt too — otherwise the seeded user could never log in
   through the new `PasswordHasher`. The `argon2` dependency was removed; `bcrypt` was added.
4. **`POST /invitations/:token/accept` implemented as `POST /auth/invitations/accept`**
   (token in the body, not the URL), matching the Sprint 1B.2 brief's suggested endpoint
   list exactly. `identity.md` §10 updated to document both shapes and why they differ.
5. **Invitation acceptance now requires `firstName`/`lastName` in the request body.**
   identity.md's `Invitation` entity only ever carried `email` + `roleId` — there was no
   field anywhere for the new `User`'s required `firstName`/`lastName` to come from. Adding
   them to the acceptance payload (rather than to `Invitation` itself, which would have been
   a real schema redesign requiring invitation _creation_ — out of scope — to collect them
   upfront) was the smallest fix. `identity.md` §5/§10 updated; `acceptInvitationWithTokenSchema`
   in `packages/validation` reflects it.
6. **`RoleRepository.assignToUser` / `RoleService.assignRoleToUser` added.** Invitation
   acceptance needs to create a `UserRole` row (identity.md §5's own documented flow: "INSERT
   UserRole"), and no repository or service method existed to do that after Sprint 1B.1 —
   an oversight in that sprint, not a deviation from the design itself (identity.md always
   specified this write; the capability to perform it was simply missing).
7. **Four new audit action strings**: `auth.logout_all`, `auth.password.reset_requested`,
   `auth.session.revoked`, `user.locked`. identity.md §8's event table wasn't fully
   exhaustive relative to what the Sprint 1B.2 brief explicitly requires recording — table
   updated to include them.

No other deviations. Every other piece (login/refresh/logout/reset/accept/session/locking
behaviour, the three port interfaces, the endpoint list, the security requirements) follows
the brief and the design exactly.

## Verification steps

All executed against a live server (`node dist/main.js`) and live Postgres, not simulated:

| Check                            | Result                                                                                                                                                                                                                                    |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Login succeeds                   | ✅ Real bcrypt-verified login against the seeded admin user, returned `accessToken`/`refreshToken`/`expiresIn: 900`/`user`                                                                                                                |
| Invalid credentials rejected     | ✅ `401`, generic message                                                                                                                                                                                                                 |
| Locked account rejected          | ✅ 5 failed logins → `status: LOCKED` in DB, `user.locked` audit row; 6th attempt (even with the _correct_ password) still rejected                                                                                                       |
| Suspended account rejected       | ✅ Manually set `SUSPENDED`, login rejected with the same generic message                                                                                                                                                                 |
| Refresh works                    | ✅ New access+refresh pair issued                                                                                                                                                                                                         |
| Refresh token rotates            | ✅ Reusing the pre-rotation token → `401` "reuse detected", session revoked; the legitimately-rotated token _also_ then fails (session gone), confirming full revocation                                                                  |
| Logout revokes session           | ✅ Session disappeared from `GET /auth/sessions` immediately after logout                                                                                                                                                                 |
| Logout-all revokes every session | ✅ Verified via a fresh login + `GET /auth/sessions` showing only the new session                                                                                                                                                         |
| Password reset works             | ✅ Dev-mode token returned for a known email, nothing returned for an unknown email; old password rejected post-reset, new password accepted; all prior sessions revoked                                                                  |
| Invitation works                 | ✅ Seeded a test `Invitation` row directly (creation is out of scope), accepted it via the API — User created, `Member` role assigned, `Invitation` marked `ACCEPTED`; re-accepting the same token → `409`; an expired invitation → `410` |
| Sessions listed correctly        | ✅ `id`/`ipAddress`/`userAgent`/`createdAt`/`lastActivityAt`/`isCurrent`, matching the live DB rows                                                                                                                                       |
| Audit logs created               | ✅ Every event above confirmed present in `audit_logs` via direct SQL, with correct `action`/`metadata`                                                                                                                                   |

Full request/response transcripts are not reproduced here to keep this report readable —
the behaviour above was observed directly via `curl` against the running server plus `psql`
against the database, not inferred from code review.

Automated:

| Command           | Result                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm lint`       | ✅ 9/9 packages clean                                                                                                                                                                                                                                                                                                                                                  |
| `pnpm type-check` | ✅ 9/9 packages clean                                                                                                                                                                                                                                                                                                                                                  |
| `pnpm test`       | ✅ 4 new suites, 47 tests, all passing (`BcryptPasswordHasher`, `JwtTokenService` + `parseDurationToSeconds`, `DatabaseSessionStore`, `AuthService` — covering every one of the brief's ten listed test targets: password hashing, JWT generation, login, refresh, logout, password reset, invitation acceptance, account locking, session management, token rotation) |
| `pnpm build`      | ✅ Clean build from a fully wiped `dist`/`.next`/`.turbo` state; booted the compiled app and confirmed the full DI graph (`CryptoModule` → `IdentityModule` → `AuthModule`, all 8 routes mapped) resolves at runtime                                                                                                                                                   |

Migration applied the same way as Sprint 1B.1 (documented tooling limitation, not a defect):
`prisma migrate dev` refuses to run in this session's non-interactive shell, so
`prisma migrate diff` + `prisma migrate deploy` were used to produce and apply an identical
migration. `prisma migrate status` confirmed "Database schema is up to date" afterward.

## Known limitations

- **No unlock mechanism for locked accounts.** `LOCKED` is a one-way transition this sprint
  — there is no admin endpoint to unlock a user (User Management APIs are explicitly out of
  scope). A locked account in this state currently requires direct database intervention.
  Flagged as the top priority for whichever sprint adds user-management endpoints.
- **`InvitationService.create` remains a stub.** Only invitation _acceptance_ was in scope.
  Verification seeded a test invitation directly via SQL — a real invitation-creation flow
  (with email delivery) is future work.
- **No automated test hits the live database.** The 47 unit tests all use mocked
  repositories/ports, per the brief's "unit tests" framing; the database-backed behaviour
  above was verified manually. An integration test suite (real Postgres, no mocks) would be
  a reasonable Sprint 1B.3+ addition.
- **Access tokens cannot be revoked before they expire.** They're stateless JWTs verified by
  signature alone; logout revokes the _session_ (so refresh can no longer mint new access
  tokens), but an already-issued 15-minute access token remains valid until it naturally
  expires. This is a standard, accepted tradeoff for short-lived JWTs, not an oversight —
  worth stating explicitly since "revoke session" and "invalidate access token immediately"
  are easy to conflate.
- **`GET /auth/sessions` has no way to terminate a _specific_ non-current session** (only
  "this one" via logout, using the current session's own id, or "all" via logout-all). The
  original identity.md design documented `DELETE /sessions/:id` for this; it wasn't in the
  Sprint 1B.2 brief's suggested endpoint list, so it wasn't added.

## Testing

`apps/api/src/identity/crypto/bcrypt-password-hasher.spec.ts`,
`apps/api/src/identity/auth/infrastructure/jwt-token.service.spec.ts`,
`apps/api/src/identity/auth/infrastructure/database-session-store.spec.ts`,
`apps/api/src/identity/auth/auth.service.spec.ts` — 47 tests total, all dependencies mocked
(no database or network access from the test suite itself). See the
[Verification steps](#verification-steps) table for the `pnpm test` result.
