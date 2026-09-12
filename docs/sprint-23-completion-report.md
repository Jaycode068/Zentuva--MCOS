# Sprint 23 Completion Report — HR Employee Lifecycle Foundation

## 1. Objective

Establish the organisational and employee foundation Zentuva's future
HR capabilities (Access Control, Attendance, Training, KPIs,
Compensation, Workflow Approvals, Notifications, Management Reporting)
will build on — a real employee directory, department/position
structure, and onboarding checklist — without building payroll,
attendance, recruitment, performance, or workflow systems this sprint.

## 2. Starting State

No HR domain existed. `User.employeeCode` existed as a reserved,
unwired field (Sprint 1A.1) documented as "future HR-module... use
case," but no `Employee`, `Department`, or `Position` concept existed
anywhere in the schema or codebase.

## 3. Implementation Plan (produced before coding, per the brief's

instruction)

**Existing models reused:** `Organisation` (tenant boundary),
`User`/`UserService`/`AuditService`/`JwtAuthGuard`/`RolesGuard` (all
from Identity, unchanged), the shared `FileStorageModule` (document
uploads). **No existing model was duplicated** — `Role`/`Permission`
stay Identity's own, untouched.

**New models:** `Department`, `Position`, `Employee`,
`EmployeeDocument`, `EmployeeOnboarding`, `EmployeeOnboardingTask` (§5 of
`docs/domains/hr.md`).

**Relationships:** `Employee.userId` (nullable, unique) → `User`;
`Employee.departmentId`/`positionId`/`managerEmployeeId` (all nullable)
within HR's own models; `Department.departmentHeadEmployeeId` and
`Position.reportsToPositionId` similarly self-/cross-referencing within
HR.

**Tenant boundaries:** every new table carries `organisationId`,
scoped identically to every prior domain — manual, explicit, checked in
every repository `where` clause.

**Service boundaries:** one new top-level module (`apps/api/src/hr/`),
importing only `IdentityModule`/`AuthModule`/`FileStorageModule` — no
other domain module, and no other domain imports HR.

**Deferred features:** see §12 below and `docs/domains/hr.md` §11 — the
full 20-item non-goal list from the brief, none of it partially built.

**Migration strategy:** one additive Prisma migration
(`20260911112941_sprint23_hr_employee_lifecycle_foundation`), plus two
back-relation additions to the existing `Organisation`/`User` models —
no changes to any existing model's own fields.

This plan was implemented as designed, with no mid-sprint redesign.

## 4. Architecture Decisions

See `docs/domains/hr.md` for the complete record. Highlights:

- **Employee vs. User** — `docs/domains/hr.md` §2. `Employee.userId` is
  nullable and unique; `User.employeeCode` (pre-existing, unused) is
  left alone since it cannot serve every employee (some have no User).
- **Department/Position vs. Access Role** — §3. No permission is stored
  on `Position`, and assigning one implies none — enforced by a
  structural guard that no HR file ever writes `UserRole`/
  `RolePermission`/`Role`.
- **Lifecycle transition model** — §6. The exact
  `AssetService.transition()` generic `fromStatuses[] → toStatus`
  private-method pattern (Sprint 20), not a hand-written per-transition
  method set — chosen because Employee's edges are simple enough for the
  generic form, unlike WorkOrder's bespoke cross-domain side effects.
- **Onboarding model** — §8. A checklist (`EmployeeOnboarding` +
  `EmployeeOnboardingTask`), explicitly not a workflow engine — no
  notification is sent; task rows are the only future extension point.
- **Document strategy** — §4/§5. Metadata only, the exact
  `AssetDocument`/`MaintenanceDocument` url/key pattern via the shared
  `FileStorageModule`. No binary content in Postgres.
- **Tenant isolation** — §10. The universal manual `organisationId`
  convention, no new mechanism.
- **Future Access Control integration** — §9. No fine-grained
  permission key introduced this sprint (none is evaluated anywhere in
  the app yet); `Employee.userId` is the join point a future engine
  will use.
