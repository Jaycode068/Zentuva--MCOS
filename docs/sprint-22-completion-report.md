# Sprint 22 Completion Report — Maintenance Ecosystem Integration

## 1. Objective

Connect Sprint 21's deliberately zero-integration Maintenance domain to
the rest of the Zentuva ecosystem — Inventory (real part issuing),
Procurement/Supplier/AP (read-through), Budgeting (cost-vs-budget),
Capital Projects (read-only reference), and Production (a read-side
downtime feed) — through narrow, explicit, documented boundaries, and
build the frontend surfaces that make the resulting data actually usable
day to day: a Maintenance-owned operational Analytics page, richer
maintenance visibility on the existing Asset Register detail page, and a
mobile-first Field Technician workflow. All while adding zero accounting
integration, zero duplicate domain systems, and zero new RBAC roles.

## 2. Starting State (End of Sprint 21)

Maintenance had a complete internal lifecycle (Plans → Schedules →
Requests → Work Orders → Tasks → Downtime → Parts/Costs → Completion) but
was structurally isolated: `MaintenancePartUsage.inventoryTransactionId`
always stayed null (no real stock deduction), no link to Procurement
existed, `MaintenanceCost` had no budget/cost-centre awareness, no
analytics/reporting existed beyond the Overview dashboard's live counts,
and there was no field-technician-specific frontend — technicians used
the same desktop admin UI as everyone else.

## 3. Scope Completed

- **Inventory integration** — real part issuing (§6).
- **Procurement integration** — a linking boundary, not a duplicate
  requisition system (§7).
- **Supplier/AP integration** — read-through AP summary (§7).
- **Budget integration** — cost-vs-budget comparison (§8).
- **Capital Project integration** — zero-new-code-path reuse (§9).
- **Production integration** — read-side downtime feed (§10).
- **Maintenance Analytics** — backend service/controller and frontend
  page (§11).
- **Business event catalog** — a plain, documented, unwired catalog (§12).
- **Structural independence tests** — extended to cover every new
  boundary (§13).
- **Asset Register maintenance visibility** — the existing Asset detail
  page's Maintenance section, extended (§14).
- **Field Technician surface** — a new mobile-first `/field/maintenance`
  (§15).
- **Seed data** — new idempotent Sprint 22 fixtures (§16).
- **Full documentation closeout** (§21).

## 4. Architecture

See `docs/domains/maintenance-integration.md` for the complete record.
Highlights and decisions:

- **One deliberate exception to the domain's own no-cross-domain-writes
  rule.** `MaintenancePartUsageRepository.issue()` is the only file in
  the entire Maintenance domain permitted to write `InventoryStock`/
  `InventoryTransaction` — inside its own `$transaction`, using the
  injected `PrismaService` directly, never through the read-only
  `InventoryStockRepository` DI. This mirrors the exact same narrow
  exception `SalesFulfilmentRepository.create()`/
  `ProductionMaterialIssueRepository.issue()` already established, made
  for atomicity, not convenience. Enforced structurally, not just
  documented — see §13.
- **No requisition system invented for Procurement.** Since no
  requisition/purchase-request concept exists anywhere in Procurement,
  Maintenance owns the smallest new model that expresses "we identified a
  need" (`MaintenanceProcurementRequirement`) and only _links_ to a real
  Purchase Order once a human creates one through Procurement's own
  existing UI — `purchaseOrderId` is validated read-only, never written
  via a Procurement write verb.
- **Cost-vs-budget reuses the exact Sprint 18 shape.** Two
  independently-derived, never-mutating-each-other figures — Actual (Σ
  tagged `MaintenanceCost` + issued `MaintenancePartUsage` on the same
  work orders) vs. Budget (Σ `BudgetLine.amount` for that cost centre) —
  the same pattern `CapitalProjectService.getBudgetAllocation()`
  established.
- **No shared "issue stock" service was invented** — confirmed by direct
  code inspection that every existing stock-issuing writer in the
  codebase reaches into `inventoryStock`/`inventoryTransaction` inside
  its own transaction the same way; Maintenance follows the identical
  pattern rather than introducing a new abstraction only it would use.
- **Risk signals are deterministic, named-constant thresholds, never an
  ad-hoc heuristic or predictive model** — `REPEAT_FAILURE_THRESHOLD`
  (3 correctives / 90 days) and `HIGH_COST_MULTIPLIER` (2× a category's
  own trailing median), both exported constants, both unit-tested,
  explicitly labelled "deterministic operational signals — not
  predictions" in the UI.
