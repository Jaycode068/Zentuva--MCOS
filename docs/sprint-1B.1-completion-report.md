# Sprint 1B.1 Completion Report — Identity Domain Implementation (Database & Domain Layer)

**Sprint:** 1B.1 — Identity Domain Implementation (Database & Domain Layer)
**Date:** 2026-07-29
**Scope:** Prisma schema, migration, seed data, repository layer, service skeletons, shared Zod
schemas. No authentication, JWT, login, controllers, guards, Swagger, or frontend — per the Sprint
1B.1 brief.

## Summary

The Identity Domain's persistent foundation is implemented exactly per the approved design in
[`docs/domains/identity.md`](domains/identity.md): all 11 entities, real migrations against a live
Postgres database, a working seed script, a thin repository layer, and service skeletons wired
into a real NestJS module with dependency injection. Every verification item in the Sprint 1B.1
acceptance criteria was actually executed and observed to pass — not just inspected — including
booting the compiled application and confirming the full Identity provider graph resolves at
runtime.

## Models implemented

All 11 entities from `identity.md` §9, in `apps/api/prisma/schema.prisma`:

Organisation, User, Role, Permission, UserRole, RolePermission, Invitation, Session,
RefreshToken, PasswordResetToken, AuditLog — plus the 3 enums (`OrganisationStatus`, `UserStatus`,
`InvitationStatus`). Every field, relation, index, and constraint matches the documented schema,
including the Sprint 1A.1 refinements (`organisationCode`, `employeeCode`, `UserStatus.LOCKED`).

The old placeholder `HealthCheck` model (added in Sprint 0 solely so `prisma generate` had at
least one model to work with) was removed — `GET /api/health` is unaffected, since it verifies
connectivity with a raw `SELECT 1`, not a model query.

Soft delete is implemented exactly as the design specifies: via `OrganisationStatus`/`UserStatus`
enums (`CLOSED`/`DEACTIVATED` are the terminal states — identity.md §4), not a separate
`deletedAt` column. The design doc never specifies the latter, so adding one would have been a
deviation, not a refinement.

## Migrations created

| Migration                                      | Content                                                                                                      |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `20260728195709_init` (Sprint 0, pre-existing) | Created the placeholder `_health_check` table                                                                |
| `20260729182400_init_identity_domain`          | Drops `_health_check`; creates all 11 Identity Domain tables, 3 enums, and every documented index/constraint |

