# Sprint 46 — Executive & Management Dashboards — Completion Report

## 1. Executive Summary

Sprint 45 built the reporting foundation; Sprint 46 answers the question it was built
to answer: **"What is happening in this business, and what requires my attention?"**
An Executive Dashboard at `/dashboard` composes the existing authoritative domain
services into one business-performance overview — KPI cards, two real trend charts,
five explainable business-health indicators, and a recent-activity feed — plus six
focused departmental dashboards (Sales, Finance, Inventory, Production, Procurement,
Workforce), every one of them read-only, permission-gated per section, and tenant
isolated.

No new KPI calculation was introduced anywhere in this sprint beyond what Sprint 45
already defined, except two genuinely new figures with no prior source (Procurement's
open-PO count/value, and the two real day-by-day trend series) — both documented in
the KPI dictionary with their own authoritative source, exactly like every Sprint 45
metric. Zero new permissions were added: every dashboard section reuses the existing
domain permission its data already requires, including a deliberate decision NOT to
add a consolidated "view everything" permission (`docs/domains/reporting.md` §5).

Live verification against the real seeded database found and fixed three genuine
bugs — a duplicated percent-change formula in two Sprint 45 report pages (the exact
"never calculate a KPI formula twice" violation this sprint's own brief warns
against), a global TanStack Query retry default that left a restricted user's
dashboard spinning on a correctly-enforced `403` for several seconds, and a misleading
"Coming soon." label on the new Dashboard's own navigation tile.

## 2. Architecture Implemented

```
GET /reporting/dashboard/executive
  → ReportingController → ReportingService (resolves period once)
  → ExecutiveDashboardService
      → per-section: EffectiveAccessResolver checked once, then independently
        gated calls into FinancialStatementService / AccountsReceivableService /
        AccountsPayableService / InventoryValuationService / SalesPerformance-
        ReportService.getDailyTrend / ProductionPerformanceReportService
        .getDailyTrend / EmployeeService / OperationalExceptionsReportService /
        AuditService — never a second calculation of any of these
```

`ExecutiveDashboardService` performs no KPI calculation of its own. Each of its five
business-domain sections (finance, inventory, sales, production, workforce) and the
three exception sub-parts is independently permission-gated and `null` when absent —
the exact pattern Sprint 45's `OperationalExceptionsReportService` already
established, generalized to the whole dashboard. One new composed endpoint, justified
because the alternative is 6+ separate frontend requests per page load (brief §9).

Departmental dashboards are thin, focused pages: five of six reuse an existing Sprint
45 report endpoint verbatim with zero new backend code; Procurement required one new,
narrow service (`ProcurementSummaryReportService`) since no existing report covered
Purchase Orders. Full detail, including the Business Health rule table and the
Executive Dashboard permission decision: `docs/domains/reporting.md` §17–24.

## 3. Files and Modules Changed

**New (backend, 4 files):** `apps/api/src/reporting/reports/executive-dashboard
.service.ts` + `.spec.ts`, `procurement-summary-report.service.ts` + `.spec.ts`.

**New (frontend, 10 files):** `apps/web/src/app/(app)/dashboard/page.tsx` (Executive
Dashboard) and `{sales,finance,inventory,production,procurement,workforce}/page.tsx`
(6 departmental dashboards); `apps/web/src/components/reporting/{trend-chart,
health-indicator-list,activity-feed}.tsx` (3 new shared components).

**Modified, minimal and additive:**

- `apps/api/src/reporting/reporting-period.util.ts` — one new export,
  `toLocalDateKey` (a thin public wrapper around this file's own existing internal
  day-bucketing logic).
- `apps/api/src/reporting/reports/sales-performance-report.service.ts` /
  `production-performance-report.service.ts` — one new `getDailyTrend` method each.
- `apps/api/src/reporting/reporting.types.ts` / `reporting-metric-registry.ts` /
  `reporting-report-registry.ts` — added the `PROCUREMENT` domain and the new
  metric/report entries.