- **No new RBAC role.** The Field Technician surface uses the existing
  `assignedToId` convention Sprint 21 already established for Admin's own
  assignment UI. Discovered during this sprint: almost every Maintenance
  write endpoint is actually gated `@Roles('Owner','Administrator')`
  (only checklist-task completion has no role restriction), and the
  seed data's own `seedMaintenanceFixtures` already encodes this as the
  working convention — its `technicianUserId` parameter is populated with
  `administratorUser.id`. This sprint did not redesign that RBAC surface
  (explicitly out of scope); the Field surface was built and verified
  against that existing convention, documented rather than silently
  assumed.
- **No new backend endpoint for the Field surface.** `field/api.ts`/
  `field/labels.ts` re-export the existing Maintenance and Asset frontend
  API/label modules verbatim — no fetch logic duplicated, no parallel
  status-transition logic; every Field mutation calls the exact same
  service function Admin's own Work Order detail page already calls.
- **The Analytics page is explicitly not the future Zentuva Reporting
  platform** — it is Maintenance-owned operational analytics only (cost,
  downtime, preventive/corrective mix, risk signals), documented as a
  boundary a future cross-domain Reporting module must consume, never
  duplicate.

## 5. Database Changes

One additive migration
(`20260908193910_sprint22_maintenance_ecosystem_integration`):

- `MaintenancePartUsage` gained `status` (`REQUESTED`/`ISSUED`/
  `CANCELLED`), `issueIdempotencyKey`, `locationId` — no removal of any
  existing field.
- New model `MaintenanceProcurementRequirement` (`workOrderId`,
  `description`, `estimatedCost?`, `status`
  (`IDENTIFIED`/`LINKED`/`CANCELLED`), `purchaseOrderId?`, `supplierId?`).
- `MaintenanceCost` gained `costCentreId` (plain reference, no
  `@relation` — the exact `CapitalProject.costCentreId` convention).
- No changes to any Inventory, Procurement, Supplier, Budgeting, or
  Capital Project model — every new reference is a plain nullable
  scalar id, validated at the application layer, never a foreign-key
  relation crossing domain ownership.
- No new `SYSTEM_ACCOUNT_KEYS` — this domain still posts nothing.

## 6. Inventory Integration — Part Issuing

`MaintenancePartUsage` gained a real two-step lifecycle:

```
REQUESTED  →  ISSUED    (stock deducted, InventoryTransaction created, cost snapshotted)
           →  CANCELLED (no inventory effect — only legal before ISSUED)
```

`record()` (unchanged in shape) still creates a `REQUESTED` row with no
inventory effect. `issue()`'s sequence, inside one transaction:

1. Idempotency check on `issueIdempotencyKey` first, before any status or
   stock check.
2. Re-validate `status === 'REQUESTED'` — soft-idempotent if already
   `ISSUED` with the _same_ key; throws `PartUsageStatusConflictError` on
   a genuine conflict.
3. Read `InventoryStock` for `(productId, locationId)`; guard
   `quantityOnHand >= quantity` (`InsufficientStockError` otherwise).
4. Upsert `InventoryStock` (decrement), insert one `InventoryTransaction`
   (`type: ISSUE`, `referenceType: 'MaintenancePartUsage'`).
5. Snapshot `unitCost`/`totalCost` from the `InventoryStock` row just
   read — an immutable historical fact, since the live average keeps
   drifting after this issue as later receipts land.

`cancel()` is `REQUESTED → CANCELLED` only, never after `ISSUED`.

## 7. Procurement / Supplier / AP Integration

`MaintenanceProcurementRequirement`:
`IDENTIFIED → LINKED (purchaseOrderId attached) → CANCELLED (only before LINKED)`.
`link()` validates the Purchase Order via the imported, read-only
`PurchaseOrderRepository.findById()` (tenant-scoped) — never written.
`supplierId?` validated via the already-imported `SupplierRepository`.
`GET .../:id/ap-summary` is a narrow, documented, read-only reach
directly into `this.prisma.supplierInvoice.aggregate(...)`, reproducing
`SupplierInvoiceRepository.getApByPurchaseOrder()`'s exact query shape
rather than importing it.

## 8. Budget Integration

