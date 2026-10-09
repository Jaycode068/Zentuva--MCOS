# Sprint 45 — Reporting & Business Intelligence Foundation — Completion Report

## 1. Executive Summary

Before a full business simulation and real tenant deployment, Zentuva needed a
reliable, consistent, secure, traceable way to retrieve, calculate, and present
business information across its domains. This sprint builds that foundation: a
reporting layer sitting above the existing domain services, enforcing one
authoritative definition per metric, organisation-timezone-aware reporting periods,
reused access control, and a typed, discoverable Metric/Report Registry — then proves
it works with 7 real reports across 6 business domains, each verified against real
data through the full stack (unit tests, real-PostgreSQL integration tests, and a
live run through the real API and a real browser session).

The single most important finding from the mandatory audit: **a substantial reporting
layer already existed** (`finance/reports/*`, Sprint 13) — P&L, Balance Sheet,
Revenue/COGS, Inventory Valuation, AR/AP aging, a Management Dashboard, all GL-derived
and already permission-gated. This sprint's job for Finance was not to rebuild any of
it, but to register it in one discoverable catalogue alongside genuinely new reports
for domains that had no equivalent (Sales order-level reporting, Production
planned-vs-actual, HR headcount/attendance, Workflow approval ageing, cross-channel
notification failures).

## 2. Architecture Implemented

```
HTTP request → ReportingController → ReportingService → domain report service → authoritative domain service (reused) OR narrow read-only Prisma query (new)
```

- `ReportingModule` is the one module in this codebase permitted to import many
  domain modules (Finance, Maintenance, HR, Production) — cross-domain aggregation
  reusing each domain's own read services is its entire purpose, proven
  one-directional by `reporting-independence.spec.ts`.
- `ReportingService` — resolves effective access once per request, filters the
  catalogue, resolves the timezone-aware period, enforces per-report permissions,
  delegates. No business-metric calculation of its own.
- 7 `reports/*.service.ts` files — each either a thin pass-through to an existing
  authoritative service, or a narrow, documented, read-only Prisma query.
- Typed `MetricDefinition`/`ReportDefinition` registries (18 metrics, 7 reports),
  structurally validated by their own test suite.
- `reporting-period.util.ts` — organisation-timezone-aware period resolution,
  extending the exact `Intl.DateTimeFormat` technique `hr-attendance-date.util.ts`
  already established; `[from, to)` semantics throughout.
- `reporting-csv.util.ts` — the first CSV export utility in this codebase, with
  OWASP-style formula-injection protection.
- `packages/validation/src/reporting.ts` — the first validated reporting
  query-parameter contract.

Full detail: [docs/domains/reporting.md](domains/reporting.md).

## 3. Files and Modules Changed

**New (26 backend files)**: `apps/api/src/reporting/` — period/CSV/types utilities,
metric and report registries, `ReportingService`/`Controller`/`Module`, 7 report
services, and 11 spec files (unit + 1 real-Postgres integration + independence guard

- registry sanity).

**New (15 frontend files)**: `apps/web/src/app/(app)/reports/` (landing page, API
client, 7 report pages) and `apps/web/src/components/reporting/` (6 shared UI
primitives: period selector, summary card, data table + pagination, loading/empty/
error states, export button, page header).

**New (1 doc)**: `docs/domains/reporting.md`.

**Modified, minimal and additive — every change documented in its own file's doc
comment**:

- `apps/api/src/app.module.ts` — registered `ReportingModule`.
- `apps/api/src/finance/finance.module.ts` — widened `exports` (5 services).
- `apps/api/src/maintenance/maintenance.module.ts` — widened `exports` (1 service;
  previously exported nothing).
- `apps/api/src/production/production.module.ts` — widened `exports` (1 repository;
  previously exported nothing).
- `apps/api/src/hr/employee.repository.ts` — 2 new `groupBy` methods.
- `apps/api/src/hr/employee.service.ts` — 2 new thin pass-through methods.
- `apps/api/src/identity/authorization/permission-catalogue.ts` — 1 new permission.
- `apps/web/src/components/workspace/navigation-config.ts` — activated the
  pre-existing "Reports" nav entry (removed `comingSoon: true`).
- `packages/validation/src/index.ts` — exported the new `reporting.ts` schema module.
- `docs/backlog.md`, `docs/changelog.md` — one entry each.

No existing controller, test, or business-logic method was altered — confirmed by the
full pre-existing suite passing unchanged (§6).

