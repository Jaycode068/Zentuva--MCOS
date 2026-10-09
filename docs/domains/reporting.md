# Reporting & Business Intelligence (Sprint 45)

## 1. Purpose

Before a full business simulation and real tenant deployment, Zentuva needs a reliable,
consistent, secure, traceable way to retrieve, calculate, and present business
information across its domains. Sprint 45 builds that foundation: a reporting layer
that sits **on top of** the existing domain services, reusing their authoritative
calculations rather than recomputing anything, and establishes the typed
registries, period/filter contracts, permission model, and UI primitives that Sprint
46's Executive Dashboard (and every report after it) will build on.

**Governing principle (brief §4): one authoritative definition per metric.** If
Finance already computes gross profit from posted journal entries, no report
anywhere recalculates it from `SalesOrder` totals. Where this sprint's audit found an
existing authoritative service, it is reused verbatim; where none existed, a new,
narrow, read-only query was added and is documented as the new authority.

## 2. Mandatory Audit — What Already Existed

Before any code was written, five parallel audits covered Finance/Accounting,
Sales/Distribution, Inventory/Procurement/Production, HR/Recruitment/Assets/
Maintenance, and Workflow/Notifications/existing-dashboard infrastructure. Headline
finding: **a substantial reporting layer already existed**, entirely inside
`apps/api/src/finance/reports/` (Sprint 13) — Profit & Loss, Balance Sheet, Revenue/
COGS, Inventory Valuation, Inventory-to-Ledger Reconciliation, and a composite
Management Dashboard, all GL-derived, all already permission-gated behind
`finance.reports.view`. Sprint 45 does not rebuild any of this — it registers it
alongside new reports in one discoverable catalogue and reuses its services directly.

Other domains had no equivalent: Sales had sales orders but no net-sales/order-status
reporting outside the GL; Production had the raw data for planned-vs-actual but no
aggregation; HR had a partial overview service with an inefficient in-memory pattern
for one figure and no attendance aggregation at all; Workflow had a per-user
"my approvals" query unsuitable for an org-wide ageing report; Notifications had
per-channel delivery lists but no cross-channel failure count. These gaps are what
Sprint 45's new code fills — see §7 (Coverage Matrix) for the full picture.

## 3. Architecture

```
HTTP request → ReportingController → ReportingService → domain report service → authoritative domain service (reused) OR narrow read-only Prisma query (new)
```

- **`apps/api/src/reporting/reporting.module.ts`** — the only module in this codebase
  allowed to import many domain modules (Finance, Maintenance, HR, Production), since
  cross-domain aggregation reusing each domain's own read services is its entire
  purpose. No domain module imports it back — the dependency is strictly
  one-directional, proven by `reporting-independence.spec.ts`.
- **`ReportingService`** — resolves the caller's effective access once per request,
  filters the catalogue to what they can see, resolves the organisation-timezone-aware
  reporting period, enforces each report's own existing domain permission, and
  delegates. Contains no business-metric calculation of its own.
- **Seven `reports/*.service.ts` files** — one per report, each either a thin
  pass-through to an existing authoritative service (Receivables, Payables, Inventory
  Position) or a narrow, documented, read-only Prisma query (Sales Performance,
  Production Performance, Workforce Summary, Operational Exceptions) — never a second
  implementation of a figure that already has one.
- **`reporting-metric-registry.ts`** / **`reporting-report-registry.ts`** — typed,
  discoverable arrays of `MetricDefinition`/`ReportDefinition` objects (never free
  strings or arbitrary SQL) — the KPI dictionary (§6) and coverage matrix (§7) are
  generated from these, kept in sync by `reporting-registry.spec.ts`'s own structural
  checks (unique ids, valid permission keys, valid drill-down targets, export/route
  correspondence).
- **`reporting-period.util.ts`** — resolves a period preset (`today` … `last_year` …
  `custom`) into organisation-**local** calendar boundaries, expressed as UTC instants,
  using the exact `Intl.DateTimeFormat` technique `hr-attendance-date.util.ts`
  (Sprint 24) already established for `Organisation.timeZone` — no new timezone model.
  Semantics: `[from, to)`, inclusive start/exclusive end, chosen specifically so two
  adjacent periods never overlap or gap at the boundary (unlike the pre-existing,
  browser-local-only `apps/web/src/lib/report-date-range.ts`, left unchanged and still
  used by the Finance report pages that predate this sprint).