`MaintenanceCost.costCentreId` validated at record time via
`MaintenanceAnalyticsService.assertCostCentreExists()` — a narrow,
documented, read-only `this.prisma.costCentre.findFirst(...)` reach, no
`BudgetingModule` import. `GET /maintenance/analytics/cost-vs-budget`
compares Actual (tagged `MaintenanceCost` + issued `MaintenancePartUsage`
on the same work orders) against Budget (Σ `BudgetLine.amount` for that
cost centre, `OPERATING_EXPENSE`, in range, on an `ACTIVE` Budget).
Neither side is ever written by this call.

## 9. Capital Project Integration

Zero new code path — `MaintenanceOverviewService.getAssetHistory()`
calls the already-DI-available `AssetRepository.findCapitalProjectRef()`
(Sprint 18/20) only when the asset has one.

## 10. Production Integration — Read-Side Only

`GET /maintenance/downtime/active` exposes every currently-open
`AssetDowntime` window, shaped for eventual Production consumption. No
write path, no Production code touched, `ProductionModule` is not
imported (it exports nothing to import). A real consumer is deferred
future work once Production grows an Asset reference.

## 11. Analytics

`maintenance-analytics.service.ts`/`.controller.ts`
(`@Controller('maintenance/analytics')`) — four read-only endpoints,
every figure derived live, nothing stored: `cost-vs-budget`,
`cost-breakdown`, `operational-metrics`, `risk-signals` (§4 for the
deterministic-signal rationale).

Frontend: `/settings/maintenance/analytics` — period filter (reusing
Sprint 13's `resolveReportDateRange` verbatim), KPI summary, a cost
breakdown chart (recharts, by category/asset/maintenance-type), a
cost-vs-budget cost-centre picker with Budget/Actual/Variance cards, a
preventive-vs-corrective proportion bar, a downtime table, an "Assets
Requiring Attention" three-tab ranking, and a Risk Signals list — every
section an independent `useQuery`, so one failure never blocks the rest
of the page. Nothing is persisted; every number is either read directly
off a server response or a plain client-side sum of an already-aggregated
array.

## 12. Business Events

No `EventEmitter`/`DomainEvent`/notification infrastructure exists
anywhere in this codebase. `maintenance-events.ts` is a plain, exported
catalog of event names + TS payload interfaces — no emitter, no
subscriber, no new dependency. Every event name is cross-referenced to
the existing `MAINTENANCE_AUDIT_ACTIONS` entry recorded at that exact
moment.

## 13. Structural Independence Tests

`maintenance-independence.spec.ts`, extended:

- The shared `FORBIDDEN_WRITE_PATTERN` applies to every file in the
  domain except `maintenance-part-usage.repository.ts`, checked against
  the same list minus `inventoryStock`/`inventoryTransaction`.
- A positive assertion confirms `issue()` really does write those two
  tables, and no other file ever does.
- A dedicated assertion confirms `maintenance-procurement.repository.ts`
  never calls a PurchaseOrder/Supplier write verb.
- A dedicated assertion confirms `MaintenanceModule`'s own `imports`
  array is exactly the expected set — never `FinanceModule`/
  `ProductionModule`/a hypothetical `ProcurementModule`.
- `postSystemJournalEntry` absence still holds, repo-wide.

## 14. Asset Register Integration (Frontend)

The existing Asset Register detail page's `MaintenanceSection`
(`apps/web/src/app/(app)/settings/assets/register/[id]/page.tsx`, Sprint 20) is extended in place — no second asset detail page, no duplicate
calculation. Consumes the extended `getAssetHistory()` response
unchanged in endpoint shape from what the backend already returns
(`capitalProject`, `partsUsed`, `partsIssuedCount`, `partsCost`,
`downtimes`, `upcomingSchedules`).

Added: an 8-tile summary grid (Open/In Progress/Overdue Work Orders, Last
Completed, Next Scheduled, Total Cost, Total Downtime, Total Work
Orders — overdue/next-scheduled derived client-side from already-fetched
rows), a capital project link line, a Recent Maintenance History table
(sliced to 8, with a "View all →" link), a Parts Used table, a Downtime
table, and a Preventive Maintenance Schedules list (overdue ones styled
distinctly). Loading/empty/error states match the page's existing
`useQuery` sections. Verified at 375px/430px/desktop — tiles reflow
4-across → 2-across → 1-across, no horizontal overflow.

## 15. Field Technician Experience (Frontend)

`/field/maintenance` (`apps/web/src/app/(field)/field/maintenance/`) —
built on the existing `(field)` route architecture (`FieldShell`,
`FieldBottomNav`, `FieldCard`, `FieldStickyActionBar`,
`Sheet side="full"`), not a shrunk desktop page. `field/api.ts`/
`field/labels.ts` re-export the existing Maintenance/Asset frontend
modules verbatim.

- **Home** — Overdue/In Progress/Today/Upcoming sections over
  `listWorkOrders({ assignedToId: <own id> })`.
- **Detail** — one obvious primary action per status via
  `FieldStickyActionBar`: OPEN → Assign + Start, ASSIGNED → Start,
  IN_PROGRESS → Complete, ON_HOLD → Resume, COMPLETED → display-only.
  Reuses the existing `WorkOrderTask` checklist (server-authoritative
  completion), the existing parts request/issue/cancel flow (no direct
  Inventory mutation from the frontend), the existing Asset meter
  service (no duplicate meter logic), the existing downtime
  active/end endpoints (Sprint 21's auto-close-on-completion behavior is
  untouched), and the existing Maintenance document upload endpoint for
  before/after photos. A read-only Procurement card notes that linking a
  PO stays an Owner/Administrator action in the Admin UI.
- **Navigation** — `FieldBottomNav` gained a sixth `Maintenance` tab; no
  duplicate nav introduced (Admin's `MaintenanceTabs` and this bottom nav
  address two different shells/audiences).
- **Cache correctness** — an `invalidateAll()` helper invalidates
  `work-order`, `work-orders field`, `maintenance-overview`, and every
  `maintenance-analytics-*` query key after any mutation, so Admin's Work
  Order detail, the Asset Register Maintenance section, and Analytics all
  reflect a Field-driven change with no manual refresh.

## 16. Seed Data

`seedMaintenanceEcosystemFixtures()` added to `apps/api/prisma/seed.ts` —
idempotent (checked via existence queries before creating fixtures). Run
three times total across this sprint's work (twice before this session's
live testing, once after), confirmed identical fixture counts every time.

