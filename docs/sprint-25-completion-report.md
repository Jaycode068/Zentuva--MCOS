# Sprint 25 Completion Report — Configurable Access Control & Organisational Structure

## 1. Objective

Build a real, fine-grained, tenant-isolated, deny-by-default authorization system on
top of the `Role`/`Permission`/`RolePermission`/`UserRole` tables Identity's Sprint 1A
design described and Sprint 1B.1 seeded but that no guard in the codebase had ever
actually read — every endpoint added since then checked a hardcoded role name
(`@Roles('Owner', 'Administrator')`) instead. Explicitly not Workflow or Notifications
this sprint, but designed so both can reuse this foundation later. Full detail in the
new [docs/domains/access-control.md](domains/access-control.md); this report covers
what changed, how it was verified, and what remains deferred.

## 2. Starting State

- `Permission`/`Role`/`RolePermission`/`UserRole` existed in Prisma, seeded with
  Identity's own permission keys (Sprint 1B.1), read by nothing.
- Every mutation endpoint used `RolesGuard`/`@Roles(name)` or no authorization check
  at all beyond `JwtAuthGuard`.
- HR's Sprint 23/24 docs explicitly flagged this as the "Sprint 25" integration point
  ([hr.md §9](domains/hr.md#9-access-control-preparation-for-sprint-25)/§19).
- 169 test suites, ~1454 tests passing (pre-Sprint-25 baseline).

## 3. Architecture Decisions

- **Permission key format**: `module.resource.action`, extending
  [identity.md §6](domains/identity.md#permission-naming-convention)'s original
  convention (which had used `identity.users.read`-style two-level naming) into a
  fully three-level scheme, backfilled onto the existing Identity permission rows via
  the migration.
- **Scope as a first-class enum with an explicit "granted but scoped to nothing"
  value** (`NONE`), rather than treating an absent scope as unrestricted — the single
  most load-bearing design decision in the sprint, directly required by the brief
  ("do not interpret an absent scope as unrestricted access") and exercised
  end-to-end by the Finance Staff `payment.create` example.
- **Two independent guards, not one** — `PermissionsGuard` (role/permission-based)
  and `CommonAccessGuard` (organisation-level self-service toggle) are separate
  because they answer different questions ("is this granted to this user's roles" vs.
  "has this organisation turned this capability off for everyone") and a self-service
  endpoint needs both to pass.
- **Coexistence, not replacement, of the old `RolesGuard`** — migrating every
  endpoint in one sprint was explicitly out of scope; the old and new systems run
  side by side, with the split documented exhaustively in
  [access-control.md §10](domains/access-control.md#10-authorization-enforcement-pattern).
- **HR dependency stays one-directional** — `EffectiveAccessResolver` reads only
  `User.status`; `EmployeeService` proactively pushes status changes into `User` on
  suspend/separate, rather than Access Control reading `Employee.employmentStatus`
  directly. Full reasoning in
  [access-control.md §9](domains/access-control.md#9-multiple-roles--effective-permission-resolution).
- **A new top-level `access-control` module**, not code inside `identity/` — matches
  the established "one module per top-level directory" convention
  (`assets/`, `maintenance/`, `hr/`), and keeps the reusable engine
  (`EffectiveAccessResolver`/`PermissionsGuard`, in `identity/`) separate from the
  admin-UI-specific composition layer (`access-control/`).

## 4. Database Changes (one additive migration)

`Role.status` (`RoleStatus` enum, default `ACTIVE`); `Permission.resource`,
`Permission.action`, `Permission.scopeType` (`PermissionScopeType` enum, default
`NONE`); new `AccessScope` enum; `RolePermission.scope` (nullable `AccessScope`).
Migration `20260913074524_sprint25_access_control_scope_permission_extensions`,
hand-edited: add nullable → backfill `resource`/`action` via `split_part(key, '.', n)`
→ set `NOT NULL`, safe against the pre-existing seeded rows. Applied and verified.

## 5. Permission Catalogue

`identity/authorization/permission-catalogue.ts` — **88 entries** across 12 modules.
Full listing, module-level-vs-resource-level clarification, and the deliberately
deferred interface/channel-restriction field are documented in
[access-control.md §4](domains/access-control.md#4-permission-model).

## 6. Role Model

`Role.status` (`ACTIVE`/`ARCHIVED`, reversible archive), `isSystem` unchanged from
Sprint 1A (Owner/Administrator/Member, protected from edit/archive/rename). Full CRUD

- duplicate + archive/restore + permission-set, all via `RoleService`/
  `RoleRepository`, covered by `role.service.spec.ts` (11 tests). Detail in
  [access-control.md §5](domains/access-control.md#5-role-model).

## 7. Scope Model

`AccessScope` (8 values including `NONE`). Honest, two-tier enforcement — genuinely
filtered where provable (HR employee list's `OWN_TEAM`/`DEPARTMENT`, self-service
`OWN_RECORDS`), recorded-and-previewable-but-not-yet-filtered elsewhere
(`ASSIGNED_TERRITORY`/`ASSIGNED_ASSETS`). Full detail, including why this split is
deliberate rather than incomplete, in
[access-control.md §6](domains/access-control.md#6-scope-model).

## 8. Authorization Architecture

`EffectiveAccessResolver` (union-of-active-roles resolution, Owner bypass,
`User.status`-gated), `ScopeEvaluator`, `PermissionsGuard`/`@RequirePermission`,
`CommonAccessGuard`/`@RequireCommonAccess`. Full design, including the NestJS
provider-export bug this sprint found and fixed while building it, in
[access-control.md §9](domains/access-control.md#9-multiple-roles--effective-permission-resolution)–[§14](domains/access-control.md#14-schema-migration--implementation-notes).

## 9. Protected Domains & Routes

21 endpoints across Procurement, Inventory, HR, Production, Finance, and Maintenance
migrated to `@RequirePermission` this sprint (full table in
[access-control.md §10](domains/access-control.md#10-authorization-enforcement-pattern)),
covering the brief's named high-risk list: posting journal entries, issuing/cancelling
invoices, creating/cancelling payments, creating/cancelling purchase orders, receiving
goods, issuing production materials, completing production orders, completing
maintenance work orders, separating employees, and every access-control admin action
itself. Every other domain's mutation endpoints remain on the pre-existing
`RolesGuard`/`@Roles` check — an exhaustive list of what's migrated vs. not is
maintained as living documentation in access-control.md §10 rather than duplicated
here, since that list will keep growing after this sprint.

**One honest finding from live verification, not caught by design review**: several
`GET` endpoints (e.g. `finance/trial-balance`, `sales/orders`) carry only
`JwtAuthGuard` — no role or permission check at all, predating this sprint.
Documented, not silently left implicit.

## 10. UI Routes

`/settings/access` (Overview), `/settings/access/roles` + `/settings/access/roles/:id`
(Roles + detail/permission-grid editor), `/settings/access/users` (User Access +
Effective Access Preview dialog), `/settings/access/common-policy` (Common Employee
Access), and `/settings/access/audit-log` (Access Review — added mid-sprint once live
verification surfaced that the audit trail had no viewer at all; backs the
`identity.audit-logs.read` permission that had been in the catalogue since it was
first written but served by nothing). Desktop-first, usable on smaller screens, not a
Field Sales/Technician mobile workflow — per the brief.

## 11. Seed Data

13 roles, 88 permissions, 167 role-permission grants, 12 user-role assignments across
6 users for Boby Bites (0 without any role, 4 with multiple roles) — including the
required combined-role demonstration (Folake Adewale: Production Manager +
Maintenance Manager + Employee Self-Service) and restricted-Finance demonstration
(Emeka Nwachukwu: Finance Staff, explicitly no journal-posting/invoice-issuing
access). Idempotent — verified by running the seed twice consecutively and confirming
identical row counts both times. Full breakdown in
[access-control.md §13](domains/access-control.md#13-seed-data).

## 12. Tests Added

| File                                                                                                | Tests |
| --------------------------------------------------------------------------------------------------- | ----- |
| `identity/authorization/effective-access-resolver.spec.ts`                                          | 12    |
| `identity/auth/guards/permissions.guard.spec.ts`                                                    | 4     |
| `identity/auth/guards/common-access.guard.spec.ts`                                                  | 4     |
| `identity/role/role.service.spec.ts`                                                                | 11    |
| `access-control/access-control-independence.spec.ts`                                                | 8     |
| `hr/employee.service.spec.ts` (appended: suspend/separate → User.status sync, reactivate asymmetry) | 5     |

**44 new tests**, all passing.

## 13. Full Test Count / Typecheck / Lint / Build Results

- **Test suite**: `pnpm --filter api test` → **174 suites, 1471 tests, all passing**
  (re-run after live verification's DB mutations, confirming zero regressions from
  either the new code or the manual testing performed against the real dev database).
- **API typecheck**: `pnpm --filter api exec tsc --noEmit` → clean, no errors.
- **Web typecheck**: `pnpm --filter web exec tsc --noEmit` → clean, no errors.
- **API lint**: `pnpm --filter api lint` → 0 errors, 27 pre-existing warnings in
  unrelated Finance budgeting spec files (`no-explicit-any`/`no-unused-vars`),
  untouched by this sprint.
- **Web lint**: `pnpm --filter web lint` → clean, 0 warnings/errors.
- **API build**: dev server boots cleanly with every `/api/access/*` route mapped
  (confirmed via live log inspection after fixing the DI export bug, §14 below).
- **Web build**: dev server serves `/settings/access/*` cleanly after a `.next` cache
  clear (a recurrence of a known stale-build-cache issue from earlier in this
  session, unrelated to Sprint 25's own code).

## 14. Bugs Found and Fixed During Implementation

1. **NestJS DI boot failure** — `AuthModule` attempted to re-export
   `EffectiveAccessResolver`/`ScopeEvaluator` without declaring them as its own
   providers (`"Nest cannot export a provider/module that is not a part of the
currently processed module"`). Fixed by removing the invalid export — a guard's
   own dependencies resolve from its home module's container regardless of which
   module consumes the guard. Full explanation in
   [access-control.md §14](domains/access-control.md#14-schema-migration--implementation-notes).
2. **Pre-existing `OrganisationService.updateWorkspaceSettings` bug** — silently
   discarded every other `Organisation.settings` key on a theme/preferences patch,
   which would have made the new Common Employee Access policy non-durable. Fixed
   with a one-line spread-merge, in-scope since it directly blocked this sprint's own
   feature.
3. **Orphaned `identity.audit-logs.read` permission** — existed in the catalogue and
   was granted to Administrator, but no endpoint served a read of the audit log at
   all. Fixed by adding `AccessAuditLogController` + the Access Review UI tab (§10).

## 15. Live Verification Performed

Ten scenario groups, performed against the running dev servers with real tokens and
the real seeded database, state restored and independently re-confirmed afterward.
Full narrative, including exact requests/responses, in
[access-control.md §17](domains/access-control.md#17-live-verification-performed):
role detail page (permission grid + scopes), User Access page + Effective Access
Preview (both the combined-role and restricted-Finance users), immediate role-removal
revocation, direct-API-call proof of enforcement (bypassing the UI entirely), Common
Employee Access enforcement (toggle → immediate 403 → toggle back → immediate
restore), tenant isolation (a freshly registered second organisation), suspended-
employee revocation against an already-issued still-valid token (and the deliberate
reactivate-asymmetry), audit-log correctness, and a full post-verification regression
run.

## 16. Accounting & Inventory Safety

No change to any accounting/inventory/production business logic — this sprint only
adds an authorization check _in front of_ existing mutation handlers (a 403 either
happens before the handler runs, or the handler runs exactly as it did before this
sprint). Verified by the unchanged full financial/inventory/production test suite
passing (§13) and by `access-control-independence.spec.ts` proving the new module
never imports or writes to any accounting/inventory/production table.

## 17. Tenant Isolation

Every new repository method takes `organisationId` explicitly; `Permission` rows are
the one global (non-tenant-scoped) table, by design — the catalogue is code, identical
across tenants. Live-verified against a freshly registered second organisation (§15);
full detail in
[access-control.md §7](domains/access-control.md#7-default-denial--tenant-isolation).

## 18. Documentation Updated

- New: [docs/domains/access-control.md](domains/access-control.md) (the domain doc).
- New: this report.
- [docs/domains/README.md](domains/README.md) — new table row.
- [docs/domains/hr.md](domains/hr.md) — §9/§19 note that Sprint 25 has now
  implemented the fine-grained permission engine those sections anticipated.
- [docs/domains/identity.md](domains/identity.md) — §6 note that Sprint 25
  implemented the RBAC design this section originally specified, extended with the
  scope model.
- [docs/backlog.md](backlog.md), [docs/roadmap.md](roadmap.md),
  [docs/changelog.md](changelog.md) — Sprint 25 entries.
- Root [README.md](../README.md) — domain list update.

## 19. Final Quality Gate

- [x] 174/174 test suites passing, 1471/1471 tests passing
- [x] API and web typecheck clean
- [x] API and web lint clean (pre-existing warnings only, unrelated to this sprint)
- [x] Both dev servers boot/serve cleanly
- [x] Live-verified in browser and via direct API calls, not just unit tests
- [x] Tenant isolation live-verified against a real second organisation
- [x] Immediate revocation (role removal and employee suspension) live-verified
      against already-issued tokens, not just at next login
- [x] Audit trail live-verified for every access-control action performed
- [x] Seed idempotency verified (two consecutive runs, identical counts)
- [x] All test/verification state restored to the original seed baseline, confirmed
      by direct database query
- [x] No commit or push performed

## 20. Deferred by Design

Full list of deliberately deferred capabilities (scope filtering for
territory/asset-assignment scopes, interface/channel restriction, role-CRUD audit
events, the remaining un-migrated endpoints, read endpoints on neither guard) in
[access-control.md §16](domains/access-control.md#16-known-deferred-capabilities-honest-limitations-not-oversights).
Explicit non-goals (Workflow, Notifications, Payroll, Leave Management, Recruitment,
Performance Management, biometric attendance, geofencing, full self-service portal,
automatic role assignment, complex ABAC, external IdPs/SSO, delegation, acting
appointments, policy-as-code, cross-tenant administration) in
[access-control.md §18](domains/access-control.md#18-explicit-non-goals-this-sprint).

## 21. Architectural Decisions & Trade-offs (summary)

The central trade-off this sprint made repeatedly: **build a smaller number of things
completely and honestly, rather than a larger number of things partially and
optimistically.** 88 permissions covering what's actually implemented, not hundreds
speculatively; scope enforcement that's real where provable and explicitly marked
"recorded, not yet filtered" everywhere else; 21 migrated endpoints with an exhaustive
public list of what's _not_ migrated, rather than a vague "authorization added"
claim. Every place this document says "not yet enforced" or "not built" was a
deliberate choice to under-claim rather than let the UI or documentation imply more
security than the code actually provides — the single principle the brief's own
"do not pretend to enforce a scope that cannot be proven" instruction generalizes to
everything else in this sprint.

## 22. Repository State

**No commit or push was performed.** All Sprint 25 changes remain uncommitted in the
working tree, per the brief's explicit instruction.
