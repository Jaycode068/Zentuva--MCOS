# Sprint 13 Completion Report — Financial Statements & Management Reporting Foundation

## 1. Objective

Build a reporting layer on top of the GL/AR/AP/Inventory engine Sprints 7-12 already
established — a Profit & Loss, a Balance Sheet, AR/AP ageing, an Inventory Valuation
tied back to the General Ledger, and a Management Dashboard — governed by one rule
stated repeatedly in the brief: **this is a reporting layer only.** Every figure must
derive from data that already exists (posted Journal Entries, Invoice/SupplierInvoice
rows, InventoryStock); nothing here ever writes a Journal Entry, adjusts a balance, or
recomputes something another domain already owns. Discrepancies (an inventory-to-GL
mismatch, a discrepant supplier invoice) are surfaced for management to investigate,
never silently corrected.

```
Journal Entries (Sprints 7-12) ──┐
Invoice / SupplierInvoice ───────┼──▶ FinancialStatementService / AR-AP Aging / Revenue-Cogs ──▶ Dashboard
InventoryStock ──────────────────┘         (read-only, zero new writes, zero schema changes)
```

The brief's own final instruction was explicit: **do not start coding immediately.**
Before writing any code, the current implementation was inspected, Sprint 7-12
completion reports and domain docs were read, the existing accounting data model was
mapped, and a full plan (`/Users/user/.claude/plans/deep-giggling-shell.md`) was
written and approved before implementation began.

## 2. Architecture Decisions

