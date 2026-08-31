# Cashflow Management & Forecasting Domain

- **Status:** Foundation implemented — Sprint 15 ("Cashflow Management &
  Forecasting"). A forward-looking analytical layer over Finance/Accounting —
  never a second accounting system, and never budgeting (see §8). The forecast
  itself is **never persisted anywhere**; every figure is recomputed live, on
  every request.
- **Sprint:** 15
- **Depends on:** [Finance](finance.md) (`InvoiceRepository.
getOutstandingForAging()`, `SupplierInvoiceRepository.getOutstandingForAging()` —
  both reused unmodified from Sprint 13), [Cash & Bank Management](cash-management.md)
  (`CashAccountRepository`, `LedgerService.getAccountActivity` for Book Balance),
  [Identity](identity.md) (tenant boundary, `RolesGuard`, `AuditService`).
- **Explicitly does not depend on:** [Sales](sales.md), [Procurement](procurement.md),
  [Production](production.md), [Inventory](inventory.md) — the cashflow layer
  never reads or writes any of their tables, proven executably by
  `cashflow-independence.spec.ts` (`apps/api/src/finance/cashflow/`), not just
  documented here. It also never writes to any Invoice, SupplierInvoice, Payment,
  SupplierPayment, JournalEntry, CashTransaction, or bank-reconciliation table —
  the same spec asserts **zero** `postSystemJournalEntry` calls anywhere in this
  module, because the forecast posts nothing, ever.
- **See also:** [Finance](finance.md) §15, [Accounting](accounting.md) §20,
  [Cash & Bank Management](cash-management.md) §11,
  [Sprint 15 Completion Report](../sprint-15-completion-report.md).

## 1. Business Purpose

Sprint 13 answers "what happened" (P&L, Balance Sheet). Sprint 14 answers "how
much cash do we have, and where is it, right now." Neither answers the question
an owner actually loses sleep over: **how much cash are we likely to have next
month, and when might we run short?** Sprint 15 is that layer — a
forward-looking projection built from data that already exists (outstanding
customer/supplier invoices, Cash Account book balances, management's own known
future commitments), never a second bookkeeping system and never a prediction
engine.

The forecast structure, every period: **Opening Cash + Inflows − Outflows =
Closing Cash**, with one period's closing balance becoming the next period's
opening balance. An invoice's due date is an _expectation_, never a guaranteed
payment date — every screen that shows a forecast figure says so.

## 2. "Derive, Never Store" — Carried Forward From Sprint 13/14

The forecast result — every bucket, every total, every shortfall flag — is
**never written to the database**. `GET /finance/cashflow/forecast` recomputes
the entire projection on every call from:

- `InvoiceRepository.getOutstandingForAging(organisationId)` — Sprint 13's own
  AR aging query, reused byte-for-byte, zero new AR query code.
- `SupplierInvoiceRepository.getOutstandingForAging(organisationId)` — its exact
  AP mirror.
- `CashAccountRepository.findManyByOrganisation()` + `LedgerService.
getAccountActivity()` — Sprint 14's own Book Balance primitive, for Opening Cash.
- Four new models that hold only _raw inputs_, never a computed result:
  `CashflowForecastItem`, `CashflowScenario`, `CashflowForecastAdjustment`,
  `CashflowSettings`.

Because AR/AP outstanding balances are read live and never copied into a
forecast row, **double-counting a real transaction is structurally
impossible** — a customer's outstanding invoice and a management-entered
`CashflowForecastItem` live in genuinely disjoint data sources, not merely
de-duplicated by a runtime check.

## 3. `CashflowForecastItem` — One Model for Known Commitments and Recurring Items

A single model with a `recurrence` enum (`ONE_TIME | WEEKLY | MONTHLY |
QUARTERLY | YEARLY`) covers both concepts the brief names separately: a "known
future commitment" (e.g. a one-off equipment payment) is just a row with
`recurrence: ONE_TIME`; a "recurring item" (e.g. monthly factory rent) is the
same row type with `recurrence: MONTHLY`. Fields: `direction`
(`INFLOW`/`OUTFLOW`), `description`, `amount`, `currency`, `expectedDate`
(first occurrence), `recurrenceEndDate` (optional), `cashAccountId` (optional —
see §6), `status` (`ACTIVE`/`INACTIVE`), `notes`.

`sourceType` (`RECURRING_ITEM` vs. `MANUAL_FORECAST`) is **server-derived** from
`recurrence` at creation, never a separate user choice: `ONE_TIME →
MANUAL_FORECAST`, anything else `→ RECURRING_ITEM`. There is no `sourceId`
column — a `CashflowForecastItem` _is_ its own source.

This is explicitly **not** Expense Management: no claims, no approval workflow,
no budgeting — it is a lightweight place for management to enter a cash
commitment the accounting records don't already capture.

## 4. Confidence Classification — Server-Derived, Never a Prediction Model

Every forecast line item carries a `confidence` label, computed purely from its
source, never user-set and never an AI/ML score:

| Source                                    | Confidence  | Why                                                                                         |
| ----------------------------------------- | ----------- | ------------------------------------------------------------------------------------------- |
| AR-sourced (outstanding invoice)          | `CONFIRMED` | A real, issued, legally-owed document.                                                      |
| AP-sourced (outstanding supplier invoice) | `EXPECTED`  | Paying is more within the company's own timing control than a customer's obligation to pay. |
| `RECURRING_ITEM`                          | `EXPECTED`  | A known, committed obligation (e.g. rent).                                                  |
| `MANUAL_FORECAST`                         | `ESTIMATED` | Management's own guess, with no document behind it.                                         |

**Overdue-invoice clamping**: an invoice already past its due date is still
expected money — a naive future-only date filter would silently drop it. The
bucketing date used is `max(dueDate, today)`, so overdue amounts land in the
forecast's first bucket rather than vanishing.

## 5. `CashflowScenario` — Four Numeric Knobs, Not a Rules Engine

`inflowDelayDays` / `inflowMultiplier` (applied to every inflow item) and
`outflowDelayDays` / `outflowMultiplier` (every outflow item). Base is the
identity scenario (`{0, 1.0, 0, 1.0}`) — selecting no scenario behaves
identically to Base. Conservative/Optimistic are ordinary, user-editable rows
with different knob values, not protected "system" scenarios. This satisfies
"configurable adjustments" (brief §31) without building a rules engine or a
predictive model.

## 6. `CashflowForecastAdjustment` — Overriding the Forecast Without Touching the Record

An authorized user can override a single AR- or AP-sourced item's expected
date/amount for forecast purposes only. `CashflowForecastAdjustment` targets
`(sourceType: CUSTOMER_RECEIVABLE | SUPPLIER_PAYABLE, sourceId)` — the
`Invoice`/`SupplierInvoice` id — never a `CashflowForecastItem` (which the user
can just edit directly). `@@unique([organisationId, sourceType, sourceId])`: at
most one adjustment per source item, upserted via `PUT`.

**Layering order applied at forecast time**: raw `dueDate`/amount → the
organisation's default delay (`CashflowSettings`) → the per-item adjustment
(overrides date/amount outright, if one exists) → the selected scenario's
delay/multiplier (applied on top). The underlying `Invoice`/`SupplierInvoice`
row is **never written to** by any of this — `cashflow-independence.spec.ts`
asserts it structurally, and it is proven live in verification (§7 of the
completion report): adjusting CF-INV-0001's expected collection date/amount
changed the forecast, and the invoice's own `total` stayed exactly
₦8,000,000.00.

## 7. Bucketing

- **Weekly**: 7-day buckets starting today (`[today, today+6]`,
  `[today+7, today+13]`, …), the last bucket truncated at the horizon end.
- **Monthly**: bucket 1 = `[today, end of current month]` (partial), then one
  full calendar month per bucket, the last bucket truncated at the horizon end —
  the same "This Month" mental model `apps/web/src/lib/report-date-range.ts`
  already uses elsewhere in Finance.

Each bucket carries `{periodStart, periodEnd, label, openingBalance, inflows,
outflows, closingBalance, belowMinimumReserve, items[]}` — the drill-down list
of individual source transactions is returned inline in the same response
(brief's "drill down into a forecast period"), since per-organisation volume is
small enough that a separate detail endpoint isn't warranted.

## 8. Cash-Account-Level Forecast — No Teleporting Money

`Invoice`/`SupplierInvoice` carry no `cashAccountId` — money not yet collected
or paid cannot be attributed to a specific account. Two genuinely different
computations, not one parameterized query:

- **Consolidated (org-wide)**: opening = sum of every `ACTIVE` `CashAccount`'s
  Book Balance; inflows/outflows = all outstanding AR + all outstanding AP +
  every `CashflowForecastItem` (assigned to an account or not).
- **Per-account**: opening = that one account's own Book Balance;
  inflows/outflows = only `CashflowForecastItem`s explicitly assigned to that
  `cashAccountId`. AR/AP is deliberately excluded from any single account's own
  view — a documented limitation, not a guess.

## 9. Minimum Cash Reserve and Shortfall Detection

`CashflowSettings` (one row per organisation): `minimumCashReserve`,
`defaultCollectionDelayDays`, `defaultPaymentDelayDays`. Per-bucket:
`belowMinimumReserve = closingBalance < minimumCashReserve`. Top-level:
`shortfallDetected = any bucket flagged`, `lowestProjectedCash = min(opening
balance, every bucket's closing balance)`.

Wording is deliberate throughout the UI and this document: a shortfall means
_"projected cash is below the management-defined safety threshold,"_ never a
claim of insolvency.

## 10. What This Domain Never Does

Enforced structurally by `cashflow-independence.spec.ts`, not just documented:

- Never writes to `Invoice`, `SupplierInvoice`, `Payment`, `SupplierPayment`,
  `JournalEntry`/`JournalEntryLine`, `CashTransaction`,
  `BankStatementTransaction`/`BankStatementImport`, `BankReconciliation`/
  `ReconciliationMatch`, or `CashAccount`.
- Never calls `postSystemJournalEntry` — the forecast posts nothing, ever.
- Never imports a Sales, Inventory, Procurement, or Production service,
  controller, or module.
- Never changes an AR/AP balance — an adjustment changes only what the
  _forecast_ projects, never the invoice it references.

## 11. Non-Goals (Explicitly Out of Scope This Sprint)

- **Budgeting / budget-vs-actual** — a different question ("what do we plan to
  earn/spend") from cashflow's ("when will money actually move"). Deferred to a
  future Budgeting sprint.
- **Loan, debt, investment, or capital management** — the source-type model
  (`CashflowForecastSourceType`) is deliberately extensible (a future
  `LOAN_PROCEEDS` value could be added without a schema redesign), but no such
  feature exists yet.
- **AI/ML forecasting or credit scoring** — confidence classification is a
  fixed lookup, not a model; scenarios are fixed numeric knobs, not a
  simulation engine.
- **Expense management or payroll.**
- **Bank API / Open Banking / payment gateway integrations** — this domain
  reads Cash Account book balances Sprint 14 already exposes; it does not talk
  to any external banking system itself.
- **Treasury management or advanced financial modelling.**
- **A configurable module-level permission engine** — RBAC remains binary
  (Owner/Administrator write, Member read), the same deferred decision as every
  other domain in this codebase.

## 12. Future Extension Points

- **Investment management** — would add a further `CashflowForecastSourceType`
  value and reuse the same bucketing/confidence machinery; no redesign of
  this layer required.
- **A configurable-permission RBAC model** — the same deferred decision as
  every prior sprint.
- **CSV/print export of a forecast** — a cheap follow-up on top of the existing
  `GET /finance/cashflow/forecast` response, the same pattern Sprint 13 used for
  its own reports.
- **Budget vs Forecast — built, Sprint 16.** `CashflowForecastService.
getForecast()` is now also called directly by [Budgeting](budgeting.md)'s
  `BudgetForecastService`, confirming this engine was already reusable by a
  planning layer without any change to this file's own code — see
  budgeting.md §9.
- **Loan repayments as financing outflows — built, Sprint 17.**
  `CashflowForecastSourceType` gained one additive value, `LOAN_REPAYMENT`;
  `getForecast()` now also reads every outstanding `DebtRepaymentSchedule`
  installment for `ACTIVE`/`PARTIALLY_REPAID` `DebtFacility` rows as
  `CONFIRMED` outflows — the exact extension this section predicted, with no
  redesign of the bucketing/confidence machinery itself. A `PROPOSED`/
  `APPROVED` facility contributes nothing (excluded by the same status
  filter). Future planned drawdowns are **not** modelled as inflows this
  sprint — see [Debt Management](debt-management.md) §11.
