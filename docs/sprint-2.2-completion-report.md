# Sprint 2.2 Completion Report — User Management

**Date:** 2026-07-31
**Status:** Complete

## 1. Objective

Let an Organisation Owner or Administrator manage the users within their own organisation:
list, view, create, update, activate, and deactivate. Invitation emails, password-setup
links, and self-service onboarding are intentionally deferred to Sprint 2.3. Scope was kept
deliberately narrow, matching the brief's explicit out-of-scope list (email invitations,
password reset emails, self-registration, profile pictures, teams, departments, employee
hierarchy, multiple organisations, permission management, dynamic RBAC, bulk import/export,
notifications).

## 2. Implementation Summary

### Backend

- **`UserController`** (`apps/api/src/identity/user/user.controller.ts`), wired into a new
  **`UserModule`**: `GET /api/users` (list), `GET /api/users/:id` (view) — both require only
  authentication (Member has read-only access); `POST /api/users` (create) and
  `PATCH /api/users/:id` (combined update) — both Owner/Administrator only, via the same
  `RolesGuard` built in Sprint 2.1 (reused unchanged).
- **`UserService`/`UserRepository`** (both existed since Sprint 1B.1) were extended, not
  rebuilt: `createUser` (email-uniqueness check, role resolution, password hashing, atomic
  create+role-assignment) and `updateUser` (existence check, then whichever of
  profile/status/role fields were provided) are new; the underlying `updateProfile`/
  `updateStatus` repository methods already existed.
- **Role assignment**: this sprint's MVP model treats "one role per user" as the rule (the
  brief's `role` field is singular, both on create and update), even though the underlying
  `UserRole` join table technically permits many. `RoleRepository.replaceUserRole` (new)
  deletes any existing assignment and creates exactly one, transactionally — a user is
  never briefly left with zero roles. `role` is a system role **name**
  (`Owner`/`Administrator`/`Member`), not a `roleId`, since no role-listing endpoint exists
  yet and this sprint only needs the three seeded system roles.
- **Status**: the wire contract exposes a simplified 3-value status
  (`ACTIVE`/`INACTIVE`/`LOCKED`) over the DB's 5-value `UserStatus` enum. `INACTIVE` maps
  to `SUSPENDED` (reversible — matches identity.md's documented semantics for that value),
  not `DEACTIVATED` (documented as terminal/irreversible) — this is what makes
  "Activate"/"Deactivate" a working toggle. `INVITED`/`DEACTIVATED` aren't reachable
  through these endpoints.
- **Validation**: `createUserSchema`/`updateUserSchema` (`packages/validation/src/identity.ts`)
  define the exact field set from the brief. Immutable fields (`id`, `email`,
  `organisationId`) are absent from `updateUserSchema`, so they can never be changed via
  `PATCH` regardless of what a client sends.
- **Tenant isolation**: every method resolves the target user by `(id, organisationId)`
  together, scoped to the caller's own `organisationId` from their JWT. Verified live
  (§4) — a second organisation's Owner gets `404 Not Found` (not `403`) attempting to
  read or update a user in a different organisation, and that organisation's user list
  never includes another organisation's rows.
- **Audit logging**: every `POST`/`PATCH` records one event via the existing
  `AuditService` — `user.created` on create; on update, `user.activated`/
  `user.deactivated` if `status` was set to `ACTIVE`/(`INACTIVE`|`LOCKED`) respectively,
  else a generic `user.updated`.

### Frontend

- **`/settings/users`** (`apps/web/src/app/settings/users/page.tsx`): a table (Name,
  Email, Employee Code, Role, Status), a **Create User** dialog, an **Edit User** dialog,
  and a one-click **Activate/Deactivate** button per row. No pagination, search, filters,
  or sorting, per the brief. Built with React Hook Form + Zod (reusing the same schemas as
  the backend), TanStack Query, and three new shadcn/ui-style primitives added to
  `packages/ui`: `Dialog` (hand-rolled — no new dependency, see "Deviations" below),
  `Select`, `Badge`.

## 3. API Endpoints

| Method  | Path             | Auth                                         | Notes                                                                    |
| ------- | ---------------- | -------------------------------------------- | ------------------------------------------------------------------------ |
| `GET`   | `/api/users`     | Any authenticated user                       | No pagination — returns every user in the caller's organisation          |
| `GET`   | `/api/users/:id` | Any authenticated user                       | 404 if the id belongs to another organisation                            |
| `POST`  | `/api/users`     | Owner or Administrator only (403 for Member) | `{ firstName, lastName, email, employeeCode?, role, temporaryPassword }` |
| `PATCH` | `/api/users/:id` | Owner or Administrator only (403 for Member) | Partial `{ firstName, lastName, employeeCode, role, status }`            |

Response fields: `id`, `firstName`, `lastName`, `email`, `employeeCode`, `role`, `status`
(`ACTIVE`/`INACTIVE`/`LOCKED`), `createdAt`, `updatedAt`.

## 4. Testing Performed

### Automated

- `apps/api/src/identity/user/user.service.spec.ts` (new, 7 tests): duplicate email
  rejected (`ConflictException`), unknown role rejected (`NotFoundException`), password
  hashed and user created `ACTIVE` with the resolved role, nonexistent/cross-tenant update
  target rejected, wire status `INACTIVE` mapped to DB `SUSPENDED`, role resolved and
  replaced, profile-only updates touch only the profile.
- `apps/api/src/identity/user/user.controller.spec.ts` (new, 7 tests): list/get mapping
  (including role-name resolution), 404 on missing user, create records `user.created`,
  and each status value on update records the correct audit action
  (`user.activated`/`user.deactivated`/generic `user.updated`).
- Full monorepo quality gate from a clean state (`node_modules`, `dist`, `.next`, `.turbo`
  wiped and rebuilt): `pnpm build`, `pnpm lint`, `pnpm type-check`, `pnpm test` all green
  across all 7 workspace packages. 69/69 backend unit tests pass.

### Manual (live, against a running API + Postgres + browser)

- ✓ Login still works for all three seeded accounts (Owner, Administrator, Member) —
  explicit regression check per the brief.
- ✓ Owner can create users; Administrator can create users; Member receives `403
Forbidden` attempting to create a user (but can still `GET`, confirming read-only
  access).
- ✓ Owner can edit users (profile, role, status); Administrator can edit users; Member
  receives `403` attempting to edit.
- ✓ **Tenant isolation**: created a second organisation with its own Owner. That Owner's
  `GET /api/users` never lists the first organisation's users; `GET`/`PATCH` against the
  first organisation's user id both return `404` (not `403` — doesn't confirm the id
  exists in another tenant).
