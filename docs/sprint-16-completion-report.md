# Sprint 16 Completion Report — Budgeting & Financial Planning Foundation

## 1. Objective

Answer the question none of Sprints 13-15 answer: what did we plan to earn
and spend, and how does reality compare? Sprint 13 gave read-only historical
understanding. Sprint 14 gave real cash visibility. Sprint 15 gave a
never-persisted forward cash forecast. Sprint 16 adds the planning layer —
governed by the same repeated architectural instruction as every prior
Finance sprint: **do not create another accounting system.** The General
Ledger remains the sole source of "actual"; a `Budget` holds only planned
amounts and is compared against the ledger and the Cashflow Forecast live, on
every request, never duplicated into budget tables.

```
Sales / Procurement / Production / Inventory / Finance ──▶ General Ledger
                                                                  │
                              Cash Accounts (Sprint 14) ◀────────┘
                                                │
                              Cashflow Forecast (Sprint 15, never persisted)
                                                │
                    Budget / BudgetLine / CostCentre (Sprint 16, planned only)
                                                │
                          Budget vs Actual  ·  Budget vs Forecast
                                                │
                                (future) Loan / Investment / Capital Intelligence
```

Before any code was written, the current schema and Sprint 13/14/15
implementations were inspected directly: `Organisation.fiscalYearStart`
(added Sprint 3.4, never consumed by any domain before this sprint) was
confirmed as the fiscal-year source of truth; the seeded Chart of Accounts
was confirmed to have **no Fixed Asset/PP&E row** anywhere, settling how
CAPEX lines must work (§6 of the domain doc); `LedgerService`'s exported
`getAccountBalances()` and `FinancialStatementService`'s own normal-balance-
sign convention were confirmed as the exact primitive Budget vs Actual needs;
Sprint 15's `CashflowForecastService`/`CashflowScenario` were confirmed as
directly reusable for Budget vs Forecast. A full plan
(`/Users/user/.claude/plans/deep-giggling-shell.md`) was written and approved
before implementation began.

## 2. Architecture Decisions

| #   | Question                                       | Decision                                                                                                                                                                                                                                                                                                       |
| --- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Module home                                    | `apps/api/src/finance/budgeting/`, folded into `FinanceModule`. One new intra-module dependency (`CashflowForecastService`/`CashflowScenarioRepository`) — no new NestJS module import needed.                                                                                                                 |
| 2   | Is a budget ever "actualized" into the ledger? | **Never.** Every "actual" figure is read live from `JournalEntryLine`. Zero `postSystemJournalEntry` calls anywhere — proven by `budgeting-independence.spec.ts`.                                                                                                                                              |
| 3   | Versioning                                     | No separate `BudgetVersion` table — a `Budget` row is its own version (`version`, `revisesBudgetId`). Activating a revision supersedes the row it replaces, never overwrites it.                                                                                                                               |
| 4   | Scenarios                                      | No separate `BudgetScenario` table — a `Budget` row is its own scenario (`scenarioName`). A sibling row with a different name is an independent what-if plan, never touching another scenario's lines.                                                                                                         |
| 5   | Lifecycle                                      | `DRAFT → APPROVED → ACTIVE → CLOSED`, plus `SUPERSEDED` (an automatic side-effect of activating a revision). No `SUBMITTED` step — unnecessary with a single approving role.                                                                                                                                   |
| 6   | `BudgetLine` — CAPEX vs. Revenue/OpEx          | `lineType` is user-declared, never derived from account type. `chartOfAccountId` required for Revenue/OpEx, optional for CAPEX (no Fixed Asset account exists yet). One unique constraint gives both upsert-per-cell and unlimited-discrete-CAPEX-items behaviour for free, via Postgres's own NULL semantics. |
| 7   | Budget vs Actual — the query shape             | One `journalEntryLine.findMany`, scoped to the budget's own referenced accounts and date range — never per-line, never per-month, never a whole-ledger scan.                                                                                                                                                   |
| 8   | Variance / Favourability                       | `variance = actual − budget`; null-safe `variancePercent`; `favourable` is a per-`lineType` sign flip (Revenue: higher is good; OpEx/CAPEX: lower is good).                                                                                                                                                    |
| 9   | Budget vs Forecast                             | Calls Sprint 15's `CashflowForecastService.getForecast()` directly, `bucketBy: 'monthly'`, the budget's own optional `cashflowScenarioId` passed straight through — zero duplicated forecast logic.                                                                                                            |
| 10  | Cost Centres                                   | A new, small, standalone `CostCentre` master — a pure budget-line tag, never linked to the Chart of Accounts.                                                                                                                                                                                                  |
| 11  | Fiscal year integration                        | `Organisation.fiscalYearStart` drives `computeFiscalYearRange()` (pure, unit-tested) at `Budget.create()` time; the resulting range is stored, never recomputed later. Quarterly/annual totals are pure read-time aggregation.                                                                                 |
| 12  | Idempotency                                    | `Budget.create()` and `BudgetLine` upserts both idempotency-check-first, per the Sprint 9/10 lesson.                                                                                                                                                                                                           |
| 13  | RBAC                                           | Identical binary convention: any-authenticated read, Owner/Administrator write.                                                                                                                                                                                                                                |
| 14  | Structural guard                               | New `budgeting-independence.spec.ts` — zero `postSystemJournalEntry` calls, no forbidden-table writes (including every Cashflow/Cash table), no Sales/Inventory/Procurement/Production imports.                                                                                                                |
| 15  | Frontend routes                                | Two new flat tabs — Budgets (list + create) and Cost Centres. Budget detail is its own page (`/settings/finance/budgets/[id]`), not a tab — the Cash Account Detail precedent for "too much content for a dialog."                                                                                             |