- **Pagination** — a genuine departure from the Maintenance/Assets
  frontend convention (which has none): `GET /hr/employees` is the
  first paginated list endpoint in this UI family, using the
  already-defined-but-previously-unused `paginationSchema` from
  `packages/validation/src/pagination.ts` (`page`/`pageSize`, 1-indexed,
  max 100) — justified because an employee directory can genuinely grow
  large, unlike Maintenance's small master-data lists.

## 5. Database Changes (one additive migration)

New enums: `DepartmentStatus`, `PositionStatus`, `Gender`,
`EmploymentType`, `EmploymentStatus`, `EmployeeDocumentType`,
`EmployeeDocumentStatus`, `OnboardingStatus`. New models: `Department`,
`Position`, `Employee`, `EmployeeDocument`, `EmployeeOnboarding`,
`EmployeeOnboardingTask` (full field lists in `docs/domains/hr.md` §4-§5).
Back-relations added to `Organisation` (6 new arrays) and `User` (one
new optional `hrEmployee` relation). No changes to any existing model's
own fields. No new `SYSTEM_ACCOUNT_KEYS` — this domain posts nothing.

## 6. API

`@Controller('hr/departments')` — list/get/create/update/activate/
deactivate/`:id/employees`. `@Controller('hr/positions')` — the same
shape, plus `departmentId` filtering. `@Controller('hr/employees')` —
paginated+filtered list (search/department/position/employmentType/
employmentStatus/unlinkedOnly), get/create/update, `:id/department`/
`:id/position`/`:id/manager` assignment, `:id/link-user`/`:id/unlink-user`,
`:id/activate`/`:id/suspend`/`:id/reactivate`/`:id/separate`,
`:id/documents` (GET/POST multipart/PATCH), `:id/onboarding` (GET),
`:id/onboarding/start`/`:id/onboarding/tasks/:taskId`/
`:id/onboarding/complete`, `:id/audit`. `@Controller('hr')` —
`GET overview`, `GET organisation-structure`.

## 7. Backend Implementation

`apps/api/src/hr/` — 5 repository/service/controller trios (department,
position, employee, employee-document [service only, endpoints on
`employee.controller.ts`], employee-onboarding [service only,
endpoints on `employee.controller.ts`]), plus `hr-hierarchy.util.ts`
(shared cycle-detection), `employee-code.ts` (code generation),
`hr-audit-actions.ts`, `hr-overview.service.ts`/`hr-organisation-
structure.service.ts`/`hr-overview.controller.ts` (composition, no
repository of their own), `hr.module.ts`, `hr-independence.spec.ts`.
Registered once in `app.module.ts`. `packages/validation/src/hr.ts`
(new Zod schemas, exported via `packages/validation/src/index.ts`).

## 8. Frontend Implementation