## 4. Reports and KPIs Delivered

**7 reports**: Sales Performance, Inventory Position, Receivables Aging, Payables
Aging, Production Performance, Workforce Summary, Operational Exceptions (a 3-section
composite: pending approvals, overdue maintenance, failed notifications).

**18 KPIs** in the Metric Registry, spanning Finance (7, mostly reused), Inventory
(2, one blocked), Sales (1, new), Production (2, new), HR (2, one blocked),
Operations (3, new). Full dictionary: [docs/domains/reporting.md §6](domains/reporting.md#6-kpi-dictionary).

## 5. KPI Dictionary & Coverage Matrix Locations

Both live in [docs/domains/reporting.md](domains/reporting.md) — §6 (KPI Dictionary)
and §7 (Reporting Coverage Matrix), generated from and kept in sync with
`apps/api/src/reporting/reporting-metric-registry.ts` /
`reporting-report-registry.ts`, enforced by `reporting-registry.spec.ts`.

## 6. Test Suites and Exact Test Counts

- **Full API unit suite**: 265 suites / 2427 tests passing, 0 failures (72 of those
  tests are new this sprint, across 10 new suites: period util 21, CSV util 7,
  registries 9, `ReportingService` 10, and 5 report-service suites totaling 25).
- **Full integration suite** (`pnpm run test:integration`, real PostgreSQL): 9 suites
  / 39 tests passing, 0 failures (7 of those tests are new — tenant isolation across
  6 report types using 2 real pre-existing organisations).
- Regression confirmed: every pre-existing suite (Finance, HR, Maintenance,
  Production, D2C, Workflow, Notifications, Access Control) still passes unchanged
  after this sprint's module-export widenings.

## 7. Build, Typecheck, and Lint Results

- `tsc --noEmit` (API): clean.
- `tsc --noEmit` (web): clean.
- `tsc --noEmit` (`packages/validation`): clean.
- `eslint` on every new/modified file (API, web, validation): clean, 0
  warnings/errors.
- `nest build` (API): clean; the compiled app boots successfully with every new
  `/reporting/*` route correctly mapped and the full DI graph resolving with no
  missing-provider errors.
- `pnpm run build` (web, full site): clean — all 8 new `/reports*` routes built
  successfully as static pages.
- `npx prisma validate`: schema valid (no schema changes this sprint — reporting is
  entirely additive code, zero new tables/columns).

## 8. Tenant-Isolation Test Results

`reporting-tenant-isolation.integration.spec.ts`, real PostgreSQL, 2 real pre-existing
organisations ("Boby Bites" plus whichever other seeded tenant has the richest real
transactional footprint): 7/7 tests passing — Receivables, Payables, Inventory
Valuation, Sales Performance, Workforce Summary, and Production Performance each
proven to never return the other organisation's ids, even when the second
organisation's own table is empty (the assertion is structurally capable of catching
a missing-`organisationId`-filter bug regardless of how much data the comparison
organisation has).

Live, over real HTTP (§10): the seeded Member account — holding only
`sales.dashboard.view` among reporting-relevant permissions — received a real `403
Forbidden` from Receivables, real data from Sales Performance, and
`{pendingApprovals: null, overdueMaintenanceCount: null, failedNotifications: null}`
from Operational Exceptions; Owner saw every section populated.

## 9. Financial and Inventory Verification Results

Every Finance-domain figure in this sprint's reports is a direct, unmodified call
into the pre-existing, already-tested `FinancialStatementService`/
`AccountsReceivableService`/`AccountsPayableService`/`InventoryValuationService`/
`RevenueCogsService` — no new Finance calculation was written, so no new Finance
calculation needed independent reconciliation. What WAS newly verified:

- Sales Performance's `source: B2B` filter — a dedicated unit test confirms every
  underlying `SalesOrder` query (groupBy, count, findMany) carries it, and live
  verification confirmed the real total (₦15,945,800) matches exactly what Finance's
  own GL-derived revenue figure already reports for the same period.
- Production Performance's material cost — confirmed live to equal the sum of each
  completed order's `ProductionMaterialIssueRepository.getTotalWipValue` (the same
  GL-sourced figure `ProductionOrderService.completeProduction` already uses to post
  its own journal entry), never a recomputation from current `averageUnitCost`.
- Inventory Position's per-line value — confirmed live to equal
  `quantityOnHand × averageUnitCost`, matching Finance's own Inventory Valuation
  report figure to the kobo (₦2,238,474.00 grand total, identical on both surfaces).

