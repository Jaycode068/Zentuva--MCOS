# HR — Employee Lifecycle Foundation

- **Status:** **Foundation implemented and live-verified — Sprint 23
  ("HR Employee Lifecycle Foundation")**. A genuinely new top-level
  domain: Department/Position (organisation structure), Employee (the
  central HR record), EmployeeDocument (metadata only), and
  EmployeeOnboarding/EmployeeOnboardingTask (a checklist, not a workflow
  engine). Explicitly a foundation, not a payroll/attendance/recruitment/
  performance platform — see §11 "Deferred / Non-Goals."
- **Sprint:** 23
- **Depends on:** [Identity](identity.md) (`UserService.getById()`,
  read-only, to validate `Employee.userId` linking; `AuditService` for
  every lifecycle event; `JwtAuthGuard`/`RolesGuard` for authorization —
  all universal, already-established reuse, no new guard/decorator
  invented), the shared `FileStorageModule` (employee document uploads,
  the exact `AssetDocument`/`MaintenanceDocument` url/key pattern).
- **Explicitly does not depend on:** Accounting, Inventory, Procurement,
  Production, Sales, Distribution, Assets, or Maintenance — HR reads and
  writes none of their tables, and none of those domains import HR.
  Proven executably by `hr-independence.spec.ts`, not just documented
  here.
- **See also:** [Identity](identity.md), [Maintenance
  Management](maintenance.md) (the template this domain's module/
  repository/service/controller conventions were copied from).

## 1. Domain Purpose

Sprint 23 gives Zentuva an Employee Lifecycle Foundation: the
organisational and people record-keeping every later HR capability
(Access Control, Attendance, Training, KPIs, Compensation, Workflow
Approvals, Notifications, Management Reporting) needs to build on. It is
deliberately scoped to be _usable_ — a real employee directory, real
department/position structure, real onboarding checklists, real
lifecycle actions — without becoming a payroll or people-operations
platform. See §11 for the explicit list of what is intentionally not
built yet.

## 2. Employee vs. User — the Central Distinction

Zentuva already had a `User` model (Identity domain — login/application
access) before this sprint. HR does **not** duplicate it. Instead:

- **User** — an application login identity. Owned entirely by Identity.
  Untouched by this sprint except one new optional back-relation
  (`User.hrEmployee`).
- **Employee** — the person employed or engaged by the organisation.
  Owned entirely by HR. `Employee.userId` is a nullable, unique
  foreign key to `User`.

Two rules follow directly from this split, both enforced in code, not
just documented:

- **Not every Employee has a User.** Most seeded Boby Bites employees
  (9 of 12) have no login account — realistic for shop-floor,
  warehouse, and field staff. `employmentStatus` and every lifecycle
  action work identically whether or not a User is linked.
- **Not every User is an Employee.** A User can exist (and log in) with
  no Employee record at all; nothing in Identity or auth requires one.

**Linking is deliberately inert.** `POST /hr/employees/:id/link-user`
and `.../unlink-user` only set/clear `Employee.userId`. Neither call
touches `UserRole`/`RolePermission`/any permission table — confirmed by
a dedicated structural guard in `hr-independence.spec.ts`. Linking an
employee to a user grants **no** new application access; unlinking
**never** deletes the User account. See §9 for what this means for a
future Access Control sprint.

**One pre-existing field this sprint deliberately leaves alone:**
`User.employeeCode` (added Sprint 1A.1, documented then as reserved for
"future HR-module... use case") stays unused. The real, actively-used
employee code lives on `Employee.employeeCode` instead — it has to,
since (per the rule above) an Employee can exist with no User to attach
a code to. This is a known, intentional non-reuse, not an oversight.

## 3. Department vs. Position vs. Access Role

Also a critical, enforced-in-code distinction:

- **Department** — an organisational unit ("Production," "Finance").
  Tenant-scoped, hierarchical (`parentDepartmentId`, self-referencing,
  cycle-guarded), `ACTIVE`/`INACTIVE` only.