- ✓ Password hashing: a user created via `POST /api/users` could not log in with their
  temporary password while `LOCKED` (correctly rejected — status-gating verified as a
  side effect), and could log in successfully once reactivated, confirming both the hash
  and the DB status mapping are wired correctly end-to-end through the existing
  `AuthService`.
- ✓ Audit logging: `user.created`, `user.updated`, `user.activated`, `user.deactivated`
  entries all inspected directly in Postgres, for both API-driven and browser-driven
  actions.
- ✓ Validation errors return `400` with field-level messages for: invalid email, password
  too short, unrecognised role.
- ✓ Attempting to set immutable fields (`email`, `id`) via `PATCH` is silently ignored —
  confirmed the target user's real email was unaffected.
- ✓ Frontend: user table loads real data; Create User dialog creates a user and appears
  in the table; Edit User dialog pre-fills correctly (including disabled email) and saves
  role/status changes; the Activate/Deactivate button toggles status and its own label
  correctly — all verified via network requests and DOM inspection (the browser tool's
  screenshot renderer was unreliable this session, same as Sprint 2.1's).
- ✓ Development seed: `pnpm db:seed` creates `owner@bobybites.local`,
  `admin@bobybites.local`, `member@bobybites.local`, each with role Owner/Administrator/
  Member respectively and the documented password. (Two stale manual test accounts left
  over from Sprint 2.1's own verification — `administrator@bobybites.local` and an
  `member@bobybites.local` with a different password — were deleted first so the
  documented seed credentials actually work; this was pre-existing local-database state,
  not a defect in this sprint's code.)

## 5. Deviations from Design / Discrepancies Reconciled

- **`role` is a system role name, not a `roleId`.** The brief says "the creator chooses: …
  role" without specifying the shape; no role-listing endpoint exists yet (Role Management
  is out of scope this sprint), so requiring the frontend to already know a `roleId` isn't
  workable. Constraining `role` to the three seeded system role names
  (`Owner`/`Administrator`/`Member`) is the simplest shape that actually works today.
- **Wire status `INACTIVE` maps to DB `SUSPENDED`, not `DEACTIVATED`.** The brief lists
  `ACTIVE`/`INACTIVE`/`LOCKED` as the supported statuses, but the DB enum has no
  `INACTIVE` value — it has `SUSPENDED` (documented as reversible) and `DEACTIVATED`
  (documented as terminal/irreversible). Since the brief's own Scope list includes both
  "Activate a user" and "Deactivate (or lock) a user" as reversible actions, `SUSPENDED` is
  the correct target, not `DEACTIVATED`. No new enum value was added — reusing an existing
  one with the matching semantics is simpler.
- **`user.activated`/`user.deactivated` are new, more granular than identity.md §8's
  existing `user.status_changed`.** The brief explicitly asks for these as the audit
  events to record; `user.status_changed` remains documented in identity.md as the
  original design's single event but isn't emitted by this sprint's endpoints.
- **`Dialog` in `packages/ui` is hand-rolled, not Radix-based.** This is the first modal
  in the app. A full accessible dialog primitive (focus trapping, ARIA live regions) would
  normally mean adding `@radix-ui/react-dialog`; given only two dialogs exist so far and
  the project's MVP-first philosophy, a minimal controlled overlay (Escape-to-close,
  click-outside-to-close, but no focus trap) was built instead. Worth revisiting if/when
  dialogs become a common pattern across more pages.