## 3. Database Changes (one additive migration)

New enums: `BudgetStatus`, `BudgetLineType`, `CostCentreStatus`.

New models: `Budget`, `BudgetLine`, `CostCentre` — see
`docs/domains/budgeting.md` §3/§5/§6/§7 for the full field list.

No changes to any existing model's own fields (only new back-relations). No
new `SYSTEM_ACCOUNT_KEYS` — this module posts nothing.

## 4. API

| Endpoint                                       | Auth              | Notes                                                                               |
| ---------------------------------------------- | ----------------- | ----------------------------------------------------------------------------------- |
| `GET/POST /api/finance/budgets`                | Any / Owner+Admin | `POST` derives `startDate`/`endDate` from `fiscalYear` + org config                 |
| `GET /api/finance/budgets/:id`                 | Any authenticated |                                                                                     |
| `GET /api/finance/budgets/:id/siblings`        | Any authenticated | Every row sharing this budget's own `budgetCode`+`fiscalYear`                       |
| `PATCH /api/finance/budgets/:id`               | Owner+Admin       | `DRAFT` only                                                                        |
| `POST /api/finance/budgets/:id/approve`        | Owner+Admin       | `DRAFT` → `APPROVED`                                                                |
| `POST /api/finance/budgets/:id/activate`       | Owner+Admin       | `APPROVED` → `ACTIVE`; supersedes the prior `ACTIVE` row in the lineage             |
| `POST /api/finance/budgets/:id/close`          | Owner+Admin       | `ACTIVE` → `CLOSED`                                                                 |
| `POST /api/finance/budgets/:id/revise`         | Owner+Admin       | Creates the next version, `DRAFT`, copying every current line                       |
| `GET/POST /api/finance/budgets/:id/lines`      | Any / Owner+Admin | `POST` upserts per decision #6; `DRAFT`-budget only                                 |
| `PATCH /api/finance/budgets/:id/lines/:lineId` | Owner+Admin       | `DRAFT`-budget only                                                                 |
| `GET /api/finance/budgets/:id/vs-actual`       | Any authenticated | Never stored, recomputed every call                                                 |
| `GET /api/finance/budgets/:id/vs-forecast`     | Any authenticated | Composes Sprint 15's forecast; `{applicable: false}` once the fiscal year has ended |
| `GET/POST /api/finance/cost-centres`           | Any / Owner+Admin |                                                                                     |

## 5. Backend Implementation

