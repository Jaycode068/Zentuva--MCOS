# Sprint 2.1 Completion Report — Organisation Management (Organisation Profile)

**Date:** 2026-07-30
**Status:** Complete

## 1. Objective

Let an authenticated organisation retrieve and update its own profile — the first
business-domain feature built on top of the Identity Domain (Sprints 1A/1A.1/1B.1/1B.2).
Scope was deliberately narrow: profile retrieval and update only. No logo/file upload,
user management, invitations, role management, permission management, subscriptions,
billing, or any of the other items on the brief's explicit out-of-scope list were built.

## 2. Implementation Summary

### Backend

- **`OrganisationController`** (`apps/api/src/identity/organisation/organisation.controller.ts`)
  exposes `GET /api/organisation/me` and `PATCH /api/organisation/me`, wired into a new
  **`OrganisationModule`** and registered in `AppModule`.
- **`OrganisationService`/`OrganisationRepository`** (both from Sprint 1B.1) were extended,
  not rebuilt: `updateProfile` already existed as a real implementation; this sprint trimmed
  its input shape to the MVP field set and added the wire-to-domain field mapping in the
  controller.
- **Authorisation**: a **`RolesGuard`** (`apps/api/src/identity/auth/guards/roles.guard.ts`)
  plus a **`@Roles(...)`** decorator implement exactly what the brief asked for — "a simple
  role-name check," not a permission engine. It loads the caller's role names
  (`RoleService.getRoleNamesForUser`, new this sprint) and checks membership against
  `@Roles('Owner', 'Administrator')` on the `PATCH` route. `GET` only requires
  authentication (`JwtAuthGuard`) — any role, including Member, can read.
- **Validation**: `updateOrganisationProfileSchema`
  (`packages/validation/src/identity.ts`) was rewritten (it had no controller consumer
  before this sprint, so nothing depended on its old shape) to match the brief's exact
  field list and wire names: `organisationName`, `displayName`, `description`, `email`,
  `phoneNumber`, `website`, `country`, `state`, `city`, `addressLine`, `industry`,
  `currency`, `timezone`. Read-only fields (`id`, `organisationCode`, `slug`, `createdAt`,
  `updatedAt`) are absent from the schema, so they can never be set via `PATCH` regardless
  of what a client sends.
- **Schema change**: added `Organisation.displayName` (nullable `String`), migration
  `20260730180000_add_organisation_display_name` — the brief's field list included Display
  Name as a distinct field from the legal Organisation Name, and no such column existed.
- **Audit logging**: every successful `PATCH` records an `organisation.updated` event via
  the existing `AuditService`, carrying `organisationId`, `actorUserId`, `action`,
  `timestamp`, plus request `ipAddress`/`userAgent`.

### Frontend

- **`/settings/organisation`** (`apps/web/src/app/settings/organisation/page.tsx`): a
  single-page form with four sections (General Information, Contact Information, Address,
  Business Settings) and Save Changes/Cancel buttons. Built with React Hook Form + a Zod
  resolver, TanStack Query for fetch/mutate, and four new shadcn/ui-style primitives added
  to `packages/ui` (`Input`, `Label`, `Textarea`, `Card`). No tabs, no logo upload, no image
  preview, no dashboard — matching the brief.
- **`apps/web/src/lib/api-client.ts`**: a minimal bearer-token-aware `fetch` wrapper. See
  "Known limitations" below — there is no login page yet, so this reads a token that must
  be set some other way.

## 3. API Endpoints

| Method  | Path                   | Auth                                         | Notes                                                                                                |
| ------- | ---------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `GET`   | `/api/organisation/me` | Any authenticated user                       | Returns the caller's organisation profile                                                            |
| `PATCH` | `/api/organisation/me` | Owner or Administrator only (403 for Member) | Partial update; unknown/read-only fields are silently ignored (not present in the validation schema) |

Response/request field names: `organisationName`, `displayName`, `description`, `email`,
`phoneNumber`, `website`, `country`, `state`, `city`, `addressLine`, `industry`,
`currency`, `timezone`, plus read-only `id`, `organisationCode`, `slug`, `createdAt`,
`updatedAt` (`GET` only ever returns these; `PATCH` never accepts them).

## 4. Testing Performed

### Automated

- `apps/api/src/identity/auth/guards/roles.guard.spec.ts` (new, 4 tests): no-required-roles
  passthrough, authorized role allowed, unauthorized role rejected (403), missing
  authenticated user rejected (403).
