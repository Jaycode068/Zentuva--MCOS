# Budgeting & Financial Planning Domain

- **Status:** Foundation implemented — Sprint 16 ("Budgeting & Financial
  Planning Foundation"). A planning layer over Finance/Accounting/Cashflow —
  never a second accounting system. **Not** budget-vs-actual accounting, loan/
  debt/investment/capital management, or AI financial planning — see §11.
- **Sprint:** 16
- **Depends on:** [Accounting](accounting.md) (`getAccountBalances`, the
  normal-balance-sign-per-`AccountType` convention `FinancialStatementService`
  established in Sprint 13, reused unmodified for Budget vs Actual),
  [Cashflow](cashflow.md) (`CashflowForecastService.getForecast()`, reused
  directly for Budget vs Forecast — never a second forecast engine),
  [Identity](identity.md) (tenant boundary, `RolesGuard`, `AuditService`,
  `Organisation.fiscalYearStart`).
- **Explicitly does not depend on:** [Sales](sales.md), [Procurement](procurement.md),
  [Production](production.md), [Inventory](inventory.md) — Budgeting never
  reads or writes any of their tables, proven executably by
  `budgeting-independence.spec.ts` (`apps/api/src/finance/budgeting/`), not
  just documented here. It also never writes to any Invoice, SupplierInvoice,
  Payment, SupplierPayment, JournalEntry, CashAccount, CashTransaction, bank-
  reconciliation, or Cashflow table — the same spec asserts **zero**
  `postSystemJournalEntry` calls anywhere in this module.
- **See also:** [Finance](finance.md) §16, [Accounting](accounting.md) §23,
  [Cashflow](cashflow.md) §12, [Debt Management](debt-management.md) (a
  read-only consumer of this domain, §13), [Sprint 16 Completion Report](../sprint-16-completion-report.md),
  [Sprint 17 Completion Report](../sprint-17-completion-report.md).

## 1. Business Purpose

Sprint 13 answers "what happened." Sprint 15 answers "when will cash actually
move, based on what we already know." Neither answers "what did we plan to
earn and spend, and how does reality compare?" — that is budgeting. Sprint 16
closes that gap: an organisation defines a fiscal year's plan (revenue,
operating expenses, and capital expenditure, allocated by month and
optionally by cost centre), and the system compares it against actual General
Ledger results and against the Cashflow Forecast — never storing or
duplicating either.

The system must answer: _what did we plan? what have we actually earned/
spent? what is the variance? can we actually afford what we planned, based on
current cashflow?_

## 2. Critical Architectural Principle — Budgeting Is Not a Second Accounting System

`Budget`/`BudgetLine` hold only **planned** amounts. "Actual" always means a
live read of posted `JournalEntryLine` rows — nothing here is ever written
back into the Ledger, and nothing here caches or duplicates a balance. A
budget write (create, approve, activate, revise, close, a line upsert) never
calls `postSystemJournalEntry`; `budgeting-independence.spec.ts` proves this
structurally, not just by convention.

```
Budget (planned)          General Ledger (actual)      Cashflow Forecast
     │                          │                             │
     └────────── Budget vs Actual ──────────┘                 │
     │                                                         │
     └───────────── Budget vs Forecast ───────────────────────┘
```

## 3. A `Budget` Row Is Its Own Version — No Separate `BudgetVersion` Table

Every field a version needs to be distinguishable (`version` number,
`revisesBudgetId` pointing at the row it replaces, its own `status`) already
lives on `Budget` itself. Revising a budget creates a **new sibling row**
sharing the same `budgetCode`, one `version` higher — never an edit to the
row it revises. Activating the new version automatically flips the row it
supersedes from `ACTIVE` to `SUPERSEDED` (a status flip, never a delete — the
same "never rewrite history" convention `Payment.void()` established).
`revise()` also copies every current `BudgetLine` into the new version, so a
revision starts as a full, independently-editable copy rather than an empty
shell.

This was a deliberate simplification over the brief's own suggested
`BudgetVersion` join table: a join table would duplicate every field the
header row already carries, for no behavioural gain.

## 4. A `Budget` Row Is Also Its Own Scenario — No Separate `BudgetScenario` Table

`Budget.scenarioName` (default `"Base"`) distinguishes a what-if plan from
the real one. A "Growth" or "Conservative" scenario is a **sibling `Budget`**
— same `budgetCode` and `fiscalYear`, a different `scenarioName`, its own
independently-editable lines — and is deliberately **not** part of the
revision chain (`revisesBudgetId` is never set between scenarios). Only the
`scenarioName: "Base"` row is typically walked through the full
DRAFT→APPROVED→ACTIVE lifecycle and compared against actuals; other
scenarios can stay `DRAFT` indefinitely as pure comparisons.