- `apps/api/src/reporting/reporting.service.ts` / `.controller.ts` / `.module.ts` —
  two new methods/routes (`getExecutiveDashboard`, `getProcurementSummary`), two new
  providers. **No new module import** — every new service's dependencies were already
  available from modules Sprint 45 imported.
- `apps/api/src/reporting/reporting-independence.spec.ts` /
  `reporting-tenant-isolation.integration.spec.ts` — extended to cover the two new
  services.
- `apps/web/src/app/(app)/reports/api.ts` — added the shared `calculatePercentChange`
  export, the `PROCUREMENT` domain, and the Executive Dashboard/Procurement Summary
  types and fetch functions.
- `apps/web/src/app/(app)/reports/sales-performance/page.tsx` /
  `production-performance/page.tsx` — removed their duplicated local
  `calculatePercentChange`, now import the shared one (bug fix, §9).
- `apps/web/src/app/(app)/reports/page.tsx` — added the `PROCUREMENT` domain label.
- `apps/web/src/components/reporting/summary-card.tsx` — added `favorableDirection`
  (`'up' | 'down' | 'neutral'`) and `href`, both optional; every existing call site is
  unaffected.
- `apps/web/src/components/reporting/report-page-header.tsx` — added optional
  `backHref`/`backLabel` (default unchanged) so departmental dashboard pages can link
  back to `/dashboard` instead of `/reports`.
- `apps/web/src/components/workspace/navigation-config.ts` — renamed the nav entry
  previously mislabelled "Dashboard" (→ `/workspace`, a module launcher) to
  "Workspace," and added a new "Dashboard" entry (→ `/dashboard`).
- `apps/web/src/app/(app)/workspace/page.tsx` — added a real description for the new
  `/dashboard` module tile (bug fix, §9) and corrected a now-stale comment.
- `apps/web/src/providers/query-provider.tsx` — added a global `retry` function that
  skips retries on any `4xx` response (bug fix, §9); a pre-existing, codebase-wide
  default, not previously set explicitly.
- `docs/domains/reporting.md` — updated §5's Executive Dashboard permission decision,
  two coverage-matrix rows now delivered, one new KPI dictionary row, and new §17–24.

No existing controller, business-logic method, or pre-Sprint-46 test assertion was
altered — confirmed by the full pre-existing suite passing unchanged (§6).

## 4. Executive Dashboard Sections and Source Metrics

| Section                         | Content                                                                                                                                              | Source                                                                            |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| A. Reporting Controls           | Period preset (10 options), comparison mode, last-updated timestamp                                                                                  | Reused `PeriodSelector`; `dataUpdatedAt` from TanStack Query                      |
| B. Business Performance Summary | Net Revenue, Gross Profit, Receivables/Payables Outstanding, Inventory Value, Sales Orders, Production Output (Accepted), Active Headcount — 8 cards | `ExecutiveDashboardService`, each field citing its Sprint 45 authoritative source |
| C. Business Trends              | Sales Order Value by Day, Accepted Production Output by Day                                                                                          | New `getDailyTrend` methods — real per-day sums, see §18 of the domain doc        |
| D. Business Health              | 5 explainable indicators (see domain doc §19)                                                                                                        | `HealthIndicatorList`, composed from the same section data already fetched        |
| E. Recent Business Activity     | Last 10 audit-log rows                                                                                                                               | `AuditService.listByOrganisation` — no new event system                           |

Every KPI card links to its authoritative report (`href` on `SummaryCard`); every
figure was cross-checked live against that report and matched exactly (§10).

## 5. Departmental Dashboard Coverage

Built: Sales, Finance, Inventory, Production, Procurement, Workforce — all six brief
candidates. Deferred (documented, not silently dropped): Recruitment, Assets,
distribution-by-territory — none has an existing Sprint 45 report to compose, and the
brief's own §6 explicitly permits deferring a departmental view the data doesn't yet
justify. Full table: `docs/domains/reporting.md` §20.

## 6. Business-Health Indicator Definitions