- `apps/api/src/identity/organisation/organisation.controller.spec.ts` (new, 3 tests):
  `getMe` returns the mapped profile, `getMe` 404s when the organisation is missing,
  `updateMe` maps wire fields to domain fields and records the audit entry.
- Full monorepo quality gate from a clean state (`node_modules`, `dist`, `.next` wiped and
  reinstalled/rebuilt): `pnpm build`, `pnpm lint`, `pnpm type-check`, `pnpm test` all green
  across all 7 workspace packages. 54/54 backend unit tests pass.

### Manual (live, against a running API + Postgres + browser)

- ✓ Login (`POST /api/auth/login`) still works, both before and after this sprint's changes
  — regression-checked explicitly per the brief.
- ✓ `GET /api/organisation/me` returns the correct profile for an authenticated user.
- ✓ Owner can `PATCH /api/organisation/me` (200, fields persisted, verified via a follow-up
  `GET`).
- ✓ Administrator can `PATCH /api/organisation/me` (200) — tested with a role-seeded test
  user.
- ✓ Member receives `403 Forbidden` with `"You do not have permission to perform this
action"` on `PATCH` attempts, but can still `GET` (200).
- ✓ Unauthenticated requests receive `401 Unauthorized` on both `GET` and `PATCH`.
- ✓ Validation errors return `400` with field-level messages for: invalid email, invalid
  website URL, phone too short, wrong-length currency code, blank organisation name.
- ✓ Attempting to set read-only fields (`organisationCode`, `id`) via `PATCH` is silently
  ignored — confirmed the organisation's real `organisationCode` (`BBT-0001`) was
  unaffected.
- ✓ `organisation.updated` audit log entries were created and inspected directly in
  Postgres for both API-driven and browser-driven updates.
- ✓ Frontend: `/settings/organisation` loads real data, edits persist through Save Changes
  (verified via network requests and a follow-up `GET`), and the "Changes saved"
  confirmation renders correctly.

## 5. Bugs Found and Fixed During Verification

- **`@UsePipes()` scope bug**: NestJS applies a method-level `@UsePipes()` to _every_
  parameter with a decorator — including custom decorators like `@CurrentUser()`, not just
  `@Body()`. The first draft of `updateMe` used method-level `@UsePipes(new
ZodValidationPipe(updateOrganisationProfileSchema))`, which silently reduced the
  `@CurrentUser()`-supplied `TokenPayload` down to `{}` (Zod's default behaviour strips
  unrecognised keys), causing `organisationId` to become `undefined` and a Prisma error on
  `PATCH`. Fixed by scoping the pipe to the `@Body()` parameter directly:
  `@Body(new ZodValidationPipe(schema)) body: ...`. This was caught by live manual
  verification, not by lint/type-check/unit tests (the unit test mocks the pipe away
  entirely) — consistent with this project's established pattern of always verifying
  against a running server. No other existing endpoint combines a body-validated
  `@UsePipes()` with `@CurrentUser()` on the same handler, so this was newly introduced by
  this sprint, not a pre-existing latent bug elsewhere.
- **Frontend "Changes saved" indicator**: a `useEffect` keyed on the fetched `profile`
  reset the save-confirmation state to `idle` immediately after every successful save
  (because `queryClient.setQueryData` changes `profile`, which re-triggered the effect).
  Fixed by moving the reset into the mutation's `onMutate` callback instead of a
  profile-keyed effect. Caught via live browser verification (network request + DOM
  inspection), not by lint/type-check.

## 6. Deviations from Design / Discrepancies Reconciled

- **`identity.md` updated as a follow-up.** The original brief for this sprint named only
  three documentation deliverables (`docs/backlog.md`, `docs/changelog.md`, this report),
  deliberately narrower than prior sprints, so `docs/domains/identity.md` was initially left
  untouched. A follow-up request asked for it to be reconciled with the implementation; see
  §9 below for exactly what was changed there and elsewhere.
- **Authorization is a role-name check, not the permission-key evaluation system
  `identity.md` §6 describes.** The brief was explicit: "a simple role-name check is
  sufficient... do not build permission decorators / a permission engine / policy
  evaluation." `RolesGuard` checks `@Roles('Owner', 'Administrator')` against the caller's
  role _names_ directly — it does not consult the `Permission`/`RolePermission` catalog,
  and does not special-case Owner's documented "bypasses the permission catalog entirely"
  behaviour (Owner is just one of the two role names in the `@Roles()` list here). Building
  the generalized permission-key evaluation engine remains explicitly future work.
