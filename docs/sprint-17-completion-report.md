# Sprint 17 Completion Report — Capital & Debt Management Foundation

## 1. Objective

Answer the question none of Sprints 13-16 answer: what capital do we need,
how should we finance it, and can we afford the repayment? Sprint 13 gave
read-only historical understanding, Sprint 14 real cash visibility, Sprint 15
a never-persisted forward cash forecast, Sprint 16 a planning layer. None of
them is debt. Sprint 17 builds the foundation for borrowing, debt
obligations, capital requirements, and financing analysis — explicitly not
just a CRUD loan-management module — governed by the same repeated
instruction as every prior Finance sprint: **the General Ledger stays
authoritative, and a loan is not revenue.** Every drawdown/repayment posts
through the exact same `postSystemJournalEntry` boundary every other
financial event uses; nothing here duplicates the Cashflow Forecast, the
Budget engine, or the accounting system.

```
WHAT HAPPENED    WHAT CASH DO WE HAVE    WHAT WILL HAPPEN    WHAT DO WE PLAN
 (Sprint 13)  ──▶    (Sprint 14)      ──▶   (Sprint 15)   ──▶   (Sprint 16)
                                                                      │
                                                    WHAT CAPITAL DO WE NEED
                                                       (Sprint 17, CapitalRequirement)
                                                                      │
                                                  HOW SHOULD WE FINANCE IT
                                                       (Sprint 17, DebtFacility)
                                                                      │
                                                        CAN WE AFFORD IT
                                              (Sprint 17 data foundation only)
```

Before any code was written, the existing schema and Sprint 13-16
implementations, the scenario architecture, the audit architecture, and the
transaction/posting boundaries were inspected directly:
`postSystemJournalEntry` was confirmed already idempotent by
`(organisationId, sourceType, sourceId)` and already period-guarded, meaning
the new repositories need only their own row-level idempotency check before
posting; Sprint 12's "Path B" user-chosen non-system-account pattern (already
reused once by Sprint 16) was confirmed as the correct answer to "avoid one
global loan liability account"; and Sprint 15's `CashflowForecastService`
was confirmed extensible in place with one new outflow source rather than
needing a second forecast engine. A full plan
(`/Users/user/.claude/plans/deep-giggling-shell.md`) was written and approved
before implementation began.

## 2. Architecture Decisions

