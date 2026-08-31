# Changelog

All notable, user-facing or significant changes to Zentuva are documented here, per
[Handbook Principle 7](handbook/engineering-handbook.md#5-product-principles).

## [Unreleased]

_Nothing yet._

## [Sprint 17 Capital & Debt Management Foundation] - 2026-08-31

### Added

- **`CapitalRequirement` (Finance) — the business case for financing, not
  yet an approved loan.** Lifecycle `DRAFT → PROPOSED → APPROVED → FUNDED →
COMPLETED`, plus `CANCELLED`; optionally references a `Budget`/
  `BudgetLine`/`CostCentre` for a live, read-only Budget Coverage %
  computation — never mutates the budget it references.
- **`Lender` (Finance)** — a lightweight master (bank, financial
  institution, investor, director, shareholder, other), no full CRM.
- **`DebtFacility` — the financing agreement itself.** Lifecycle `PROPOSED →
APPROVED → ACTIVE → PARTIALLY_REPAID → PAID_OFF`, plus `CANCELLED`/
  `DEFAULTED`; `ACTIVE` is set automatically on the first real
  `DebtDrawdown`, `PARTIALLY_REPAID` on the first `DebtRepayment`,
  `PAID_OFF` automatically once outstanding principal rounds to zero — never
  a manual status flip. No single global loan liability account:
  `liabilityAccountId`/`interestExpenseAccountId` are user-chosen,
  service-validated non-system Chart of Accounts rows, the Sprint 12 "Path
  B" pattern reused a third time.
- **Server-generated repayment schedule** — computed once, in full, at
  facility creation from `principalAmount` (Amortising/Interest-Only/
  Bullet, `Monthly`/`Quarterly`/`Yearly`), with an explicit, documented
  grace-period behaviour (interest-only, no principal due) — never silently
  assumed.
- **`DebtDrawdown`/`DebtRepayment` — real cash events, posted through the
  existing General Ledger boundary.** A drawdown posts `DR <cash account's
own Chart of Accounts row> / CR <facility's liability account>`; a
  repayment posts `DR Loan Payable [+ DR Interest Expense] [+ DR Fee
Expense] / CR Cash` — principal, interest, and fees always split, never
  one collapsed amount. Over-repayment (beyond outstanding principal or
  accrued interest) is rejected server-side; early full repayment
  auto-transitions the facility to `PAID_OFF`.
- **Debt balance always computed live, never stored** — derived from
  `DebtDrawdown`/`DebtRepayment`/`DebtRepaymentSchedule` rows on every
  request, the same "no premature caching" discipline every prior Finance
  sprint has followed.
- **A `PROPOSED` facility doubles as its own financing-scenario preview** —
  it carries a full generated schedule but is structurally invisible to the
  live Cashflow Forecast/General Ledger/debt balance until an actual
  drawdown activates it. `DebtAnalysisService.previewFacilityImpact()`
  overlays that dormant schedule onto a real Cashflow Forecast call
  (optionally with a genuine Sprint 15 scenario applied) to preview "what if
  we activated this" — never phrased as a recommendation or safety verdict.
- **Cashflow Forecast integration** — `CashflowForecastSourceType` gains one
  additive value, `LOAN_REPAYMENT`; outstanding schedule installments for
  `ACTIVE`/`PARTIALLY_REPAID` facilities now appear in the existing forecast
  as `CONFIRMED` financing outflows, which in turn flow into Sprint 16's
  Budget vs Forecast automatically — no Budget-side code change was needed.
- **Admin surface** — three new tabs (Debt Overview dashboard, Capital
  Requirements, Debt Facilities); a Debt Facility detail page with a
  balance summary, the full repayment schedule, Record Drawdown/Record
  Repayment forms, lifecycle actions, and a Preview Cashflow Impact panel.

### Notes

Zero new `SYSTEM_ACCOUNT_KEYS`. Structural independence from Sales/
Inventory/Procurement/Production proven executably by
`debt-independence.spec.ts`. See
[`docs/domains/debt-management.md`](domains/debt-management.md) and
[`docs/sprint-17-completion-report.md`](sprint-17-completion-report.md).

## [Sprint 16 Budgeting & Financial Planning Foundation] - 2026-08-30

### Added

- **`Budget` (Finance) — a fiscal-year plan that is its own version _and_ its
  own scenario.** No separate `BudgetVersion`/`BudgetScenario` tables:
  `version`+`revisesBudgetId` distinguish revisions (a new sibling row,
  copying every current line, never overwriting the one it replaces —
  activating it supersedes the prior `ACTIVE` row instead), and
  `scenarioName` distinguishes a what-if plan (e.g. "Growth") from `"Base"`,
  a sibling sharing the same `budgetCode` that never touches another
  scenario's lines. Lifecycle: `DRAFT → APPROVED → ACTIVE → CLOSED`, plus an
  automatic `SUPERSEDED` on revision-activation.
- **`BudgetLine` — Revenue, Operating Expense, and CAPEX.**
  `chartOfAccountId` is required for Revenue/Operating Expense (a real
  General Ledger row to compare against) and optional for CAPEX (no seeded
  Fixed Asset account exists yet). A single unique constraint gives both
  "one line per account+cost-centre+month" upsert behaviour (the monthly-
  grid mental model) and unlimited independent CAPEX items, for free, via
  Postgres's own NULL semantics.
- **`CostCentre` (Finance)** — a small, standalone budget-line tag (e.g.
  "Production," "Sales"), never linked to the Chart of Accounts.
- **Budget vs Actual — never a second accounting system.** One
  `JournalEntryLine` query per budget, scoped to exactly the accounts it
  references and its own fiscal-year date range, converted to a signed
  actual using the exact normal-balance-sign convention Sprint 13's
  Financial Statements already established. Null-safe variance percent
  (never `NaN`/`Infinity`), and a per-line-type favourable/unfavourable flag
  (higher-than-budget is good for Revenue, bad for Operating Expense/CAPEX).
- **Budget vs Cashflow Forecast — genuine Sprint 15 reuse.** Calls Sprint
  15's own `CashflowForecastService.getForecast()` directly; a budget's
  optional pairing with a Sprint 15 `CashflowScenario` flows straight
  through. Zero forecast logic duplicated.
- **`Organisation.fiscalYearStart` gets its first real consumer.** Added
  Sprint 3.4, never read by any domain before this sprint — every `Budget`'s
  `startDate`/`endDate` is now derived from it at creation and stored, the
  same explicit-range convention `AccountingPeriod` already uses.
- **Admin `/settings/finance/{budgets, cost-centres}`.** Two new tabs: a
  Budgets list (with an Overview strip sourced from the currently `ACTIVE`
  budget's own Budget vs Actual, and a create dialog) and Cost Centres. A
  full Budget detail page (`/settings/finance/budgets/[id]`, not a tab) —
  status-gated lifecycle actions, an editable monthly grid per line type
  while `DRAFT` (with an inline "Add Line" mini-form and client-computed
  quarterly/annual totals), a CAPEX section, Budget vs Actual, Budget vs
  Forecast (a budgeted-vs-forecast-expenditure chart plus a shortfall-
  flagged table), and a Scenario Comparison table when siblings exist.
- **`budgeting-independence.spec.ts`** — a new structural guard: zero
  `postSystemJournalEntry` calls anywhere in the module, no forbidden-table
  writes (including every Cash/Cashflow table), and no Sales/Inventory/
  Procurement/Production import.

### Verified

- Full backend suite: 1010 tests / 120 suites (up from 953/110), including
  `budgeting-independence.spec.ts` and repository/service tests for the
  full lifecycle (create/approve/activate/close/revise), the account-type-
  eligibility and fiscal-month-range guards on every line write, and the
  Budget vs Actual/Forecast computations against hand-built fixtures.
- Live end-to-end verification against the real Boby Bites dev environment:
  the seeded "2026 Operating Budget" (Base, `ACTIVE`) showed real, live
  numbers on Budget vs Actual — Revenue Budget ₦36,000,000.00 vs. Actual
  ₦15,053,800.00 (the real `4100 Product Sales` ledger balance), matching a
  direct Trial Balance cross-check exactly. Budget vs Forecast showed
  October 2026's forecast expenditure at ₦21,500,000 — directly traceable to
  Sprint 15's own seeded ₦20,000,000 equipment payment — and real projected
  shortfalls in November/December, proving live composition of Sprint 15's
  forecast engine rather than a parallel calculation. Editing a `DRAFT`
  sibling scenario's grid cell saved on blur and left the Trial Balance
  completely unaffected. Revising the `ACTIVE` budget produced a new `DRAFT`
  v2 while v1 stayed `ACTIVE` and unchanged; the audit log showed exactly
  one new `budget.revised` row. RBAC verified live: a Member JWT got `200`
  on reads and `403` on writes; an unauthenticated request got `401`.
  Verified responsive at 375px.
- Zero new database migrations beyond the additive Sprint 16 models — no
  changes to any pre-existing model, and no new `SYSTEM_ACCOUNT_KEYS`, since
  this domain posts nothing.

## [Sprint 15 Cashflow Management & Forecasting] - 2026-08-30

### Added

- **Cashflow Forecast (Finance) — never persisted, recomputed live on every
  request.** `GET /finance/cashflow/forecast` computes Opening Cash + Inflows
  − Outflows = Closing Cash across configurable weekly/monthly buckets and
  30/60/90/180/365-day horizons, sourced entirely from data that already
  exists: outstanding AR/AP (Sprint 13's own `getOutstandingForAging()`
  queries, reused byte-for-byte, zero new AR/AP query code) and Cash Account
  Book Balances (Sprint 14's own `LedgerService.getAccountActivity`). This is
  explicitly **not** budgeting — a different question ("what do we plan to
  earn/spend" vs. "when will money actually move").
- **`CashflowForecastItem` (Finance)** — one model for both a management-
  entered one-time known commitment (e.g. a planned equipment payment) and a
  recurring item (e.g. monthly rent), distinguished by a `recurrence` enum
  (`ONE_TIME|WEEKLY|MONTHLY|QUARTERLY|YEARLY`). `sourceType` is server-derived
  from `recurrence`, never a separate user input. Because AR/AP items are
  synthesized live and never copied into this table, a real transaction can
  never be double-counted — a structural guarantee, not a de-dup check.
- **Confidence classification** — server-derived, never AI/ML: an outstanding
  customer invoice is `CONFIRMED`, an outstanding supplier invoice or a
  recurring item is `EXPECTED`, a manual one-time item is `ESTIMATED` —
  matching the brief's own worked examples exactly. An invoice already past
  its due date is bucketed at `max(dueDate, today)` rather than silently
  dropped.
- **`CashflowScenario` (Finance)** — Base/Conservative/Optimistic-style named
  sets of an inflow/outflow delay-days-plus-multiplier adjustment, applied on
  top of the base forecast. Four configurable numeric knobs only, never a
  rules engine or a predictive model; Base is the identity scenario.
- **`CashflowForecastAdjustment` (Finance)** — lets an authorized user
  override a single AR/AP-sourced forecast item's expected date/amount for
  forecasting purposes only. The underlying `Invoice`/`SupplierInvoice` row is
  never written to — proven both structurally (`cashflow-independence.spec.ts`)
  and by live verification (the source invoice's own total was confirmed
  unchanged after saving an adjustment, and the Trial Balance still balanced
  exactly).
- **`CashflowSettings` (Finance)** — a configurable minimum cash reserve and
  default collection/payment delay days, one row per organisation. A period
  projected below the reserve is flagged, worded throughout as a planning
  signal ("projected cash is below the management-defined safety threshold"),
  never a claim of insolvency.
- **Cash-account-level forecast** — a consolidated (org-wide) view and a
  per-account view are genuinely different computations, never one query that
  could imply money moves between accounts; `Invoice`/`SupplierInvoice` carry
  no `cashAccountId`, so AR/AP is deliberately excluded from any single
  account's own bucketed view (documented, not silently guessed).
- **Admin `/settings/finance/{cashflow, cashflow-items, cashflow-scenarios}`.**
  Three new tabs: the Cashflow dashboard (shortfall warning banner, 5 summary
  cards, horizon/bucket/scenario selectors, a closing-balance-vs-minimum-
  reserve chart with shortfall buckets tinted, an inflows-vs-outflows-per-
  period chart, a click-to-expand per-period table with an inline drill-down
  of individual source items and an "Adjust" action on AR/AP rows, and a
  cash-account breakdown); Cashflow Items (management-entered commitments +
  the Cashflow Settings card); Cashflow Scenarios.
- **`cashflow-independence.spec.ts`** — a new, stricter structural guard: zero
  `postSystemJournalEntry` calls anywhere in the module (the forecast posts
  nothing, ever), no forbidden-table writes across all 14 cashflow files, and
  no Sales/Inventory/Procurement/Production import.

### Verified

- Full backend suite: 953 tests / 110 suites (up from 892/99), including
  `cashflow-independence.spec.ts` and a 32-test forecast-engine spec covering
  every horizon, both bucket modes, AR/AP integration, recurring-item
  expansion, adjustments, scenarios, minimum-reserve shortfall detection, and
  consolidated-vs-per-account forecasting.
- Live end-to-end verification against the real Boby Bites dev environment,
  reproducing the brief's own worked scenario exactly: an ₦8,000,000 customer
  invoice due in 14 days, an ₦5,000,000 supplier invoice due in 10 days,
  ₦1,500,000 monthly rent, and a ₦4,000,000 manual expected collection — the
  Week 3 bucket's inflow landed at exactly ₦12,000,000.00, independently
  confirming both amounts landed in the same weekly bucket as the brief
  implies. A deliberately large one-time ₦20,000,000 planned equipment payment
  demonstrated both a healthy forecast (weeks 1-6, above the ₦5,000,000
  minimum reserve) and a real, correctly-flagged shortfall (every bucket from
  week 7 onward) in one coherent seed scenario. A live forecast adjustment on
  the ₦8,000,000 invoice moved it to a later bucket and reduced its amount —
  the source invoice itself was confirmed completely unchanged immediately
  afterward, the Trial Balance still balanced exactly, and exactly one new
  `cashflow.forecast-adjustment.created` audit row was found. Scenario
  switching (Optimistic, 1.15× inflow multiplier) changed Forecast Closing
  Cash live with no Finance record touched. RBAC verified live against the
  real API: a Member JWT got `200` on the forecast read and `403` on a write;
  an unauthenticated request got `401`. Verified responsive at 375px — one
  real mobile overflow bug (a bucket row's "Below Reserve" badge running off
  -screen) was found and fixed (`flex-wrap` added) during this check.
- Zero new database migrations beyond the additive Sprint 15 models — no
  changes to any pre-existing model, and no new `SYSTEM_ACCOUNT_KEYS`, since
  this domain posts nothing.

## [Sprint 14 Cash & Bank Management / Reconciliation Foundation] - 2026-08-30

### Added

- **`CashAccount` (Finance) — the cash/bank account master.** Every bank account,
  petty cash drawer, or settlement account the organisation actually holds money
  in, each linked to its own dedicated, non-system Chart of Accounts row —
  auto-provisioned at creation as a child of the org's `CASH`/`BANK`/
  `CASH_BANK_PARENT` (new) system account, never the generic system account itself
  (which would collapse every bank's book balance into one shared figure).
  `accountNumber` is stored in full but only ever returned masked
  (`accountNumberMasked`, last 4 digits); the full value is reachable only via a
  separate, Owner/Administrator-only `GET .../account-number` reveal endpoint whose
  own audit event carries no metadata payload.
- **Opening balance.** Supplying one at `CashAccount` creation atomically posts
  `DR <the new dedicated CoA row> / CR Opening Balance Equity` (a new system key
  elevating the already-seeded "3100 Owner's Capital" row) through the same
  `postSystemJournalEntry` boundary every other domain uses — idempotent,
  period-aware, RBAC-protected, and rolled back together with the account/CoA
  creation on any failure.
- **`Payment`/`SupplierPayment` gained an optional `cashAccountId`.** When set,
  the cash-side posting line targets that account's own dedicated CoA row instead
  of the generic `CASH`/`BANK` system account resolved from `method`; when
  omitted, posting is byte-for-byte identical to pre-Sprint-14 behaviour — no
  existing flow, fixture, or test needed to change.
- **`CashTransaction` (Finance)** — cash movements outside the existing Payment/
  Supplier Payment flows (a bank charge, a petty cash payment, a miscellaneous
  receipt), posting `RECEIPT`/`PAYMENT` against an explicit, user-chosen,
  non-system "Contra Account" — the same Path B policy `SupplierInvoiceItem.
debitAccountId` (Sprint 12) already established.
- **Bank Statement Import (CSV).** Client-side column mapping (`papaparse`) lets
  the user map arbitrary CSV headers to Zentuva fields (`Transaction Date`,
  `Description`, `Debit`, `Credit`, `Reference`, etc.) since not every bank
  exports the same columns; the backend independently re-validates every row and
  applies two independent duplicate-detection layers (a deterministic content
  hash, and — where supplied — a stable external reference), skipping and
  reporting duplicates rather than hard-failing the batch.
- **`BankReconciliation`/`ReconciliationMatch` (Finance) — the core feature of
  this sprint.** A session for one `CashAccount` over one free bank-statement
  period; `ReconciliationMatch` references a `JournalEntryLine.id` directly
  (never `Payment`/`SupplierPayment`/`CashTransaction` polymorphically) — the
  literal embodiment of "the GL remains the source of truth." A bulk "Auto-match
  Exact" action matches only unambiguous same-date/same-amount pairs; anything
  else is matched manually. `complete()` requires zero unmatched bank/book items
  — never a silent "force the books to equal the bank" — and a session becomes
  immutable once `COMPLETED`; reopening one is explicit deferred work. Only one
  `IN_PROGRESS` session per `CashAccount` is permitted at a time.
- **Book Balance vs. Reconciled Balance vs. Unreconciled Difference** — the
  central UX distinction this sprint exists to make obvious. Book Balance is
  always live via `LedgerService.getAccountActivity` (unchanged since Sprint
  7/13); Reconciled Balance is the most recent `COMPLETED` session's own
  `closingBankBalance`; neither is ever labelled "available cash."
- **Admin `/settings/finance/{cash, cash-accounts, cash-transactions,
bank-statements, reconciliation}`.** Five new tabs: a Cash Position Dashboard
  (Total Cash, Bank Balances, Cash on Hand, Unreconciled, Recent Transactions,
  Accounts Requiring Reconciliation); a Cash Account list + full detail page per
  account (Book/Reconciled/Unreconciled strip, masked number + reveal, recent
  activity, reconciliation history, statement imports); a Cash Transaction ledger;
  a CSV import wizard (pick file → map columns → preview → commit); and a
  Reconciliation workspace (Matched/Unmatched Bank/Unmatched Book panels, a live
  Difference strip, Auto-match, click-to-select manual match, Complete). The
  existing Sprint 13 Management Dashboard gained two small cross-link cards
  (Total Cash, Unreconciled) rather than a second, busier dashboard bolted on.
- **`cash-independence.spec.ts`** — a new structural guard (mirrors `reports-
independence.spec.ts`'s technique): no Cash & Bank file writes a Sales/Inventory/
  Procurement/Production table, no file writes `JournalEntry`/`JournalEntryLine`
  directly (every posting goes through `postSystemJournalEntry`), and
  `BankReconciliation` itself posts nothing at all.

### Verified

- Full backend suite: 892 tests / 99 suites (up from 852/91), including
  `cash-independence.spec.ts` and repository-level tests for `CashAccount`
  provisioning/opening-balance posting, `CashTransaction` posting/validation,
  bank-statement import/deduplication, and the full reconciliation lifecycle
  (create/match/auto-match/unmatch/complete).
- Live end-to-end verification against the real Boby Bites dev environment: GTBank/
  Access Bank/Petty Cash cash accounts (seeded), a customer payment recorded into
  GTBank's own dedicated Chart of Accounts row (confirmed via Trial Balance — the
  generic `1120 Bank` system account stayed completely untouched), a CSV bank
  -statement import via the real API, an in-progress reconciliation session
  resolved live (a new `CashTransaction` recorded to match an unmatched bank fee,
  a follow-up statement row imported to match an unmatched book transaction),
  bulk auto-match, and a full Complete — the session became immutable immediately
  afterward. Trial Balance continued to balance exactly throughout, with zero
  duplicate journal entries. The audit trail for the account-number reveal action
  carried no metadata payload. Verified responsive at 375px on the reconciliation
  workspace and the Cash Overview dashboard.
- Zero new database migrations beyond the additive Sprint 14 models/columns and
  two elevated system accounts (`CASH_BANK_PARENT`, `OPENING_BALANCE_EQUITY`) —
  the same "elevate an already-seeded row" backfill pattern Sprint 9 used for
  `FINISHED_GOODS_INVENTORY`.

## [Sprint 13 Financial Statements & Management Reporting Foundation] - 2026-08-30

### Added

- **`FinancialStatementService` (Finance) — Profit & Loss and Balance Sheet.**
  Derives both purely from `ChartOfAccount.type` via normal-balance-sign summation
  over posted `JournalEntryLine`s (Asset/Cost-of-Sales/Expense are debit-normal,
  Liability/Equity/Revenue are credit-normal) — **zero schema changes**, contra
  accounts (`SALES_RETURNS`) net automatically with no "contra" flag. `GET
/api/finance/reports/profit-loss` (`?from=&to=&accountingPeriodId=&compare=
previous_period`) returns Revenue/Cost of Sales/Gross Profit/Gross Margin
  (null-safe, never `NaN`/`Infinity`)/Operating Expenses/Net Profit, optionally
  alongside the immediately-preceding period of identical length (`previous: null`,
  never a misleading zero, when that period has no posted activity at all). `GET
/api/finance/reports/balance-sheet` (`?asOf=`) returns Assets/Liabilities/Equity
  plus a computed, non-posted **"Retained Earnings (Undistributed)"** line (all-time
  net profit since inception) that makes `Assets = Liabilities + Equity` hold exactly
  by construction — no year-end-closing mechanism was built.
- **AR/AP Ageing.** New `getAgingReport()` on the existing `AccountsReceivableService`/
  `AccountsPayableService` — `GET /api/finance/receivables/aging` and `GET
/api/finance/accounts-payable/aging` (`?asOf=`) bucket every outstanding invoice
  into Current/1-30/31-60/61-90/90+ by days past due, with a per-customer/per-supplier
  breakdown. AP's report additionally surfaces the current `GRNI_PENDING_APPROVAL`
  balance and a count of `DISCREPANCY`-matchStatus invoices.
- **`InventoryValuationService`/`ReconciliationService` (Finance) — new, narrow,
  read-only exception.** `GET /api/finance/reports/inventory-valuation`
  (`?locationId=&productType=`) computes `Σ(InventoryStock.quantityOnHand ×
averageUnitCost)` by reading `InventoryStock` directly (read-only, no transaction,
  no `InventoryModule` import — `finance-independence.spec.ts` needed zero changes).
  `GET /api/finance/reports/reconciliation` compares that subledger total against the
  GL's `INVENTORY + FINISHED_GOODS_INVENTORY` balances (`WIP` deliberately excluded —
  no corresponding `InventoryStock` row) and **surfaces, never auto-corrects, any
  difference** — live verification against this codebase's own accumulated Sprint
  8-12 test data found and correctly surfaced a real ₦1,613,200.00 discrepancy.
- **Revenue/COGS reporting.** `GET /api/finance/reports/revenue` and `/cogs` pair a
  GL-tied headline total (always authoritative, ties to the P&L) with a supplementary
  by-product/by-customer breakdown (`Invoice`/`InvoiceItem` for revenue, a new
  `SalesFulfilmentRepository.getCogsBreakdownByProduct()` for COGS) — the breakdown is
  never treated as a second source of truth for the headline figure.
- **Management Dashboard.** `GET /api/finance/reports/dashboard`
  (`?from=&to=&compare=previous_period`) composes — never recomputes — P&L totals,
  AR/AP summaries, and Inventory Valuation's grand total, plus a small Operational
  section (Sales Orders count/value, Production Runs Completed via
  `ProductionRun.completedAt`). The existing `/settings/finance` Overview page was
  upgraded in place into this dashboard: Financial cards, an Operational section, and
  two `recharts` bar charts (Revenue vs COGS vs Gross Profit; AR vs AP) — the first
  charting library in this codebase, deliberately used in exactly two places.
- **`AccountActivityDialog` (Admin).** New reusable component completing the
  drill-down chain `Statement → Account → Ledger Activity → Journal Entry Detail`,
  opened from clickable account lines on the new Profit & Loss, Balance Sheet, and
  Trial Balance pages. Required a small bug fix: `LedgerLine` gained a
  `journalEntryId` field (the parent `JournalEntry`'s own id — previously only the
  line's own id was exposed, with no way to open the entry it belonged to).
- **Trial Balance `netBalance`/`systemKey` fields** — purely additive; the underlying
  query is now the same shared `getAccountBalances` helper both Trial Balance and the
  new Financial Statements use, so a balance is never computed two different ways.
- **Admin `/settings/finance/profit-loss`, `/balance-sheet`, `/inventory-valuation`.**
  Period-preset filters (`report-date-range.ts`), Print buttons (`window.print()`),
  and (Balance Sheet) an inline Reconciliation block with a "Requires investigation"
  warning badge when the subledger and GL disagree. Receivables/Payables pages gained
  an Ageing section (bucket cards + breakdown table) below their existing lists.

### Verified

- Full backend suite: 846 tests / 90 suites (up from 782/83), including a new
  `reports-independence.spec.ts` structural guard (no reporting file writes a
  transactional table, calls `postSystemJournalEntry`, or imports an Inventory/Sales/
  Procurement/Production service or controller).
- Live end-to-end verification against the real Boby Bites dev environment: Dashboard,
  Profit & Loss (drill-down chain confirmed working via real clicks), Balance Sheet
  (balanced, Retained Earnings computed correctly), Inventory Valuation, AR/AP Ageing
  (bucket totals reconciling against Dashboard/Receivables/Payables figures), Trial
  Balance (unaffected, still balances), and mobile responsiveness at 375px.
- Zero database migrations — confirmed and documented as a deliberate, notable result:
  proof the accounting foundation built by Sprints 7-12 was already reporting-ready.

## [Sprint 12 Accounts Payable & Supplier Invoice Management] - 2026-08-29

### Added

- **`SupplierInvoice`/`SupplierInvoiceItem` (Finance)** — the supplier-side mirror of
  Invoice/InvoiceItem, matched against what Sprint 8's Goods Receipt already
  recognised. Every line takes one of two paths: **Path A** (`goodsReceiptItemId`
  set) reconciles against a Goods Receipt line's remaining payable value —
  `recognizedAmount = min(lineTotal, remainingPayable × unitPrice)`, where
  `remainingPayable` subtracts what Sprint 11 Returns already drew from the payable
  bucket and what prior invoices already claimed (`GoodsReceiptItem.invoicedQuantity`,
  a new cumulative counter) — capping recognition by construction, so an over-invoice
  can never inflate AP, only surface a `varianceAmount` and flag the header
  `DISCREPANCY`. No new journal is posted for a matching Path A line — the liability
  already exists. **Path B** (`debitAccountId` set) is a fresh liability with no Goods
  Receipt to reconcile against (freight, a service bill) — the line names an explicit,
  user-chosen Chart of Accounts "Debit Account" (non-system `ASSET`/`EXPENSE` only,
  never defaulted or guessed), recognised in full and grouped into one balanced `DR
<account>(s) / CR Accounts Payable` journal per invoice. A single invoice may freely
  mix both kinds of lines. Lifecycle: `DRAFT → POSTED → {PARTIALLY_PAID → PAID}`, with
  `OVERDUE` (lazy sweep) and `VOID` side branches, mirroring `Invoice` exactly.
  `POST /:id/acknowledge-discrepancy` records a human sign-off only — never changes
  `recognizedAmount`/AP, no tolerance engine, no auto-resolution.
- **`journal-posting.ts` extension** — `PostingLineInput` gained an optional
  `accountId` alongside the existing `systemKey` (exactly one required per line,
  both resolved tenant-scoped inside the same transaction) — the one small, generic
  change needed for Path B, reused by no other domain yet.
- **`SupplierPayment`/`SupplierPaymentAllocation` (Finance)** — direct structural
  mirror of `Payment`/`PaymentAllocation`. The over-payment guard bounds against
  `recognizedAmount - amountPaid - amountCredited`, never `total` — an over-invoiced
  Path A invoice can never be over-paid, by construction. Posts `DR Accounts Payable /
CR Cash-or-Bank`.
- **`SupplierCreditNote` (Finance)** — a new, small model (not a reuse of the
  customer-side `CreditNote`, whose `customerId` is a required, non-nullable FK).
  Mirrors `CreditNote`'s `DRAFT → ISSUED → VOID` shape, posts `DR Accounts Payable /
CR Inventory` — the mirror image of Goods Receipt's own posting.
- **`AccountsPayableService` (Finance)** — direct structural mirror of
  `AccountsReceivableService`: org-wide summary, per-supplier balance, a supplier
  financial summary, and a Purchase Order financial summary (deliberately blind to
  received/inventory quantities — Inventory's own Receiving Summary covers that
  half). Every figure derived live via `groupBy`/`aggregate`, never a stored balance.
- **Admin `/settings/finance/payables`** — AP summary cards (Total Outstanding,
  Overdue, Partially Paid, Invoiced This Period, Payments Made) + the Supplier
  Invoice list. `SupplierInvoiceDialog` picks a supplier, optionally pulls Path A
  lines from one of that supplier's Goods Receipts with a live client-side preview
  of the discrepancy result, and/or adds Path B lines with a Debit Account picker
  (restricted client-side to non-system Asset/Expense accounts, re-validated
  server-side authoritatively). `SupplierInvoiceDetailDialog` shows the frozen match
  result per line, payment/credit-note history, and nests
  `SupplierPaymentDialog`/`SupplierCreditNoteDialog`, mirroring `InvoiceDetailDialog`
  exactly.
- **Admin `/settings/finance/supplier-payments`** — a flat, read-only payment ledger
  - void, mirroring `payments/page.tsx`.
- **Supplier detail view** — the Suppliers list's row click now opens a read-only
  `SupplierDetailDialog` (identity fields + Finance's AP financial summary for that
  supplier) instead of jumping straight to Edit, which stays a separate, explicit
  action.
- **Purchase Order dialog "Financial Summary"** — a new read-only block (invoiced/
  recognized/paid/outstanding, discrepancy count) sourced from Finance's own AP
  read model, shown alongside the existing Receiving Summary — neither domain reads
  the other's tables.
- New `accounts-payable-independence.spec.ts` — structural guard proving the AP
  files post accounting only through `postSystemJournalEntry`, never write
  `JournalEntry`/`JournalEntryLine` directly, and never import an Inventory/
  Procurement/Supplier service or controller (only the two exported repositories,
  read-only) — same technique as `sales-finance-independence.spec.ts`.
- 46 new repository-level tests (`supplier-invoice.repository.spec.ts`,
  `supplier-payment.repository.spec.ts`, `supplier-credit-note.repository.spec.ts`,
  plus the independence guard) covering every worked scenario from the brief:
  normal purchase (create→post→partial pay→full pay), over-supply matching, an
  over-invoice correctly capped and flagged (never inflating AP), a partial invoice
  followed by one completing the remainder against the same Goods Receipt line, a
  mixed Path A + Path B invoice, Path B rejecting a missing/wrong-type/system debit
  account, closed-period rejection, and idempotent create/post/payment replay.

### Changed

- `GoodsReceiptItem` — added `invoicedQuantity` (cumulative, incremented only at
  `SupplierInvoice.post()` time for Path A lines). Its response
  (`GET /inventory/goods-receipts*`) now also surfaces `returnedQuantity`/
  `returnedExcessQuantity` (already-existing Sprint 11 columns) and the originating
  Purchase Order line's `unitPrice` — all genuinely this row's own data, exposed for
  the Supplier Invoice line picker's "available to invoice" hint and default price;
  Inventory computes nothing from them.
- `apps/api/src/finance/finance.module.ts` — imports `SupplierModule`/
  `PurchaseOrderModule` (read-only, via their exported repositories) for identity/PO
  resolution — the same ADR-002 shape as its existing `SalesModule`/`CustomerModule`/
  `OutletModule` imports. Still deliberately does not import `InventoryModule`:
  `SupplierInvoiceRepository` reaches directly into `GoodsReceiptItem` inside its own
  self-owned transaction, the same precedent `SupplierReturnRepository`/
  `CustomerReturnRepository` (Sprint 11) already established.

### Verified

- Live, end-to-end, against the running dev servers (not just automated tests):
  Scenario A (create a Path A invoice against PackRight Nigeria's over-supply
  fixture, post it — `MATCHED`, ₦150,000 recognized — partial-pay ₦90,000
  → `PARTIALLY_PAID`, pay the remaining ₦60,000 → `PAID`, AP back to zero, both
  payments in history); the live discrepancy preview (invoicing 1,050 of 1,000
  available immediately flags `Discrepancy` in the create dialog before saving);
  a Path B invoice (a freight bill coded to a `Transport` expense account, no PO/GR)
  posting `DR Transport / CR Accounts Payable` and landing `UNVERIFIED`/fully
  recognized; the Supplier detail dialog's AP summary and the Purchase Order
  dialog's new Financial Summary block both reflecting the same figures correctly;
  and — a genuine cross-sprint composition check — a pre-existing Sprint 11
  `SupplierReturn` against the _same_ Goods Receipt (excess-first allocation had
  left the payable bucket untouched) composing correctly with Sprint 12's matching
  formula with zero discrepancy.
- Full monorepo quality gate: `prisma validate`, `lint`, `type-check`, `test`
  (**77 test suites / 782 tests, all passing**, up from 73/736 before this sprint),
  and `build`, all green.

## [Sprint 11 Returns, Claims & Reversals Foundation] - 2026-08-27

### Added

- **`CustomerReturn` (Sales)** — a two-phase aggregate (`REQUESTED → RECEIVED`/
  `CANCELLED`) that references a specific `SalesFulfilmentItem`, never edits the
  original Sales Order/Fulfilment/Invoice. `POST /api/sales/customer-returns` is the
  request step (no inventory/accounting effect); `POST /:id/receive` is the one
  atomic physical+financial event — per-line disposition
  (resalable/damaged/quarantine/scrap, only resalable restocks `InventoryStock` at the
  fulfilment's own frozen cost), a COGS-reversal Journal Entry (`DR Finished Goods
Inventory / CR Cost of Goods Sold`), and Credit Note issuance (an independently-
  valued `quantityCredited`, never assumed equal to the resalable quantity) — all one
  transaction, rolling back together on any failure. `POST /:id/cancel` releases the
  reserved quantity; `POST /:id/photo` mirrors `Delivery`'s own photo-upload shape.
- **`SupplierReturn` (Inventory)** — a single atomic write (`POST
/api/inventory/supplier-returns`) reversing a physical return of previously-accepted
  goods to a supplier. Implements an **excess-first allocation** rule: a return's
  value is drawn from a `GoodsReceiptItem`'s remaining excess/`GRNI_PENDING_APPROVAL`
  balance before spilling into the payable/`AP` balance, valued at the original
  `PurchaseOrderItem.unitPrice` — verified against this codebase's own excess-supply
  seed data to post `DR GRNI_PENDING_APPROVAL / CR Inventory` only, leaving `AP`
  completely untouched, matching the brief's own worked example exactly.
- **Replacement Goods (Inventory)** — a supplier's replacement shipment for
  previously-rejected goods is now a traceable `GoodsReceipt`
  (`replacesGoodsReceiptId`/`replacesRejectedItemId`, `replacedQuantity` capped at
  what was actually rejected), posted through the _existing_, completely unmodified
  `receive()` — no new accounting logic, since `payableQuantity`'s existing
  remaining-ordered-quantity cap (Sprint 8) already makes a duplicate payable
  mathematically impossible.
- **Discrepancy resolution extended** — `GoodsReceipt.discrepancyResolutionAction`
  (`REPLACEMENT`/`RETURN`/`CREDIT`/`ACCEPT_AS_IS`/`PRICE_ADJUSTMENT`/`OTHER`),
  auto-set by a linked Supplier Return or replacement receipt; the other three values
  remain a manual flip via the existing `PATCH .../discrepancy` endpoint.
- **`issueCreditNoteWithinTransaction`** — `CreditNoteRepository.issue()`'s atomic
  body extracted into a plain, DI-free function (same contract as
  `postSystemJournalEntry`), so `CustomerReturn.receive()` can issue a Credit Note
  inside its own outer transaction. `CreditNote` gained a polymorphic
  `sourceType`/`sourceId` pair for Finance traceability back to the return that issued
  it — behaviour-preserving for every pre-existing, manually-issued credit note.
- **New `InventoryTransactionType.RETURN`** — both a customer-return restock
  (increase) and a supplier-return removal (decrease), distinguishable from a manual
  `ADJUSTMENT`.
- **Admin `/settings/returns`** — a two-tab (Customer/Supplier) list-and-detail
  surface, following this codebase's established list/dialog conventions.
- **Field Sales returns request** — a mobile-first, full-screen sheet on the order
  detail page (`Request Return`), request-only (no cost/COGS/disposition fields, same
  rule Field's Fulfilment view already follows) with optional camera photo capture,
  reusing `ImageUploadCard`'s `preferCamera` pattern.
- Two new `*-independence.spec.ts` structural-guard files (Sales, Inventory) proving
  the new repositories only post accounting through the approved
  `postSystemJournalEntry`/`issueCreditNoteWithinTransaction` boundary, never by
  writing `JournalEntry`/`JournalEntryLine` directly or importing a Finance
  repository/service class.

### Verified

- Live, end-to-end, against the running dev servers (not just automated tests): the
  Boby Bites customer-return scenario (10 packs returned, 7 resalable/3 damaged, full
  credit) posted `DR Finished Goods Inventory ₦2,982 / CR COGS ₦2,982` and a `₦8,000`
  Credit Note, both confirmed by direct database query; the excess-supply supplier-
  return scenario (returning 50 of a 100-unit excess) posted `DR
GRNI_PENDING_APPROVAL ₦7,500 / CR Inventory ₦7,500` with zero `AP` impact; the Field
  Sales mobile return-request flow, confirmed to create a `REQUESTED` return
  referencing the correct fulfilment batch with zero cost fields rendered.
- Full backend suite: **72 test suites / 717 tests, all passing** (up from 68/684
  after Sprint 10).

## [Sprint 10 Sales Fulfilment & COGS Accounting Integration] - 2026-08-26

### Added

- **Sales Fulfilment → General Ledger posting, atomic with the fulfilment itself**:
  `SalesFulfilmentRepository.create()` now calls `postSystemJournalEntry` (the same
  plain, dependency-injection-free posting boundary Sprint 8/9 already used) from
  inside its own existing `$transaction`, posting one Journal Entry per fulfilment
  batch (not per Sales Order — partial fulfilments each post their own independent,
  source-linked entry): `DR Cost of Goods Sold / CR Finished Goods Inventory`, valued
  at each item's current `InventoryStock.averageUnitCost`. A closed accounting period
  or a missing `COGS`/`FINISHED_GOODS_INVENTORY` system account now correctly rolls
  back the entire fulfilment, inventory movement included.
- **Two genuinely separate accounting events, never collapsed into one**: creating or
  confirming a Sales Order still posts nothing; issuing an Invoice still posts
  `DR Accounts Receivable / CR Sales Revenue` (Sprint 6/7, unchanged); only the
  physical act of Fulfilment posts COGS. Verified structurally
  (`sales-finance-independence.spec.ts`, new) and live.
- **`SalesFulfilmentItem.unitCost`/`.costAmount`** — a snapshot of the cost each item
  was actually valued at, at the moment of fulfilment (never re-derived from a later,
  possibly-since-changed `averageUnitCost`). The sum of every sibling item's
  `costAmount` on one fulfilment always equals exactly the posted Journal Entry's
  amount — the per-SKU traceability source, since `JournalEntryLine` carries no
  `productId`/`quantity`.
- **Zero/missing cost never blocks the physical fulfilment** — matches Production
  Material Issue's own precedent: if every item's cost rounds to `0`, the inventory
  deduction and fulfilment record still happen; only the Journal Entry is skipped
  (never posted as a zero-value entry).
- **`SalesFulfilmentRepository.findByIdempotencyKey()`** — checked first in
  `SalesFulfilmentService.fulfil()`, before any business-rule pre-check (order status,
  over-fulfilment), applying Sprint 9's own hard-won lesson proactively this time: a
  genuine retry now returns the original result instead of a `400`, verified live via
  duplicate API submissions before any bug could reach production.
- **`GET /sales/orders/:id/fulfilments`** now includes each fulfilment's `journalEntry`
  (`{ id, journalNumber, status, totalAmount } | null`) and each item's `unitCost`/
  `costAmount`, batch-fetched in one query. Sales Admin's order detail view shows a new
  read-only "Inventory Cost" / "JE-xxxxxx · POSTED · COGS Posted" line per fulfilment,
  linking through to Finance.
- **`sales.fulfilment-cogs-posted`** audit event, fired only when a fresh (non-replay)
  fulfilment actually posted a non-null Journal Entry.
- **`distribution-inventory-independence.spec.ts`** extended with a new guard proving
  Dispatch/Delivery never call `postSystemJournalEntry`/touch `JournalEntry` — verified
  live too: dispatching and delivering a previously-fulfilled order left both
  `InventoryStock` and the Journal Entry count completely unchanged.

### Fixed

- **Seed data gap**: `PRD-000027` ("Plantain Chips Classic Salted 500g," the SKU Sales
  actually sells against the seeded orders) carried `averageUnitCost = 0` — its stock
  had only ever come from `ADJUSTMENT`-type top-ups, never a costed Goods Receipt or
  Production Completion. Under the zero-cost-skip policy, every already-seeded Sales
  Fulfilment would have silently posted no COGS journal at all. Fixed by adding a new,
  fully-costed Production flow (`BOM-000004`/`PROD-000006`) that completes before any
  `ADJUSTMENT` top-up runs, giving `PRD-000027` a real, non-zero average cost
  (₦426/pack) that every seeded and live-tested fulfilment now correctly costs against.

### Changed

- `SYSTEM_ACCOUNT_KEYS.COGS`'s doc comment updated from "reserved for the documented
  future Sales Fulfilment integration" (Sprint 7) to note it is now posted to.
- Seed data (`apps/api/prisma/seed.ts`): `seedSalesFulfilments()` now computes and
  writes `unitCost`/`costAmount` per item and posts the same COGS journal every real
  fulfilment does, so the seeded Fulfilment History demonstrates the full chain
  end to end, not just inventory movement with no accounting behind it.

## [Sprint 9 Manufacturing Accounting Integration] - 2026-08-25

### Added

- **Material Issue → General Ledger posting, atomic with the issue itself**:
  `ProductionMaterialIssueRepository.issue()` now calls `postSystemJournalEntry` (the
  same plain, dependency-injection-free posting boundary Sprint 8's Goods Receipt
  already used) from inside its own existing `$transaction`, posting one Journal Entry
  per Material Issue (not per Production Order — partial issues each post their own
  independent, source-linked entry): `DR Work In Progress / CR Raw Material Inventory`,
  valued at each component's current `averageUnitCost`. A closed accounting period or a
  missing `WIP`/`INVENTORY` system account now correctly rolls back the entire issue,
  quantity movement included.
- **Production Completion → General Ledger posting, with an accepted/rejected cost
  split**: `ProductionRunRepository.complete()` posts one Journal Entry clearing the
  order's full cumulative Work In Progress value: `CR Work In Progress`, split into
  `DR Finished Goods Inventory` (the accepted share) and `DR Production Loss / Scrap`
  (the rejected share), computed proportionally by produced quantity so the two debit
  lines always sum to exactly the credited WIP total. Rejected output's cost is
  preserved in the ledger, never silently dropped — but only the accepted quantity is
  ever added to sellable `InventoryStock`.
- **`InventoryStock.averageUnitCost`** — the first persisted inventory valuation figure
  in the codebase, a moving weighted average per (organisation, product, location).
  Written by `GoodsReceiptRepository.receive()` (extended this sprint) and
  `ProductionRunRepository.complete()`'s finished-goods upsert; read by Material Issue
  to value each consumed component at its current cost. Untouched by manual Stock
  Adjustments, which carry no cost information.
- **Two new Chart of Accounts system keys**: `WIP` ("Work In Progress," Asset) and
  `PRODUCTION_LOSS` ("Production Loss / Scrap," Expense), plus elevating the
  pre-existing Sprint 7-seeded "Finished Goods" account to a system account
  (`FINISHED_GOODS_INVENTORY`).
- **`ProductionMaterialIssue.idempotencyKey`** + `@@unique([productionOrderId,
idempotencyKey])`, and a plain `ProductionRun.idempotencyKey` column (no new
  composite unique needed — `productionOrderId` is already `@@unique`). Every audit
  event on both write routes is now gated on the request actually having created
  something (`wasCreated`); two new audit events
  (`production.material-issue-journal-posted`, `production.completion-journal-posted`)
  fire only when a journal was actually posted.
- **`GET /api/production/orders/:id/accounting`** — a read-only summary
  (`{ materialCost, journalEntries }`) surfaced in the Production Order detail view's
  new "Accounting" section, linking through to Finance's Journal Entries page; Material
  Issue and Production Completion responses now include their own `journalEntry`.
- **`production-finance-independence.spec.ts`** — structural guards proving
  `production-material-issue.repository.ts`/`production-run.repository.ts` never call
  `tx.journalEntry.*` directly (only via `postSystemJournalEntry`) and
  `production.module.ts` never imports `FinanceModule`.

### Fixed

- **Idempotent retry rejected instead of returning the original result.** Both
  `ProductionOrderService.issueMaterial()` and `.completeProduction()` ran their own
  business-rule pre-checks (over-issue validation; an `IN_PROGRESS`-only status guard)
  _before_ ever reaching the repository's correct idempotency check-then-return —
  found live during this sprint's mandatory browser verification. A genuine retry
  arrives after the original call's own effects (its own issued quantity already
  counted toward the requirement; the order already flipped to `COMPLETED`), so those
  pre-checks rejected the retry with a `400` instead of the original success response.
  No duplicate data was ever created (the repository-level guard held throughout), but
  the retry didn't behave idempotently. Fixed by adding a `findByIdempotencyKey` lookup
  to each repository and checking it first, before any business-rule pre-check, in both
  service methods. Covered by two new regression tests in
  `production-order.service.spec.ts`.

### Changed

- Seed data (`apps/api/prisma/seed.ts`): `PROD-000001` (Boby Bites' Plantain Chips)
  now runs all the way through two partial Material Issues and a completion with a
  small rejection, each posting a real Journal Entry, so the seeded data demonstrates
  the full Material→WIP→Finished-Goods chain end to end. A new PO/GRN pair
  (`PO-000012`/`GRN-000009`, Golden Oil Ltd) gives Vegetable Oil a real receipt-based
  cost, since its original PO deliberately stays un-received.

## [Sprint 8 Procurement, Inventory & Accounting Integration] - 2026-08-25

### Added

- **Goods Receipt → General Ledger posting, atomic with the receipt itself**:
  `GoodsReceiptRepository.receive()` now calls `postSystemJournalEntry` (Sprint 7's
  plain, dependency-injection-free posting boundary) from inside its own existing
  `$transaction` — the entire business event (Goods Receipt, `InventoryStock`
  increment, `InventoryTransaction` rows, and the Journal Entry) either succeeds
  together or rolls back together. A closed accounting period or a misconfigured
  Chart of Accounts now correctly prevents inventory from silently increasing with no
  accounting behind it.
- **Accepted vs. Payable** — a new `payableQuantity` on `GoodsReceiptItem`,
  server-computed as `min(acceptedQuantity, remainingOrderedQuantity)`, where the
  remaining figure is the Purchase Order item's own ordered quantity minus every
  prior receipt's cumulative payable total against it. Physically accepting goods
  beyond a Purchase Order's commercially-agreed quantity no longer inflates the
  supplier's recognised liability: the Journal Entry's credit side splits into
  `CR Accounts Payable` (the payable portion) and, only when excess exists,
  `CR GRNI — Pending Approval` (a new system account, Chart of Accounts code `2110`).
  Worked example: a 1,000-unit Purchase Order receiving 1,100 delivered / 50 rejected
  / 1,050 accepted posts `DR Inventory ₦1,050,000 / CR AP ₦1,000,000 / CR GRNI —
Pending Approval ₦50,000` — never `CR AP ₦1,050,000`.
- **`GoodsReceipt.idempotencyKey`** + `@@unique([purchaseOrderId, idempotencyKey])` —
  closes a real gap every other Sprint 6/7 write path already had. A retried
  `POST /goods-receipts` with the same key now returns the original receipt instead of
  creating a second one, a second `InventoryStock` increment, and a second Journal
  Entry; every audit event this endpoint fires is now gated on the request actually
  having created something (`wasCreated`), not fired unconditionally.
- **`GoodsReceiptRepository.receive()`/`findJournalEntriesByGoodsReceiptIds`** now
  surface the linked Journal Entry (`{ id, journalNumber, status, totalAmount } |
null`) on the create response and on `GET /goods-receipts`/`GET
/goods-receipts/:id`, so the Inventory UI can show "Accounting: JE-000123 · Posted ·
  ₦300,000" without a second round trip; a new `goods-receipt.journal-entry-posted`
  audit event fires alongside it.

### Changed

- Chart of Accounts gains a ninth seeded system account, `GRNI_PENDING_APPROVAL`
  ("Goods Received – Pending Approval," code `2110`, under Liabilities).
  `SYSTEM_ACCOUNT_KEYS` starts posting to `INVENTORY` and `AP` for the first time
  (seeded Sprint 7, unposted until now).
- Seed data (`apps/api/prisma/seed.ts`): every seeded Goods Receipt now posts its
  Journal Entry (13 total, up from Finance's own 8), and `seedChartOfAccounts`/
  `seedAccountingPeriods` now run earlier in the seed sequence — ahead of
  `seedGoodsReceipts`, which depends on them — with a standalone idempotent backfill
  (`seedGrniPendingApprovalAccount`) so an already-seeded database still receives the
  new account on a re-seed.

## [Sprint 7 General Ledger & Accounting Foundation] - 2026-08-24

### Added

- **`ChartOfAccount`** — a tenant-defined, self-referential account hierarchy (mirrors
  `Territory`'s own parent/child cycle-prevention shape exactly). `code` is unique
  _per organisation_ (unlike `Invoice.invoiceCode`'s global uniqueness — every tenant
  maintains its own chart). System accounts (`isSystemAccount` + `systemKey`, one of
  `AR`/`SALES_REVENUE`/`SALES_RETURNS`/`CASH`/`BANK`/`INVENTORY`/`COGS`/`AP`) let
  posting code resolve "the AR account for this organisation" without ever hardcoding
  an id, and can never be deactivated via the API. Named `ChartOfAccount`, not
  `Account` — `Account` would collide with the pre-existing, unrelated self-service
  `AccountModule`/`AccountController` (`apps/api/src/identity/account/`).
- **`AccountingPeriod`** — a named date range only `OPEN` periods may receive postings
  into; closing is one-way this sprint. Overlap against an existing period is rejected
  service-side (no Postgres range-exclusion constraint precedent in this schema).
- **`JournalEntry`/`JournalEntryLine`** — the core double-entry record.
  `journalNumber` (`JE-000001`, ...) is unique per organisation. `accountingPeriodId`
  is always server-resolved from `date`, never independently client-selected.
  Server-authoritative double-entry validation throughout: exactly one of
  `debit`/`credit` per line, at least two lines, `Σdebit === Σcredit` — re-validated
  at every layer, never trusted from the client. Manually-created entries pass through
  `DRAFT` (balance-validated at creation) before a separate `POST .../:id/post` action
  re-validates balance + period-open-ness and flips to `POSTED`; system-generated
  entries (invoice/payment/credit-note) post directly as `POSTED`. `VOID` is a bare
  status flip — it never generates an automatic reversing entry (a true correction is
  a new manual journal). Duplicate-posting prevention via
  `@@unique([organisationId, sourceType, sourceId])`, independent of and in addition
  to `Payment`/`CreditNote`'s own idempotency keys.
- **Automatic Finance → General Ledger posting, atomic with the triggering write**:
  `InvoiceRepository.issue()` (a new transactional method, replacing the generic
  `updateStatus` call `InvoiceService.issue()` used before), `PaymentRepository.create()`,
  and `CreditNoteRepository.issue()` each post a journal entry via
  `accounting/journal-posting.ts`'s `postSystemJournalEntry` — a plain,
  dependency-injection-free function taking a Prisma transaction client, called from
  _inside_ the caller's own `$transaction` (a NestJS-injected service would open a
  separate transaction and break atomicity). If posting fails (no open period, no
  configured system account), the whole business operation rolls back — never an
  invoice marked `ISSUED` with no journal behind it. `Invoice.issue()` posts
  `DR Accounts Receivable / CR Sales Revenue`; a payment posts `DR Cash-or-Bank / CR
Accounts Receivable` (`PaymentMethod.CASH` → the `CASH` system account, everything
  else → `BANK`); a credit note posts `DR Sales Returns / CR Accounts Receivable`.
- **General Ledger / Trial Balance / Account Activity** (`GET /finance/ledger`,
  `/trial-balance`, `/accounts/:id/activity`) — entirely read-only, auth-only. Running
  balance is computed deterministically in application code from an ordered query
  result, never a SQL window function. Trial Balance splits each account's
  `totalDebit − totalCredit` by sign into a classic two-column presentation; since the
  whole ledger balances by double-entry construction, the two columns' totals always
  match with zero per-account-type sign logic needed.
- **New endpoints** (15 total): `GET/POST /finance/accounts`, `PATCH .../:id`,
  `POST .../:id/{activate,deactivate}`, `GET .../:id/activity`,
  `GET/POST /finance/accounting-periods`, `POST .../:id/close`,
  `GET/POST /finance/journal-entries`, `GET .../:id`, `POST .../:id/{post,void}`,
  `GET /finance/ledger`, `GET /finance/trial-balance`.
- **Admin surface** — five new tabs on the existing `FinanceTabs` bar (now ten total,
  horizontally scrollable at narrow widths rather than wrapping): Chart of Accounts (a
  parent/child tree with System badges), Journal Entries (dynamic line rows with live
  Total Debit/Credit/Difference, chaining create-then-post as one user action —
  mirroring Sprint 6's `CreditNoteDialog` create-then-issue precedent), General Ledger,
  Trial Balance, and Accounting Periods.
- **Seed data** — a full worked Chart of Accounts (24 accounts, 8 marked as system
  accounts) and two Accounting Periods ("July 2026", posted-into then closed to
  demonstrate real closed-period history; "August 2026", left `OPEN`). `seedFinance`'s
  existing four invoices/three payments/one credit note now each post a real journal
  entry via a local, self-contained re-implementation of the posting logic
  (`prisma/seed.ts` has never imported from `src/` — this sprint keeps that
  convention rather than importing `journal-posting.ts` directly). Verified
  idempotent and confirmed balanced (`Σdebit === Σcredit`) via direct database
  inspection after both a first and a repeat `pnpm db:seed` run.

### Fixed

- **The only `window.confirm()` call anywhere in the frontend** — the Accounting
  Periods "Close" button initially used a native `confirm()` dialog, foreign to this
  codebase's convention (every other one-way action, e.g. Void on an Invoice/Payment/
  Credit Note, executes directly on click with a loading state, no native dialog).
  Caught during this sprint's own live verification (a native `confirm()` blocked
  automated browser testing, surfacing the inconsistency); removed to match the
  established pattern.

## [Sprint 6 Finance Foundation] - 2026-08-24

### Added

- **Five new Prisma models**: `Invoice`/`InvoiceItem` (raised against a `FULFILLED`
  Sales Order, snapshotting product/price/tax details permanently — never
  reconstructed from the live Product Catalogue), `Payment`/`PaymentAllocation`
  (customer-scoped, allocated to invoices via a join table designed for future
  multi-invoice allocation without a `Payment` rewrite), `CreditNote` (a lightweight,
  flat-amount financial adjustment — no line-item detail, no full Returns Management
  system). Auto-generated immutable `INV-000001`/`CN-000001` codes.
- **`InvoiceStatus` lifecycle**: `DRAFT → ISSUED → {PARTIALLY_PAID → PAID}`, plus
  `OVERDUE` and `VOID`. `amountOutstanding` is never stored — always derived as
  `total - amountPaid - amountCredited`. `OVERDUE` is kept authoritative via a lazy
  sweep inside `InvoiceRepository`'s own read methods (no cron/scheduler
  infrastructure exists anywhere in this codebase) and takes precedence over
  `PARTIALLY_PAID` once a due date lapses — the underlying paid/outstanding figures
  stay fully accurate regardless of which status label is showing.
- **Server-authoritative money throughout**: every invoice total, payment
  over-payment guard (`amount <= amountOutstanding`, exact-boundary tested), and
  credit-note over-credit guard is computed and enforced server-side; the client
  never supplies a trusted total. `PaymentRepository.create()`/
  `CreditNoteRepository.issue()` both run the same atomic shape: idempotency
  check-then-return, an eligibility guard re-reading the invoice's status inside the
  transaction, an over-payment/over-credit guard, the child write, the cumulative
  column increment, and a shared status-derivation helper both repositories reuse so
  a payment and a credit note applied to the same invoice always agree on the result.
- **Payment Terms** — a closed `PaymentTermType` enum
  (`CASH`/`DUE_ON_RECEIPT`/`NET_7`/`NET_14`/`NET_30`), not a tenant-configurable
  table, deriving `dueDate` server-side. No credit-limit/approval-workflow engine.
- **Minimal, configurable tax foundation** — `finance.defaultTaxRatePercent` (env
  `FINANCE_DEFAULT_TAX_RATE_PERCENT`, default `7.5`) applies only when an invoice
  line omits its own rate; the rate actually used is permanently snapshotted onto the
  line, never recomputed later. No header-level `Invoice.taxRate` — only
  `InvoiceItem.taxRate` exists, since a header rate would drift the moment two lines
  carry different rates.
- **Currency** reuses `Organisation.currency` as-is (no second currency system);
  `Invoice.currency` is snapshotted at creation, `Payment.currency`/
  `CreditNote.currency` are always server-derived from their target invoice, never
  client-supplied.
- **Structural independence, proven executably**: `FinanceModule` imports only
  `IdentityModule`/`AuthModule`/`SalesModule`/`CustomerModule`/`OutletModule` — never
  `InventoryModule`/`DistributionModule`. `finance-independence.spec.ts` guards that
  Finance's own repositories never write to any upstream domain's tables. This drove
  the key interpretive decision that invoice eligibility is
  `SalesOrder.status === 'FULFILLED'` only, since Dispatch/Delivery data is
  architecturally unreachable from Finance.
- **New endpoints** (19 total): `GET /finance/eligible-sales-orders`,
  `GET/POST /finance/invoices`, `GET/POST /finance/invoices/:id/{issue,void}`,
  `GET /finance/invoices/:id/{payments,credit-notes}`, `GET/POST /finance/payments`,
  `POST /finance/payments/:id/void`, `GET/POST /finance/credit-notes`,
  `POST /finance/credit-notes/:id/{issue,void}`,
  `GET /finance/receivables/{summary,by-customer,customers/:id}`.
- **Admin surface** (`/settings/finance`) — Overview/Invoices/Payments/Receivables/
  Credit Notes tabs via a new bespoke `FinanceTabs` component (following the existing
  `AccountTabs` precedent; no generic `Tabs` primitive exists in this codebase yet).
  A two-step "Create Invoice" dialog (pick an eligible Sales Order → the invoice form,
  with live client-side preview totals never trusted on submit); the Invoice detail
  dialog nests "Record Payment"/"Issue Credit Note" as their own dialogs, mirroring
  Distribution's `DispatchDetailDialog` → `DeliveryDialog` composition. New shared
  `apps/web/src/lib/format-currency.ts` — the first currency-formatting helper in
  this codebase not hardcoded to a single currency.
- **Seed data** — a new customer (ABC Supermarket) and two new Sales Orders exercising
  the brief's own headline scenario end to end: `INV-000001` fully paid via two
  payments (₦1,000,000 + ₦1,500,000 against a ₦2,500,000 invoice); `INV-000002`
  partially paid (₦1,000,000) plus a `CN-000001` credit note (₦250,000 for damaged
  goods), landing on `PARTIALLY_PAID` with a correct ₦1,250,000 outstanding balance;
  `INV-000003` backdated to demonstrate the `OVERDUE` lazy sweep firing live;
  `INV-000004` issued and not yet due, demonstrating the configured 7.5% tax default.
  Verified idempotent (`pnpm db:seed` run twice, identical results).

### Fixed

- **`workspace/page.tsx`'s `MODULE_DESCRIPTIONS` map never gained a
  `/settings/distribution` entry when Distribution shipped in Sprint 5** — the
  Workspace dashboard's Platform Modules grid silently fell back to "Coming soon." for
  a module that had been fully live for a full sprint. Caught during this sprint's own
  live verification (Distribution appeared disabled on the dashboard despite working
  correctly everywhere else); fixed by adding the missing entry.
- **`PaymentDialog`/`CreditNoteDialog` were missing the `max-h-[75vh] overflow-y-auto`
  wrapper** every other multi-field Finance dialog (`InvoiceDialog`,
  `InvoiceDetailDialog`) already uses — on shorter viewports their Cancel/Submit
  footer buttons fell outside the fixed-height `Dialog` panel with no way to scroll to
  them. Caught live while recording a payment at a reduced browser height; fixed by
  applying the same scroll wrapper both dialogs' sibling components already use.
- **`payments/page.tsx`/`receivables/page.tsx` had no mobile card view** — unlike
  `invoices/page.tsx`/`credit-notes/page.tsx`, which both follow the established
  desktop-table/mobile-card responsive split, these two only rendered a
  horizontally-scrolling table at every width. Caught during this sprint's own mobile
  responsiveness pass (375px); fixed by adding the matching card layout to both.

## [Sprint 5 Distribution & Delivery Operations Foundation] - 2026-08-23

### Added

- **`Dispatch`/`DispatchItem`** — the physical release of already-fulfilled goods toward
  a destination, chained directly off an existing `SalesFulfilment`. Auto-generated
  `dispatchCode` (`DSP-000001`, ..., globally unique). `DispatchStatus` lifecycle:
  `READY → DISPATCHED → IN_TRANSIT → {PARTIALLY_DELIVERED → DELIVERED}`, with
  `CANCELLED` (blocked once any delivery exists) and `FAILED` (terminal, requires a
  non-empty explanation) as side-branches. `SalesFulfilmentItem` gains a new
  `quantityDispatched` cumulative column.
- **`Delivery`/`DeliveryItem`** — confirmation of what actually arrived, supporting
  partial/short delivery (dispatched 500, delivered 480 → 20 short, captured via
  free-text `notes` — no reason-code enum, no Returns/Claims Management system this
  sprint). `DispatchItem` gains a new `quantityDelivered` cumulative column, completing
  the chain `quantityFulfilled → quantityDispatched → quantityDelivered`. An optional
  single proof-of-delivery photo (`photoUrl`/`photoKey`, mirroring `Product.imageUrl`'s
  single-photo shape) is attached via a separate follow-up upload request.
- **Inventory independence, proven executably**: `DispatchRepository`/
  `DeliveryRepository`'s atomic `create()` transactions never touch `InventoryStock`/
  `InventoryTransaction` — Sales Fulfilment remains the sole inventory-deducting event
  in this codebase. A new `distribution-inventory-independence.spec.ts` structurally
  guards this (source-scans for any forbidden import/usage) alongside a second guarantee
  that `DistributionModule` never imports `NetworkRelationshipModule`/`TerritoryModule`
  — the distribution network stays purely informational (an "Associated Distributor"
  display on the dispatch detail view), never a gate on dispatch or delivery.
- **New endpoints**: `GET/POST /api/distribution`, `GET /api/distribution/:id`, `POST
/:id/dispatch`, `/:id/in-transit`, `/:id/cancel`, `/:id/fail`, `GET/POST /:id/
deliveries`, `POST /deliveries/:deliveryId/photo`, `GET /fulfilments/:
salesFulfilmentId/dispatch-availability`.
- **Idempotency** — `Dispatch.idempotencyKey`/`Delivery.idempotencyKey`, same pattern as
  `SalesFulfilment.idempotencyKey`; both the Admin dialogs and the Field Sales sheet
  generate one via `crypto.randomUUID()` per attempt, protecting against a double-tap or
  flaky-network retry duplicating a dispatch or delivery.
- **`sales.module.ts` gains its first `exports` array** (`SalesOrderRepository`,
  `SalesFulfilmentRepository`) so `DistributionModule` can read Sales Orders/Fulfilments
  read-only, via the same "consume another domain only through its exported repository"
  convention `InventoryModule`/`ProductModule` already established.
- **Admin surface** (`/settings/distribution`) — a dispatches list with search/status
  filters, a multi-step "Create Dispatch" dialog (search a fulfilled Sales Order → pick
  its Sales Fulfilment → a Fulfilled/Already Dispatched/Remaining item grid), and a
  detail dialog with delivery history, status-conditional actions, and the informational
  "Associated Distributor" card.
- **Field Sales surface** (`/field/deliveries`) — a new fifth bottom-nav tab, a card list
  defaulting to dispatches still needing action, and a full-screen delivery-confirmation
  sheet (`FieldDeliverySheet`) with a Dispatched/Delivered/Remaining grid, recipient
  name, notes, and a proof-of-delivery photo step using `ImageUploadCard`'s new
  `preferCamera` prop to open the device's rear camera directly.
- **Seed data** — a new Boby Bites fixture (customer `CUS-000012` "Mama Nkechi Stores",
  outlet `OUT-000009`, order `SO-000011`, `DSP-000001` at 500 dispatched, and a partial
  delivery at 470/500 landing `PARTIALLY_DELIVERED`) exercising the full chain end to
  end, plus the outlet-territory-takes-precedence-over-customer-territory display rule.

### Fixed

- **`DispatchDialog`'s Source Location default was cosmetic only** — the `<Select>`
  visually showed the organisation's default location, but the underlying form state
  never synced to it unless the user manually reopened the dropdown, so submitting
  without touching the field sent an empty `sourceLocationId` and the server correctly
  rejected it. Fixed by resolving the effective value once (`sourceLocationId ||
defaultLocation?.id`) and using that resolved value consistently for the select's
  display, the disabled-check, and the actual submitted payload.

## [Sprint 4.9 Sales Execution & Order Fulfilment Foundation] - 2026-08-22

### Added

- **`SalesFulfilment`/`SalesFulfilmentItem`** — the one explicit, atomic, audited
  operation that actually moves inventory for a Sales Order. `SalesOrderStatus` gains
  `PARTIALLY_FULFILLED`/`FULFILLED` (`DRAFT → CONFIRMED → PARTIALLY_FULFILLED →
FULFILLED`, derived from `Σ SalesOrderItem.quantityFulfilled` vs `Σ quantity` after
  every fulfilment, never stored independently). Modelled directly on Production's
  `ProductionMaterialIssue`/`ProductionMaterialIssueItem`: a Sales Order may have many
  fulfilment batches over time (partial shipments), each pinned to one
  `InventoryLocation`.
- **New endpoints**: `GET /api/sales/orders/:id/availability` (read-only
  ordered/fulfilled/remaining/availableStock/shortfall per line, never gates
  fulfilment), `GET /api/sales/orders/:id/fulfilments` (history), `POST
/api/sales/orders/:id/fulfil` (Owner/Administrator only) — the atomic write.
- **Atomicity, mirroring `ProductionMaterialIssueRepository.issue()` exactly**:
  `SalesFulfilmentRepository.create()` runs an idempotency check, a conditional
  eligibility re-check, a per-item `InventoryStock` read-guard-decrement (negative stock
  structurally impossible), the fulfilment+items write, paired `InventoryTransaction`
  `ISSUE` rows (`referenceType: 'SalesFulfilment'` — the same shared ledger Production's
  Material Issue already writes to, no new transaction type), and the item/order status
  recomputation, all inside one `$transaction`, rolled back together on any failure.
- **Idempotency** — a new `SalesFulfilment.idempotencyKey` column +
  `@@unique([salesOrderId, idempotencyKey])`. Both the Admin dialog and the Field Sales
  sheet generate one via `crypto.randomUUID()` per fulfilment attempt; a retried request
  with the same key returns the original fulfilment instead of double-deducting stock —
  verified live (a duplicate submit produced exactly one stock deduction, one
  `InventoryTransaction`, and no duplicate audit event).
- **Cancellation guard** — once any fulfilment is recorded, `POST /:id/cancel` returns a
  clear `400` ("Cannot cancel an order after fulfilment has started") instead of
  silently succeeding or 404ing.
- **A deliberate, documented, narrow exception to Sprint 4.8's "Sales never touches
  Inventory" rule**: `sales.module.ts` now imports `InventoryModule` — but only so the
  new `SalesFulfilmentService`/`SalesFulfilmentRepository` can reach it.
  `SalesOrderService` (order create/update/confirm/cancel) still has zero Inventory
  imports of its own, and `direct-sales-independence.spec.ts`'s structural guard was
  narrowed (not deleted) to assert this precisely against `sales-order.service.ts`'s own
  source rather than the whole module.
- **Admin UI**: a new `SalesFulfilmentDialog` (mirrors `MaterialIssueDialog`'s
  Ordered/Already Fulfilled/Remaining/Available grid, plus a Location picker), wired into
  `sales-order-detail-dialog.tsx`'s footer; a "Fulfilment History" section and a
  "Fulfilled" items column.
- **Field Sales UI**: a full-screen (`Sheet side="full"`) fulfilment flow off the sticky
  action bar on the order detail screen, and an informational, non-blocking "In stock: X
  {unit}" line under each item card on the new-order screen.
- **Seed data**: `SO-000001` now demonstrates a partial fulfilment (one line partially,
  one fully — order lands on `PARTIALLY_FULFILLED`); new `SO-000008`
  (`CONFIRMED`/unfulfilled fixture) and `SO-000009` (fully `FULFILLED` in one batch); a
  new finished-goods stock top-up for the two SKUs these orders sell. Verified idempotent
  (seed run twice, zero double-deduction, identical summary counts).

### Verified live

Full Boby Bites fulfilment walkthrough against the running application (not just unit
tests): partial fulfilment → full fulfilment → terminal-state rejection (fulfil and
cancel both correctly blocked once `FULFILLED`) → over-fulfilment rejected with an exact
message → insufficient-stock rejected with an exact message → RBAC (Member 200 on both
`GET`s, 403 on `POST .../fulfil`) → idempotent duplicate-submit protection → Field Sales
mobile flow at 360/375/430px, including the full-screen fulfilment sheet and the
new-order stock hint.

### Note on commit history

Sprints 4.6–4.9 had accumulated together in one uncommitted working tree across
several sessions. When asked to commit and push, the changes were split into four
separate commits — one per sprint, matching this repo's established one-commit-per-sprint
convention — by reconstructing each sprint's exact file boundaries (using this
codebase's own inline `Added Sprint X.Y` markers plus exact knowledge of this
session's own edits for the 4.8/4.9 boundary) rather than committing everything as a
single lump. Verified byte-identical to the original working tree afterward: `tsc`,
`eslint`, the full Jest suite (39 suites / 419 tests), and both production builds all
passed identically before and after the split.

## [Sprint 4.8 Customer, Territory, Outlet, Retail Network & Sales Foundation] - 2026-08-21

### Added

- **Five new domains**: `Customer` (the commercial account — progressive onboarding,
  only customer type/name/phone required, `customerType` purely descriptive and never a
  sales restriction), `Territory` (a self-referential, tenant-defined hierarchy of
  arbitrary depth — not fixed administrative boundaries — with a service-enforced cycle
  guard on re-parenting), `Outlet` (the physical place of business, distinct from
  `Customer`; optional territory and one-shot browser-geolocation coordinates, never
  required), `DistributionNetworkRelationship` (an optional, separate concept from
  commercial transactions — a customer never requires a distribution-network mapping to
  be registered or to place an order, and adding one never rewrites historical sales),
  and `SalesOrder`/`SalesOrderItem` (server-authoritative totals, SKU-level targeting
  only via Sprint 4.7's Product Family/Variant/SKU architecture, `DRAFT → CONFIRMED`/
  `CANCELLED` lifecycle). `apps/api/src/retail/{territory,customer,outlet,network}/` +
  `apps/api/src/sales/` — six new tables plus `OutletPhoto`, the first
  multi-file-per-entity model in this codebase (the existing single-file `FileStorage`
  port is left unmodified; a new child model calls it once per file instead).
- **The sprint's core architectural guarantee, enforced structurally**: `SalesModule`
  never imports `NetworkRelationshipModule` or `InventoryModule` — creating or confirming
  a Sales Order can neither be gated by a distribution-network relationship nor silently
  move inventory, because the code that could do either isn't even reachable from the
  Sales domain. A dedicated test file,
  `apps/api/src/sales/direct-sales-independence.spec.ts`, verifies this both
  behaviourally (every `CustomerType`, with zero network relationships, can place and
  confirm a direct order; a relationship added later never rewrites a prior order) and
  structurally (asserts the import never appears in `sales.module.ts`'s own source).
- **Outlet photography** — `POST/DELETE /api/retail/outlets/:id/photos(/:photoId)`, the
  first multi-file upload in this codebase (`FilesInterceptor`, up to 6 files per
  request). Foundational capture/store/associate only — no image analysis.
- **A brand-new mobile-first Field Sales workspace** (`apps/web/src/app/(field)/`) — a
  completely separate route group from the desktop `(app)` Workspace shell, with its own
  slim header, sticky bottom tab bar (Home/Customers/Outlets/Orders), and sticky
  bottom-of-screen primary actions on every create/edit screen. Covers: Home (quick
  actions, recent customers/orders), Customer search/detail/progressive-onboarding
  create, Outlet search/detail/create (with location capture and photo staging), and a
  3-step Sales Order flow (customer → outlet → SKU picker via a new bottom-sheet
  component) ending in a clear success screen. Shares every API with the Admin surface —
  no duplicated business logic.
- **`Sheet`** (`packages/ui/src/components/sheet.tsx`) — a new bottom-sheet/full-screen
  overlay primitive, a sibling to the existing centered-modal `Dialog` (which hardcodes
  `max-w-md` with no size variant). A new `touch` `Button` size (`h-12`, ≥44px) was added
  alongside the existing `default`/`sm`/`lg`/`icon` sizes.
- **`MultiImageUploadCard`** (`apps/web/src/components/app/`) — the multi-photo
  counterpart to the existing single-file `ImageUploadCard`, used by both the Field
  Sales outlet screen and the Admin outlet dialog.
- **Admin surfaces**: `/settings/retail` (Customers/Outlets/Territories/Network tabs,
  responsive down to a card layout on narrow viewports — a new pattern introduced only
  in this folder) and `/settings/sales` (Sales Order management), both following the
  existing tabbed-page/dialog conventions from Production/Inventory.
- **Seed data**: 7 territories (Oyo State hierarchy), 9 customers spanning every
  `CustomerType` (including one seeded with only name/type/phone, proving the
  minimum-onboarding path), 7 outlets, 3 network relationships (deliberately covering
  only 4 of 9 customers — 5 remain un-networked and buy directly, by design), and 5
  sales orders demonstrating an un-networked supermarket buying direct, an un-networked
  retailer buying direct, a distributor's own bulk direct order, a _networked_ retailer
  still buying direct, and an order with no outlet at all.
- **New audit events** — `customer.created/updated/activated/deactivated`,
  `territory.created/updated/activated/deactivated`,
  `outlet.created/updated/activated/deactivated/photo_added/photo_removed`,
  `network-relationship.created/updated/deactivated`,
  `sales-order.created/updated/confirmed/cancelled`.

### Fixed

- **Two real bugs caught during this sprint's own live verification, not present in the
  final code**: (1) an unselected native `<select>` with an empty-placeholder option
  (e.g. Territory "Not set") always submits `""`, which `z.string().min(1).optional()`
  rejects — `.optional()` only exempts `undefined`, and `""` fails `.min(1)`. Every
  affected optional id/email field in `packages/validation/src/retail.ts` now
  preprocesses `""` to `undefined` before validation. (2) `params` in a Next.js 14 Client
  Component dynamic route is a plain object, not a `Promise` — three new `[id]` routes
  had mistakenly used the Next.js 15 `use(params)` pattern, which throws
  `An unsupported type was passed to use()`; fixed to the plain `params.id` access every
  other dynamic route in this codebase already uses. Also fixed: an async-loaded
  `<select>`'s preset value (e.g. arriving at "Add Outlet" from a customer's own detail
  page) silently failing to show as selected when the option list resolves after
  `react-hook-form`'s initial mount — the same race `ProductionOrderDialog` had already
  worked around on its own BOM picker, now also applied to the Territory/Customer
  pickers in the Outlet, Customer, and Territory dialogs.

## [Sprint 4.7 Product Family, Variant & SKU Architecture Refinement] - 2026-08-15

### Added

- **`ProductFamily`/`ProductVariant`** — a grouping/reporting hierarchy layered on top of
  the existing flat Product Catalogue: `Organisation → ProductFamily → ProductVariant →
Product (SKU)`. A Family is a commercial grouping (e.g. "Plantain Chips"); a Variant is
  a recipe/formulation within it (e.g. "Sweet & Spicy — Ripe Plantain"); the SKU
  (`Product`) — unchanged, gains only an optional `productVariantId` — remains the actual
  stockable/manufacturable/sellable item every other domain transacts against. Different
  pack sizes of the same variant (30g/500g/1kg) are still each their own independent
  `Product` row; there is no dedicated pack-size entity this sprint. `GET/POST
/api/product-families`, `GET/PATCH /api/product-families/:id`, `GET/POST
/api/product-variants`, `GET/PATCH /api/product-variants/:id` (Owner/Administrator
  write, Member read-only, same `RolesGuard` convention as every other domain). Auto-
  generated immutable `FAM-000001`/`VAR-000001` codes, `ACTIVE`/`INACTIVE` status (a UI
  convenience, not a cross-domain business rule the way `Product.status` is). A variant's
  parent family cannot be changed after creation (no re-parenting) this sprint.
- **`Product` gains `productVariantId`** (nullable, `onDelete: SetNull`) — every
  pre-existing product (including the flagship `PRD-000001` with its already-`COMPLETED`
  Sprint 4.6 production history) is left with `productVariantId: null`, untouched by the
  migration. `GET /api/products`/`GET /api/products/:id` responses now include nested
  `productVariant`/`productFamily` context; write endpoints accept an optional
  `productVariantId` (validated tenant-scoped, `400` on a missing/cross-tenant id).
- **`ProductRepository` gained two new read methods** (`findByIdWithHierarchy`/
  `findManyByOrganisationWithHierarchy`) used only by `ProductService`'s own `getById`/
  `list` — its pre-existing `findById`/`findManyByOrganisation` methods, directly
  consumed by `BillOfMaterialService` for finished-product validation, were left
  byte-for-byte unchanged so Production's own Product lookups are completely unaffected
  by this sprint (confirmed by a new regression test).
- **Frontend `/settings/products`** gained a Flat/Hierarchy view toggle — the hierarchy
  view groups every SKU under its real Family → Variant tree (looked up from the actual
  fetched Family/Variant lists, never fabricated from a product's own narrow nested
  data), with clickable headers opening the corresponding edit dialog. The flat table
  gained a "Family / Variant" column. New "Add Family"/"Add Variant" entry points open
  `ProductFamilyDialog`/`ProductVariantDialog`. The existing `ProductDialog` gained a
  cascading Family → Variant picker (Family selection is local UI state; only the
  resolved `productVariantId` is submitted), shown only when creating/editing a
  `FINISHED_PRODUCT` — a UI convention, not a server-side restriction.
- **Seed data** — a "Plantain Chips" `ProductFamily` with 3 variants (Sweet & Spicy—Ripe,
  Green & Spicy—Unripe, Classic Salted), each with 30g/500g/1kg SKUs (9 total), plus one
  BOM + Production Order against the Sweet & Spicy 30g SKU demonstrating the full
  Family→Variant→SKU→BOM→Production Order chain. Idempotent across repeated runs.
- **New audit events** — `product-family.created/updated`, `product-variant.created/
updated`.

### Fixed

- A seed-data code collision, caught during this sprint's own database verification: the
  originally-chosen seed codes (`PRD-000020`, `BOM-000002`, `PROD-000002`) silently
  collided with pre-existing rows belonging to a _different_ organisation already present
  in the shared dev database — `Product.code`/`BillOfMaterial.bomNumber`/
  `ProductionOrder.productionOrderNumber` are all globally unique, not per-organisation,
  so the seed script's `upsert` no-op'd against the wrong org's row instead of creating
  the intended Boby Bites SKU. Fixed by switching to verified-free codes
  (`PRD-000030`/`BOM-000003`/`PROD-000003`) and documenting the discovery mechanism in
  the seed script for future sprints' awareness.

### Known limitations

- No dedicated pack-size entity, attribute/option engine, product configurator, or
  e-commerce-style variant selector — the hierarchy is a fixed three-level tree, not a
  generic attribute system, per this sprint's explicit anti-over-engineering brief.
- No re-parenting a `ProductVariant` to a different `ProductFamily`, and no way to detach
  a `Product` from its `ProductVariant` once attached.
- No cross-family/variant aggregation query (e.g. total units across every pack size of a
  variant) — the relational structure makes this straightforward to build later, but no
  such query/endpoint exists yet.
- BOM/Production Order/Inventory Stock continue to target the SKU (`Product`) exclusively
  — this is a deliberate, non-negotiable architectural boundary, not a limitation to be
  lifted later.

## [Sprint 4.6 Production Management & Bill of Materials Foundation] - 2026-08-15

### Added

- **`BillOfMaterial`/`BillOfMaterialItem`** — a recipe defining how much of each
  Raw Material/Packaging Material/Consumable a `FINISHED_PRODUCT` needs to produce a
  given yield quantity. `DRAFT → ACTIVE → INACTIVE` lifecycle; only one `ACTIVE` BOM
  per finished product at a time (activating one atomically deactivates any prior
  `ACTIVE` BOM for the same product); editable only while `DRAFT` — a BOM that has
  ever been active is superseded by creating a new version, never edited in place.
  `GET/POST /api/production/boms`, `PATCH .../:id`, `POST .../:id/activate`,
  `POST .../:id/deactivate` (Owner/Administrator write, Member read-only).
- **`ProductionOrder`/`ProductionOrderItem`** — an instruction to manufacture a
  planned quantity of a finished product against one pinned Bill of Materials at one
  `InventoryLocation`. Material requirements are computed once at creation
  (`bomItem.quantity × plannedQuantity ÷ bom.yieldQuantity`) and snapshotted into
  `ProductionOrderItem`, never recalculated even if the source BOM is later edited or
  superseded. Status lifecycle `DRAFT → PLANNED → IN_PROGRESS → COMPLETED`, with
  `CANCELLED` reachable only from `DRAFT`/`PLANNED` — once material is issued,
  cancellation is structurally impossible (documented limitation, not a silent
  inventory reversal). `GET/POST /api/production/orders`, `PATCH .../:id`,
  `POST .../:id/plan`, `POST .../:id/cancel`.
- **Material Availability Check** — `GET /api/production/orders/:id/availability`
  returns Required/Available/Shortfall per component, purely informational — it never
  gates planning, issuing, or completing an order (no stock-reservation engine this
  sprint).
- **`ProductionMaterialIssue`/`ProductionMaterialIssueItem`** —
  `POST /api/production/orders/:id/material-issues` atomically consumes raw materials
  out of Inventory: decrements `InventoryStock` and appends a paired
  `InventoryTransaction` `ISSUE` row per component, inside one transaction (all
  components succeed together or the whole issue rolls back). Over-issue (cumulative
  issued exceeding required) and insufficient stock are both rejected with a `400`.
  Supports multiple partial issues over time. The _first_ successful issue against an
  order automatically transitions it from `PLANNED` to `IN_PROGRESS` — there is no
  separate manual "Start" endpoint.
- **`ProductionRun` — Production Execution** —
  `POST /api/production/orders/:id/complete` records
  Planned/Produced/Rejected/Accepted as distinct figures; `acceptedQuantity` is always
  server-computed (`produced - rejected`) and never accepted from the client. A small
  controlled `ProductionRejectionReason` enum (`BURNT`/`UNDERWEIGHT`/
  `PACKAGING_DEFECT`/`POOR_SEAL`/`OTHER`) + free-text notes, not a full Quality
  Management System. Only reachable from `IN_PROGRESS`; on success the order becomes
  `COMPLETED` and, only when `acceptedQuantity > 0`, the finished product's
  `InventoryStock` increases via a paired `InventoryTransaction` `RECEIPT` row — a
  fully-rejected run writes no stock/ledger row at all.
- **`InventoryModule` now exports** `InventoryStockRepository`,
  `InventoryTransactionRepository`, `InventoryLocationRepository` (previously exported
  nothing), so Production can read stock/location data directly. The atomic
  stock-_moving_ writes (Material Issue, Finished Goods Receipt) reuse
  `GoodsReceiptRepository.receive`'s own precedent — a narrow, documented exception to
  ADR-002's domain-ownership convention, made for atomicity — writing directly into
  `inventory_stock`/`inventory_transactions` from Production's own repositories rather
  than through Inventory's controller/service.
- **Frontend `/settings/production`** — Bills of Materials and Production Orders tabs,
  consistent with the existing Zentuva Workspace UI. `BillOfMaterialDialog`
  (create/edit with a component grid, Add/Remove rows); `ProductionOrderDialog`
  (select an active BOM → live client-computed Material Requirements preview scaling
  with planned quantity); `ProductionOrderDetailDialog` (requirement snapshot,
  availability banner, material issue history, production result, and every reachable
  status-transition action); `MaterialIssueDialog` (Required/Already Issued/
  Remaining/Available per component, blocks over-issue/over-available client-side);
  `ProductionRunDialog` (live-computed, read-only Accepted preview). Production nav
  item activated (`/settings/production`, no longer "Coming Soon").
- **New audit events** — `production.bom.created/updated/activated/deactivated`,
  `production.order.created/updated/planned/started/cancelled`,
  `production.material-issued`, `production.completed`,
  `production.finished-goods-received`.

## [Sprint 4.5 Inventory Control & Stock Management] - 2026-08-15

### Added

- **`InventoryLocation`** — a minimal physical-location model (name + Active/Inactive
  status, no bins/shelves/zones/barcodes). Every stock balance is now
  `Organisation + Product + Location`, not just `Organisation + Product`. Every
  organisation gets a "Main Warehouse" default location, created lazily and
  idempotently the first time it's actually needed (first Goods Receipt, first
  Adjustment, or first visit to the Locations tab) rather than hooked into
  organisation registration. Owner/Administrator can add, rename, and
  activate/deactivate additional locations via `GET/POST /api/inventory/locations`,
  `PATCH /api/inventory/locations/:id`; the default location can never be
  deactivated (every caller that doesn't pick a location falls back to it).
- **Manual stock adjustments** — `POST /api/inventory/adjustments` (Owner/Administrator
  only), the first controlled write path to `InventoryStock` outside of receiving.
  Takes a Product, an optional Location (default location if omitted), a signed
  quantity delta, a structured reason (`PHYSICAL_COUNT`/`DAMAGE`/`SPOILAGE`/`LOSS`/
  `FOUND_STOCK`/`DATA_CORRECTION`/`OTHER`), and optional notes. Writes a new
  `InventoryTransaction` `ADJUSTMENT` row and updates `InventoryStock.quantityOnHand`
  atomically, in that order, inside one transaction — the same "ledger first, cache
  second" discipline `GoodsReceiptRepository.receive` already established. Hard
  negative-stock prevention: an adjustment that would take `quantityOnHand` below zero
  is rejected (`400`), never silently clamped.
- **Frontend `StockAdjustmentDialog`** — Product/Location/Adjustment Type
  (Increase/Decrease)/Quantity/Reason/Notes, with a live-computed, read-only "New
  Balance" preview and the Save button disabled if that preview would go negative.
- **Frontend Locations tab** — list every location with its status and how many
  distinct products currently have stock there; create/rename/deactivate via
  `LocationDialog`.
- **Frontend Inventory Summary enhancements** — new Code/Type/UoM/Location/Quantity
  Available/Last Movement columns, plus Product Status and Location filters alongside
  the existing search and Product Type filter.
- **Frontend running balance** — the Transactions tab, once filtered to a single
  product, shows a client-computed running balance per row (ascending cumulative sum
  of the ledger's `quantity`, displayed against the existing newest-first ordering) —
  no new endpoint, since `GET /api/inventory/transactions?productId=` already returns
  everything needed.
- **New audit events** — `inventory.adjusted`, `inventory.location.created`,
  `inventory.location.updated`, `inventory.location.deactivated`.

### Changed

- **`InventoryStock`**'s unique key changed from `(organisationId, productId)` to
  `(organisationId, productId, locationId)`; gained `quantityReserved` (always `0`
  this sprint — reservation itself isn't implemented, the column exists purely so a
  future Sales/Production workflow doesn't need a shape change) and a computed
  `quantityAvailable` (`quantityOnHand - quantityReserved`) in API responses.
- **`InventoryTransaction`** gained `locationId`, `adjustmentReason`, `notes`, and
  `createdById`; `referenceId` became nullable (a manual adjustment has no other
  entity to point at, unlike a `GoodsReceipt`-sourced `RECEIPT` row).
- **`GoodsReceipt`** gained `locationId` — every receipt now records which location it
  was received into (always the organisation's default location this sprint; there is
  still no location picker on the Goods Receiving form, per the brief's explicit
  "without breaking the existing flow" instruction).
- **`GET /api/inventory`** gained `?productStatus=`/`?locationId=` filters alongside
  the existing `?search=`/`?productType=`.

### Fixed

- `InventoryModule` was missing `InventoryLocationRepository` from its provider list,
  which crashed the whole API at boot (`Nest can't resolve dependencies of
InventoryService`) the moment `InventoryService`'s constructor grew a fourth
  repository dependency — caught during this sprint's own live-server verification,
  fixed before merge.

## [Sprint 4.4.1 Goods Receiving, Inspection & Supplier Discrepancy Refinement] - 2026-08-13

### Changed

- **Redesigned the receiving model** to distinguish what was ordered from what a
  supplier actually delivered, what passed inspection, what was rejected, what remains
  outstanding, and what happened to the discrepancy — a real manufacturing receiving
  workflow gap identified during Sprint 4.4's own local testing. `GoodsReceiptItem` now
  records `deliveredQuantity`, `rejectedQuantity`, and a server-computed
  `acceptedQuantity` (`delivered - rejected`, never accepted from the client) against
  the specific `PurchaseOrderItem` it's fulfilling, instead of a single
  `quantityReceived` figure.
- **Inventory now increases only by the accepted quantity, never the delivered
  quantity** — a rejected portion never enters usable stock or writes an
  `InventoryTransaction` row.
- **A Purchase Order may now be received more than once** — the original "received
  once" restriction is gone. Short deliveries can be completed later, a rejected batch
  can be followed by a supplier replacement, and a delivery can even be recorded against
  an order that's already fully `RECEIVED` (the brief's own worked example: order 1,000,
  receive 1,100 with 50 rejected, then later receive 50 replacement units). "Duplicate
  receipt protection" is redesigned around receipt identity — every `POST` always
  creates its own new, immutable, uniquely-numbered `GoodsReceipt` — rather than a
  status gate that blocked legitimate repeat receiving.
- **`PurchaseOrderStatus` gained `PARTIALLY_RECEIVED`.** A Purchase Order's status now
  tracks delivery completeness (cumulative delivered vs. ordered quantity across every
  receipt), not acceptance — an order can reach `RECEIVED` even if some of what arrived
  was rejected; that rejection is tracked separately, per receipt. Once a Purchase Order
  reaches `PARTIALLY_RECEIVED`/`RECEIVED`, it can no longer be edited or cancelled
  (`PurchaseOrderService`), matching the existing rule for `CANCELLED` orders.

### Added

- **A lightweight supplier-discrepancy resolution state** on each `GoodsReceipt` —
  `discrepancyStatus` (`NONE`/`PENDING_SUPPLIER`/`REPLACEMENT_EXPECTED`/
  `REPLACEMENT_RECEIVED`/`CREDIT_EXPECTED`/`RESOLVED`) plus free-text
  `discrepancyNotes`, auto-set to `PENDING_SUPPLIER` when a receipt has any rejected
  quantity. Progressable via the new
  `PATCH /api/inventory/goods-receipts/:id/discrepancy` endpoint — the one mutation ever
  applied to an otherwise-immutable `GoodsReceipt`. Deliberately not a full Supplier
  Claims/Returns/Credit-Note system.
- **Structured rejection reasons** — a `RejectionReason` enum
  (`DAMAGED`/`DEFECTIVE`/`WRONG_ITEM`/`WRONG_SPECIFICATION`/`CONTAMINATED`/`OTHER`) plus
  free-text notes per rejected line.
- **`GET /api/inventory/purchase-orders/:purchaseOrderId/receiving`** — a per-item
  Ordered/Delivered/Accepted/Rejected/Outstanding/Excess aggregate plus the full receipt
  history for a Purchase Order, powering both the Goods Receiving dialog's "previously
  delivered" context and a new read-only "Receiving Summary" table embedded in
  Procurement's own Purchase Order dialog.
- **Frontend `/settings/inventory` "Goods Receipts" tab** — the full receiving history
  (every receipt's delivered/rejected/accepted breakdown per item, rejection
  reason/notes) with an inline control to progress a receipt's discrepancy status.
- **Goods Receiving dialog reworked** — selecting a Purchase Order now loads its full
  receiving context (Ordered/Previously Delivered/Accepted/Rejected/Outstanding per
  item); the user enters Delivered Quantity and, if applicable, Rejected Quantity +
  Reason + Notes; Accepted Quantity is always shown computed, never editable; an
  "Excess Supply" badge appears when delivering more than what's outstanding, never
  blocked or capped.
- Three new audit actions: `goods-receipt.discrepancy-recorded` (a receipt has a
  rejection), `goods-receipt.replacement-received` (not the first receipt against the
  order), `goods-receipt.resolved` (`PATCH .../discrepancy` sets `RESOLVED`).
- **Seed data** — three additional Purchase Orders and five Goods Receipts spanning
  every scenario: a complete/perfect delivery, a short delivery left open, a delivery
  with rejected goods followed by an immediate replacement (demonstrating multi-receipt
  history), and an excess delivery accepted in full.
- 13 new/updated backend unit tests (`InventoryService`/`InventoryController`/
  `PurchaseOrderService`) — 200/200 total.

### Known limitations

- No Quality Management module, Supplier Claims module, Supplier Returns module,
  Accounts Payable, Credit Notes, Warehouse Management, Batch/Lot tracking, Expiry
  tracking, multi-warehouse support, or automated supplier communication — all
  explicitly out of scope per the brief, reserved for future modules.
- No automatic linkage between a rejected Goods Receipt and the later replacement that
  resolves it — a person must mark the original `RESOLVED`; the system doesn't infer the
  connection.
- The Purchase Order status write remains a deliberate, documented exception to
  ADR-002's domain-ownership convention (now guarding against a concurrent cancel rather
  than blocking repeat receiving) — see `docs/domains/inventory.md` §6.

## [Sprint 4.4 Inventory Management (Goods Receiving)] - 2026-08-13

### Added

- **Inventory domain** (`apps/api/src/inventory/`) — the fourth non-Identity business
  domain module, and the first to consume Procurement directly: it receives an existing
  `PurchaseOrder`'s items into a live per-product stock balance and transitions the order
  to `RECEIVED`. Not a stock management sprint — no warehouse transfers, stock
  adjustments, or inventory counts — see `docs/domains/inventory.md`.
- **`GoodsReceipt`/`GoodsReceiptItem`, `InventoryStock`, `InventoryTransaction` Prisma
  models** (migration `20260813153410_add_inventory_goods_receiving`): auto-generated
  immutable `goodsReceiptNumber` (`GRN-000001`, ...), a live `quantityOnHand` balance per
  `(Organisation, Product)`, and a new `InventoryTransactionType` enum
  (Receipt/Issue/Adjustment — this sprint only ever writes `RECEIPT` rows).
- **A ledger-centric design from day one** — per the brief's own architectural
  recommendation, `InventoryTransaction` is the immutable, insert-only source of truth
  for every stock movement; `InventoryStock` is a fast-to-query cache of where that
  ledger currently nets out. Every future module that moves stock (Production, Sales,
  Stock Adjustment) is expected to write into this same table.
- **Receiving Rules** — a Purchase Order may only be received once; only a `PENDING`
  order is eligible (`CANCELLED` and already-`RECEIVED` orders are rejected with
  distinct `400`s); every submitted item must already belong to the Purchase Order being
  received. Enforced in `InventoryService.receiveGoods` _and_ re-checked inside
  `GoodsReceiptRepository.receive`'s own database transaction — the transaction's own
  `updateMany` only matches a `PENDING` order, so a concurrent duplicate-receive attempt
  finds zero rows and the whole transaction rolls back, preventing a partial stock
  increment against an order that didn't actually transition.
- **API** — `GET /api/inventory`, `GET /api/inventory/:productId`,
  `GET /api/inventory/transactions`, `GET`/`POST /api/inventory/goods-receipts`,
  `GET /api/inventory/goods-receipts/:id`. `GET` requires only authentication (Member has
  read-only access); the one write (`POST .../goods-receipts`) requires Owner or
  Administrator (`RolesGuard`). No `PATCH`/`DELETE` endpoints — Goods Receipts are
  immutable.
- **`packages/validation/src/inventory.ts`** — `createGoodsReceiptSchema`, the line-item
  schema, and the `InventoryTransactionType` enum schema, mirroring
  `procurement.ts`/`suppliers.ts`'s conventions.
- **Frontend `/settings/inventory`** (under the Sprint 3.5 Workspace shell): an Inventory
  Summary tab (Product, Product Type, Quantity On Hand, Last Updated, with search and a
  Product Type filter) and a read-only Transactions tab (Date, Product, Type, Quantity,
  Reference), plus a `GoodsReceivingDialog` — select an eligible (`PENDING`) Purchase
  Order, its Supplier and items with expected quantities load automatically, enter each
  line's received quantity, Save.
- **Workspace navigation** — "Inventory" in the sidebar and the `/workspace` dashboard's
  Platform Modules grid now point at `/settings/inventory` and lost their "Coming Soon"
  state; every other future module continues showing "Coming Soon."
- **Seed data** — one goods receipt (`GRN-000001`) fully receiving `PO-000001` (Fresh
  Farms Ltd, Plantain, 2,000 kg — the brief's own worked example), bringing `PO-000001`
  to `RECEIVED` and seeding `InventoryStock`/`InventoryTransaction` rows to match.
- Every mutating action is audited twice per receipt: `goods-receipt.received` and
  `inventory.increased` (brief: "Record: Goods Received, Inventory Increased").
- 18 new backend unit tests (`InventoryService`/`InventoryController`) — 187/187 total.

### Known limitations

- No Stock Adjustments, Warehouse Transfers, Multiple Warehouses, Inventory Counts,
  Production Consumption, Sales Deductions, Returns, Batch/Lot Tracking, or Expiry
  Tracking — all explicitly out of scope per the brief, reserved for later Inventory and
  Production sprints.
- A Purchase Order can only be received in full, in one event — no partial receiving or
  discrepancy workflow when received quantity differs from ordered quantity.
- The Purchase Order status flip to `RECEIVED` writes to Procurement's table directly
  from inside `GoodsReceiptRepository`'s own transaction — a deliberate, documented
  exception to the "domains reference each other only through exported
  repositories/services" convention, made so all four writes (receipt, stock, ledger, PO
  status) commit or roll back together. See `docs/domains/inventory.md` §6.

## [Sprint 4.3 Procurement (Purchase Orders)] - 2026-08-02

### Added

- **Procurement domain** (`apps/api/src/procurement/purchase-order/`) — the third
  non-Identity business domain module, following the same repository/service/controller
  architecture as Product Catalogue/Supplier Management. Covers the purchasing workflow
  from creating a Purchase Order through issuing it to a supplier; goods receiving into
  Inventory is explicitly out of scope (Sprint 4.4) — see `docs/domains/procurement.md`.
- **`PurchaseOrder`/`PurchaseOrderItem` Prisma models** (migration
  `20260802171910_add_procurement_purchase_orders`): auto-generated immutable
  `purchaseOrderNumber` (`PO-000001`, ...), `PurchaseOrderStatus` enum (Draft/Pending/
  Approved/Cancelled/Received — this sprint only reaches Draft/Pending/Cancelled,
  Approved/Received are reserved for the future approval and goods-receiving workflows),
  a `Supplier` relation, and one-to-many `PurchaseOrderItem` rows (`productId`, quantity,
  unit price, and a server-calculated line total).
- **A fourth Product Type — `CONSUMABLE`** — added to the existing `ProductType` enum
  (Sprint 4.1) alongside Raw Material/Packaging Material, so Procurement has a complete
  set of purchasable input types distinct from Finished Products.
- **Automatic, server-side calculations** — every line's total is always
  `quantity * unitPrice`, the order subtotal is the sum of every line, and the total
  equals the subtotal (no taxes or discounts in MVP). Nothing submitted by the client is
  trusted for these figures; the server recomputes them from the submitted items on
  every create/update.
- **Product-type validation** — only products whose type is Raw Material, Packaging
  Material, or Consumable may appear on a Purchase Order line; Finished Products are
  rejected with a `400`. Enforced in `PurchaseOrderService` (the source of truth) and
  mirrored in the frontend's product picker, which only lists purchasable types, so a
  user can't even select a Finished Product in the first place.
- **API** — `GET`/`POST /api/procurement/purchase-orders`,
  `GET`/`PATCH /api/procurement/purchase-orders/:id`,
  `POST /api/procurement/purchase-orders/:id/cancel`. `GET` requires only authentication
  (Member has read-only access); every write requires Owner or Administrator
  (`RolesGuard`). No `DELETE` endpoint — cancelled purchase orders remain in history and
  become read-only (no further edits allowed).
- **`packages/validation/src/procurement.ts`** — `createPurchaseOrderSchema`,
  `updatePurchaseOrderSchema`, the line-item schema, and the `PurchaseOrderStatus` enum
  schema, mirroring `suppliers.ts`/`catalogue.ts`'s conventions.
- **Frontend `/settings/procurement`** (under the Sprint 3.5 Workspace shell): a purchase
  order table (number, supplier, order date, expected delivery, status badge, total,
  actions), client-side search (PO number/supplier) plus status and supplier filter
  dropdowns, and a reusable `PurchaseOrderDialog` with a header (supplier, order date,
  expected delivery, remarks) and an items grid (product picker filtered to purchasable
  types, quantity, unit price, a live-computed line total, Add/Remove Row) with running
  Subtotal/Total. A `CANCELLED` order opens the same dialog fully disabled with no submit
  button, satisfying the brief's "Cancelled POs become read-only."
- **Workspace navigation** — "Procurement" in the sidebar and the `/workspace`
  dashboard's Platform Modules grid now point at `/settings/procurement` and lost their
  "Coming Soon" state; every other future module continues showing "Coming Soon."
- **Seed data** — 5 additional raw-material/packaging Products (Plantain, Vegetable Oil,
  Printed Nylon, Salt, Cartons) and 3 example Boby Bites Purchase Orders spanning every
  status this sprint reaches: `PO-000001` (Fresh Farms Ltd, Plantain, `PENDING` — already
  issued, matching the brief's own worked example), `PO-000002` (Golden Oil Ltd,
  Vegetable Oil, `DRAFT`), `PO-000003` (PackRight Nigeria, Printed Nylon, `CANCELLED`).
- Every mutating endpoint is audited: `purchase-order.created`, `purchase-order.updated`,
  `purchase-order.cancelled`.
- 16 new backend unit tests (`PurchaseOrderService`/`PurchaseOrderController`) —
  169/169 total.

### Known limitations

- No Goods Receiving, Inventory Transactions, Supplier Invoices, Purchase Approval
  Workflow, Payments, multi-currency, taxes, discounts, partial deliveries, or back
  orders — all explicitly out of scope per the brief, reserved for later Procurement and
  Inventory sprints.
- Reaching `PENDING` ("issued to supplier") happens by editing a `DRAFT` order and
  changing its Status field — there is no separate "Issue" action/endpoint this sprint.
- Amounts are stored as `Float`, not an arbitrary-precision `Decimal` type — consistent
  with the rest of this schema, which has no precedent for `Decimal` yet, and sufficient
  for the MVP figures involved; each calculation step rounds to 2 decimal places to limit
  floating-point drift.

## [Sprint 4.2 Supplier Management] - 2026-08-02

### Added

- **Supplier Management domain** (`apps/api/src/suppliers/supplier/`) — the second
  non-Identity business domain module, following the same repository/service/controller
  architecture as the Product Catalogue (Sprint 4.1): `SupplierRepository`,
  `SupplierService`, `SupplierController`, `SupplierModule`. Deliberately **not**
  Procurement — no Purchase Orders, Goods Receiving, Invoices, or Product–Supplier
  relationships; this is the master vendor record Procurement (Sprint 4.3+) is expected to
  reference by id — see `docs/domains/suppliers.md`.
- **`Supplier` Prisma model** (migration `20260802163405_add_supplier_management`):
  auto-generated immutable `supplierCode`, `supplierName`, `displayName`, contact fields
  (`contactPerson`, `email`, `phoneNumber`, `website`), location fields (`country`,
  `state`, `city`, `address`), `taxIdentificationNumber`, `supplierCategory` enum (Raw
  Material/Packaging/Logistics/Maintenance/Utility/Service/Other), `status` enum
  (Active/Inactive — never physically deleted), `notes`, and `createdById`/`updatedById`
  metadata (plain columns, no FK relation, same convention as `Product.createdById`).
- **Supplier Code generation** — `SUP-000001`, `SUP-000002`, ... — a global sequential
  collision-avoidance loop mirroring `ProductService.generateUniqueCode` (Sprint 4.1).
  Immutable and never accepted on create/update input.
- **API** — `GET`/`POST /api/suppliers`, `GET`/`PATCH /api/suppliers/:id`. `GET` requires
  only authentication (Member has read-only access); every write requires Owner or
  Administrator (`RolesGuard`, same mechanism as every other domain since Sprint 2.1). No
  `DELETE` endpoint — suppliers become `INACTIVE` via `PATCH` instead. Unlike Product's
  dedicated activate/archive routes, a status change here is just another `PATCH` field;
  the controller still records a distinct `supplier.activated`/`supplier.deactivated`
  audit event when it happens (same "status event wins" pattern as
  `UserController.resolveUpdateAuditAction`).
- **`packages/validation/src/suppliers.ts`** — `createSupplierSchema`,
  `updateSupplierSchema`, and the `SupplierCategory`/`SupplierStatus` enum schemas,
  mirroring `catalogue.ts`'s plain-string-literal convention.
- **Frontend `/settings/suppliers`** (under the Sprint 3.5 Workspace shell): a supplier
  table (code, name, category, contact person, phone, status badge, actions), client-side
  search (name/code/contact person) plus status and category filter dropdowns, and a
  proper empty-state for an organisation with no suppliers yet. A reusable
  `SupplierDialog` handles both Create and Edit, including the full field set from the
  brief (name, display name, contact person, email, phone, website, country, state, city,
  address, tax ID, category, notes, status).
- **Workspace navigation** — "Suppliers" in the sidebar and the `/workspace` dashboard's
  Platform Modules grid now point at `/settings/suppliers` and lost their "Coming Soon"
  state (added in Sprint 3.5.1); every other future module continues showing "Coming
  Soon."
- **Seed data** — 5 example Boby Bites suppliers (Fresh Farms Ltd, Golden Oil Ltd,
  PackRight Nigeria, Salt Masters Ltd, Lagos Cartons Ltd), all `ACTIVE` with realistic
  contact/location details.
- Every mutating endpoint is audited: `supplier.created`, `supplier.updated`,
  `supplier.activated`, `supplier.deactivated`.
- 14 new backend unit tests (`SupplierService`/`SupplierController`) — 153/153 total.

### Known limitations

- No Purchase Orders, Goods Receiving, Invoices, Vendor Payments, Procurement Workflows,
  Contracts, Price Lists, or Product–Supplier relationships — all explicitly out of scope
  per the brief, reserved for Procurement (Sprint 4.3+).
- Category is a fixed enum, not tenant-configurable.
- "Inactive suppliers cannot receive future Purchase Orders" is a stated business rule with
  nothing to enforce it against yet, since Purchase Orders don't exist.

## [Sprint 3.5.1 Workspace Navigation Refinement] - 2026-08-02

### Added

- Three future modules now appear as disabled "Coming Soon" entries in the Workspace
  sidebar and the `/workspace` dashboard's Platform Modules grid, so the navigation
  communicates the full long-term Manufacturing Operating System roadmap rather than
  only the modules already scheduled: **Suppliers** (`/suppliers`), **Asset Register**
  (`/assets`), and **Maintenance** (`/maintenance`). All three use the existing
  `comingSoon` mechanism from `navigation-config.ts` (Sprint 3.5) — non-clickable,
  visually identical to Procurement/Inventory/Production/Sales/Distribution/Finance/
  Reports, no routes or pages created.

### Notes

- Navigation-only change: no backend, database, API, or authentication changes. No new
  domain documentation, since these modules haven't been designed yet.

## [Sprint 4.1 Product Catalogue Foundation] - 2026-08-01

### Added

- **Product Catalogue domain** (`apps/api/src/catalogue/product/`) — the first
  non-Identity business domain module, following the same repository/service/controller
  architecture established for Identity: `ProductRepository`, `ProductService`,
  `ProductController`, `ProductModule`. Product is the master source of truth every
  future manufacturing module (Inventory, Production, Sales, ...) is expected to
  reference by id — see `docs/domains/catalogue.md`.
- **`Product` Prisma model** (migration `20260801184041_add_product_catalogue`):
  identity fields (auto-generated immutable `code`, `name`, `displayName`, `slug`),
  classification (`ProductCategory` enum — Snacks/Beverage/Water/Confectionery/Raw
  Materials/Packaging/Others; `ProductType` enum — Finished Product/Raw Material/
  Packaging Material), free-text `unit`, one image (`imageUrl`/`imageKey`, same
  `FileStorage` pattern as `Organisation.logoUrl`/`User.avatarUrl`), `ProductStatus`
  (Draft/Active/Archived — never physically deleted), and `createdById`/`updatedById`
  metadata (plain columns, no FK relation, same convention as `AuditLog.actorUserId`).
- **Product Code generation** — `PRD-000001`, `PRD-000002`, ... (`ProductService.
generateUniqueCode`), a global sequential collision-avoidance loop mirroring
  `OrganisationService.generateUniqueOrganisationCode` (Sprint 3.2). Immutable and never
  accepted on create/update input.
- **API** — `GET`/`POST /api/products`, `GET`/`PATCH /api/products/:id`,
  `POST /api/products/:id/activate`, `POST /api/products/:id/archive`,
  `POST`/`DELETE /api/products/:id/image`. `GET` requires only authentication (Member has
  read-only access); every write requires Owner or Administrator (`RolesGuard`, same
  mechanism as every other domain since Sprint 2.1). Status transitions are validated —
  activating an already-active product (or archiving an already-archived one) is a `400`,
  not a silent no-op.
- **`packages/validation/src/catalogue.ts`** — `createProductSchema`,
  `updateProductSchema`, and the `ProductCategory`/`ProductType`/`ProductStatus` enum
  schemas, mirroring `identity.ts`'s plain-string-literal convention (no `@prisma/client`
  import, since `apps/web` also depends on this package).
- **Frontend `/settings/products`** (under the Sprint 3.5 Workspace shell): a product
  table (image, code, name, category, type, status badge, updated date, actions), simple
  client-side search by name/code (no pagination, per the brief), and a proper empty-state
  for a catalogue with no products yet. A reusable `ProductDialog` handles both Create and
  Edit (the image upload control only appears in Edit mode, since uploading requires an
  existing product id); `ProductViewDialog` is a read-only details modal. Product image
  upload/preview/replace/remove reuses the Sprint 3.4 `ImageUploadCard` component.
- **Workspace navigation** — "Products" in the sidebar and the `/workspace` dashboard's
  Quick Actions/Platform Modules now point at `/settings/products` and lost their "Coming
  Soon" state; every other module continues showing "Coming Soon."
- **Seed data** — 5 example Boby Bites products (Plantain Chips, Potato Chips, Roasted
  Groundnut, Kulikuli, Chin Chin), all `SNACKS`/`FINISHED_PRODUCT`/`ACTIVE`, no images.
- Every mutating endpoint is audited: `product.created`, `product.updated`,
  `product.activated`, `product.archived`, `product.image.uploaded`,
  `product.image.removed`.
- 24 new backend unit tests (`ProductService`/`ProductController`) — 139/139 total.

### Known limitations

- No variants, batch numbers, expiry dates, barcode/QR generation, taxes, multi-image
  galleries, bulk import/export, pricing, or inventory/procurement/sales integration —
  all explicitly out of scope per the brief, reserved for their own future sprints.
- Category and Product Type are fixed enums, not a tenant-configurable taxonomy.
- The Create Product dialog cannot attach an image in the same request — a product must
  be created first (its id is needed by the upload endpoint), then edited to add an
  image.

## [Sprint 3.5 Workspace Dashboard & Global Navigation] - 2026-08-01

### Added

- **Permanent Workspace shell** — `apps/web/src/components/workspace/` (`WorkspaceLayout`,
  `Sidebar`, `Topbar`, `NavigationGroup`, `NavigationItem`, `WorkspaceHeader`,
  `QuickActionCard`, `ModuleCard`) replaces the ad-hoc `AuthenticatedNav` every
  `/settings/*`/`/account/*` route previously imported on its own. Desktop renders a fixed
  left sidebar + top bar; mobile/tablet collapse the sidebar into a slide-over drawer
  opened from a hamburger button. Wired in once via `apps/web/src/app/(app)/layout.tsx` (a
  Next.js route group — adds no URL segment), so every authenticated route shares one
  layout instance instead of duplicating navigation per route.
- **`/workspace` — the new permanent landing page after login**
  (`apps/web/src/app/(app)/workspace/page.tsx`): a welcome header (organisation logo/name +
  workspace theme), a Quick Actions grid (Manage Organisation, Manage Users, Product
  Catalogue, View Profile), a Platform Modules grid covering every domain from
  `docs/roadmap.md` Phase 2/3 (active modules link out, unbuilt ones render disabled with a
  "Coming Soon" badge), and two static placeholder cards (Recent Activity, Platform
  Status) — deliberately not metric-heavy or backed by any new API, per the brief's
  explicit "Out of Scope: analytics, charts, KPIs, notifications, activity feeds."
- `apps/web/src/components/workspace/navigation-config.ts` — single source of truth for
  the sidebar's three sections (Workspace/Administration/Support) and the sidebar/Platform
  Modules grid it drives. Adding a future module means adding one entry here.
- `apps/web/src/components/workspace/icons.tsx` — a small hand-rolled stroke-icon set (no
  icon-library dependency added), same rationale as the existing hand-rolled `Dialog`/
  `DropdownMenu`/marketing `Logo`.
- **Orange and teal brand tokens** (`--brand-orange`, `--brand-teal` in
  `packages/ui/src/styles.css`, `brandOrange`/`brandTeal` in
  `packages/config/tailwind/preset.js`) — decorative accents (not tenant-customisable like
  `--primary`/`--accent-pink`, not the platform identity mark like `--brand-purple`) used
  to rotate purple/pink/orange/teal across the Platform Modules grid, per the brief's
  "navigation should reflect these brand colours, not just purple."

### Changed

- **Login now redirects to `/workspace`** instead of `/settings/organisation`
  (`apps/web/src/app/login/page.tsx`); the forced first-login `mustChangePassword` →
  `/change-password` branch is unchanged, and `/change-password`'s own post-success
  redirect now also lands on `/workspace` (`apps/web/src/app/change-password/page.tsx`).
- **Route restructuring, no URL changes**: `settings/organisation`, `settings/users`,
  `account/profile`, `account/security`, `account/sessions` moved under a new
  `app/(app)/` route group so they share `WorkspaceLayout`. Because route groups add no
  URL segment, every existing link/bookmark to these pages keeps working unchanged —
  confirmed in the production build's route table and via live browser navigation.
  `apps/web/src/app/settings/layout.tsx` and `apps/web/src/app/account/layout.tsx` (each
  independently rendering `AuthenticatedNav`) are deleted, replaced by the one
  `app/(app)/layout.tsx`.
- `AuthenticatedNav` is retired; its logic (account/workspace queries, branding
  application, `mustChangePassword` guard, account dropdown) moved into `Topbar`, which
  also gained a mobile hamburger button and now shows the user's uploaded profile photo in
  the account-menu trigger when one exists (falls back to initials otherwise).

### Fixed

- **`/account/profile`'s "Profile Photo" card is a real upload**, not the Sprint 3.3
  disabled placeholder. Built the same way as Sprint 3.4's organisation logo upload:
  `POST`/`DELETE /api/account/avatar` (`apps/api/src/identity/account/account.controller.ts`)
  reuse the same `FileStorage` port and a new shared `assertValidImageFile` validator
  (`apps/api/src/identity/common/image-upload-validation.ts`, extracted from the
  logo-upload validation `SettingsController` already had). `User.avatarUrl`/`avatarKey`
  are new plain nullable columns (migration `20260801010000_add_user_avatar_fields`) —
  `avatarKey` is its own column rather than stashed in a JSON `settings` blob the way
  Organisation does it, since `User` has no such bucket. Frontend: a new shared
  `ImageUploadCard` component (`apps/web/src/components/app/image-upload-card.tsx`)
  replaces what would otherwise be two near-identical upload/preview/replace/remove
  implementations — the Branding tab's logo cards were refactored to use it too, so both
  features share one implementation instead of two.

### Known limitations

- Platform Modules grid descriptions and the module list itself are static copy — nothing
  reads from `docs/backlog.md`'s Epics programmatically.
- No `defaultLandingPage` preference is consumed anywhere yet (Sprint 3.4 added the
  Preferences toggle; login always redirects to a fixed destination regardless of its
  value) — unchanged by this sprint.
- "Workspace Settings" (Administration section) and every module below Dashboard render
  as "Coming Soon" per the brief — no route exists for them yet.

## [Sprint 3.4 Workspace Configuration & Organisation Branding] - 2026-08-01

### Added

- `apps/web/src/app/settings/organisation/page.tsx` — replaces the single-page
  Organisation Settings (Sprint 2.1) with a multi-tab Workspace Configuration Center:
  General, Branding, Regional, Business, Preferences, and a Security placeholder. A
  sidebar on desktop collapses to a horizontal scrollable tab bar on mobile/tablet. Every
  tab shares one `GET /api/settings/workspace` query and saves independently via its own
  `PATCH`.
- `apps/api/src/identity/settings/` — a new `SettingsController`/`SettingsModule` at
  `/api/settings/*`, built entirely on the existing `OrganisationService`/`AuditService`
  (no new repository):
  - `GET`/`PATCH /api/settings/workspace` — the full workspace profile (General +
    Branding + Regional + Business + Preferences fields) as one partial-update surface,
    same pattern as `PATCH /api/organisation/me` (Sprint 2.1).
  - `POST`/`DELETE /api/settings/logo?variant=light|dark` — multipart logo upload/removal,
    type/size validated server-side, with old files cleaned up on replace.
  - Every write requires Owner or Administrator (`RolesGuard`, reused from Sprint 2.1);
    `GET` is open to any authenticated user.
- **File storage abstraction** — `FileStorage` port
  (`apps/api/src/identity/organisation/ports/file-storage.port.ts`) plus a
  `LocalFileStorage` adapter that writes to local disk and serves files via
  `/api/uploads/*` (mounted in `main.ts`). Mirrors the `PasswordHasher`/`TokenService`/
  `SessionStore` port pattern from Sprint 1B.2 — a future S3-backed adapter implements the
  same interface with no change to `OrganisationService`/`SettingsController`.
- **Nine new `Organisation` columns** (migration
  `20260801000000_add_workspace_branding_fields`): `darkLogoUrl`, `primaryColor`,
  `accentColor`, `timeFormat`, `numberFormat`, `registrationNumber`, `taxId`,
  `employeeCount` — plain typed columns, same convention as the Sprint 1B.1/2.1 profile
  fields. `businessType` (existing, previously unused) is now used for "Manufacturing
  Sector". Workspace theme and every Preferences toggle live inside the existing
  `settings` Json column instead of new columns — see
  `apps/api/src/identity/organisation/workspace-settings.ts`
  (`DEFAULT_WORKSPACE_SETTINGS`, deep-merged with stored settings on every read).
- **Live tenant branding** — `apps/web/src/lib/branding.ts` converts a tenant's chosen
  hex primary/accent colours to the app's existing HSL CSS custom properties
  (`--primary`/`--ring`/`--accent-pink`) and applies them via `useApplyBranding`, called
  from `AuthenticatedNav` (rendered on every authenticated page) alongside the
  light/dark/system theme class toggle. No component was changed to consume tenant
  colours — everything already read `hsl(var(--primary))` via the existing Tailwind
  tokens. Zentuva's own `--brand-purple` is deliberately never overridden — it stays the
  platform's own identity colour across every tenant.
- `AuthenticatedNav` now also renders the organisation's own logo (or a colour-matched
  initials avatar when none is uploaded, `apps/web/src/lib/org-initials.ts`) next to the
  organisation name — alongside, not replacing, the Zentuva product mark.
- Client-side logo validation (`apps/web/src/lib/logo-validation.ts`): type, size (2 MB),
  and — for raster images — pixel dimensions, checked before the upload request for fast
  feedback; type and size are re-validated server-side as the authority.
- Every workspace write is audited: `workspace.settings.updated`,
  `workspace.logo.uploaded`, `workspace.logo.removed`
  (`apps/api/src/identity/organisation/workspace-audit-actions.ts`).
- 17 new backend unit tests (workspace settings merge, logo upload/replace/remove
  key-tracking, `SettingsController` mapping/validation/authorization) — 106/106 total.

### Known limitations

- **"Reset to Zentuva default" isn't a real "unset."** The colour pickers default to
  Zentuva's own pink shades when no override is stored, but saving always writes a
  concrete hex value — there's no way to explicitly clear back to "inherit the platform
  default" once a colour has been customised (a cosmetic gap, not a data-integrity one).
- **Favicon and Email Header Logo are placeholders only**, per the brief — disabled
  upload buttons, no backend support.
- **Security tab is a placeholder only**, per the brief — five "Coming Soon" cards
  (Password Policy, Sessions, MFA, SSO, API Keys). This is workspace-wide security
  _policy_, distinct from the per-user `/account/security` page Sprint 3.3 already
  shipped (linked from this tab, not duplicated).
- **Server-side image-dimension validation doesn't exist** — only client-side (no
  image-parsing dependency was added this sprint). Type and size are validated on both
  sides.
- **"Business Description" isn't a separate field from General's "Description".** The
  brief listed both, but they're the same underlying `Organisation.description` column —
  duplicating an editable field across two tabs risked two conflicting unsaved drafts of
  the same value, so it's rendered in General only.

## [Sprint 3.3 Account Management & Authentication Experience] - 2026-07-31

### Added

- `apps/api/src/identity/account/` — a new `AccountController`/`AccountModule` at
  `/api/account/*`, entirely reusing existing services (`UserService`,
  `OrganisationService`, `AuthService`, `AuditService`) rather than new repositories:
  - `GET /account/profile` / `PATCH /account/profile` — the caller's own name, phone
    number, and (read-only) employee code, email, role, organisation, joined date, plus
    the security fields (`lastLoginAt`, `failedLoginAttempts`, `passwordChangedAt`,
    `mustChangePassword`) reused by the Security page.
  - `POST /account/change-password` — verifies the current password, hashes and stores
    the new one, and revokes every _other_ active session while keeping the calling
    session signed in (`AuthService.changePassword` + a new
    `SessionRepository.revokeAllForUserExcept`).
  - `GET /account/sessions` / `DELETE /account/sessions/:id` — lists the caller's active
    sessions and revokes one by id, with an ownership check
    (`AuthService.revokeSession`) so a session can only be revoked by the user who owns
    it.
- `User.phoneNumber`, `User.mustChangePassword`, `User.passwordChangedAt` — three new
  columns (migration `20260731000000_add_user_account_management_fields`).
  `mustChangePassword` defaults `true` only for accounts created with an admin-chosen
  temporary password (`UserService.createUser`, Sprint 2.2); self-registered Owners and
  invitation-acceptance users default `false`, since both already chose their own
  password. `passwordChangedAt` is stamped by `UserRepository.updatePasswordHash`
  (shared by change-password and reset-password) and starts `null` ("Never changed").
- `strongPasswordSchema` in `@zentuva/validation` (min length + upper/lower/number/
  special character), applied to both the new `changePasswordSchema` and — as a
  consistency fix — the existing `resetPasswordSchema` (Sprint 1B.2), so every "set a new
  password" path enforces the same policy.
- Frontend: `/change-password` (shared by voluntary changes and the forced first-login
  redirect), `/reset-password/[token]` (completes the Sprint 3.2 forgot-password flow —
  `POST /auth/password/reset` existed since Sprint 1B.2 but had no frontend page until
  now), and `/account/profile`, `/account/security`, `/account/sessions` (wrapped in a
  shared `AccountTabs` sub-nav).
- `PasswordStrength` and `PasswordInput` components
  (`apps/web/src/components/auth/`) — a live strength checklist and a show/hide-password
  toggle, shared across `/login`, `/change-password`, and `/reset-password/[token]`.
- `packages/ui/src/components/dropdown-menu.tsx` — hand-rolled (no Radix, same rationale
  as `Dialog` in Sprint 2.2), used by `AuthenticatedNav`'s new user menu (My Profile /
  Security / Active Sessions / Logout), replacing the bare Logout button from Sprint 3.2.
- `AuthenticatedNav` now calls the new `GET /api/account/profile` instead of Sprint 3.2's
  `GET /api/users/:id` + client-side JWT decode — one request now covers the avatar's
  display data _and_ the `mustChangePassword` flag, which the component uses to redirect
  to `/change-password` before rendering anything else on any `/settings/*`/`/account/*`
  page. `UserController`'s `getUser`-for-self hack and `api-client.ts`'s
  `getCurrentUserId` are removed as a result — both are now genuinely dead code.
- Login page improvements: Remember Me checkbox (backed by a new `remember` parameter on
  `setTokens` — `true` uses `localStorage`, `false` uses `sessionStorage`), show/hide
  password, autofocus on the email field, and a "password updated" banner after a
  successful reset (`/login?passwordReset=1`).
- `POST /auth/password/request-reset`'s dev-mode `resetToken` is now surfaced on
  `/login/forgot-password` as a clickable dev-only link — there's still no real email
  service ("mock for now" per the brief), so this is how the reset flow is testable at
  all without one.
- Every new mutation is audited: `account.profile.updated`, `account.password.changed`
  (new — `apps/api/src/identity/account/account-audit-actions.ts`), plus session
  revocation and password-reset events reusing the existing `auth.session.revoked`/
  `auth.password.reset_requested`/`auth.password.reset` actions from Sprint 1B.2.
- 12 new backend unit tests (`account.controller.spec.ts`, plus `changePassword`/
  `revokeSession` cases added to `auth.service.spec.ts`) — 89/89 total.

### Known limitations

- Discovered (not introduced) during this sprint's manual verification: rapidly calling
  `POST /auth/refresh` within the same wall-clock second as the token it's rotating was
  issued can throw a 500 (Prisma unique-constraint collision on `tokenHash`), because
  refresh JWTs are signed deterministically and `iat` only has second granularity. Only
  reachable via back-to-back scripted requests, not normal browser use. Flagged as a
  follow-up task rather than fixed here, per this sprint's "do not redesign already
  implemented authentication" constraint.
- "Profile Photo" is a placeholder only, per the brief — no upload endpoint exists.

## [Sprint 3.2 Tenant Registration & Organisation Onboarding] - 2026-07-31

### Added

- `POST /api/auth/register` (`apps/api/src/identity/auth/auth.controller.ts`) — the first
  self-service entry point into Zentuva. Accepts organisation details plus an Owner
  account and atomically provisions a new tenant: organisation, its default system roles,
  the Owner user, and an audit entry, all inside one Prisma interactive transaction
  (`OrganisationRepository.registerTenant`) so any failure rolls back every write. Rejects
  duplicate organisation names and duplicate emails with `409 Conflict`
  (`OrganisationService.register`).
- `registerOrganisationSchema` (`packages/validation/src/identity.ts`) — full rewrite of
  the unused Sprint 1B.1 draft to match the real wire contract (`organisationName`,
  `country`, owner `firstName`/`lastName`/`email`/`password`/`confirmPassword`,
  `acceptTerms`, plus optional display name, industry, address fields, phone, business
  email, and website).
- Slug and organisation-code generation: slug = kebab-case of the organisation name with a
  numeric collision suffix (`-2`, `-3`, ...); organisation code = first 3 uppercase letters
  of the name (fallback `ZEN`) + zero-padded 4-digit sequence, incrementing on collision
  (e.g. `SAH-0001`).
- `apps/web/src/app/register/` — the two-section registration form (Organisation
  Information, Owner Account) and `/register/success` confirmation page showing the new
  organisation's name, code, and owner email (passed via URL query params from the
  registration response, not client state, so it survives the full-page navigation).
- `apps/web/src/app/login/` and `apps/web/src/app/login/forgot-password/` — sign-in page
  (stores tokens, redirects to `/settings/organisation`) and a password-reset request page
  that reuses the Sprint 1B.2 `POST /auth/password/request-reset` endpoint, previously
  built but never wired to any frontend.
- `apps/web/src/components/app/authenticated-nav.tsx` + `apps/web/src/app/settings/layout.tsx`
  — a top nav (Logo, organisation name, user avatar with initials, Logout) wrapping all
  `/settings/*` pages. The current user's id comes from decoding the access token's `sub`
  claim client-side (`getCurrentUserId`, display-only, never an authorization decision);
  the name/initials come from the existing `GET /api/users/:id` endpoint — no new backend
  surface was added for this.
- `apps/web/src/lib/auth.ts` (`registerOrganisation`, `login`, `logout`,
  `requestPasswordReset`) and `api-client.ts` additions (`setTokens`, `clearTokens`,
  `getCurrentUserId`).
- **Brand rebalance**: `packages/ui/src/styles.css`'s `--primary` now means pink (was
  purple in Sprint 3.1), so every interactive element that reads `primary` — the default
  `Button` variant, focus rings, links — becomes pink automatically. A new `--brand-purple`
  token was introduced for non-interactive brand elements (headings, icons, illustrations,
  section titles) and applied across the Sprint 3.1 marketing components. This corrects
  Sprint 3.1's purple-heavy balance per this sprint's explicit brief.
- `packages/ui/src/components/checkbox.tsx` — native checkbox styled with
  `accent-primary`, used for the registration form's Terms of Service acceptance.
- `apps/api/src/identity/organisation/organisation.service.spec.ts` — 8 tests covering
  `register()`: success, duplicate name, duplicate email, slug/code collision handling.

### Known limitations

- `OrganisationRepository.registerTenant` writes directly against the Prisma transaction
  client rather than through `UserRepository`/`RoleRepository`/`AuditRepository`, because
  none of those repositories currently accept an external `tx` client. This is a deliberate,
  documented exception to "reuse existing repositories" — the alternative (adding `tx`
  parameters to every repository method) was judged out of scope for this sprint. See
  `docs/sprint-3.2-completion-report.md` for the full rationale.
- No dedicated "current user" endpoint exists yet; the authenticated nav's user info comes
  from decoding the JWT for the id and re-fetching via `GET /api/users/:id`. Fine for
  display, but a future sprint should consider a proper `/auth/me` endpoint if more
  session-derived data is needed.
- "Book a Demo" on the landing page remains a static anchor link — no demo-booking flow
  exists, unchanged from Sprint 3.1.

## [Sprint 3.1 Public Marketing Website — Landing Page] - 2026-07-31

### Added

- Public landing page at `/` (`apps/web/src/app/page.tsx`): Navbar, Hero, Trusted By,
  Problem, What is Zentuva, Platform Modules, Why Zentuva, Retail Intelligence, AI,
  Platform Vision Timeline, CTA, and Footer sections — replaces the Sprint 0 placeholder
  page. No authentication, no backend integration, per the brief.
- `apps/web/src/components/marketing/`: 13 new components (`navbar`, `hero`,
  `trusted-by`, `problem-section`, `what-is-zentuva`, `platform-modules`, `why-zentuva`,
  `retail-intelligence`, `ai-section`, `vision-timeline`, `cta-section`, `footer`,
  `logo`, `container`, `icons`) — all reusable, no lorem ipsum, all copy original.
- Repositioned the product: "The Operating System for African Manufacturing," not an ERP
  or SaaS product — reflected in `layout.tsx` metadata and throughout the page copy.
- **Rebrand**: `packages/ui/src/styles.css`'s `--primary` changed from green to a deep
  purple, plus two new brand tokens (`--lavender`, `--accent-pink`) registered in
  `packages/config/tailwind/preset.js`. This is a shared design-system change — it also
  restyles the existing `/settings/organisation` and `/settings/users` pages, which is
  intentional (one consistent brand, not a marketing-only skin).
- `buttonVariants` now exported from `packages/ui` (was previously internal to
  `Button`) — needed to style `<a>` elements as buttons (nav links, CTAs) without adding
  a Radix `Slot`/`asChild` dependency.

### Known limitations

- **No real logo file.** The brief said to use an attached logo; no image file was ever
  placed in the repo (only shared as an inline chat image mid-session). `ZentuvaMark`
  (`apps/web/src/components/marketing/logo.tsx`) is a best-effort geometric recreation of
  the "Z" mark in the same colors, not the literal source asset. See
  `docs/sprint-3.1-completion-report.md` "Known limitations."
- "Get Started," "Book a Demo," "Request Demo," "Join Early Access," and "Sign In" are all
  static links with no form or backend behind them yet — explicitly out of scope (Sprint
  3.2 covers authentication UI).

## [Sprint 2.2 Organisation Management — User Management] - 2026-07-31

### Added

- `apps/api/src/identity/user/user.controller.ts` + `user.module.ts` — the User
  Management HTTP surface: `GET /api/users` (list), `GET /api/users/:id` (view), both any
  authenticated user; `POST /api/users` (create) and `PATCH /api/users/:id` (combined
  profile/role/status update), both Owner/Administrator only via the same `RolesGuard`
  introduced in Sprint 2.1.
- `UserRepository.findManyWithRolesByOrganisation` / `findByIdWithRoles` /
  `createWithRole`, and `RoleRepository.replaceUserRole` — a user's role assignment is
  treated as "exactly one" for this sprint's MVP model (even though `UserRole` technically
  permits many), resolved by system role _name_ rather than `roleId` (no role-listing
  endpoint exists yet).
- `createUserSchema` / `updateUserSchema` / `userManagementStatusSchema` /
  `systemRoleNameSchema` (`packages/validation/src/identity.ts`) — the wire contract for
  this sprint's endpoints, including the 3-value `ACTIVE`/`INACTIVE`/`LOCKED` status view
  mapped onto the DB's 5-value `UserStatus` enum (`INACTIVE` → `SUSPENDED`).
- `user.activated` / `user.deactivated` audit actions (`user-audit-actions.ts`), alongside
  the existing `user.created`/`user.updated`, recorded on every `POST`/`PATCH` via the
  existing `AuditService`.
- `packages/ui`: `Dialog`/`DialogHeader`/`DialogTitle`/`DialogFooter` (hand-rolled, no new
  dependency), `Select`, `Badge`.
- `apps/web/src/app/settings/users/` — the Users settings page: a table (Name, Email,
  Employee Code, Role, Status), a Create User dialog, an Edit User dialog, and one-click
  Activate/Deactivate per row. No pagination/search/filter/sort, per the brief.
- Seed script (`apps/api/prisma/seed.ts`) now seeds Administrator and Member development
  accounts alongside the existing Owner, via a new `seedUser` helper — same
  "no hardcoded credentials, required env vars" pattern. `apps/api/.env.example`'s
  `SEED_ADMIN_*` placeholder values were also replaced with the actual predictable
  local-development credentials (previously only present in the untracked `.env`), plus
  new `SEED_ADMINISTRATOR_*`/`SEED_MEMBER_*` vars.

### Fixed

- Discovered (not introduced by this sprint) that this app has no global exception filter
  converting the shared `AppError` class into an HTTP response — a `@zentuva/utils`
  `AppError` thrown inside a request handler silently becomes a generic `500`, losing its
  intended status code. `UserService` uses NestJS's own `ConflictException`/
  `NotFoundException` instead (matching `AuthService`'s existing convention), and
  `updateUser` checks the target exists up front so it never reaches
  `UserRepository`'s `AppError`-throwing path. The underlying gap (no filter) is
  pre-existing and unchanged; flagged for a future sprint.

Documentation: `docs/domains/identity.md` reconciled with the shipped User Management API
(§10 Users table, §6 RolesGuard note, §8 audit events table), plus `docs/roadmap.md` and
`docs/database/README.md` swept for the same staleness — see
`docs/sprint-2.2-completion-report.md` §9 for the full list.

## [Sprint 2.1 Organisation Management — Organisation Profile] - 2026-07-30

### Added

- `apps/api/src/identity/organisation/organisation.controller.ts` + `organisation.module.ts`
  — the Organisation Management HTTP surface: `GET /api/organisation/me` (any authenticated
  member) and `PATCH /api/organisation/me` (Owner/Administrator only), backed by the
  `OrganisationService`/`OrganisationRepository` built in Sprint 1B.1.
- `RolesGuard` + `@Roles(...)` decorator (`apps/api/src/identity/auth/guards/roles.guard.ts`,
  `.../decorators/roles.decorator.ts`) — a minimal role-name authorization check (Owner or
  Administrator may update; Member is read-only), per this sprint's explicit "a simple
  role-name check is sufficient... do not build a permission engine" scope. Not the
  generalized permission-key evaluation system identity.md §6 describes long-term — that
  remains future work.
- `RoleRepository.findRoleNamesForUser` / `RoleService.getRoleNamesForUser` — needed by
  `RolesGuard`; didn't exist after Sprint 1B.1/1B.2.
- `Organisation.displayName` column (migration
  `20260730180000_add_organisation_display_name`) — a new MVP field this sprint's field
  list introduced that wasn't in the original identity.md design.
- `updateOrganisationProfileSchema` (`packages/validation/src/identity.ts`) rewritten to
  match this sprint's exact wire contract (`organisationName`, `displayName`, `description`,
  `email`, `phoneNumber`, `website`, `country`, `state`, `city`, `addressLine`, `industry`,
  `currency`, `timezone`) — supersedes the unused Sprint 1B.1 draft, which had no controller
  consumer yet. The controller maps these wire names to their Prisma column names
  (`name`, `phone`, `addressLine1`, `timeZone`).
- `organisation.updated` audit action (`organisation-audit-actions.ts`), recorded on every
  successful profile update via the existing `AuditService`.
- `packages/ui`: `Input`, `Label`, `Textarea`, `Card`/`CardHeader`/`CardTitle`/
  `CardDescription`/`CardContent` — shadcn/ui-style primitives, following the existing
  `Button` component's pattern.
- `apps/web/src/lib/api-client.ts` — a minimal token-aware `fetch` wrapper (reads a bearer
  token from `localStorage`; no login page exists yet, see the completion report's "Known
  limitations").
- `apps/web/src/app/settings/organisation/` — the Organisation Settings page
  (`GET`/`PATCH` via TanStack Query, React Hook Form + Zod validation, four sections:
  General Information, Contact Information, Address, Business Settings), plus Save
  Changes/Cancel.
- `react-hook-form`, `@hookform/resolvers` added to `apps/web`.

### Fixed

- NestJS applies method-level `@UsePipes()` to every parameter, including custom
  decorators like `@CurrentUser()` — not just `@Body()`. Combined with a Zod schema, this
  silently stripped the `@CurrentUser()` payload down to `{}` (Zod's default "strip unknown
  keys" behaviour), which surfaced as a Prisma error on `PATCH /api/organisation/me`. Fixed
  by scoping the pipe to `@Body(new ZodValidationPipe(schema))` instead of the method-level
  `@UsePipes()`, which no other existing endpoint had triggered (none previously combined a
  body-validated `@UsePipes()` with `@CurrentUser()` on the same handler).

Known limitations and deferred work are documented in
`docs/sprint-2.1-completion-report.md`.

## [Sprint 1B.3 Product Backlog] - 2026-07-30

### Added

- `docs/backlog.md` — the single source of truth for Zentuva's long-term product roadmap:
  purpose, product vision, guiding principles, a 13-Epic roadmap (Epic 0 Engineering
  Foundation through Epic 12 AI Platform), current sprint status, a "Future Ideas (Not
  Prioritised Yet)" list, and backlog-maintenance guidance.

Documentation only — no application code, schema, packages, APIs, UI, tests, migrations,
or configuration were touched, per the Sprint 1B.3 brief.

## [Sprint 1B.2 Identity Domain Implementation — Authentication Layer] - 2026-07-30

### Added

- `apps/api/src/identity/auth/` — the Authentication Layer: `AuthService` (login, refresh
  token rotation with reuse detection, logout/logout-all, password reset, invitation
  acceptance, account locking), `AuthController` exposing the 8 `/auth/*` endpoints,
  `JwtAuthGuard` + `@CurrentUser()` (pure authentication, no RBAC), `ZodValidationPipe`, and
  the three brief-required ports behind interfaces: `PasswordHasher` (bcrypt),
  `TokenService` (JWT via `@nestjs/jwt`), `SessionStore` (database-backed, wraps
  `SessionRepository`).
- `apps/api/src/identity/crypto/` — `CryptoModule` providing `PASSWORD_HASHER`, split out
  from `AuthModule`/`IdentityModule` to avoid a circular dependency (`UserService` needs it
  too).
- `apps/api/src/identity/password-reset/` — `PasswordResetRepository` + `PasswordResetService`
  (not built in Sprint 1B.1 since nothing called them yet).
- `User.failedLoginAttempts` column (migration
  `20260730173455_add_user_failed_login_attempts`) — the mechanism `UserStatus.LOCKED`
  (added 1A.1) deliberately left as "a Sprint 1B implementation detail."
- `RoleRepository.assignToUser` / `RoleService.assignRoleToUser` — invitation acceptance
  needs to create a `UserRole` row; this capability didn't exist after Sprint 1B.1.
- New environment variables: `BCRYPT_SALT_ROUNDS`, `JWT_ACCESS_SECRET`,
  `JWT_REFRESH_SECRET`, `JWT_ACCESS_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN`,
  `MAX_LOGIN_ATTEMPTS` — validated at boot (non-empty, ≥32 chars for JWT secrets, access ≠
  refresh secret).
- `packages/validation/src/identity.ts`: `acceptInvitationWithTokenSchema`, extending the
  existing `acceptInvitationSchema` with `token`/`firstName`/`lastName`.
- 47 unit tests across 4 new spec files, covering every test target the brief lists
  (password hashing, JWT generation, login, refresh, logout, password reset, invitation
  acceptance, account locking, session management, token rotation).
- `docs/sprint-1B.2-completion-report.md`.

### Changed

- `apps/api/prisma/seed.ts` — switched from `argon2` to `bcrypt` for the seeded admin
  user's password, matching the Authentication Layer's chosen hasher (the `argon2` choice
  in Sprint 1B.1 predated this sprint settling the question; without this change the
  seeded user could never log in). The `argon2` dependency was removed.
- `docs/domains/identity.md` — updated where implementation revealed genuine discrepancies:
  password hashing is bcrypt (not the earlier unconfirmed argon2id assumption); the refresh
  token is a JWT with its own secret (per this sprint's brief) while remaining hashed,
  rotated, and reuse-detected exactly as originally designed; invitation acceptance now
  collects `firstName`/`lastName` (not carried by the `Invitation` entity); `User.status
LOCKED`'s triggering mechanism is now specified; four audit action strings were added to
  §8's event table (`auth.logout_all`, `auth.password.reset_requested`,
  `auth.session.revoked`, `user.locked`). See the completion report's "Deviations" for full
  reasoning on each.

No RBAC evaluation, permission guards, role/organisation/user-management APIs, email
delivery, MFA, OAuth, or SSO were implemented — per the Sprint 1B.2 brief, this was the
Authentication Layer only.

## [Sprint 1B.1 Identity Domain Implementation] - 2026-07-29

### Added

- `apps/api/prisma/schema.prisma` — implemented the full Identity Domain schema (11 models, 3
  enums) exactly per `docs/domains/identity.md` §9. Removed the Sprint 0 placeholder `HealthCheck`
  model.
- Migration `20260729182400_init_identity_domain` — drops `_health_check`, creates all 11 Identity
  tables. Applied and verified against a live Postgres database.
- `apps/api/prisma/seed.ts` — seeds the "Boby Bites" organisation, system roles (Owner,
  Administrator, Member), the full permission catalog, and the first admin user. Admin
  email/password come from required environment variables — no hardcoded credentials.
- `apps/api/src/identity/` — six repositories (Organisation, User, Role, Invitation, Session,
  Audit) with real, tenant-scoped Prisma access, and six matching domain services wired into a new
  `IdentityModule` (imported into `AppModule`, no controllers yet). Verified the full provider
  graph resolves via NestJS dependency injection at runtime.
- `packages/validation/src/identity.ts` — Zod schemas for every documented Identity API contract
  (registration, login, profile updates, invitations, roles, etc.), not yet wired into any
  controller.
- `argon2` added as an `apps/api` dependency, used only to hash the seeded admin user's password.
- `docs/sprint-1B.1-completion-report.md`.

### Changed

- `docs/domains/identity.md` — renamed the system role "Admin" to "Administrator" throughout
  (prose, tables, sequence diagrams), matching the Sprint 1B.1 brief and resolving an existing
  inconsistency with the doc's own "Administrator Name"/"Administrator Email" registration fields.
  Label rename only — no schema or behavioural change.
- `docs/database/README.md` — documented the real Identity Domain models, migrations, and seed
  data (previously a stub).

No authentication, JWT, login, controllers, guards, Swagger, or frontend work was done — per the
Sprint 1B.1 brief, this was Database & Domain Layer only.

## [Sprint 1A.1 Identity Design Refinements] - 2026-07-29

### Changed

- `docs/domains/identity.md` — post-review MVP refinements to the Identity Domain design
  (documentation only, no code/schema/migrations touched): added immutable
  `Organisation.organisationCode`, added optional `User.employeeCode`, expanded `UserStatus` with
  a `LOCKED` state, and added two intentionally-deferred items (Organisation Type, Feature
  flags/module enablement) to the Risks & Future Expansion table.
- `docs/sprint-1A-identity-design-report.md` — added a "Post-Review Refinements" section
  summarising what changed, why, what was deferred, and re-confirming Sprint 1B approval.

The Prisma schema changes were re-validated with `prisma validate`/`prisma format` against a
scratch file, same as the original Sprint 1A schema — still not written into
`apps/api/prisma/schema.prisma`.

## [Sprint 1A Identity Design] - 2026-07-29

### Added

- `docs/domains/identity.md` — complete Identity Domain design: business rules, Organisation
  Registration/Profile split, entity design for all ten entities (Organisation, User, Role,
  Permission, UserRole, RolePermission, Invitation, Session, RefreshToken, PasswordResetToken,
  AuditLog), authentication and authorisation design, tenant isolation strategy, audit strategy,
  a Prisma schema (validated via `prisma validate`/`format` against a scratch file, not yet
  implemented in `apps/api/prisma/schema.prisma`), an API contract sketch, six Mermaid sequence
  diagrams, and a risks/future-expansion table.
- `docs/sprint-1A-identity-design-report.md` — design decisions, assumptions, open questions, and
  recommendations before Sprint 1B implementation.
- `docs/domains/README.md` — added a domain status table.
- `docs/roadmap.md` — checked off Identity domain design under Phase 1.

No API, frontend, authentication logic, or real migrations were implemented — this sprint was
design-and-documentation only, per the Sprint 1A brief.

## [Sprint 0 Finalisation] - 2026-07-29

### Added

- Root convenience scripts for the entire daily dev loop: `infra:up`, `infra:down`,
  `infra:restart`, `infra:logs`, `infra:reset`, `db:generate`, `db:migrate`, `db:studio`,
  `db:seed`, `db:reset` — no developer needs to remember a raw `docker compose` or `prisma`
  command.
- `apps/api/prisma/seed.ts` — placeholder seed script wired up via `pnpm db:seed`, ready for
  domain modules to extend.
- `apps/api` `dev:debug` script (`nest start --watch --debug`) for VS Code debugging.
- `.vscode/launch.json` — shared debug configs for NestJS (attach) and Next.js (server-side +
  client-side), plus a combined compound; `.vscode/extensions.json` and `.vscode/settings.json`
  for a consistent editor setup. (`.gitignore` updated — it previously excluded all of `.vscode/`
  except `extensions.json`, which would have silently dropped `launch.json`.)
- `docs/development/local-development.md` — the complete local development guide (first-time
  setup, command reference, migrations, Prisma Studio, debugging, environment file breakdown,
  port-conflict and Docker troubleshooting).
- Handbook Principle 10 — **Developer Experience Is a Feature** — added to
  [engineering-handbook.md](handbook/engineering-handbook.md) (version bumped to 0.2).

### Changed

- `docker-compose.yml` renamed to `docker-compose.production.yml` and documented as the
  full-stack/production-verification path, **not** the daily development workflow.
  `docker-compose.dev.yml` (Postgres + Redis only) is now the canonical dev-infra file, wrapped by
  the `infra:*` scripts above.
- Simplified the environment file story: local development now needs exactly two files
  (`apps/api/.env`, `apps/web/.env.local`) instead of copying `.env.example` into three or more
  locations. Root `.env` and the non-`.local` app `.env` files are now clearly documented as
  optional/production-compose-only.
- `docs/handbook/getting-started.md` trimmed to a quick-start that links to the full
  [Local Development Guide](development/local-development.md), removing duplicated detail between
  the two documents.
- `docs/handbook/development-workflow.md` and `docs/handbook/architecture-overview.md` updated to
  reflect the `infra:up` / `dev` / `infra:down` workflow and the dev/production compose split.

No business functionality was touched — this sprint was scoped entirely to developer experience
and local development tooling, per the Sprint 0 finalisation brief.

## [Sprint 0 Foundation]

### Added

- Initial engineering foundation: Turborepo monorepo (`apps/web`, `apps/api`, `packages/ui`,
  `packages/types`, `packages/config`, `packages/utils`, `packages/validation`).
- NestJS backend skeleton with global config module, Prisma integration, and a `/api/health`
  endpoint (`@nestjs/terminus`, checks database + heap).
- Next.js frontend skeleton (App Router) with Tailwind CSS, shadcn/ui (`packages/ui`), and
  TanStack Query provider.
- Shared tooling: ESLint, Prettier, Husky + lint-staged, EditorConfig, path aliases, shared
  TypeScript configs.
- Docker Compose for full-stack (`docker-compose.yml`, later renamed to
  `docker-compose.production.yml`) and infra-only local dev (`docker-compose.dev.yml`), plus
  per-app Dockerfiles.
- `docs/` structure: engineering handbook, coding standards, architecture overview, development
  workflow, getting started, ADRs (001–004), API/database/domain doc stubs, roadmap.

No business modules (authentication, users, product catalogue, or any domain module) were
implemented — this is foundation-only, per the task scope.