- **`reporting-csv.util.ts`** — the first CSV export utility in this codebase (the
  audit found none existed); dependency-free, with OWASP-style formula-injection
  neutralization for leading `=`/`+`/`-`/`@` (except ordinary signed numbers).
- **`packages/validation/src/reporting.ts`** — `reportingPeriodQuerySchema`/
  `reportPaginationSchema`/`reportSortSchema`, the first validated query-parameter
  contract for any reporting endpoint (every pre-existing Finance report endpoint
  parses `@Query()` as raw strings with no Zod schema — left unchanged).

### Widened exports (minimal, additive, each documented in its own module's doc comment)

| Module                                               | Newly exported                                                                                                                        | Why                                                                                                                                                 |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FinanceModule`                                      | `FinancialStatementService`, `AccountsReceivableService`, `AccountsPayableService`, `InventoryValuationService`, `RevenueCogsService` | Reuse, never recompute                                                                                                                              |
| `MaintenanceModule`                                  | `MaintenanceOverviewService`                                                                                                          | Reuse `overdueWorkOrders`                                                                                                                           |
| `ProductionModule`                                   | `ProductionMaterialIssueRepository`                                                                                                   | Reuse GL-sourced `getTotalWipValue`                                                                                                                 |
| `HrModule` (via `EmployeeService`, already exported) | Two new pass-through methods: `getHeadcountByStatus`, `getActiveHeadcountByDepartment`                                                | New `groupBy` queries added to `EmployeeRepository`, exposed through the already-exported service rather than widening the module's exports further |

No module's own controllers, tests, or behaviour changed — these are purely additive
visibility changes, confirmed by the full pre-existing test suite passing unchanged.

## 4. Reporting Periods & Comparisons

Presets: `today`, `yesterday`, `this_week`, `last_week`, `this_month`, `last_month`,
`this_quarter`, `last_quarter`, `this_year`, `last_year`, `custom`. Comparison modes:
`none`, `previous_period` (immediately preceding period of identical length, matching
`FinancialStatementService.getProfitAndLossComparison`'s own established semantics),
`previous_year` (same calendar window one year earlier).

- Every boundary is computed from **`Organisation.timeZone`**, server-side — the
  frontend sends only the preset name, never a client-computed date, so a browser in
  the wrong timezone can never produce a wrong boundary.
- A comparison period with **zero source activity** resolves to `null` (never a
  fabricated zero) — e.g. `SalesPerformanceReportService` returns
  `comparisonRevenue: null` when the prior-year window had no recognized revenue, and
  the frontend renders "No comparison data," never a misleading 0%. Verified live: Boby
  Bites has zero 2025 sales activity, and the real `previous_year` comparison correctly
  returned `null` end-to-end (§13).
- `calculatePercentChange(current, previous)` returns `null` whenever `previous` is
  `0`, `null`, or `undefined` — never `NaN`/`Infinity`. 6 dedicated unit tests cover
  every edge case including a negative baseline.

## 5. Access Control

**One new permission**: `reporting.catalogue.view` (`NONE` scope) — gates visibility
into the `/reports` landing page and the catalogue endpoint ONLY. It never grants
access to any report's actual data. Every individual report endpoint additionally
requires the **same pre-existing domain permission its authoritative source already
uses**:

| Report                                    | Required permission                |
| ----------------------------------------- | ---------------------------------- |
| Sales Performance                         | `sales.dashboard.view` (existing)  |
| Inventory Position, Receivables, Payables | `finance.reports.view` (existing)  |
| Production Performance                    | `production.order.view` (existing) |
| Workforce Summary                         | `hr.employee.view` (existing)      |
| Operational Exceptions                    | composite — see below              |

This is the brief's own explicit ask: "use the existing access-control system instead
of introducing a parallel reporting authorization system" — no new per-domain
reporting permission was invented.

**Operational Exceptions is a genuine composite**, not a single-permission report:
its three sections (pending approvals, overdue maintenance, failed notifications) are
each independently gated by `workflow.instance.view`, `maintenance.work_order.view`,
and (`notification.email.view` **AND** `notification.whatsapp.view`) respectively. A
caller lacking one section's permission gets that section as `null` in the response —
never a 403 for the whole report, and the maintenance/notification queries are never
even attempted when the caller can't see their result (verified by a dedicated unit
test asserting the mocked query functions are never called). Live-verified: the seeded
Member account (holding only `sales.dashboard.view` among reporting-relevant
permissions) received all three sections as `null`, while Owner saw real data in all
three (§13).

**The catalogue itself is permission-filtered, not just data-gated** — a metric or
report whose `requiredPermission` the caller lacks is omitted from `GET
/reporting/catalogue` entirely, never returned with a "locked" flag (brief §10 "avoid
leaking protected data through... errors"). Live-verified: the Member account's real
catalogue response contained exactly one report (`sales-performance`) and one metric.

**Executive Dashboard decision (brief §10 "review whether the executive dashboard will
eventually need a distinct permission")**: deliberately NOT decided this sprint.
Sprint 46's Executive Dashboard will need its own explicit decision — either a new
consolidated-visibility permission, or continuing to compose each domain's existing
permission per section as Operational Exceptions already does. Recorded here as an
open question for Sprint 46, not silently resolved either way.

## 6. KPI Dictionary

The full, typed KPI dictionary is `apps/api/src/reporting/reporting-metric-registry.ts`
(`METRIC_REGISTRY`) — this section is its human-readable index. Every entry below
carries, in the source: stable id, display name, business definition, authoritative
source, domain, unit, time basis, supported filters, required permission, drill-down
target (where applicable), availability, and known limitations — enforced present by
`reporting-registry.spec.ts` (e.g. every `BLOCKED_DATA_GAP` metric must carry a
non-empty `limitation`).

| id                                | Display name             | Authoritative source                                                                   | Availability                                                               |
| --------------------------------- | ------------------------ | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `finance.net-revenue`             | Net Revenue              | `FinancialStatementService.getProfitAndLoss().revenue` (GL, net of returns)            | Available                                                                  |
| `finance.gross-profit`            | Gross Profit             | `FinancialStatementService.getProfitAndLoss().grossProfit`                             | Available                                                                  |
| `finance.gross-margin-percent`    | Gross Margin %           | `.grossMarginPercent` (null when revenue is 0)                                         | Available                                                                  |
| `finance.receivables-outstanding` | Receivables Outstanding  | `AccountsReceivableService.getSummary().totalOutstanding`                              | Available                                                                  |
| `finance.receivables-overdue`     | Receivables Overdue      | `.getSummary().totalOverdue`                                                           | Available                                                                  |
| `finance.payables-outstanding`    | Payables Outstanding     | `AccountsPayableService.getSummary().totalOutstanding`                                 | Available                                                                  |
| `finance.payables-overdue`        | Payables Overdue         | `.getSummary().totalOverdue`                                                           | Available                                                                  |
| `inventory.value`                 | Inventory Value          | `InventoryValuationService.getValuation().totals.grandTotal` (moving weighted-average) | Available                                                                  |
| `inventory.low-stock-count`       | Low-Stock Items          | —                                                                                      | **Blocked** — no `reorderPoint`/`minimumStock` field on `Product`          |
| `sales.net-sales-order-count`     | Sales Order Count        | New: direct `SalesOrder.count`, `source=B2B`, `status != DRAFT`                        | Available                                                                  |
| `production.yield-percent`        | Production Yield %       | New: `ProductionOrder.plannedQuantity` vs `ProductionRun.acceptedQuantity`             | Available                                                                  |
| `production.material-cost`        | Production Material Cost | `ProductionMaterialIssueRepository.getTotalWipValue` (GL-sourced)                      | Available — materials only, no labour/overhead                             |
| `hr.active-headcount`             | Active Headcount         | New: `EmployeeRepository.countGroupedByStatus`                                         | Available                                                                  |
| `hr.leave-days-approved`          | Approved Leave Days      | —                                                                                      | **Blocked** — no Leave/LeaveRequest model exists anywhere in this codebase |
| `operations.pending-approvals`    | Pending Approvals        | New: direct `WorkflowStepInstance.count`, `status=ACTIVE`                              | Available                                                                  |
| `operations.overdue-work-orders`  | Overdue Work Orders      | `MaintenanceOverviewService.getOverview().overdueWorkOrders`                           | Available                                                                  |
| `operations.failed-notifications` | Failed Notifications     | New: direct `EmailDelivery`/`WhatsAppDelivery.count`, `status=FAILED`                  | Available                                                                  |

### Inclusion/exclusion rules worth calling out explicitly

- **Net sales is GL-only.** `SalesOrder.total` is never treated as revenue — no
  gross/net distinction exists at the order level (cancellation is a status, not a
  negative amount); returns/credits net out only inside the posted ledger via the
  `SALES_RETURNS` contra-revenue account.
- **Sales Performance filters `source: B2B`** — D2C orders are excluded, not
  double-counted. (A genuine, pre-existing discrepancy was found but NOT fixed this
  sprint: `finance/reports/dashboard.service.ts`'s own `getOperational()` does not
  filter by `source`, so its `salesOrderTotal` commingles B2B and D2C — documented here
  as a known issue for a future sprint, not silently patched, since it sits in
  already-shipped Finance code outside this sprint's scope.)
- **D2C has its own, separate, already-built reporting surface** —
  `D2CAdminService` (`overview`/`attention`/`territories`/`consumers`/`orders`) and
  `D2COperationalExceptionsService`, both pre-existing (Sprints 39/43). Sprint 45
  deliberately does not rebuild D2C reporting (brief §19 "no new D2C features"); the
  coverage matrix below marks D2C as Available via these existing endpoints.
- **`EmploymentStatus.ON_LEAVE`** is a real enum value that no code path in this
  codebase ever writes — excluded from headcount-by-status breakdowns rather than
  shown as a permanently-zero row that would misleadingly imply the figure is tracked.

## 7. Reporting Coverage Matrix

| Domain             | Candidate report                                         | Classification           | Notes                                                                                                                                                                                                                                   |
| ------------------ | -------------------------------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sales              | Sales performance, order status                          | **Delivered**            | New — `sales-performance` report                                                                                                                                                                                                        |
| Sales              | Net sales (true gross/net split at order level)          | Deferred                 | No order-level gross/net distinction exists; GL net revenue is the only authoritative net figure                                                                                                                                        |
| Distribution       | Sales by territory/outlet                                | **Blocked by data gap**  | `SalesOrder` carries no `territoryId`; would require a join + recursive territory-tree descent, judged out of scope this sprint                                                                                                         |
| D2C                | Consumer orders, paid orders, collection status, rewards | Available (pre-existing) | `D2CAdminService`/`D2COperationalExceptionsService` — not rebuilt                                                                                                                                                                       |
| Inventory          | Stock on hand, valuation                                 | **Delivered**            | New wrapper — `inventory-position` report, reusing `InventoryValuationService`                                                                                                                                                          |
| Inventory          | Low-stock/stock-out exceptions                           | **Blocked by data gap**  | No reorder-point field on `Product`                                                                                                                                                                                                     |
| Inventory          | Movement history                                         | Deferred                 | `InventoryTransaction` ledger exists and is queryable; no dedicated report built this sprint                                                                                                                                            |
| Procurement        | Open purchase orders                                     | Deferred                 | Derivable (`status IN (PENDING, PARTIALLY_RECEIVED)`); no dedicated report this sprint                                                                                                                                                  |
| Production         | Planned vs actual, material cost                         | **Delivered**            | New — `production-performance` report                                                                                                                                                                                                   |
| Production         | Labour/overhead cost                                     | **Blocked by data gap**  | No labour/overhead costing exists anywhere in this codebase — materials only                                                                                                                                                            |
| Production         | Unified valued wastage                                   | **Blocked by data gap**  | Rejected-output quantity IS available (`ProductionRun.rejectedQuantity`); a single valued figure across production rejects + inventory adjustments + receiving rejects + return scrap is not (adjustment-based wastage carries no cost) |
| Finance            | Revenue, gross profit, receivables, payables, cash       | Available (pre-existing) | `finance/reports/*` — registered, not rebuilt                                                                                                                                                                                           |
| Accounting         | Posted journals, trial balance                           | Available (pre-existing) | `finance/accounting/*` — registered, not rebuilt                                                                                                                                                                                        |
| Banking            | Bank balances, reconciliation                            | Available (pre-existing) | `finance/cash/*` — registered, not rebuilt                                                                                                                                                                                              |
| Budgeting          | Budget vs actual                                         | Available (pre-existing) | `finance/budgeting/budget-actuals.service.ts` — registered, not rebuilt                                                                                                                                                                 |
| Assets             | Asset register, status counts                            | Deferred                 | No existing aggregation/overview endpoint; `Asset` has count-friendly indexes but no report built this sprint                                                                                                                           |
| Assets             | Asset value / depreciation                               | **Blocked by data gap**  | `usefulLifeMonths`/`salvageValue` are explicitly "foundation only, no depreciation calculated" per the schema's own doc comment; `acquisitionCost` is nullable                                                                          |
| Maintenance        | Work orders, overdue, cost                               | Available (pre-existing) | `MaintenanceOverviewService`/`MaintenanceAnalyticsService` — registered (overdue count) via Operational Exceptions, not rebuilt                                                                                                         |
| HR                 | Headcount, employee status                               | **Delivered**            | New — `workforce-summary` report                                                                                                                                                                                                        |
| HR                 | Attendance                                               | **Delivered**            | New aggregation (none existed before)                                                                                                                                                                                                   |
| HR                 | Leave                                                    | **Blocked by data gap**  | No Leave/LeaveRequest/LeaveBalance model exists anywhere                                                                                                                                                                                |
| Recruitment        | Hiring/vacancy/application pipeline                      | Deferred                 | Data exists; no aggregation/funnel query built this sprint                                                                                                                                                                              |
| Workflow/Approvals | Pending approvals, ageing                                | **Delivered**            | New — part of `operational-exceptions` report                                                                                                                                                                                           |
| Notifications      | Failed deliveries                                        | **Delivered**            | New — part of `operational-exceptions` report                                                                                                                                                                                           |
| Activity           | Recorded business events                                 | Deferred                 | `AuditLog`/`WorkflowEvent` are queryable; no dedicated reporting view built this sprint                                                                                                                                                 |

**7 reports delivered** across Sales, Inventory, Finance (×2), Production, HR, and
Operations (a 3-section composite) — exercising every data type the brief asked for
(currency, count, percent, date, point-in-time, period-accumulated, composite
permission gating).

## 8. API Surface

All routes under `/reporting`, `@UseGuards(JwtAuthGuard, PermissionsGuard)`,
`@RequirePermission('reporting.catalogue.view')` at the controller level, plus each
method's own report-specific permission check inside `ReportingService`:

| Route                                                  | Query params                                                                                 |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `GET /reporting/catalogue`                             | —                                                                                            |
| `GET /reporting/reports/sales-performance`             | `preset`, `customFrom`, `customTo`, `comparison`, `customerId`, `status`, `page`, `pageSize` |
| `GET /reporting/reports/sales-performance/export`      | `preset`, `customFrom`, `customTo`, `comparison`                                             |
| `GET /reporting/reports/inventory-position`            | `locationId`, `productType`, `page`, `pageSize`                                              |
| `GET /reporting/reports/inventory-position/export`     | `locationId`, `productType`                                                                  |
| `GET /reporting/reports/receivables` / `/export`       | —                                                                                            |
| `GET /reporting/reports/payables` / `/export`          | —                                                                                            |
| `GET /reporting/reports/production-performance`        | `preset`, `customFrom`, `customTo`, `comparison`, `productId`, `page`, `pageSize`            |
| `GET /reporting/reports/production-performance/export` | same, minus pagination                                                                       |
| `GET /reporting/reports/workforce-summary`             | `preset`, `customFrom`, `customTo`, `comparison` (not exportable, see §9)                    |
| `GET /reporting/reports/operational-exceptions`        | — (not exportable — no date/filter params apply)                                             |

Every period/pagination query parameter is parsed through
`reportingPeriodQuerySchema`/`reportPaginationSchema` (new, `packages/validation/src/
reporting.ts`) before reaching any service — malformed input is rejected with a 400,
never silently coerced. No client-supplied sort/filter field is ever interpolated into
SQL; `reportSortSchema` validates shape only, and each report service checks the field
name against its own `sortableFields` allowlist (enforced structurally by
`reporting-registry.spec.ts`).

## 9. Export

The audit found **zero** existing CSV/Excel export capability anywhere in
`apps/api/src` — this sprint's `reporting-csv.util.ts` is entirely new, dependency-free
(no `csv`/`xlsx` package added). CSV only; Excel/PDF explicitly deferred per the
brief's own "document the decision rather than expanding the sprint unnecessarily."

Implemented for 5 of 7 reports (Sales Performance, Inventory Position, Receivables,
Payables, Production Performance) — **not** Workforce Summary (three separate tables,
not one tabular dataset; a single combined CSV was judged more confusing than useful
and deferred) or Operational Exceptions (a composite with per-section permission
gating, not a single exportable dataset). `reporting-registry.spec.ts` structurally
enforces that every report marked `exportEligible: true` has a matching controller
`/export` route, preventing the registry/controller from silently drifting apart again
(a bug caught and fixed during this sprint's own implementation — see §12).

Every export re-runs the exact same `ReportingService` permission check as the
interactive report — there is no separate, weaker export authorization path. Formula
injection is neutralized (leading `=`/`+`/`-`/`@`/tab/CR are quote-prefixed, except an
ordinary signed number like `-50`, which is left untouched — 7 dedicated unit tests).
Exports are bounded (1,000–5,000 rows, matching each report's own realistic page-size
ceiling) — never an unbounded full-table dump.

## 10. Performance & Data Freshness

Every report is **live** — no cache, no materialized view, no background job. This
matches the brief's own explicit instruction ("do not add Redis-based reporting
caches, materialized views, a data warehouse... unless the audit demonstrates a
concrete need") — this sprint's data volumes (tens of sales orders, single-digit
production orders, low tens of employees in the seeded tenant) do not demonstrate one.
Every query is tenant-scoped at the database level (`WHERE organisationId = ...`,
never filtered in application memory), uses `groupBy`/`aggregate`/`count` for
summaries rather than fetching full tables, selects only the fields each report needs,
and paginates every detail table. The one N+1-shaped pattern this sprint's own audit
flagged elsewhere (`HrOverviewService`'s in-memory "attendance today" calculation,
`AccountsReceivableService.listByCustomer`'s per-customer repository call) was
deliberately NOT copied into any new Sprint 45 report — the new attendance aggregation
is a single `groupBy`, not a page-and-filter loop.

## 11. Tenant Isolation

Every report service receives `organisationId` as its first argument, resolved
server-side from the JWT (`TokenPayload.organisationId`) — never trusted from a client
query parameter. Every underlying query filters by it. Proven three ways:

1. **Unit** — `reporting.service.spec.ts`'s catalogue/permission tests.
2. **Real PostgreSQL, 6 report types** —
   `reporting-tenant-isolation.integration.spec.ts`, using two real, pre-existing,
   genuinely different seeded organisations ("Boby Bites" and the seeded tenant with
   the next-richest real data footprint). For each of Receivables, Payables, Inventory
   Valuation, Sales Performance, Workforce Summary, and Production Performance, asserts
   the second organisation's result set never contains the first organisation's ids —
   a real, not mocked, proof that a missing `organisationId` filter would be caught
   (if the query had none, Org B's result would contain Org A's rows, failing the
   assertion, even when Org B's own table is empty).
3. **Live, over real HTTP, against the real database** — see §13.

## 12. Errors Found and Fixed During Implementation

- **`reporting.view` was an invalid permission key** — `entry()` requires exactly
  `module.resource.action` (3 segments); `reporting.view` has 2. Caught immediately by
  the full regression suite (4 unrelated test files failed to import at all, since
  `permission-catalogue.ts` throws at module load). Renamed to `reporting.catalogue.
view` everywhere; added `reporting-registry.spec.ts`'s own permission-key validity
  check so this class of bug can never silently recur.
- **`fromLocalDate` (the period-boundary helper) did not actually apply the
  organisation's timezone offset** for sub-day offsets — a Lagos (UTC+1) "today" test
  returned UTC midnight unchanged instead of 23:00 UTC the prior day. Found by the
  period util's own dedicated non-UTC test before any report code consumed it; fixed
  by computing the real wall-clock offset via `Intl.DateTimeFormat` readback rather
  than a same-calendar-day assumption.
- **CSV formula-injection sanitization initially corrupted ordinary negative numbers**
  (`-50` became `'-50`) — caught by a dedicated test; fixed to only escape a leading
  `+`/`-` when the value isn't a plain signed number.
- **`workforce-summary` was marked `exportEligible: true` in the registry with no
  matching export route actually built** — caught by writing the frontend page (the
  `ExportButton` would have pointed at a 404) before any user-facing testing; fixed by
  marking it `false` with a documented reason, and adding a structural test
  (`reporting-registry.spec.ts`) that now fails the build if this ever recurs for any
  report.

## 13. Live Verification (Real Database, Real HTTP, Real Browser)

Performed against the real compiled API (`nest build` + `node dist/main.js`) and the
real Next.js production build, both against the real Boby Bites PostgreSQL database —
not simulated.

- **Catalogue, permission-filtered, real**: Owner's real catalogue response listed
  every metric/report; the seeded Member account's real response listed exactly the
  one report (`sales-performance`) its one granted permission allows.
- **Every report endpoint, real data**: Receivables (₦11,195,800 total outstanding,
  4 real customers with correct aging buckets), Payables (₦5,045,000, Fresh Farms
  Ltd), Inventory Position (₦2,238,474 grand total across 8 real products), Sales
  Performance (₦15,945,800 net revenue, 14 real B2B orders, correctly excluding D2C),
  Production Performance (700 produced / 685 accepted / 15 rejected, ₦298,200
  material cost, per-order yield %), Workforce Summary (10 active / 14 total
  headcount, real department breakdown with "Unassigned" handled), Operational
  Exceptions (18 real pending approvals with real ageing up to 22 days, 0 overdue
  maintenance, 23 real failed notifications split 3 email / 20 WhatsApp).
- **Permission enforcement, real HTTP**: Member correctly received `403 Forbidden`
  (`"You are not authorized to view this report (finance.reports.view)."`) from
  Receivables; correctly received real data from Sales Performance; correctly received
  `{pendingApprovals: null, overdueMaintenanceCount: null, failedNotifications: null}`
  from Operational Exceptions.
- **Frontend, real browser, logged in as the real seeded Owner account**: `/reports`
  landing page rendered the real, permission-filtered catalogue grouped by domain;
  every report page navigated to rendered the exact same figures the direct API calls
  returned; switching the period preset to "This Year" correctly re-fetched and
  displayed the real 14-order dataset; switching comparison to "vs. previous year"
  correctly displayed "No comparison data" (Boby Bites has zero 2025 activity) instead
  of a misleading 0%; the CSV export button fired a real, correctly-parameterized
  request that returned `200 OK`.
- **CSV content, real, via direct curl**: `receivables/export` returned genuine,
  correctly-escaped CSV rows matching the interactive report exactly.

## 14. Testing

- **Unit**: 79 tests across the period utility (21, including the non-UTC timezone
  fix), CSV utility (7, including the injection-sanitization fix), both registries (9
  structural checks), the independence guard (5, see below), `ReportingService` (10,
  covering catalogue filtering, permission enforcement, and the 3-way independent
  section-omission logic), and five report services (Sales Performance, Production
  Performance, Workforce Summary, Operational Exceptions, Inventory Position — 27
  tests covering B2B filtering, null-safe percentage/yield math, the "Unassigned"
  department bucket, ageing/overdue logic, comparison-period math, and pagination).
- **Integration (real PostgreSQL)**: 7 tests in
  `reporting-tenant-isolation.integration.spec.ts` (6 report types × cross-tenant
  non-overlap, proven with 2 real pre-existing organisations).
- **Independence guard**: `reporting-independence.spec.ts` (5 structural checks) —
  no reporting file writes any business table, calls `postSystemJournalEntry`, imports
  a domain service beyond the explicit, documented, newly-exported set, or imports
  Sales/Inventory/Workflow/Notifications modules directly; no domain module imports
  `ReportingModule` back.
- **Live**: §13 above — the single most direct proof the whole stack works end to end.

## 15. Known Limitations & Deferred Work

See §7 for the full classification. Summary of what's deliberately NOT built this
sprint: distribution-by-territory/outlet (no `territoryId` on `SalesOrder`), low-stock
indicators (no reorder-point field), labour/overhead production costing, unified
valued wastage, Leave reporting (no Leave model at all), Asset value/depreciation (no
calculation exists), Recruitment funnel aggregation, Activity-feed reporting, Excel/PDF
export, any caching/materialized-view infrastructure, and the Executive Dashboard
itself (explicitly Sprint 46's objective, per the brief).

## 16. How to Register a New Metric or Report

Add one entry to `METRIC_REGISTRY` (`reporting-metric-registry.ts`) or
`REPORT_REGISTRY` (`reporting-report-registry.ts`) — both are plain typed arrays, no
code generation, no registration call elsewhere needed. `reporting-registry.spec.ts`
enforces the entry is well-formed (unique id, a real permission key, a real drill-down
target, and — for a report — that `exportEligible: true` has a matching controller
route) before it can ship. To change a metric's calculation, change the ONE service
method it names in `authoritativeSource` — every consumer (its own report, any future
drill-down, any future Executive Dashboard card) reads through that same call, so there
is no second place to update.