## 17. Tests

New: `maintenance-part-usage.repository.spec.ts`,
`maintenance-procurement.repository.spec.ts`,
`maintenance-analytics.service.spec.ts`,
`maintenance-overview.service.spec.ts`, plus the extended
`maintenance-independence.spec.ts` assertions (§13). **Full backend
suite: 155 suites / 1293 tests, all green** (up from 151/1262 at the end
of Sprint 21).

**No frontend automated test framework was added**, per this sprint's
explicit instruction. `apps/web`'s `test` script remains a no-op stub —
there is no existing Vitest/Jest/RTL harness anywhere in `apps/web` to be
consistent with. Standing one up is an infrastructure decision (runner
choice, jsdom config, CI wiring) affecting every frontend page, out of
scope for this sprint — flagged here rather than silently skipped or
unilaterally decided.

## 18. Live Verification Performed

Against the real dev servers/database (Boby Bites seed data):

**End-to-end scenario chain** (signed in as `admin@bobybites.local`,
standing in for the technician convention documented in §4): opened an
assigned work order from `/field/maintenance` → started it → completed
its checklist tasks → requested and issued a real part (confirmed a new
`InventoryTransaction` row, `referenceType: 'MaintenancePartUsage'`) →
ended its active downtime window → recorded a meter reading and
completed the work order. The resulting cost, downtime duration, parts
row, and status were then confirmed identical, with no discrepancy, on:
the Admin Work Order detail page, the Asset Register detail page's
Maintenance section (bidirectional drill-down links both directions),
and the Maintenance Analytics page (updated automatically, no manual
refresh).

**Analytics cross-checks** (all exact matches against direct DB
queries):

| Figure                                      | Analytics page                               | Direct query                                                                                                  | Match                |
| ------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------- |
| Maintenance Cost (This Month)               | ₦72,200.00                                   | Σ `maintenance_costs.totalCost` + issued `maintenance_part_usages.totalCost` for the period                   | ✅                   |
| Cost vs Budget — Actual (ADMIN cost centre) | ₦25,200.00                                   | ₦25,000 tagged `MaintenanceCost` + ₦200 issued `MaintenancePartUsage` on the same work order                  | ✅                   |
| Cost vs Budget — Budget (ADMIN, September)  | ₦720,000.00                                  | Σ `budget_lines.amount` where `costCentreId = ADMIN`, `lineType = OPERATING_EXPENSE`, `periodMonth = 2026-09` | ✅                   |
| Cost vs Budget — Variance / Variance %      | −₦694,800.00 / −96.5%                        | `25,200 − 720,000` / `(−694,800 / 720,000) × 100`                                                             | ✅                   |
| Risk Signals                                | "No significant maintenance risks detected." | Seeded data has no asset with ≥3 correctives in 90 days, and only single-asset-per-category cost data         | ✅ (correctly empty) |