- **No "last Owner" guard.** identity.md §2/§4 document that every organisation must
  always retain at least one Owner, enforced "at the application layer." This sprint's
  `PATCH /api/users/:id` does not enforce it — an Owner could demote or deactivate the
  organisation's only remaining Owner. Implementing this felt like it needed either a
  cross-user query on every role/status change (real cost) or a half-measure that covers
  only one of the two paths (role change vs. status change) inconsistently; deferring it
  cleanly to a future sprint seemed better than a partial guard. Documented here as a real
  gap, not silently skipped — see "Known Limitations."

## 6. Known Limitations

- **No "last Owner" protection** (see Deviations above) — an organisation can currently be
  left with zero Owners via `PATCH /api/users/:id`.
- **No global `AppError` → HTTP exception filter.** Discovered while building this
  sprint's error handling (not introduced by it): the app has no
  `@Catch(AppError)` filter, so throwing the shared `@zentuva/utils` `AppError` class
  inside a request handler produces a generic `500`, silently losing the intended status
  code. `UserService` was written to use NestJS's own `ConflictException`/
  `NotFoundException` instead (matching `AuthService`'s existing pattern) specifically to
  avoid this — the underlying gap in the app is unfixed, since fixing it globally is
  out of scope for a "keep this sprint small" User Management brief. A future sprint
  should either add the filter or formally establish "always throw a NestJS
  `HttpException` subclass at the service layer" as the house style.
- **No button-level RBAC hiding in the frontend.** The Create/Edit/Activate/Deactivate
  controls always render; a Member who reaches them gets a `403` from the API and sees
  the resulting error message, rather than the controls being hidden up front. No
  "current user" context/hook exists on the frontend yet to know the caller's own role
  without an extra request — building one felt like scope creep for this sprint.
- **No "clear a field" support**, same as Sprint 2.1's Organisation Profile form —
  `employeeCode` can be set but not cleared back to blank via the Edit dialog (an empty
  string is dropped from the update payload rather than sent).
- Everything on the brief's explicit out-of-scope list (see §7).

## 7. Deferred / Future Work

Everything on the brief's explicit out-of-scope list: email invitations, password reset
emails, password setup links, self-registration, user profile pictures, teams,
departments, employee hierarchy, multiple organisations, organisation switching,
permission management, dynamic RBAC, bulk import/export, CSV upload, notifications. Per
the backlog, Sprint 2.3 (Invitation & Onboarding) is next.

## 8. Seed Data

`pnpm db:seed` now creates three development accounts, one per system role, all sharing
the same local-only password:

| Role          | Email                    | Password                             |
| ------------- | ------------------------ | ------------------------------------ |
| Owner         | `owner@bobybites.local`  | `local-dev-only-not-a-real-password` |
| Administrator | `admin@bobybites.local`  | `local-dev-only-not-a-real-password` |
| Member        | `member@bobybites.local` | `local-dev-only-not-a-real-password` |

Documented in `apps/api/.env.example` (copy to `.env` as-is to get working logins) and
`docs/development/local-development.md`.

## 9. Documentation Consistency Follow-Up

Learning from Sprint 2.1 (where `docs/domains/identity.md` was initially left stale and
needed a follow-up pass), this sprint proactively reconciled it and swept the rest of
`docs/` at the same time:

- **`docs/domains/identity.md`**: top status line now lists Sprint 2.2; §6 RBAC strategy's
  `RolesGuard` note now covers both Sprint 2.1 and 2.2's usage of it; §8 audit events table
  gained `user.activated`/`user.deactivated`; §10 Users table rewritten to the actual
  shipped shape (real endpoints, wire status/role mapping, immutable-field list) with an
  explicit "implemented as of Sprint 2.2" note, matching the pattern already established
  for Organisations in Sprint 2.1.
- **`docs/roadmap.md`**: Phase 1 gained a checked "User Management API (Sprint 2.2)" line;
  the "RBAC evaluation" and "role/organisation/user-management API surface" bullets were
  updated to reflect that both Organisation Profile and User Management have now shipped.
- **`docs/database/README.md`**: corrected the summary paragraph (previously only
  mentioned Sprint 2.1's Organisation Profile API) and the seed-data paragraph (previously
  described only the single Owner account).
- **`docs/development/local-development.md`**: the `db:seed` row's description ("currently
  a placeholder") was already stale before this sprint — fixed, and a table of the three
  seeded accounts' credentials added.
