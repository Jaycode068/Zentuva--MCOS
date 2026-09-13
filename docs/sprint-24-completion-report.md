# Sprint 24 Completion Report — HR Attendance, Training & People Operations

## 1. Objective

Extend the Sprint 23 HR Employee Lifecycle Foundation from employee
_records_ into basic daily people operations: work schedules, daily
attendance (sign-in/out, corrections, review), a policy catalogue with
versioning and acknowledgement, a lightweight training catalogue, and an
extended People Operations overview — without becoming payroll, leave
management, recruitment, performance/KPI tooling, an LMS, or a workflow/
notification engine.

## 2. Starting State

Sprint 23 was already complete, committed, and merged to `main`
(confirmed via `git status` — clean tree except a local `.claude/`
directory; 70/70 HR backend tests passing at session start). The brief
explicitly stated Sprint 23 was complete and Sprint 24 should build on
it without rewriting it — inspection confirmed this was true before any
code was written.

## 3. Implementation Plan (produced before coding, per the brief's own instruction)

Presented to the user before any schema/code changes, based on
inspection of: the Sprint 23 HR module, Employee/Department/Position/
User models, the existing audit catalog, `FileStorageModule`, tenant
context, auth guards, frontend settings patterns, `packages/validation`,
the seed script, and existing test conventions. Key decisions made up
front and followed through unchanged:

- **Timezone strategy:** no date library exists anywhere in this
  codebase; store all attendance timestamps as UTC, derive a
  "business date" via `Intl.DateTimeFormat('en-CA', ...)` against
  `Organisation.timeZone` (a field that already existed, unused for
  date-bucketing, since Sprint 3.4).
- **Location strategy:** nullable lat/lng/accuracy/label columns
  directly on `AttendanceRecord`, one snapshot per sign-in/out event —
  no history stream, no geofencing.
- **Correction/review strategy:** a dedicated `AttendanceCorrectionRequest`
  entity, approval applied atomically inside one transaction.
- **Policy versioning strategy:** `PolicyVersion.versionNumber`
  server-generated per policy; publishing auto-archives the prior
  version; published/archived versions immutable.
- **Training assignment strategy:** duplicate active-assignment
  rejection; `OVERDUE` derived lazily on read, no cron job.
- **Employee/User boundary:** self-service resolves the caller's own
  employee via the existing `findByUserId`; administrative entry can
  target any employee directly.
- **Deferred, explicitly:** everything in the brief's "do not implement"
  list, plus schedule-assignment history and policy file attachments.

## 4. Architecture Decisions

- **Attendance record granularity:** one `AttendanceRecord` per
  `(organisationId, employeeId, attendanceDate)` — sign-in/out are
  columns on that one row, not separate event rows. A documented MVP
  limitation: one sign-in/out pair per employee per day, not multiple
  shifts/sessions.
- **Work schedules:** `Employee.workScheduleId` is a direct nullable FK,
  matching the precedent `departmentId`/`positionId` already
  established in Sprint 23 — no new assignment-history model introduced
  for this one relation.
- **Status derivation without a scheduler:** both `AttendanceRecord
.INCOMPLETE` and `EmployeeTraining.OVERDUE` are derived _lazily_, via
  an `updateMany` executed at the top of every relevant list/get read —
  no cron job, no notification engine, and only statuses actually
  reachable by implemented code are ever written (`ABSENT`/`OFF_DAY`/
  `EXCUSED` remain defined in the enum but unused, per the brief's own
  caution against auto-marking absence without a defined process).
- **Policy content:** stored as plain text on `PolicyVersion.content` —
  no new file-attachment system was introduced for policies this
  sprint.
- **Correction ownership:** an employee may request a correction only
  for their own attendance record; an administrator fixing someone
  else's record uses the review/administrative-entry paths directly,
  not a request-then-self-approve round trip through this endpoint.
