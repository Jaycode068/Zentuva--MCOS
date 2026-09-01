# Sprint 18 Completion Report — Investment / Capital Project Management Foundation

## 1. Objective

Give management a structured way to define, plan, approve, fund, track, and
evaluate capital projects and investments — machine purchases, factory
expansions, vehicle fleet additions — as a **management layer over**
Sprints 13-17 (Accounting, Cash, Cashflow, Budgeting, Debt) and
Procurement/AP, never a second accounting, budgeting, cashflow, debt,
procurement, or inventory engine. Explicitly not the financial-decision
engine — no NPV/IRR/ROI/payback/scenario comparison, which is Sprint 19's
job — Sprint 18 captures clean planning assumptions and derives real
financial performance from already-existing transactions.

```
Sprint 17: Capital Requirement (why) + Debt Facility (how debt works)
                              │
Sprint 18: Capital Project — cost plan, funding mix, timeline
                              │
        Committed/Actual Cost (derived live from Procurement/AP)
        Cashflow Forecast integration (planned outflows)
        Budget Allocation (read-only)
                              │
Sprint 19 (future): ROI / NPV / IRR / Payback / Scenario Comparison
```

Before any code was written, the existing schema and Sprint 12-17
implementations were inspected directly: `PurchaseOrder`/`PurchaseOrderItem`
were confirmed to carry no project reference of any kind;
`SupplierInvoice.purchaseOrderId` was confirmed to already exist as an
optional header-level reference ("for display/grouping only," per its own
doc comment) — the exact precedent this sprint needed;
`SupplierInvoiceRepository.getApByPurchaseOrder()` (built for Sprint 12's
own Purchase Order "Financial Summary" block) was confirmed to already
return exactly the AP-recognition aggregate needed for Actual Cost, zero new
Finance/Procurement code required; `PurchaseOrderModule` was confirmed
already imported into `FinanceModule` since Sprint 12, meaning a new
Investment module could read Purchase Orders with zero new NestJS module
imports; and `CashflowForecastService`'s Sprint 17 extension pattern
(`DebtFacilityRepository.findOutstandingScheduleForForecast()` → a new
`LOAN_REPAYMENT` source) was confirmed as the exact template for this
sprint's `CAPITAL_PROJECT` source. A full plan
(`/Users/user/.claude/plans/deep-giggling-shell.md`) was written and
approved before implementation began.

## 2. Architecture Decisions