**Tenant isolation:** the two other pre-existing tenants in the dev
database ("Rival Snacks Sprint10", "Rival Foods Ltd") have zero
maintenance data (0 work orders, 0 assets, 0 part usages) — confirmed by
direct query. There is no live data to leak in a browser-based
cross-tenant test; isolation is instead confirmed by (a) universal
`organisationId`-scoping confirmed across every new file by inspection,
(b) existing unit tests explicitly testing cross-tenant rejection for
part-usage and procurement repositories, and (c) the query above proving
there is no real data in either other tenant to leak.

**Responsive verification:** Overview/Analytics/Work Order
detail/Asset detail confirmed at 375px, 430px, and desktop — no
horizontal overflow. Field pages confirmed at 375px/430px (the primary
targets); desktop checked only as a resilience smoke test, per the field
shell's own `max-w-md` always-narrow convention. One real mobile bug was
found and fixed: the Analytics "Assets Requiring Attention" ranked list
overlapped label/value text at 375px (a bare `flex justify-between` with
no wrap) — fixed with `flex-wrap`/`min-w-0`/`shrink-0`.

**Cache correctness:** confirmed live that recording a cost or
issuing/cancelling a part on the Work Order detail page (or from the
Field surface) immediately updates the Analytics KPIs and the Asset
Register Maintenance section on next navigation, with no manual refresh,
despite the global 60-second `staleTime`.

## 19. Accounting & Inventory Safety

Queried `JournalEntry`/`JournalEntryLine`/`CashAccount`/`CashTransaction`
row counts before and after all live testing this sprint — zero rows
attributable to Maintenance; every request the Analytics page issues is
a `GET` (confirmed via the browser's own network log — zero
`POST`/`PUT`/`PATCH`/`DELETE` from that page). `inventory_transactions`
rows with `referenceType = 'MaintenancePartUsage'` count matched exactly
the number of real issues performed across this sprint's testing (3).
Cancelling an unissued part request left `InventoryStock` untouched;
re-issuing with the same idempotency key did not double-deduct.

## 20. Bugs Found/Fixed

One frontend mobile-layout bug (§18, Analytics ranked list overlap on
narrow screens) — found and fixed during this sprint's own live
verification. One implementation-time reference error (an unused
`asset.location.name` reference on the Field Work Order detail page,
before it was noticed the `Asset` type has no nested `location` object)
— caught before verification, fixed by removing the line rather than
adding an extra fetch for a "nice to have."

## 21. Documentation Updated

New: `docs/domains/maintenance-integration.md`,
`docs/sprint-22-completion-report.md` (this file). Updated:
`docs/domains/maintenance.md` (§11, §17, header), `docs/domains/README.md`,
`docs/backlog.md`, `docs/roadmap.md`, `docs/changelog.md`, root
`README.md`.

## 22. Final Quality Gate

`pnpm prisma validate` ✅ · backend type-check ✅ · backend lint ✅ (27
pre-existing warnings, 0 new, 0 errors) · backend build ✅ · backend
tests: **155 suites / 1293 tests, all passing** (zero backend files
touched since the prior verification pass in this same sprint, confirming
this is a true zero-regression result, not a retest of new code) ·
frontend type-check ✅ · frontend lint ✅ (0 warnings, 0 errors) ·
frontend build ✅ · seed script run three times total, fully idempotent
each time (identical fixture counts, confirmed via direct database query
after each run) · live API + browser verification (§18) with direct
before/after database row-count comparisons confirming zero accounting
side effects and correct inventory-only-on-issue behavior (§19) · tenant
isolation verified · mobile responsiveness verified at 375px/430px with
no horizontal overflow on every new/extended page.

## 23. Known Limitations / Deferred Future Work