**How the migration was created (a note on tooling, not the schema):** `prisma migrate dev` — the
command the brief names — refuses to run in this session's non-interactive shell, a pre-existing,
documented limitation (see [Sprint 0's troubleshooting guide](development/local-development.md#docker-troubleshooting)),
not something specific to this sprint. A real developer at an actual terminal will not hit this.
The migration was produced using Prisma's own documented non-interactive-safe equivalent:
`prisma migrate diff --from-url <DATABASE_URL> --to-schema-datamodel prisma/schema.prisma --script`
to generate the SQL, written into a correctly-timestamped migration folder, then applied with
`prisma migrate deploy`. The resulting migration folder, SQL content, and `_prisma_migrations`
tracking row are indistinguishable from what `migrate dev` would have produced — verified with
`prisma migrate status` reporting "Database schema is up to date."

Verified:

```bash
pnpm prisma validate   # ✅ "The schema at prisma/schema.prisma is valid"
pnpm prisma generate   # ✅ Prisma Client generated
pnpm prisma migrate status   # ✅ "Database schema is up to date!"
```

All 11 tables confirmed present via `psql \dt` and visually in Prisma Studio (see
[Testing](#testing) below).

## Seed data

`apps/api/prisma/seed.ts`, run via `pnpm db:seed` (`prisma db seed` → `ts-node prisma/seed.ts`).
Seeds, idempotently (safe to re-run):

- **Organisation:** "Boby Bites" (`slug: boby-bites`, `organisationCode: BBT-0001`, `country:
Nigeria`, `status: ACTIVE`).
- **System roles:** `Owner`, `Administrator`, `Member` (all `isSystem: true`).
- **Permission catalog:** all 7 permissions documented in identity.md §6 (`identity.users.read`,
  `identity.users.update`, `identity.invitations.create`, `identity.invitations.revoke`,
  `identity.roles.manage`, `identity.roles.assign`, `identity.audit-logs.read`), all granted to
  `Administrator`. `Owner` deliberately gets no explicit `RolePermission` rows, per identity.md §6
  ("Owner bypasses RolePermission entirely").
- **Admin user:** the organisation's first user, assigned the `Owner` role. Password is hashed
  with `argon2id` (added as a new dependency — see [Deviations](#deviations-from-design)).

**No credentials are hardcoded.** `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` are required
environment variables (documented in `apps/api/.env.example`); the script throws a clear error and
exits non-zero if either is missing. Verified both paths: a successful run with them set, and a
failure with a clear message when `SEED_ADMIN_EMAIL` was temporarily removed from `.env`.
`SEED_ADMIN_FIRST_NAME`/`SEED_ADMIN_LAST_NAME` are optional, defaulting to "Organisation Owner".

## Repository structure

Six repositories, one per aggregate, each a thin `@Injectable()` class encapsulating Prisma access
with no business logic (`apps/api/src/identity/<aggregate>/<aggregate>.repository.ts`):

| Repository               | Covers                                                                 |
| ------------------------ | ---------------------------------------------------------------------- |
| `OrganisationRepository` | Organisation                                                           |
| `UserRepository`         | User                                                                   |
| `RoleRepository`         | Role, RolePermission, and read access to the global Permission catalog |
| `InvitationRepository`   | Invitation                                                             |
| `SessionRepository`      | Session, RefreshToken                                                  |
| `AuditRepository`        | AuditLog                                                               |

**Tenant-safety convention** (identity.md §7, made concrete at this layer): every method that
reads or writes a specific tenant-scoped row takes `organisationId` and includes it in the Prisma
`where` clause — not because IDs could collide (they're globally unique cuids) but so a request
authenticated for one organisation can never touch another organisation's row, even by guessing or
knowing its ID. Tenant-scoped **updates** use a `updateMany({ where: { id, organisationId } })` +
re-fetch pattern rather than `update({ where: { id } })`, because Prisma's `update` only accepts
unique fields in `where` and `(id, organisationId)` isn't a declared composite unique — `updateMany`
has no such restriction and doubles as the tenant check. Three deliberate, documented exceptions
exist where a global (non-tenant-scoped) lookup is structurally necessary because no tenant context
exists yet: `UserRepository.findByEmail` (login), `InvitationRepository.findByTokenHash`
(invitation acceptance), and the `Permission` catalog reads on `RoleRepository` (identity.md §7,
the one genuinely global table).

## Domain services

Six services, one per repository, in the same folder structure, wired into a new `IdentityModule`
(`apps/api/src/identity/identity.module.ts`) and imported into `AppModule`. No controllers — the
module exposes no HTTP surface yet.

**Convention applied uniformly** (stated in each service file's header comment): pure reads and
plain data mutations with no authentication/authorization/token concerns are implemented for real,
delegating to the repository. Methods that require password hashing, token generation/validation,
or session issuance — i.e. the actual login/logout/registration/invitation-acceptance/refresh
mechanics — are signature-only stubs (full TypeScript param/return types, matching identity.md
§10's API contract) that reject with a clear "not implemented in Sprint 1B.1" error via a shared
`notImplemented()` helper. `AuditService` is the one service implemented in full — recording an
event is pure insert, no auth logic, and every future domain is expected to call it.

| Service               | Real methods                                                                                                                         | Stubbed methods                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `OrganisationService` | getById, getBySlug, updateProfile, suspend, reactivate, close                                                                        | register                                                                                    |
| `UserService`         | getById, getByEmail, listByOrganisation, updateProfile, updateStatus, recordLogin                                                    | createFromRegistration, createFromInvitationAcceptance, verifyPassword                      |
| `RoleService`         | getById, listByOrganisation, createCustomRole, updateRole, deleteRole, setRolePermissions, getPermissionsForRole, listAllPermissions | — (none; role/permission data management has no auth mechanics of its own — see note below) |
| `InvitationService`   | getById, listByOrganisation, revoke                                                                                                  | create, validateToken, accept                                                               |
| `SessionService`      | listActiveByUser, getById                                                                                                            | create, revoke, revokeAllForUser, rotateRefreshToken                                        |
| `AuditService`        | record, listByOrganisation, countByOrganisation                                                                                      | — (fully implemented)                                                                       |

Note on `RoleService`: creating/editing/deleting roles and assigning permissions is data
management, not permission **evaluation** (deciding whether the _current caller_ is allowed to do
this is a future authorization guard's job, not this service's) — so it's implemented for real,
including basic domain invariants like "system roles can't be edited" (enforced in
`RoleRepository`). This is distinct from `Owner`'s "bypasses `RolePermission`" behaviour, which
_is_ an authorization-evaluation concern and is correctly left unimplemented.

`SessionService` is the one service where every write is stubbed, not just the auth-adjacent
subset — because for Session/RefreshToken, every write **is** login/logout/refresh-token mechanics
by definition (identity.md §5), unlike the other aggregates where writing the row and authorizing
the action are separable concerns.

## Validation completed

`packages/validation/src/identity.ts` — Zod schemas for every documented endpoint in identity.md
§10 (registration, organisation profile update, login, refresh, forgot/reset password, user
profile/status update, invitation create/accept, role create/update, role assignment), plus enum
schemas mirroring the three Prisma enums. Exported from the package's `index.ts`. Not yet imported
by any controller or DTO — per the brief, these exist for future use.

Also verified: `pnpm --filter @zentuva/validation run type-check`, `lint`, and `build` all pass.

## Deviations from design

1. **`PasswordResetToken` was implemented even though the Sprint 1B.1 brief's "Required entities"
   list omits it.** The approved design (identity.md §9) includes it as part of the same schema,
   with a documented relation from `User`. The brief's constraints target password-reset _logic_
   ("Do not implement... Password reset"), not the table's existence — the same pattern the brief
   itself applies to `Session`/`RefreshToken` (required, but with no login/JWT logic operating on
   them yet). Omitting the table would have left a dangling relation relative to the documented
   schema. No repository or service was created for it — nothing calls it yet, so building one
   speculatively would have been scope creep in the other direction.
2. **System role naming: "Administrator", not "Admin".** The Sprint 1B.1 brief explicitly names
   the seed roles "Owner, Administrator, Member," while identity.md (Sprint 1A/1A.1) had used
   "Admin". Since this brief states the design doc is "the single source of truth" and explicitly
   permits updating it when "implementation reveals a genuine discrepancy," and since the
   Organisation Registration fields (§3) and `POST /auth/register` contract (§10) already said
   "Administrator Name"/"Administrator Email"/`adminEmail` — the doc was already internally
   inconsistent on this exact point. **Resolution:** seeded the role as "Administrator" and
   updated every role-name reference in `identity.md` (prose, tables, all three affected sequence
   diagrams) to match, leaving generic/unrelated uses of the word "admin" (e.g. `adminFirstName`,
   "platform-admin approval") untouched. This is a label rename only — no schema, relationship, or
   behavioural change, so it does not constitute redesigning the domain.
3. **Added `argon2` as a new dependency**, not previously part of any approved design artifact.
   `User.passwordHash` is a required (`NOT NULL`) column and the brief explicitly requires seeding
   a real admin user with a real password from an env var — populating that column with a properly
   hashed value (rather than a placeholder string masquerading as a hash) is the only responsible
   way to satisfy that requirement, and matches the hashing algorithm already assumed in the
   [Sprint 1A design report](sprint-1A-identity-design-report.md#assumptions). This is a seed-data
   concern, not authentication logic — no login endpoint or password-verification code was added.

No other deviations. Every relationship, index, constraint, and naming convention matches
identity.md §9 exactly.

## Known limitations

- **No controllers, guards, or HTTP surface** — entirely out of scope this sprint, as instructed.
  `IdentityModule` exports its services but nothing consumes them yet.
- **No automated tests.** The brief explicitly scoped testing to manual verification ("migration
  succeeds, seed succeeds, ... lint/type-check/build pass") and excluded authentication tests. Unit
  tests for the repository layer (e.g. the tenant-isolation `updateMany` pattern) would be
  valuable before Sprint 1B.2 builds real auth logic on top — flagged as a recommendation, not
  done here since it wasn't asked for.
- **`SessionService`/most of `InvitationService`/`OrganisationService.register`/most of
  `UserService` are stubs**, by design — see [Domain services](#domain-services) above. Calling
  any stub throws immediately; nothing silently no-ops.
- **The seed script is not fully idempotent for `AuditLog`.** Organisation/roles/permissions/user
  are all upserted (safe to re-run), but each run inserts a fresh `organisation.seeded` audit
  entry, since `AuditLog` is insert-only by design (identity.md §4) — re-running the seed multiple
  times during this sprint's verification produced multiple audit rows. This is expected behaviour
  for an audit log, not a bug, but worth knowing if you seed a shared environment repeatedly.
- **`Prisma migrate dev` cannot run in this tool's non-interactive shell** — see
  [Migrations created](#migrations-created) above. Purely a sandboxed-environment limitation, not
  a defect; a developer at a real terminal is unaffected.

## Testing

All acceptance criteria executed and observed to pass, not just inspected:

| Check                            | Result                                                                                                                                                                                            |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Migration succeeds               | ✅ `prisma migrate status` → "Database schema is up to date!"                                                                                                                                     |
| Seed succeeds                    | ✅ Run twice successfully; failure path (missing env var) also verified                                                                                                                           |
| Prisma Studio shows all entities | ✅ All 11 models visible; row counts match seed data exactly (Organisation: 1, Role: 3, Permission: 7, RolePermission: 7, User: 1, UserRole: 1); Organisation row inspected and confirmed correct |
| Repositories compile             | ✅ `tsc --noEmit` clean across the whole monorepo                                                                                                                                                 |
| Lint passes                      | ✅ `pnpm lint` — 9/9 packages clean                                                                                                                                                               |
| Type-check passes                | ✅ `pnpm type-check` — 9/9 packages clean                                                                                                                                                         |
| Build passes                     | ✅ `pnpm build` — clean from a fully wiped `dist`/`.next`/`.turbo` state                                                                                                                          |

Additionally (beyond the stated acceptance criteria, for extra confidence): booted the compiled
`apps/api/dist/main.js` and confirmed `IdentityModule dependencies initialized` in the Nest boot
log — i.e. all 6 repositories and 6 services resolve through real dependency injection at runtime,
not just at compile time — with `GET /api/health` still returning `200`.
