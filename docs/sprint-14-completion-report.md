# Sprint 14 Completion Report — Cash & Bank Management / Reconciliation Foundation

## 1. Objective

Connect the General Ledger to the organisation's real-world cash and bank accounts:
what cash/bank accounts exist, what the accounting system says the balance should
be, what the actual bank statement says, and what remains unreconciled — governed by
the brief's own central architectural principle, stated repeatedly: **do not create
a second accounting system.** The General Ledger remains the sole source of truth;
Cash & Bank Management manages the organisation's actual accounts and reconciles
external bank activity against what the ledger already records.

```
Sales / Procurement / Production / Inventory / Finance ──▶ General Ledger
                                                                  │
                                          CashAccount ◀───────────┘ (linked CoA row)
                                                │
                                     CashTransaction / Payment / SupplierPayment
                                                │
                                     BankStatementTransaction (CSV import)
                                                │
                                          Reconciliation
                                                │
                                (future) Cashflow & Capital Intelligence
```

The brief's own final instruction was explicit: **do not start coding immediately.**
Before writing any code, the current implementation was inspected (Payment/
SupplierPayment's `method`-based `CASH`/`BANK` posting, the Chart of Accounts'
system-key resolution, `journal-posting.ts`'s Sprint-12 `accountId` extension,
`LedgerService.getAccountActivity`), the Sprint 13 completion report and every
relevant domain doc were read, and a full plan
(`/Users/user/.claude/plans/deep-giggling-shell.md`) was written and approved before
implementation began.

## 2. Architecture Decisions