## 10. Live/Database-Backed Verification Performed

Full detail: [docs/domains/reporting.md §13](domains/reporting.md#13-live-verification-real-database-real-http-real-browser).
Summary: the real API was built (`nest build`) and run (`node dist/main.js`) against
the real Boby Bites PostgreSQL database; every report endpoint was called with a real
JWT (Owner and Member accounts) and returned real, correct data; the real Next.js
production build was run and driven through a real browser session logged in as the
real seeded Owner — every report page rendered, period/comparison switching worked
(including a real "No comparison data" result for a genuinely empty 2025), and the
CSV export button fired a real, correctly-authorized request.

## 11. Known Issues and Data Gaps

Honestly documented, not fabricated — full list in
[docs/domains/reporting.md §7/§15](domains/reporting.md#7-reporting-coverage-matrix):
no reorder-point field on `Product` (low-stock reporting blocked); no Leave model
anywhere in this codebase (leave reporting blocked); production costing is
materials-only (no labour/overhead); `SalesOrder` carries no `territoryId`
(territory/outlet sales reporting blocked); no Asset depreciation calculation exists.

One genuine, pre-existing discrepancy was found and documented but deliberately NOT
fixed this sprint (out of scope, already-shipped Finance code):
`finance/reports/dashboard.service.ts`'s `getOperational()` does not filter
`SalesOrder` by `source`, so its `salesOrderTotal` commingles B2B and D2C — this
sprint's own new Sales Performance report does filter correctly, and the discrepancy
is recorded in the KPI dictionary rather than silently patched in unrelated code.

## 12. Deferred Reporting Capabilities

Distribution-by-territory/outlet, Procurement open-PO report, Inventory movement
history, Asset register/status counts, Recruitment pipeline funnel, Activity-feed
reporting, Excel/PDF export, any caching/materialized-view infrastructure. All
explicitly out of this sprint's scope per the brief's own boundaries (§19) or genuinely
requiring a schema change this sprint deliberately avoided.

## 13. Recommended Sprint 46 Scope

1. **Executive Dashboard** — the brief's own stated Sprint 46 objective. Compose this
   sprint's Metric Registry into KPI cards; resolve the deferred "does the Executive
   Dashboard need its own consolidated-visibility permission" question (§5 of the
   domain doc) before building it, rather than silently bypassing per-domain
   permissions.
2. **Territory/outlet sales reporting** — requires deciding whether to add
   `SalesOrder.territoryId` directly or join through `Customer`/`Outlet`; worth a
   short design pass rather than ad hoc implementation.
3. **Low-stock reporting** — requires a `reorderPoint`/`minimumStock` field on
   `Product`, a real (small) schema change, best bundled with whatever sprint next
   touches the Inventory/Catalogue domain.
4. **Reconsider `dashboard.service.ts`'s `source` filter** — a one-line, low-risk fix
   to an existing, already-shipped Finance file, worth doing deliberately rather than
   as a drive-by in a reporting sprint.
5. Excel export, if a real operational need for it (not just "nice to have") emerges
   from actual usage of the CSV exports this sprint shipped.

## 14. Confirmation of Git Status

**Baseline** (recorded before any Sprint 45 work): working tree clean except one
pre-existing untracked file, `.claude/launch.json` (local dev-tool configuration,
unrelated to this sprint, predates it).

**End of sprint**: `.claude/launch.json` remains the only untracked, unrelated item.
Every other change listed in `git status --short` above is Sprint 45 work. **Nothing
has been committed or pushed** — per this sprint's explicit, standing instruction
("DO NOT COMMIT OR PUSH"), the Sprint 44 commit (`c8b9735`) remains `HEAD`, and all
Sprint 45 changes sit as uncommitted working-tree modifications and new files, ready
for the user's own review before any commit decision.

**Documentation note**: `docs/domains/README.md`'s domain-status table was
deliberately NOT updated — inspection found each of its existing rows padded to a
pre-existing, apparently-generated ~29KB line width unrelated to this sprint, making
a safe, surgical edit disproportionately risky for an index-table entry. The
substantive content lives in `docs/domains/reporting.md`, linked from the changelog
and this report instead. The engineering handbook's "Primary Business Domains" list
(§7) was similarly left untouched, consistent with the fact that no domain added
since Sprint 1 (D2C, Workflow, HR, Maintenance, Access Control, etc.) appears there
either — editing it for Reporting alone would be inconsistent with established
precedent, not a fix.