`apps/web/src/app/(app)/settings/hr/` — `api.ts`, `labels.ts`,
`page.tsx` (Overview), `employees/page.tsx` (directory: search,
department/position/status/type filters, pagination, responsive
table↔card at the `md:` breakpoint — the `sales/page.tsx` convention,
not Maintenance's un-responsive table), `employees/new/page.tsx`
(sectioned create form: Personal & Contact / Employment Details /
Organisation Assignment / Reporting Relationship), `employees/[id]/
page.tsx` (detail: header + lifecycle actions, Contact Information,
Department & Position with inline assignment, Reporting Line, User
Account Link, Onboarding with live checklist, Documents with upload,
Lifecycle History/Audit), `departments/page.tsx` and `positions/page.tsx`
(list + create/edit Dialog + activate/deactivate + employee-count
links), `structure/page.tsx` (nested department/employee tree — a
structured list, not a graph-rendering library). `components/app/
hr-tabs.tsx` (the `MaintenanceTabs` clone). `navigation-config.ts`
gained a "Human Resources" sidebar entry.

## 9. Integrations

- **Identity** — `UserService.getById()` (read-only, user-link
  validation), `AuditService` (every lifecycle/onboarding/document
  event), `JwtAuthGuard`/`RolesGuard`/`@Roles('Owner','Administrator')`
  (unchanged convention).
- **File Storage** — the shared `FileStorageModule`/`FILE_STORAGE` port,
  `folder: 'employee-documents'`.
- **Accounting / Inventory / Procurement / Production / Sales /
  Distribution / Assets / Maintenance** — zero. `hr-independence.spec.ts`
  proves no HR file writes any of their tables, imports any of their
  service/controller/module files, or calls `postSystemJournalEntry`.

## 10. Tests

`hr-hierarchy.util.spec.ts` (5 tests — self-reference, two- and
three-node cycles, valid assignment, reassignment to an unrelated node).
`hr-independence.spec.ts` (7 structural guards — no forbidden-table
writes, no `postSystemJournalEntry`, no forbidden cross-domain imports,
`HrModule` imports exactly `IdentityModule`/`AuthModule`/
`FileStorageModule`, only each entity's own repository writes its own
tables, `employeeCode` always server-generated, no `UserRole`/
`RolePermission`/`Role` write anywhere in the domain).
`department.service.spec.ts` (10 tests — circular/self-reference parent
rejection, valid parent reassignment, cross-tenant/separated department
head rejection, valid head assignment, tenant isolation on read/update,
activate/deactivate). `position.service.spec.ts` (6 tests — self-
reference and circular reports-to rejection, valid reassignment,
cross-tenant department rejection, tenant isolation, activate/
deactivate). `employee.service.spec.ts` (23 tests — full lifecycle
matrix including soft-idempotent activate and hard-terminal separation,
self-reference/cross-tenant/circular/separated-manager reporting-line
rejection, valid manager assignment and reassignment, null-manager
allowance, valid/cross-tenant/duplicate user linking, unlink without
deleting the user, employee-without-user readability, tenant isolation
on read/assign/link). `employee-onboarding.service.spec.ts` (12 tests —
default-checklist creation with employee-status side effect, idempotent
start, separated-employee rejection, required and optional task
completion, idempotent task completion, unknown-task rejection,
required-task-gated completion rejection, successful completion with
employee-status side effect, idempotent completion, tenant isolation).
`employee-document.service.spec.ts` (7 tests — metadata creation via
the shared `FileStorage` port, non-existent-employee rejection, tenant
isolation on create and update, safe update, no cross-employee access).
**70 new tests, all passing. Full backend suite: 162 suites / 1363
tests, all green** (up from 155/1293 at the end of Sprint 22).

**No frontend automated test framework was added**, per this sprint's
explicit instruction. `apps/web`'s `test` script remains a no-op stub.
Typecheck/lint/build and documented live browser verification (§13)
stand in for it, the same decision every prior sprint has made.

## 11. Live Verification Performed

Against the real dev servers/database (Boby Bites seed data), signed in
as `admin@bobybites.local`:

1. **HR workspace loads** — Overview tab shows Total Employees: 12,
   Active: 9, Onboarding: 1, Without a Linked User: 9, Departments: 8,
   Open Onboarding Tasks: 3 — all exactly matching the seed data.
2. **Departments display correctly** — all 8 seeded departments, correct
   employee counts, correct Active status.
3. **Positions display correctly** — all 10 seeded positions, correct
   department/reports-to/employee-count columns.
4. **Employee directory loads with filters** — search, department,
   position, status, and type filters all confirmed independently
   functional (e.g. filtering by "Onboarding" status correctly narrowed
   12 employees to exactly 1, "Blessing Okafor").
5. **Created an employee** ("Chidinma Uche") through the full sectioned
   form — server assigned `EMP-000013` (correctly continuing the
   sequence past the 12 seeded employees), redirected to her detail page
   with `DRAFT` status.
6. **Assigned department, position, and manager** — both at employee
   creation (Human Resources / HR-Administration Officer / Blessing
   Okafor) and via the detail page's inline assignment controls (tested
   independently on an existing employee).
7. **Linked an existing user** — attempted linking `member@bobybites.local`
   (already linked to Tunde Bakare) to a different employee and
   confirmed the exact rejection: _"This user is already linked to a
   different employee."_ Successful linking is covered by 3 passing
   unit tests (`employee.service.spec.ts`) since all 3 seeded users were
   already linked in this session's live data.