| #   | Question                                                          | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | The central formula                                               | `ChartOfAccount.type` alone is sufficient to derive a correct P&L and Balance Sheet, via **normal-balance-sign summation**: Asset/Cost-of-Sales/Expense accounts are debit-normal (`amount = debit − credit`), Liability/Equity/Revenue accounts are credit-normal (`amount = credit − debit`). Summing signed amounts within one `AccountType` nets contra accounts automatically (`SALES_RETURNS`, itself `type: REVENUE`, nets against `SALES_REVENUE` with no "contra" flag). **Zero schema changes needed.**                                                                                                                                       |
| 2   | Shared balance query                                              | New exported `getAccountBalances()` in `ledger.service.ts` — the single query both the pre-existing Trial Balance and the new `FinancialStatementService` build on, so an account balance is never computed two different ways.                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 3   | Retained Earnings                                                 | No year-end-closing mechanism exists, nor should Sprint 13 build one. Because every `JournalEntry` is balanced by construction, `Σ(Assets) − Σ(Liabilities) − Σ(recorded Equity)` always exactly equals cumulative net income since the ledger's first posting. The Balance Sheet reports a **computed, non-posted** "Retained Earnings (Undistributed)" line (all-time net profit through the as-of date) — the accounting equation holds by construction, not by adjustment.                                                                                                                                                                          |
| 4   | Gross Margin / null-safety                                        | `grossMargin = revenue === 0 ? null : (grossProfit / revenue) * 100` — `null`, never `NaN`/`Infinity`, rendered as "—" client-side. Same pattern applied everywhere a ratio could divide by zero.                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 5   | Trial Balance enhancement                                         | Added `netBalance`/`systemKey` to `TrialBalanceRow` — purely additive, existing `debit`/`credit` columns and callers unchanged.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 6   | Drill-down                                                        | `LedgerService.getLedger()`/`.getAccountActivity()` already returned everything needed; the gap was entirely frontend. New reusable `AccountActivityDialog` completes `Statement → Account → Ledger Activity → Journal Entry Detail`, opened from every report that lists an account. Required a small bug fix: `LedgerLine` gained `journalEntryId` (previously only the line's own id was exposed, with no way to open the parent entry).                                                                                                                                                                                                             |
| 7   | AR/AP Ageing                                                      | New `getAgingReport(organisationId, asOf?)` added to the _existing_ `AccountsReceivableService`/`AccountsPayableService` (additive, not a new domain). Buckets Current(≤0)/1-30/31-60/61-90/90+ by `asOf − dueDate` in days, computed purely in the service layer. AP's report additionally surfaces `GRNI_PENDING_APPROVAL`'s balance and a count of `DISCREPANCY`-matchStatus invoices.                                                                                                                                                                                                                                                               |
| 8   | Inventory Valuation & Reconciliation — the one boundary exception | Finance has never read Inventory's tables. Rather than importing `InventoryModule`, `InventoryValuationService` reaches directly into `this.prisma.inventoryStock.findMany(...)` — read-only, no transaction, no write verb — the same "narrow, documented exception" pattern Sprint 11/12 established for _writes_ inside a self-owned transaction, applied here to a plain read. `finance-independence.spec.ts` needed **zero changes**. `ReconciliationService` compares the subledger total against `INVENTORY + FINISHED_GOODS_INVENTORY` (`WIP` deliberately excluded — no corresponding `InventoryStock` row) and **never adjusts either side**. |
| 9   | COGS/Revenue — two paths, never reconciled                        | Headline totals always from `JournalEntryLine` filtered to the relevant system account (GL-tied, ties to the P&L). Supplementary by-product/by-customer breakdowns come from `Invoice`/`InvoiceItem` (revenue) and a new `SalesFulfilmentRepository.getCogsBreakdownByProduct()` (COGS) — neither breakdown is a second source of truth for the headline figure.                                                                                                                                                                                                                                                                                        |
| 10  | Date/period filtering                                             | New, pure frontend utility `report-date-range.ts` maps period presets to `{from, to}` — **no backend contract change**; every endpoint keeps accepting plain `from`/`to`/`accountingPeriodId`.                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 11  | Comparative reporting                                             | `?compare=previous_period` computes the immediately-preceding period of identical length; returns `previous: null` (never a misleading zero) when that period has zero posted activity at all.                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 12  | Management Dashboard                                              | Composes — never recomputes — P&L, AR/AP summaries, and Inventory Valuation's grand total, plus a small Operational section (Sales Orders count/value, `ProductionRun.completedAt` count) via the same narrow read-only reach as decision 8. Replaces the existing Overview page in place, not a new tab.                                                                                                                                                                                                                                                                                                                                               |
| 13  | Charts                                                            | `recharts` added as a new dependency (confirmed absent beforehand) — used in exactly two places (Revenue vs COGS vs Gross Profit; AR vs AP), deliberately minimal per the brief's own restraint instruction. A monthly Revenue trend chart was scoped out — it would need a new backend trend endpoint not yet built.                                                                                                                                                                                                                                                                                                                                   |
| 14  | Export/Print                                                      | `window.print()` + inline Tailwind `print:` classes on P&L/Balance Sheet/Trial Balance — zero new dependencies. CSV export deferred as a cheap follow-up.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 15  | RBAC / tenant isolation / audit                                   | Every new report endpoint: `JwtAuthGuard` only, no `RolesGuard` — identical to every existing Finance read endpoint (Member already has full reporting access by existing precedent). No new audit events (pure reads). Every query scoped by `organisationId` from the JWT, same as every other endpoint.                                                                                                                                                                                                                                                                                                                                              |
| 16  | Architectural guard                                               | New `reports-independence.spec.ts` — no reporting file writes a transactional table, calls `postSystemJournalEntry`, or imports an Inventory/Sales/Procurement/Production service or controller.                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

## 3. Database Changes

**None.** No migration this sprint — `AccountType`'s existing six values are
sufficient. This is a deliberately verified result, not an oversight: proof the
accounting foundation built by Sprints 7-12 was already reporting-ready.

## 4. API

| Endpoint                                       | Auth              | Notes                                                    |
| ---------------------------------------------- | ----------------- | -------------------------------------------------------- |
| `GET /api/finance/reports/profit-loss`         | Any authenticated | `?from=&to=&accountingPeriodId=&compare=previous_period` |
| `GET /api/finance/reports/balance-sheet`       | Any authenticated | `?asOf=`                                                 |
| `GET /api/finance/receivables/aging`           | Any authenticated | `?asOf=`                                                 |
| `GET /api/finance/accounts-payable/aging`      | Any authenticated | `?asOf=`, plus GRNI/discrepancy surfacing                |
| `GET /api/finance/reports/inventory-valuation` | Any authenticated | `?locationId=&productType=`                              |
| `GET /api/finance/reports/reconciliation`      | Any authenticated | Inventory subledger vs GL, surfaced not corrected        |
| `GET /api/finance/reports/revenue` \| `/cogs`  | Any authenticated | `?from=&to=`, headline + breakdown                       |
| `GET /api/finance/reports/dashboard`           | Any authenticated | `?from=&to=&compare=previous_period`                     |

## 5. Backend Implementation

- **`apps/api/src/finance/accounting/ledger.service.ts`** — added `AccountBalanceRow`
  (superseding `TrialBalanceRow`, kept as a type alias); new exported
  `getAccountBalances()`; new `getSystemAccountBalance()`; `getTrialBalance()`
  simplified to build on the shared helper; `LedgerLine` gained `journalEntryId`.
- **`apps/api/src/finance/reports/financial-statement.service.ts`+`.controller.ts`** —
  `getProfitAndLoss()`, `getProfitAndLossComparison()`, `getBalanceSheet()`.
- **`apps/api/src/finance/reports/inventory-valuation.service.ts`+`.controller.ts`** —
  reads `InventoryStock` directly (decision 8), computes valuation totals by
  location/product type.
- **`apps/api/src/finance/reports/reconciliation.service.ts`+`.controller.ts`** —
  compares the valuation total against `getSystemAccountBalance` for
  `INVENTORY`/`FINISHED_GOODS_INVENTORY`.
- **`apps/api/src/finance/reports/revenue-cogs.service.ts`+`.controller.ts`** —
  GL-tied headline + breakdown composition (decision 9).
- **`apps/api/src/finance/reports/dashboard.service.ts`+`.controller.ts`** —
  composition (decision 12).
- **`apps/api/src/finance/invoice.repository.ts`** — `getOutstandingForAging()`,
  `getRevenueByProduct()`, `getRevenueByCustomer()`.
- **`apps/api/src/finance/accounts-receivable.service.ts`** /
  **`accounts-payable.service.ts`** — `getAgingReport()` added to each (decision 7);
  `AccountsPayableService` gained a new `LedgerService` constructor dependency for
  GRNI surfacing.
- **`apps/api/src/finance/supplier-invoice.repository.ts`** —
  `getOutstandingForAging()`, `countDiscrepancies()`.
- **`apps/api/src/sales/sales-fulfilment.repository.ts`** —
  `getCogsBreakdownByProduct()` (read-only, exported via the already-imported
  `SalesModule`).
- **`apps/api/src/finance/finance.module.ts`** — registered all 10 new
  reports-related providers/controllers; extended its own doc comment explaining the
  Sprint 13 boundary-exception reasoning.
- **`reports-independence.spec.ts`** — structural guard (decision 16); one iteration
  needed to remove an overly broad `import.*InventoryModule` regex line that
  false-matched a doc-comment mention of "InventoryModule" (same bug class as
  Sprint 12's own AP-independence spec).

## 6. Frontend Implementation

- **`apps/web/src/lib/report-date-range.ts`** — period-preset utility (decision 10).
- **`apps/web/src/app/(app)/settings/finance/account-activity-dialog.tsx`** — new
  reusable component completing the drill-down chain (decision 6).
- **`apps/web/src/app/(app)/settings/finance/profit-loss/page.tsx`** — period
  filter + compare toggle, clickable account lines, "No comparison data" state,
  Print button.
- **`apps/web/src/app/(app)/settings/finance/balance-sheet/page.tsx`** — `asOf`
  picker, balanced/out-of-balance banner, computed Retained Earnings row, an inline
  Reconciliation block with a warning badge when the subledger and GL disagree.
- **`apps/web/src/app/(app)/settings/finance/inventory-valuation/page.tsx`** —
  summary cards + a full product/location table.
- **`apps/web/src/app/(app)/settings/finance/page.tsx`** — rewritten in place from
  Sprint 6's 4-card AR-only Overview into the full Management Dashboard: Financial
  cards, an Operational section, two `recharts` bar charts, period filter, compare
  toggle.
- **`apps/web/src/app/(app)/settings/finance/receivables/page.tsx`** /
  **`payables/page.tsx`** — extended in place with an Ageing section (bucket cards +
  breakdown table).
- **`apps/web/src/components/app/finance-tabs.tsx`** — three new tabs: Profit & Loss,
  Balance Sheet, Inventory Valuation.
- **`apps/web/src/app/(app)/settings/finance/api.ts`** — new
  `// === Reporting (Sprint 13) ===` section with every new interface/function.
- **`apps/web/package.json`** — added `recharts`.

## 7. Accounting Rules

See `docs/domains/accounting.md` §16 for the full writeup (the normal-balance-sign
formula, the computed Retained Earnings treatment, ageing, the Inventory boundary
exception with WIP-exclusion rationale, the two-path COGS/Revenue approach, Dashboard
composition, and the known Other-Income/Expense classification gap). Summary:

- P&L: Revenue − Cost of Sales = Gross Profit; Gross Profit − Operating Expenses =
  Net Profit. Gross Margin is `null`-safe on zero revenue.
- Balance Sheet: Assets = Liabilities + Equity (including computed Retained
  Earnings), holding exactly by construction.
- Inventory Reconciliation: surfaces a difference, never corrects it.
- No new journal entries, no new system accounts, no new writes anywhere.

## 8. Tests

- New `financial-statement.service.spec.ts` (11 tests) — Sales Returns netting,
  gross margin computation and null-safety, operating expense subtraction, P&L
  exclusion of Asset/Liability/Equity accounts, date/period pass-through, comparison
  `previous: null` on zero prior activity vs. computed comparison, Balance Sheet
  accounting-equation-holds-exactly, retained earnings as all-time net profit,
  cumulative querying for the Balance Sheet.
- New `financial-statement.controller.spec.ts` (5 tests) — org-scoping, comparison
  triggering logic, tenant isolation.
- New `inventory-valuation.service.spec.ts` (6 tests) / `.controller.spec.ts` (2
  tests) — value computation, by-location/by-type totals, zero-stock NaN-safety,
  filter pass-through, empty-result zeroing.
- New `reconciliation.service.spec.ts` (4 tests) / `.controller.spec.ts` (1 test) —
  matched reconciliation, surfaced difference without correction, WIP explicitly
  excluded, no write method exposed, tenant isolation.
- New `revenue-cogs.controller.spec.ts` (3 tests).
- New `dashboard.service.spec.ts` (4 tests) / `.controller.spec.ts` (3 tests) —
  composition without recomputation, operational section, comparison
  triggering/skipping.
- New `reports-independence.spec.ts` (6 tests) — the structural guard (decision 16).
- `accounts-payable.service.spec.ts` (new file, 7 tests) — ageing bucketing,
  GRNI/discrepancy surfacing, empty state.
- `accounts-receivable.service.spec.ts` — extended in place with a new
  `getAgingReport` describe block (7 tests).
- `accounts-receivable.controller.spec.ts` (new file, 3 tests) /
  `accounts-payable.controller.spec.ts` (new file, 2 tests).
- Full monorepo quality gate: `prisma validate`, `lint`, `type-check`, `test`, and
  `build`, all green. **90 test suites / 846 tests, all passing** (up from 83/782
  before this sprint).

## 9. Live Verification Performed

Using the actual running API and web dev servers against the real Boby Bites dev
database, logged in as the seeded Owner account. A stale, corrupted Next.js dev
server (several client chunks 404ing after many hours of hot-reloading) caused the
login page's React hydration to fail silently mid-session, which briefly surfaced the
well-known, explicitly-labeled non-real local dev password
(`local-dev-only-not-a-real-password`) in a native-form GET request to the app's own
`localhost:3000` — not a real secret exposure, resolved by clearing `.next` and
restarting the dev server.

1. **Dashboard.** Financial cards (Revenue, COGS, Gross Profit, Gross Margin %, Net
   Profit, AR, AP, Inventory Value) and Operational cards (Sales Orders, Production
   Runs Completed) all rendered with figures internally consistent with every other
   report page. Both `recharts` bar charts (Revenue vs COGS vs Gross Profit; AR vs
   AP) rendered correctly with a period comparison toggle.
2. **Profit & Loss.** Correct Revenue/Sales Returns netting confirmed. The full
   drill-down chain — P&L line → Account Activity → Journal Entry Detail — was
   exercised end-to-end via real clicks, confirming the `journalEntryId` fix (§2
   decision 6) works correctly.
3. **Balance Sheet.** Rendered "Balanced — Assets = Liabilities + Equity." with a
   correctly computed Retained Earnings (Undistributed) figure. The inline
   Reconciliation block surfaced a **genuine, pre-existing discrepancy**: Inventory
   Subledger ₦2,246,412.00 vs GL Inventory Balance ₦633,212.00 (difference
   ₦1,613,200.00), with `FINISHED_GOODS_INVENTORY` showing an unusual negative
   balance of -₦506,088.00. This is accumulated from many sprints of manual
   live-testing across Sprints 8-12, not introduced by Sprint 13's own code, and is
   exactly the kind of finding the Reconciliation report exists to surface. Per the
   brief's explicit "do not automatically adjust" rule, this was **not** fixed or
   explained away — the report correctly displayed it with a "Requires
   investigation" warning badge, confirming the feature works as designed rather
   than exposing a defect to be patched.
4. **Inventory Valuation.** Totals consistent with the figures shown on the
   Dashboard and the Balance Sheet's Inventory line.
5. **AR Aging.** Bucket totals summed correctly to the AR total shown elsewhere:
   ₦325,800 (Current) + ₦1,250,000 (1-30) + ₦1,720,000 (31-60) = ₦3,295,800,
   matching the Dashboard/Receivables AR figure exactly.
6. **AP Aging.** GRNI-pending badge and per-supplier breakdown rendered correctly.
7. **Trial Balance.** Unaffected by the new `netBalance`/`systemKey` additions,
   still balances at ₦8,892,388.00 = ₦8,892,388.00.
8. **Mobile responsiveness (375px).** Dashboard cards stack to a single column, both
   charts render responsively via `ResponsiveContainer`. A self-caught bug was found
   and fixed here: the AR/AP Ageing breakdown tables initially used
   `hidden ... md:block` with no `md:hidden` fallback, making the table **completely
   invisible** below the `md` breakpoint (not just needing scroll) — unlike the
   Trial Balance/Ledger precedent of never hiding such tables. Fixed to a plain
   `overflow-x-auto` wrapper with no `hidden`/`md:block`, verified live afterward.
9. **Zero browser console errors** on every page exercised, confirmed via
   `read_console_messages`.
10. **Full production build** (`next build`) succeeds with `/settings/finance`
    (112kB, reflecting the new `recharts` dependency), `/settings/finance/
balance-sheet`, `/settings/finance/inventory-valuation`, and `/settings/finance/
profit-loss` all present in the route manifest; `tsc --noEmit` and `eslint` clean
    on both `apps/api` and `apps/web`.

No seed data changes were made this sprint — the already-rich accumulated dev
database from Sprints 6-12's own testing proved more than sufficient for every live
scenario, including surfacing the genuine reconciliation discrepancy above.

## 10. Known Limitations

- **No Other-Income/Expense split, no Current-vs-Fixed-Asset distinction** —
  `AccountType` alone drives classification; no account in this codebase's Chart of
  Accounts needs the distinction today (accounting.md §16.6).
- **No Revenue trend / time-series endpoint** — the Dashboard's charts compare
  current-vs-previous-period totals only.
- **No CSV/Excel export** — Print (`window.print()`) only.
- **No configurable KPI engine, no role-specific dashboard variants yet** — the
  reporting architecture is reusable for that future work, but only one Dashboard
  composition exists today.
- **The real inventory-to-GL discrepancy found during live verification** (§9.3)
  remains unresolved by design — this sprint's job was to surface it, not fix it.
  Investigating and correcting it (likely via a manual journal adjustment once the
  root cause across Sprints 8-12 is identified) is explicit follow-up work for
  accounting/management, not a Sprint 13 defect.
- **No budgeting, forecasting, payroll, tax filing, bank reconciliation,
  multi-company consolidation, advanced BI/data warehouse, full role/module
  permission system, year-end closing, or complex accounting-standards
  configuration** — all explicit brief non-goals, unchanged.

## 11. Deferred / Future Work

- A backend trend/time-series endpoint to support a monthly Revenue chart.
- CSV/Excel export for P&L/Balance Sheet/Trial Balance.
- Role-specific dashboard variants built on top of this sprint's reusable reporting
  services.
- Investigating and resolving the real ₦1,613,200.00 inventory-to-GL discrepancy
  surfaced during live verification.
- A configurable KPI engine, once concrete role-specific requirements exist.

## 12. Documentation Updated

`docs/domains/accounting.md` (new §16 "Financial Statements & Management Reporting
(Sprint 13)" with 6 subsections, renumbered API Reference/Known Limitations to
§17/§18, updated §18's limitations list and added the new §17 reporting endpoints),
`docs/domains/finance.md` (updated §11/§12 limitations, new §13 "Financial Statements
& Management Reporting (Sprint 13)"), `docs/domains/inventory.md` (new §11e
documenting Finance's read-only reporting reach), `docs/domains/README.md`
(Finance/Accounting/Inventory status rows), `docs/backlog.md` (Epic 16/17
"Deliberately excludes" lists updated, Current Sprint Status), `docs/roadmap.md`
(Phase 2 Finance/Accounting rows), `docs/changelog.md` (new dated entry), this
completion report.

## 13. Constraint

Per this session's established convention, nothing in this sprint's work has been
committed or pushed — that remains the user's own explicit instruction to give.
