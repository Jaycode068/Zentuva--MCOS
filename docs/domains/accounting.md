# Accounting Domain

- **Status:** Foundation implemented — Sprint 7 ("General Ledger & Accounting
  Foundation"). **Not** a complete accounting system — see §9.
- **Sprint:** 7
- **Depends on:** [Identity](identity.md) (tenant boundary, `RolesGuard`,
  `AuditService`), [Finance](finance.md) (the three business events this domain posts
  journals for — invoice issued, payment recorded, credit note issued).
- **Explicitly does not depend on:** [Sales](sales.md), [Inventory](inventory.md),
  [Distribution](distribution.md), [Procurement](procurement.md),
  [Production](production.md) — this sprint only wires Finance's own three events; every
  other domain's accounting consequence is deferred future work — see §9.
- **See also:** [Sprint 7 Completion Report](../sprint-7-completion-report.md).

## 1. Business Purpose

Sprint 6 gave Finance a record-entry layer — Invoices, Payments, Credit Notes,
Accounts Receivable — with no accounting behind it. This sprint adds that layer: a
tenant-defined Chart of Accounts, Accounting Periods, double-entry Journal Entries, and
a General Ledger/Trial Balance/Account Activity reporting surface, then wires Finance's
three financial events to post journal entries automatically.

```
Business Transaction
        ↓
Business Event  (invoice.issued / payment.recorded / credit-note.issued)
        ↓
Accounting Posting  (journal-posting.ts — resolves system accounts + open period)
        ↓
Journal Entry  (double-entry, POSTED, immutable)
        ↓
General Ledger  (running balances, Trial Balance, Account Activity)
```

This is the accounting **engine**, not accounting **software**. No General Ledger
closing automation, no financial statements, no Accounts Payable, no tax engine — see
§9.

## 2. `FinanceModule` Owns This Code; the Posting Boundary Is Framework-Free

Unlike every prior domain, Accounting is not a separate NestJS module — its
controllers/services/repositories live under `apps/api/src/finance/accounting/` and
are registered directly on the _existing_ `FinanceModule` (which already bundles
several sub-concepts as one module, not one-module-per-concept). HTTP routes stay
under `/api/finance/*`, matching the `/settings/finance` frontend nav Sprint 6 already
established.

The one deliberately different piece is **`accounting/journal-posting.ts`** — plain,
dependency-injection-free functions (`resolveSystemAccountId`, `resolveOpenPeriodId`,
`postSystemJournalEntry`) that take a Prisma `Prisma.TransactionClient` as their first
argument. `InvoiceRepository.issue()`, `PaymentRepository.create()`, and
`CreditNoteRepository.issue()` each call these functions from **inside their own
existing `$transaction` block** — a NestJS-injected service would open its own separate
transaction via its own `PrismaService`, breaking atomicity with the caller's write.
This mirrors the existing `deriveInvoiceStatusAfterApplication`/
`deriveInvoiceStatusAfterReversal` pattern (plain functions shared across repository
files, no DI needed), and it means **future domains (Procurement, Production,
Inventory) can import these same functions directly, without ever depending on
`FinanceModule`** — this is the "reusable accounting posting logic" the boundary exists
to provide.

## 3. Key Concepts / Entities

### ChartOfAccount

- **Fields:** `code` (tenant-defined, e.g. `"1210"` — unique _per organisation_, unlike
  `Invoice.invoiceCode`, which is global), `name`, `type`
  (`ASSET`/`LIABILITY`/`EQUITY`/`REVENUE`/`COST_OF_SALES`/`EXPENSE`), `parentId`
  (self-referential, arbitrary depth — mirrors `Territory`'s own hierarchy exactly,
  including the same cycle-prevention walk), `description`, `isActive`,
  `isSystemAccount`, `systemKey`.
- **Named `ChartOfAccount`, not `Account`.** `Account` would collide with the
  pre-existing, unrelated self-service `AccountModule`/`AccountController`
  (`apps/api/src/identity/account/`, the "My Account" profile/password/sessions
  surface).
- **System accounts.** `systemKey` (one of `SYSTEM_ACCOUNT_KEYS` —
  `AR`/`SALES_REVENUE`/`SALES_RETURNS`/`CASH`/`BANK`/`INVENTORY`/`COGS`/`AP`) lets
  `journal-posting.ts` resolve "the AR account for this organisation" without ever
  hardcoding an id — every tenant can use whatever codes/names it likes as long as
  exactly one account per key is marked as that system account
  (`@@unique([organisationId, systemKey])`, with Postgres's multi-`NULL` semantics
  letting every non-system account coexist under a `NULL` key). A system account can
  **never be deactivated** via the API — a blunt, unconditional rule, not a dynamic
  "would this break anything" check.
- Sprint 7 seeds eight system accounts but only **posts** to five of them (`AR`,
  `SALES_REVENUE`, `SALES_RETURNS`, `CASH`, `BANK`) — `INVENTORY`/`COGS`/`AP` are
  reserved for the documented future integrations in §9.

### AccountingPeriod

- A named date range (`startDate`/`endDate`, both inclusive, day-granularity — same
  convention as `Invoice.invoiceDate`) a `JournalEntry` must belong to. `status`:
  `OPEN`/`CLOSED`. Closing is **one-way this sprint** — no re-opening, no year-end
  closing automation.
- **Only `OPEN` periods may receive `POSTED` journal entries** — enforced at `post()`
  time, re-checked atomically (a period can be closed between a draft's creation and
  its posting). A `DRAFT` entry may still be _created_ against a period that is
  already `CLOSED` (or has no covering period... actually requires _some_ period to
  exist) — only the act of posting requires the period to be genuinely open at that
  moment.
- **Overlap prevention is a service-level guard**, not a database constraint — no
  precedent for Postgres range-exclusion constraints anywhere in this schema, and every
  other business-rule guard in this codebase (duplicate invoice, over-payment, ...) is
  a service/repository-level check.

### JournalEntry / JournalEntryLine

- **Fields:** `journalNumber` (auto-generated `JE-000001`, ..., unique **per
  organisation** — unlike `Invoice.invoiceCode`'s global uniqueness, since a tenant's
  own Chart of Accounts is already org-scoped), `date`, `accountingPeriodId` (always
  server-resolved from `date` — there is no independent client-supplied period
  selection, so a journal can never disagree with its own date about which period it
  belongs to), `description`, `reference`, `sourceType`/`sourceId`, `status`
  (`DRAFT`/`POSTED`/`VOID`).
- **`sourceType` is a plain string, not an enum or a Prisma relation** — `"MANUAL"` |
  `"INVOICE"` | `"PAYMENT"` | `"CREDIT_NOTE"` today, with more values arriving as
  future integrations land, without a schema change. This table must never depend on
  every future domain.
- **Double-entry rule, server-authoritative always:** every `JournalEntryLine` has
  exactly one of `debit`/`credit` greater than zero, the other exactly `0`; every
  entry has at least two lines; `Σdebit === Σcredit`. Checked in
  `packages/validation/src/accounting.ts`'s Zod refines (UX-only) and re-validated
  independently in `JournalEntryService`/`journal-posting.ts` (the actual source of
  truth) — never trusted from the client alone.
- **Two lifecycles.** A **manually-created** entry passes through `DRAFT` (created via
  `POST /journal-entries`, already balance-validated — an unbalanced draft is never
  persisted) before a separate `POST /journal-entries/:id/post` action re-validates
  balance and period-open-ness and flips it to `POSTED`. A **system-generated** entry
  (invoice/payment/credit-note) is created directly as `POSTED` — there is no human
  reviewing it first; it's the direct consequence of an already-committed business
  event.
- **Duplicate-posting prevention:** `@@unique([organisationId, sourceType, sourceId])`.
  A retried `invoice.issued`-style event can never produce a second journal for the
  same source — independent of, and in addition to, `Payment`/`CreditNote`'s own
  `idempotencyKey` short-circuiting. `NULL sourceId` (every `MANUAL` entry) never
  collides with another `NULL`, by the same Postgres multi-`NULL` unique-index
  semantics `ChartOfAccount.systemKey` relies on.

## 4. Immutability & Correction

Once `POSTED`, a `JournalEntry`'s lines/account/amount/date/description are **never
mutated by any endpoint** — there is no edit route at all for a posted entry.

`VOID` (available from either `DRAFT` or `POSTED`) is a **bare status flip** — it
excludes the entry from every Ledger/Trial-Balance/running-balance query going
forward, but it **never generates an automatic reversing entry**. A true correction is
a new manual journal the user enters themselves. This satisfies the brief's explicit
"do not build full reversal functionality unless simple and architecturally
necessary" — automatic reversal generation is neither.

`Payment.void()`/`CreditNote.void()` (Sprint 6) do not post a reversing journal this
sprint either — voiding a payment/credit note is already a Sprint-6-level reversal of
the _financial_ record; the _accounting_ reversal is documented deferred work, not
silently half-built.

## 5. Money Precision

`Float` throughout, with a per-file `roundCurrency(v) => Math.round(v*100)/100`
helper — the exact same convention as `Invoice`/`Payment`/`CreditNote` (and every
other monetary value in this codebase). This codebase has never used Prisma `Decimal`
anywhere; Journal Entry amounts stay consistent with the amounts they're posted from.

## 6. General Ledger / Trial Balance / Account Activity

Entirely read-only, auth-only (Member has full read access, same convention as
`AccountsReceivableController`).

- **General Ledger** (`GET /finance/ledger`) — every posted line, filterable by
  account/date-range/period/source-type/reference/status, ordered by (`date`, then
  `journalNumber`). Running balance is computed **in application code from the
  ordered result — never a SQL window function** — and is most meaningful once
  filtered to a single `accountId` (an unfiltered, mixed-account view still computes
  a cumulative net, but it mixes unrelated accounts together).
- **Trial Balance** (`GET /finance/trial-balance`) — one row per account:
  `netBalance = totalDebit − totalCredit`, split by sign into a classic two-column
  presentation (positive → Debit column, negative → Credit column). Since the whole
  ledger balances (`Σ netBalance === 0` across every account, by double-entry
  construction), splitting each account's net by sign and summing both columns always
  produces two equal totals — no per-account-type sign logic is needed anywhere.
- **Account Activity** (`GET /finance/accounts/:id/activity`) — a true Opening Balance
  (sum of everything posted before the range starts), the transactions within the
  range (with running balance continuing from the opening figure), and a Closing
  Balance.

All three queries only ever consider `POSTED` lines for balance computation — `DRAFT`/
`VOID` entries can still be _inspected_ via the raw `GET /finance/ledger` listing (its
own `status` filter exists for that), but they never contribute to a balance.

## 7. RBAC / Tenant Isolation / Audit

Identical to every other domain — `RolesGuard`, Owner/Administrator write, Member
read-only (server-enforced only; the frontend does not hide write actions from
Member), tenant-scoped repository methods, cross-tenant direct-by-id access returns
404, cross-tenant writes return 403. Audit actions: `account.created`,
`account.updated`, `account.activated`, `account.deactivated`,
`accounting-period.created`, `accounting-period.closed`, `journal-entry.created`,
`journal-entry.posted`, `journal-entry.voided`. A system-generated posting does **not**
independently audit-log itself as a separate "journal-entry.posted" event — the
originating action (`invoice.issued`, `payment.recorded`, `credit-note.issued`, all
Sprint 6 audit actions) is the auditable event; the journal it produced is visible by
following `sourceType`/`sourceId`, not double-logged as its own thing.

## 8. Admin Surface (`apps/web/src/app/(app)/settings/finance/`)

Five new tabs added to the existing `FinanceTabs` (now ten total; the tab bar scrolls
horizontally at narrow widths rather than wrapping): **Chart of Accounts** (a
parent/child tree, indented by depth, System badges, type/active filters, Create/Edit,
Activate/Deactivate disabled for system accounts), **Journal Entries** (a create form
with dynamic line rows and live Total Debit/Total Credit/Difference, chaining
create-then-post as one user action — mirroring Sprint 6's `CreditNoteDialog`
create-then-issue precedent exactly — plus a detail view with Void), **General
Ledger** (account/date/source filters, running balance column), **Trial Balance**
(period selector, a visible "Debit and Credit totals match" confirmation), and
**Accounting Periods** (list, Open/Close).

## 9. Deferred Accounting Work — Future Integrations

This sprint wires exactly three Finance events. The intended future architecture for
every other domain, per the brief's own diagram, reproduced here as documentation —
**none of it is implemented yet**:

```
Goods Receipt            Material Issue            Sales Fulfilment
     ↓                        ↓                          ↓
Inventory increases     Raw material consumed    Finished goods leave inventory
     ↓                        ↓                          ↓
DR Inventory             DR WIP / Production Cost   DR Cost of Goods Sold
CR Accounts Payable/GRNI CR Raw Material Inventory  CR Finished Goods Inventory
```

Also explicitly out of scope this sprint: Chart of Accounts → financial-statement
closing (Trial Balance → P&L/Balance Sheet), Cash Flow Statement, Accounts Payable /
supplier invoices, a multi-jurisdiction tax engine, payroll accounting, fixed-asset
accounting and depreciation, budgeting, multi-currency accounting, consolidated
accounting, manufacturing variance accounting, inventory valuation accounting, COGS
automation for any inventory movement, year-end closing, and retained-earnings closing
automation. The `INVENTORY`/`COGS`/`AP` system account keys are already seeded and
waiting for exactly these future integrations to reference.

## 10. API Reference

| Endpoint                                                   | Auth                | Notes                                                                      |
| ---------------------------------------------------------- | ------------------- | -------------------------------------------------------------------------- |
| `GET /api/finance/accounts`                                | Any authenticated   | `?type=&isActive=&search=`                                                 |
| `GET /api/finance/accounts/:id`                            | Any authenticated   |                                                                            |
| `POST /api/finance/accounts`                               | Owner/Administrator |                                                                            |
| `PATCH /api/finance/accounts/:id`                          | Owner/Administrator | `code`/`type`/`systemKey` immutable                                        |
| `POST /api/finance/accounts/:id/activate` \| `/deactivate` | Owner/Administrator | system accounts reject deactivate                                          |
| `GET /api/finance/accounts/:id/activity`                   | Any authenticated   | `?from=&to=`                                                               |
| `GET /api/finance/accounting-periods`                      | Any authenticated   |                                                                            |
| `POST /api/finance/accounting-periods`                     | Owner/Administrator | overlap-checked                                                            |
| `POST /api/finance/accounting-periods/:id/close`           | Owner/Administrator | only from `OPEN`                                                           |
| `GET /api/finance/journal-entries`                         | Any authenticated   | `?status=&sourceType=&accountingPeriodId=`                                 |
| `GET /api/finance/journal-entries/:id`                     | Any authenticated   |                                                                            |
| `POST /api/finance/journal-entries`                        | Owner/Administrator | creates `DRAFT`, balance-validated                                         |
| `POST /api/finance/journal-entries/:id/post`               | Owner/Administrator | atomic; period-open re-check                                               |
| `POST /api/finance/journal-entries/:id/void`               | Owner/Administrator | bare status flip                                                           |
| `GET /api/finance/ledger`                                  | Any authenticated   | `?accountId=&from=&to=&accountingPeriodId=&sourceType=&reference=&status=` |
| `GET /api/finance/trial-balance`                           | Any authenticated   | `?from=&to=` or `?accountingPeriodId=`                                     |

## 11. Known Limitations

- No re-opening a closed accounting period, and no year-end closing automation.
- `VOID` never generates an automatic reversing entry — a correction is a new manual
  journal.
- Running balance in an unfiltered (multi-account) `GET /finance/ledger` view is a
  cumulative net across unrelated accounts — most meaningful once filtered to one
  account; see §6.
- Trial Balance has no financial-statement layer on top of it (no P&L, no Balance
  Sheet) — see §9.
- No General Ledger integration for Procurement, Production, Inventory, Sales
  Fulfilment, or Distribution yet — only Finance's own three events post automatically.
- No full module-level permission engine — RBAC remains binary
  (Owner/Administrator-write, Member-read), same deferred decision as every other
  domain in this codebase.
