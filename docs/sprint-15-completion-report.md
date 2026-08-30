# Sprint 15 Completion Report — Cashflow Management & Forecasting

## 1. Objective

Answer the question every prior sprint's reporting layer leaves unanswered:
**how much cash are we likely to have next month, and when might we run
short?** Sprint 13 built read-only Financial Statements (what happened).
Sprint 14 connected the General Ledger to real cash/bank accounts and built
reconciliation (what we have, right now). Neither is forward-looking. Sprint 15
is that layer — governed by the brief's own repeated architectural instruction:
**do not create another accounting system.** This is explicitly **not**
budgeting (a different question — "what do we plan to earn/spend" vs. "when
will money actually move") and explicitly not a loan/investment/capital
management module, though its source-type model is designed to extend to one
later without a redesign.

```
Sales / Procurement / Production / Inventory / Finance ──▶ General Ledger
                                                                  │
                                          CashAccount (Sprint 14) ◀┘ (Book Balance)
                                                │
                       Invoice / SupplierInvoice outstanding balances (Sprint 13 aging queries)
                                                │
                              CashflowForecastItem / CashflowScenario /
                              CashflowForecastAdjustment / CashflowSettings
                                                │
                                    Cashflow Forecast (never stored —
                                    recomputed live on every request)
                                                │
                                (future) Loan / Investment / Capital Intelligence
```

The brief's own final instruction was explicit: **inspect the repository and
produce an implementation plan before writing code.** Before any code was
written, `InvoiceRepository.getOutstandingForAging()` and
`SupplierInvoiceRepository.getOutstandingForAging()` (both built in Sprint 13)
were read directly and confirmed to be ready-made, zero-modification-needed raw
material for the forecast engine; `CashAccountRepository.
findManyByOrganisation()`/`LedgerService.getAccountActivity()` (Sprint 14) were
confirmed as the Book Balance primitive. A full plan
(`/Users/user/.claude/plans/deep-giggling-shell.md`) was written and approved
before implementation began.

## 2. Architecture Decisions

| #   | Question                                        | Decision                                                                                                                                                                                                                    |
| --- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Module home                                     | `apps/api/src/finance/cashflow/`, folded into the existing `FinanceModule` — the `accounting/`/`reports/`/`cash/` precedent. No new module imports needed.                                                                  |
| 2   | Is the forecast ever stored?                    | **Never.** Every response is computed live from `Invoice`/`SupplierInvoice`/`CashAccount` plus four new raw-input models — the same "derive, never store" discipline as Sprint 13/14.                                       |
| 3   | New models — minimum set                        | Four: `CashflowForecastItem`, `CashflowScenario`, `CashflowForecastAdjustment`, `CashflowSettings`. AR/AP items are never stored as forecast rows, so double-counting is structurally impossible, not merely de-duplicated. |
| 4   | `CashflowForecastItem` — recurring vs. one-time | A single `recurrence` enum covers both. `sourceType` (`RECURRING_ITEM`/`MANUAL_FORECAST`) is server-derived from `recurrence`, never a separate input.                                                                      |
| 5   | Confidence classification                       | Server-derived: AR → `CONFIRMED`; AP/recurring → `EXPECTED`; manual → `ESTIMATED` — matching the brief's own worked examples exactly.                                                                                       |
| 6   | Overdue invoices                                | Bucketed at `max(dueDate, today)` — an overdue invoice still lands in the first bucket rather than being silently dropped.                                                                                                  |
| 7   | `CashflowScenario` shape                        | Four numeric knobs (inflow/outflow delay days + multiplier), not a rules engine. Base is the identity scenario.                                                                                                             |
| 8   | `CashflowForecastAdjustment` scope              | Targets only an AR/AP source item, never a `CashflowForecastItem`. At most one per source, upserted via `PUT`. Never writes to the underlying `Invoice`/`SupplierInvoice`.                                                  |
| 9   | Bucketing                                       | Weekly: 7-day buckets from today. Monthly: partial-first-month then full calendar months. Drill-down items included inline in the same response.                                                                            |
| 10  | Cash-account-level forecast                     | Two distinct computations (consolidated vs. per-account), never one query implying money can move between accounts — AR/AP is excluded from any single account's own view.                                                  |
| 11  | Minimum reserve / default delays                | `CashflowSettings`, one row per organisation, Owner/Administrator write, any-authenticated read.                                                                                                                            |
| 12  | Shortfall detection                             | Per-bucket boolean + top-level `shortfallDetected`/`lowestProjectedCash`. Wording never implies insolvency.                                                                                                                 |
| 13  | Idempotency                                     | Item/Scenario `create()` and the Adjustment `PUT` all idempotency-check-first, per the Sprint 9/10 lesson.                                                                                                                  |
| 14  | Structural guard                                | New `cashflow-independence.spec.ts` — zero `postSystemJournalEntry` calls anywhere in the module, no forbidden-table writes, no Sales/Inventory/Procurement/Production imports.                                             |
| 15  | RBAC                                            | Any-authenticated read; Owner/Administrator write — identical to Cash & Bank (Sprint 14).                                                                                                                                   |
| 16  | Frontend routes                                 | Three flat tabs under `/settings/finance`: Cashflow (dashboard), Cashflow Items, Cashflow Scenarios. Per-invoice adjustments surfaced inline, not a separate page.                                                          |
| 17  | Chart                                           | `recharts` (already a Sprint 13 dependency) — a closing-balance-vs-minimum-reserve chart and an inflows-vs-outflows-per-period chart. Two charts total, not an analytics platform.                                          |

## 3. Database Changes (one additive migration)

New enums: `CashflowDirection`, `CashflowRecurrence`, `CashflowItemStatus`,
`CashflowForecastSourceType`. (`CashflowConfidence` is computed in API
responses only — never a stored column.)

New models: `CashflowForecastItem`, `CashflowScenario`,
`CashflowForecastAdjustment`, `CashflowSettings` — see
`docs/domains/cashflow.md` §3/§5/§6/§9 for the full field list.

No changes to any existing model. No new `SYSTEM_ACCOUNT_KEYS` — this domain
posts nothing.

## 4. API

| Endpoint                                                            | Auth              | Notes                                                               |
| ------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------- |
| `GET/PUT /api/finance/cashflow/settings`                            | Any / Owner+Admin | Minimum reserve, default delay days                                 |
| `GET/POST /api/finance/cashflow/items`                              | Any / Owner+Admin | `sourceType` server-derived, idempotency-first                      |
| `PATCH /api/finance/cashflow/items/:id`                             | Owner+Admin       |                                                                     |
| `POST /api/finance/cashflow/items/:id/activate` \| `/deactivate`    | Owner+Admin       |                                                                     |
| `GET/POST /api/finance/cashflow/scenarios`                          | Any / Owner+Admin |                                                                     |
| `PATCH /api/finance/cashflow/scenarios/:id`                         | Owner+Admin       |                                                                     |
| `POST /api/finance/cashflow/scenarios/:id/deactivate`               | Owner+Admin       |                                                                     |
| `GET /api/finance/cashflow/adjustments` \| `/:sourceType/:sourceId` | Any authenticated |                                                                     |
| `PUT /api/finance/cashflow/adjustments`                             | Owner+Admin       | Upsert by `(sourceType, sourceId)`; never touches the source record |
| `GET /api/finance/cashflow/forecast`                                | Any authenticated | `horizonDays`/`bucketBy`/`scenarioId`/`cashAccountId` query params  |
| `GET /api/finance/cashflow/accounts/breakdown`                      | Any authenticated | Per-cash-account projected closing balances                         |

## 5. Backend Implementation

- **`apps/api/src/finance/cashflow/`** — `cashflow-settings.repository.ts`/
  `.service.ts`/`.controller.ts`, `cashflow-item.repository.ts`/`.service.ts`/
  `.controller.ts`, `cashflow-scenario.*`, `cashflow-adjustment.*`,
  `cashflow-forecast.service.ts` (the engine — `getForecast()`,
  `getCashAccountBreakdown()`, plus exported pure helpers `expandRecurrence()`/
  `stepRecurrence()`/`buildBuckets()`) + `.controller.ts`,
  `cashflow-independence.spec.ts`, plus a `*.repository.spec.ts`/
  `*.controller.spec.ts`/`.service.spec.ts` per aggregate and the forecast
  engine's own large spec file.
- **`apps/api/src/finance/cashflow-audit-actions.ts`** — `CASHFLOW_AUDIT_ACTIONS`,
  the same `<entity>.<event>` convention as `cash-bank-audit-actions.ts`.
- **`apps/api/src/finance/finance.module.ts`** — registered the 5 new
  controllers/services/repositories; extended its own doc comment with this
  sprint's boundary/reuse reasoning.
- **`packages/validation/src/cashflow.ts`** (new) — Zod schemas for every write
  body, including `cashflowForecastQuerySchema` (coerced/defaulted query
  params).
- **`apps/api/prisma/seed.ts`** — `seedCashflowFixtures()`: an AR invoice
  (`CF-INV-0001`, ₦8,000,000, due in 14 days), an AP supplier invoice
  (`CF-SINV-0001`, ₦5,000,000, due in 10 days, posted via a genuine Path B line
  against Raw Materials), three `CashflowForecastItem`s (monthly Factory Rent
  ₦1,500,000; a one-time ₦4,000,000 manual expected collection; a deliberately
  large one-time ₦20,000,000 Planned Equipment Payment 45 days out — chosen to
  guarantee a real, demonstrable shortfall regardless of the dev database's own
  accumulated live-testing cash balance, while leaving earlier buckets
  healthy), three `CashflowScenario`s (Base/Conservative/Optimistic), and one
  `CashflowSettings` row (minimum reserve ₦5,000,000) — gated on a single
  upfront existence check, run twice to confirm idempotency.

## 6. Frontend Implementation

- **`apps/web/src/components/app/finance-tabs.tsx`** — 3 new tabs (Cashflow,
  Cashflow Items, Cashflow Scenarios).
- **`.../cashflow/page.tsx`** — the dashboard: shortfall warning banner, 5
  summary cards, horizon (30/60/90/180/365) + weekly/monthly + scenario
  selectors, a closing-balance-vs-minimum-reserve chart (shortfall buckets
  tinted), an inflows-vs-outflows-per-period chart, inflow/outflow breakdown by
  source, a click-to-expand per-period table with an inline drill-down table of
  individual source items, an inline "Adjust" action on every AR/AP-sourced
  drill-down row, and a cash-account-level breakdown section.
- **`.../cashflow-items/page.tsx`** + `cashflow-item-dialog.tsx` +
  `cashflow-settings-dialog.tsx` — list, create, deactivate/activate, and the
  `CashflowSettings` summary card with an edit dialog.
- **`.../cashflow-scenarios/page.tsx`** + `cashflow-scenario-dialog.tsx` —
  list, create/edit, deactivate.
- **`.../finance/api.ts`/`labels.ts`** — a new `// === Cashflow Management
(Sprint 15) ===` section.

## 7. Accounting Rules

None. This domain posts nothing — see `docs/domains/cashflow.md` §10 for the
full list of what it never does, enforced structurally by
`cashflow-independence.spec.ts`.

## 8. Tests

`cashflow-forecast.service.spec.ts` (32 tests — the core engine): opening
balance from consolidated accounts; AR inflow inclusion/exclusion (zero-
outstanding excluded, partial-paid uses outstanding); AP outflow mirror;
overdue-invoice-lands-in-bucket-1; closing carried correctly across buckets;
weekly bucket count; monthly partial-first-bucket; every horizon (30/60/90/180/ 365) parametrized; recurring MONTHLY items expand correctly; `ONE_TIME` exactly
once with `ESTIMATED` confidence; `expandRecurrence()` unit-tested for all 5
recurrence types plus `recurrenceEndDate` boundary respect; adjustments
override date/amount without exercising any write path against the source;
scenarios (Base unchanged, Conservative pushing an item outside the horizon,
Optimistic's multiplier applied exactly, scenario isolation); minimum reserve
no-warning/warning/shortfall/lowestProjectedCash; cash-account consolidated-sum
vs. per-account (AR/AP correctly excluded from the per-account view).
`cashflow-item.repository.spec.ts`/`cashflow-scenario.repository.spec.ts`/
`cashflow-adjustment.repository.spec.ts`/`cashflow-settings.repository.spec.ts`
(sourceType derivation, idempotent replay, upsert-not-duplicate, tenant
scoping). Controller specs per aggregate (tenant isolation,
`wasCreated`-gated audit emission). New `cashflow-independence.spec.ts` (5
tests): no forbidden-table writes across all 14 cashflow files; zero
`postSystemJournalEntry` calls anywhere in the module; no Sales/Inventory/
Procurement/Production import; `FinanceModule` still never imports
`InventoryModule`; only the 4 repository files ever write their own
`Cashflow*` tables. Full monorepo quality gate: `prisma validate`, `lint`,
`type-check`, `test`, and `build` (both `apps/api` and `apps/web`), all green.
**110 test suites / 953 tests, all passing** (up from 99/892 before this
sprint). Seed run twice consecutively with identical row counts (3
`CashflowForecastItem`s, 3 `CashflowScenario`s, 1 `CashflowSettings` row),
confirming idempotency.

## 9. Live Verification Performed

Using the actual running API (`nest start --watch`) and web (`next dev`) apps,
logged in as the seeded Owner account. A stale, pre-Sprint-15 compiled `dist`
API process (the same recurring pattern noted in every prior sprint's own
report) was found squatting port 4000 and had to be killed before the real dev
server would bind; the web dev server's own `.next` cache was also corrupted by
an intermediate production-build run and required a clean restart.

1. **The exact brief worked scenario.** The Cashflow dashboard loaded with
   Current Cash ₦13,388,000.00 (the live database's real, accumulated Cash
   Account book balance — matching Sprint 14's own live-verification total
   exactly), Expected Inflows ₦15,195,800.00 (`CF-INV-0001`'s ₦8,000,000 +
   the ₦4,000,000 manual collection + other pre-existing outstanding AR),
   Expected Outflows ₦29,545,000.00 (`CF-SINV-0001`'s ₦5,045,000 in AP +
   ₦20,000,000 Planned Equipment Payment + ₦4,500,000 in recurring rent
   occurrences across the 90-day horizon).
2. **Week-by-week bucket math confirmed by hand.** Week 3's inflow of
   exactly ₦12,000,000.00 was independently verified as `CF-INV-0001`'s
   ₦8,000,000 (due day 14, landing in the day 14-20 bucket) plus the manual
   ₦4,000,000 collection (day 20, same bucket) — both landing in the same
   bucket exactly as the brief's own worked scenario implies.
3. **Shortfall detection, visually and numerically.** The closing-balance
   chart showed healthy pink bars for weeks 1-6 (all above the ₦5,000,000
   dashed minimum-reserve line), then every bucket from Week 7 onward (the
   bucket the ₦20,000,000 equipment payment lands in) flipped to a
   below-zero red bar. Week 7's own row showed Opening ₦20,538,800.00 −
   Outflow ₦20,000,000.00 = Closing ₦538,800.00, correctly flagged "Below
   Reserve." Both a healthy forecast and a real projected shortfall were
   demonstrated in the same, single scenario, exactly as required.
4. **Confidence labelling matched the brief's own worked examples.**
   `CF-INV-0001`'s drill-down row showed source "Customer Receivable,"
   confidence **Confirmed**. The manual ₦4,000,000 collection showed source
   "Manual Forecast," confidence **Estimated**. The Planned Equipment
   Payment showed the same. No "Adjust" action was offered on either manual
   item (only AR/AP-sourced rows are adjustable, correctly enforced by the
   UI).
5. **Forecast adjustment — the load-bearing non-negotiable.** Clicked
   "Adjust" on `CF-INV-0001`'s drill-down row, changed its expected
   collection date from 12/09/2026 to 25/09/2026 and its amount from
   ₦8,000,000 to ₦7,500,000, saved. The forecast recomputed live: the item
   moved out of Week 3 into Week 4, Week 3's inflow dropped to
   ₦4,000,000.00 (only the manual collection remaining), Week 4's inflow
   became ₦7,657,000.00 (the adjusted ₦7,500,000 plus an existing
   ₦157,000). **Immediately after**, the Invoices list was checked directly:
   `CF-INV-0001` still showed its original, completely untouched
   ₦8,000,000.00 total and `Issued` status. The Trial Balance was checked
   next and still balanced exactly (₦35,242,388.00 = ₦35,242,388.00). The
   audit log was queried directly against the database and showed exactly
   one new row, `cashflow.forecast-adjustment.created` — proving the
   adjustment is real, persisted, and audited, while the source invoice and
   every accounting balance remained provably unchanged.
6. **Scenario switching.** Selecting "Optimistic" (1.15× inflow multiplier)
   changed Forecast Closing Cash from -₦961,200.00 (Base) to +₦743,170.00
   live, with no Finance record touched (confirmed by the same Trial
   Balance/Invoice checks in step 5 already having been performed
   immediately prior on the same underlying data).
7. **RBAC, live against the real API.** `GET /finance/cashflow/forecast`
   with a Member JWT returned `200`. `POST /finance/cashflow/items` with the
   same Member JWT returned `403 Forbidden` ("You do not have permission to
   perform this action"). An unauthenticated request to the forecast
   endpoint returned `401`.
8. **Cashflow Items and Cashflow Scenarios pages.** Both list pages rendered
   correctly with their respective dialogs; the Scenarios table showed
   Base/Conservative/Optimistic with their exact seeded knob values
   (0d/1.00×/0d/1.00×, 30d/0.80×/0d/1.00×, 0d/1.15×/0d/1.00×).
9. **Responsive check at 375px.** Summary cards, both charts (via
   `ResponsiveContainer`), and the per-period bucket rows all collapsed to a
   single usable column. One real bug was found and fixed during this
   check: the bucket row's inflow/outflow/closing/"Below Reserve"-badge
   group had no `flex-wrap`, causing the badge to overflow off-screen at
   375px — fixed by adding `flex-wrap` + `gap-y-1` to that row
   (`apps/web/src/app/(app)/settings/finance/cashflow/page.tsx`), re-verified
   visually after the fix, and re-confirmed clean via `tsc --noEmit` and
   `eslint`.
10. **Zero new browser console errors** after re-authentication (a batch of
    stale 401s/404s from the mid-session dev-server restarts, described
    above, were confirmed not to recur against the running application).

## 10. Known Limitations

- **The forecast is never persisted** — every response is computed live; this
  is a deliberate design choice (§2 above), not an oversight, but means very
  large organisations with a huge number of outstanding invoices/items would
  see this cost repeated on every request rather than cached. No caching layer
  was added, per the brief's own "no premature caching" instruction.
- **Per-account forecasts exclude AR/AP** — `Invoice`/`SupplierInvoice` carry
  no `cashAccountId`, so a single cash account's own bucketed view only shows
  `CashflowForecastItem`s explicitly assigned to it; AR/AP appears only in the
  consolidated, org-wide view. Documented, not silently guessed.
- **No configurable module-level permission engine** — RBAC remains binary
  (Owner/Administrator write, Member read), the same deferred decision as
  every other domain in this codebase.
- **No loan/debt/investment/capital management, budgeting, budget-vs-actual,
  AI/ML forecasting, credit scoring, expense management, payroll, bank API/
  Open Banking/payment gateway integration, treasury management, or advanced
  financial modelling** — all explicit brief non-goals, unchanged.

## 11. Deferred / Future Work

- Loan/Investment/Capital management — the `CashflowForecastSourceType` model
  is designed to add a value like `LOAN_PROCEEDS` without a schema redesign.
- A configurable-permission RBAC model — the same deferred decision as every
  prior sprint.
- CSV/print export of a forecast, the same cheap follow-up pattern Sprint 13
  established for its own reports.

## 12. Documentation Updated

`docs/domains/cashflow.md` (new — full domain writeup), `docs/domains/
finance.md` (header cross-references, new §15 "Cashflow Management &
Forecasting (Sprint 15)"), `docs/domains/accounting.md` (new §20 "Cashflow
Management (Sprint 15)", renumbered API Reference/Known Limitations sections
up by one), `docs/domains/cash-management.md` (§11 cross-reference to the now-
built Cashflow domain), `docs/domains/README.md` (new Cashflow Management row),
`docs/backlog.md` (Epic 18/19 updates, Current Sprint Status), `docs/
roadmap.md` (new Cashflow Management bullet), `docs/changelog.md` (new dated
entry), root `README.md` (feature list update), this completion report.

## 13. Constraint

Per this session's established convention, nothing in this sprint's work has
been committed or pushed — that remains the user's own explicit instruction to
give.
