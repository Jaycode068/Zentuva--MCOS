# Maintenance Ecosystem Integration

- **Status:** **Complete and live-verified — Sprint 22 ("Maintenance
  Ecosystem Integration").** Connects Sprint 21's zero-integration
  Maintenance domain to Inventory (real part issuing), Procurement/
  Supplier/AP (read-through), Budgeting (cost-vs-budget), Capital Projects
  (read-only ref), and Production (read-side downtime feed) through
  narrow, explicit, documented boundaries. Frontend: Work Order detail
  Parts issue/cancel flow, Procurement section, Overview KPI tiles, the
  **Maintenance Analytics page** (`/settings/maintenance/analytics`), the
  **Asset Register detail page's extended Maintenance section**, and the
  new **Field Technician Maintenance surface** (`/field/maintenance`) are
  all built and live-verified in the browser end-to-end, including direct
  database cross-checks. See §11 "Remaining Work" for what is deliberately
  still deferred to future sprints (this is a foundation-closing sprint,
  not a claim that every future maintenance idea is done).
- **Reporting boundary (important, read before extending this page):**
  the Analytics page in §9 is **Maintenance-owned operational analytics**
  — cost, downtime, preventive/corrective mix, risk signals, all scoped to
  this one domain. It is explicitly _not_ the future Zentuva Reporting
  platform (a cross-domain GM/MD dashboard composing Revenue + Production +
  Inventory + Procurement + Maintenance + HR + Cash + Debt + Distribution).
  That future work should **consume** `MaintenanceAnalyticsService`'s
  existing endpoints as one input among many, never duplicate its
  calculations. Do not use a "just add one more chart" request as a reason
  to grow this page into that platform — a new cross-domain composition
  belongs in its own module.
- **Sprint:** 22
- **Depends on:** [Maintenance Management](maintenance.md) (Sprint 21
  foundation), [Inventory Management](inventory.md) (`InventoryStockRepository`/
  `InventoryTransactionRepository`/`InventoryLocationRepository`, read/write
  per §1 below), [Procurement](procurement.md) (`PurchaseOrderRepository`,
  read-only), [Suppliers](suppliers.md) (`SupplierRepository`, read-only),
  [Budgeting](budgeting.md) (`CostCentre`/`BudgetLine`, read-only, no module
  import), [Investment / Capital Projects](investment-projects.md)
  (`AssetRepository.findCapitalProjectRef()`, already-available since
  Sprint 18/20).
- **Explicitly does not depend on:** `FinanceModule` (exports nothing to
  import anyway — every Finance-owned figure this domain reads is a plain,
  documented `this.prisma.<table>.find/aggregate` call, never a module
  import) or `ProductionModule` (exports nothing either; Production has no
  Asset/equipment concept yet to key off). Proven executably by the
  extended `maintenance-independence.spec.ts`, not just documented here.
- **See also:** [Maintenance Management](maintenance.md), [Inventory
  Management](inventory.md), [Procurement](procurement.md),
  [Budgeting](budgeting.md).

## 1. Inventory Integration — Part Issuing

Sprint 21 deliberately never deducted real stock. Sprint 22 gives
`MaintenancePartUsage` a real two-step lifecycle:

```
REQUESTED  →  ISSUED   (stock deducted, InventoryTransaction created, cost snapshotted)
           →  CANCELLED (no inventory effect — only legal before ISSUED)
```

`record()` (unchanged in shape) creates a `REQUESTED` row with no inventory
effect. `MaintenancePartUsageRepository.issue()` is the **only** place in
this entire domain that ever writes `inventoryStock`/`inventoryTransaction`
— inside its own `$transaction`, using the injected `PrismaService`
directly (never through `InventoryStockRepository`, which stays read-only
DI for availability checks). This mirrors, byte-for-byte, the same
deliberate, narrow exception to ADR-002's domain-ownership convention that
`SalesFulfilmentRepository.create()`/`ProductionMaterialIssueRepository.
issue()` already establish — made for atomicity, not for convenience.
`maintenance-independence.spec.ts` enforces this structurally: exactly one
file may write those two tables, and every other file in the domain is
still forbidden from doing so.

`issue()`'s sequence, inside one transaction:

1. Idempotency check on `issueIdempotencyKey` first — before any status or
   stock check (the Sprint 9→10 lesson, applied to this operation's own
   two-phase idempotency, separate from the request-creation key).
2. Re-validate `status === 'REQUESTED'` — soft-idempotent if already
   `ISSUED` with the _same_ key (returns unchanged, no duplicate stock
   move); throws `PartUsageStatusConflictError` if `CANCELLED` or already
   `ISSUED` with a _different_ (or no) key on a genuine second call.
3. Read `InventoryStock` for `(productId, locationId)`; guard
   `quantityOnHand >= quantity` (`InsufficientStockError` otherwise).
4. Upsert `InventoryStock` (decrement), insert one `InventoryTransaction`
   (`type: ISSUE`, `referenceType: 'MaintenancePartUsage'`, `referenceId`).
5. Snapshot `unitCost` from the `InventoryStock` row just read (never a
   competing costing calculation) and `totalCost = quantity × unitCost`,
   both frozen on the `MaintenancePartUsage` row — an immutable historical
   fact, since the live average will keep drifting after this issue as
   later receipts land, and a Work Order's cost history must not silently
   change after the fact.

No shared "issue stock" service exists anywhere in Inventory (confirmed by
direct code inspection before this sprint began — every existing stock-
issuing writer reaches into `inventoryStock`/`inventoryTransaction` inside
its own transaction the same way), so none was invented here either.

`cancel()` is `REQUESTED → CANCELLED` only — never after `ISSUED`, since
stock has already moved by then; soft-idempotent against an already-
`CANCELLED` row.

## 2. Procurement Integration — the Smallest Boundary

No requisition/purchase-request concept exists anywhere in Procurement
(confirmed via full-repo grep; explicitly deferred future work per
`docs/backlog.md`/`docs/domains/budgeting.md`). Rather than inventing a
parallel system, Maintenance owns the smallest new model that expresses
"we identified a need," and _links_ to a real Purchase Order once a human
creates one through Procurement's own existing UI:

```
IDENTIFIED  →  LINKED     (purchaseOrderId attached, read-only-validated)
            →  CANCELLED  (only before LINKED)
```

`MaintenanceProcurementRequirement` — `workOrderId`, `description`,
`estimatedCost?`, `status`, `purchaseOrderId?` (plain reference, **never**
written via `.create()`/`.update()`/`.delete()` — validated read-only via
the now-imported `PurchaseOrderRepository.findById()`, tenant-scoped),
`supplierId?` (validated via the already-imported `SupplierRepository`).
`link()` is soft-idempotent when re-linking the exact same PO; throws on a
genuine conflict (already linked to a _different_ PO, or linking/cancelling
a non-`IDENTIFIED` row).

`GET .../:id/ap-summary` is a narrow, documented, read-only reach directly
into `this.prisma.supplierInvoice.aggregate(...)`, reproducing
`SupplierInvoiceRepository.getApByPurchaseOrder()`'s exact query shape
(Sprint 12) rather than importing it — this is not a `FinanceModule`
import (Finance exports nothing to import anyway); it is the established
"narrow read reach into another domain's own table, no write, documented"
exception, applied a third time in this codebase (after Sprint 13
Finance→Inventory and Sprint 18 Asset→CapitalProject).

## 3. Budget Integration

`MaintenanceCost.costCentreId` (plain reference, no `@relation` — the exact
`CapitalProject.costCentreId` convention) is validated at record time via
`MaintenanceAnalyticsService.assertCostCentreExists()`, a narrow,
documented, read-only `this.prisma.costCentre.findFirst(...)` reach — no
`BudgetingModule` import.

`GET /maintenance/analytics/cost-vs-budget?costCentreId=&from=&to=`
compares two independently-derived, never-mutating-each-other figures, the
exact shape `CapitalProjectService.getBudgetAllocation()` already
established (Sprint 18):

- **Actual** = Σ `MaintenanceCost.totalCost` tagged to this cost centre in
  the range, **plus** Σ issued `MaintenancePartUsage.totalCost` for
  exactly the work orders that have at least one `MaintenanceCost` row
  tagged to it. `MaintenancePartUsage` carries no `costCentreId` of its
  own (the schema change is on `MaintenanceCost` only) — this
  work-order-sharing rule is the documented, derivable way to attribute
  issued-parts cost to a cost centre without a further schema change.
- **Budget** = Σ `BudgetLine.amount` for that `costCentreId`, `lineType:
OPERATING_EXPENSE`, `periodMonth` in range, on an `ACTIVE` `Budget` for
  this organisation.

Neither side is ever written by this call.

## 4. Capital Project Integration

Zero new code path. `MaintenanceOverviewService.getAssetHistory()` calls
the already-DI-available `AssetRepository.findCapitalProjectRef(
organisationId, asset.capitalProjectId)` (Sprint 18/20) only when the asset
has one, attaching `{id, projectCode, name}` to the response. Pure reuse —
zero new imports, zero new Prisma reach.

## 5. Production Integration — Read-Side Only

Production has zero Asset/equipment/downtime concept anywhere in its
schema (confirmed via exhaustive grep of every Production model), and
`ProductionModule` exports nothing at all — so a genuine two-way
integration is not buildable this sprint without a Production-side schema
change, which is out of scope. `GET /maintenance/downtime/active` exposes
every currently-open `AssetDowntime` window, shaped for eventual
Production consumption (asset, work order, reason, started-at, a live-
computed `durationMinutesSoFar`) — data Maintenance already owns and
computes today, just not previously exposed as its own endpoint. No write
path, no Production code touched, `ProductionModule` is not imported (it
has nothing to import). Wiring a real consumer on the Production side is
deferred, future work once Production grows an Asset reference.

## 6. Analytics

`maintenance-analytics.service.ts`/`.controller.ts`
(`@Controller('maintenance/analytics')`) — four read-only, any-authenticated
endpoints, every figure derived live, nothing stored:

- `GET /cost-vs-budget` — §3 above.
- `GET /cost-breakdown?from=&to=` — one pass over `MaintenanceCost` +
  issued `MaintenancePartUsage` rows (joined to their Work Order's asset/
  location/maintenance-type), bucketed in application code by asset,
  category (including a synthetic `PARTS_ISSUED` bucket, kept separate from
  the manual `PARTS` `MaintenanceCostCategory` per decision #6 of the
  Sprint 22 plan), maintenance type, month, and location.
- `GET /operational-metrics?from=&to=` — cost per asset (reuses the same
  bucketing), downtime minutes by asset, corrective-failure counts by
  asset, preventive-vs-corrective ratio, average time-to-complete (hours,
  over `COMPLETED` work orders with both `actualStartAt`/`completedAt`
  set), and work-order count by asset.
- `GET /risk-signals` — two deterministic, named-constant thresholds, never
  an ad-hoc heuristic buried in code:
  - **`REPEAT_FAILURE`**: an asset with `≥ REPEAT_FAILURE_THRESHOLD` (3)
    corrective (`maintenancePlanId: null`) work orders within the trailing
    `REPEAT_FAILURE_WINDOW_DAYS` (90) is flagged.
  - **`HIGH_COST`**: within each `AssetCategory`, an asset's own trailing-
    `HIGH_COST_TRAILING_WINDOW_DAYS` (90) maintenance cost exceeding
    `HIGH_COST_MULTIPLIER` (2) × the category's own median trailing cost
    (computed only across assets with nonzero cost) is flagged. A category
    with fewer than 2 costed assets is skipped — a lone asset can never
    exceed 2× its own value, so there is nothing meaningful to compare
    against.

Both constants are exported from `maintenance-analytics.service.ts` and
covered by unit tests (`maintenance-analytics.service.spec.ts`).

## 7. Business Events

No `EventEmitter`/`DomainEvent`/`NotificationService` infrastructure exists
anywhere in this codebase (confirmed by a full-repo grep before this
file was written), and `@nestjs/event-emitter` is not a dependency. Per
the brief's own "do not build a parallel notification system" instruction,
`maintenance-events.ts` is a plain, exported catalog of event names + TS
payload interfaces — no emitter, no subscriber, no new dependency, nothing
wired to anything. Every event name is cross-referenced to the
`MAINTENANCE_AUDIT_ACTIONS` entry already recorded at that exact moment —
today's audit trail (actor, tenant, timestamp, operation, entity, entityId)
already carries every field a future real dispatcher would need. It _is_
the event log until one is built.

## 8. Structural Guard

`maintenance-independence.spec.ts` (extended, Sprint 22):

- The shared `FORBIDDEN_WRITE_PATTERN` (covering every Finance/Procurement/
  Supplier/Sales/Production/Inventory table this domain doesn't own,
  including `purchaseOrder`/`supplier`/`budget`/`budgetLine`/`costCentre`/
  `capitalProject`) applies to every file in the domain **except**
  `maintenance-part-usage.repository.ts`, which is checked against the same
  list minus `inventoryStock`/`inventoryTransaction` — the one deliberate
  exception.
- A dedicated assertion confirms `issue()` really does write those two
  tables (positive check) and that no _other_ file in the domain ever does.
- A dedicated assertion confirms `maintenance-procurement.repository.ts`
  never calls a PurchaseOrder/Supplier write verb.
- A dedicated assertion confirms `MaintenanceModule`'s own `imports` array
  is exactly `{IdentityModule, AuthModule, FileStorageModule, AssetsModule,
ProductModule, SupplierModule, InventoryModule, PurchaseOrderModule}` —
  never `FinanceModule`/`ProductionModule`/a hypothetical
  `ProcurementModule`.
- `postSystemJournalEntry` absence (repo-wide, unchanged from Sprint 21)
  still holds: Maintenance posts nothing, ever.

## 9. Maintenance Analytics Frontend

`/settings/maintenance/analytics` (`apps/web/src/app/(app)/settings/
maintenance/analytics/page.tsx`), reachable from the `MaintenanceTabs` nav
alongside Overview/Work Orders/Requests/Plans/Schedules. Pure presentation
layer over §6's four existing endpoints — no metric is computed here from
raw rows; every number is either read directly off a server response or a
plain sum of an already-server-aggregated array (e.g. total downtime =
Σ `downtimeMinutesByAsset[].minutes`), the same "light display aggregation
only" discipline `Work Order` detail's own cost total already follows.
Nothing is persisted; every section is an independent `useQuery`, so a
failure in one (shown inline with a Retry button) never blocks the rest of
the page.

- **Period filter** — reuses the existing `resolveReportDateRange`/
  `ReportPeriodPreset` utility (Sprint 13) verbatim: Today/This Month/Last
  Month/This Quarter/This Year/Custom. No new date-range concept.
- **KPI Summary** — Maintenance Cost (`cost-breakdown.total`), Downtime
  (Σ `operational-metrics.downtimeMinutesByAsset`), Work Orders
  (`preventiveCount + correctiveCount`), Preventive/Corrective counts,
  Overdue (from the existing, _unscoped_ `/maintenance/overview` — labelled
  "current" since it is a live snapshot, not period-filtered, and mixing
  the two without saying so would be misleading), Average Time to
  Complete.
- **Cost Breakdown** — a bar chart (by category, reusing the exact
  `recharts`/`formatCurrency` styling `budgets/[id]/page.tsx` already
  established) plus by-asset and by-maintenance-type tables with %-of-total
  and asset drill-down links. `byLocation`/`byMonth` (also returned by the
  endpoint) are not separately rendered — kept out to avoid clutter per the
  brief's own instruction; available to add later without a backend change.
- **Cost vs Budget** — a cost-centre picker (`listCostCentres`, Finance's
  own frontend API, read-only cross-domain reuse — the same pattern the
  Work Order Procurement section already uses for `listPurchaseOrders`),
  Budget/Actual/Variance/Variance% cards, a `Within Budget`/`Over Budget`
  badge driven directly by the backend's own `withinBudget` boolean (no
  new accounting semantics invented), and the same Budget-vs-Actual bar
  chart shape Sprint 16 established.