| #   | Question                             | Decision                                                                                                                                                                                                                                                                                                                                                                    |
| --- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Module home                          | `apps/api/src/finance/investment/`, folded into `FinanceModule`. **Zero new NestJS module imports** — `PurchaseOrderRepository`, `SupplierInvoiceRepository`, `DebtFacilityRepository`, `CashAccountRepository`, `BudgetRepository`/`BudgetLineRepository`, `CostCentreRepository`, `CapitalRequirementRepository` are all already providers inside `FinanceModule` itself. |
| 2   | Minimum model set                    | Three: `CapitalProject`, `CapitalProjectCostLine`, `CapitalProjectFunding`. No separate milestone/schedule model (a cost line's own `plannedMonth` doubles as its cashflow timing) and no new category master table (a plain enum).                                                                                                                                         |
| 3   | Planned Cost is never a stored field | Always `Σ CapitalProjectCostLine.plannedAmount`, computed on every read — never a client-supplied or separately-stored total.                                                                                                                                                                                                                                               |
| 4   | Committed / Actual cost              | `CapitalProjectCostLine.purchaseOrderId String?` — a nullable FK on Investment's own table, pointing outward at Procurement's existing `PurchaseOrder`. Zero schema/module changes to Procurement. Committed = `Σ PurchaseOrder.total` (non-cancelled); Actual = `Σ recognizedAmount` via the existing `getApByPurchaseOrder()`.                                            |
| 5   | Funding                              | `CapitalProjectFunding {CASH\|DEBT\|OTHER, amount, debtFacilityId?, cashAccountId?}` — plain read-only references to Sprint 17/14's own models, never a duplicated repayment schedule.                                                                                                                                                                                      |
| 6   | Funding status                       | `totalFunding`/`fundingGap`/`fundingStatus` (`FULLY_FUNDED`/`UNDERFUNDED`/`OVERFUNDED`) all computed on every read, never stored. Underfunded projects are explicitly allowed to exist.                                                                                                                                                                                     |
| 7   | Budget integration                   | `budgetId`/`budgetLineId` independent of `capitalRequirementId`, even when both are set. Budget Allocation reimplements Sprint 17's own ~5-line coverage formula locally, never mutates the budget.                                                                                                                                                                         |
| 8   | Capital Requirement integration      | Fully optional — a project need not originate from a Capital Requirement.                                                                                                                                                                                                                                                                                                   |
| 9   | Lifecycle                            | `DRAFT → PROPOSED → UNDER_REVIEW → APPROVED → ACTIVE → COMPLETED`, plus `ON_HOLD`/`CANCELLED`. `cancel()` never reachable directly from `ACTIVE`. `actualStartDate`/`actualCompletionDate` set automatically.                                                                                                                                                               |
| 10  | Editability                          | Header/cost lines editable only while `DRAFT`; funding editable through `ACTIVE`.                                                                                                                                                                                                                                                                                           |
| 11  | Idempotency                          | Real writes (create project, add funding) use `idempotencyKey`; pure status transitions use soft, status-based idempotency (already-in-target-status returns unchanged, no error, no duplicate audit).                                                                                                                                                                      |
| 12  | Cashflow integration                 | `CashflowForecastSourceType` gains `CAPITAL_PROJECT`. Only `ACTIVE` projects' cost lines with no linked PO appear, confidence `ESTIMATED` — a linked PO's own AP outflow already represents that movement, avoiding double-counting.                                                                                                                                        |
| 13  | Accounting integration               | Zero — proven by `investment-independence.spec.ts`. Real capex continues through the existing Procurement→Goods Receipt→Supplier Invoice→Payment chain.                                                                                                                                                                                                                     |
| 14  | Categories                           | A plain closed enum (`CapitalProjectCategory`), no new master table. Cost-line categories are free text.                                                                                                                                                                                                                                                                    |
| 15  | RBAC / tenant isolation / audit      | Identical binary convention: any-authenticated read, Owner/Administrator write. New `CAPITAL_PROJECT_AUDIT_ACTIONS`, gated on real transitions only.                                                                                                                                                                                                                        |
| 16  | Frontend routes                      | One new flat tab, Capital Projects (list + create). Detail is its own page with Overview/Financial Plan/Funding/Budget/Spending/Timeline/Assumptions sections and status-gated lifecycle actions.                                                                                                                                                                           |

## 3. Database Changes (one additive migration)

New enums: `CapitalProjectStatus`, `CapitalProjectCategory`,
`CapitalProjectFundingType`. `CashflowForecastSourceType` gains
`CAPITAL_PROJECT` (additive, Sprint 15's own enum, extended a second time).

New models: `CapitalProject`, `CapitalProjectCostLine`,
`CapitalProjectFunding` — see `docs/domains/investment-projects.md` §3/§6/§7
for the full field list.

No changes to any existing model's own fields (only new back-relations,
including one new nullable FK, `CapitalProjectCostLine.purchaseOrderId`,
pointing at Procurement's own `PurchaseOrder` — zero changes to
`PurchaseOrder` itself). No new `SYSTEM_ACCOUNT_KEYS`.

## 4. API

| Endpoint                                                                                          | Auth              | Notes                                                        |
| ------------------------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------ |
| `GET/POST /api/finance/investment/projects`                                                       | Any / Owner+Admin | `POST` generates `CAP-000001`-style code                     |
| `GET/PATCH /api/finance/investment/projects/:id`                                                  | Any / Owner+Admin | `PATCH` requires `DRAFT`; `GET` includes computed financials |
| `GET .../projects/:id/budget-allocation`                                                          | Any authenticated | `null` when no budget referenced                             |
| `GET .../projects/:id/spending`                                                                   | Any authenticated | Planned/Committed/Actual/Remaining, always derived live      |
| `GET/POST .../projects/:id/cost-lines`                                                            | Any / Owner+Admin | `POST` requires `DRAFT`                                      |
| `DELETE .../projects/:id/cost-lines/:costLineId`                                                  | Owner+Admin       | Requires `DRAFT`                                             |
| `GET/POST .../projects/:id/funding`                                                               | Any / Owner+Admin | `POST` idempotency-checked; allowed through `ACTIVE`         |
| `DELETE .../projects/:id/funding/:fundingId`                                                      | Owner+Admin       | Allowed through `ACTIVE`                                     |
| `POST .../projects/:id/{submit,start-review,approve,reject,activate,hold,resume,complete,cancel}` | Owner+Admin       | Status-guarded, soft-idempotent lifecycle transitions        |

## 5. Backend Implementation

- **`apps/api/src/finance/investment/`** — `capital-project.repository.ts`
  (code generation, `findPlannedCostLinesForForecast()`),
  `capital-project.service.ts` (lifecycle, server-computed financials,
  Budget Allocation, Committed/Actual cost aggregation),
  `capital-project.controller.ts`, `capital-project-cost-line.repository.ts`,
  `capital-project-funding.repository.ts` (idempotent create),
  `investment-independence.spec.ts`, plus a `*.spec.ts` per repository/
  service.
- **`apps/api/src/finance/capital-project-audit-actions.ts`** —
  `CAPITAL_PROJECT_AUDIT_ACTIONS`.
- **`apps/api/src/finance/cashflow/cashflow-forecast.service.ts`**
  (existing, Sprint 15) — extended with a `CapitalProjectRepository`
  dependency and the `CAPITAL_PROJECT` outflow source; `.spec.ts` extended
  (+2 tests); `cashflow-independence.spec.ts` extended.
- **`apps/api/src/finance/finance.module.ts`** — registered the new
  controller + 4 new services/repositories; extended its own doc comment.
- **`packages/validation/src/investment.ts`** (new) — Zod schemas for every
  write body.
- **`apps/api/prisma/seed.ts`** — `seedInvestmentProjectFixtures()`: "Plantain
  Chips Production Line Expansion" (`CAP-000001`, `APPROVED`), five cost
  lines totalling ₦60,000,000 (Machine ₦45M, Installation ₦5M, Electrical
  Works ₦4M, Training ₦1M, Contingency ₦5M, matching the brief's own §8
  breakdown), linked to the already-seeded Sprint 17 "Packaging Machine
  Expansion" `CapitalRequirement` and the Sprint 16 "New Packaging Machine"
  `BudgetLine`, funded ₦40M debt (the existing "Bank Equipment Loan"
  `DebtFacility`) + ₦20M cash (the existing "GTBank Current Account") — zero
  new Lender/DebtFacility/Budget rows needed. Gated on a single idempotency
  check, run twice with identical row counts.

## 6. Frontend Implementation

- **`apps/web/src/components/app/finance-tabs.tsx`** — 1 new tab (Capital
  Projects).
- **`.../capital-projects/page.tsx`** + `capital-project-dialog.tsx` — list
  (code/name/category/status/planned cost/funding gap/actual cost/
  completion) + create dialog.
- **`.../capital-projects/[id]/page.tsx`** — Overview header with
  status-gated lifecycle actions; Financial Summary (Planned/Total
  Funding/Funding Gap/Committed/Actual/Remaining + a Funded-status badge);
  Financial Plan (cost-line table + inline add form, `DRAFT`-editable,
  server-computed total); Funding (funding-source table + add form with
  Debt Facility/Cash Account pickers, editable through `ACTIVE`); Budget
  (allocation %, shown only if linked); Timeline (planned vs. actual
  dates); Assumptions (revenue/cost/capacity-impact fields, explicit
  non-decision wording).
- **`finance/api.ts`/`labels.ts`** — new `// === Investment / Capital
Project Management (Sprint 18) ===` section.

## 7. Integrations

- **Budget** — read-only `budgetId`/`budgetLineId` reference; Budget
  Allocation % computed live, never mutates the budget.
- **Cashflow** — `CAPITAL_PROJECT` outflow source, `ACTIVE` projects only,
  PO-linked lines excluded to avoid double-counting with `SUPPLIER_PAYABLE`.
- **Debt** — `CapitalProjectFunding.debtFacilityId` references an existing
  `DebtFacility`; the project displays that facility's own live balance,
  never a duplicated repayment schedule.
- **Accounting** — none. See §13 of the architecture decisions table.
- **Procurement/AP** — `CapitalProjectCostLine.purchaseOrderId` (read-only)
  and `SupplierInvoiceRepository.getApByPurchaseOrder()` (reused unmodified)
  drive Committed/Actual Cost.

## 8. Tests

`capital-project.repository.spec.ts` (4 tests): project-code generation,
sequential-code-on-collision, idempotent create replay,
`findPlannedCostLinesForForecast()` correctly filtering to `ACTIVE`
projects with no linked PO. `capital-project-cost-line.repository.spec.ts`
(4 tests): create/list/remove, no natural-unique-key collision.
`capital-project-funding.repository.spec.ts` (3 tests): idempotent create
replay, independent funding rows. `capital-project.service.spec.ts` (16
tests): every lifecycle-transition guard, the full happy-path walk,
`reject()`'s revision-target, `cancel()` rejected directly from `ACTIVE`,
soft-idempotent replay of `approve()` (no duplicate side effect),
`update()`'s `DRAFT`-only enforcement, cost-line `DRAFT`-only enforcement,
funding editable through `ACTIVE` and rejected once `COMPLETED`, a `DEBT`
funding row requiring `debtFacilityId`, server-computed `plannedCost`,
`FULLY_FUNDED`/`UNDERFUNDED`/`OVERFUNDED` computation, a cost line with no
linked PO showing ₦0 committed/actual, Committed/Actual cost derived from a
real linked PO and its AP recognition, a `CANCELLED` PO contributing
nothing to Committed Cost, Budget Allocation returning `null` with no
budget referenced. New `investment-independence.spec.ts` (5 tests).
`cashflow-forecast.service.spec.ts` extended (+2 tests): `CAPITAL_PROJECT`
lines appear only for `ACTIVE` projects, confidence `ESTIMATED`.
`cashflow-independence.spec.ts` extended. Full existing suite must stay
green. **132 test suites / 1095 tests, all passing** (up from 127/1059
before this sprint).

## 9. Live Verification Performed

Using the actual running API (`nest start --watch`) and web (`next dev`)
apps, logged in as the seeded Owner account. A stale, pre-Sprint-18
compiled `dist` API process was found squatting port 4000 (the same
recurring pattern noted in every prior sprint's own report) and was killed
before the real dev server would bind.

1. **Capital Projects list.** "Plantain Chips Production Line Expansion"
   (`CAP-000001`, Production Equipment, Approved) rendered with the real,
   live-computed Planned Cost ₦60,000,000.00, Funding Gap ₦0.00, Actual
   Cost ₦0.00.
2. **Project detail — Financial Plan.** All five seeded cost lines
   (Machine/Installation/Electrical Works/Training/Contingency) rendered
   with correct amounts/months, server-computed Total ₦60,000,000.00.
3. **Funding gap recalculation (brief's own explicit Scenario 3).** Removed
   the ₦20,000,000 Cash funding row live — Total Funding dropped to
   ₦40,000,000.00, Funding Gap correctly recalculated to ₦20,000,000.00, and
   the status badge changed from "Fully Funded" to "Underfunded." Re-added
   the same ₦20,000,000 Cash funding — Fully Funded restored, ₦0.00 gap.
4. **Budget integration.** Budget section showed Budgeted Amount
   ₦8,000,000.00, Planned Cost ₦60,000,000.00, Allocation 13.3% —
   independently confirmed as `8,000,000 / 60,000,000`.
5. **Debt integration.** Funding table correctly showed "Bank Equipment
   Loan proceeds earmarked for this project," ₦40,000,000.00, referencing
   the real Sprint 17 `DebtFacility` with no duplicated schedule.
6. **Activate → Cashflow integration.** Activated the project via the UI —
   status flipped to `ACTIVE`, `Actual Start` auto-populated to the real
   current date (never manually entered). Navigated to the live Cashflow
   Forecast (180-day horizon, monthly buckets): "Outflows by Source" now
   showed a `Capital Project` row totalling ₦60,000,000.00 — the full
   planned cost of all five cost lines (none carry a linked Purchase Order
   in the seed), confirming the `CAPITAL_PROJECT` source integration end to
   end.
7. **A real bug found and fixed during this step.** The frontend's own
   `CashflowForecastSourceType` union type and `CASHFLOW_SOURCE_TYPE_LABELS`
   map had never been updated for Sprint 17's own `LOAN_REPAYMENT` value —
   both the Loan Repayment and (new) Capital Project rows rendered with a
   blank label in "Outflows by Source." Fixed by adding `LOAN_REPAYMENT`
   and `CAPITAL_PROJECT` to both the type and the label map in
   `finance/api.ts`/`labels.ts`; confirmed both now render correctly
   ("Loan Repayment ₦16,234,511.66," "Capital Project ₦60,000,000.00").
8. **Accounting integrity.** Direct database query confirmed zero
   `JournalEntry` rows with `sourceType` referencing capital projects,
   before or after activation — planning and approving a project posts
   nothing, exactly as designed.
9. **RBAC, live against the real API.** `GET /finance/investment/projects`
   with a Member JWT returned `200`. `POST` with the same Member JWT
   returned `403`. An unauthenticated request returned `401`.
10. **Idempotency (brief's own explicit Scenario 11).** Submitted the same
    `POST .../funding` request twice with an identical `idempotencyKey` —
    both responses returned the exact same row `id`/`createdAt`; the
    project's funding count increased by exactly one, not two. The test
    funding row was then removed to restore the seeded state.
11. **Mobile responsiveness at 375×812, 390×844, 430×932.** The Capital
    Projects list, the project detail page (all seven sections), and the
    "Add Capital Project" create dialog were each confirmed to have zero
    page-level horizontal overflow
    (`document.documentElement.scrollWidth === window.innerWidth` at every
    width); the create dialog scrolls within its own container, the same
    convention every other create dialog in this codebase already uses.

**Tenant isolation** was verified via the established repository pattern
(`findFirst({where: {id, organisationId}})`, identical to every other
tenant-scoped repository in this codebase, already proven correct across
every prior sprint's own live cross-tenant tests) and the dedicated
repository unit tests, rather than a fresh live cross-organisation
click-through — credentials for the second seeded organisation
("Rival Snacks Sprint10," from an earlier sprint's own fixtures) were not
available in this session. **Regression** (brief's own Scenario 12) was
confirmed via the full backend suite staying green (132/1095) before and
after every live-verification action above.

## 10. Bugs Found/Fixed

- **`CashflowForecastSourceType`/`CASHFLOW_SOURCE_TYPE_LABELS` missing
  `LOAN_REPAYMENT` and `CAPITAL_PROJECT`** — a pre-existing Sprint 17 gap
  (the frontend type/label map was never updated when `LOAN_REPAYMENT` was
  added to the backend enum) plus this sprint's own addition. Found live in
  §9.7 above; fixed in `apps/web/src/app/(app)/settings/finance/api.ts` and
  `labels.ts`.

## 11. Known Limitations

See `docs/domains/investment-projects.md` §12 for the full list — no
investment-decision engine (NPV/IRR/ROI/payback/scenario comparison, all
Sprint 19), no financing-allocation optimisation, no Purchase Order picker
in the cost-line create form yet (the backend fully supports it), costs
paid outside the Procurement→Supplier Invoice chain show no Actual Cost
until a supporting record exists, and no Gantt chart or task-management
functionality — this is a financial/management OS, not a project-management
tool.

## 12. Deferred / Future Work

- Sprint 19 — Financial Decision & Scenario Analysis: ROI, NPV, IRR,
  payback period, break-even, scenario comparison, sensitivity analysis,
  financing-alternative comparison — see `docs/domains/
investment-projects.md` §11 for the exact handoff.
- A Purchase Order picker in the cost-line create/edit form.
- A configurable-permission RBAC model — the same deferred decision as
  every prior sprint.

## 13. Documentation Updated

`docs/domains/investment-projects.md` (new — full domain writeup), `docs/
domains/finance.md` (new §18 "Investment / Capital Project Management
(Sprint 18)"), `docs/domains/accounting.md` (new §29 "Investment / Capital
Project Management (Sprint 18)," API Reference/Known Limitations
renumbered), `docs/domains/cashflow.md` (§14 cross-reference to the
`CAPITAL_PROJECT` outflow source), `docs/domains/budgeting.md` (§14
cross-reference), `docs/domains/debt-management.md` (§14 cross-reference to
`CapitalProjectFunding` referencing a `DebtFacility`), `docs/domains/
README.md` (new Investment / Capital Project Management row), `docs/
backlog.md` (new Epic), `docs/roadmap.md` (new bullet), `docs/changelog.md`
(new dated entry), root `README.md` (feature list update), this completion
report.

## 14. Final Quality Gate

```
prisma validate:    PASS
lint (api + web):   PASS
type-check (api + web): PASS
tests:               PASS (132 suites / 1095 tests)
build (api + web):   PASS
seed idempotency:    PASS (run twice, identical row counts)
live verification:   PASS (scenarios 1-8, 10-12 of the brief's §34 driven
                      live; scenario 9 tenant isolation verified via the
                      established repository pattern + unit tests, see §9)
```

## 15. Constraint

Per this sprint's own explicit instruction, nothing in this sprint's work
has been committed or pushed.