- **`Organisation.email` maps to the existing `businessEmail` column**, not a new field or
  `supportEmail` (both already existed on the schema from Sprint 1B.1). The brief's Contact
  section lists a single "Email" field; `businessEmail` was the closer match as the
  organisation's primary contact address.
- **`Organisation.addressLine` maps to the existing `addressLine1` column.** `addressLine2`
  (already in the schema) is untouched by this sprint's DTO/UI — not exposed, not removed.

## 7. Known Limitations

- **No login page.** The `/settings/organisation` frontend page assumes a valid access
  token is already present in `localStorage` (`zentuva_access_token`). There is no sign-in
  UI anywhere in `apps/web` yet — a real login flow/auth context is a gap for a future
  sprint. Manual verification set the token directly via the browser's JS console (through
  an actual `POST /api/auth/login` call), not by bypassing authentication.
- **`OrganisationRepository.updateProfile` does not re-check `organisationId` in its Prisma
  `where` clause** (`update({ where: { id }, data })` rather than a tenant-scoped
  `updateMany`). This is safe today because the `id` passed in is always
  `user.organisationId` from the caller's own JWT — there is no code path where a client
  can supply an arbitrary target id — but it diverges from the `updateMany` + re-fetch
  pattern used elsewhere in the Identity Domain for defense-in-depth. Worth tightening if a
  future sprint adds any endpoint that accepts an organisation id as input.
- **Unsaved-changes detection was not built** (explicitly optional per the brief).
  `Cancel` resets the form back to the last-fetched values; it does not warn before
  navigating away with unsaved edits.
- **No "clear a field" support.** The frontend form omits empty-string fields from the
  `PATCH` payload rather than sending them (most fields use Zod formats like `email()`/
  `url()` that reject empty strings), so a field once set cannot currently be cleared back
  to blank via the UI. Not required by the brief; noted for a future sprint.

## 8. Deferred / Future Work

Everything on the brief's explicit out-of-scope list: logo upload, user management,
invitations, role management, permission management, feature flags, subscriptions,
billing, notification settings, email templates, multiple organisations, organisation
switching, public organisation profiles, API keys, cloud storage, dashboard widgets. Per
the backlog, Sprint 2.2 (User & Invitation Management) is next.

## 9. Documentation Consistency Follow-Up

A follow-up pass reconciled `docs/domains/identity.md` (and swept the rest of `docs/` for
related staleness) with what this sprint actually shipped:

- **`docs/domains/identity.md`**:
  - Top status line: now lists Sprint 2.1 (Organisation Profile API + frontend) alongside
    1B.1/1B.2, and narrows the "no RBAC evaluation" claim to note Sprint 2.1's role-name
    check specifically, rather than implying nothing authorization-related exists.
  - §3 Organisation Profile table: added a **Display Name** row.
  - §6 RBAC strategy: added a note explaining `RolesGuard` is a deliberately narrower first
    step, not the permission-key engine this section describes.
  - §9 Prisma schema: added `displayName String?` to the `Organisation` model block.
  - §10 Organisations table: rewritten to the actual shipped shape — `/api/organisation/me`
    (singular, not the previously-sketched plural `/organisations/me`), the real wire field
    names, the Owner/Administrator-only `PATCH` authorization, and an explicit note that
    (unlike the rest of §10) this subsection reflects the real implementation, not a sketch.
  - The `organisationCode` immutability cross-reference in §3 was updated to the new path.
- **`docs/roadmap.md`**: Phase 1 gained a checked "Organisation Profile API (Sprint 2.1)"
  line; the "RBAC evaluation + permission guards" and "Role/organisation/user-management API
  surface" bullets were annotated to reflect partial progress rather than left implying zero
  progress.
- **`docs/database/README.md`**: added the `displayName` column and its migration to the
  Migrations table, and corrected the summary paragraph that previously claimed "no ...
  role/organisation/user-management APIs exist yet" — no longer true after this sprint.
- **No changes needed** to `docs/domains/identity.md` §8 (Audit Strategy) — `organisation.updated`
  was already documented there from the original design, so no discrepancy existed. Historical
  sprint completion reports (1A, 1B.1, 1B.2, 1B.3) were left untouched, as they are point-in-time
  records, not living documents.