| #   | Question                                         | Decision                                                                                                                                                                                                                                                                                                                                                                                                         |
| --- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Module home                                      | Folded into `FinanceModule` as a new `apps/api/src/finance/cash/` sub-folder — the exact `accounting/`/`reports/` precedent, not a standalone top-level module. No new module imports needed: `ChartOfAccountRepository`, `LedgerService`, `AuditService`, `postSystemJournalEntry` were all already in scope.                                                                                                   |
| 2   | Opening balance — which Chart of Accounts row    | **Auto-provisioned**, never a user-supplied create input — each `CashAccount` gets a dedicated, non-system child of the org's `CASH`/`BANK` system account (or the new `CASH_BANK_PARENT` key for `OTHER_CASH_EQUIVALENT`), never the generic system account itself.                                                                                                                                             |
| 3   | Opening balance — credit side                    | New `SYSTEM_ACCOUNT_KEYS.OPENING_BALANCE_EQUITY`, elevating the already-seeded "3100 Owner's Capital" row — reuses the existing Equity concept, the same elevation pattern Sprint 9 used for `FINISHED_GOODS_INVENTORY`.                                                                                                                                                                                         |
| 4   | `CashAccount` creation idempotency               | Its own `idempotencyKey` + `@@unique([organisationId, idempotencyKey])`, checked first inside the create transaction — the whole operation (CoA provisioning + opening-balance posting) is money-affecting.                                                                                                                                                                                                      |
| 5   | `Payment`/`SupplierPayment` cash-account linkage | **Nullable, optional** `cashAccountId` on both. When supplied, posts against that account's own CoA row (`accountId`); when absent, falls back byte-for-byte to the pre-Sprint-14 `method`-based `CASH`/`BANK` resolution. Kept optional deliberately — required-everywhere would force every existing fixture/test to change, a far larger risk than the brief's own "minimum additive schema change" supports. |
| 6   | `CashTransaction` — direction naming             | `CashTransactionType {RECEIPT, PAYMENT}`; `status` reuses the existing `PaymentStatus` enum. For cash movements outside the Payment/SupplierPayment flows only.                                                                                                                                                                                                                                                  |
| 7   | `CashTransaction` — contra account               | An explicit, user-chosen, non-system `contraAccountId` — the same "Path B" policy `SupplierInvoiceItem.debitAccountId` (Sprint 12) already established.                                                                                                                                                                                                                                                          |
| 8   | Duplicate-import detection                       | Two layers: a deterministic `dedupeHash` (SHA-256 over cash account + normalised date/amount/reference/description) and, where supplied, a stable `externalReference` — both `@@unique`, both checked against already-imported rows and within the same batch.                                                                                                                                                   |
| 9   | CSV import — where parsing happens               | Client-side (`papaparse`) — the browser detects columns, drives the mapping UI, and POSTs already-mapped JSON rows; the backend gets no new CSV dependency and independently re-validates every row.                                                                                                                                                                                                             |
| 10  | `BankReconciliation` period                      | A free date range, not tied to `AccountingPeriod` — a bank statement cycle is bank-defined, and this model never posts a journal entry, so it has no "open period" to respect.                                                                                                                                                                                                                                   |
| 11  | "Book transaction" representation                | `ReconciliationMatch` references a `JournalEntryLine.id` directly — never `Payment`/`SupplierPayment`/`CashTransaction` polymorphically — the literal embodiment of "the GL remains the source of truth."                                                                                                                                                                                                        |
| 12  | Match/session uniqueness                         | Both `ReconciliationMatch` foreign keys are globally unique. Only one `IN_PROGRESS` session per `CashAccount` at a time.                                                                                                                                                                                                                                                                                         |
| 13  | Completion rule                                  | Hard rule: zero unmatched bank items and zero unmatched book items, computed live. A real numeric Difference can still remain visible after completion (never forced to zero) if the entered statement balance predates a later imported row.                                                                                                                                                                    |
| 14  | Reopen a completed reconciliation                | Deferred — corrections happen via a new `CashTransaction`/journal entry in a later session, the same convention `Payment.void()` already establishes.                                                                                                                                                                                                                                                            |
| 15  | Match-action idempotency                         | No new key — `match()` catches the unique-constraint violation and returns the existing match if it's the identical pair; `complete()` on an already-`COMPLETED` session returns the existing state; `auto-match` is naturally re-run-safe.                                                                                                                                                                      |
| 16  | Book/Reconciled/Unreconciled                     | Book Balance = live `LedgerService.getAccountActivity`; Reconciled Balance = latest `COMPLETED` session's `closingBankBalance` (or `openingBalance` if none); Unreconciled = their gap. Nothing is stored independently.                                                                                                                                                                                         |
| 17  | Matching algorithm                               | A single bulk "Auto-match Exact" action — matches only unambiguous same-date/same-amount pairs; anything ambiguous stays for manual review. `ReconciliationMatch.confidenceScore` added, intentionally unused, as a future-proofing column.                                                                                                                                                                      |
| 18  | Account number masking                           | No existing precedent — designed one. Full value stored, never returned by list/detail; a separate Owner/Administrator-only reveal endpoint exposes it, audited with no metadata payload.                                                                                                                                                                                                                        |
| 19  | Frontend routes                                  | Five new `FinanceTabs` entries under the existing `/settings/finance` route — never a new top-level route, matching every prior sprint's own convention.                                                                                                                                                                                                                                                         |
| 20  | Cash Account Detail                              | A full page, not a dialog — needs Transactions/Reconciliation History/Statements sections.                                                                                                                                                                                                                                                                                                                       |

## 3. Database Changes (one additive migration)