Five indicators, each an objective, independently-sourced condition — never a
composite score. Full table with rule, source, period/timestamp basis, and required
permission: `docs/domains/reporting.md` §19.

## 7. Permissions

**Zero new permissions.** `reporting.catalogue.view` (Sprint 45) continues to gate
route-level visibility only; every dashboard section reuses the exact domain
permission its Sprint 45 data already required. The Executive Dashboard permission
question Sprint 45 deliberately left open is now resolved: no consolidated-visibility
permission was added — see `docs/domains/reporting.md` §5 for the full reasoning.

## 8. Test Suites and Exact Test Counts

- **Reporting module unit suite**: 12 suites / 99 tests passing (20 new this sprint:
  `ExecutiveDashboardService` 7, `ProcurementSummaryReportService` 5,
  `SalesPerformanceReportService.getDailyTrend` 3, `ProductionPerformanceReportService
.getDailyTrend` 2, `toLocalDateKey` 3).
- **Full API unit suite**: 267 suites / 2447 tests passing, 0 failures.
- **Full integration suite** (`pnpm run test:integration`, real PostgreSQL): 9 suites
  / 41 tests passing, 0 failures (2 new tests added to
  `reporting-tenant-isolation.integration.spec.ts`: Procurement Summary and the
  Executive Dashboard itself, cross-checked against independently-scoped direct
  queries for both organisations).
- **Regression**: every pre-existing suite (Finance, HR, Maintenance, Production,
  D2C, Workflow, Notifications, Access Control, and all of Sprint 45's own reporting
  tests) passes unchanged.

## 9. Build, Typecheck, and Lint Results

- `tsc --noEmit` (API): clean.
- `tsc --noEmit` (web): clean.
- `eslint` on every new/modified file (API and web): clean, 0 warnings/errors.
- `nest build` (API): clean.
- `pnpm run build` (web, full site): clean — all 7 new `/dashboard*` routes built
  successfully as static pages.
- `npx prisma validate`: schema valid (no schema changes this sprint).

## 10. Tenant-Isolation Test Results

`reporting-tenant-isolation.integration.spec.ts`, real PostgreSQL, 2 real pre-existing
organisations: **8/8 tests passing**, including the 2 new Sprint 46 tests:

- Procurement Summary — Org A's open-PO ids and supplier ids never appear in Org B's
  report, and vice versa.
- Executive Dashboard — every section composed for Org A cross-checked against an
  independently-scoped direct query for both active headcount and sales-order ids;
  zero overlap with Org B in either case.

## 11. Security / Permission Verification Results

All performed live, against the real running API, as the real seeded Owner and Member
accounts (`docs/domains/reporting.md` §21 has the full detail):

- **Member (holds only `sales.dashboard.view` among reporting permissions) on the
  Executive Dashboard**: exactly one KPI card rendered (Sales Orders); Business
  Health showed its "no indicators visible to you" fallback (every underlying
  permission — `finance.reports.view`, `workflow.instance.view`, `maintenance
.work_order.view`, both notification permissions — is absent for Member); Recent
  Activity was entirely absent (`identity.audit-logs.read` absent).
- **Member on `/dashboard/finance`**: the server returned genuine `403 Forbidden` for
  both `/reporting/reports/receivables` and `/reporting/reports/payables` — confirmed
  directly in the browser's own network log, not inferred from code reading. No
  receivables/payables figure of any kind reached the browser.
