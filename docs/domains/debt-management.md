# Capital & Debt Management Domain

- **Status:** Foundation implemented — Sprint 17 ("Capital & Debt Management
  Foundation"). Not a CRUD loan-management module — a `CapitalRequirement` →
  `DebtFacility` → `DebtDrawdown`/`DebtRepayment` chain that posts through the
  same General Ledger boundary every other domain uses, feeds the _existing_
  Cashflow Forecast as financing outflows, and prepares (without building) the
  data architecture a future capital-decision engine will need. **Not**
  investment/portfolio management, credit scoring, AI loan recommendations,
  automatic loan approval, bank API integrations, a collections system, or a
  full financial-modelling/NPV/IRR engine — see §12.
- **Sprint:** 17
- **Depends on:** [Accounting](accounting.md) (`postSystemJournalEntry`, the
  Sprint 12 "Path B" user-chosen non-system account pattern, reused a third
  time for `liabilityAccountId`/`interestExpenseAccountId`/
  `feeExpenseAccountId`), [Cash Management](cash-management.md) (`CashAccount`
  — every drawdown/repayment moves real cash through Sprint 14's own accounts,
  never a new cash system), [Cashflow](cashflow.md)
  (`CashflowForecastService.getForecast()`, extended in place with one new
  outflow source rather than a second engine), [Budgeting](budgeting.md)
  (`Budget`/`BudgetLine` — read-only references for Budget Coverage %, never
  mutated), [Identity](identity.md) (tenant boundary, `RolesGuard`,
  `AuditService`).
- **Explicitly does not depend on:** [Sales](sales.md), [Procurement](procurement.md),
  [Production](production.md), [Inventory](inventory.md) — Debt never reads
  or writes any of their tables, proven executably by
  `debt-independence.spec.ts` (`apps/api/src/finance/debt/`), not just
  documented here. The only legitimate dependency chains are Debt→Finance/
  Accounting→Cash and Debt→Budget→Cashflow Forecast.
- **See also:** [Finance](finance.md) §17, [Accounting](accounting.md) §26,
  [Cashflow](cashflow.md) §13, [Budgeting](budgeting.md) §13,
  [Sprint 17 Completion Report](../sprint-17-completion-report.md).

## 1. Business Purpose

Sprint 13 answers "what happened." Sprint 14 answers "what cash do we have."
Sprint 15 answers "what will happen to cash." Sprint 16 answers "what did we
plan." None of them answer "what capital do we need, how should we finance
it, and can we afford the repayment?" — that is debt. A `CapitalRequirement`
records _why_ money is needed (independent of any approved loan); a
`DebtFacility` is the financing agreement itself; `DebtDrawdown`/
`DebtRepayment` are the real cash events, posted through the same Ledger
boundary every other domain uses; a server-generated `DebtRepaymentSchedule`
feeds the existing Cashflow Forecast as financing outflows without
duplicating that engine.

```
WHAT HAPPENED           WHAT CASH DO WE HAVE      WHAT WILL HAPPEN
(Sprint 13)         ──▶ (Sprint 14)           ──▶ (Sprint 15, never persisted)
                                                          │
WHAT DO WE PLAN          WHAT CAPITAL DO WE NEED    HOW SHOULD WE FINANCE IT
(Sprint 16, Budget)  ──▶ (Sprint 17, CapitalReq) ──▶ (Sprint 17, DebtFacility)
                                                          │
                                              CAN WE AFFORD IT
                                    (Sprint 17 data foundation only —
                                     the full decision engine is future work)
```

## 2. Critical Architectural Principle — A Loan Is Not Revenue

When a business receives a loan, cash increases and a liability increases —
never revenue. Every posting in this domain preserves that distinction
explicitly:

```
Drawdown:              DR Cash                    CR Loan Payable
Principal repayment:   DR Loan Payable             CR Cash
Interest:               DR Interest Expense         CR Cash
Combined repayment:     DR Loan Payable + DR Interest Expense   CR Cash
```

No handler in this domain ever posts a drawdown against a Revenue-type
account — enforced by the same account-type validation described in §3.

## 3. No Single Global Loan Liability Account — Path B, Reused a Third Time

`DebtFacility.liabilityAccountId`/`.interestExpenseAccountId` and
`DebtRepayment.feeExpenseAccountId` are user-chosen, service-validated,
non-system `ChartOfAccount` rows (`onDelete: Restrict`) — the exact "Path B"
pattern Sprint 12 established for `SupplierInvoiceItem.debitAccountId` and
Sprint 16 reused unmodified for `BudgetLine.chartOfAccountId`. This lets one
organisation run "Short-Term Loans," "Director Loans," and "Bank Loans" as
genuinely different ledger accounts, never one collapsed global liability —
satisfying the brief's own "extend the existing mechanism rather than
creating arbitrary account IDs inside services" instruction with zero new
`SYSTEM_ACCOUNT_KEYS` entries. Validated at facility-creation time: the
liability account must be `LIABILITY`-typed, the interest-expense account
must be `EXPENSE`-typed, the fee-expense account (required only when
`feeAmount > 0`) must be `EXPENSE`-typed, and none may be a system account.

## 4. `CapitalRequirement` — the Business Case, Not Yet a Loan

`CapitalRequirement` records _why_ financing is needed, independent of
whether it is ever approved: `DRAFT → PROPOSED → APPROVED → FUNDED →
COMPLETED`, plus `CANCELLED`. It optionally references a `Budget`/
`BudgetLine`/`CostCentre` — read-only, never mutating the budget it
references. `GET :id/budget-coverage` computes, live, `budgetedAmount`
(the specific line's `amount` if `budgetLineId` is set, else the sum of
every `CAPEX` line in the referenced budget), `requiredAmount`, and
`coveragePercent = requiredAmount === 0 ? null : (budgetedAmount /
requiredAmount) × 100` — never stored, never written back to the budget.

## 5. `DebtFacility` Lifecycle — Approved Is Not Drawn

```
PROPOSED ──approve──▶ APPROVED ──(first drawdown)──▶ ACTIVE
                                                          │
                                          (first repayment, while ACTIVE)
                                                          ▼
                                                  PARTIALLY_REPAID
                                                          │
                                      (outstanding principal reaches 0)
                                                          ▼
                                                       PAID_OFF

PROPOSED/APPROVED ──cancel──▶ CANCELLED (never once drawn)
ACTIVE/PARTIALLY_REPAID ──mark-defaulted──▶ DEFAULTED (manual, Owner/Admin only)
```

`ACTIVE` is set automatically on the facility's _first_ `DebtDrawdown` —
never a manual transition, and never merely because a facility has been
proposed (the brief's own explicit instruction). `PARTIALLY_REPAID` is set
automatically on the first `DebtRepayment` while still `ACTIVE`. `PAID_OFF`
is set automatically once outstanding principal rounds to zero (0.01
tolerance) — the user never manually flips this status (§9). `DEFAULTED` has
no automatic detection — this is deliberately not a collections system (§12)
— it is a manual, Owner/Administrator-only flag.

## 6. A `PROPOSED` Facility Doubles as Its Own Financing Scenario

The brief asks for a way to model a proposed financing scenario (loan
amount/rate/tenor) without ever affecting real cash/GL/debt/budget data. No
second scenario table was built for this: a `PROPOSED` facility already gets
a full, real, generated `DebtRepaymentSchedule` at creation time (§7) — but
because the live Cashflow Forecast, GL, and debt balance only ever read
`ACTIVE`/`PARTIALLY_REPAID` facilities (§10, §13), a `PROPOSED` facility's
own schedule is structurally invisible to all of them, by construction, not
by a special-case filter bolted on top. `DebtAnalysisService.
previewFacilityImpact()` overlays that dormant schedule onto a real
`CashflowForecastService.getForecast()` call (optionally with a genuine
Sprint 15 `CashflowScenario` applied) to preview "what if we activated this"
— reusing both engines completely unmodified.

## 7. Repayment Schedule — Generated Once, in Full, at Facility Creation

`generateSchedule()` (`apps/api/src/finance/debt/repayment-schedule.ts`, a
pure, dependency-free function) computes the full installment table from the
facility's own `principalAmount` — never per-drawdown, never dynamically
reshaped as partial drawdowns occur. A documented, deliberate simplification
(the brief's own "not a full banking-grade engine" ceiling), not an
oversight. Interest is a simple periodic rate (`interestRatePercent / 100 /
periodsPerYear`) applied to the opening balance each period.

**Grace period (explicit, never silently assumed — brief's own instruction):**
during the grace window, interest continues to accrue and is due each
period; **no principal is due**. After grace ends, the facility's chosen
`repaymentMethod` governs the remaining `tenorMonths − graceMonths` periods.

`RepaymentMethod`:

- **AMORTISING** — a level periodic payment (annuity formula); the final
  installment absorbs any rounding residue so `closingPrincipal` lands
  exactly on zero.
- **INTEREST_ONLY** — interest only each period; the full principal is due
  on the final installment.
- **BULLET** — no principal or interest until the final installment, which
  carries the full principal plus that period's interest.

`RepaymentFrequency { MONTHLY, QUARTERLY, YEARLY }` — only `MONTHLY` carries
full worked-example test coverage this sprint (the brief's own stated
minimum); the date-stepping and period-rate math generalise to all three.

## 8. Debt Balance — Always Computed Live, Never Stored

`computeDebtBalance()` (`apps/api/src/finance/debt/debt-balance.ts`, a
plain, DI-free function — runs identically against a top-level
`PrismaService` or an in-flight `Prisma.TransactionClient`) derives every
figure from `DebtDrawdown`/`DebtRepayment`/`DebtRepaymentSchedule` rows —
nothing is ever cached or stored on `DebtFacility` itself:

- `totalDrawn = Σ DebtDrawdown.amount`
- `outstandingPrincipal = totalDrawn − Σ DebtRepayment.principalAmount`
  (drawn, not original principal — an under-drawn facility never appears to
  owe money it was never actually disbursed, per the brief's own Approved-
  vs-Drawn distinction)
- `interestAccrued = Σ DebtRepaymentSchedule.interestDue where dueDate ≤ asOf`
  — what is contractually due to date, regardless of what has been paid
- `outstandingInterest = max(0, interestAccrued − Σ DebtRepayment.interestAmount)`
- `totalOutstanding = outstandingPrincipal + outstandingInterest`

Because `interestAccrued` only counts installments whose `dueDate` has
already passed, a repayment attempting to pay interest on a not-yet-due
installment is rejected the same way an over-repayment is (§9) — interest
cannot be prepaid ahead of its own accrual in this sprint's model.

## 9. Over-Repayment and Early Payoff

A `DebtRepayment` is rejected (400) if `principalAmount` exceeds the current
`outstandingPrincipal`, or `interestAmount` exceeds the current
`outstandingInterest` — computed live via §8, inside the same transaction,
before posting. No silent partial acceptance. Early payoff needs no special
code path: paying the full outstanding principal in one repayment naturally
drives `outstandingPrincipal` to zero, which the automatic `PAID_OFF`
transition (§5) already handles — the user is never asked to manually change
the facility's status.

A single `DebtRepayment`'s combined principal+interest budget is applied
against unpaid `DebtRepaymentSchedule` installments **oldest-first**
(`installmentNumber` ascending), marking each `PAID` or `PARTIALLY_PAID`
until the budget is exhausted — a documented simplification versus a full
per-installment principal/interest allocation ledger.

## 10. Overdue Detection — a Lazy Sweep, Not a Scheduler

`DebtFacilityRepository.sweepOverdueSchedule()` mirrors
`InvoiceRepository.sweepOverdue()` exactly: any `SCHEDULED`/`PARTIALLY_PAID`
installment with `dueDate < today` and `amountPaid < totalDue` flips to
`OVERDUE` on every read of the schedule or the dashboard metrics — no
scheduler infrastructure, no background job. This is deliberately **not** a
collections system: the brief explicitly forbids automatically posting
penalty interest, and none is posted here.

## 11. Cashflow Integration — One New Outflow Source, Not a Second Engine

`CashflowForecastSourceType` gains one additive value, `LOAN_REPAYMENT`.
`CashflowForecastService.getForecast()` (Sprint 15's own file, extended in
place) gained a constructor dependency on `DebtFacilityRepository` and a new
read-only query, `findOutstandingScheduleForForecast()`, which returns every
unpaid installment (`status ≠ PAID`) for every `ACTIVE`/`PARTIALLY_REPAID`
facility — a `PROPOSED`/`APPROVED` facility contributes nothing (§6). Each
row becomes one `OUTFLOW` line at `max(dueDate, today)`, confidence
`CONFIRMED` (a scheduled loan repayment is a fixed contractual obligation —
more certain than AP's own `EXPECTED`). **Future drawdowns are not modelled
as forecast inflows this sprint** — there is no "planned drawdown date"
field to project from; documented as a deferred simplification, not an
oversight. A future scheduled repayment never becomes an actual
`DebtRepayment` row merely by appearing in the forecast — the forecast reads
the schedule, it never writes to it.

Because loan repayments now flow into the same live forecast Sprint 16's
`BudgetForecastService.getBudgetVsForecast()` already composes, an active
facility's debt service automatically raises a budget's own
`forecastExpenditure` figure — **no Budget-side code change was needed** for
this; it falls out of the pre-existing Debt→Cashflow→Budget composition
chain.

## 12. Known Limitations / Non-Goals

- **No investment portfolio, shares/equity, or bonds management.**
- **No fixed asset management** — a `DebtFacility` can finance equipment
  purchase, but there is no depreciation schedule or asset register here.
- **No full loan-application workflow, credit scoring, or AI loan
  recommendations** — a facility is created directly by an Owner/
  Administrator with the terms already agreed.
- **No automatic loan approval, bank API integrations, or payment gateway.**
- **No collections system or automatic penalty interest** — overdue
  installments are surfaced (§10), never automatically penalised.
- **No tax treatment of financing, full financial modelling/DCF, ROI/NPV/IRR
  engine, or automated financing optimisation** — see §13 for what a future
  sprint would build on top of this foundation.
- **No full capital project management** — a `CapitalRequirement` is a
  single record, not a multi-milestone project.
- **Interest cannot be prepaid ahead of its own schedule accrual** (§8) — a
  documented consequence of the live-accrual model, not a bug.
- **Financing-allocation engine** (e.g. "70% debt / 30% internal cash")
  explicitly deferred — `CapitalRequirement.budgetId`/`.budgetLineId` /
  `DebtFacility.capitalRequirementId` provide enough linkage to understand
  _why_ a facility exists, not to compute an optimal financing mix.
- **`previewFacilityImpact()` never states a verdict** — no "this loan is
  safe" or "the business should take this loan" phrasing anywhere in the
  API or UI; that requires the future decision-analysis engine below.

## 13. Future Decision Engine

A future capital-decision layer would combine Financial Statements, current
cash, AR/AP, the Cashflow Forecast, `Budget`/`BudgetLine` (planned CAPEX),
existing debt (`DebtFacility`/`DebtRepaymentSchedule`), and proposed new
loan terms into a full CAPITAL DECISION ANALYSIS — monthly repayment, total
interest, incremental cashflow, debt-service burden, projected cash balance,
minimum cash balance, payback period, ROI, NPV, IRR, break-even point, and
worst-case scenario. This sprint prepares the data architecture for that —
`DebtAnalysisService.previewFacilityImpact()`/`.getDebtMetrics()` are the
first, deliberately narrow, non-prescriptive steps — but does not build the
full intelligence layer.