New enums: `CashAccountType`, `CashAccountStatus`, `CashTransactionType`,
`BankTransactionMatchStatus`, `BankReconciliationStatus`, `ReconciliationMatchType`.
New `SYSTEM_ACCOUNT_KEYS`: `CASH_BANK_PARENT`, `OPENING_BALANCE_EQUITY` (both elevate
already-seeded rows — see decision #2/#3).

New models: `CashAccount`, `CashTransaction`, `BankStatementImport`,
`BankStatementTransaction`, `BankReconciliation`, `ReconciliationMatch` — fields per
decisions above (see `docs/domains/cash-management.md` for the full field list).

Edits to existing models: `Payment`/`SupplierPayment` gain nullable `cashAccountId`
(+ relation, + index); `ChartOfAccount` gains back-relations `cashAccount`/
`cashTransactionsAsContra`; `JournalEntryLine` gains back-relation
`reconciliationMatch`.

**Balance-integrity statement**: `CashAccount.openingBalance` is write-once
provenance, not a live balance. `CashTransaction`/`BankStatementImport` store no
balance. `BankStatementTransaction.balance` is a display-only copy of the statement's
own reported figure, never used in any computation. `BankStatementTransaction.
matchStatus` is a same-transaction-maintained mirror of `ReconciliationMatch`'s
existence. `BankReconciliation.openingBankBalance`/`closingBankBalance` are
user-entered facts from the physical statement — external reality, cannot drift from
the GL by definition. **Book Balance and Reconciled Balance are never stored
anywhere** — both are always computed live.

## 4. API

| Endpoint                                                                                                  | Auth              | Notes                                                             |
| --------------------------------------------------------------------------------------------------------- | ----------------- | ----------------------------------------------------------------- |
| `GET/POST /api/finance/cash/accounts`                                                                     | Any / Owner+Admin | `POST` provisions a dedicated CoA row + optional opening balance  |
| `PATCH /api/finance/cash/accounts/:id`                                                                    | Owner+Admin       | Identity fields immutable                                         |
| `GET /api/finance/cash/accounts/:id/account-number`                                                       | Owner+Admin       | Full value; audited with no metadata                              |
| `POST /api/finance/cash/accounts/:id/activate` \| `/deactivate`                                           | Owner+Admin       |                                                                   |
| `GET/POST /api/finance/cash/transactions`                                                                 | Any / Owner+Admin | Idempotency-first, contra-account validated                       |
| `POST /api/finance/cash/transactions/:id/void`                                                            | Owner+Admin       | Status flip, no reversing entry (mirrors `Payment.void()`)        |
| `GET /api/finance/cash/bank-statements/imports` \| `/transactions`                                        | Any authenticated |                                                                   |
| `POST /api/finance/cash/bank-statements/:cashAccountId/import`                                            | Owner+Admin       | Already-mapped JSON rows, re-validated + deduplicated server-side |
| `GET/POST /api/finance/cash/reconciliations`                                                              | Any / Owner+Admin | `POST` rejects a second `IN_PROGRESS` session                     |
| `GET /api/finance/cash/reconciliations/:id`                                                               | Any authenticated | Full workspace detail — matched/unmatched panels + live figures   |
| `POST /api/finance/cash/reconciliations/:id/auto-match` \| `/match` \| `/unmatch/:matchId` \| `/complete` | Owner+Admin       |                                                                   |
| `GET /api/finance/cash/overview`                                                                          | Any authenticated | Cash Position Dashboard                                           |

## 5. Backend Implementation

- **`apps/api/src/finance/cash/`** — `cash-account.repository.ts`/`.service.ts`/
  `.controller.ts`, `cash-transaction.repository.ts`/`.service.ts`/`.controller.ts`,
  `bank-statement.repository.ts`/`.service.ts`/`.controller.ts`,
  `bank-reconciliation.repository.ts`/`.service.ts`/`.controller.ts`,
  `cash-dashboard.service.ts`/`.controller.ts`, `cash-independence.spec.ts`, plus a
  `*.repository.spec.ts`/`*.controller.spec.ts` per aggregate.
- **`apps/api/src/finance/cash-bank-audit-actions.ts`** — `CASH_BANK_AUDIT_ACTIONS`,
  same `<entity>.<event>` convention as `accounts-payable-audit-actions.ts`. No
  handler ever places `accountNumber` into audit `metadata`.
- **`apps/api/src/finance/accounting/chart-of-account-keys.ts`** — added
  `CASH_BANK_PARENT`/`OPENING_BALANCE_EQUITY`.
- **`apps/api/src/finance/payment.repository.ts`/`.service.ts`/`.controller.ts`** and
  the mirror `supplier-payment.*` files — optional `cashAccountId` threaded through
  create/response; a new `InvalidCashAccountError` translated to a 400.
- **`packages/validation/src/cash.ts`** (new) + `accounts-payable.ts`/`finance.ts`
  updates for the new optional `cashAccountId` fields.
- **`apps/api/src/finance/finance.module.ts`** — registered the 5 new controllers/
  services/repositories; extended its own doc comment.
- **`apps/api/prisma/seed.ts`** — `postSeedJournalEntry` extended to accept
  `accountId` lines (mirroring the real `journal-posting.ts`'s Sprint-12
  extension); new `seedCashBankSystemAccounts`, `seedCashTransactionContraAccounts`,
  `seedCashAccount`, and `seedCashAndBank` (GTBank/Access Bank/Petty Cash, four
  `CashTransaction`s, one CSV-style `BankStatementImport`, two reconciliation
  sessions — one `COMPLETED`, one deliberately `IN_PROGRESS` with a matched pair
  plus one unmatched bank and one unmatched book transaction) — idempotency-gated
  on `CASH-001` already existing, entirely independent of `seedFinance`'s own gate.

## 6. Frontend Implementation

- **`apps/web/src/components/app/finance-tabs.tsx`** — 5 new tabs (Cash Overview,
  Cash Accounts, Cash Transactions, Bank Statements, Reconciliation).
- **`.../cash/page.tsx`** — the Cash Position Dashboard.
- **`.../cash-accounts/page.tsx`** + `cash-account-dialog.tsx` (single-phase create)
  - **`.../cash-accounts/[id]/page.tsx`** (masked number + reveal, Book/Reconciled/
    Unreconciled strip, recent activity via `getAccountActivity`, reconciliation
    history, statement imports).
- **`.../cash-transactions/page.tsx`** + `cash-transaction-dialog.tsx`.
- **`.../bank-statements/page.tsx`** + `bank-statement-import-dialog.tsx` — a
  two-phase dialog (the `selectedX`-gated pattern `invoice-dialog.tsx` already
  uses, not a generic stepper): pick cash account + file, then map CSV columns →
  Zentuva fields, preview, commit.
- **`.../reconciliation/page.tsx`** + `reconciliation-create-dialog.tsx` +
  **`.../reconciliation/[id]/page.tsx`** — the matching workspace (Matched/
  Unmatched Bank/Unmatched Book panels, a live Difference strip, Auto-match,
  click-to-select manual match, Complete).
- **`.../finance/page.tsx`** (Sprint 13 dashboard) — two small cross-link cards
  (Total Cash, Unreconciled) added, not a second dashboard bolted on.
- **`.../invoices/payment-dialog.tsx`** / **`.../payables/supplier-payment-dialog.tsx`**
  — an optional Cash Account `<select>`, shown when the org has ≥1 matching-type
  account.
- **`.../finance/api.ts`/`labels.ts`** — a new `// === Cash & Bank Management
(Sprint 14) ===` section.
- **`apps/web/package.json`** — added `papaparse`/`@types/papaparse`.

## 7. Accounting Rules

See [Accounting](domains/accounting.md) §17 and
[Cash & Bank Management](domains/cash-management.md) for the full writeup. Summary:

- Opening balance: `DR <cash account's CoA> / CR OPENING_BALANCE_EQUITY`.
- `CashTransaction` RECEIPT: `DR <cash account's CoA> / CR contra account`; PAYMENT:
  the reverse.
- `Payment`/`SupplierPayment` with `cashAccountId`: the cash-side line targets that
  account's own CoA row instead of the generic system account.
- `BankReconciliation`/`ReconciliationMatch` post nothing — a read/review layer over
  already-posted `JournalEntryLine` rows and already-imported statement rows.

## 8. Tests

Repository-level tests (deliberate exception to "no repository tests for atomic
transactions," same justification as prior sprints) for `CashAccountRepository`
(CoA provisioning + parent-by-type resolution, opening-balance posting, idempotent
replay, duplicate-code rejection, missing-system-account rejection, child-code
collision), `CashTransactionRepository` (RECEIPT/PAYMENT posting direction,
tenant/contra-account validation, idempotent replay), `BankStatementRepository`
(valid import, both dedupe layers including within-batch, tenant validation,
idempotent replay), and `BankReconciliationRepository` (one-`IN_PROGRESS`-per-account
rule, match creation + idempotent re-match + already-matched rejection,
unmatch + completed-session rejection, unambiguous-only auto-match, completion
rejecting with unmatched items remaining, completion succeeding and flipping matched
transactions to `RECONCILED`, idempotent re-completion). Controller specs for
tenant-isolation and wasCreated-gated audit behaviour on each aggregate. New
`cash-independence.spec.ts` (6 tests): no Cash & Bank file writes a Sales/Inventory/
Procurement/Production table, none writes `JournalEntry`/`JournalEntryLine`
directly, `postSystemJournalEntry` is called only from the two repositories that
should call it, `BankReconciliation` posts nothing, `FinanceModule` still never
imports `InventoryModule`. Full monorepo quality gate:
`prisma validate`, `lint`, `type-check`, `test`, and `build`, all green.
**99 test suites / 892 tests, all passing** (up from 91/852 before this sprint).
Seed run twice consecutively with identical row counts, confirming idempotency.

## 9. Live Verification Performed

Using the actual running API (`nest start --watch`) and web (`next dev`) apps,
logged in as the seeded Owner account. A stale, pre-Sprint-14 compiled `dist` API
process (the same recurring pattern noted in Sprint 10-13's own reports) was found
listening on port 4000 and had to be killed before the real dev server would bind.

1. **Cash Accounts list + detail.** All three seeded accounts (GTBank, Access Bank,
   Petty Cash) rendered with masked account numbers (`••••6789`/`••••4321`).
   GTBank's detail page showed Book Balance ₦11,100,000.00 (matching the hand-
   computed expectation from seed data exactly: ₦10,000,000 opening + ₦300,000 +
   ₦850,000 receipts − ₦5,000 − ₦45,000 payments), Reconciled Balance
   ₦10,295,000.00 ("as of" the completed first-period session), and Unreconciled
   Difference ₦805,000.00 — all internally consistent.
2. **Reveal full account number.** Clicking Reveal on GTBank correctly displayed
   the full `0123456789`; the resulting audit log row (`cash-account.number-
revealed`) was confirmed to carry an empty `metadata` object — no account number
   anywhere in the audit trail.
3. **Reconciliation resolution (the full brief §28 scenario).** Opened the seeded
   August (6th-31st) `IN_PROGRESS` session — one matched pair, one unmatched bank
   transaction ("Card Processing Fee", −₦12,000), one unmatched book transaction
   (₦45,000 "Petty cash top-up transfer"), Difference −₦33,000. Recorded a new
   `CashTransaction` (PAYMENT, ₦12,000, "Card Processing Fee", contra "6700 Bank
   Charges") to create the missing book side for the bank fee; imported a
   follow-up one-row CSV statement (via the real API, since native file-picker
   dialogs aren't automatable in this session's browser tooling — see note below)
   to create the missing bank side for the petty-cash transfer. Clicked
   **Auto-match Exact**: both remaining pairs matched unambiguously,
   Outstanding Items dropped to 0. Clicked **Complete Reconciliation**: the
   session flipped to `COMPLETED`, all three matched bank transactions moved to
   `RECONCILED`, and the workspace correctly switched to a read-only, immutable
   view ("This reconciliation is completed and immutable...").
4. **GL/Trial Balance consistency.** Trial Balance continued to balance exactly
   (₦22,242,388.00 = ₦22,242,388.00) after every live action. `112001 GTBank
Current Account` (₦11,088,000.00, later ₦11,188,000.00 after the payment test)
   and `112002`/`111001` for the other two accounts appeared as their own distinct
   rows; the pre-existing generic `1120 Bank` system account (₦3,350,000.00)
   stayed completely untouched by every cash-account-tagged posting — confirming
   the new per-account CoA rows are genuinely separate from, and never collapse
   into, the old shared system account. `3100 Owner's Capital` showed exactly
   ₦12,200,000.00, the precise sum of all three accounts' opening balances,
   confirming the `OPENING_BALANCE_EQUITY` postings. `6700 Bank Charges`
   (₦62,000.00) and `4300 Other Income` (₦1,150,000.00) matched the exact sum of
   every seeded and live-recorded `CashTransaction` against them. No duplicate
   journal entries at any point (`JE-000035` through `JE-000042` sequential, no
   gaps or repeats).
5. **Payment → Cash Account linkage.** Recorded a ₦100,000 payment against
   `INV-000005` with GTBank selected from the new Cash Account dropdown. Trial
   Balance confirmed the posting hit `112001` (₦11,088,000 → ₦11,188,000, exactly
   +₦100,000) while `1120 Bank` remained unchanged and `1200 Accounts Receivable`
   decreased by the same ₦100,000 — the optional `cashAccountId` linkage works
   end-to-end through the real UI, backend, and database.
6. **Cash Position Dashboard.** Total Cash ₦13,388,000.00 (exact sum of all three
   accounts' book balances), Bank Balances ₦13,188,000.00, Cash on Hand
   ₦200,000.00, Unreconciled ₦55,000.00 — all cross-checked against the individual
   account detail pages and found consistent.
7. **Responsive check at 375px.** The Reconciliation workspace's 4-card summary
   grid collapsed to a single column, the Matched table remained usable via
   horizontal scroll (not broken or clipped), and the Unmatched Bank/Unmatched
   Book two-column layout collapsed to a stacked single column. The Cash Overview
   dashboard's summary cards and account cards likewise collapsed correctly.
8. **Zero new browser console errors** on every page exercised (a handful of
   stale 401s from an earlier, unrelated JWT-expiry moment mid-session were
   confirmed not to recur after re-authenticating).

**Not literally exercised through the native file-picker UI this session**: the CSV
import dialog's phase-1 file-selection step depends on the OS-native file-picker
dialog, which is not automatable through this session's browser tooling (no
`set_input_files`-equivalent action is exposed). The equivalent backend endpoint
(`POST /finance/cash/bank-statements/:cashAccountId/import`) was exercised directly
against the real running API instead, and the dialog's `papaparse`-based parsing/
mapping code was verified by careful code review. Tenant isolation was verified by
code review (every repository method scopes by the caller's `organisationId`, the
identical pattern proven safe by 13 prior sprints' own live-verified tenant-
isolation tests) rather than a fresh live cross-org click-through, since a second
organisation's live credentials were not readily available this session — noted
here rather than glossed over.

## 10. Known Limitations

- **No field-level encryption for `accountNumber`** — stored in full, masked at the
  API response layer only; documented as a hardening gap, not a claimed guarantee.
- **No reopening a completed reconciliation** — deferred, per the brief's own
  "don't over-engineer" instruction.
- **No bank API integration, Open Banking, or automatic bank feed** — CSV import
  and manual entry only, per the brief's explicit non-goal.
- **`cashAccountId` on `Payment`/`SupplierPayment` is optional, not required** —
  a deliberate choice to avoid breaking every existing flow/fixture; a payment
  recorded with no cash account still posts correctly via the pre-existing
  fallback.
- **Reconciliation matching is intentionally simple** — one deterministic bulk
  auto-match plus fully manual matching, never a confidence-scored suggestion
  engine (the column exists, unused, for future work).
- **No loan/debt/investment management, capital planning, cashflow forecasting, AI
  financial recommendations, payment-gateway integration, payroll, expense
  management, budgeting, advanced treasury management, multi-currency treasury
  engine, or complex bank-matching AI** — all explicit brief non-goals, unchanged.

## 11. Deferred / Future Work

- A controlled "reopen a completed reconciliation" transition.
- A confidence-scored / suggested-match reconciliation mode, built on the already-
  present `ReconciliationMatch.confidenceScore` column.
- CSV/export of reconciliation results.
- Loan management, debt management, investment management, and cashflow
  forecasting — all explicitly designed to reuse this sprint's `CashAccount`/
  Chart-of-Accounts link and `accountId`-based posting mechanism without further
  schema change, once built.

## 12. Documentation Updated

`docs/domains/cash-management.md` (new — full domain writeup), `docs/domains/
accounting.md` (new §17 "Cash & Bank Management (Sprint 14)", renumbered API
Reference/Known Limitations to §18/§19, removed the now-stale "Trial Balance has
no financial-statement layer" bullet left over from Sprint 13, added 3 new
Sprint-14 limitations bullets, added the new endpoints to §18's table),
`docs/domains/finance.md` (header block cross-references, new §14 "Cash & Bank
Management / Reconciliation (Sprint 14)"), `docs/domains/README.md` (Finance/
Accounting status rows updated, new Cash & Bank Management row),
`docs/backlog.md` (Epic 16/17 "Deliberately excludes" lists updated — "Bank
Reconciliation" removed as no longer excluded — new Epic 18 "Cash & Bank
Management", Current Sprint Status), `docs/roadmap.md` (Phase 2 Finance/Accounting
bullets updated, new Cash & Bank Management bullet), `docs/changelog.md` (new
dated entry), this completion report.

## 13. Constraint

Per this session's established convention, nothing in this sprint's work has been
committed or pushed — that remains the user's own explicit instruction to give.