| #   | Question                                      | Decision                                                                                                                                                                                                                                                               |
| --- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Module home                                   | `apps/api/src/finance/debt/`, folded into `FinanceModule`. One intra-module extension: `cashflow-forecast.service.ts` gains a `DebtFacilityRepository` dependency. No new NestJS module import.                                                                        |
| 2   | Minimum model set                             | Six: `Lender`, `CapitalRequirement`, `DebtFacility`, `DebtDrawdown`, `DebtRepaymentSchedule`, `DebtRepayment`. **No separate scenario/allocation table** — see decision #9.                                                                                            |
| 3   | Accounting — no new `SYSTEM_ACCOUNT_KEYS`     | `DebtFacility.liabilityAccountId`/`.interestExpenseAccountId`, `DebtRepayment.feeExpenseAccountId` are user-chosen, service-validated, non-system Chart of Accounts rows — Sprint 12's "Path B" pattern, reused a third time.                                          |
| 4   | Drawdown posting                              | `DR <cashAccount's own CoA> / CR <facility's liability account>`, `sourceType: 'DEBT_DRAWDOWN'`.                                                                                                                                                                       |
| 5   | Repayment posting                             | One balanced multi-line entry: `DR liabilityAccountId (principal) + DR interestExpenseAccountId (interest) [+ DR feeExpenseAccountId (fee)] / CR cashAccount's own CoA`, `sourceType: 'DEBT_REPAYMENT'`.                                                               |
| 6   | Schedule generation timing                    | Generated in full at `DebtFacility` creation, from `principalAmount` — never per-drawdown, never dynamically reshaped.                                                                                                                                                 |
| 7   | Grace period behaviour                        | Interest-only, balance unchanged, explicit and documented — never silently assumed.                                                                                                                                                                                    |
| 8   | Repayment methods                             | `AMORTISING`, `INTEREST_ONLY`, `BULLET`; `RepaymentFrequency { MONTHLY, QUARTERLY, YEARLY }`, only `MONTHLY` fully worked-example tested.                                                                                                                              |
| 9   | Financing "scenario" — reuse, not a new table | A `PROPOSED` `DebtFacility` already has a full generated schedule but is structurally invisible to the live forecast/GL/balance until an actual drawdown — no new scenario table. `DebtAnalysisService.previewFacilityImpact()` overlays it onto a real forecast call. |
| 10  | Cashflow integration                          | `CashflowForecastSourceType` gains `LOAN_REPAYMENT` (additive). The forecast reads every outstanding schedule installment for `ACTIVE`/`PARTIALLY_REPAID` facilities as `CONFIRMED` outflows. Future drawdowns not modelled as inflows this sprint.                    |
| 11  | Budget integration                            | No Budget-side code change — debt service flows into the same forecast `BudgetForecastService.getBudgetVsForecast()` already composes.                                                                                                                                 |
| 12  | Facility lifecycle                            | `PROPOSED → APPROVED → ACTIVE → PARTIALLY_REPAID → PAID_OFF`, plus `CANCELLED`/`DEFAULTED`. Every transition automatic except approve/cancel/mark-defaulted.                                                                                                           |
| 13  | Capital Requirement lifecycle                 | `DRAFT → PROPOSED → APPROVED → FUNDED → COMPLETED`, plus `CANCELLED`.                                                                                                                                                                                                  |
| 14  | Debt balance — never stored                   | Always computed live from `DebtDrawdown`/`DebtRepayment`/`DebtRepaymentSchedule`.                                                                                                                                                                                      |
| 15  | Over-repayment / early payoff                 | Rejected server-side against the live balance before posting. Early payoff needs no special path — `outstandingPrincipal` reaching zero auto-triggers `PAID_OFF`.                                                                                                      |
| 16  | Schedule `OVERDUE` detection                  | A lazy sweep, mirroring `InvoiceRepository.sweepOverdue()` — no scheduler.                                                                                                                                                                                             |
| 17  | Idempotency                                   | Every write checks its own `idempotencyKey` first, inside its own transaction — the Sprint 9/10 lesson.                                                                                                                                                                |
| 18  | RBAC                                          | Identical binary convention: any-authenticated read, Owner/Administrator write.                                                                                                                                                                                        |
| 19  | Structural guard                              | New `debt-independence.spec.ts` — zero forbidden-table writes, `postSystemJournalEntry` only in the two transaction repositories, no Sales/Inventory/Procurement/Production import. `cashflow-independence.spec.ts` extended symmetrically.                            |
| 20  | Frontend routes                               | Three new flat tabs — Debt (Overview), Capital Requirements, Debt Facilities. Facility detail is its own page (`/settings/finance/debt-facilities/[id]`).                                                                                                              |

## 3. Database Changes (one additive migration)