This is a deliberate departure from re-using Sprint 15's `CashflowScenario`
(a delay-days/multiplier engine applied _on read_) for budget scenarios: a
budget scenario needs to change actual revenue/expense/CAPEX **amounts**
line-by-line ("Growth: revenue ₦46.8m" vs. "Base: ₦36m"), which a
multiplier-on-read model cannot express as directly as a genuinely separate
set of planned lines. Sprint 15's `CashflowScenario` **is** reused, directly,
for Budget vs Forecast (§9) — not duplicated, just applied to a different
question.

## 5. Budget Lifecycle

`BudgetStatus { DRAFT, APPROVED, ACTIVE, SUPERSEDED, CLOSED }` — no
`SUBMITTED` step: a single Owner/Administrator role already approves
everything in this codebase, so a submit-then-approve split has no second
approver to separate it from.

```
DRAFT ──approve──▶ APPROVED ──activate──▶ ACTIVE ──close──▶ CLOSED
  │                                          │
  └──────────────── (edit lines directly) ───┘
                                              │
                                         revise() ──▶ new DRAFT (v+1)
                                                       activating it flips
                                                       this row to SUPERSEDED
```

`DRAFT` is freely editable — both the header and every `BudgetLine`. Once
`APPROVED`, the budget (and every line) becomes read-only; the only path
forward is `revise()`, which produces a new, independently-editable `DRAFT`
version. Only one `ACTIVE` row may exist per `(budgetCode, scenarioName)`
lineage at a time — `activate()` supersedes whichever row currently holds
that status, inside the same transaction.

## 6. `BudgetLine` — Revenue, Operating Expense, and CAPEX

`BudgetLineType { REVENUE, OPERATING_EXPENSE, CAPEX }` is **user-declared** at
line-creation time, never derived automatically from the referenced account's
`AccountType` — a `REVENUE`-type account only ever backs a `REVENUE` line, but
an `EXPENSE`-type account could legitimately back either an OpEx line or a
CAPEX-adjacent one pending a future Fixed Assets module.

`chartOfAccountId` is **required** for `REVENUE`/`OPERATING_EXPENSE` (so
Budget vs Actual has a real GL row to compare against) and **optional** for
`CAPEX` — the seeded Chart of Accounts has no Fixed Asset/PP&E row anywhere
(confirmed by direct inspection before writing a line of code this sprint),
so most CAPEX items are discrete, budget-only line items with no ledger
counterpart yet. A CAPEX line _can_ reference an account, if one exists, in
which case it participates in Budget vs Actual exactly like a Revenue/OpEx
line.

`@@unique([budgetId, chartOfAccountId, costCentreId, periodMonth, lineType])`
— Postgres never collides two rows on a `NULL` column within a unique index
(the same semantics `ChartOfAccount.systemKey`/`CashflowForecastItem.
cashAccountId` already rely on), so this one constraint transparently
becomes two different behaviours for free: "one line per account+cost-centre
+month" for Revenue/OpEx (a re-`POST` upserts the amount — the monthly-grid
mental model, one cell = one row), while CAPEX items (`chartOfAccountId:
null`) never collide with each other at all — each is its own discrete,
independently-created item.

## 7. Cost Centres

`CostCentre` is a small, standalone master (`code`, `name`, `description`,
`status`) a `BudgetLine` may optionally tag itself with — never linked to the
Chart of Accounts, never a redesign of the accounting model around
dimensions. Seed data provides seven (Production, Procurement, Sales,
Distribution, Finance, Administration, Marketing).

## 8. Budget vs Actual

`GET /finance/budgets/:id/vs-actual` runs **one** `journalEntryLine.findMany`
per request — scoped to exactly the accounts this budget's own lines
reference, and to the budget's own `[startDate, endDate]` range — never a
whole-ledger scan, never one query per line or per month. Every fetched line
is bucketed into `(accountId, month)` totals in application code, then
converted to a signed "actual" using the exact same normal-balance-sign
convention Sprint 13's `FinancialStatementService` already established:
`REVENUE` accounts are credit-normal (`actual = credit − debit`); `EXPENSE`/
`COST_OF_SALES` accounts are debit-normal (`actual = debit − credit`).

- `variance = actual − budget`
- `variancePercent = budget === 0 ? null : (variance / budget) × 100` (never
  `NaN`/`Infinity` — the same null-safe convention as Sprint 13's
  `grossMargin`)
