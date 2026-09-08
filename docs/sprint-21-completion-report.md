# Sprint 21 Completion Report — Maintenance Management Foundation

## 1. Objective

Build a Maintenance Management Foundation on top of Sprint 20's Asset
Register: requests, plans, schedules, work orders, tasks, downtime, and
operational cost/parts-usage records — capable of the full chain Asset →
Plan → Schedule → Request/Preventive Trigger → Work Order → Assignment →
Tasks → Execution → Meter/Parts/Cost/Downtime → Completion → Maintenance
History, while remaining strictly operational: zero accounting
integration, zero inventory mutation, zero duplicate infrastructure.

## 2. Architecture Decisions

See `docs/domains/maintenance.md` for the full record (17 sections).
Highlights:

- **`AssetsModule` gained an `exports` array** (`AssetRepository`/
  `AssetService`/`AssetCategoryRepository`/`AssetMeterRepository`/
  `AssetMeterService`) so Maintenance can import it via proper NestJS DI
  — the first domain to consume Asset's own services, not a narrow
  direct-Prisma reach (unlike Asset's own Capital Project reference).
- **`AssetMeterRepository.recordReading()` refactored into a thin wrapper
  around a new exported `recordMeterReadingWithinTransaction()` function**
  — the exact `issueCreditNoteWithinTransaction` extraction technique
  Sprint 11 established, so work order completion can record a meter
  reading inside its own atomic transaction without nesting a second,
  incompatible `$transaction`. Behaviour-preserving; existing
  `asset-meter.repository.spec.ts` still passes unmodified.
- **Preventive scheduling is idempotent by construction** — `generate()`
  advances the due marker to the next occurrence in the same transaction
  it creates a work order in, so a repeat call naturally finds nothing
  due. No separate duplicate-check bookkeeping.
- **No `DRAFT` work order state; `COMPLETED`/`CANCELLED` are hard-terminal**
  — a deliberate departure from the brief's own suggested lifecycle,
  chosen after inspecting existing domain patterns (Sprint 16 §5's "don't
  introduce a state with no second approver" discipline; the `Asset.
DISPOSED`/`RETIRED` hard-terminal precedent).
- **The Asset status transition is a documented two-phase step** — atomic
  within the work order's own transaction for its own facts, then a
  separate, best-effort call into `AssetService`'s own lifecycle methods
  — never nesting one service's transaction inside another's.
- **No new "Technician" RBAC role** — confirmed the codebase's RBAC
  vocabulary is exclusively Owner/Administrator/Member; a technician is
  simply the plain-id `assignedToId` reference, following the established
  `custodianId`/`ownerId` convention.
- **`MaintenancePartUsage.inventoryTransactionId` stays null this sprint**
  — recording a part never deducts `InventoryStock`, a deliberate,
  documented deferral per the brief's own "prefer recording intended
  consumption" guidance.

## 3. Database Changes (one additive migration)

New enums: `MaintenanceTypeStatus`, `MaintenancePlanStatus`,
`MaintenanceScheduleType`, `MaintenanceFrequencyUnit`,
`MaintenanceScheduleStatus`, `MaintenancePriority`, `MaintenanceIssueType`,
`MaintenanceRequestStatus`, `WorkOrderStatus`, `WorkOrderTaskStatus`,
`MaintenanceCostCategory`, `MaintenancePartUsageType`,
`MaintenanceDocumentEntityType`, `MaintenanceDocumentType`. New models:
`MaintenanceType`, `MaintenancePlan`, `MaintenancePlanTask`,
`MaintenanceSchedule`, `MaintenanceRequest`, `WorkOrder`, `WorkOrderTask`,
`AssetDowntime`, `MaintenancePartUsage`, `MaintenanceCost`,
`MaintenanceDocument` (full field lists in `docs/domains/maintenance.md`).
Back-relations added to `Organisation`, `Asset`, `AssetCategory`,
`Supplier`, `Product`. No changes to any existing model's own fields
beyond new back-relations. No new `SYSTEM_ACCOUNT_KEYS` — this domain
posts nothing.

## 4. API

`@Controller('maintenance/types')`, `.../plans`, `.../schedules`
(+ `POST :id/generate`), `.../requests` (+ `approve`/`reject`/`cancel`/
`convert`), `.../work-orders` (+ `assign`/`start`/`hold`/`resume`/
`cancel`/`complete`, nested `tasks`/`documents`/`audit`),
`.../downtime` (+ `:id/end`), `.../parts`, `.../costs`, plus
`GET /maintenance/overview`, `GET /maintenance/technicians`,
`GET /maintenance/assets/:assetId/history`,
`GET /maintenance/assets/:assetId/open-work`.

## 5. Backend Implementation

`apps/api/src/maintenance/` — 9 repository/service/controller trios
(`maintenance-type`, `maintenance-plan`, `maintenance-schedule`,
`maintenance-request`, `work-order`, `asset-downtime`,
`maintenance-part-usage`, `maintenance-cost`, `maintenance-document`),
plus `work-order-code.ts` (shared code generation), `maintenance-overview.
service.ts`/`.controller.ts` (dashboard + asset-history composition),
`maintenance-audit-actions.ts`, `maintenance-independence.spec.ts`,
`maintenance.module.ts`. Registered once in `app.module.ts`.
`packages/validation/src/maintenance.ts` (new Zod schemas, exported via
`packages/validation/src/index.ts`). One small, documented edit to
Sprint 20's own `asset-meter.repository.ts` (§2).

## 6. Frontend Implementation

`apps/web/src/app/(app)/settings/maintenance/` — `api.ts`, `labels.ts`,
`page.tsx` (Overview dashboard), `work-orders/page.tsx` +
`work-order-dialog.tsx` + `work-orders/[id]/page.tsx` (the technician's
primary screen — mobile-first, large touch targets, checklist-style
tasks, camera-capture photo upload, a single primary action per status),
`requests/page.tsx` + `request-dialog.tsx` + `convert-request-dialog.tsx`,
`plans/page.tsx` + `plan-dialog.tsx` (inline checklist editor,
asset/category XOR toggle), `schedules/page.tsx` + `schedule-dialog.tsx`
(date-based/meter-based toggle, "Generate if Due" action).
`apps/web/src/components/app/maintenance-tabs.tsx` (5 tabs: Overview,
Work Orders, Requests, Plans, Schedules — deliberately lean;
Technicians/Downtime/Costs surface within Work Order detail and the
Overview dashboard instead of their own tabs). A new "Maintenance"
section added to the existing Asset detail page
(`settings/assets/register/[id]/page.tsx`) — open work, last maintenance,
upcoming preventive, total recorded cost, links out to the full work
order list, never duplicating it. The sidebar/dashboard "Maintenance" nav
entry (a Sprint 3.5.1 placeholder) is flipped from `comingSoon: true` to
a real link at `/settings/maintenance`.

## 7. Integrations

- **Asset Register (Sprint 20)** — `AssetsModule` now exports what
  Maintenance needs; every asset-status interaction goes through
  `AssetService`'s own lifecycle methods, proven by a structural guard
  asserting no `.asset.update(`/`.updateMany(` call exists anywhere in
  this domain's own files.
- **Product Catalogue** — `ProductRepository`, read-only, for
  `MaintenancePartUsage.productId`.
- **Suppliers** — `SupplierRepository`, read-only, for
  `MaintenanceCost.supplierId`/`WorkOrder.externalSupplierId`.
- **Identity** — `UserService.listByOrganisation()` for the technician
  picker; `AuditService` for the audit trail.
- **Accounting / Inventory / Sales / Production / Distribution** — zero.
  `maintenance-independence.spec.ts` proves `postSystemJournalEntry` is
  never called and no forbidden table is ever written anywhere in this
  domain.

## 8. Tests

`maintenance-independence.spec.ts` (8 tests — the single most important
suite in this sprint: no forbidden-table writes, no `postSystemJournalEntry`
call, no `InventoryStock`/`InventoryTransaction` write, no forbidden
cross-domain import, `MaintenanceModule` never imports `FinanceModule`/
`InventoryModule`, the Asset transition is only ever driven through
`AssetService`, only this domain's own repositories write its own tables,
`MaintenanceCost.totalCost` is always server-computed).
`work-order.repository.spec.ts` (7 tests — completion succeeds when every
mandatory task is done, rejects when one isn't, allows a non-mandatory
task to stay pending, auto-closes open downtime, records a meter reading
via the shared transaction-joinable function, rejects an ambiguous
multi-meter reading, idempotent replay of an already-completed order).
`maintenance-schedule.repository.spec.ts` (8 tests — `addFrequency()`
date-stepping, date-based and meter-based `generate()` due/not-due/
inactive/no-meter cases, and the critical idempotency proof: two
consecutive `generate()` calls against the same due schedule produce
exactly one work order). `work-order.service.spec.ts` (20 tests — every
lifecycle transition valid/invalid case, the Asset-status-interaction
guard including the "only resume when no other work order is open" rule,
header-edit-frozen-once-in-progress). `maintenance-request.service.spec.ts`
(9 tests — approve/reject/cancel/convert lifecycle, terminal-state
rejection, convert requiring `APPROVED` first). `maintenance-plan.service.
spec.ts` (6 tests — the asset/category XOR rule, cross-tenant reference
rejection). `asset-downtime.repository.spec.ts` (4 tests — negative-
duration rejection at both record and end time, open-ended windows,
idempotent `end()`). `maintenance-cost.repository.spec.ts` (3 tests —
server-computed `totalCost`, rounding, idempotent replay). **65 new
tests, all passing.** Full backend suite: **151 suites / 1262 tests, all
green** (up from 143/1197 before this sprint).

## 9. Live Verification Performed

Against the real dev servers/database (Boby Bites seed data), via direct
API calls (pivoted from UI clicks after the recurring dev-environment
browser-session-token-expiry issue documented throughout this session;
every read view was independently confirmed rendering correctly via
screenshots first):

**Scenario A — Preventive Maintenance (full chain):** Confirmed the
seeded Compressor Monthly Service plan/schedule (meter-based, 500-hour
interval). Pushed the Compressor's meter to 5,100 hours (past the
5,000-hour threshold). `generate()` created `WO-000004` and advanced
`nextDueMeterReading` to 5,600; an immediate second `generate()` call
correctly reported `not_due` — zero duplicate work orders. Assigned a
technician, started the work order (confirmed the Asset flipped
`IN_SERVICE → UNDER_MAINTENANCE` via `AssetService`), attempted
completion before finishing tasks (correctly rejected, listing all 7
incomplete mandatory task titles by name), completed all 7 tasks,
completed the work order with a meter reading of 5,150 (confirmed the
reading was recorded via the shared Asset meter service — `AssetMeter.
currentReading` updated to 5,150 — and the Asset returned to
`IN_SERVICE`). Confirmed idempotent replay: re-completing with the same
idempotency key returned the original resolution text, not the new one
supplied.

**Scenario B — Breakdown (full chain):** Created a `MaintenanceRequest`
for the Generator ("Generator refuses to start," Critical, Breakdown),
approved it, converted it to `WO-000005` (confirmed the request flipped
to `CONVERTED_TO_WORK_ORDER`), assigned and started it, recorded a
downtime window and ended it (confirmed `durationMinutes` computed
correctly as 210 — never stored, always derived), completed it with root
cause ("Fuel pump failure") and corrective action ("Replaced fuel pump
and primed line").

**Scenario C — Parts and Cost:** Recorded a part usage (Vegetable Oil,
qty 2) against `WO-000005` — confirmed `inventoryTransactionId` stayed
null. Recorded a Labour cost (qty 2 × ₦10,000) with a client-supplied
`totalCost` deliberately omitted from the request — confirmed the server
computed exactly ₦20,000. Confirmed `InventoryStock`/`InventoryTransaction`
row counts were **byte-identical before and after** (8/41).

**Scenario D — Tenant Isolation:** Using the "Rival Foods Ltd" second
organisation (from Sprint 20's own live verification, still present):
confirmed `GET` on a Boby Bites work order returns `404`; confirmed the
work order list returns `0` items, never leaking Boby Bites' 5 seeded
work orders; confirmed `POST /maintenance/work-orders` referencing a Boby
Bites asset ID correctly returns `400 Bad Request` ("Asset not found").

**RBAC:** Confirmed a Member is denied (`403`) creating a Maintenance
Type and completing a work order; confirmed a Member can read
(`200`) the work order list.

**Accounting Safety:** Queried `JournalEntry`/`JournalEntryLine`/
`CashAccount`/`CashTransaction` row counts before and after all of the
above testing — every figure matched exactly what Sprint 20's own final
checkpoint left behind (48/99/3/5 respectively). Zero change.

**UI rendering (screenshots):** Confirmed the Overview dashboard renders
live metrics matching the API state exactly (1 open request, 1 open work
order, 1 critical, 1 asset under maintenance, 3 unplanned breakdowns this
month). Confirmed the Work Orders list, a completed work order's full
detail page (problem, downtime with the correct 210-minute duration,
costs section explicitly labelled "never an accounting balance," photo
capture buttons, resolution/root cause/corrective action, and a complete,
chronologically correct audit history listing every action taken).
Confirmed the new Asset-detail Maintenance section correctly surfaces
Open Work (1), Last Maintenance date, Upcoming Preventive (1), Total
Recorded Cost (₦20,000), and — notably — correctly kept the Generator
`UNDER_MAINTENANCE` rather than prematurely resuming it, because a
second work order on that same asset was still open (the "any open work
order blocks resume" guard working exactly as designed, discovered live).

**Mobile responsiveness:** Confirmed no horizontal page overflow
(`scrollWidth === clientWidth`) at 375px on the Overview, Work Orders
list, login, and work order detail pages. Confirmed the work order
detail page's mobile layout: a large, full-width "Assign a technician to
begin" card with a touch-friendly Assign button, single-column stacked
sections (Problem, Downtime, Tasks, Parts, Costs, Photos), and correct
technician-selection behaviour, all rendering cleanly with no clipped
content at 375px width.

## 10. Bugs Found/Fixed

None in application logic during live verification. One environment
issue encountered and resolved during this sprint's own verification: a
stale Next.js dev-server build cache (accumulated from the volume of new
files added) caused 404s on static chunks after extensive HMR churn —
resolved by clearing `.next` and restarting the dev server, the same
resolution this session has used for this recurring, pre-existing
dev-environment quirk in prior sprints.

## 11. Known Limitations

See `docs/domains/maintenance.md` §17 — no predictive maintenance/AI/ML/
IoT/telemetry, no GPS/fleet tracking, no spare-parts inventory management
or automatic procurement, no automatic supplier invoicing, no maintenance
accounting/depreciation integration, no warranty claims management, no
insurance management, no advanced technician payroll, no external
contractor portal, no offline mobile app/push notifications/WhatsApp
integration, no maintenance marketplace, no configurable-permission RBAC,
a simple (not full reservation/locking) "any open work order blocks Asset
resume" guard.

## 12. Deferred / Future Work

**Maintenance Intelligence** (MTBF/MTTR, repeat-failure detection,
preventive-compliance reporting, cost-per-asset/cost-per-operating-hour
trends, repair-vs-replace analysis, predictive maintenance from meter
trends) — the correct source data (work orders, tasks, downtime, costs,
parts usage, meter readings) is now captured; none of the analysis itself
is built. **Explicit Inventory integration** (real `InventoryStock`
deduction for parts used) — `MaintenancePartUsage.inventoryTransactionId`
is reserved for this, deliberately unpopulated this sprint. **Explicit
Accounting integration** (posting maintenance expense — `Dr Maintenance
Expense / Cr AP or Cash`) — `MaintenanceCost` records are reserved for
this as the source data; no posting exists yet.

## 13. Documentation Updated

New: `docs/domains/maintenance.md`, `docs/sprint-21-completion-report.md`
(this file). Updated: root `README.md`, `docs/backlog.md`,
`docs/roadmap.md`, `docs/changelog.md`, `docs/domains/README.md`,
`docs/domains/assets.md` (cross-link).

## 14. Final Quality Gate

`pnpm prisma validate` ✅ · backend lint ✅ (27 pre-existing warnings, 0
new, 0 errors) · backend build ✅ · backend tests: **151 suites / 1262
tests, all passing** · frontend type-check ✅ · frontend lint ✅ (0
warnings, 0 errors) · frontend build ✅ (all 6 new `/settings/maintenance/*`
routes compile and generate correctly) · migration applied successfully
(`20260907102014_sprint21_maintenance_management`) · seed script run
twice, fully idempotent (identical fixture counts both runs, confirmed
via direct database query after each run — 5 types, 4 plans, 2 schedules,
1 request, 3 work orders, 9 tasks, 2 downtimes, 1 part usage, 2 costs) ·
live API + browser verification (§9) with direct before/after database
row-count comparisons confirming zero accounting/inventory side effects ·
tenant isolation verified · RBAC verified · mobile responsiveness
verified at 375px with no horizontal overflow.

## 15. Data Safety

| Table                  | Before Sprint 21 testing | After Sprint 21 testing |
| ---------------------- | ------------------------ | ----------------------- |
| `JournalEntry`         | 48                       | 48                      |
| `JournalEntryLine`     | 99                       | 99                      |
| `CashAccount`          | 3                        | 3                       |
| `CashTransaction`      | 5                        | 5                       |
| `InventoryStock`       | 8                        | 8                       |
| `InventoryTransaction` | 41                       | 41                      |

Zero change across every accounting and inventory table, despite
extensive live testing of asset lifecycle transitions, meter readings,
work order creation/completion, downtime, parts usage, and cost
recording.

## 16. Final Architectural Check

1. **What does Maintenance own?** `MaintenanceType`, `MaintenancePlan`/
   `MaintenancePlanTask`, `MaintenanceSchedule`, `MaintenanceRequest`,
   `WorkOrder`/`WorkOrderTask`, `AssetDowntime`, `MaintenancePartUsage`,
   `MaintenanceCost`, `MaintenanceDocument`.
2. **What does Asset own?** Everything from Sprint 20 — `Asset`/
   `AssetCategory`/`AssetLocation`/`AssetMeter`/`AssetMeterReading`/
   `AssetDocument`/`AssetMovement`. Maintenance references these, never
   duplicates them.
3. **How does Maintenance interact with Asset lifecycle?** Exclusively
   through `AssetService`'s own `startMaintenance()`/`resumeService()`
   methods, called from `WorkOrderService` at `start()`/`complete()`/
   `cancel()` — never a raw Prisma update, proven by a structural guard.
4. **How does meter-based maintenance reuse Sprint 20?** `MaintenanceSchedule`
   reads `AssetMeter.currentReading` directly for due-checking; work
   order completion records a reading via a shared, transaction-joinable
   function extracted from Sprint 20's own `AssetMeterRepository` —
   never a second meter system.
5. **How are preventive schedules made idempotent?** `generate()`
   advances the schedule's own due marker to the next occurrence inside
   the same transaction it creates a work order in — a repeat call
   structurally finds nothing due.
6. **How are work-order lifecycle transitions enforced?** A private
   `transition`-style guard per action (mirroring `AssetService`'s own
   shape): explicit `fromStatuses`/`toStatus` checks, soft-idempotent for
   non-terminal states, hard-terminal for `COMPLETED`/`CANCELLED`.
7. **How is downtime represented?** A dedicated `AssetDowntime` table,
   one row per downtime window, duration always derived from
   `startedAt`/`endedAt` at read time, never stored.
8. **How are parts represented without creating a second inventory
   system?** `MaintenancePartUsage` references the existing `Product`
   directly; `inventoryTransactionId` stays null this sprint by design.
9. **How are maintenance costs represented without creating an
   accounting system?** `MaintenanceCost` is a plain operational record;
   `totalCost` is server-computed but never posted to any ledger.
10. **Which domains does Maintenance import?** `AssetsModule` (now
    exporting what's needed), `ProductModule`, `SupplierModule`,
    `IdentityModule`, `AuthModule`, `FileStorageModule`. Never
    `FinanceModule` or `InventoryModule`.
11. **Does Maintenance create any Journal Entries?** No — proven by
    `maintenance-independence.spec.ts` asserting `postSystemJournalEntry`
    is never called anywhere in this domain.
12. **Does Maintenance mutate `InventoryStock`?** No.
13. **Does Maintenance mutate `InventoryTransaction`?** No — both proven
    by the same structural guard, and confirmed live with byte-identical
    before/after row counts.
14. **How is tenant isolation enforced?** Every tenant-owned table
    carries `organisationId` (or is scoped through its parent for the
    two pure child tables); every repository query filters by it;
    cross-tenant access fails safely (`404`/`400`), live-verified.
15. **How is RBAC enforced?** The codebase's one binary convention
    (`JwtAuthGuard` + `RolesGuard`+`Owner`/`Administrator` on writes) —
    no new role invented; task updates are reachable by any authenticated
    member so an assigned technician (a plain Member) can update their
    own work.
16. **How is audit implemented?** `MAINTENANCE_AUDIT_ACTIONS` wired into
    the existing `AuditService`, the `<entity>.<event>` convention every
    prior domain uses — no competing mechanism.
17. **What is intentionally deferred to future sprints?** Maintenance
    Intelligence/Reliability Analytics/predictive maintenance (§12),
    explicit Inventory consumption, explicit Accounting posting — see
    §11/§12 for the full list.

## 17. Constraint

Per this sprint's own explicit instruction ("DO NOT COMMIT ANYTHING. DO
NOT PUSH ANYTHING."), this work has **not** been committed or pushed.
`git status` confirms every file listed above remains in the working
tree, uncommitted.