- **`apps/api/src/finance/budgeting/`** — `fiscal-year.ts` (pure helpers),
  `budget.repository.ts`/`.service.ts`/`.controller.ts`,
  `budget-line.repository.ts`/`.service.ts`, `budget-actuals.service.ts`,
  `budget-forecast.service.ts`, `cost-centre.repository.ts`/`.service.ts`/
  `.controller.ts`, `budgeting-independence.spec.ts`, plus a `*.spec.ts` per
  repository/service/controller.
- **`apps/api/src/finance/budgeting-audit-actions.ts`** —
  `BUDGETING_AUDIT_ACTIONS`, the same `<entity>.<event>` convention as
  `cashflow-audit-actions.ts`.
- **`apps/api/src/finance/finance.module.ts`** — registered the 2 new
  controllers + 8 new services/repositories; extended its own doc comment.
- **`packages/validation/src/budgeting.ts`** (new) — Zod schemas for every
  write body.
- **`apps/api/prisma/seed.ts`** — `seedBudgetingFixtures()`: 7 Cost Centres
  (Production, Procurement, Sales, Distribution, Finance, Administration,
  Marketing); a "2026 Operating Budget" (Base, `ACTIVE`) with 12 months of
  Revenue (₦3,000,000/month against `4100 Product Sales`) and Operating
  Expense lines (Salaries ₦600,000, Utilities ₦120,000, Rent ₦1,500,000 —
  deliberately matching Sprint 15's own seeded Factory Rent figure so Budget
  vs Forecast reads coherently — and Transport ₦80,000, each per month), plus
  two CAPEX items (New Packaging Machine ₦8,000,000 in June, Delivery Van
  ₦3,500,000 in September); a "Growth" sibling scenario (`DRAFT`, revenue
  +30% at ₦3,900,000/month) — gated on the Base budget already existing, run
  twice to confirm idempotency (122 budget lines, identical count on
  replay).

## 6. Frontend Implementation

- **`apps/web/src/components/app/finance-tabs.tsx`** — 2 new tabs (Budgets,
  Cost Centres).
- **`.../budgets/page.tsx`** + `budget-dialog.tsx` — list with an Overview
  strip (Revenue/OpEx/CAPEX Budget vs. Actual vs. Variance, sourced from the
  currently `ACTIVE` budget's own vs-actual report — a deliberate
  simplification over aggregating multiple simultaneously-active budgets,
  documented as a known limitation below) and a create dialog (budget code,
  name, fiscal year, scenario name, optional Cashflow Scenario pairing —
  `startDate`/`endDate` never entered directly).
- **`.../budgets/[id]/page.tsx`** — the detail page: header with status-
  gated lifecycle actions (Approve/Activate/Close/Revise), a monthly grid per
  `lineType` (editable cells while `DRAFT`, with an inline "Add Line" form
  for new accounts and quarterly/annual totals computed client-side), a
  CAPEX section (discrete items + an inline add form), Budget vs Actual (a
  variance table with a Favourable/Unfavourable badge), Budget vs Forecast (a
  budgeted-vs-forecast-expenditure bar chart, reusing the `recharts` pattern
  from Sprint 13/15, plus a shortfall-flagged table), and a Scenario
  Comparison table when sibling budgets exist.
- **`.../cost-centres/page.tsx`** + `cost-centre-dialog.tsx` — a direct
  structural clone of Sprint 15's `cashflow-scenarios` page.
- **`finance/api.ts`/`labels.ts`** — a new `// === Budgeting & Financial
Planning (Sprint 16) ===` section.

## 7. Accounting Rules

None. This domain posts nothing — see `docs/domains/budgeting.md` §2 and
`docs/domains/accounting.md` §23 for the full statement, enforced
structurally by `budgeting-independence.spec.ts`.

## 8. Tests