- **Preventive vs Corrective** — a plain two-segment proportion bar (no new
  chart type) over `operational-metrics`' own counts.
- **Downtime** — table of `downtimeMinutesByAsset`, each row linking to the
  Asset Register detail page.
- **Assets Requiring Attention** — three ranking tabs (By Cost / By
  Downtime / By Work Orders) over the same `operational-metrics`/
  `cost-breakdown` responses already fetched for the sections above (no
  extra request — TanStack Query dedupes by query key).
- **Risk Signals** — `risk-signals` items rendered with `REPEAT_FAILURE`/
  `HIGH_COST` badges, each linking to the asset and to
  `/settings/maintenance/work-orders?assetId=` (the exact link shape the
  Asset Register detail page's own `MaintenanceSection` already uses).
  Labelled "deterministic operational signals — not predictions" per the
  brief's own explicit instruction never to use AI/predictive language
  here.

**Cross-page cache correctness**: the app's global `QueryClient`
(`apps/web/src/providers/query-provider.tsx`) sets `staleTime: 60_000`.
Issuing/cancelling a part or recording a cost on the Work Order detail page
now also invalidates the `maintenance-overview`/`maintenance-analytics-*`
query key prefixes (in addition to its own existing keys) so a manager
switching from Work Orders to Analytics never sees a stale total for up to
a minute — verified live: recording a ₦1,234 cost on one page immediately
moved the Analytics "Maintenance Cost" KPI on next navigation, with no
manual refresh.

**Verified against the real Boby Bites tenant, with direct DB cross-checks
(all exact matches)**:

| Figure                                      | Analytics page                               | Direct query                                                                                                  | Match                |
| ------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------- |
| Maintenance Cost (This Month)               | ₦72,200.00                                   | Σ `maintenance_costs.totalCost` + issued `maintenance_part_usages.totalCost` for the period                   | ✅                   |
| Cost vs Budget — Actual (ADMIN cost centre) | ₦25,200.00                                   | ₦25,000 tagged `MaintenanceCost` + ₦200 issued `MaintenancePartUsage` on the same work order                  | ✅                   |
| Cost vs Budget — Budget (ADMIN, September)  | ₦720,000.00                                  | Σ `budget_lines.amount` where `costCentreId = ADMIN`, `lineType = OPERATING_EXPENSE`, `periodMonth = 2026-09` | ✅                   |
| Cost vs Budget — Variance / Variance %      | −₦694,800.00 / −96.5%                        | `25,200 − 720,000` / `(−694,800 / 720,000) × 100`                                                             | ✅                   |
| Risk Signals                                | "No significant maintenance risks detected." | Seeded data has no asset with ≥3 correctives in 90 days, and only single-asset-per-category cost data         | ✅ (correctly empty) |

Accounting/inventory safety verified: every request the Analytics page
issues is `GET` (confirmed via the browser's own network log — zero
`POST`/`PUT`/`PATCH`/`DELETE` calls from this page). Opening or reloading
Analytics creates or modifies nothing.

Responsive: verified at 375px and 430px (no horizontal overflow —
`document.documentElement.scrollWidth === window.innerWidth` at both
widths) and desktop. One real mobile bug was found and fixed during this
pass: the "Assets Requiring Attention" ranked list overlapped its label and
value on narrow screens (a bare `flex justify-between` with no wrap) — now
`flex-wrap` with `min-w-0`/`shrink-0` on the two halves.

**Not added**: a frontend automated test suite. `apps/web`'s own `test`
script is currently a no-op stub (`"echo \"no tests yet\" && exit 0"`) —
there is no existing Vitest/Jest/RTL harness anywhere in `apps/web` to be
consistent with. Standing one up is an infrastructure decision (runner
choice, jsdom config, CI wiring) out of scope for this page-level task;
flagged here rather than silently skipped or unilaterally decided.

## 10. Asset Register Integration

The Asset Register detail page's existing `MaintenanceSection`
(`apps/web/src/app/(app)/settings/assets/register/[id]/page.tsx`, part of
Sprint 20) is extended in place — no second asset detail page, no
duplicate calculations. It consumes the same `getAssetHistory()` response
`MaintenanceOverviewService` already returned pre-Sprint-22 (extended by
this sprint with `capitalProject`, `partsUsed`, `partsIssuedCount`,
`partsCost`, `downtimes`, `upcomingSchedules`); the frontend adds no new
endpoint and computes no figure the backend didn't already aggregate,
except pure client-side derivations over the fetched array (counts of
open/in-progress/overdue work orders, total downtime formatting) — the
same "light display aggregation only" discipline §9 already follows.

- **Summary tiles** — an 8-tile grid: Open Work Orders, In Progress,
  Overdue, Last Completed, Next Scheduled, Total Cost, Total Downtime,
  Total Work Orders. Overdue/next-scheduled are derived client-side from
  `plannedEndAt`/schedule due-dates already present in the fetched rows —
  no new "is overdue" flag invented server-side.
- **Capital project link** — one line, reusing §4's zero-new-code-path
  `capitalProject` ref, when present.
- **Recent Maintenance History** — work order/status/priority/completed
  date, sliced to the 8 most recent with a "View all N work order(s) →"
  link out to the full Work Orders list filtered to this asset (the same
  filtered-link convention Analytics' Risk Signals section already uses).
- **Parts Used** — part name/quantity/status badge/cost, each row linking
  back to its own Work Order; header shows the already-aggregated
  `partsIssuedCount` and `formatCurrency(partsCost)`.
- **Downtime** — started/ended/duration (`formatDowntimeMinutes`, a plain
  client-side `h`/`m` formatter over the server-computed minute count, no
  duration logic duplicated from `AssetDowntime`'s own service).
- **Preventive Maintenance Schedules** — upcoming schedules with interval
  type and due date; overdue ones styled distinctly.

Loading/empty/error states (with Retry) match the rest of the page's
existing `useQuery` sections. Verified at 375px, 430px, and desktop — no
horizontal overflow, tiles reflow from 4-across to 2-across to 1-across.

**Verified live**: completing a Field work order's checklist, issuing a
real part, and ending downtime (see §11's scenario) immediately produced
matching figures on this section after cache invalidation — same total
cost, same downtime duration, same parts row — with no manual refresh,
confirming the Work Order detail page, this Asset section, and Analytics
(§9) all read the same underlying data with no drift between surfaces.

## 11. Field Technician Experience

`/field/maintenance` (`apps/web/src/app/(field)/field/maintenance/`) — the
mobile-first surface this sprint adds, built on the existing `(field)`
route architecture (`FieldShell`, `FieldBottomNav`, `FieldCard`,
`FieldStickyActionBar`, `Sheet side="full"`) rather than a shrunk desktop
page. `field/api.ts`/`field/labels.ts` re-export the existing Maintenance
and Asset frontend API/label modules verbatim (`export * from
'@/app/(app)/settings/maintenance/api'`, plus the two Asset functions
needed for meter reading) — no fetch logic is duplicated, and no new
backend endpoint exists for this surface.

- **No new RBAC role.** Per the brief's explicit constraint, there is no
  Technician role. "My Work Orders" is simply `listWorkOrders({
assignedToId: <signed-in user's own id> })` — the exact `assignedToId`
  convention Sprint 21 already established for Admin's own assignment UI,
  reused unchanged.
- **RBAC reality carried over from Sprint 21, applied here rather than
  redesigned**: almost every Maintenance write endpoint is gated
  `@Roles('Owner','Administrator')`; only checklist-task completion has no
  role restriction. `seed.ts`'s own `seedMaintenanceFixtures` already
  encodes the working convention — its `technicianUserId` parameter is
  populated with `administratorUser.id`. This surface was built and
  live-verified end-to-end using that same convention (signed in as
  `admin@bobybites.local`), documented here rather than silently assumed.
  A dedicated Technician role with narrower permissions remains a future
  RBAC decision, out of scope for this sprint (which was explicitly
  forbidden from creating one).
- **Home** (`field/maintenance/page.tsx`) — Overdue / In Progress / Today /
  Upcoming sections, derived client-side from the same fetched list (no
  new backend filter). Empty state when nothing is assigned.
- **Detail** (`field/maintenance/[id]/page.tsx`) — one obvious primary
  action per status via `FieldStickyActionBar`: OPEN → Assign to
  self + Start (combined into one mutation, since an unassigned work order
  reaching a technician's own list only happens through direct navigation),
  ASSIGNED → Start, IN_PROGRESS → Complete, ON_HOLD → Resume, COMPLETED →
  display-only. Every mutation calls the same existing service methods
  Admin's Work Order detail page already calls
  (`assignWorkOrder`/`startWorkOrder`/`completeWorkOrder`) — no parallel
  status-transition logic.
  - **Checklist** — the existing `WorkOrderTask` list, completion via the
    one role-open `PATCH .../tasks/:taskId` endpoint, server-authoritative.
  - **Parts** — request/issue (with location picker)/cancel, calling the
    same `record()`/`issue()`/`cancel()` endpoints §1 describes; no direct
    Inventory mutation from the frontend.
  - **Meter reading** — folded into the completion sheet, calling the
    existing Asset meter-reading service; no duplicate meter logic.
  - **Downtime** — reuses the existing active-downtime/end-downtime
    endpoints; Sprint 21's auto-close-on-completion behavior is untouched
    (completion still closes any open downtime window server-side).
  - **Procurement** — read-only card; linking a Purchase Order stays an
    Owner/Administrator action in the Admin UI, noted inline rather than
    silently hidden.
  - **Photos/documents** — plain before/after file inputs against the
    existing Maintenance document upload endpoint (the same convention
    Admin's `PhotosSection` already uses).
  - **Cache invalidation** — an `invalidateAll()` helper invalidates
    `work-order`, `work-orders field`, `maintenance-overview`, and every
    `maintenance-analytics-*` query key after any mutation, so Admin's
    Work Order detail, the Asset Register Maintenance section (§10), and
    Analytics (§9) all reflect a Field-driven change without a manual
    refresh — the same cross-page cache-correctness discipline §9 already
    established, now applied to the third surface reading this data.
- **Navigation** — `FieldBottomNav` gained a sixth `Maintenance` tab; no
  duplicate nav was introduced (Admin's `MaintenanceTabs` and this bottom
  nav address two different shells and audiences).

**Verified live end-to-end** (signed in as `admin@bobybites.local`,
standing in for the technician convention above): opened an assigned work
order from `/field/maintenance` → started it → completed its checklist
tasks → requested and issued a real part (confirmed a new
`InventoryTransaction` row, `referenceType: 'MaintenancePartUsage'`) →
ended its active downtime window → recorded a meter reading and completed
the work order. The resulting cost, downtime duration, parts row, and
status were then confirmed identical, with no discrepancy, on: the Admin
Work Order detail page, the Asset Register detail page's Maintenance
section (§10, bidirectional drill-down links both directions), and the
Maintenance Analytics page (§9, updated automatically). Direct DB check:
`inventory_transactions` rows with `referenceType = 'MaintenancePartUsage'`
count matched exactly the number of real issues performed across this
sprint's testing (3), and `journal_entries`/`journal_entry_lines` gained
zero rows attributable to Maintenance — confirming this domain still posts
nothing to the ledger.

Responsive: verified at 375px and 430px (the primary targets for this
surface); desktop checked only as a resilience smoke test, per the field
shell's own `max-w-md` always-narrow convention.

## 12. Remaining Work

Backend (§1–§8), the Maintenance Analytics frontend (§9), the Asset
Register Maintenance section (§10), and the Field Technician surface
(§11) are all complete, tested, and live-verified against real seeded
data, including cross-surface consistency and direct DB checks. What
remains, deliberately, is not part of this foundation-closing sprint's
scope:

- **A frontend automated test harness** (see §9's note) — `apps/web`'s
  `test` script is still a no-op stub; there is no existing Vitest/Jest/RTL
  setup anywhere in `apps/web` to extend. Standing one up is an
  infrastructure decision (runner choice, jsdom config, CI wiring)
  affecting every frontend page, not a Sprint 22 task — flagged here for a
  deliberate future decision rather than silently built or silently
  skipped.
- **A dedicated Technician RBAC role** — explicitly out of scope this
  sprint (the brief forbade creating one); the `assignedToId` convention
  above is the deliberate interim answer, not a placeholder bug.
- **A real two-way Production integration** — blocked on Production
  gaining its own Asset/equipment concept first (§5); today's
  `/maintenance/downtime/active` endpoint is read-side-only and unconsumed
  by design.
- **Predictive maintenance, IoT/sensor integration, IoT-driven condition
  monitoring, fleet management, and any AI/forecasting-based maintenance
  intelligence** — never in scope for Sprint 21 or 22; the Risk Signals
  feature (§6/§9) is explicitly deterministic/threshold-based, not
  predictive, and is labelled as such in the UI on purpose.
- **The future Zentuva Reporting platform** — see the "Reporting boundary"
  note at the top of this file; it consumes this domain's Analytics
  endpoints, it does not get built here.