- **RBAC:** the existing `@Roles('Owner','Administrator')` vs. plain
  `@UseGuards(JwtAuthGuard)` (self-service) convention, unchanged — no
  new permission key, since none is evaluated anywhere in the app yet
  (still deferred to Sprint 25).
- **Frontend self-service surface:** a new, dedicated `(attendance)`
  route group at `/attendance` — not bolted onto Field Sales or Field
  Maintenance — following the exact separation rationale the prior
  session already established when it split Field Technician
  Maintenance out of the Field Sales shell.

## 5. Database Changes (one additive migration)

Migration `20260912185438_sprint24_hr_attendance_training_people_ops`:

- New models: `WorkSchedule`, `AttendanceRecord`,
  `AttendanceCorrectionRequest`, `Policy`, `PolicyVersion`,
  `PolicyAcknowledgement`, `TrainingCourse`, `EmployeeTraining`.
- New enums: `WorkScheduleStatus`, `AttendanceStatus`,
  `AttendanceReviewStatus`, `AttendanceSource`,
  `AttendanceCorrectionStatus`, `PolicyScopeType`, `PolicyStatus`,
  `PolicyVersionStatus`, `PolicyAcknowledgementSource`,
  `TrainingDeliveryMode`, `TrainingCourseStatus`,
  `EmployeeTrainingStatus`.
- New relation: `Employee.workScheduleId` (nullable FK to
  `WorkSchedule`).
- `Organisation` gained 8 new back-relations (`hrWorkSchedules`,
  `hrAttendanceRecords`, ..., `hrEmployeeTrainings`); `Department`
  gained `scopedPolicies`/`ownedPolicies`; `EmployeeDocument` gained
  `trainingCertificateFor` (the certificate-reference back-relation).
- No existing table, column, or migration was altered — purely
  additive. `prisma validate` and `prisma migrate dev` both ran clean;
  `prisma migrate status` confirms the migration applied.

## 6. Validation Schemas

`packages/validation/src/hr.ts` extended with: work-schedule create/
update/assign schemas, sign-in/sign-out/administrative-entry/review/
correction-request/correction-review schemas, policy create/update/
version/acknowledge schemas, and training-course create/update/assign/
update-assignment/complete schemas. Every server-injected field
(`organisationId`, actor ids, server-generated codes/version numbers) is
omitted from every schema — never trusted from the client. Rebuilt
(`pnpm --filter @zentuva/validation build`) after every schema-file
edit, per the Sprint 23 lesson already documented in memory.

## 7. Backend Implementation

New files under `apps/api/src/hr/`:

- `hr-attendance-date.util.ts` (+ spec) — the timezone-bucketing
  utility.
- `policy-version-number.ts` — the version-number generator.
- `work-schedule.repository.ts`/`.service.ts` (+ spec) /`.controller.ts`.
- `attendance.repository.ts`/`.service.ts` (+ spec)/`.controller.ts`.
- `attendance-correction.repository.ts`/`.service.ts` (+ spec).
- `policy.repository.ts`/`.service.ts` (+ spec)/`.controller.ts`.
- `policy-acknowledgement.repository.ts`.
- `training-course.repository.ts`/`.service.ts` (+ spec).
- `employee-training.repository.ts`/`.service.ts` (+ spec).
- `training.controller.ts`.

Modified: `employee.repository.ts`/`.service.ts`/`.controller.ts`
(added `assignWorkSchedule`), `hr-audit-actions.ts` (+21 actions),
`hr-overview.service.ts` (extended with attendance/policy/training
figures), `hr.module.ts` (all new providers/controllers registered),
`hr-independence.spec.ts` (extended file list and write-pattern guard
to cover every new file, including the one documented
correction-repository write exception).

## 8. Frontend Implementation