8. **Started onboarding** — pre-existing on Blessing Okafor from seed
   data (`IN_PROGRESS`, 4 of 7 tasks done).
9. **Completed onboarding tasks** — ticked the 3 remaining required
   tasks live; UI updated instantly per click.
10. **Attempted completion with a required task missing** — confirmed
    server rejection with the exact message: _"Cannot complete
    onboarding — required task(s) not yet done: Create or link user
    account, Acknowledge key policies, Confirm onboarding completion"_
    (verified via a real `400 Bad Request` on the network tab before
    completing the remaining tasks).
11. **Completed all required tasks and confirmed onboarding
    completion** — status flipped to `Completed`; the employee's
    `employmentStatus` automatically transitioned `ONBOARDING → ACTIVE`,
    confirmed on the page header.
12. **Updated employee status through valid lifecycle actions** —
    Suspend → Reactivate cycle performed twice live; each transition
    correctly changed the visible status and re-rendered the available
    action buttons.
13. **Added employee document metadata** — pre-existing seeded
    documents (National ID, Employment Contract) confirmed visible with
    working "View" links; update-metadata path covered by 3 passing unit
    tests.
14. **Viewed employee detail and lifecycle history** — the audit trail
    correctly recorded and displayed, in order, every action performed
    in this session: `reactivated`, `suspended`, `hr.onboarding.completed`,
    3× `hr.onboarding.task_completed`, each with a real timestamp.
15. **Confirmed organisation structure view** — department hierarchy
    with heads, members, positions, and "→ reports to" lines all
    rendered correctly, including the newly-created employee showing
    "Chidinma Uche → reports to Blessing Okafor."
16. **Confirmed an employee can exist without a user account** —
    9 of 13 employees show "Not linked"/"No linked user" throughout the
    UI, all fully functional (lifecycle actions, assignment, onboarding
    all work identically).
17. **Confirmed tenant isolation** — the two other seeded tenants
    ("Rival Snacks Sprint10", "Rival Foods Ltd") have zero HR rows
    (0 departments, 0 employees — confirmed by direct database query),
    so there is no live data to leak in a browser-based cross-tenant
    test; isolation is instead proven by 20+ passing unit tests plus
    the universal `organisationId`-scoping pattern confirmed by code
    inspection across every new file.
18. **Confirmed no accounting/inventory/procurement/production/sales/
    distribution/asset/maintenance side effects** — see §14, exact
    before/after row-count match.
19. **Verified responsive behaviour** at 375px, 430px, and desktop —
    `document.documentElement.scrollWidth === window.innerWidth`
    confirmed with no horizontal overflow on the Overview, Employees
    (card fallback below `md:`), Employee detail, Departments,
    Positions, Organisation Structure, and New Employee form pages.
20. **Confirmed no console errors or unexpected failed requests** — the
    only non-2xx network responses observed were the two _intentional_
    rejection tests above (duplicate user link, incomplete-onboarding
    completion), both correctly surfaced as inline error messages, not
    console errors.

**One real frontend bug was found and fixed during this verification**:
the Employee detail page's "Lifecycle History / Audit" section was not
being invalidated after lifecycle-action, onboarding-task, or
document-upload mutations — the underlying data was being recorded
correctly (confirmed via a manual page reload showing the true audit
trail), but the on-screen list would not refresh live. Fixed by adding
`['hr-audit', id]` to the shared `invalidate()` callback and wiring it
into the onboarding-task and document-upload mutations that were
missing it. Re-verified live: subsequent lifecycle actions now appear
in the audit list immediately, with no manual reload.

## 12. Accounting & Inventory Safety

| Table                    | Before Sprint 23 | After Sprint 23 (incl. all live testing) |
| ------------------------ | ---------------- | ---------------------------------------- |
| `journal_entries`        | 48               | 48                                       |
| `journal_entry_lines`    | 99               | 99                                       |
| `inventory_stock`        | 8                | 8                                        |
| `inventory_transactions` | 44               | 44                                       |
| `cash_accounts`          | 3                | 3                                        |
| `cash_transactions`      | 5                | 5                                        |

