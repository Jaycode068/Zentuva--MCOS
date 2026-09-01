# Sprint 19 Completion Report — Financial Decision, Scenario Analysis & Management Financial Cockpit

## 1. Objective

Sprint 19 is the **capstone, closing sprint of the Finance MVP**: a
management-decision layer that composes Sprints 13-18 (Financial
Statements, Cash, Cashflow, Budgeting, Debt, Capital Projects) into
ROI/NPV/IRR/payback/sensitivity/funding comparison and a "Management
Financial Decision Cockpit" — never a second accounting, forecast, or
amortisation engine, and scenario analysis is 100% side-effect-free (zero
Journal Entries, zero mutation of any real Cash/Debt/Budget/Capital
Project record). Central worked example: "Should Boby Bites invest
₦60,000,000 in a new production line, and how should it be financed?" —
Base/Optimistic/Pessimistic scenarios, cash-only vs. debt+cash funding.

## 2. Architecture Decisions

See `docs/domains/financial-decision-analysis.md` for the full record
(18 sections). Highlights:

- **Two models, zero persisted results** — `DecisionAnalysis` +
  `DecisionScenario` hold only raw assumptions; ROI/NPV/IRR/payback/
  break-even/sensitivity/recommendation are recomputed live on every read.
- **FCFE-style cashflow construction, stated explicitly** — financing
  effects (debt drawdown, principal + interest) are included directly in
  the discounted cashflow stream, the only convention under which funding
  structure changes NPV.
- **Robust IRR** — pre-scan `[-99%, +500%]` for sign changes, bisect if
  exactly one bracket exists, return `null`/"IRR unavailable" for zero or
  multiple brackets rather than guessing a root.
- **`generateSchedule()` reused directly** for both a linked real
  `DebtFacility`'s own terms and a scenario's hypothetical financing —
  zero new amortisation logic.
- **`previewCashflowImpact()` mirrors `DebtAnalysisService.
previewFacilityImpact()`'s exact template** — a read-only overlay on the
  real Cashflow Forecast, never a persisted forecast row.
- **Budget Impact reuses `CapitalProjectService.getBudgetAllocation()`**
  unmodified — never a second budget-variance formula.
- **Rule-based, transparent recommendation** — configurable
  `maxAcceptablePaybackYears`, always returns the specific reasons behind
  the verdict, no AI call anywhere in the path.