- **Owner on every dashboard**: every section populated with real data, matching its
  authoritative report exactly (§12 #1 below).
- **Catalogue filtering** (confirmed, reusing Sprint 45's own verified mechanism):
  unchanged this sprint, re-verified incidentally while testing the Member account.

## 12. Live/Database-Backed Verification Performed

Against the real seeded "Boby Bites" database via the actual running dev servers:

1. **Cross-page metric consistency** — Executive Dashboard's "Receivables
   Outstanding" (`₦11,195,800.00`) matched the Receivables Aging report's "Total
   Outstanding" exactly.
2. **Period-change consistency** — switching "This Month" → "Last Month" updated
   every period-scoped card (new `-100.0%` comparisons) while every point-in-time
   card (Receivables/Payables Outstanding, Inventory Value, Active Headcount) stayed
   unchanged — proving each metric respects its own `timeBasis`.
3. **Procurement dashboard with real data** — one real open PO (`PO-000009`,
   `PARTIALLY_RECEIVED`, `₦100,000.00`), Payables Outstanding matching the Finance
   dashboard's own card.
4. **Navigation integrity** — the renamed "Workspace" sidebar entry, the new
   "Dashboard" entry, and the `/workspace` Platform Modules grid's own Dashboard tile
   all resolve correctly end to end.

Three real bugs found and fixed during this process — full detail in
`docs/domains/reporting.md` §22:

1. Duplicated `calculatePercentChange` in two Sprint 45 report pages.
2. A global TanStack Query retry default silently re-sent a correctly-enforced `403`
   three times before showing an error, leaving a restricted user on "Loading…" for
   several seconds.
3. The new `/dashboard` nav tile inherited a misleading "Coming soon." fallback
   label.

A fourth correctness issue (open-PO value computed from a capped row list rather than
a true aggregate) was caught during implementation via a unit test, before it ever
shipped.

## 13. Known Issues and Data Gaps

Unchanged from Sprint 45 except where this sprint's own work is itself the documented
gap:

- No consolidated cross-domain permission exists (deliberate decision, §7).
- Recruitment, Asset, and territory-based dashboards remain unbuilt — no underlying
  Sprint 45 report exists to compose.
- The Recent Activity `entityType` → route map covers only `SalesOrder`,
  `ProductionOrder`, `PurchaseOrder` — every other entity type renders unlinked
  rather than with a guessed URL.
- `AuditLog.action` strings render close to verbatim (e.g. "User: success") — readable
  but not fully humanized.
- No custom date-range picker on any dashboard yet (`PeriodSelector` exposes presets
  only; the backend already supports `customFrom`/`customTo`).
- Inventory has no trend chart — no historical valuation snapshot exists to chart
  honestly (documented, not built misleadingly).

Full detail: `docs/domains/reporting.md` §24.

## 14. Deferred Capabilities

- Recruitment pipeline dashboard, Asset dashboard, Distribution-by-territory
  dashboard — each blocked on a missing Sprint 45 (or earlier) report, not on this
  sprint's own architecture.
- A custom date-range picker UI.
- Excel/PDF export, a materialized-view/cache layer, any new analytics
  infrastructure — explicitly out of scope per the brief §14, unchanged from Sprint
  45's own decision.
- A proper `AuditLog.action` → human-readable-sentence mapping for the activity feed.

## 15. Recommended Sprint 47 Scope

- A readiness audit pass across the two sprints' own documented data gaps (Leave
  model, reorder-point field, labour/overhead costing, territory attribution) —
  prioritizing by real business value for Boby Bites' own operations, not
  implementing every gap found.
- If Recruitment/Asset reporting becomes a priority, build their Sprint-45-equivalent
  report first (following the exact established pattern), then their departmental
  dashboard is a small follow-on.
- Consider a custom date-range picker if real usage shows the 10 presets are
  insufficient.

## 16. Confirmation of Git Status

**Baseline** (recorded before any Sprint 46 work): working tree clean except the
pre-existing untracked `.claude/launch.json` (unrelated local dev-server tooling
config, predates this session, never touched).

**At completion**: every file changed this sprint is listed in §3 above — 15 modified,
14 new, all within `apps/api/src/reporting/`, `apps/web/src/app/(app)/dashboard/` and
`.../reports/`, `apps/web/src/components/reporting/`, `apps/web/src/components/
workspace/navigation-config.ts`, `apps/web/src/app/(app)/workspace/page.tsx`,
`apps/web/src/providers/query-provider.tsx`, and `docs/`. `.claude/launch.json`
remains the only untracked file, unrelated to this sprint. Per the brief's explicit,
standing instruction: **nothing has been committed or pushed.**