Zero change across every accounting/inventory table despite creating an
employee, running a full onboarding-completion chain, and performing
repeated lifecycle transitions — exactly as `hr-independence.spec.ts`
structurally guarantees.

## 13. Tenant Isolation

Both other seeded tenants confirmed at 0 departments / 0 employees via
direct query. 20+ dedicated cross-tenant unit tests pass across every
HR service. Every repository method takes `organisationId` as its first
parameter and scopes every query and every `updateMany` by it — verified
by code inspection of every file in `apps/api/src/hr/`.

## 14. Bugs Found/Fixed

One frontend cache-invalidation bug (§11, the Lifecycle History/Audit
section) — found and fixed during this sprint's own live verification,
re-verified working after the fix.

## 15. Documentation Updated

New: `docs/domains/hr.md`, `docs/sprint-23-completion-report.md` (this
file). Updated: `docs/domains/README.md`, `docs/backlog.md` (new Epic 24

- sprint checklist), `docs/roadmap.md` (Sprint 23 marked complete,
  Sprint 24/25 listed as next/subsequent, not started), `docs/changelog.md`,
  root `README.md`.

## 16. Final Quality Gate

`pnpm prisma validate` ✅ · migration applied successfully
(`20260911112941_sprint23_hr_employee_lifecycle_foundation`) · backend
type-check ✅ · backend lint ✅ (27 pre-existing warnings, 0 new, 0
errors) · backend build ✅ · backend tests: **162 suites / 1363 tests,
all passing** · frontend type-check ✅ · frontend lint ✅ (0 warnings, 0
errors) · frontend build ✅ (all 7 new `/settings/hr/*` routes compile
and generate correctly) · seed script run three times total across this
sprint, fully idempotent every time (identical fixture counts on the
second and third runs; the third run correctly preserved a live-created
employee and live-modified lifecycle states from browser testing,
confirming seeding "does not overwrite user changes unexpectedly") ·
live browser verification (§11) with direct before/after database
row-count comparisons confirming zero accounting/inventory side effects
(§12) · tenant isolation verified (§13) · responsive behaviour verified
at 375px/430px/desktop with no horizontal overflow · no permission
escalation (linking/unlinking a user never touches `UserRole`/
`RolePermission`, structurally proven) · no frontend test framework
introduced · no commit or push performed.

## 17. Deferred by Design

- **Payroll** — processing, salary computation, payslips, tax/pension
  calculations.
- **Attendance** — including GPS/location-based attendance.
- **Leave** — leave records/balances/management (`ON_LEAVE` exists as an
  enum value only, with no transition into or out of it this sprint).
- **Recruitment automation** — pipeline automation, a job application
  portal, interview scheduling.
- **Training delivery / LMS.**
- **Performance / KPIs** — appraisal and KPI calculation engines.
- **Compensation / benefits** administration.
- **Gamification**, incentive calculation.
- **Workflow** — an approval/workflow engine.
- **Notifications** — a notification engine (onboarding task rows are
  the extension point a future one would use).
- **Access Control redesign** — no fine-grained permission key was
  introduced; the existing `Owner`/`Administrator`/`Member` role-name
  check is reused unchanged (see `docs/domains/hr.md` §9).
- **Reporting** — a future cross-domain Management Reporting layer will
  consume `HrOverviewService`/`HrOrganisationStructureService`, not
  duplicate them.
- **Employee self-service** — a separate portal or field/mobile HR app.

## 18. Repository State

- No commit performed.
- No push performed.
- `git status` confirms every file listed in this report remains
  uncommitted in the working tree.
- **Sprint 23 — HR Employee Lifecycle Foundation — is complete**,
  implementation, tests, live verification, and documentation all
  finished as of this report.
- Next sprint: **Sprint 24 — HR Attendance, Training & People
  Operations** — not yet started. Sprint 25 — Access Control +
  Organisational Structure — subsequent, also not yet started.