`fiscal-year.spec.ts` (10 tests): January-start and offset (April-start,
December-start) fiscal years, monthly period generation, month-truncation,
month-within-range boundary checks. `budget.repository.spec.ts` (4 tests):
idempotent create replay, activation superseding the prior `ACTIVE` row in
the lineage, revision preserving the original while copying its lines,
tenant isolation. `budget-line.repository.spec.ts` (3 tests): Revenue/OpEx
upsert-not-duplicate on a repeated natural key, an independent line for a
different month, unlimited independent CAPEX items never merging.
`budget.service.spec.ts` (14 tests): every lifecycle-transition guard
(approve/activate/close/revise each rejecting the wrong prior status),
`DRAFT`-only edit enforcement, `assertLineWritable`'s account-requirement/
account-type-eligibility/fiscal-month-range checks, fiscal-year-derivation on
create. `budget-actuals.service.spec.ts` (7 tests): REVENUE credit-normal vs.
OPERATING_EXPENSE debit-normal actual computation against hand-built
`JournalEntryLine` fixtures, favourable/unfavourable in both directions,
null-safe zero-budget variance percent, CAPEX-without-account exclusion,
correct monthly-to-annual bucketing. `budget-forecast.service.spec.ts` (5
tests): not-applicable once the fiscal year has ended, scenario-id pass-
through to `CashflowForecastService` verified via a mocked call, budgeted-
expenditure composition (OpEx+CAPEX summed, Revenue excluded), shortfall
calculation both triggering and not triggering. `cost-centre.repository.spec.ts`
(3 tests) and two controller specs (tenant isolation, `wasCreated`-gated
audit emission). New `budgeting-independence.spec.ts` (5 tests). Full
existing suite must stay green (zero accounting regression). **120 test
suites / 1010 tests, all passing** (up from 110/953 before this sprint).
Seed run twice consecutively with identical row counts (7 cost centres, 2
budgets, 122 budget lines), confirming idempotency.

## 9. Live Verification Performed