New pages under `apps/web/src/app/(app)/settings/hr/`:
`schedules/page.tsx`, `attendance/page.tsx` + `attendance/[id]/page.tsx`,
`policies/page.tsx` + `policies/[id]/page.tsx`,
`training/page.tsx` + `training/[id]/page.tsx`. Extended `api.ts` and
`labels.ts` with every Sprint 24 type/function/label. Extended
`hr-tabs.tsx` (4 new tabs) and the Employee detail page (a new
"Attendance, Training & Policies" section) and the HR Overview page (6
new summary cards).

New self-service surface: `apps/web/src/app/(attendance)/` (layout +
`attendance/page.tsx`), `apps/web/src/components/attendance/`
(`AttendanceShell.tsx`/`AttendanceHeader.tsx`, mirroring the
`(technician)` route group's own shell pattern) — a new `ClockIcon` and
a "My Attendance" sidebar entry in `navigation-config.ts`.

## 9. Integrations

- `OrganisationService.getById()` (Identity, already exported) —
  read-only, for `Organisation.timeZone`.
- `EmployeeDocumentRepository.findById()` (existing HR repository) —
  read-only, to validate a training certificate reference belongs to
  the target employee.
- No other domain module was imported; no other domain imports HR.

## 10. Tests

70 pre-existing HR tests (Sprint 23) plus new Sprint 24 coverage, all
passing:

- `hr-attendance-date.util.spec.ts` — 6 tests (timezone bucketing,
  future-date detection).
- `work-schedule.service.spec.ts` — 6 tests (idempotent create,
  overnight schedules, invalid identical start/end, tenant isolation,
  activate/deactivate).
- `attendance.service.spec.ts` — 17 tests (sign-in idempotency, location
  capture/omission, separated/inactive rejection, sign-out-requires-
  sign-in, LATE/PRESENT derivation against a work schedule,
  administrative entry cross-tenant/future-date/no-prior-sign-in
  rejection, lazy INCOMPLETE derivation).
- `attendance-correction.service.spec.ts` — 9 tests (request validation,
  duplicate-pending rejection, ownership rejection, atomic approval,
  rejection leaves original untouched, self-approval rejection,
  already-reviewed rejection).
- `policy.service.spec.ts` — 11 tests (version numbering, archived-
  policy rejection, publish auto-archives prior version and activates
  the policy, already-published rejection, historical-version
  visibility, tenant isolation, acknowledgement create/duplicate/
  administrative/cross-tenant-rejection).
- `training-course.service.spec.ts` — 7 tests (idempotent create,
  activate/archive, assignment-requires-active-course, tenant
  isolation).
- `employee-training.service.spec.ts` — 11 tests (assignment creation/
  cross-tenant/inactive-course/duplicate-active rejection, completion,
  cancelled-assignment rejection, certificate cross-employee rejection,
  cancel terminal-state guard, IN_PROGRESS stamps `startedAt`, tenant
  isolation).
- `hr-independence.spec.ts` — extended, all 7 structural guards still
  pass against every new file.

Full backend regression: **169 test suites / 1430 tests passing** (up
from 162/1363 at session start), zero regressions in any other domain.

## 11. Live Verification Performed

Against the real local Boby Bites tenant, both dev servers running the
current code (`pnpm --filter api dev`, `pnpm --filter web dev`):

1. HR Overview loads with all 6 new summary cards; hand-verified the
   "Pending Policy Acknowledgements" figure (33) against the exact
   seeded data (3 acknowledgement-requiring versions × per-version
   `totalEmployees − acknowledged` — matched exactly).
2. Work Schedules tab lists both seeded schedules correctly.
3. Attendance admin page: date/department/review-status filters;
   listed the seeded PRESENT (with a demo location label) and LATE (no
   location, denied) records for the filtered date.
4. Attendance detail page → approved a real pending correction request
   → confirmed the sign-in time updated atomically (10:25 → 10:05) and
   review status flipped to Approved, in one live action.
5. Self-service `/attendance`: signed in (server-recorded time, LATE
   status correctly derived against the linked work schedule, location
   permission denial handled gracefully with a clear message, no
   fabricated coordinates), then signed out; repeated visits correctly
   showed "Completed"; history and "Request a correction" both
   rendered.
6. Policy detail page: created a new Draft version under the seeded
   two-version Conduct policy, published it — confirmed the previously-
   published version auto-archived and the older archived version
   stayed visible, all live.
7. Training course detail page: completed the seeded OVERDUE assignment
   (confirmed lazy-overdue derivation had already applied it correctly
   on read) and assigned a new employee to a course — both actions
   updated the UI immediately with correct status badges.
8. Employee detail page: verified the new "Attendance, Training &
   Policies" section against a real employee, showing genuinely
   different live data (recent attendance, a completed training
   assignment, no acknowledgements) — not placeholder content.
9. Responsive verification at 375px: self-service `/attendance` page,
   the admin Attendance list (table→card fallback engaged correctly,
   showing the just-approved correction reflected in the card view).
10. Console/network verification: zero console errors and zero failed
    requests on every page above, after fixing the two bugs below.
11. Confirmed zero accounting/inventory/procurement/production/sales/
    distribution/asset/maintenance side effects — no other domain's
    data changed during any of the above actions.
12. Seed run twice in direct succession
    (`pnpm --filter api exec ts-node prisma/seed.ts`) — second run
    logged "Skipping Sprint 24 fixtures — already seeded," and a direct
    count query confirmed identical row counts
    (`workSchedule: 2, attendanceRecord: 5, attendanceCorrectionRequest:
1, policy: 4, policyVersion: 5, policyAcknowledgement: 6,
trainingCourse: 4, employeeTraining: 3`) before and after —
    idempotent.

Not exhaustively re-driven live (already covered by the automated
suite above and considered lower-risk): every individual validation
rejection path, every cross-tenant rejection, and duplicate-pending-
correction/duplicate-active-assignment prevention — each has a direct
unit test with the same assertion a live click would exercise.

## 12. Bugs Found and Fixed During Live Verification

1. **`pageSize: 100` cap violation.** Three frontend dialogs
   (`attendance/page.tsx`'s administrative-entry employee picker,
   `training/[id]/page.tsx`'s assign dialog,
   `policies/[id]/page.tsx`'s acknowledge dialog) called
   `listEmployees({ pageSize: 200, ... })`, exceeding
   `paginationSchema`'s existing max of 100 and causing a live 500 from
   `EmployeeController.list`'s Zod validation. Fixed by capping all
   three at 100, the value every pre-existing employee-picker in this
   codebase already used.
2. **A real SSR/client hydration mismatch** on the new self-service
   `/attendance` page: `new Date().toLocaleDateString()` rendered
   directly in JSX produced different text on the server (Node's
   default locale) versus the client (the browser's locale), triggering
   a Next.js dev-mode hydration-error overlay. Fixed with
   `suppressHydrationWarning` on that one text node — the standard React
   pattern for a value that legitimately differs between server and
   client render, confirmed resolved by re-checking the console on
   reload.

Neither bug existed in the pre-existing Sprint 23 pages or the
`(technician)` shell this new work modeled itself on — both were
confirmed genuinely new, both fixed, both re-verified live.

## 13. Accounting & Inventory Safety

`hr-independence.spec.ts`'s structural guards (unchanged assertion
technique, extended file list) confirm: no HR file — old or new — ever
writes an Accounting/Finance/Procurement/Supplier/Sales/Production/
Distribution/Asset/Maintenance table; `postSystemJournalEntry` is never
called; no forbidden cross-domain import exists; `HrModule` still
imports only `IdentityModule`/`AuthModule`/`FileStorageModule`; and no
`UserRole`/`RolePermission`/`Role` write exists anywhere in `hr/`.

## 14. Tenant Isolation

Every new repository follows the identical, established convention:
`organisationId` as the first parameter, present in every `where`
clause, `updateMany`-then-refetch mutations so a cross-tenant id
structurally cannot match. Covered by dedicated cross-tenant test cases
in every new `*.service.spec.ts` file (work schedules, attendance,
corrections, policies, training courses, training assignments).

## 15. Documentation Updated

- [`docs/domains/hr.md`](domains/hr.md) — restructured into Part A
  (Sprint 23, §1-§12, with two stale forward-references corrected:
  `ON_LEAVE` still has no transition, and the Sprint 23 §11 deferred
  list now strikes through what Sprint 24 actually built) and Part B
  (Sprint 24, §13-§22 — full data model, attendance/schedule/policy/
  training design, overview extension, access-control preparation,
  tenant isolation/audit extension, deferred list, future integration
  points).
- [`docs/domains/README.md`](domains/README.md) — HR row updated to
  cover both sprints.
- [`docs/backlog.md`](backlog.md) — Epic 24 status and §5 Current Sprint
  Status updated; Sprint 24 marked complete; Sprint 25/26/27 named as
  next/subsequent.
- [`docs/roadmap.md`](roadmap.md) — Sprint 24 moved to shipped; Sprint
  26 (Workflow & Approval Engine) and Sprint 27 (Notification +
  Business Activity Engine) added as subsequent, per the brief.
- [`docs/changelog.md`](changelog.md) — new dated entry.
- [`README.md`](../README.md) — top-level summary paragraph extended.
- This report.

## 16. Final Quality Gate

| Check                     | Result                                                               |
| ------------------------- | -------------------------------------------------------------------- |
| `prisma validate`         | ✅ Pass                                                              |
| `prisma migrate status`   | ✅ Up to date                                                        |
| API `tsc --noEmit`        | ✅ Clean                                                             |
| Web `tsc --noEmit`        | ✅ Clean                                                             |
| API lint                  | ✅ 0 errors, 27 pre-existing warnings (unchanged baseline)           |
| Web lint                  | ✅ 0 errors, 0 warnings                                              |
| API tests                 | ✅ 169 suites / 1430 tests passing                                   |
| API build                 | Covered by `tsc --noEmit` + `nest build`-equivalent lint/typecheck   |
| Web build                 | ✅ `next build` succeeds, all 90 routes generated including new ones |
| Seed, run twice           | ✅ Idempotent, verified by direct row-count query                    |
| Live browser verification | ✅ See §11                                                           |
| Responsive (375px)        | ✅ See §11                                                           |
| Console/network errors    | ✅ Zero, after the two fixes in §12                                  |

## 17. Deferred by Design

- Payroll, salary/compensation, payslips, tax/pension/statutory
  deductions.
- Leave balances or leave approval — `ON_LEAVE` still has no transition
  into or out of it.
- Recruitment, interview management.
- Performance appraisal, a KPI-scoring engine, bonuses/incentives,
  gamification.
- Biometric integration, facial recognition, device trust.
- Geofencing enforcement, continuous/GPS location tracking, a location
  history stream.
- A full shift-planning/rotating-roster engine, overtime/payroll
  calculations.
- A workflow engine, a notification engine.
- Access Control redesign (Sprint 25).
- A cross-domain reporting platform.
- An employee self-service portal beyond the one narrow `/attendance`
  surface and the backend-ready-but-not-exposed self-service policy
  acknowledgement path.
- LMS/course-content delivery.
- Historical work-schedule assignment tracking.
- Bulk attendance import.
- A frontend automated test framework — unchanged from Sprint 23's own
  decision.

## 18. Repository State

- **No commit performed.**
- **No push performed.**
- All Sprint 24 work — schema migration, backend code and tests,
  frontend code, seed data, and documentation — is present in the
  working tree, uncommitted, exactly as the brief requires.
- **Sprint 24 status: complete and live-verified.**
- **Next sprint: Sprint 25 — Access Control + Organisational
  Structure.**
