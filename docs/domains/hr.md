# HR — Employee Lifecycle Foundation & Attendance, Training, People Operations

- **Status:** **Sprint 23 ("HR Employee Lifecycle Foundation") and
  Sprint 24 ("HR Attendance, Training & People Operations") both
  implemented and live-verified.** Sprint 23 gave the domain
  Department/Position (organisation structure), Employee (the central HR
  record), EmployeeDocument (metadata only), and
  EmployeeOnboarding/EmployeeOnboardingTask (a checklist). Sprint 24
  extends it with WorkSchedule, AttendanceRecord/
  AttendanceCorrectionRequest, Policy/PolicyVersion/
  PolicyAcknowledgement, and TrainingCourse/EmployeeTraining. Explicitly
  still a foundation, not a payroll/recruitment/performance/LMS platform
  — see §17 "Deferred / Non-Goals."
- **Sprint:** 23, 24
- **Depends on:** [Identity](identity.md) (`UserService.getById()`,
  read-only, to validate `Employee.userId` linking; `OrganisationService`
  read-only, for `Organisation.timeZone` — Sprint 24's attendance-date
  bucketing; `AuditService` for every lifecycle event;
  `JwtAuthGuard`/`RolesGuard` for authorization — all universal,
  already-established reuse, no new guard/decorator invented), the
  shared `FileStorageModule` (employee document uploads, the exact
  `AssetDocument`/`MaintenanceDocument` url/key pattern, also referenced
  by Sprint 24's training-certificate link).
- **Explicitly does not depend on:** Accounting, Inventory, Procurement,
  Production, Sales, Distribution, Assets, or Maintenance — HR reads and
  writes none of their tables, and none of those domains import HR.
  Proven executably by `hr-independence.spec.ts`, not just documented
  here.
- **See also:** [Identity](identity.md), [Maintenance
  Management](maintenance.md) (the template this domain's module/
  repository/service/controller conventions were copied from).

---

# Part A — Sprint 23: Employee Lifecycle Foundation

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

**`ON_LEAVE` exists in the enum but no transition reaches it.** It
remains a future-compatible placeholder only — its presence does
**not** imply a leave-management system, leave balances, or leave
records exist. Sprint 24 (Part B) explicitly did **not** wire this up
either — leave management stays out of scope pending a dedicated future
sprint (see §22).

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

## 11. Deferred / Non-Goals (Sprint 23)

Explicitly out of scope for Sprint 23 — not partially built, not
stubbed. **Attendance and Training were subsequently built in Sprint 24
(Part B, §13-§21) — struck through below; everything else remains
deferred exactly as stated:**

- Payroll processing, salary computation, payslips, tax/pension
  calculations, compensation/benefits administration.
- ~~Attendance (including GPS/location-based)~~ — built Sprint 24, §14.
  Leave management (leave _records_/_balances_ — `ON_LEAVE` the enum
  value is not this) remains deferred.
- Recruitment pipeline automation, a job application portal, interview
  scheduling.
- Performance appraisal / KPI calculation engines, ~~training
  delivery~~ (a lightweight catalogue built Sprint 24, §16 — still not
  an LMS), gamification, incentive calculation.
- A workflow/approval engine, a notification engine.
- Access-control redesign or a new permissions matrix beyond the
  existing `Owner`/`Administrator`/`Member` role-name checks (§9, §19).
- Biometric integration, an employee self-service portal (Sprint 24
  added one narrow self-service surface — attendance sign-in/out, §14 —
  not a general portal), predictive workforce analytics.
- A separate field/mobile HR app for the Admin workspace — the Admin
  `/settings/hr` workspace is desktop-and-mobile-responsive (375px/
  430px/desktop). Sprint 24 does add one dedicated mobile-first
  self-service surface (`/attendance`, §14.6) for the one HR action
  every employee — not just admins — needs day to day.
- **A frontend automated test framework** — `apps/web`'s `test` script
  remains a no-op stub, consistent with every prior sprint's own
  decision not to introduce one unilaterally; typecheck/lint/build/live
  verification stand in for it, Sprint 24 included.

## 12. Future Integration Points (as of Sprint 23)

- **Sprint 24 — HR Attendance, Training & People Operations**: see Part
  B below — implemented.
- **Sprint 25 — Access Control + Organisational Structure**: the
  fine-grained permission engine this sprint deliberately didn't build,
  using `Employee.userId`/Department/Position as its organisational
  input (§9), and the separated-employee access-revocation gap (§6).
  Still next — see §22.
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

---

# Part B — Sprint 24: Attendance, Training & People Operations

## 13. Scope and Strategic Purpose

Sprint 24 extends the Sprint 23 foundation from employee _records_ into
basic daily people operations, answering: who was expected to work, who
signed in/out and when/where, which attendance needs review, which
policies has an employee acknowledged, and which training is pending,
completed, or overdue. It is **not** a full HRIS — see §21 for the full
"do not implement" list, most of it inherited unchanged from Sprint 23's
§11.

New top-level concerns, each owned entirely by HR:

- Work schedules and attendance (sign-in/out, corrections, review).
- A policy catalogue with versioning and acknowledgement.
- A lightweight training catalogue and per-employee assignments.
- An extended People Operations overview and Employee-detail
  integration, composed read-only from the above.

New Prisma models (`apps/api/prisma/schema.prisma`, migration
`20260912185438_sprint24_hr_attendance_training_people_ops`):

| Model                         | Purpose                                                                                                  |
| ----------------------------- | -------------------------------------------------------------------------------------------------------- |
| `WorkSchedule`                | Expected hours master data — `code`/`name`, `workDays`, `expectedStartTime`/`expectedEndTime`, `status`  |
| `AttendanceRecord`            | One per employee per day — sign-in/out timestamps, location snapshot, `status`, `reviewStatus`, `source` |
| `AttendanceCorrectionRequest` | A dispute against one `AttendanceRecord` — requested values, `reason`, `status`, reviewer                |
| `Policy`                      | Catalogue entry — `code`/`title`, `scopeType`, `status`                                                  |
| `PolicyVersion`               | One version of a policy's content — `versionNumber`, `content`, `status`                                 |
| `PolicyAcknowledgement`       | One employee's acknowledgement of one policy version                                                     |
| `TrainingCourse`              | Catalogue entry — `code`/`title`, `deliveryMode`, `status`                                               |
| `EmployeeTraining`            | One employee's assignment to one course — `status`, `dueDate?`, `certificateDocumentId?`                 |

Plus `Employee.workScheduleId` (nullable FK, no assignment-history
table — §15).

## 14. Attendance

### 14.1 Attendance is Employee-based, not User-based

Every `AttendanceRecord` belongs to an `Employee`
(`AttendanceRecord.employeeId`), never directly to a `User` — consistent
with §2's Employee/User split. Self-service sign-in/out resolves the
caller's own employee via the existing
`EmployeeRepository.findByUserId(organisationId, userId)`; if the
signed-in user has no linked employee, self-service is rejected with a
clear `BadRequestException`, never silently attributed to the wrong
person. Administrative entry (Owner/Administrator only) can target any
employee directly by id — the one place a user acts on another
employee's attendance in this sprint.

### 14.2 Server-authoritative time, one record per employee per day

`AttendanceRecord.signInAt`/`signOutAt` are always set from `new Date()`
on the server — no endpoint accepts a client-supplied timestamp for
ordinary sign-in/out or administrative entry. `attendanceDate` is a
day-bucket (stored as UTC midnight for the organisation-local calendar
date), computed by `resolveAttendanceDate()`
(`apps/api/src/hr/hr-attendance-date.util.ts`) from
`Organisation.timeZone` via `Intl.DateTimeFormat('en-CA', ...)` — the
first place in this codebase that timezone field is actually consumed
for date-bucketing (it existed, unused for this purpose, since Sprint
3.4). One row per `(organisationId, employeeId, attendanceDate)`
(`@@unique`) — this MVP supports a single daily sign-in/out pair per
employee, not multiple shifts or sessions per day; a documented
limitation, not an oversight.

`AttendanceRepository.findOrCreateForDate()` is this domain's
idempotency primitive: a repeated sign-in call for the same
organisation-local day never creates a duplicate row (existence-check
first, P2002-catch-and-refetch on a race, the same convention every
other master-data repository in this codebase uses) — it returns the
existing record with `transitioned: false`. Sign-out is symmetric:
rejected if no sign-in exists yet, idempotent (no-op) if already signed
out. A future self-service attendance date is structurally impossible
(the date is always "now," never client-supplied); administrative entry
explicitly rejects `attendanceDate` values after today's bucket
(`isFutureAttendanceDate()`).

Self-sign is gated on `employmentStatus`: a `SEPARATED` employee is
rejected with a specific message; any other non-`ACTIVE` status (DRAFT,
ONBOARDING, SUSPENDED) is rejected as "only an active employee can
self-record attendance." Administrative entry has no such gate — an
Owner/Administrator can record attendance for any employee in the
organisation regardless of status, since it represents an authorized
correction of the record, not a claim by the employee themselves.

### 14.3 Status derivation — PRESENT / LATE / INCOMPLETE

`AttendanceService.deriveSignInStatus()` compares the sign-in instant's
local time-of-day (in the organisation's timezone) against the
employee's assigned `WorkSchedule.expectedStartTime +
gracePeriodMinutes`; `PRESENT` if on time, `LATE` otherwise. An employee
with no `workScheduleId` always gets `PRESENT` — there is no schedule to
be late against. `ABSENT`/`OFF_DAY`/`EXCUSED` are defined in the enum
(brief §7) but no automated logic produces them this sprint — nothing
currently marks an employee absent for not showing up, matching the
brief's explicit caution against "automatically marking employees absent
without a clearly defined and tested process." Only statuses that are
actually reachable by implemented code are ever written.

`INCOMPLETE` **is** implemented, lazily: `AttendanceRepository
.markPastIncomplete()` flips any past day's dangling sign-in (no
sign-out, status still `PRESENT`/`LATE`) to `INCOMPLETE` — called before
every read (`list`/`getById`/`listForEmployee`/`getMyAttendance`), the
identical no-cron-job derivation strategy `EmployeeTraining.OVERDUE`
uses (§16). Today's own bucket is never touched by this — it may still
be legitimately in progress.

### 14.4 Location capture — privacy-conscious, never fabricated

`signInLatitude`/`signInLongitude`/`signInAccuracyMeters`/
`signInLocationLabel` (and the equivalent `signOut*` columns) are all
nullable. Self-service sign-in/out accepts an optional `location` object
from the client (the frontend uses the browser Geolocation API,
`captureLocation()` in `apps/web/src/app/(attendance)/attendance/
page.tsx`); if the browser denies permission or the API is unavailable,
the record is written with all location fields `null` and the UI
clearly states "Location permission denied — recorded without it" /
"Location unavailable — recorded without it" — never a guessed or
carried-over coordinate. Administrative entries never capture location
at all (there is no `location` parameter on that endpoint) — the UI
labels these rows "Administrative — no location." No location history
stream exists; each sign-in/out captures at most one point in time, on
the attendance row itself, not a separate tracking table. No geofencing
or distance enforcement exists.

### 14.5 Corrections — a dedicated, auditable entity

`AttendanceCorrectionRequest` (not an overwrite of the attendance row)
holds `requestedSignInAt?`/`requestedSignOutAt?` plus a `reason`.
`AttendanceCorrectionService.request()`: rejects a request naming
neither a sign-in nor sign-out change; rejects a duplicate pending
(`REQUESTED`) request against the same attendance record
(existence-check, the same idempotency-via-existence-check convention
used everywhere else — Postgres partial unique indexes aren't expressed
declaratively in this Prisma schema, so the check lives in the service);
and — a deliberate MVP boundary — only allows an employee to request a
correction for **their own** attendance record (resolved via
`findByUserId`), not on behalf of anyone else. An administrator needing
to fix someone else's record uses the review/administrative-entry paths
directly instead of filing a request-then-self-approve round trip.

`AttendanceCorrectionService.review()`: rejects reviewing an
already-decided request; rejects the original requester reviewing their
own request (even if they hold Owner/Administrator role) — the
literal "employee cannot approve their own correction" rule. Approval is
atomic: `AttendanceCorrectionRepository.review()` updates the correction
row's status **and** applies the requested sign-in/out values (only the
fields that were actually requested) to the target `AttendanceRecord`
inside one `$transaction`, also setting `reviewStatus: APPROVED`.
Rejection only touches the correction row — the original attendance
values are never mutated, remaining exactly as they were, auditable via
the record's own `updatedAt` history and this correction row.

This is Sprint 24's one deliberate, documented exception to "only an
entity's own repository writes its own table" — `attendance-
correction.repository.ts` also writes `attendanceRecord`, but only
inside `review()`'s own transaction, to apply an approved correction —
the same kind of one-exception carve-out `hr-independence.spec.ts`
already documents for Maintenance's inventory write. Proven, not just
asserted, by `hr-independence.spec.ts`'s updated structural guard.

### 14.6 Frontend

- **Admin**: `/settings/hr/attendance` — date/department/review-status
  filters, a responsive `hidden md:block` table / `md:hidden` card list
  (the `sales/page.tsx` pattern, since this list needs genuine mobile
  responsiveness), administrative-entry dialog, and
  `/settings/hr/attendance/:id` detail with review actions and inline
  correction-request review/approve/reject.
- **Self-service**: `/attendance` — a new, dedicated mobile-first route
  group (`(attendance)`, `AttendanceShell`/`AttendanceHeader`), the exact
  `(technician)` rationale from the Sprint 22 Field-Sales/Field-
  Maintenance separation: sign-in/out is an HR concern any employee may
  need regardless of whether they're a Field Sales agent, a Field
  Technician, or an office employee, so it is deliberately not bolted
  onto either of those existing shells. One primary action button
  (Sign In / Sign Out / Completed / Requires Correction) driven by
  today's record state; shows location-permission status in plain
  language; shows a short history with a "Request a correction" action
  per past record. Reachable from the sidebar's "My Attendance" entry.
- **Employee detail**: a new "Attendance, Training & Policies" section
  on `/settings/hr/employees/:id` shows the 5 most recent attendance
  records, all training assignments, and an acknowledgement count —
  reusing the existing admin-facing read endpoints, no duplicated data.

## 15. Work Schedules

`WorkSchedule` — `code`/`name` (idempotent-by-code create, the
`DepartmentRepository` master-data convention), `workDays` (a JSON array
of 0-6 day-of-week integers), `expectedStartTime`/`expectedEndTime`
("HH:mm" strings — deliberately not `DateTime`, since a schedule's
expected hours have no calendar date of their own), `gracePeriodMinutes`,
`status` (`ACTIVE`/`INACTIVE`). Overnight schedules (end before start)
are explicitly permitted; only an exact `expectedStartTime ===
expectedEndTime` configuration is rejected as invalid. No rotating-shift/
roster engine, no per-schedule timezone override (all schedule/lateness
calculations use the organisation's own `timeZone`) — both documented
MVP boundaries, not gaps.

`Employee.workScheduleId` is a direct nullable FK — no assignment-
history table, deliberately matching the precedent
`departmentId`/`positionId` already established (§3) rather than
introducing a new pattern for this one relation. Historical schedule-
assignment tracking is a documented deferral (§21).

## 16. Training

`TrainingCourse` (catalogue: `code`/`title`, `deliveryMode`
`IN_PERSON`/`ONLINE`/`BLENDED`/`SELF_STUDY`, optional `durationMinutes`/
`validityPeriodDays`, `status` `DRAFT`/`ACTIVE`/`ARCHIVED`) and
`EmployeeTraining` (one assignment: `employeeId`, `trainingCourseId`,
`assignedByUserId`, `dueDate?`, `startedAt?`/`completedAt?`, `status`
`ASSIGNED`/`IN_PROGRESS`/`COMPLETED`/`OVERDUE`/`CANCELLED`,
`completionNotes?`, `certificateDocumentId?` — an optional link to an
existing `EmployeeDocument`, never a new document/file system).
Explicitly **not** an LMS: no content delivery, no quizzes, no video
hosting — Mindcraft Learn remains a wholly separate product.

`EmployeeTrainingService.assign()` requires the course to be `ACTIVE`
(assigning a draft/archived course is rejected) and rejects a duplicate
_active_ (`ASSIGNED`/`IN_PROGRESS`) assignment for the same employee/
course pair — a new assignment is fine once the prior one reaches a
terminal state. `complete()` validates a supplied
`certificateDocumentId` belongs to the same employee (cross-employee
certificate reuse rejected) and stamps `completedAt`; `cancel()` and
`complete()` both reject once an assignment is already `COMPLETED`/
`CANCELLED` (a documented terminal-state guard, the `TERMINAL_STATUSES`
pattern every other lifecycle in this codebase uses).

`OVERDUE` is derived lazily, never by a cron job or notification engine:
`EmployeeTrainingRepository.syncOverdue()` flips any `ASSIGNED`/
`IN_PROGRESS` row whose `dueDate` has passed to `OVERDUE` via one
`updateMany`, called before every list/get read (mirroring §14.3's
`markPastIncomplete()` for attendance) — live-verified: a seeded
past-due assignment displayed and reported correctly as `OVERDUE` on its
very first live read.

Frontend: `/settings/hr/training` (course catalogue, create/activate/
archive) and `/settings/hr/training/:id` (assignment list, assign new,
complete/cancel) — live-verified end to end, including assigning a new
employee and completing an assignment.

## 17. Policies

`Policy` (catalogue entry: `code`/`title`, `scopeType`
`ORGANISATION`/`DEPARTMENT` with an optional `departmentId` and
`ownerDepartmentId`, `status` `DRAFT`/`ACTIVE`/`ARCHIVED`) and
`PolicyVersion` (`versionNumber` — server-generated, a linear probe
inside a transaction, the exact `generateEmployeeCode()` pattern;
`content` as plain text — no file-attachment system was introduced this
sprint, a documented deferral, §21; `effectiveDate`,
`requiresAcknowledgement`, `status` `DRAFT`/`PUBLISHED`/`ARCHIVED`).

**Versioning rules**, enforced in `PolicyService`/`PolicyRepository`:
only a `DRAFT` version can be published; publishing one auto-archives
whichever version was previously `PUBLISHED` for the same policy (only
one current version at a time), inside one transaction alongside the new
version's own `PUBLISHED`/`publishedAt`/`publishedByUserId` update.
Published and archived versions are immutable — no update endpoint
targets `PolicyVersion.content`. Archived versions remain fully visible
via `GET /hr/policies/:id/versions` — nothing is ever hidden or deleted
(a material policy change always creates a new version, never edits an
old one). A policy itself flips `DRAFT → ACTIVE` the first time one of
its versions is published (never client-set directly) and stays
`ACTIVE` unless explicitly archived; publishing under an already-
`ARCHIVED` policy is rejected. Live-verified: creating a v3 draft under
the seeded two-version Conduct policy, then publishing it, correctly
archived v2 (previously published) while leaving v1 (already archived)
untouched.

**Acknowledgement**: `PolicyAcknowledgement` (`employeeId`,
`policyVersionId`, `acknowledgedAt`, `source`
`SELF_SERVICE`/`ADMINISTRATIVE`) — unique per `(employeeId,
policyVersionId)` (idempotent create, P2002-catch), only accepted
against a `PUBLISHED` version. **This sprint has no employee
self-service acknowledgement UI** — acknowledgement is recorded
administratively on an employee's behalf via the Admin policy detail
page. The `POST .../acknowledge` endpoint itself does support a
self-service caller (resolving the acknowledging employee via
`findByUserId` when no `employeeId` is supplied, and stamping
`source: SELF_SERVICE`), so the backend is ready the moment a
self-service surface is added — a documented, narrow limitation, not a
missing capability underneath. Viewing a policy is never treated as
acknowledgement; nothing auto-acknowledges every employee.

Frontend: `/settings/hr/policies` (catalogue, create) and
`/settings/hr/policies/:id` (version history, create/publish version,
record acknowledgement) — live-verified end to end.

## 18. People Operations Overview (extended)

`HrOverviewService.getOverview()` adds, alongside Sprint 23's employee/
department/onboarding figures: today's attendance split
(`present`/`late`/`pendingReview`, bucketed by the same
`resolveAttendanceDate()` used everywhere else in this sprint),
`attendanceRequiringReview` (count with `reviewStatus:
REQUIRES_CORRECTION`), `pendingPolicyAcknowledgements`, and
`activeTrainingAssignments`/`overdueTrainingAssignments`. Every figure
is a live aggregate over existing repositories — no repository of its
own, the same `MaintenanceOverviewService` "pure composition, no
persisted snapshot" pattern Sprint 23 already established.

**`pendingPolicyAcknowledgements`'s exact denominator**, since a
fabricated rate is explicitly forbidden by the brief: for every `ACTIVE`
policy with a `PUBLISHED` version that `requiresAcknowledgement`, add
`max(totalEmployees - acknowledgementsForThatVersion, 0)`; sum across
all such policies. Live-verified against real seed data: 3 policy
versions require acknowledgement (Conduct v2, Safety, Production
Hygiene), 13 total employees, 4/2/0 already acknowledged respectively →
`(13-4) + (13-2) + (13-0) = 33`, exactly what the live Overview page
displayed. No absenteeism rate, productivity score, or engagement metric
is computed — none has a defensible denominator yet.

## 19. Access-Control Preparation (unchanged from Sprint 23, extended)

Every new Sprint 24 mutation endpoint follows §9's existing convention
exactly: `@Roles('Owner', 'Administrator')` for management actions
(work-schedule/policy/training-course CRUD, administrative attendance
entry, attendance review, correction review, training assignment).
Self-service actions — sign-in, sign-out, requesting your own
correction, and (when used) self-service acknowledgement — use plain
`@UseGuards(JwtAuthGuard)` with no role check, open to any authenticated
organisation member, matching how other self-service actions elsewhere
in this codebase (e.g. Field Sales order creation) are gated. No new
permission key was introduced, and none is inferred from Department/
Position/manager relationship/employment status, per the brief's
explicit instruction. If/when Sprint 25's fine-grained engine exists,
the natural additional permission-key names for this sprint's endpoint
groups are `HR_ATTENDANCE_VIEW`/`HR_ATTENDANCE_MANAGE`/
`HR_ATTENDANCE_REVIEW`, `HR_POLICY_MANAGE`/`HR_POLICY_ACKNOWLEDGE`,
`HR_TRAINING_MANAGE`/`HR_TRAINING_VIEW` — not implemented, but the
endpoint boundaries are already this clean.

## 20. Tenant Isolation & Audit (extended)

**Tenant isolation** follows §10's identical convention for every new
repository (`WorkScheduleRepository`, `AttendanceRepository`,
`AttendanceCorrectionRepository`, `PolicyRepository`,
`PolicyAcknowledgementRepository`, `TrainingCourseRepository`,
`EmployeeTrainingRepository`) — `organisationId` first parameter,
present in every `where`, `updateMany`-then-refetch mutations. Covered
by dedicated cross-tenant test cases in `attendance.service.spec.ts`,
`attendance-correction.service.spec.ts`, `policy.service.spec.ts`,
`training-course.service.spec.ts`, and
`employee-training.service.spec.ts`.

**Audit** extends `HR_AUDIT_ACTIONS` with 21 new actions
(`hr.work_schedule.*`, `hr.attendance.*`, `hr.policy.*`,
`hr.training_course.*`, `hr.training.*`) — same catalog, same
controller-records-after-success-guarded-by-a-transition-flag pattern.

## 21. Deferred / Non-Goals (Sprint 24)

Explicitly out of scope, per the brief — not partially built, not
stubbed:

- Payroll, salary/compensation, payslips, tax/pension/statutory
  deductions.
- Leave balances or leave approval (`ON_LEAVE` still has no transition
  into or out of it — see §6).
- Recruitment, interview management.
- Performance appraisal, a KPI-scoring engine, bonuses/incentives,
  gamification.
- Biometric hardware integration, facial recognition, device trust.
- Geofencing enforcement, continuous/GPS location tracking or a location
  history stream (§14.4 — at most one point captured per sign-in/out).
- A full shift-planning/rotating-roster engine, overtime/payroll
  calculations.
- A workflow engine, a notification engine (attendance corrections,
  overdue training, and pending acknowledgements are all read/reviewed
  manually this sprint — the natural hooks for a future engine, not
  wired to one yet).
- Access-control redesign (§19).
- A cross-domain reporting platform (§12's "consume, never duplicate"
  boundary still applies).
- An employee self-service portal beyond the one narrow `/attendance`
  surface (§14.6) and the backend-ready-but-not-exposed self-service
  policy acknowledgement path (§17).
- LMS/course-content delivery (§16).
- Historical work-schedule assignment tracking (§15 — a direct FK, no
  assignment-history model).
- Bulk attendance import (`AttendanceSource.IMPORTED` exists in the enum
  as a reserved value for a future import path; no importer exists).
- **A frontend automated test framework** — unchanged from §11.

## 22. Future Integration Points (as of Sprint 24)

- **Sprint 25 — Access Control + Organisational Structure** (next): see
  §19 for the concrete permission-key surface this sprint leaves ready.
- **Sprint 26 — Workflow & Approval Engine** (subsequent): attendance
  correction review and training/policy follow-ups are natural first
  workflows to automate; nothing here needs restructuring to support
  that.
- **Sprint 27 — Notification + Business Activity Engine** (subsequent):
  overdue training, pending correction requests, and pending
  acknowledgements are the concrete triggers a notification engine would
  consume from this sprint's data, unchanged.
- **Leave management** (unscheduled): the `ON_LEAVE` enum value is still
  waiting for its first sprint.
- **Management Reporting** (unscheduled, unchanged from §12): this
  sprint's overview aggregates extend the same read-only composition
  boundary, ready to be consumed by a future cross-domain reporting
  layer without duplication.
