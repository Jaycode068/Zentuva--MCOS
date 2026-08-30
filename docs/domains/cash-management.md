# Cash & Bank Management Domain

- **Status:** Foundation implemented — Sprint 14 ("Cash & Bank Management /
  Reconciliation Foundation"). A read/write layer over the existing General
  Ledger — never a second accounting system. **Not** a treasury system, a loan/
  investment management module, or a cashflow forecasting engine — see §10.
- **Sprint:** 14
- **Depends on:** [Accounting](accounting.md) (`ChartOfAccountRepository`,
  `LedgerService`, `postSystemJournalEntry`/`resolveOpenPeriodId` — all consumed
  from inside the existing `FinanceModule`, no new module import needed),
  [Identity](identity.md) (tenant boundary, `RolesGuard`, `AuditService`).
- **Explicitly does not depend on:** [Sales](sales.md), [Procurement](procurement.md),
  [Production](production.md), [Inventory](inventory.md) — Cash & Bank Management
  never reads or writes any of their tables, proven executably by
  `cash-independence.spec.ts` (`apps/api/src/finance/cash/`), not just documented
  here.
- **See also:** [Finance](finance.md) §14, [Accounting](accounting.md) §17,
  [Sprint 14 Completion Report](../sprint-14-completion-report.md).

## 1. Business Purpose

Every domain through Sprint 13 records the _accounting_ consequence of a business
event — an invoice raised, a payment applied, a journal entry posted. None of them
answer a more basic question an owner actually asks: **how much cash do we have, and
where is it?** Sprint 14 adds that layer — a `CashAccount` master (every bank
account, cash drawer, or settlement account the organisation actually holds money
in), a way to record cash movements the existing Payment/Supplier Payment flows
don't cover, a CSV bank-statement import, and a reconciliation workflow that
compares what Zentuva's own books say against what the bank statement says.

The General Ledger remains the sole accounting source of truth throughout. This
domain never posts a journal entry independently of the shared
`postSystemJournalEntry` boundary every other domain already uses, and it never
stores a "current bank balance" anywhere — every balance figure this domain shows
is either derived live from `JournalEntryLine` or is a plain, user-entered fact
copied from a physical bank statement.

## 2. `CashAccount` — a Dedicated Chart of Accounts Row, Never the Generic System Account

Before Sprint 14, every `Payment`/`SupplierPayment` posted against exactly one of
two generic, org-wide system accounts (`SYSTEM_ACCOUNT_KEYS.CASH` = Chart of
Accounts `1110`, `SYSTEM_ACCOUNT_KEYS.BANK` = `1120`), chosen by a free-text
`method` enum (`CASH`/`BANK_TRANSFER`/`POS`/`OTHER`) — there was no way to know
_which_ bank account received money, because every bank shared the same one ledger
row.

A `CashAccount` fixes this by never being a ledger account itself. At creation,
`CashAccountRepository.create()` **auto-provisions a dedicated, non-system Chart of
Accounts row** as a child of the organisation's `CASH`/`BANK`/`CASH_BANK_PARENT`
system account (chosen by `accountType`), then links `CashAccount.
linkedChartOfAccountId` to it. This is a system-populated _output_, never a
user-supplied create input — asking a user to hand-pre-create and pick a Chart of
Accounts row before creating a bank account would be worse UX and risks picking the
wrong (generic) one, defeating the whole point.

| `CashAccountType`       | Provisioned under                                                                                           |
| ----------------------- | ----------------------------------------------------------------------------------------------------------- |
| `BANK`                  | The org's existing `BANK` system account (`1120`)                                                           |
| `CASH`                  | The org's existing `CASH` system account (`1110`)                                                           |
| `OTHER_CASH_EQUIVALENT` | `CASH_BANK_PARENT` — the already-seeded "1100 Cash & Bank" row, elevated to a system account by this sprint |

Fields: `accountCode` (tenant-defined, unique per organisation), `name`,
`accountType`, `currency`, `bankName`/`accountNumber`/`accountName` (all optional),
`description`, `status` (`ACTIVE`/`INACTIVE`), `linkedChartOfAccountId`,
`openingBalance`/`openingBalanceDate` (write-once provenance — see §4).

## 3. Bank Account Security

`accountNumber` is stored in full — no field-level encryption exists anywhere else
in this codebase to build on, and this sprint documents that as a known hardening
gap rather than claiming a security guarantee it doesn't provide (§10). Every
list/detail response returns only a server-computed `accountNumberMasked` (last 4
digits, e.g. `••••3456`). The full value is obtainable only via a separate
`GET /finance/cash/accounts/:id/account-number` endpoint, Owner/Administrator only;
its own audit event (`cash-account.number-revealed`) carries no `metadata`
payload — the number itself is never written into any log or audit record.

## 4. Opening Balance

Creating a `CashAccount` with an `openingBalance` posts, inside the same atomic
transaction as the account and its Chart of Accounts row:

```
DR <the new dedicated CoA row>    openingBalance
CR Opening Balance Equity         openingBalance
```

`OPENING_BALANCE_EQUITY` is a new system key elevating the already-seeded, non-system
"3100 Owner's Capital" row — reusing the existing Equity concept rather than
inventing a parallel "Capital Contribution" mechanism, the same "elevate an
already-seeded row" backfill pattern Sprint 9 used for `FINISHED_GOODS_INVENTORY`.
The posting is idempotent (`sourceType: 'CASH_ACCOUNT_OPENING_BALANCE'`, keyed on
the `CashAccount`'s own id), period-aware (rejected if the opening date falls
outside any `OPEN` `AccountingPeriod`, rolling back the whole `CashAccount` create),
and RBAC-protected (Owner/Administrator only). `CashAccount.openingBalance` itself
is write-once provenance of what was entered — never updated afterward, and never a
live balance; the accounting fact is the journal entry posted alongside it.

## 5. Cash Transactions — Outside the Existing Payment Flows

`CashTransaction` is a controlled mechanism for cash movements the existing
Payment/Supplier Payment flows don't cover — a bank charge, a petty cash payment, a
miscellaneous non-invoice receipt. It is explicitly **not** a substitute for either
flow: a customer payment still uses the existing `Payment` workflow, a supplier
payment still uses the existing `SupplierPayment` workflow, invoice creation and
sales fulfilment stay exactly where they already are.

Each transaction carries an explicit `transactionType` (`RECEIPT`/`PAYMENT`) and a
user-chosen `contraAccountId` — a non-system Chart of Accounts entry naming what
the other side of the entry represents (e.g. "Other Income" for a receipt, "Bank
Charges" for a payment) — the same "Path B" policy `SupplierInvoiceItem.
debitAccountId` (Sprint 12) already established: never a default, never guessed.

```
RECEIPT:  DR <cash account's CoA>   amount
          CR <contra account>        amount

PAYMENT:  DR <contra account>       amount
          CR <cash account's CoA>    amount
```

## 6. `Payment`/`SupplierPayment` — Identifying Which Cash Account, Without Breaking Anything

`Payment`/`SupplierPayment` each gained a nullable, **optional** `cashAccountId`.
When supplied, the cash-side posting line targets that account's own dedicated
Chart of Accounts row (`accountId`) instead of the generic `CASH`/`BANK` system
account resolved from `method`. When omitted, posting is byte-for-byte identical to
the pre-Sprint-14 behaviour.

This was a deliberate design choice, not a half-measure: making `cashAccountId`
required would have forced every existing test fixture, every seeded row, and every
caller across five prior sprints to suddenly need to pick a cash account — a far
larger change than "the minimum additive schema change" the brief calls for, and a
real risk to "do not break existing flows." The Payment/Supplier Payment dialogs
show a Cash Account dropdown whenever the organisation has at least one matching
account, but leaving it blank remains valid, and existing Payments recorded before
this sprint (or without a specific account named) simply have `cashAccountId: null`.

## 7. Bank Statement Import (CSV)

MVP scope, explicitly not a bank API integration, Open Banking connection, or
automatic bank feed (§10). A `BankStatementTransaction` captures `transactionDate`,
`valueDate` (optional), `description`, `reference` (optional), `debit`/`credit`,
`amount` (`credit − debit`, computed at write), `balance` (optional — a display-only
copy of whatever the bank itself reported, never used in any reconciliation
calculation), `externalReference` (optional), `importedAt`, and a `matchStatus`.

**Column mapping happens client-side.** The browser parses the CSV (`papaparse`),
detects its columns, and lets the user map each one to a Zentuva field via a plain
`<select>` — not every bank exports the same column names or order. The browser
then POSTs already-mapped, already-normalised JSON rows to
`POST /finance/cash/bank-statements/:cashAccountId/import`; **the backend never
parses CSV** and independently re-validates every row (required fields, valid
dates, numeric amounts, exactly one of debit/credit) — client-side validation is a
UX convenience only, never trusted.

**Duplicate detection** — two independent layers, applied both against
already-imported rows and within the same batch:

1. A deterministic `dedupeHash = sha256(cashAccountId|date|debit|credit|reference|
description)` (normalised: date truncated to the day, reference/description
   trimmed and lower-cased) — enforced via `@@unique([cashAccountId, dedupeHash])`.
2. Where the bank supplies one, a stable `externalReference` — `@@unique([
cashAccountId, externalReference])` (multiple `NULL`s allowed, the same Postgres
   semantics `ChartOfAccount.systemKey` already relies on).

A row matching either layer is **skipped and reported** in the import result
(`importedRows`/`duplicateRows`/`errorRows`), never a hard batch failure.

## 8. Reconciliation

The core feature of this sprint. A `BankReconciliation` session belongs to one
`CashAccount` and one free bank-statement date range (`periodStart`/`periodEnd`) —
deliberately **not** tied to an `AccountingPeriod`: a bank statement cycle is
bank-defined, and this model never itself posts a journal entry, so it has no
"open period" to respect. `openingBankBalance`/`closingBankBalance` are user-entered
facts copied straight from the physical statement — external reality, not derived
from Zentuva's own books, so they can never "drift" from the GL; they're the very
thing the GL is being checked against. Only one `IN_PROGRESS` session per
`CashAccount` is allowed at a time.

### The "book transaction" is a `JournalEntryLine`, not a polymorphic reference

A `ReconciliationMatch` pairs one `BankStatementTransaction` with one
`JournalEntryLine.id` directly — never `Payment`/`SupplierPayment`/
`CashTransaction` polymorphically. Every book-side cash movement (an opening
balance, a Payment, a SupplierPayment, a CashTransaction) ultimately produces
exactly one `JournalEntryLine` against the cash account's own linked Chart of
Accounts row; referencing the GL row directly is the literal embodiment of "the GL
remains the source of truth," and makes "unmatched book transactions" one uniform
query (`JournalEntryLine` on that account, `POSTED`, in-period, with no
`ReconciliationMatch`) rather than a four-way union across source tables. Both
foreign keys on `ReconciliationMatch` are globally unique — a given bank line and a
given book line can only ever correspond to each other once, ever.

### Matching

- **Auto-match** — a single, explicit, user-triggered bulk action. For each
  unmatched bank transaction, it looks for an unmatched `JournalEntryLine` on the
  same account with the same date and an equal, correctly-signed amount; a pair is
  matched only when it is **unambiguous** (exactly one candidate on each side).
  Anything ambiguous is left for manual review. This satisfies "no sophisticated AI
  reconciliation" (brief §10) while still resolving the common case in one click.
  `ReconciliationMatch.confidenceScore` exists as an unused, future-proofing column
  for a possible future suggested-match mode — not used by anything in Sprint 14.
- **Manual match** — the user selects one unmatched bank row and one unmatched book
  row and confirms the pairing explicitly.
- **Match-action idempotency** — no separate idempotency key; `match()` catches the
  unique-constraint violation and, if the existing match is between the exact same
  pair, returns it unchanged rather than erroring (a genuine conflict — either side
  already matched to something _else_ — still throws). `complete()` on an
  already-`COMPLETED` session returns the existing state. `auto-match` is naturally
  re-run-safe (nothing left to match twice).

### Completion — a hard, deterministic rule

`complete()` is only permitted when there are **zero** unmatched
`BankStatementTransaction`s and **zero** unmatched `JournalEntryLine`s within the
session's period — computed live, the same queries the Unmatched panels themselves
use. A `ReconciliationIncompleteError` (carrying both counts) is thrown otherwise.
This is deliberately not softened into "complete with acknowledged outstanding
items" — the Difference/Unmatched panels stay visible regardless of completion
state, so the user always sees _why_ things differ, without the system ever
force-matching or silently adjusting anything to make the numbers agree.

Even once every individual transaction is matched, the reconciliation's own
Difference figure (Book Balance − the session's entered `closingBankBalance`) can
still be non-zero — e.g. if the statement balance was recorded before a later row
was imported into the same period. This is surfaced, not hidden or auto-corrected;
live verification against this sprint's own seed data produced exactly this result
and it was left visible, the same "a genuine finding, not a defect" posture Sprint
13's Inventory Reconciliation report already established.

Once `COMPLETED`, a session is immutable: `match`/`unmatch` are rejected. Reopening
a completed session is explicit deferred work (§10) — corrections happen by posting
a new correcting `CashTransaction`/journal entry and handling it in a **new**
session, the same "never rewrite history" convention `Payment.void()`/
`SupplierPayment.void()` already establish. `unmatch()` remains available while a
session is still `IN_PROGRESS`, for undoing a mistaken match mid-session.

## 9. Book Balance vs. Reconciled Balance vs. Unreconciled Difference

The central UX distinction this sprint exists to make obvious — never labelling an
unreconciled accounting balance "available cash":

| Term                        | What it means                                   | How it's computed                                                                                                                                                                   |
| --------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Book Balance**            | What Zentuva's accounting says right now        | Live, via `LedgerService.getAccountActivity(cashAccount.linkedChartOfAccountId)` — the exact same primitive Sprint 7/13 already use for every other account                         |
| **Bank Statement Balance**  | What the bank statement says for a given period | The `closingBankBalance` entered when that reconciliation session was created                                                                                                       |
| **Reconciled Balance**      | What has been verified/matched                  | The most recent `COMPLETED` session's own `closingBankBalance` (or the account's `openingBalance` if none has ever completed), always shown with an explicit "as of `<date>`" label |
| **Unreconciled Difference** | What still needs attention                      | Book Balance − Reconciled Balance                                                                                                                                                   |

Nothing in this table is ever stored independently — every figure is either a live
query or a plain read of a `BankReconciliation`'s own already-stored, user-entered
fact.

## 10. Known Limitations / Non-Goals

- **No field-level encryption for `accountNumber`** — a documented hardening gap,
  not a claimed security guarantee.
- **No reopening a completed reconciliation.**
- **No bank API integration, Open Banking, or automatic bank feed** — CSV import
  and manual entry only.
- **No loan management, debt management, investment management, capital planning,
  cashflow forecasting, or AI financial recommendations** — this sprint is
  deliberately only the foundation those would build on: a future `DR Bank / CR
Loan Liability`-style entry can reuse the exact same `CashAccount`/Chart-of-
  Accounts-link and `accountId`-based posting mechanism this sprint introduces,
  without further schema change.
- **No payroll, expense management module, or budgeting.**
- **No multi-currency treasury engine** — `CashAccount.currency` is a plain string
  per account, not a converting engine.
- **No complex bank-matching AI** — one deterministic bulk auto-match plus fully
  manual matching only.
- **No configurable module-level permission engine** — RBAC remains binary
  (Owner/Administrator-write, Member-read), the same deferred decision as every
  other domain in this codebase.

## 11. Future Extension Points

The architecture was shaped so these can be added without rebuilding this
foundation:

- **Loan/Investment management** — a new domain that reuses `CashAccount`'s own
  Chart-of-Accounts link and the `accountId`-based `postSystemJournalEntry`
  extension already in place; no new posting mechanism would be needed.
- **Cashflow forecasting** — would read from the same `CashAccount`/
  `JournalEntryLine` data this sprint already exposes, plus (likely) a new
  time-series endpoint alongside the existing `LedgerService` primitives.
- **A suggested-match / confidence-scored reconciliation mode** — the
  `ReconciliationMatch.confidenceScore` column already exists, unused, for exactly
  this.
- **Reopening a completed reconciliation** — `BankReconciliationStatus` has room to
  add a controlled reopen transition later without a migration.
- **CSV export of reconciliation results** — a cheap follow-up on top of the
  existing `GET /finance/cash/reconciliations/:id` detail response.
