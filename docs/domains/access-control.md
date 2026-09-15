# Access Control — Configurable Roles, Permissions & Organisational Structure Integration

> **Sprint 25.1 update:** application-wide authorization coverage — endpoint
> inventory, legacy `RolesGuard` migration (261 → 0 remaining), new
> `OWN_TEAM`/`OWN_RECORDS` scope enforcement, and 33 new permission-catalogue
> entries (88 → 121) — is documented in full in
> [docs/architecture/authorization-coverage.md](../architecture/authorization-coverage.md).
> This document still describes the foundational model Sprint 25 built; it is
> updated in place only where Sprint 25.1 corrected an inaccuracy (§12) or
> extended something already described here (§6). For "what changed this
> sprint and why," read the coverage doc and
> [docs/sprint-25.1-completion-report.md](../sprint-25.1-completion-report.md)
> first.

Sprint 25. This domain finally wires up the `Role`/`Permission`/`RolePermission`/
`UserRole` tables that Identity's Sprint 1A design ([identity.md §6](identity.md))
described and Sprint 1B.1 seeded but that no guard anywhere in the app actually read —
every mutation endpoint added since then checked a hardcoded role **name**
(`@Roles('Owner', 'Administrator')`) rather than a granted permission. This sprint adds
a real permission-key evaluation engine, a scope model, a Common Employee Access
policy, an admin UI at `/settings/access`, and migrates the highest-risk mutation
endpoints across the codebase onto it — without rewriting every domain, without
building Workflow/Notifications, and without inventing a second employee hierarchy on
top of HR's existing one.

## 1. Domain Purpose