Using the actual running API (`nest start --watch`) and web (`next dev`)
apps, logged in as the seeded Owner account. A stale, pre-Sprint-16 compiled
`dist` API process was found squatting port 4000 (the same recurring pattern
noted in every prior sprint's own report) and had to be killed before the
real dev server would bind; the web dev server's own `.next` cache was again
corrupted by an intermediate production-build run and required a clean
restart.

1. **Budgets Overview.** The Revenue/OpEx/CAPEX summary cards showed exactly
   the real, live numbers: Revenue Budget ₦36,000,000.00 vs. Actual
   ₦15,053,800.00 (the real `4100 Product Sales` GL balance, independently
   confirmed against the Trial Balance) — a -₦20,946,200.00 variance;
   Operating Expenses Budget ₦27,600,000.00 vs. Actual ₦45,000.00 (matching
   the one real posted `6500 Transport` line — Salaries/Utilities/Rent have
   no actual postings yet in this dev database); CAPEX Budget ₦11,500,000.00
   (₦8,000,000 + ₦3,500,000).
2. **Budget detail — monthly grid.** The Base budget's Revenue/OpEx grids
   rendered every one of the 12 seeded monthly cells correctly, with
   Q1-Q4/Annual totals computed client-side matching hand-arithmetic exactly
   (₦36,000,000 revenue annual, ₦27,600,000 OpEx annual). The CAPEX section
   listed both seeded items with their correct months and amounts.
3. **Budget vs Actual.** Every account row's variance/percent/favourability
   matched hand-computed expectations: `4100 Product Sales` -58.2%
   Unfavourable (real GL underperforming budget); `6100 Salaries`/`6200
Utilities`/`6300 Rent` each -100% but **Favourable** (correctly reflecting
   "spending under budget is good" for an expense line with zero actual
   postings); `6500 Transport` -95.3% Favourable.
4. **Budget vs Cashflow Forecast — the load-bearing composition proof.** The
   chart and table showed October 2026's forecast expenditure at
   ₦21,500,000 — directly traceable to Sprint 15's own seeded ₦20,000,000
   Planned Equipment Payment landing in that same window — and real
   projected shortfalls in November (₦2,261,200) and December
   (₦3,761,200), driven by the same Sprint 15 cashflow data this sprint's
   budgeted OpEx is being compared against. This is direct, live proof that
   `BudgetForecastService` is genuinely composing Sprint 15's own forecast
   engine, not a parallel calculation that happens to look similar.
5. **Inline grid editing.** On the `DRAFT` "Growth" sibling budget, editing
   January's Revenue cell from ₦3,900,000 to ₦4,200,000 saved on blur; the
   Q1 total updated live from ₦11,700,000.00 to ₦12,000,000.00, and an
   immediate Trial Balance check confirmed the ledger total (₦35,242,388.00
   = ₦35,242,388.00) was completely unaffected — proving the edit is a pure
   planning-table write with zero accounting side effect.
6. **Revise.** Clicking Revise on the `ACTIVE` Base v1 budget created a new
   Base v2 `DRAFT` row (confirmed via the budgets list: `BUD-2026-OPS · Base
· v2 · Draft` alongside the still-`ACTIVE` `BUD-2026-OPS · Base · v1`) — the
   original was never overwritten, and the Overview cards (sourced from the
   still-`ACTIVE` v1) were unaffected. The audit log was queried directly
   against the database and showed exactly one new `budget.revised` row
   (plus the earlier `budget-line.updated` row from step 5) — proving both
   writes are real, persisted, and audited.
7. **Scenario independence.** The Growth sibling's Revenue grid showed
   ₦46,800,000.00 annual (12 × ₦3,900,000, the seeded +30% figure) —
   completely independent of Base's own ₦36,000,000.00 — confirmed by
   reading both pages directly, and the Budget detail page's own Scenario
   Comparison table correctly listed all three lineage rows (Base v1 Active,
   Base v2 Draft, Growth v1 Draft) with no cross-contamination.
8. **RBAC, live against the real API.** `GET /finance/budgets` with a Member
   JWT returned `200`. `POST /finance/budgets` with the same Member JWT
   returned `403 Forbidden`. An unauthenticated request returned `401`.
9. **Responsive check at 375px.** The header, lifecycle action buttons, and
   every card/table/chart on the Budget detail page collapsed to a usable
   single-column layout; the 12-column monthly grid scrolled within its own
   container (the same convention every other wide table in this codebase —
   Trial Balance, Ledger — already uses), never causing page-level
   horizontal scroll.
10. **Zero new browser console errors** after re-authentication (a batch of
    stale 401s from a mid-session JWT-expiry moment, the same recurring
    pattern noted in Sprint 15's own report, were confirmed not to recur
    against the running application — every current network request
    returned `200`).

## 10. Known Limitations

- **CAPEX items with no linked account can't be compared against actuals** —
  a documented consequence of no Fixed Assets module existing yet.
- **The Budgets Overview page's summary cards source from a single `ACTIVE`
  budget** — a deliberate simplification; aggregating across multiple
  simultaneously-active budgets (e.g. different fiscal years active at once)
  is left for a future iteration.
- **No budget approval workflow beyond a single Owner/Administrator role** —
  no `SUBMITTED` step, no multi-approver chain.
- **No budgeting-specific permission tier, no loan/debt/investment/capital
  management, no AI/ML financial planning, no payroll, expense management,
  tax management, or procurement-commitment budgeting** — all explicit brief
  non-goals, unchanged.
- **No caching of Budget vs Actual/Forecast** — both recomputed live on every
  request, per this codebase's established "no premature caching"
  convention.

## 11. Deferred / Future Work

- Loan/Investment/Capital management — would read `Budget`/`BudgetLine`
  (planned CAPEX, planned cash requirements) and `BudgetVsForecast` directly,
  without any schema change to this domain.
- A configurable-permission RBAC model — the same deferred decision as every
  prior sprint.
- A Fixed Assets module, after which CAPEX lines could gain a required
  account reference and participate fully in Budget vs Actual.
- Aggregating the Budgets Overview across multiple simultaneously-active
  budgets.

## 12. Documentation Updated

`docs/domains/budgeting.md` (new — full domain writeup), `docs/domains/
finance.md` (header cross-references, new §16 "Budgeting & Financial Planning
(Sprint 16)"), `docs/domains/accounting.md` (new §23 "Budgeting (Sprint 16)",
renumbered API Reference/Known Limitations sections up by one), `docs/domains/
cashflow.md` (§12 cross-reference to Budget vs Forecast's reuse of the
forecast engine), `docs/domains/README.md` (new Budgeting row), `docs/
backlog.md` (Epic 20 added), `docs/roadmap.md` (new Budgeting bullet), `docs/
changelog.md` (new dated entry), root `README.md` (feature list update), this
completion report.

## 13. Constraint

Per this sprint's own explicit instruction, nothing in this sprint's work has
been committed or pushed.