- **Position** — a job title / organisational role ("Production
  Manager," "Field Sales Representative"). Tenant-scoped, optionally
  attached to a Department, optionally hierarchical
  (`reportsToPositionId`, cycle-guarded), `ACTIVE`/`INACTIVE` only.
- **Access Role** — `Owner`/`Administrator`/`Member`, Identity's own
  `Role`/`Permission`/`UserRole`/`RolePermission` tables. Completely
  separate from Position. No application permission is stored on
  `Position`, and none is implied by assigning an employee to one —
  confirmed by a structural guard that no HR file ever writes
  `UserRole`/`RolePermission`/`Role`.

Assigning "Production Manager" as a Position never grants Owner/
Administrator/Member access; granting Administrator access never implies
any particular job title. The two systems are independent by
construction.

## 4. Data Model

New Prisma models (`apps/api/prisma/schema.prisma`,
migration `20260911112941_sprint23_hr_employee_lifecycle_foundation`):

| Model                    | Purpose                                                                                                                                                  |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Department`             | Organisational unit — `code`, `name`, `description?`, `parentDepartmentId?`, `departmentHeadEmployeeId?`, `status`                                       |
| `Position`               | Job title — `code`, `title`, `description?`, `departmentId?`, `reportsToPositionId?`, `status`                                                           |
| `Employee`               | The central HR record — see §5                                                                                                                           |
| `EmployeeDocument`       | Document metadata only — `documentType`, `name`, `url`/`key` (the `AssetDocument`/`MaintenanceDocument` pattern), `issuedDate?`, `expiryDate?`, `status` |
| `EmployeeOnboarding`     | One per Employee (`@unique`) — `status`, `startedAt`, `targetCompletionDate?`, `completedAt?`                                                            |
| `EmployeeOnboardingTask` | A checklist row — `title`, `isRequired`, `completedAt?`, `completedByUserId?`, `sortOrder`                                                               |

Deliberately **not** collected, per the brief's own privacy scoping:
bank account details, tax/national ID numbers, medical records,
biometric data, passwords (obviously — that stays on `User`). `gender`
is a small optional enum (`MALE`/`FEMALE`/`OTHER`/`PREFER_NOT_TO_SAY`),
consistent with the codebase's small-controlled-enum convention rather
than free text.

## 5. Employee Code

`Employee.employeeCode` (`EMP-000001`, ...) is generated server-side by
`generateEmployeeCode()` (`apps/api/src/hr/employee-code.ts`) — the exact
`generateWorkOrderCode`/`generateAssetCode` concurrency-safe, linear-
probe-inside-`$transaction` template. Never accepted from the request
body (`createEmployeeSchema` has no `employeeCode` field; a structural
guard confirms the controller never reads `body.employeeCode`).
Immutable after creation — no update endpoint touches it.

## 6. Employment Type & Status

`employmentType`: `FULL_TIME` / `PART_TIME` / `CONTRACT` / `TEMPORARY` /
`INTERN` / `CASUAL` / `VOLUNTEER` — a plain enum, freely changeable via
`PATCH /hr/employees/:id`.

`employmentStatus` is a real lifecycle, validated server-side by
`EmployeeService`'s private `transition()` — the exact generic
`fromStatuses[] → toStatus` guard `AssetService.transition()`
established (Sprint 20), never an arbitrary client-supplied status:

```
DRAFT ──┬──────────────┐
        ↓              ↓
   ONBOARDING ───→  ACTIVE ⇄ SUSPENDED
        │              │         │
        └──────────────┴─────────┴──→ SEPARATED (hard-terminal)
```

- `activate()`: `DRAFT`/`ONBOARDING` → `ACTIVE`. Soft-idempotent if
  already `ACTIVE`.
- `suspend()`: `ACTIVE` → `SUSPENDED`.
- `reactivate()`: `SUSPENDED` → `ACTIVE` only — deliberately narrower
  than `activate()`; a separated employee can never be reactivated.
- `separate()`: any non-terminal status → `SEPARATED`, recording
  `separationDate`/`separationReason?`. Hard-terminal — mirroring
  `Asset.DISPOSED`/`RETIRED` — any further lifecycle action on a
  separated employee throws `BadRequestException`.

**`ON_LEAVE` exists in the enum but no transition reaches it this
sprint.** It is a future-compatible placeholder only — its presence does
**not** imply a leave-management system, leave balances, or leave
records exist. That is explicitly Sprint 24 scope (§12).

**Separation preserves history.** A separated Employee's row is never
deleted; `GET /hr/employees/:id` still returns it, its documents and
onboarding record are untouched, and its audit trail is intact. A
separated employee's application access (if any User is linked) is
**not** automatically revoked this sprint — no safe, explicit mechanism
for that exists yet in Identity, and building one is out of scope here.
This is a deliberate, documented gap for Sprint 25 (§12), not an
oversight.

## 7. Reporting-Line & Hierarchy Rules

One shared utility, `wouldCreateCycle()`
(`apps/api/src/hr/hr-hierarchy.util.ts`), guards all three independent
self-referencing trees — `Department.parentDepartmentId`,
`Position.reportsToPositionId`, `Employee.managerEmployeeId` — each
walked and checked the same way: a node can never be its own parent, and
walking up from a proposed new parent can never reach the node being
reassigned.

Employee-specific manager rules, enforced in `EmployeeService`:

- An employee cannot report to themselves.
- A manager must belong to the same organisation (validated via
  `EmployeeRepository.findById(organisationId, managerId)` — a
  cross-tenant id simply returns `null`, surfaced as a `BadRequestException`).
- A manager cannot be a `SEPARATED` employee.
- A circular reporting chain is rejected.
- A manager is always optional — nothing requires every employee to
  have one (the seeded Managing Director has none).
- Reassigning a manager never infers or changes application permissions.

Department head (`Department.departmentHeadEmployeeId`) and Position
hierarchy (`reportsToPositionId`) follow the identical same-organisation

- cycle-guard rules; a department head additionally cannot be a
  `SEPARATED` employee.

## 8. Onboarding Model

`EmployeeOnboarding` + `EmployeeOnboardingTask` — a checklist, explicitly
**not** a workflow engine. `POST /hr/employees/:id/onboarding/start`
creates one onboarding record (soft-idempotent — a second call returns
the existing one) with a default 7-task checklist:

1. Collect employment documentation _(required)_
2. Confirm department and position _(required)_
3. Create or link user account _(required)_
4. Provide workplace orientation _(required)_
5. Acknowledge key policies _(required)_
6. Assign reporting manager _(optional — a manager is never required)_
7. Confirm onboarding completion _(required)_

Starting onboarding also moves a `DRAFT` employee to `ONBOARDING`
(only if currently `DRAFT` — soft-idempotent otherwise).
`PATCH .../onboarding/tasks/:taskId` marks one task complete
(idempotent — completing an already-completed task is a no-op, not an
error). `POST .../onboarding/complete` is atomic: it rejects with a
`BadRequestException` naming every incomplete _required_ task by title
if any remain, and on success sets the onboarding to `COMPLETED` and
moves the employee `ONBOARDING → ACTIVE` (only if still `ONBOARDING`).
Every task completion and the final completion are recorded as audit
events (§10). No notification is sent — deliberately; the task rows
themselves are the only extension point a future notification system
would need (Sprint 24, §12).

## 9. Access-Control Preparation (for Sprint 25)

This sprint reuses the codebase's existing, sole authorization
convention — `@UseGuards(RolesGuard)` + `@Roles('Owner', 'Administrator')`
on every HR write endpoint, `@UseGuards(JwtAuthGuard)` (auth only) on
reads. **No fine-grained permission key (`HR_VIEW`, `HR_MANAGE_EMPLOYEES`,
etc.) was introduced** — the codebase's `Permission`/`RolePermission`
tables exist in the schema (seeded, Sprint 1A.1) but are read by no guard
anywhere in the app; adding HR-specific permission keys without an engine
to evaluate them would be dead configuration, not a real capability. The
existing role-name check is sufficient for this sprint's scope, matching
`RolesGuard`'s own doc comment ("do not build a permission engine").

**What Sprint 25 will need, concretely:**

- `Employee.userId` is the join point — Access Control's future
  organisational-structure-aware permission model can read an
  employee's Department/Position/manager chain through this link
  without HR changing anything.
- If/when fine-grained permissions are built, `HR_VIEW` /
  `HR_CREATE` / `HR_UPDATE` / `HR_MANAGE_EMPLOYEES` /
  `HR_MANAGE_ORGANISATION_STRUCTURE` / `HR_MANAGE_ONBOARDING` /
  `HR_MANAGE_DOCUMENTS` are the natural permission-key names for this
  domain's existing endpoint groups — not implemented, but the
  boundary is already this clean without any restructuring.
- Separated-employee access revocation (§6) is the other concrete
  Sprint 25 (or later) integration point.

## 10. Tenant Isolation & Audit

**Tenant isolation** — the same manual, explicit convention every prior
domain uses: every repository method takes `organisationId` as its first
parameter and includes it in every `where` clause; mutations use
`updateMany({ where: { id, organisationId } })` (never a bare
`update({ where: { id } })`) so a cross-tenant id structurally cannot
match. Verified by 20+ dedicated cross-tenant test cases across
`department.service.spec.ts`, `position.service.spec.ts`,
`employee.service.spec.ts`, `employee-document.service.spec.ts`, and
`employee-onboarding.service.spec.ts`, and live-confirmed against the
real dev database (the two other seeded tenants have zero HR rows —
nothing to leak, confirmed by direct query).

**Audit** — `apps/api/src/hr/hr-audit-actions.ts`'s `HR_AUDIT_ACTIONS`
catalog (`hr.department.created`, `hr.employee.activated`,
`hr.onboarding.task_completed`, ...), the exact
`MAINTENANCE_AUDIT_ACTIONS` `<entity>.<event>` convention. Every
controller mutation calls `AuditService.record()` after success (guarded
by a `wasCreated`/`wasCompleted`/`transitioned` flag so idempotent
replays never double-log). `GET /hr/employees/:id/audit` is a read-only
composition over the shared `AuditLog` table, the exact
`WorkOrderController.getAuditHistory()` pattern (fetch up to 200 recent
org-wide events by `entityType`, filter by `entityId` in the controller).
Live-verified: a full lifecycle chain (onboarding start → 7 task
completions → onboarding completion → suspend → reactivate) produced
exactly the expected sequence of timestamped audit entries, visible on
the Employee detail page's "Lifecycle History / Audit" section.

## 11. Deferred / Non-Goals (this sprint)

Explicitly out of scope, per the brief — not partially built, not
stubbed:

- Payroll processing, salary computation, payslips, tax/pension
  calculations, compensation/benefits administration.
- Attendance (including GPS/location-based), leave management (leave
  _records_/_balances_ — `ON_LEAVE` the enum value is not this).
- Recruitment pipeline automation, a job application portal, interview
  scheduling.
- Performance appraisal / KPI calculation engines, training delivery/LMS,
  gamification, incentive calculation.
- A workflow/approval engine, a notification engine.
- Access-control redesign or a new permissions matrix beyond the
  existing `Owner`/`Administrator`/`Member` role-name checks (§9).
- Biometric integration, an employee self-service portal, predictive
  workforce analytics.
- A separate field/mobile HR app — the Admin `/settings/hr` workspace is
  desktop-and-mobile-responsive (375px/430px/desktop), not a second
  mobile shell like `/field` or `/technician`.
- **A frontend automated test framework** — `apps/web`'s `test` script
  remains a no-op stub, consistent with every prior sprint's own
  decision not to introduce one unilaterally; typecheck/lint/build/live
  verification stand in for it this sprint too.

## 12. Future Integration Points

- **Sprint 24 — HR Attendance, Training & People Operations** (next):
  attendance transactions, leave records/balances (finally giving
  `ON_LEAVE` a real transition into/out of it), training delivery,
  broader people-operations features, building on Department/Position/
  Employee unchanged.
- **Sprint 25 — Access Control + Organisational Structure**: the
  fine-grained permission engine this sprint deliberately didn't build,
  using `Employee.userId`/Department/Position as its organisational
  input (§9), and the separated-employee access-revocation gap (§6).
- **Workflow/Notifications** (unscheduled): `EmployeeOnboardingTask`
  completion and every `HR_AUDIT_ACTIONS` entry are the extension
  points a future engine would hook into — nothing here needs to
  change to support that later.
- **Management Reporting** (unscheduled): `HrOverviewService`/
  `HrOrganisationStructureService`'s existing read-only aggregations are
  designed to be composed into a future cross-domain reporting layer,
  the same "consume, never duplicate" boundary
  `docs/domains/maintenance-integration.md`'s own Reporting-boundary
  note already established for Maintenance Analytics.