Answer, for any user in any organisation, on every request: **can this specific user
perform this specific action, right now, and if the action reads data, how much of it
can they see?** Deny by default — a route with no explicit grant check denies nothing
extra (it's simply not yet migrated, see §10), but a route that _does_ check a
permission never falls back to "allow because unclear."

This is infrastructure, not a feature end-users see directly (aside from the admin UI).
Every future domain — and, explicitly, future Workflow approval routing and
Notification recipient resolution — is expected to consume `EffectiveAccessResolver`
and `PermissionsGuard` rather than re-deriving authorization logic.

## 2. User vs. Employee (recap)

Unchanged from [hr.md §2](hr.md#2-employee-vs-user--the-central-distinction):
`User` (Identity) is a login credential; `Employee` (HR) is a person record. Access
Control assigns roles to **Users** (`UserRole.userId → User.id`), never to Employees —
a `Role` has no meaning for someone who has no login. The one place this domain reads
`Employee` at all is the admin UI's User Access page, which displays an employee's
department/position/manager/employment-status _alongside_ their roles for the
administrator's context (see §12's `AccessControlModule` note) — it never grants
access based on that data.

## 3. Department vs. Position vs. Role

Unchanged from [hr.md §3](hr.md#3-department-vs-position-vs-access-role): `Department`
and `Position` (HR) describe where someone sits in the org chart and what their job
title is. `Role` (Access Control/Identity) describes what they can do in the system.
**Nothing in this sprint derives a `Role` from a `Department`, `Position`, job title,
or manager relationship** — access is only ever what an administrator explicitly
assigned via `POST /access/users/:userId/roles`. A newly onboarded "Production
Manager" (the job title) has zero system access until someone explicitly assigns the
"Production Manager" role (the access grant) — they happen to share a name in the seed
data (§13) purely for readability, not because one implies the other.

## 4. Permission Model

### Structure

`Permission.key` = `<module>.<resource>.<action>` (e.g. `finance.journal.post`,
`hr.employee.view`, `production.material_issue.create`), extending
[identity.md §6's naming convention](identity.md#permission-naming-convention)
unchanged. Each `Permission` row also carries `domain` (the module, e.g. `finance`),
`resource`, and `action` as separate columns (backfilled from `key` by the migration,
§14) so the admin UI can group the catalogue by module without string-parsing on every
read.

### The catalogue

`apps/api/src/identity/authorization/permission-catalogue.ts` — **121 permissions**
(88 at Sprint 25 launch; +33 in Sprint 25.1 closing genuine gaps for actions the app
already had but the original catalogue hadn't caught up to yet — full list and
rationale in [authorization-coverage.md §7](../architecture/authorization-coverage.md#7-permission-mapping-rules-applied-this-sprint))
across 14 modules (Identity, Access Control, Finance, Procurement, Inventory,
Production, Product Catalogue, Sales, Distribution, Retail Network, Assets,
Maintenance, HR-admin, HR-self-service). This
is a deliberately curated MVP set, not an exhaustive one — it covers every domain that
exists as of Sprint 25's most consequential actions (every mutation endpoint listed in
§10), plus the read permissions needed for the Effective Access Preview to be
meaningful, **not** every CRUD combination for every entity in the schema. Adding a
permission later is additive: append an `entry(...)` call, no migration needed (the
catalogue is code, not seeded rows the schema depends on — see §14).

### Module-level vs. resource/action-level access

Granting a user any permission in a module (e.g. `finance.trial_balance.view`) never
implies any other permission in that module. There is no module-level "on/off" switch
separate from the individual permission grants — a role's access to a module is simply
the union of whichever of that module's permission keys it happens to hold. This is
why Finance Staff (§13) can view the trial balance and record customer payments but
cannot post journal entries or issue invoices: each is a distinct, independently
granted key.

### `scopeType`: `NONE` vs. `SCOPABLE`

Every `Permission` has a `scopeType`:

- **`NONE`** — organisation-wide the instant the `RolePermission` row exists. Used for
  actions where a narrower scope makes no practical sense (e.g.
  `access.role.manage`, `finance.chart_of_accounts.manage`, `hr.organisation_structure.manage`).
- **`SCOPABLE`** — the grant requires an explicit `RolePermission.scope` value. **An
  absent scope is never interpreted as unrestricted access** — see §6.

### Interface/channel restriction — not implemented

The brief allowed an optional interface/channel restriction (e.g. "web only," "mobile
only") per permission. **Not built.** Every permission in the catalogue applies
uniformly regardless of which frontend surface (desktop `/settings/*`, `/field`,
`/technician`, `/attendance`) a request originates from — the existing surface
separation (Sprint 22's Field Sales/Field Maintenance split) is a UI-routing decision,
not an access-control one, and no current requirement needs a permission that behaves
differently by channel. Documented here as a deliberately deferred catalogue field
rather than silently omitted — adding it later is an additive nullable column plus one
extra check in `PermissionsGuard`, not a redesign.

## 5. Role Model

### `Role`

`{ id, organisationId, name, description, isSystem, status }`. `status` is new this
sprint (`RoleStatus`: `ACTIVE | ARCHIVED`) — archiving a role is reversible (§8) and
distinct from deleting it, which this sprint never does (a role with historical
`UserRole`/`RolePermission` rows stays queryable for audit purposes even once
archived).

### System vs. tenant-configurable roles

`isSystem = true` marks exactly three roles per organisation — `Owner`,
`Administrator`, `Member` — seeded automatically at registration
([identity.md §6](identity.md#default-system-roles)), unchanged this sprint. System
roles cannot be renamed, archived, duplicated-over, or have their permissions edited
through this domain's endpoints (`AccessRoleController` 400s on any mutation attempt
against `isSystem = true`). Every other role is tenant-configurable: created, edited,
permission-adjusted, duplicated, and archived/restored freely by an administrator
through `/settings/access/roles`.

### Role name never determines behaviour

`PermissionsGuard` (§9) never inspects `Role.name`. A role named "Finance Staff" has
exactly the permissions someone explicitly checked on its detail page — nothing about
the string "Finance" is special-cased anywhere in the authorization path. The one
documented exception is `Owner`, which bypasses the `RolePermission` table entirely
(§6's Owner bypass, unchanged from Sprint 1A) — and that bypass checks
`Role.name === 'Owner'` specifically because `Owner` is the one role every
organisation is guaranteed to have exactly one of, seeded by the same code path that
creates the organisation, never user-renamable. No tenant-created custom role can ever
be named "Owner" a second time or acquire the bypass by renaming itself to match.

### Supported role operations

All exposed via `AccessRoleController` (`/access/roles/*`) and `/settings/access/roles`:
create, edit name/description, set permissions (bulk replace via
`setRolePermissions`), assign to user / remove from user (via `AccessUserController`,
§9's User Access page), view effective permissions (Effective Access Preview, §9),
duplicate (copies name-as-"X (copy)" plus every permission grant, never the user
assignments), archive (reversible — an archived role's holders keep their `UserRole`
rows but the role stops appearing in "assign a role" pickers and, being
`status: ARCHIVED`, is filtered out of `EffectiveAccessResolver`'s active-roles set,
so archiving a role **immediately** revokes everything it granted without deleting
anything), restore.

## 6. Scope Model

`AccessScope` enum: `ORGANISATION | OWN_RECORDS | OWN_TEAM | DEPARTMENT |
ASSIGNED_RECORDS | ASSIGNED_TERRITORY | ASSIGNED_ASSETS | NONE`.

For a `SCOPABLE` permission, `RolePermission.scope` records which of these the role
was granted at. **`NONE` is a real, meaningful scope value** — it means "this role has
the permission row, but restricted to nothing," not "no restriction was specified."
Finance Staff's `finance.payment.create → NONE` grant (§13) is the canonical example:
the permission exists on the role (visible, auditable, intentional — perhaps a
placeholder for a future narrower grant) but currently authorizes nothing.
`EffectiveAccessResolver.isGranted()` treats a `SCOPABLE` grant as "not granted" unless
at least one of its scopes is something other than `NONE` (`effective-access-resolver.ts`
lines 120–132).

### Honest enforcement — only where genuinely provable

**The scope engine does not pretend to enforce a scope it cannot prove from
server-side data.** Three categories exist in this codebase as of Sprint 25.1
(full detail: [authorization-coverage.md §9](../architecture/authorization-coverage.md#9-scope-model--semantics-preserved-enforcement-extended)):

1. **Genuinely filtered** — `hr.employee.view`'s `OWN_TEAM`/`DEPARTMENT` scopes
   (Sprint 25), real server-side `WHERE` filtering via the pre-existing
   `managerEmployeeId`/`departmentId` columns. **Extended in Sprint 25.1** to
   `hr.attendance.view` (same `managerEmployeeId`/`departmentId` mechanism) and
   `sales.order.view` (`OWN_TEAM` via the caller's direct reports' linked
   `User.id`s; `OWN_RECORDS` via the existing `salesAgentId` column). Precedence
   when a caller's union of roles grants more than one scope for the same
   permission: broadest-satisfiable-scope-wins — `ORGANISATION` > `OWN_TEAM` >
   `OWN_RECORDS`/`DEPARTMENT` > deny. Self-service `OWN_RECORDS` scopes
   (attendance/schedule/training/policy self-view) remain inherently
   self-filtered by construction, unchanged.
2. **Recorded and previewable, not yet mechanically filtered** — `ASSIGNED_TERRITORY`
   (Sales), `ASSIGNED_ASSETS` (Maintenance), `ASSIGNED_RECORDS` generally
   (except `sales.order.view`'s `OWN_RECORDS`, now implemented — see above).
   These scopes are real `AccessScope` enum values, assignable on any
   `SCOPABLE` permission, stored, and shown accurately in the Effective
   Access Preview ("granted at: Assigned Territory") — but no controller in
   this codebase yet applies a `WHERE`-style filter keyed off them, because no
   server-side relationship exists yet to prove them from (no `User`↔`Territory`
   or `User`↔`Asset` assignment table). **This is a documented, deliberate
   limitation, not a silent overclaim**: the UI never says "Assigned
   Territory (enforced)" or implies filtering that doesn't happen; a caller
   whose only granted scope is one of these gets an empty result set, never
   unrestricted access. Wiring the actual filter needs a new explicit
   assignment relationship first — deliberately out of scope for a hardening
   sprint (authorization-coverage.md §9).
3. **A real bug Sprint 25.1 found and fixed**: two `ledger.controller.ts` GET
   routes (`trial-balance`, `accounts/:id/activity`) were briefly mis-mapped
   to `finance.journal.view` during migration instead of
   `finance.trial_balance.view` during this sprint's own bulk migration pass
   — caught by live-testing Finance Staff's own seeded role description
   against the actual routes, not by inspection. Documented in
   authorization-coverage.md §8 as a reminder that "recorded doesn't mean
   correct" applies to the migration work itself, not just to unimplemented
   scopes.

## 7. Default Denial & Tenant Isolation

**Default denial**: `@RequirePermission(key)` with no matching active grant is always
rejected — `PermissionsGuard` throws `ForbiddenException` on any of: no
`RequirePermission` metadata match found in the resolver's active grants, a
`SCOPABLE` grant whose only scopes are `NONE`, or a caller whose `User.status` is not
`ACTIVE` (§9). There is no "allow if uncertain" branch anywhere in the guard.

**Frontend hiding is never the enforcement boundary.** Every admin-UI mutation (role
edit, permission grant, role assignment, policy toggle) calls a
`PermissionsGuard`-protected endpoint; hiding a button in the React UI for a user who
lacks the permission is a UX courtesy, not a security control — verified directly by
calling the underlying endpoints with `curl` and a token belonging to a
permission-less user (§17's live verification).

**Tenant isolation** — the same manual, explicit convention every domain in this
codebase uses ([identity.md §7](identity.md#7-tenant-isolation-strategy),
[hr.md §10](hr.md#10-tenant-isolation--audit)): every repository method takes
`organisationId` as an explicit parameter, present in every `where` clause; role/
permission-grant/assignment lookups are always scoped by the caller's own
`organisationId` (taken from their JWT, never from a request body/param). A
cross-organisation role id 404s ("Role not found in this organisation") exactly like a
nonexistent one — never leaks whether the id exists elsewhere. `Permission` rows
themselves are **not** organisation-scoped (the catalogue is global, defined by code,
identical across every tenant); `Role`/`RolePermission`/`UserRole` all are. Live-
verified (§17): a second, freshly registered organisation sees only its own 3 default
system roles, never Boby Bites' 13; a direct-by-id fetch of a Boby Bites role from the
second organisation's token returns the same "not found" 400 a nonexistent id would.

## 8. Common Employee Access

A configurable, **organisation-level** policy — not a role, not automatic just because
a `User` has a linked `Employee` — for a small, fixed set of self-service
capabilities: `selfSignIn`, `selfSignOut`, `viewOwnSchedule`, `viewOwnAttendance`,
`submitAttendanceCorrection`, `viewAssignedTraining`, `completeAssignedTraining`,
`viewApplicablePolicies`, `acknowledgePolicies`, `viewOwnProfile`. Stored as a new
`commonEmployeeAccess` sub-key inside the pre-existing `Organisation.settings` JSON
column (`common-access-policy.ts`'s `DEFAULT_COMMON_EMPLOYEE_ACCESS_POLICY`, merged
via the exact deep-merge pattern `workspace-settings.ts` already established for
theme/preferences — see §14's bugfix), all ten capabilities defaulting to `true` (the
pre-Sprint-25 behaviour — every employee could already do these things — this sprint
makes that switchable, not more restrictive by default).

**Layered on top of, not instead of, role-based permissions.** A capability being
enabled organisation-wide does _not_ itself grant access — the caller still needs the
corresponding permission (in practice, the `Employee Self-Service` role, §13, which
holds exactly these nine permission keys plus `hr.employee.self_view`). Disabling
`selfSignIn` here removes it for **every** employee regardless of their individual
role grants — a hard organisation-wide kill switch, e.g. for a company that decides to
stop self-service sign-in entirely and route all attendance through an administrator.
Enforced by `CommonAccessGuard`/`@RequireCommonAccess(capability)`, a guard
independent of `PermissionsGuard` — a self-service endpoint typically carries both
decorators (`hr/attendance.controller.ts`'s `signIn`/`signOut`/`submitCorrection`).

**Never grants administrative HR access or exposes other employees' records** — every
capability in the fixed list is inherently "about the caller's own record" by what it
does (self sign-in, self sign-out, view _own_ schedule, etc.); there is no capability
in this policy that can be toggled to expose another employee's data, by construction
of the fixed capability list rather than by a runtime check.

Live-verified (§17): disabling `selfSignIn` and calling `POST /hr/attendance/sign-in`
with a valid, previously-successful employee token immediately returns
`403 {"message":"This organisation has disabled the \"selfSignIn\" self-service
capability"}`; re-enabling it immediately restores success — no caching, no delay,
checked fresh on every request from `Organisation.settings`.

## 9. Multiple Roles & Effective Permission Resolution

A `User` can hold any number of `Role`s simultaneously via `UserRole` (many-to-many,
no cardinality limit). Effective access is the **union** across every `ACTIVE` role
the user currently holds — for a `SCOPABLE` permission granted by two different roles
at two different scopes, the effective grant is the union of both scopes (e.g. a user
with `sales.order.view` at `OWN_TEAM` via one role and `ASSIGNED_TERRITORY` via
another effectively has both).

`EffectiveAccessResolver` (`apps/api/src/identity/authorization/effective-access-resolver.ts`)
is the single place this union is computed — reused unchanged by `PermissionsGuard`
(REST enforcement), the Effective Access Preview (admin UI), and available to any
future consumer without re-deriving the logic (see §15). `resolve(organisationId,
userId)`:

1. Loads the `User`; if it doesn't exist or `status !== 'ACTIVE'` (suspended,
   deactivated, invited-not-yet-accepted, locked), returns empty access immediately —
   **checked live on every call, not cached**, so a suspension takes effect on the
   very next request even against an already-issued, unexpired JWT (§17's live
   verification: suspending an employee mid-session immediately 403s their next call
   to a permission-guarded endpoint, using the same token that succeeded moments
   before).
2. Loads the user's `UserRole`s, filters to roles with `status: ACTIVE` (an archived
   role contributes nothing, even if the `UserRole` row itself still exists).
3. If any active role is named `Owner`, sets `isOwnerBypass = true` and returns full
   access without querying `RolePermission` at all (§5's Owner bypass).
4. Otherwise unions every `RolePermission` row across every active role into a
   `Map<permissionKey, EffectiveGrant>`, recording which role(s) contributed each
   grant (`sourceRoleNames`) — surfaced in the Effective Access Preview so an
   administrator sees _why_ a user has an access, not just _that_ they do.

`EffectiveAccessResolver.isGranted(access, key)` / `isGrantedWithScope(access, key,
scope)` are the two static checks consumers use — the former for
`PermissionsGuard`'s binary allow/deny, the latter for domain services doing real
scope-filtering (§6.1).

### `Employee.employmentStatus` vs. `User.status` — dependency direction

`EffectiveAccessResolver` reads **only** `User.status` (Identity-owned), never
`Employee.employmentStatus` (HR-owned) — reading HR from Identity would invert the
one-directional dependency every other domain in this codebase respects
(Identity has no HR import; HR imports Identity, not the reverse). Instead,
`EmployeeService.suspend()`/`.separate()` **proactively push** a `User.status` change
via the pre-existing `UserService.updateStatus` (`EmployeeService` already legitimately
depends on `UserService` from Sprint 23) — `suspend → User.SUSPENDED`,
`separate → User.DEACTIVATED`. **`reactivate()` is deliberately not symmetric**: it
restores `Employee.employmentStatus` to `ACTIVE` but does **not** automatically
restore `User.status` — an administrator must separately reactivate the linked user
account via `PATCH /users/:id`. This is a deliberate safety choice: reinstating
someone's HR employment record should never silently hand back full system access
without an explicit second action from an administrator. Live-verified in §17.

## 10. Authorization Enforcement Pattern

### Components (all new this sprint, `identity/auth/` and `identity/authorization/`)

- **`PermissionsGuard`** + **`@RequirePermission(key)`** — fine-grained, per-endpoint.
  Must run after `JwtAuthGuard`. No metadata on a route means this guard is a no-op
  for it (the route is either unprotected or still on the old `RolesGuard`/`@Roles`
  check — see below).
- **`CommonAccessGuard`** + **`@RequireCommonAccess(capability)`** — the orthogonal
  Common Employee Access check (§8), independent of `PermissionsGuard`.
- **`EffectiveAccessResolver`** / **`ScopeEvaluator`** (§9/§6) — the shared resolution
  engine, in `identity/authorization/` specifically so every domain module can adopt
  `@RequirePermission` with zero new cross-domain import edges (they already all
  import `AuthModule`, which already imports `IdentityModule`).

All four are exported by `AuthModule` (guards) / `IdentityModule` (resolver/evaluator)
— see the NestJS DI note in §14 for why a guard's own dependencies resolve from its
_home_ module's container, not the consuming module's.

### Why not every domain, and why that's the right call for this sprint

The brief was explicit: build the foundation, establish a repeatable pattern, protect
the _most important_ surfaces, and **document** — not silently leave — everything
still on the old check, rather than attempt a full-codebase rewrite in one sprint. The
old `RolesGuard`/`@Roles('Owner', 'Administrator')` mechanism (Sprint 2.1, unchanged)
remains fully functional and still guards most of this codebase's existing mutation
endpoints; both systems coexist by design.

### Migrated to `@RequirePermission` (this sprint)

| Endpoint                                                                                 | Permission                                                                               |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `POST /procurement/purchase-orders`                                                      | `procurement.purchase_order.create`                                                      |
| `POST /procurement/purchase-orders/:id/cancel`                                           | `procurement.purchase_order.cancel`                                                      |
| `POST /inventory/goods-receipts`                                                         | `inventory.goods_receipt.create`                                                         |
| `GET /hr/attendance/me`                                                                  | `hr.attendance.self_view`                                                                |
| `POST /hr/attendance/sign-in`                                                            | `hr.attendance.self_sign_in` + `@RequireCommonAccess('selfSignIn')`                      |
| `POST /hr/attendance/sign-out`                                                           | `hr.attendance.self_sign_out` + `@RequireCommonAccess('selfSignOut')`                    |
| `POST /hr/attendance/corrections`                                                        | `hr.attendance.correction_submit` + `@RequireCommonAccess('submitAttendanceCorrection')` |
| `GET /hr/attendance`, `GET /hr/attendance/:employeeId`, `GET /hr/attendance/corrections` | `hr.attendance.view`                                                                     |
| `POST /hr/attendance/manual`, `PATCH /hr/attendance/:id`                                 | `hr.attendance.manage`                                                                   |
| `POST /hr/attendance/corrections/:id/review`                                             | `hr.attendance.review_correction`                                                        |
| `GET /hr/employees`                                                                      | `hr.employee.view` (+ real `OWN_TEAM`/`DEPARTMENT` scope filtering)                      |
| `POST /hr/employees/:id/separate`                                                        | `hr.employee.separate`                                                                   |
| `POST /production/orders/:id/material-issues`                                            | `production.material_issue.create`                                                       |
| `POST /production/orders/:id/complete`                                                   | `production.order.complete`                                                              |
| `POST /finance/payments`                                                                 | `finance.payment.create`                                                                 |
| `POST /finance/payments/:id/cancel`                                                      | `finance.payment.cancel`                                                                 |
| `POST /finance/invoices`                                                                 | `finance.invoice.create`                                                                 |
| `POST /finance/invoices/:id/issue`                                                       | `finance.invoice.issue`                                                                  |
| `POST /finance/invoices/:id/void`                                                        | `finance.invoice.cancel`                                                                 |
| `POST /finance/journal-entries/:id/post`                                                 | `finance.journal.post`                                                                   |
| `POST /maintenance/work-orders/:id/complete`                                             | `maintenance.work_order.complete`                                                        |
| every `/access/*` admin endpoint (§11)                                                   | `access.*` / `identity.audit-logs.read`                                                  |

Live-verified (§17) with direct API calls: a user without the permission gets
`403 {"message":"Missing required permission: <key>"}` calling the endpoint directly
(not just a hidden button); a user with it succeeds.

### Deliberately still on the old `@Roles`/`RolesGuard` check (not migrated)

Every other mutation across Sales (`sales-order.controller.ts`,
`customer-return.controller.ts`), the remainder of Procurement/Inventory/Production/
Finance/Maintenance beyond the table above, Assets, Distribution, Retail Network, and
Suppliers. These still check `@Roles('Owner', 'Administrator')` by role name — the
permission catalogue's corresponding entries (e.g. `sales.order.create`,
`sales.order.cancel`) exist and are grantable/visible in the admin UI and Effective
Access Preview, but **granting them today does not yet change what that endpoint
accepts** — only `Owner`/`Administrator` can call it, exactly as before this sprint.
This is an honest, load-bearing distinction, not an oversight: the Effective Access
Preview never claims otherwise (it shows the grant as recorded, from the catalogue,
same as any other), but this document is the authoritative list of which grants are
mechanically enforced today.

### Some endpoints check neither

A number of `GET` (list/view) endpoints across most domains — including, notably,
`GET /finance/trial-balance`, `GET /finance/invoices`, `GET /sales/orders` — carry
only `JwtAuthGuard` (any authenticated organisation member, regardless of role). This
predates Sprint 25 and was not changed by it; `finance.trial_balance.view` /
`sales.order.view` and similar `view` permissions exist in the catalogue (for the
Effective Access Preview and future migration) but are not yet wired to a guard on
these specific read endpoints. Discovered and confirmed during this sprint's own live
verification (§17) — a Field Sales user with no Finance role could still successfully
call `GET /finance/trial-balance`, proving the gap directly rather than assuming
coverage.

## 11. Admin UI — `/settings/access`

Desktop-first (a `max-w-*` centered layout, same convention as every other
`/settings/*` page), usable but not optimized on smaller screens — deliberately not a
Field Sales/Field Technician mobile workflow, matching the brief's own framing. Five
tabs (`AccessTabs`, the exact `HrTabs`/`MaintenanceTabs` shared-sub-nav convention):

- **Overview** (`AccessOverviewController`, `access.overview.view`) — live-computed
  counts: total/active/archived/system/custom roles, total users, users without any
  role, users with multiple roles. No persisted snapshot, the
  `HrOverviewService`/`MaintenanceOverviewService` pattern.
- **Roles** — the full role table (name, status, user count, permission count) plus a
  detail page per role: the entire 121-entry catalogue grouped by module, each
  permission a checkbox, each `SCOPABLE`-and-checked permission an adjacent scope
  `<select>` (the eight `AccessScope` options spelled out in full, e.g. "No Access
  (scoped to nothing)" rather than the raw enum value `NONE` — the brief's explicit
  "do not use vague labels" instruction). Archive/Restore, Duplicate, Edit Name/
  Description. System roles render every control disabled with an explanatory note
  instead of hiding them.
- **User Access** — one card per user: name, email, linked employee's
  department/position/manager/employment-status (or "No linked employee record"),
  their current role badges (each removable in place), an "Add Role" picker
  (`ACTIVE` roles only), and an "Effective Access" button opening the **Effective
  Access Preview** dialog — the full union-of-roles resolution (§9) rendered
  per-permission with its contributing role name(s) and, for `SCOPABLE` grants, its
  scope(s) spelled out the same way as the role detail page. A user with zero roles
  is flagged inline ("No roles assigned").
- **Common Employee Access** — the ten capability toggles (§8), a single Save.
- **Access Review** (added during this sprint's own live verification, §17.6) — a
  read-only view over the organisation's full audit trail (§12), not filtered to only
  `access.*` events (a reviewer investigating an access change usually wants the
  surrounding context too), each entry showing action, actor email, entity, timestamp,
  and the full `before`/`after` metadata where recorded.

## 12. Audit

Every access-control mutation calls the pre-existing, insert-only `AuditService.record()`
([identity.md §8](identity.md#8-audit-strategy)) — no new audit infrastructure, the
same table and the same "controller records after success" convention every other
domain follows:

| Action                            | Recorded on                                                    |
| --------------------------------- | -------------------------------------------------------------- |
| `access.role.created`             | `POST /access/roles`                                           |
| `access.role.updated`             | `PATCH /access/roles/:id`                                      |
| `access.role.permissions_updated` | `POST /access/roles/:id/permissions`                           |
| `access.role.archived`            | `POST /access/roles/:id/archive`                               |
| `access.role.restored`            | `POST /access/roles/:id/restore`                               |
| `access.role.duplicated`          | `POST /access/roles/:id/duplicate`                             |
| `access.user_role.assigned`       | `POST /access/users/:userId/roles`                             |
| `access.user_role.removed`        | `DELETE /access/users/:userId/roles/:roleId`                   |
| `access.common_policy.updated`    | `PATCH /access/common-policy` (full `before`/`after` snapshot) |

**Correction (Sprint 25.1):** this table previously claimed role CRUD (create/edit/
permission-set/archive/restore/duplicate) did not yet call `AuditService.record()`.
That was inaccurate — `AccessRoleController` already called it for every one of these
actions since Sprint 25 shipped; the claim was a documentation error, not a code gap.
Live-verified in Sprint 25.1 (§17): a full create → update → set-permissions →
archive → restore → duplicate cycle produced exactly the 6 expected audit rows, each
with the correct actor, entity id, and metadata.

Never logs a credential, token, or password — every recorded `metadata` payload is
either a role id, a capability-flag before/after diff, or (for the pre-existing
`auth.login.success` event) the account's email address, nothing more sensitive.

**Previously an orphaned permission**: `identity.audit-logs.read` existed in the
catalogue (and was granted to `Administrator` at seed time) since the catalogue was
first written, but no controller served a read of the audit log — the grant did
nothing. This sprint added `AccessAuditLogController` (`GET /access/audit-log`,
`identity.audit-logs.read`-guarded, tenant-scoped via the existing
`AuditService.listByOrganisation`) specifically to make that permission real, backing
the Access Review tab above.

Live-verified (§17): every role-assignment, role-removal, and common-policy-toggle
action performed during this sprint's own manual verification appears in the audit
log with the correct actor, before/after values, and timestamp.

## 13. Seed Data

`prisma/seed.ts`'s `seedAccessControlFixtures()` — idempotent (existence-check before
create, `skipDuplicates: true`, upsert-by-compound-unique; verified by running the
seed twice back-to-back and confirming identical row counts both times), tenant-aware,
non-destructive. For Boby Bites:

- **Administrator** granted all 88 catalogue permissions (`SCOPABLE` ones at
  `ORGANISATION`), preserving its pre-existing "does everything short of Owner"
  behaviour as real data instead of a hardcoded role-name check.
- **10 custom roles**: Employee Self-Service (9 self-service permissions),
  Head of Finance (24 permissions), Finance Staff (5, see below),
  Cash Officer (2), Bank Reconciliation Officer (2), Production Manager (5),
  Maintenance Manager (8), Sales Manager (5), Sales Team Lead (3),
  Field Sales Agent (3).
- **Finance Staff** — the required "restricted Finance user" demonstration:
  `finance.trial_balance.view`, `finance.reports.view`,
  `finance.invoice.view@ORGANISATION`, `finance.payment.view@ORGANISATION`,
  `finance.payment.create@NONE` (the deliberate "granted but scoped to nothing"
  example, §6). No `finance.journal.post`, no `finance.invoice.issue`/`.cancel`, no
  supplier-payment access.
- **Three new demo `User`s**, each linking a previously-unlinked Sprint 23 `Employee`
  to a fixed local-dev-only password (`local-dev-only-not-a-real-password`, not
  gated behind an env var — illustrative accounts, not the three "real" seeded
  accounts which remain env-var-gated): `folake.adewale.demo@bobybites.local`
  (EMP-000003, Production Manager), `emeka.nwachukwu.demo@bobybites.local`
  (EMP-000008, Finance Officer), `ngozi.eze.demo@bobybites.local` (EMP-000007,
  Field Sales Representative).
- **Combined-role demonstration**: Folake holds **Production Manager +
  Maintenance Manager + Employee Self-Service** (3 roles) — a genuine multi-role
  union, not contrived, live-verified in §17 to correctly resolve to the union of
  all three roles' permissions with correct per-grant source attribution.
- The pre-existing `member@bobybites.local` (already linked to Tunde Bakare, the
  Sprint 23 Sales Team Lead) additionally receives Employee Self-Service, producing
  a second, non-contrived 3-role user (**Member + Employee Self-Service + Sales
  Team Lead**) without a 4th demo account.
- Final counts at Sprint 25 launch (verified live, §17): 13 roles, 88 permissions, 167
  role-permission grants, 12 user-role assignments across 6 users (0 users without any
  role, 4 users with multiple roles). **Sprint 25.1** grew this to 121 permissions and
  188 role-permission grants (companion `.view` permissions added to several seed
  roles so a newly-guarded `GET` never silently took away access a role already had —
  authorization-coverage.md §8) without changing the role/user/assignment counts.

## 14. Schema, Migration & Implementation Notes

### Prisma changes

`Role` gained `status RoleStatus @default(ACTIVE)`. `Permission` gained `resource`,
`action`, `scopeType PermissionScopeType @default(NONE)`. New enums `RoleStatus`,
`PermissionScopeType`, `AccessScope`. `RolePermission` gained `scope AccessScope?`.
Migration `20260913074524_sprint25_access_control_scope_permission_extensions` —
hand-edited to add the new `Permission` columns nullable first, backfill via
`UPDATE "permissions" SET "resource" = split_part("key",'.',2), "action" =
split_part("key",'.',3)`, then set `NOT NULL` — safe against the pre-existing seeded
`Permission` rows from Sprint 1B.1.

### NestJS DI: a guard's dependencies resolve from its own home module

Discovered as a real boot-time failure during this sprint (`"Nest cannot export a
provider/module that is not a part of the currently processed module (AuthModule)"`):
a module may only `export` tokens it declares in its own `providers` array. Fixed by
_not_ re-exporting `EffectiveAccessResolver`/`ScopeEvaluator` from `AuthModule` — a
guard's own constructor dependencies resolve from the guard's **home** module's
container when Nest instantiates it (here, `AuthModule`, which already imports
`IdentityModule`, which already exports both), regardless of which module actually
applies `@UseGuards(PermissionsGuard)`. Only a _controller_ that injects
`EffectiveAccessResolver` directly (not via the guard) needs its own module to import
`IdentityModule` itself — `HrModule` and `AccessControlModule` both already do, for
exactly this reason.

### A pre-existing bug fixed in-scope

`OrganisationService.updateWorkspaceSettings` silently discarded every other
`Organisation.settings` key (including, going forward, the new
`commonEmployeeAccess` policy) whenever a theme/preferences patch was applied,
because it wrote `data.settings = { theme, preferences }` instead of merging. Fixed
with a one-line change spreading `...currentSettings` first — directly load-bearing
for Common Employee Access's durability, so fixed rather than deferred.

## 15. Future Workflow & Notification Integration Points

Per the brief, Workflow and Notifications were explicitly out of scope for Sprint 25 —
every component here was designed to be reused, not rebuilt, when they arrived. **Sprint
26 confirms this held exactly as predicted** — see [Workflow & Approval](workflow.md):

- **`EffectiveAccessResolver.resolve(organisationId, userId)`** — used directly,
  unmodified, by `WorkflowEligibilityService.checkStepEligibility()` as "is this user
  eligible to be an approver at this workflow step." Zero changes to this method were
  needed for Workflow to consume it.
- **`ScopeEvaluator`** — used directly for "does this approver hold the step's required
  scope." Workflow's own honesty note (workflow.md §6) is worth restating here: holding
  a scope and a specific record actually falling within that scope are two different
  claims, and `ScopeEvaluator` only ever proves the former — Workflow inherits that
  same honest limitation rather than overclaiming record-level scope enforcement it
  cannot prove.
- **The permission catalogue** — Workflow added 10 new entries (9 engine-level +
  `procurement.purchase_order.approve`) the same way every other domain always has;
  `EffectiveAccessResolver`/`PermissionsGuard` needed zero changes to support them.
- **Audit events** (§12) — Workflow's own audit trail (workflow.md §11) follows the
  identical `AuditService.record()` call-after-the-fact convention; a future
  Notification engine consuming either domain's audit trail sees the same shape.

Notifications themselves remain unbuilt — Workflow's own `workflow-events.ts` (the
`maintenance-events.ts` convention) is the equivalent forward-looking boundary on that
side, still with no `EventEmitter` anywhere in this codebase.

## 16. Known Deferred Capabilities (honest limitations, not oversights)

- **Scope filtering for `ASSIGNED_TERRITORY`/`ASSIGNED_ASSETS`/general
  `ASSIGNED_RECORDS`** — recorded and previewable, not mechanically enforced (§6.2).
- **Interface/channel restriction per permission** — not built (§4).
- ~~Role CRUD audit events not yet implemented~~ — **corrected in Sprint 25.1**: they
  were already complete (§12).
- **Most of the codebase's mutation endpoints remain on the old `@Roles`/`RolesGuard`
  check** — this sprint migrated the highest-risk surfaces (§10's table), not every
  domain. See
  [docs/architecture/authorization-coverage.md](../architecture/authorization-coverage.md)
  for the full picture — **Sprint 25.1 has since migrated essentially all of this**
  (95%+ of the application's endpoints), superseding this line; kept here only as a
  historical record of Sprint 25's own honest self-assessment at the time.
- **Several read/list endpoints check neither system** (§10.3) — e.g.
  `GET /finance/trial-balance`, `GET /sales/orders` — any authenticated organisation
  member can call them today, unchanged from before this sprint.
- **No delegation, acting appointments, external identity providers, SSO, or
  policy-as-code engine** — none of these were in scope; see the sprint completion
  report's non-goals list for the full set.

## 17. Live Verification Performed

All performed against the running dev API/web, with real (not mocked) tokens and the
real seeded database, then state restored to the exact pre-test baseline afterward
(role assignments, employment/user statuses, common-policy toggle — all confirmed
back to original values by direct DB query before concluding).

1. **Role detail page** (Finance Staff) — confirmed the permission grid renders all
   88 catalogue entries grouped by module; confirmed exactly the 5 seeded grants are
   checked, with the correct scope selected for each (`invoice.view`→ORGANISATION,
   `payment.view`→ORGANISATION, `payment.create`→NONE), and every other permission
   (e.g. `finance.journal.post`, `finance.invoice.issue`) correctly unchecked with no
   stray scope selector.
2. **User Access page** — confirmed all 6 users and their exact seeded role sets;
   confirmed the required combined-role user (Folake: 3 roles) and restricted Finance
   user (Emeka) are both present and correctly attributed.
3. **Effective Access Preview** — for Folake (3 roles), confirmed the union of all
   19 distinct permission grants across Production Manager + Maintenance Manager +
   Employee Self-Service, each correctly attributed to its source role(s); for Emeka,
   confirmed the exact 5-permission Finance Staff grant set including the honestly
   labelled `finance.payment.create → No Access (scoped to nothing)`.
4. **Immediate revocation** — removed Ngozi's Field Sales Agent role via the UI;
   confirmed her still-valid access token immediately received
   `403 Missing required permission: production.material_issue.create`-equivalent
   denial pattern on a permission she'd lost (verified via a genuinely
   `PermissionsGuard`-protected route, not the unguarded `GET /sales/orders`, which
   was discovered mid-verification to check nothing at all — see §10.3); restored the
   role afterward and confirmed access returned.
5. **Direct API-call verification (not hidden-UI verification)** — called
   `POST /finance/journal-entries/:id/post` as Emeka (Finance Staff, no
   `finance.journal.post`) → `403 {"message":"Missing required permission:
finance.journal.post"}`; called `POST /production/orders/:id/material-issues` as
   Folake (has `production.material_issue.create`) → passed the guard (400 validation
   error on the payload, proving the guard, not authorization, was the only thing
   standing between the request and the handler).
6. **Common Employee Access enforcement** — disabled `selfSignIn` via the UI, saved,
   confirmed `POST /hr/attendance/sign-in` with a valid token immediately returned
   `403 {"message":"This organisation has disabled the \"selfSignIn\" self-service
capability"}`; re-enabled and confirmed success returned immediately. (This
   verification pass is what led to building the Access Review tab, §11, once it
   became clear there was no way to see the resulting audit trail in the UI.)
7. **Tenant isolation** — registered a second organisation ("Test Tenant Co") via the
   public registration endpoint; confirmed its owner's role list contains only its
   own 3 default system roles (never Boby Bites' 13), and a direct-by-id fetch of a
   Boby Bites role using the new tenant's token returns
   `400 "Role not found in this organisation"`, not a leak of the role's existence or
   data.
8. **Suspended-employee revocation, live** — suspended Folake via
   `POST /hr/employees/:id/suspend`; confirmed her login now fails
   (`401 Invalid email or password`); confirmed her **already-issued, still-unexpired**
   access token, which had succeeded against a `PermissionsGuard`-protected route
   moments before, now receives `403 Missing required permission:
production.material_issue.create` on the identical request — proving revocation is
   checked live against `User.status` on every request, not just at login. Also
   confirmed `reactivate()`'s deliberate asymmetry: restoring `Employee.employmentStatus`
   to `ACTIVE` does **not** restore `User.status`, which had to be separately
   restored via `PATCH /users/:id`.
9. **Audit history** — confirmed every role-removal, role-assignment, and
   common-policy-toggle performed during this verification pass appears in the audit
   log (via direct Prisma query, then again via the newly built Access Review tab)
   with correct actor, before/after diff, and timestamp; confirmed no credential or
   token value appears in any recorded `metadata`.
10. **Full regression** — after all of the above (which mutated real seed-adjacent
    state), the full API test suite was re-run: **174 suites, 1471 tests, all
    passing**; state was independently confirmed back to the original seed baseline
    by direct Prisma query (role/assignment counts, employment/user statuses) before
    concluding.

## 18. Explicit Non-Goals (this sprint)

Workflow engine, approval routing, Notifications, notification preferences, Payroll,
Leave Management, Recruitment, Performance Management, biometric attendance,
geofencing, a full employee self-service portal, position/department-based automatic
role assignment, complex attribute-based access control, external identity providers,
SSO, multi-level delegation, temporary acting appointments, a full policy-as-code
engine, cross-tenant administration. None of these were partially built or stubbed —
genuinely absent, matching the brief's own instruction.