- **A frontend automated test harness** — not part of Sprint 22 itself
  (explicitly out of scope per this sprint's own instruction); worth a
  deliberate infrastructure decision before more frontend pages
  accumulate untested. See §17.
- **A dedicated Technician RBAC role** — explicitly out of scope this
  sprint (creating one was forbidden); the `assignedToId` convention is
  the deliberate interim answer, not a placeholder bug. See §4.
- **A real two-way Production integration** — blocked on Production
  gaining its own Asset/equipment concept first; today's
  `/maintenance/downtime/active` endpoint is read-side-only and
  unconsumed by design. See §10.
- **Predictive maintenance, IoT/sensor integration, condition monitoring,
  fleet management, and any AI/forecasting-based maintenance
  intelligence** — never in scope for Sprint 21 or 22; Risk Signals are
  explicitly deterministic/threshold-based, not predictive.
- **The future Zentuva Reporting platform** — consumes this domain's
  Analytics endpoints as one input among many; it is not built here.
- **HR Employee Lifecycle Foundation (Sprint 23)** — genuinely not
  started. The seed data's "technician" is the Administrator user (§4);
  a real Employee/HR domain, if it introduces its own personnel records,
  is future work with no code path prepared for it in this sprint.

## 24. Final Architectural Check

1. **What did Sprint 22 add ownership of?**
   `MaintenanceProcurementRequirement` — everything else is either an
   extension of an existing Maintenance-owned model
   (`MaintenancePartUsage.status`/`issueIdempotencyKey`/`locationId`,
   `MaintenanceCost.costCentreId`) or a new read-only/read-through
   endpoint over existing data.
2. **What is the one deliberate cross-domain write exception, and how is
   it enforced?** `MaintenancePartUsageRepository.issue()` writing
   `InventoryStock`/`InventoryTransaction` — enforced structurally by
   `maintenance-independence.spec.ts`, not just documented (§13).
3. **Does Maintenance import `FinanceModule` or `ProductionModule`?**
   No — both export nothing to import; every Finance-owned figure is a
   plain, documented direct-Prisma read; Production integration is
   read-side-only via Maintenance's own endpoint.
4. **Does Maintenance create a parallel requisition/procurement system?**
   No — `MaintenanceProcurementRequirement` only links to a real Purchase
   Order created through Procurement's own UI; it never creates one.
5. **Does the Analytics page duplicate a future Reporting platform?** No
   — it is explicitly scoped to Maintenance-owned operational figures
   only, documented as a boundary a future cross-domain module must
   consume, not duplicate.
6. **Is any RBAC role invented for the Field surface?** No — the existing
   `assignedToId` convention is reused unchanged; RBAC gating on write
   endpoints is unchanged from Sprint 21.
7. **Does the Field surface introduce a second Work Order/status-
   transition implementation?** No — every mutation calls the exact same
   service functions the Admin Work Order detail page already calls.
8. **Does Maintenance create any Journal Entries?** No — proven by
   `maintenance-independence.spec.ts`, confirmed live with zero new rows
   in `JournalEntry`/`JournalEntryLine` across all of this sprint's
   testing.
9. **How is inventory safety proven, not just asserted?** Structurally
   (one file may write those two tables) and empirically (exact
   `InventoryTransaction` row-count match against the number of real
   issues performed, cancel-before-issue leaves stock untouched,
   duplicate-issue-with-same-key does not double-deduct).
10. **What is intentionally deferred to future sprints?** See §23 in
    full — frontend test harness, Technician RBAC role, real
    Production integration, predictive/IoT maintenance intelligence, the
    Reporting platform, and HR (Sprint 23, not started).

## 25. Sprint Outcome

**Sprint 22 — Maintenance Ecosystem Integration — is complete.** Backend
integration (Inventory, Procurement/Supplier/AP, Budget, Capital Project,
Production, Analytics), structural independence guards, and seed data
were built and verified first; the Maintenance Analytics frontend, the
Asset Register detail page's extended Maintenance section, and the new
Field Technician surface were then built on top, and the whole chain was
verified end-to-end live against real data with matching figures across
every surface and direct database cross-checks. Epic 14 (Asset &
Maintenance Management) is now fully built through Sprints 20-22 — a
complete Asset Register, an operational Maintenance domain, and a
genuinely integrated, analytics-visible, field-usable ecosystem around
it — with predictive/IoT maintenance intelligence, a dedicated Technician
RBAC role, and a frontend test harness explicitly and deliberately
deferred as separate, future decisions.

## 26. Next Sprint

Sprint 23 — HR Employee Lifecycle Foundation. Not yet started; no code
path in this sprint assumes or prepares for it.

## 27. Constraint

Per this sprint's own explicit instruction ("DO NOT COMMIT, DO NOT
PUSH"), this work has **not** been committed or pushed. `git status`
confirms every file from this sprint remains in the working tree,
uncommitted.
