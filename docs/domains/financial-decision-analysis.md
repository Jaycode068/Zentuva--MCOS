# Financial Decision & Scenario Analysis Domain

- **Status:** Foundation implemented — Sprint 19 ("Financial Decision,
  Scenario Analysis & Management Financial Cockpit"), the **capstone and
  closing sprint of the Finance MVP**. A management-decision layer that
  **composes** Sprints 13-18 into ROI/NPV/IRR/payback/sensitivity/funding
  comparison and a "Where are we / Where are we going / What should we do"
  cockpit — never a second accounting, cashflow, budget, or amortisation
  engine.
- **Sprint:** 19
- **Depends on:** [Accounting](accounting.md) (`FinancialStatementService`,
  read-only), [Finance](finance.md) (`AccountsReceivableService`/
  `AccountsPayableService`, read-only), [Cashflow](cashflow.md)
  (`CashflowForecastService.getForecast()`/`CashflowSettingsService`, read
  overlay only — never a persisted forecast row), [Budgeting](budgeting.md)
  (`BudgetActualsService`, read-only via [Investment](investment-projects.md)'s
  own Budget Allocation), [Debt Management](debt-management.md)
  (`DebtFacilityRepository`/`generateSchedule()`, read-only — the repayment
  schedule stays owned entirely there), [Investment / Capital Project
  Management](investment-projects.md) (`CapitalProjectService`, read-only —
  inherits live `plannedCost`/Budget Allocation, never duplicates them),
  [Identity](identity.md) (tenant boundary, `RolesGuard`, `AuditService`).
- **Explicitly does not depend on:** [Sales](sales.md),
  [Production](production.md), [Inventory](inventory.md),
  [Procurement](procurement.md), [Distribution](distribution.md) — proven
  executably by `decision-independence.spec.ts`
  (`apps/api/src/finance/decision/`), not just documented here.
- **See also:** [Finance](finance.md) §19, [Investment / Capital Project
  Management](investment-projects.md) §11 (Sprint 19 Handoff),
  [Sprint 19 Completion Report](../sprint-19-completion-report.md).

## 1. Business Purpose

Sprints 13-18 answer "what happened," "what is happening," "what is likely
to happen," and "what can we afford" — but none of them answer the question
management actually asks before committing money: **"given everything we
know, should we do this?"** A `DecisionAnalysis` evaluates one investment
decision (e.g. "should Boby Bites invest ₦60,000,000 in a new production
line?") across Base/Optimistic/Pessimistic (or custom) `DecisionScenario`s,
optionally linked to an existing [Capital Project](investment-projects.md)
(inherits its live Planned Cost) and/or an existing
[Debt Facility](debt-management.md) (inherits its real interest
rate/term/repayment schedule). Every ROI/NPV/IRR/payback/sensitivity/
recommendation figure is computed **live, on every read**, from the raw
assumptions stored on the scenario — nothing derived is ever persisted.

```
Financial Statements ─┐
Cashflow Forecast ─────┼──▶ Decision Analysis ──▶ Management Financial
Budget ─────────────────┘         │                  Decision Cockpit
                                   │
                    Capital Project · Debt Facility
                      (optional, read-only links)
```

## 2. Critical Architectural Principle — Scenario Analysis Is Side-Effect-Free

Creating, editing, comparing, or approving a `DecisionAnalysis`/
`DecisionScenario` **never** calls `postSystemJournalEntry` and **never**
mutates any real Cash Account, Debt Facility, Budget, or Capital Project
record — proven structurally by `decision-independence.spec.ts`. Approving a
decision is a paper sign-off only: it does not create a Capital Project,
does not draw down a facility, does not post anything. Running a scenario's
Cashflow Impact preview reads the real forecast and overlays a hypothetical
delta **in memory only** — it never writes a `CashflowForecastItem`.

## 3. Two Models, Zero Persisted Results

`DecisionAnalysis` (header + lifecycle + optional `capitalProjectId`/
`debtFacilityId` links + `analysisPeriodMonths`/`discountRatePercent`/
`maxAcceptablePaybackYears`) and `DecisionScenario` (every raw planning
assumption — investment, revenue, cost, financing, working capital). **No
results table exists.** ROI/NPV/IRR/payback/break-even/sensitivity/funding
comparison/recommendation are all recomputed live by the pure
`decision-calculations.ts` module on every request — the same "derive,
never store" discipline every prior sprint's headline figures already
follow. Nothing outside this module ever depends on a decision's historical
result staying frozen, so nothing needs snapshotting.

## 4. Cashflow Construction Convention (FCFE-style, stated explicitly)

Financing effects are included **directly** in the discounted cashflow
stream: Year 0 = `−(initialInvestment + additionalCapex +
workingCapitalImpact − debtFundingAmount)` — the net cash the business must
actually find. Each subsequent year = incremental revenue − incremental
cost − that year's own debt service (principal + interest, via the existing
`generateSchedule()`). This is the only convention under which financing
structure changes NPV — a 100%-cash-funded scenario and a debt+cash-funded
scenario for the _same_ project genuinely produce different NPVs, which is
the entire point of a funding comparison. A WACC/FCFF-style convention
would make NPV financing-invariant by construction and would not answer
"how should we finance this?"

## 5. ROI / Payback / Break-Even

`netBenefit` = the sum of the entire cashflow series (Year 0 through the
end of the analysis period, undiscounted); `roi = (netBenefit /
initialInvestment) × 100`. Payback is computed from the **actual cumulative
cashflow series**, linearly interpolated within the crossing year — never a
hardcoded approximation — returning `{years: null, status:
'NOT_RECOVERED'}` if cumulative cashflow never turns positive within
`analysisPeriodMonths`. Break-even's `requiredAdditionalMonthlyRevenue` is
always computable (incremental cost + monthly debt service);
`requiredUtilisationPercent` is computed only when the linked Capital
Project carries both `currentCapacityUnitsPerDay`/
`expectedCapacityUnitsPerDay`, on the documented assumption that the
scenario's own `additionalMonthlyRevenue` represents 100% utilisation of
the added capacity — never invented data.

## 6. NPV / IRR — Server-Authoritative, Never a Misleading Value

`discountRatePercent` is a required, user-set field on `DecisionAnalysis`
(pre-filled at 15% in the create dialog, always visible and editable — never
a hidden default). NPV is the standard `Σ CFₜ / (1+r)ᵗ`. IRR pre-scans
`[-99%, +500%]` in fine (0.5%) steps for sign changes in `NPV(rate)`, then
bisects: **exactly one bracket** → the rate; **zero brackets** (the series
never crosses zero) → `null` ("IRR unavailable"); **more than one bracket**
(a legitimate possibility with financing cashflows, e.g. the classic
`[-4000, 25000, -25000]` double-root example) → also `null`, rather than
guessing which root is "the" IRR. A client-submitted NPV/IRR/ROI/payback is
never trusted or accepted anywhere in this domain.

## 7. Sensitivity Analysis — One Variable at a Time, Never a Matrix

Four variables (`revenueGrowth`, `interestRate`, `operatingCost`,
`initialInvestment`) × five deltas (`-20%, -10%, Base, +10%, +20%`) — 20
full recomputations of NPV/ROI/Payback per scenario, each a clone-and-
recompute through §4-6's own functions. The `interestRate` variable
regenerates the debt schedule via `generateSchedule()` at the perturbed
rate (using the linked facility's own other terms, or the scenario's own
hypothetical term, when applicable) — correctly has zero effect on an
unfinanced scenario, never a fabricated interest sensitivity.

## 8. Funding — Reuse a Real Debt Facility Whenever Possible

`DecisionAnalysis.debtFacilityId` (optional) references an existing
[Debt Facility](debt-management.md), read-only. When a scenario's
`debtFundingAmount` is set and a facility is linked, `generateSchedule()`
runs with the **facility's own** `interestRatePercent`/`tenorMonths`/
`graceMonths`/`repaymentMethod`/`repaymentFrequency` and the scenario's
`debtFundingAmount` as principal — the real terms, never guessed ones. When
no facility is linked, the scenario's own hypothetical
`debtInterestRatePercent`/`debtTermMonths`/`debtRepaymentMethod` fields
drive the same pure function. **Never a second amortisation engine** either
way.

## 9. Cashflow Impact — Read-Only Overlay, Not a New Forecast Source

`previewCashflowImpact()` follows `DebtAnalysisService.
previewFacilityImpact()`'s exact template (Sprint 17): call the real
`CashflowForecastService.getForecast(organisationId, {horizonDays,
bucketBy: 'monthly'})`, then overlay each bucket with that scenario's own
incremental revenue/cost/debt-service for the corresponding month (ramped
per `rampUpMonths`, grown per `annualRevenueGrowthPercent`) — entirely in
memory. Flags `belowMinimumReserve` against the real
`CashflowSettingsService.getEffective()` minimum reserve. Returns Base
Closing + Scenario Impact = Scenario Closing per bucket, plus
`minCashPosition`/`shortfallMonths`/`recoveryMonth`. `CashflowForecastSourceType`
needed **no new value** for this — the overlay is never persisted.

## 10. Budget Impact — Reuse, Never Recompute

Applicable only when `DecisionAnalysis.capitalProjectId` is set **and**
that project itself has a `budgetId`: calls the _existing_
`CapitalProjectService.getBudgetAllocation()` for `{budgetedAmount,
plannedCost}`, adds the scenario's own `additionalCapex` as "Scenario
Impact," flags `withinBudget = (plannedCost + additionalCapex) ≤
budgetedAmount`. Otherwise returns `{applicable: false, reason}` — never
invents a budget comparison that doesn't exist. **Never mutates the
Budget.**

## 11. Lifecycle

```
DRAFT ──submit──▶ UNDER_REVIEW ──approve──▶ APPROVED (terminal)
                        │
                     reject
                        │
                        ▼
                    REJECTED (terminal)
```

Header and scenarios are freely editable while `DRAFT` **or**
`UNDER_REVIEW` (deliberately wider than most Sprint 16-18 DRAFT-only
precedents — comparing/adjusting scenarios _during_ review is the whole
point of this domain), frozen once `APPROVED`/`REJECTED`. A rejected
analysis is not reopened in place — clone into a new `DRAFT` instead, the
same "never rewrite history" convention every prior sprint's own status
model follows.

## 12. Idempotency

`DecisionAnalysis.create()` and `DecisionScenario.create()` both
idempotency-check-first inside their own transaction, an exact copy of
`CapitalProjectRepository.create()`'s pattern. Lifecycle transitions
(`submit`/`approve`/`reject`) reuse the private `transition()` soft-
idempotency pattern verbatim from `CapitalProjectService`:
already-in-target-status returns the current row unchanged, no error, no
duplicate audit event.

## 13. Recommendation — Rule-Based, Transparent, Configurable

`DecisionAnalysis.maxAcceptablePaybackYears` (user-set, default 3, shown
and editable at creation — never a hidden constant). For a given scenario:

- **ATTRACTIVE** if `npv > 0 AND payback.status === 'RECOVERED' AND
payback.years ≤ maxAcceptablePaybackYears AND` (when a `PESSIMISTIC`
  sibling scenario exists) its own Cashflow Impact overlay shows zero real
  shortfall months.
- **UNATTRACTIVE** if `npv ≤ 0 OR payback.status === 'NOT_RECOVERED' OR`
  the pessimistic sibling shows a real shortfall.
- **CAUTION** for everything in between (e.g. NPV positive but payback
  exceeds the threshold).

The response always includes the specific reasons (`npvPositive`,
`paybackRecovered`, `paybackWithinThreshold`, `downsideChecked`,
`downsideOk`) so the UI can show _why_ — never an unexplained AI judgement,
and no AI call exists anywhere in this path.

## 14. Management Financial Decision Cockpit

The existing `/settings/finance` Overview page (Sprint 13, extended by
Sprint 14's own Cash & Bank cross-link) gains two small new sections,
following that exact precedent rather than a new competing route:
**"Where Are We Going?"** (Forecast Closing Cash + shortfall flag via the
_existing_ `GET finance/cashflow/forecast`, Monthly Debt Service via the
_existing_ `GET finance/debt/dashboard`'s metrics — zero new backend
calculation) and **"What Decisions Are Being Considered?"** (a small strip
of active `DecisionAnalysis` cards, `<Link>`ed to each decision's detail
page). The decision's own detail page is the 12-section drill-down:
Overview, Investment, Funding, Revenue Assumptions, Cost Assumptions,
Cashflow, Budget Impact, Debt Impact, Scenario Comparison, Sensitivity
Analysis, Recommendation, Audit History.

## 15. Audit History — Composition, Not a New Writing Path

`GET :id/audit` is a thin, read-only composition over the _existing_
`AuditService.listByOrganisation()` (Sprint 6's own audit infrastructure),
filtered to this analysis's own `entityId` and its scenarios' own
`decisionAnalysisId` metadata — no new audit table, no new writing path.
Only state-changing actions are audited (`decision-analysis.created/
updated/submitted/approved/rejected`, `decision-scenario.created/updated/
removed`); every calculation endpoint (results, sensitivity, cashflow-
impact, budget-impact, debt-impact, recommendation, funding-comparison) is
deliberately never audited — an ephemeral read, not a state change.

## 16. RBAC / Tenant Isolation

Identical binary convention: `JwtAuthGuard` class-level (any-authenticated
read — a Member can view and compare, matching "Member read-only where
permitted"), `RolesGuard`+`Roles('Owner','Administrator')` on every write
(create/update/scenario CRUD/submit/approve/reject). Every query scoped by
`organisationId` from the JWT, inherited automatically like every other
Finance endpoint.

## 17. Finance MVP Completion Statement

Sprint 19 is the deliberate close of the Finance MVP foundation. The full
chain — Transaction Recording ([Accounting](accounting.md)) → Real Cash
([Cash Management](cash-management.md)) → Forward-Looking Cashflow
([Cashflow](cashflow.md)) → Planning ([Budgeting](budgeting.md)) →
Financing ([Debt Management](debt-management.md)) → Investment Planning
([Investment / Capital Project Management](investment-projects.md)) →
**Financial Decision Analysis (this domain)** — now answers, in order,
"What happened?", "What is happening?", "What is likely to happen?", "What
can we afford?", and finally "What should we do?" Zentuva Finance should
**not** expand further (payroll, tax filing, advanced treasury,
multi-currency accounting, IFRS automation, financial consolidation,
fixed-asset depreciation, or portfolio/investment-market trading) without a
new, deliberate roadmap decision — see §18.

## 18. Known Limitations / Non-Goals

- **No AI financial adviser or autonomous investment decisions** — the
  recommendation is a documented, configurable rule (§13), never a model
  call.
- **No automated loan applications, bank integrations, or payment
  gateways.**
- **No tax engine, payroll, fixed-asset depreciation, or full enterprise
  treasury** — deferred to a future, deliberate roadmap decision (§17).
- **No multi-currency accounting, IFRS automation, or financial
  consolidation.**
- **No portfolio/investment-market trading or cryptocurrency investments.**
- **No universal financial-modelling language** — a scenario's assumption
  set is a fixed, documented shape (§3), not an open-ended formula builder.
- **Sensitivity analysis is one-variable-at-a-time**, never a
  multi-variable matrix (§7) — a deliberate MVP restraint, not an
  oversight.
- **No configurable-permission RBAC model** — the same deferred decision as
  every prior sprint.