- `favourable`: for `REVENUE` lines, `actual ≥ budget` is favourable; for
  `OPERATING_EXPENSE`/`CAPEX` lines, `actual ≤ budget` is favourable — a
  plain per-line-type sign flip, never a rules engine.

CAPEX lines with no linked account are excluded from `accountVariance`
(nothing to compare against yet) and surfaced separately, budget-only, in
`capexWithoutAccount`.

## 9. Budget vs Cashflow Forecast — Genuine Sprint 15 Reuse

`GET /finance/budgets/:id/vs-forecast` calls Sprint 15's own
`CashflowForecastService.getForecast()` directly — already dependency-
injectable inside the same `FinanceModule` — with `bucketBy: 'monthly'` and,
if the budget carries an optional `cashflowScenarioId` (a plain nullable FK
to `CashflowScenario`), that scenario's id passed straight through. Zero
forecast logic is duplicated. Per forecast bucket:

- `budgetedExpenditure` — this budget's own `OPERATING_EXPENSE`+`CAPEX` lines
  falling in that month
- `forecastExpenditure` — the forecast bucket's own `outflows`
- `availableCash` — the forecast bucket's own `openingBalance` (cash on hand
  _before_ that period's own inflows/outflows — what a planned spend is
  actually measured against)
- `potentialShortfall = max(0, budgetedExpenditure − availableCash)`

Once a budget's `endDate` has already passed, there is no future to forecast
against — the endpoint returns `{applicable: false, reason: ...}` rather than
a misleading empty or zero-filled result.

## 10. Fiscal Year Integration

`Organisation.fiscalYearStart` (an `Int`, 1–12, default 1 = January — added
Sprint 3.4, never consumed by any domain before this sprint) is the single
source of truth every `Budget` respects. `computeFiscalYearRange(fiscalYear,
fiscalYearStartMonth)` (`apps/api/src/finance/budgeting/fiscal-year.ts`,
pure, unit-tested directly) derives `startDate`/`endDate` once at creation
and stores them on the row — the same explicit-range convention
`AccountingPeriod` already uses, never recomputed from `fiscalYear` alone
later. Quarterly and annual totals are always computed on read from the 12
monthly `BudgetLine` rows — never separately stored, never requiring a user
to keep duplicate figures in sync.

## 11. Known Limitations / Non-Goals

- **CAPEX items with no linked account can't be compared against actuals** —
  a documented consequence of no Fixed Assets module existing yet, not an
  oversight.
- **No budget approval workflow beyond a single Owner/Administrator role** —
  no `SUBMITTED` step, no multi-approver chain; a deliberate simplification
  matching this codebase's existing binary RBAC everywhere else.
- **No budgeting-specific permission tier** — RBAC remains binary
  (Owner/Administrator write, Member read), the same deferred decision as
  every other domain in this codebase.
- **No investment management, AI/ML financial planning, or advanced
  financial modelling** — debt management itself is now built (Sprint 17,
  §13), but the full capital-decision engine ([Debt Management](debt-management.md) §13) remains future work.
- **No payroll, expense management, tax management, procurement-commitment
  budgeting, or purchase-requisition budgeting.**
- **No caching of Budget vs Actual/Forecast** — both are recomputed live on
  every request, per this codebase's established "no premature caching"
  convention.

## 12. Future Extension Points

- **A configurable-permission RBAC model** — the same deferred decision as
  every prior sprint.
- **A Fixed Assets module** — once it exists, CAPEX lines could gain a
  required account reference and participate fully in Budget vs Actual, the
  same way Revenue/OpEx lines already do.
- **Aggregating the Budgets Overview across multiple simultaneously-active
  budgets.**

## 13. Capital & Debt Management — Built, Sprint 17

[Debt Management](debt-management.md) reads `Budget`/`BudgetLine` and
`CapitalRequirement`/`DebtFacility` directly, exactly as §11's own "future
extension point" predicted — and needed **zero code changes here** to do
it. A `DebtFacility`'s repayment schedule now flows into the same live
Cashflow Forecast `BudgetForecastService.getBudgetVsForecast()` already
composes (§9), so an active facility's debt service automatically raises a
budget's own `forecastExpenditure` figure — the Debt→Cashflow→Budget
composition falls out of the pre-existing chain for free. A
`CapitalRequirement` may also reference a `Budget`/`BudgetLine` directly
(read-only, for a live Budget Coverage % computation) — never mutating the
budget it references.