- **Finance Overview page extended, not duplicated** — two small new
  cross-link sections ("Where Are We Going?", "What Decisions Are Being
  Considered?"), following the exact precedent Sprint 14's own Cash & Bank
  strip established, sourced entirely from existing endpoints.

## 3. Database Changes (one additive migration)

New enums: `DecisionAnalysisStatus`, `DecisionType`,
`DecisionScenarioType`. New models: `DecisionAnalysis`, `DecisionScenario`
(full field lists in `docs/domains/financial-decision-analysis.md` §3).
Back-relations added to `Organisation`, `CapitalProject`, `DebtFacility`.
No changes to any existing model's own fields. No new
`SYSTEM_ACCOUNT_KEYS` — this domain posts nothing.

## 4. API

`@Controller('finance/decisions')` — `GET/POST /`, `GET/PATCH /:id`,
`POST /:id/{submit,approve,reject}`, `GET/POST /:id/scenarios`,
`PATCH/DELETE /:id/scenarios/:scenarioId`, `GET
/:id/scenarios/:scenarioId/{results,sensitivity,cashflow-impact,
budget-impact,debt-impact,recommendation}`, `GET
/:id/funding-comparison?scenarioIds=a,b,c`, `GET /:id/audit`.

## 5. Backend Implementation

`apps/api/src/finance/decision/`:
`decision-calculations.ts` (pure NPV/IRR/ROI/payback/break-even/
sensitivity functions), `decision-analysis.repository.ts`/`.service.ts`/
`.controller.ts`, `decision-scenario.repository.ts`/`.service.ts`,
`decision-independence.spec.ts`. `finance/decision-analysis-audit-actions.ts`.
`packages/validation/src/decision.ts` (new Zod schemas, exported via
`packages/validation/src/index.ts`). Registered directly in the existing
`finance.module.ts` providers/controllers arrays — **zero new NestJS
module imports**, since `FinancialStatementService`,
`AccountsReceivableService`, `AccountsPayableService`,
`CashflowForecastService`, `CashflowSettingsService`, `BudgetActualsService`,
`DebtFacilityRepository`, and `CapitalProjectService` were already
providers of this same module.

## 6. Frontend Implementation

`apps/web/src/app/(app)/settings/finance/decisions/` — `page.tsx` (list +
create dialog, supports `?capitalProjectId=` prefill),
`decision-analysis-dialog.tsx`, `decision-scenario-dialog.tsx`,
`[id]/page.tsx` (the 12-section drill-down). One new "Decisions" tab on
`FinanceTabs`. Two new sections on the existing `/settings/finance`
Overview page. One new "Create Decision Analysis" action on the Capital
Project detail page (`/settings/finance/capital-projects/[id]`), linking to
the Decisions list pre-filled. New `// === Financial Decision & Scenario
Analysis (Sprint 19) ===` section in `finance/api.ts`/`labels.ts`.

## 7. Integrations

- **Financial Statements** — not directly consumed by Decision Analysis
  itself; the Overview page's own existing composition already covers
  "Where are we?"
- **Cashflow (Sprint 15)** — `CashflowForecastService.getForecast()`
  called read-only for the Cashflow Impact overlay and the Overview
  page's "Forecast Closing Cash" card.
- **Debt (Sprint 17)** — `DebtFacilityRepository.findById()` +
  `generateSchedule()` for real-facility-backed scenarios; `getDebtMetrics()`
  for the Overview page's "Monthly Debt Service" card.
- **Investment / Capital Projects (Sprint 18)** — `CapitalProjectService.
getById()`/`getBudgetAllocation()` for investment inheritance and
  Budget Impact.
- **Accounting** — zero. `decision-independence.spec.ts` proves
  `postSystemJournalEntry` is never called anywhere in this domain.

## 8. Tests

`decision-calculations.spec.ts` (22 tests — NPV against hand-computed
tables, IRR normal/no-root/textbook-double-root cases, ROI, payback exact
and fractional, break-even with/without capacity data, sensitivity base-
row reproduction and monotonic investment-delta ordering).
`decision-analysis.service.spec.ts` (lifecycle transitions, soft-idempotent
replay, editability guards, reference validation). `decision-scenario.
service.spec.ts` (initialInvestment inheritance/override, financing-
structure-changes-NPV, debt-impact facility-vs-hypothetical source,
budget-impact applicable/not-applicable, cashflow-impact shortfall
detection, recommendation ATTRACTIVE/CAUTION/UNATTRACTIVE including the
pessimistic-sibling downside check, funding comparison). `decision-
independence.spec.ts` (zero Journal Entries, zero writes to any real
Cash/Debt/Budget/Capital-Project/Cashflow/Sales/Procurement/Production/
Inventory table, `postSystemJournalEntry` never called, only the two
repositories write their own tables, `decision-calculations.ts` is
provably pure). **56 new tests, all passing.** Full backend suite: **136
suites / 1151 tests, all green** (up from 132/1095 before this sprint).

## 9. Live Verification Performed

Live in the browser against the real dev servers/database (Boby Bites
seed data):

1. Logged in as Owner; navigated to the new **Decisions** tab.
2. Confirmed the seeded "Plantain Chips Line — Investment Decision"
   (linked to the existing Sprint 18 Capital Project and Sprint 17 "Bank
   Equipment Loan" facility) renders with all three Base/Optimistic/
   Pessimistic scenarios.
3. Confirmed server-computed ROI/NPV/IRR/Payback/Break-Even/Net Benefit on
   the Investment section, matching hand-checked arithmetic (Year 0 =
   −₦20,000,000 net of ₦40M debt financing; the fast ~0.24-year payback is
   the correct, if counter-intuitive, consequence of the FCFE convention —
   documented in §4 of the domain doc).
4. Confirmed the Cashflow Impact overlay (24 months shown), Budget Impact
   (Over Budget — the linked project's own pre-existing Sprint 18 budget
   allocation, ₦8,000,000 vs. ₦60,000,000 planned cost), and Debt Impact
   (Monthly Debt Service ₦2,035,832.11, Total Interest ₦8,859,970.54 —
   matching the linked facility's own real 20%/24-month amortising terms).
5. Confirmed Sensitivity Analysis renders 20 rows (4 variables × 5 deltas)
   with the Base/0% row reproducing the unperturbed result exactly.
6. Confirmed the Scenario Comparison table shows genuinely different NPVs
   across Base/Optimistic/Pessimistic, and confirmed the Pessimistic
   scenario correctly produces a real projected cash shortfall.
7. Confirmed the Recommendation for Base correctly downgrades from
   what its own numbers alone would suggest to **Unattractive** because
   its sibling Pessimistic scenario shows a real cash shortfall — the
   downside-protection rule (§13) working as designed, with the specific
   reasons shown.
8. Approved the analysis (`UNDER_REVIEW → APPROVED`); confirmed the
   Journal Entry count and `CapitalProject`/`Budget`/`DebtFacility`/
   `CashAccount` row counts were **byte-identical before and after**
   (48/1/3/1/3 respectively) — zero side effects, verified directly
   against the database, not just the UI.
9. Confirmed the Audit History section lists the approval event.
10. Confirmed the Finance Overview page's two new sections render
    ("Where Are We Going?" — Forecast Closing Cash with a shortfall flag,
    Monthly Debt Service; "What Decisions Are Being Considered?" — the
    approved decision's own card, linked correctly) using only existing
    endpoints.
11. Confirmed mobile responsiveness at 375×812 — no horizontal page
    overflow (`document.documentElement.scrollWidth === window.innerWidth`
    confirmed via script), wide tables (Cashflow Impact, Scenario
    Comparison, Sensitivity) scroll within their own containers.
12. Confirmed zero real console/network errors on a fresh page load
    (post dev-server restart to clear a stale build-chunk cache
    unrelated to this sprint's own code).

## 10. Bugs Found/Fixed

None in application logic. One test-authoring correction during
development: the original "multiple sign changes" IRR test used a cashflow
series that, on scan, produced only one root within the search range;
replaced with the textbook double-root example (`[-4000, 25000, -25000]`,
roots at 25% and 400%) to correctly exercise the "more than one bracket →
`null`" branch.

## 11. Known Limitations

See `docs/domains/financial-decision-analysis.md` §18 — no AI adviser, no
automated loan applications/bank integrations, no tax/payroll/fixed-asset
engine, no multi-currency/IFRS/consolidation, no portfolio/market trading,
no universal financial-modelling language, sensitivity is one-variable-
at-a-time only.

## 12. Deferred / Future Work

None identified as in-scope follow-up for this domain — Sprint 19 is
explicitly the closing sprint of the Finance MVP (§15 below).

## 13. Documentation Updated

New: `docs/domains/financial-decision-analysis.md`,
`docs/sprint-19-completion-report.md` (this file). Updated: root
`README.md`, `docs/backlog.md`, `docs/roadmap.md`, `docs/changelog.md`,
`docs/domains/README.md`, `docs/domains/finance.md`,
`docs/domains/accounting.md`, `docs/domains/cashflow.md`,
`docs/domains/budgeting.md`, `docs/domains/debt-management.md`,
`docs/domains/investment-projects.md`.

## 14. Final Quality Gate

`pnpm prisma validate` ✅ · backend lint ✅ (zero warnings) · backend
type-check ✅ · backend tests: **136 suites / 1151 tests, all passing** ·
backend build ✅ · frontend type-check ✅ · frontend lint ✅ · frontend
build ✅ (`/settings/finance/decisions` and
`/settings/finance/decisions/[id]` both compile and generate correctly) ·
seed script run twice, fully idempotent (identical output both runs, one
`DecisionAnalysis` + three `DecisionScenario` rows confirmed via direct
database query after each run) · live browser verification (§9) with
before/after database row counts confirming zero side effects.

## 15. Finance MVP Completion Statement

Sprint 19 closes the Finance MVP foundation. The full chain is now
complete: **Transaction Recording** (Accounting, Sprints 7-12) →
**Real Cash** (Cash Management, Sprint 14) → **Forward-Looking Cashflow**
(Cashflow, Sprint 15) → **Planning** (Budgeting, Sprint 16) →
**Financing** (Debt Management, Sprint 17) → **Investment Planning**
(Investment / Capital Project Management, Sprint 18) → **Financial
Decision Analysis** (this sprint) — moving management from "What
happened?" through "What is happening?" / "What is likely to happen?" /
"What can we afford?" to, finally, **"What should we do?"**

Zentuva Finance should **not** expand further — payroll, tax filing,
advanced treasury, multi-currency accounting, IFRS automation, financial
consolidation, fixed-asset depreciation, or portfolio/investment-market
trading — without a new, deliberate roadmap decision. The Finance MVP, as
scoped across Sprints 6-19, is considered functionally complete.

## 16. Constraint

Per this session's own established convention, this work was not committed
or pushed automatically — the user must explicitly instruct "commit and
push" before any git operation occurs.