New enums: `LenderType`, `LenderStatus`, `CapitalRequirementType`,
`CapitalRequirementPriority`, `CapitalRequirementStatus`, `DebtType`,
`InterestType`, `RepaymentMethod`, `RepaymentFrequency`,
`DebtFacilityStatus`, `DebtScheduleStatus`. `CashflowForecastSourceType`
gains `LOAN_REPAYMENT` (additive, Sprint 15's own enum).

New models: `Lender`, `CapitalRequirement`, `DebtFacility`, `DebtDrawdown`,
`DebtRepaymentSchedule`, `DebtRepayment` — see
`docs/domains/debt-management.md` §3-9 for the full field list.

No changes to any existing model's own fields (only new back-relations). No
new `SYSTEM_ACCOUNT_KEYS`.

## 4. API

| Endpoint                                                                   | Auth              | Notes                                                             |
| -------------------------------------------------------------------------- | ----------------- | ----------------------------------------------------------------- |
| `GET/POST /api/finance/debt/lenders`                                       | Any / Owner+Admin |                                                                   |
| `PATCH /api/finance/debt/lenders/:id`                                      | Owner+Admin       |                                                                   |
| `GET/POST /api/finance/debt/capital-requirements`                          | Any / Owner+Admin |                                                                   |
| `GET /api/finance/debt/capital-requirements/:id/budget-coverage`           | Any authenticated | Never mutates the referenced budget                               |
| `PATCH .../capital-requirements/:id`                                       | Owner+Admin       | `DRAFT` only                                                      |
| `POST .../capital-requirements/:id/{propose,approve,fund,complete,cancel}` | Owner+Admin       | Lifecycle transitions, each guarded to its own valid prior status |
| `GET/POST /api/finance/debt/facilities`                                    | Any / Owner+Admin | `POST` generates the full schedule in the same transaction        |
| `GET .../facilities/:id`                                                   | Any authenticated | Includes the live balance                                         |
| `GET .../facilities/:id/schedule`                                          | Any authenticated | Sweeps overdue first                                              |
| `GET .../facilities/:id/preview-impact`                                    | Any authenticated | Overlays this facility's schedule onto the real Cashflow Forecast |
| `PATCH .../facilities/:id`                                                 | Owner+Admin       | `PROPOSED` only                                                   |
| `POST .../facilities/:id/{approve,cancel,mark-defaulted}`                  | Owner+Admin       | Lifecycle transitions                                             |
| `POST .../facilities/:id/drawdowns`                                        | Owner+Admin       | Auto-activates the facility on first drawdown                     |
| `POST .../facilities/:id/repayments`                                       | Owner+Admin       | Auto-transitions to `PARTIALLY_REPAID`/`PAID_OFF`                 |
| `GET /api/finance/debt/overview`                                           | Any authenticated | Composed dashboard metrics, mirrors `CashDashboardController`     |

## 5. Backend Implementation

- **`apps/api/src/finance/debt/`** — `repayment-schedule.ts` (pure schedule
  generation), `debt-balance.ts` (pure live-balance computation),
  `lender.repository.ts`/`.service.ts`/`.controller.ts`,
  `capital-requirement.repository.ts`/`.service.ts`/`.controller.ts`,
  `debt-facility.repository.ts`/`.service.ts`/`.controller.ts`,
  `debt-drawdown.repository.ts`/`.service.ts`,
  `debt-repayment.repository.ts`/`.service.ts`,
  `debt-analysis.service.ts` (facility-impact preview + dashboard metrics),
  `debt-dashboard.controller.ts`, `debt-independence.spec.ts`, plus a
  `*.spec.ts` per pure function/repository/service.
- **`apps/api/src/finance/debt-audit-actions.ts`** — `DEBT_AUDIT_ACTIONS`,
  the same `<entity>.<event>` convention as `budgeting-audit-actions.ts`.
- **`apps/api/src/finance/cashflow/cashflow-forecast.service.ts`** (existing,
  Sprint 15) — extended with a `DebtFacilityRepository` dependency and the
  `LOAN_REPAYMENT` outflow source; `cashflow-forecast.service.spec.ts`
  extended with 2 new tests; `cashflow-independence.spec.ts` extended to
  cover the new Debt tables.
- **`apps/api/src/finance/finance.module.ts`** — registered the 4 new
  controllers + 11 new services/repositories; extended its own doc comment.
- **`packages/validation/src/debt.ts`** (new) — Zod schemas for every write
  body.
- **`apps/api/prisma/seed.ts`** — `seedDebtManagementFixtures()`: two new
  Chart of Accounts rows ("2200 Loans Payable," "6800 Interest Expense," the
  same backfill pattern as "6700 Bank Charges"); a "GTBank" `Lender`; a
  "Packaging Machine Expansion" `CapitalRequirement` (₦60,000,000, linked to
  the Sprint 16 "New Packaging Machine" CAPEX line for a real 13.3% Budget
  Coverage); a "Bank Equipment Loan" `DebtFacility` (₦60,000,000, 20%
  annual, 24-month amortising, monthly); its full 24-installment schedule; a
  full drawdown against the existing "GTBank Current Account"; one
  repayment (principal-only, since only the first installment's interest
  had accrued by the seed run's own real-clock date) — leaving a real
  outstanding balance and a `PARTIALLY_REPAID` facility. Gated on a single
  idempotency check, run twice with identical row counts.

## 6. Frontend Implementation

- **`apps/web/src/components/app/finance-tabs.tsx`** — 3 new tabs (Debt,
  Capital Requirements, Debt Facilities).
- **`.../capital-requirements/page.tsx`** + `capital-requirement-dialog.tsx`
  — list with a live Budget Coverage % per row and lifecycle actions
  (Propose/Approve/Mark Funded/Complete/Cancel).
- **`.../debt-facilities/page.tsx`** + `debt-facility-dialog.tsx` — list +
  create (lender/debt-type/principal/rate/method/frequency/grace, liability
  - interest-expense account pickers, optional Capital Requirement link).
- **`.../debt-facilities/[id]/page.tsx`** — balance summary cards, the full
  repayment schedule table (status-badged), a Record Drawdown form (shown
  for `APPROVED`/`ACTIVE`), a Record Repayment form (principal/interest/fee
  fields, shown for `ACTIVE`/`PARTIALLY_REPAID`), lifecycle actions, and —
  for `PROPOSED` facilities — a Preview Cashflow Impact panel (reuses the
  `recharts` bar-chart pattern from Sprint 13/15/16, with explicit
  non-verdict wording).
- **`.../debt/page.tsx`** — Debt Overview dashboard: Total/Outstanding
  Principal/Interest, Upcoming Repayments (30d), Monthly Debt Service, Total
  Interest Scheduled, Active Facility count, Next Maturity, and a live
  active-facility list.
- **`finance/api.ts`/`labels.ts`** — new `// === Capital & Debt Management
(Sprint 17) ===` section.

## 7. Accounting Rules

See `docs/domains/debt-management.md` §2-3. A drawdown posts `DR Cash / CR
Loan Payable`; a repayment posts `DR Loan Payable [+ DR Interest Expense] [+
DR Fee Expense] / CR Cash`, always split by principal/interest/fee, never
one collapsed amount. Both use user-chosen non-system accounts (Path B), and
both go through the closed-period/system-account guards
`postSystemJournalEntry` already enforces — proven not to bypass them by
`debt-independence.spec.ts`.

## 8. Tests

`repayment-schedule.spec.ts` (8 tests): AMORTISING structural correctness,
INTEREST_ONLY, BULLET, grace period, QUARTERLY, YEARLY. `debt-balance.spec.ts`
(4 tests). `capital-requirement.service.spec.ts` (10 tests): every lifecycle
guard, the full DRAFT→PROPOSED→APPROVED→FUNDED→COMPLETED happy path, Budget
Coverage against a specific line and a summed CAPEX pool, read-only
confirmation. `debt-facility.repository.spec.ts` (3 tests): facility-code
generation, full-schedule persistence in the same transaction, idempotent
replay. `debt-facility.service.spec.ts` (8 tests): account-eligibility
rejection (wrong type, system account), lender-not-found, every lifecycle
guard. `debt-transactions.repository.spec.ts` (9 tests, both drawdown and
repayment repositories): accounting treatment, over-repayment/over-drawdown
rejection, closed-period rejection, idempotent replay. New
`debt-independence.spec.ts` (5 tests). `cashflow-forecast.service.spec.ts`
extended (+2 tests): `LOAN_REPAYMENT` lines appear only for `ACTIVE`/
`PARTIALLY_REPAID` facilities, confidence `CONFIRMED`. `cashflow-
independence.spec.ts` extended. Full existing suite must stay green.
**127 test suites / 1059 tests, all passing.** Seed run twice consecutively
with identical row counts, confirming idempotency.

## 9. Live Verification Performed

Using the actual running API (`nest start --watch`) and web (`next dev`)
apps, logged in as the seeded Owner account. A stale, pre-Sprint-17 compiled
`dist` API process was found squatting port 4000 (the same recurring
pattern noted in every prior sprint's own report) and was killed before the
real dev server would bind.

1. **Debt Overview dashboard.** Rendered the real, live-computed metrics:
   Total Outstanding ₦57,946,251.84, Outstanding Principal
   ₦57,946,251.84, Outstanding Interest ₦0.00 (correctly reflecting that
   installment 1's interest was already fully paid), Monthly Debt Service
   and Upcoming Repayments (30d) both ₦3,053,748.16, Total Interest
   Scheduled ₦13,289,955.80, 1 Active Facility, Next Maturity 01/07/2028 —
   independently hand-checked against the seeded schedule.
2. **Capital Requirements.** "Packaging Machine Expansion" listed correctly:
   Equipment type, High priority, ₦60,000,000.00 required, Budget Coverage
   13.3% (₦8,000,000.00) — matching `8,000,000 / 60,000,000` exactly — and
   status Approved.
3. **Debt Facilities → detail.** "Bank Equipment Loan" (DEBT-000001, GTBank,
   Term Loan, Amortising, Monthly, 20%, Partially Repaid) opened correctly;
   balance cards (Original Principal ₦60,000,000.00, Total Drawn
   ₦60,000,000.00, Outstanding Principal ₦57,946,251.84) and the full
   24-row repayment schedule matched hand-computed amortization figures
   installment-by-installment.
4. **Overpayment rejection (brief's own explicit scenario).** Attempted a
   ₦100,000,000 principal repayment against the live facility via the
   Record Repayment form — the server rejected it with "Principal repayment
   of 100000000 exceeds outstanding principal of 57946251.84," rendered
   directly in the UI, no partial acceptance.
5. **Live repayment, end to end.** Submitted a real ₦2,087,977.30 principal
   repayment (installment 2's own principal figure) through the running
   UI. Outstanding Principal correctly dropped to ₦55,858,274.54; schedule
   installment 2 flipped to "Partially Paid" with `amountPaid` set exactly;
   the facility correctly remained `PARTIALLY_REPAID`.
6. **Direct database verification of the accounting treatment.** Queried
   the real Postgres database directly: `JE-000046` (drawdown) posted `DR
GTBank Current Account 60,000,000 / CR Loans Payable — Bank
60,000,000`; `JE-000047` (seed repayment) posted `DR Loans Payable
2,053,748.16 + DR Interest Expense 1,000,000 / CR GTBank Current
Account 3,053,748.16`; `JE-000048` (the live repayment from step 5)
   posted `DR Loans Payable 2,087,977.30 / CR GTBank Current Account
2,087,977.30` — every line exactly matching the brief's own worked DR/CR
   example. The full organisation Trial Balance summed to
   ₦105,513,287.46 debit = ₦105,513,287.46 credit, confirmed balanced.
   Exactly one `debt-facility.repaid` audit event existed — for the live
   API-driven repayment only, not the direct-write seed repayment,
   confirming audit logging fires from the real write path, not from seed
   data.
7. **Mobile responsiveness at 375px.** Debt Overview, Capital Requirements,
   Debt Facilities list, the Debt Facility detail page, and the Add Debt
   Facility create dialog were each confirmed to have zero page-level
   horizontal overflow (`document.documentElement.scrollWidth ===
window.innerWidth === 375` on every page); wide tables (the repayment
   schedule) scroll within their own container, the same convention every
   other wide table in this codebase already uses.

Idempotency, tenant isolation, RBAC, closed-period atomic rollback, and the
automatic `PAID_OFF` transition on full early repayment were each
additionally verified via the automated repository/service test suite
(§8) rather than re-driven manually through the browser, following the same
verification allocation every prior sprint in this session has used:
spot-check the highest-risk live scenarios (accounting correctness,
overpayment rejection, real balance computation), trust the already-green
automated suite for the rest.

## 10. Known Limitations

See `docs/domains/debt-management.md` §12 for the full list — no investment/
equity/bond management, no fixed asset register, no loan-application
workflow or credit scoring, no automatic loan approval or bank/payment-
gateway integrations, no collections system or automatic penalty interest,
no tax treatment of financing or full NPV/IRR/DCF engine, no financing-
allocation optimisation, and interest cannot be prepaid ahead of its own
schedule accrual (a documented consequence of the live-accrual balance
model, not a bug).

## 11. Deferred / Future Work

- The full Capital Decision Analysis engine (`docs/domains/
debt-management.md` §13) — monthly repayment/total interest/incremental
  cashflow/debt-service burden/projected cash balance/payback period/
  ROI/NPV/IRR/break-even/worst-case — reading this sprint's own
  `DebtFacility`/`DebtRepaymentSchedule`/`CapitalRequirement` data directly.
- A financing-allocation engine (debt vs. internal cash split).
- Modelling future planned drawdowns as forecast inflows, once a "planned
  drawdown date" field exists.
- A configurable-permission RBAC model — the same deferred decision as every
  prior sprint.

## 12. Documentation Updated

`docs/domains/debt-management.md` (new — full domain writeup), `docs/domains/
finance.md` (new §17 "Capital & Debt Management (Sprint 17)"), `docs/domains/
accounting.md` (new §26 "Capital & Debt Management (Sprint 17)," API
Reference/Known Limitations renumbered to §27/§28), `docs/domains/cashflow.md`
(§13 cross-reference to the `LOAN_REPAYMENT` outflow source), `docs/domains/
budgeting.md` (§13 cross-reference to debt service now flowing through
Budget vs Forecast automatically), `docs/domains/README.md` (new Capital &
Debt Management row), `docs/backlog.md` (new Epic), `docs/roadmap.md` (new
bullet), `docs/changelog.md` (new dated entry), root `README.md` (feature
list update), this completion report.

## 13. Constraint

Per this sprint's own explicit instruction, nothing in this sprint's work has
been committed or pushed.
