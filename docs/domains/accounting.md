# Accounting Domain

- **Status:** Foundation implemented — Sprint 7 ("General Ledger & Accounting
  Foundation"), extended Sprint 8 ("Procurement, Inventory & Accounting Integration")
  with automatic posting for Goods Receipts, extended Sprint 9 ("Manufacturing
  Accounting Integration") with automatic posting for Material Issue and Production
  Completion, extended Sprint 10 ("Sales Fulfilment & COGS Accounting Integration")
  with automatic posting for Sales Fulfilment. **Not** a complete accounting system —
  see §9.4/§10.6/§11.9.
- **Sprint:** 7, 8, 9, 10
- **Depends on:** [Identity](identity.md) (tenant boundary, `RolesGuard`,
  `AuditService`), [Finance](finance.md) (invoice issued, payment recorded, credit note
  issued), [Inventory](inventory.md) (goods receipt — Sprint 8; costing engine — Sprint
  9), [Production](production.md) (material issue, production completion — Sprint 9),
  [Sales](sales.md) (fulfilment — Sprint 10).
- **Explicitly does not depend on:** [Distribution](distribution.md),
  [Procurement](procurement.md) — Inventory's Goods Receipt, Production's Material
  Issue/Completion, and Sales's Fulfilment are the only operational-domain events wired
  so far; Distribution deliberately never posts (§11.7); every other domain's
  accounting consequence remains deferred future work — see §9.4/§10.6/§11.9.
- **See also:** [Sprint 7 Completion Report](../sprint-7-completion-report.md),
  [Sprint 8 Completion Report](../sprint-8-completion-report.md),
  [Sprint 9 Completion Report](../sprint-9-completion-report.md),
  [Sprint 10 Completion Report](../sprint-10-completion-report.md).

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
  `AR`/`SALES_REVENUE`/`SALES_RETURNS`/`CASH`/`BANK`/`INVENTORY`/`COGS`/`AP`/
  `GRNI_PENDING_APPROVAL`) lets `journal-posting.ts` resolve "the AR account for this
  organisation" without ever hardcoding an id — every tenant can use whatever
  codes/names it likes as long as exactly one account per key is marked as that system
  account (`@@unique([organisationId, systemKey])`, with Postgres's multi-`NULL`
  semantics letting every non-system account coexist under a `NULL` key). A system
  account can **never be deactivated** via the API — a blunt, unconditional rule, not a
  dynamic "would this break anything" check.
- Sprint 7 seeded eight system accounts but only posted to five (`AR`,
  `SALES_REVENUE`, `SALES_RETURNS`, `CASH`, `BANK`). Sprint 8 adds a ninth
  (`GRNI_PENDING_APPROVAL`) and starts posting to two more — `INVENTORY` and `AP` — see
  §9.1. `COGS` remains unposted, reserved for a future Production integration.

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
independently audit-log itself as a separate "journal-entry.posted" event under
Accounting's own action list — the originating action (`invoice.issued`,
`payment.recorded`, `credit-note.issued`) is the auditable event; the journal it
produced is visible by following `sourceType`/`sourceId`. **Exception, Sprint 8:**
Inventory's own audit vocabulary (`INVENTORY_AUDIT_ACTIONS`, not this domain's) is
already more granular than Finance's (it fires both `goods-receipt.received` and
`inventory.increased` per receipt) — consistent with that existing granularity, a
`goods-receipt.journal-entry-posted` event fires there (not here) when a receipt
actually posts a journal — see [Inventory](inventory.md) §8.

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

## 9. Goods Receipt Posting (Sprint 8) and Remaining Deferred Work

### 9.1 Goods Receipt → Inventory / Accounts Payable

When `InventoryService.receiveGoods()` records a delivery, `GoodsReceiptRepository.
receive()` posts a Journal Entry inside the **same** `$transaction` that creates the
`GoodsReceipt`, increments `InventoryStock`, and appends `InventoryTransaction` rows —
either the entire business event succeeds together, or it all rolls back together
(a closed accounting period, for instance, rolls back the whole receipt, not just the
posting — see [Inventory](inventory.md) §11 and §3 "Receiving Rules").

- `sourceType: 'GOODS_RECEIPT'`, `sourceId` = the `GoodsReceipt.id`, `reference` = its
  `goodsReceiptNumber`, `description` names both the receipt and its Purchase Order.
- Rejected quantity never contributes to any posted value — an all-rejected receipt
  posts no journal at all, not even a zero-amount one (mirrors the existing
  `INVENTORY_INCREASED` audit event's own gating).
- Valuation uses `PurchaseOrderItem.unitPrice` — the PO's own frozen price — since no
  separate inventory-valuation policy (FIFO/weighted-average) exists in this codebase;
  see [Inventory](inventory.md) §11 "No valuation."

### 9.2 Accepted vs. Payable — why the credit side sometimes splits into two accounts

Physically accepting goods into inventory does **not** by itself create a supplier
liability for more than the Purchase Order's own ordered quantity commercially covers.
A supplier may intentionally (or by error) deliver more than was ordered; the receiving
team may accept it as physically usable stock without that implying the organisation
owes payment for the excess. Sprint 8 therefore tracks a **fifth** quantity per
`GoodsReceiptItem` — `payableQuantity`, alongside `deliveredQuantity`/
`rejectedQuantity`/`acceptedQuantity` — computed server-side as:

```
payableQuantity = min(acceptedQuantity, remainingOrderedQuantity)
remainingOrderedQuantity = max(0, PurchaseOrderItem.quantity − Σ payableQuantity already
                                   recorded across every prior receipt against that item)
```

The Journal Entry's credit side is built from this split, not from `acceptedQuantity`
directly:

```
DR Inventory                  = Σ acceptedQuantity × unitPrice           (always)
CR Accounts Payable           = Σ payableQuantity  × unitPrice           (only if > 0)
CR GRNI — Pending Approval    = Σ (acceptedQuantity − payableQuantity) × unitPrice
                                                                          (only if > 0)
```

Worked example (the exact scenario this design was built for): PO for 1,000 units at
₦1,000/unit; a receipt delivers 1,100, rejects 50, accepts 1,050.
`payableQuantity` caps at the PO's own 1,000 — the journal posts `DR Inventory
₦1,050,000` / `CR Accounts Payable ₦1,000,000` / `CR GRNI — Pending Approval
₦50,000`, never `CR Accounts Payable ₦1,050,000`. The excess 50 units are real,
traceable inventory value with no confirmed supplier debt behind them yet.

`GRNI_PENDING_APPROVAL` ("Goods Received – Pending Approval," seeded as Chart of
Accounts code `2110` under Liabilities) is this excess bucket. It is **not** a general
substitute for `AP` — every payable-capped portion still posts to `AP` exactly as
before; only value beyond the commercial agreement lands here. This sprint does not
build any workflow to move value out of `GRNI_PENDING_APPROVAL` — that is deliberately
deferred (§9.4): a future approval/three-way-match step would reclassify approved
excess into `AP` via an ordinary journal entry, with the data model (per-item
`payableQuantity`, the distinct account) already in place to support it.

### 9.3 AP vs. GRNI — the decision, made explicit

The brief that drove this sprint asked whether goods-receipt liabilities should post to
`AP` or a separate `GRNI` (Goods Received Not Invoiced) account. This codebase's answer:
**both concepts exist, but split along the accepted/payable line, not along
invoiced/not-invoiced.** `AP` carries the commercially-agreed, PO-capped liability
(which, in the absence of a supplier-invoice-matching module, _is_ today's best proxy
for "confirmed payable," invoiced or not). `GRNI_PENDING_APPROVAL` carries only the
excess a human hasn't yet confirmed the organisation will pay for. A full three-way
match (PO ↔ Goods Received ↔ Supplier Invoice ↔ Approved payable) remains future work —
see §9.4.

### 9.4 Remaining Deferred Work (as of Sprint 8)

Superseded in part by Sprint 9 — see §10 below for what Production now posts. What
remained after Sprint 8, resolved or still open:

Also explicitly out of scope (still true after Sprint 9 — see §10.6): Chart of
Accounts → financial-statement closing (Trial Balance → P&L/Balance Sheet), Cash Flow
Statement, a full Accounts Payable module (supplier invoice matching, payment runs, AP
ageing, vendor statements, supplier credit management), an approval workflow for
`GRNI_PENDING_APPROVAL` excess, a multi-jurisdiction tax engine, payroll accounting,
fixed-asset accounting and depreciation, budgeting, multi-currency accounting,
consolidated accounting, year-end closing, and retained-earnings closing automation.

## 10. Production Accounting (Sprint 9)

Sprint 9 extends the same posting boundary one stage further into manufacturing:
`Raw Materials → Material Issue → Work In Progress → Production → Finished Goods →
Inventory → General Ledger`. See [Production](production.md) §11 for the
Production-domain-facing summary and the
[Sprint 9 Completion Report](../sprint-9-completion-report.md) for full detail.

### 10.1 New system accounts

Three additions to `SYSTEM_ACCOUNT_KEYS`:

| Key                        | Chart of Accounts code         | Type    | Purpose                                                                                                                     |
| -------------------------- | ------------------------------ | ------- | --------------------------------------------------------------------------------------------------------------------------- |
| `WIP`                      | `1340 Work In Progress`        | Asset   | Value of raw material issued to production but not yet completed                                                            |
| `FINISHED_GOODS_INVENTORY` | `1330 Finished Goods`          | Asset   | Elevates the pre-existing Sprint 7-seeded account (never previously a system account) — value of accepted production output |
| `PRODUCTION_LOSS`          | `6600 Production Loss / Scrap` | Expense | The rejected portion's share of consumed material cost                                                                      |

`INVENTORY` (`1300`) keeps its exact Sprint 7/8 meaning — raw material/packaging/
consumable value — unchanged, used as Material Issue's credit side.

### 10.2 Costing basis

Material Issue needs a raw material's _current_ unit cost, which nothing in this
codebase persisted before Sprint 9. `InventoryStock.averageUnitCost` — a moving
weighted average per `(organisation, product, location)` — is the new, minimal,
durable mechanism this required; see [Inventory](inventory.md) §11b for the full
writer/reader breakdown and formula. This is a genuinely new costing engine, not a
second one: on a first-ever receipt into empty stock it degenerates to exactly the
`unitPrice` Sprint 8 already used for its one-time Goods Receipt journal snapshot.

### 10.3 Material Issue posting

One Journal Entry per `ProductionMaterialIssue` (not per Production Order — three
partial issues post three independent, source-linked entries, `sourceType:
'PRODUCTION_MATERIAL_ISSUE'`):

```
DR Work In Progress   = Σ quantity × averageUnitCost (at the moment of consumption)
CR Raw Material Inventory = same total
```

Posted from inside the same `$transaction` that decrements `InventoryStock` — a closed
accounting period or a missing `WIP`/`INVENTORY` system account rolls back the entire
issue, quantity movement included. Skipped (no journal, not a zero-value one) only when
every issued component has a `0` cost — stock built entirely from un-costed
Adjustments, a real but rare edge case, not silently misrepresented as a real
transaction.

### 10.4 Production Completion posting — the accepted/rejected split

One Journal Entry per `ProductionRun`, `sourceType: 'PRODUCTION_RUN'`:

```
CR Work In Progress        = totalWipValue (the order's full cumulative posted WIP
                              value — summed directly from every Material Issue
                              journal's own WIP debit line against this order, never a
                              separately-stored running total)
DR Finished Goods Inventory = totalWipValue × acceptedQuantity / producedQuantity
                              (only if > 0)
DR Production Loss / Scrap  = totalWipValue − acceptedValue (by subtraction, so the
                              two always sum to exactly totalWipValue — no
                              rounding-drift gap; only if > 0)
```

Worked example (Boby Bites, live-verified): a live Material Issue posts
`DR WIP ₦17,040 / CR Inventory ₦17,040`; completing with 40 produced / 5 rejected / 35
accepted posts `CR WIP ₦17,040` / `DR Finished Goods ₦14,910` (17,040 × 35/40) /
`DR Production Loss ₦2,130` (17,040 × 5/40) — the two debit lines sum to exactly the
credited ₦17,040.

**Documented assumption:** the split is proportional by produced quantity — the
standard treatment for a single homogeneous production run with uniform inputs
(equivalent-unit/process costing). It does not model a rejection that occurred early
in the process and consumed less material than a completed unit; this system has no
data to distinguish that case. Rejected output's cost is preserved in the ledger, never
silently dropped — but it never enters sellable `InventoryStock` (only
`acceptedQuantity` is ever added to finished-goods stock, never `producedQuantity`).

Skipped entirely when the order's total WIP value is `0` (nothing was ever issued with
a known cost).

### 10.5 Idempotency — and a bug this sprint's live verification found and fixed

`ProductionMaterialIssue` gained `idempotencyKey` + `@@unique([productionOrderId,
idempotencyKey])` (Sprint 8's `GoodsReceipt` shape exactly). `ProductionRun` gained a
plain `idempotencyKey` column — no new composite unique needed, since
`productionOrderId` is already `@@unique`, so a genuine retry is detected by comparing
the existing run's own stored key.

Both repositories' own `$transaction`s check-then-return on a matching key correctly.
Live verification found that this alone was **not sufficient**: `ProductionOrderService`
runs its own business-rule pre-checks (over-issue validation for Material Issue, an
`IN_PROGRESS`-only guard for Completion) _before_ ever calling the repository — and a
genuine retry arrives after the original call's own effects (its own issued quantity
now counted toward the requirement; the order already flipped to `COMPLETED`), so those
pre-checks rejected the very retry that should have idempotently succeeded, with a
`400` instead of the original result. No duplicate data was ever created (the
repository-level guard held), but the retry didn't behave idempotently. Fixed by moving
the idempotency lookup to the front of both service methods — before any business-rule
check — via a new `findByIdempotencyKey` method on each repository. See the
[Sprint 9 Completion Report](../sprint-9-completion-report.md) "Bugs Found and Fixed."

### 10.6 Deferred at the time (Sprint 9) — resolved in part by Sprint 11

Direct labour costing, machine-hour costing, electricity/overhead allocation,
depreciation allocation, standard costing, and variance accounting were, and remain,
explicitly out of scope. COGS posting at Sales Fulfilment — deferred as of Sprint 9 —
is Sprint 10's own subject, see §11 below. Every item listed in §9.4 above
(financial-statement closing, a full AP module, multi-currency, payroll, etc.) remains
equally out of scope.

## 11. Sales Fulfilment Accounting (Sprint 10)

The last major gap in the operational→accounting chain Sprints 7–9 built: Sales
Fulfilment — the event that physically deducts finished-goods inventory when a
customer order is supplied — now posts `DR Cost of Goods Sold / CR Finished Goods
Inventory`. Full detail (worked examples, every decision and its rationale) lives in
[Sales](sales.md) §4b and the
[Sprint 10 Completion Report](../sprint-10-completion-report.md); this section is the
Accounting-domain-facing summary.

### 11.1 Why this is two separate events, not one

`SalesOrder` creation/confirmation, `Invoice` issuance, and `SalesFulfilment` are three
different business moments and stay three different accounting outcomes:

```
Sales Order (demand)        → no accounting at all
Invoice (financial claim)   → DR Accounts Receivable / CR Sales Revenue   (Sprint 6/7, unchanged)
Sales Fulfilment (physical) → DR Cost of Goods Sold / CR Finished Goods Inventory  (Sprint 10, new)
```

Revenue is recognised through the Invoice/Finance flow; inventory cost is recognised
through the physical Fulfilment flow. Neither event impersonates the other, and
neither is required before the other — `InvoiceService.create()` already requires
`SalesOrder.status === FULFILLED` (Sprint 6), so in practice Fulfilment happens first
and Invoicing second, but nothing in the COGS posting itself depends on an invoice
existing.

### 11.2 Costing basis — no new engine

`SalesFulfilmentRepository.create()` reads `InventoryStock.averageUnitCost` (Sprint 9's
moving weighted average — see [Inventory](inventory.md) §11b) inside the same
transaction that decrements stock, for each item, at the moment of consumption — the
identical read Production's Material Issue already performs. No second costing engine
was introduced; this is deliberate reuse.

### 11.3 Posting rule — one journal per fulfilment batch

```
DR Cost of Goods Sold        = Σ (quantity × averageUnitCost) across every item in the batch
CR Finished Goods Inventory  = same total
```

`sourceType: 'SALES_FULFILMENT'`, `sourceId` = the `SalesFulfilment.id`. Each partial
fulfilment is its own independent Journal Entry, posted the moment it happens — never
batched until the order is fully fulfilled. A multi-SKU fulfilment aggregates every
line into one two-line journal (not one line per SKU — `JournalEntryLine` carries no
`productId`/`quantity`); per-SKU traceability instead comes from two new columns on
`SalesFulfilmentItem` (`unitCost`, `costAmount`), snapshotted at fulfilment time so a
later read is never distorted by the average subsequently moving.

Worked example (live-verified, Boby Bites): a multi-SKU order (300 packs Plantain
Chips Classic Salted 500g @ ₦426 average cost, 100 packs Sweet & Spicy 30g @ ₦0 —
never produced with a known cost) fulfilled in two batches (200+60, then 100+40) posts
two independent journals — `DR COGS ₦85,200 / CR Finished Goods Inventory ₦85,200`
then `DR COGS ₦42,600 / CR Finished Goods Inventory ₦42,600` — summing to exactly
`300 × ₦426 = ₦127,800`, with the zero-cost SKU contributing `₦0` on both without
blocking either posting.

### 11.4 Zero/missing cost — matches Production's precedent exactly

If every item in a batch has a `0` average cost, the Journal Entry is skipped entirely
(never posted as a zero-value entry) — but the inventory deduction, the
`InventoryTransaction`, and the `SalesFulfilment` record all still happen
unconditionally. This is a **deliberate choice to match Production Material Issue's
existing behaviour** rather than diverge into a stricter "block the fulfilment" rule:
blocking a physical, already-approved shipment over a bookkeeping gap would be a worse
outcome than the trade-off Production already accepted for the structurally identical
situation (stock built from un-costed Adjustments). A `0`-cost fulfilment produces no
COGS entry rather than a wrong one.

### 11.5 Idempotency — the Sprint 9 lesson applied proactively

Sprint 9 found, live, that service-layer business-rule pre-checks running before a
repository's own idempotency check-then-return could reject a legitimate retry with a
`400` instead of returning the original result. Sprint 10 applied that fix
**proactively, before shipping** rather than discovering the same bug again:
`SalesFulfilmentService.fulfil()` calls a new `SalesFulfilmentRepository.
findByIdempotencyKey()` first, before the order-status and over-fulfilment
pre-checks — verified live via duplicate API submissions returning identical results
on both calls, with exactly one `SalesFulfilment`/`InventoryTransaction`/Journal Entry
existing afterward.

### 11.6 Traceability

No new FK fields — `sourceType`/`sourceId` on the Journal Entry, the same polymorphic
design as every other system posting. Finance traces Journal Entry → `sourceId`
(the `SalesFulfilment`) → `GET /sales/orders/:id/fulfilments` (already includes
`journalEntry` plus each item's `unitCost`/`costAmount`) → the parent `SalesOrder` →
Customer/Outlet. No new `GET .../accounting` summary endpoint was added — unlike
Production Orders (which aggregate many Material Issues), a `SalesFulfilment` already
**is** the event, and the existing fulfilment-list endpoint is already
fulfilment-granular.

### 11.7 Distribution independence — verified, not just documented

COGS is triggered by Sales Fulfilment alone — never by a Distributor relationship,
Territory, Dispatch, or Delivery. A new structural guard in
`distribution-inventory-independence.spec.ts` proves `DispatchService`/
`DeliveryService`/`DispatchRepository`/`DeliveryRepository` never call
`postSystemJournalEntry` or touch `tx.journalEntry`, alongside the pre-existing
guarantee that they never touch `InventoryStock`/`InventoryTransaction` either.
Confirmed live: dispatching and delivering a previously-fulfilled order's items left
both `InventoryStock.quantityOnHand` and the total Journal Entry count completely
unchanged.

### 11.8 Returns — resolved by Sprint 11

Sprint 10 shipped with no Sales Return, Reverse Fulfilment, Inventory Return, COGS
Reversal, or Customer Credit mechanism — `SalesOrderService.cancel()` already blocked
cancellation once any fulfilment existed (Sprint 4.9), and a real reversal was
documented as future work. **Sprint 11 builds exactly the mechanism this section
predicted**: `CustomerReturn.receive()` posts `DR Finished Goods Inventory / CR Cost of
Goods Sold` (reversing the fulfilment's own posting, valued at the resalable portion
only) and, independently, issues a Credit Note (`DR Sales Returns / CR Accounts
Receivable`, reusing Sprint 7's existing posting exactly, valued at the credited
portion). See §12 below for the full design.

### 11.9 Deferred (unchanged scope boundary)

A payment gateway, full P&L, Balance Sheet, budgeting, financial forecasting, payroll,
labour costing, factory overhead allocation, depreciation, an advanced pricing engine,
customer credit limits, and full credit management remain explicitly out of scope.
Customer Returns and Supplier Returns are no longer on this list — see §12.

## 12. Return Accounting (Sprint 11)

The reverse-flow half of the operational→accounting chain — never an edit to an
original transaction, always a new event that reverses its physical and financial
consequences. Full non-accounting detail lives in [Sales](sales.md) §4c (Customer
Returns) and [Inventory](inventory.md) §11d (Supplier Returns/Replacement Goods); this
section is the accounting-specific summary, plus the [Sprint 11 Completion
Report](../sprint-11-completion-report.md).

### 12.1 Customer Return Accounting

Two independent postings inside `CustomerReturnRepository.receive()`'s one atomic
transaction — neither implies the other:

- **COGS reversal**: `DR FINISHED_GOODS_INVENTORY / CR COGS`, valued at
  `Σ (quantityResalable × unitCost)` across every returned line, where `unitCost` is
  the _specific_ `SalesFulfilmentItem.unitCost` snapshot the original fulfilment
  actually costed at (never a re-derived "current" average — the whole point of a
  snapshot is that it doesn't move). Zero-skipped (no journal at all, never a
  zero-value one) when nothing resalable was returned — same convention §11.4
  established for Fulfilment itself.
- **Credit Note issuance**: valued at `Σ (quantityCredited × unitPrice)`, where
  `quantityCredited` defaults to the full returned quantity but is a genuinely
  independent figure from `quantityResalable` (brief's explicit instruction: never
  assume a customer's refund equals the physical resalable value — a business
  typically still refunds a customer in full and absorbs a damaged-goods loss
  internally). Posted via `issueCreditNoteWithinTransaction` (extracted from
  `CreditNoteRepository.issue()`, see [Finance](finance.md) §9) inside the _same_
  transaction as the COGS reversal and the inventory restock — if issuing the credit
  note fails (no eligible invoice, over-credit, closed period), the entire receive()
  call rolls back, including the inventory movement. Requires an eligible `Invoice`
  (`PAYABLE_INVOICE_STATUSES`) for the return's Sales Order to exist; if the credited
  amount is non-zero and no such invoice exists, the whole transaction aborts
  (`NoEligibleInvoiceError`) rather than silently skipping the commercial settlement.

Worked example (the Boby Bites scenario, verified live against this codebase's own
running dev server, not just automated tests): 10 packs of Plantain Chips Classic
Salted 500g returned, `unitCost = ₦426` (the fulfilment's own snapshotted cost),
`unitPrice = ₦800`; inspection finds 7 resalable / 3 damaged, full credit issued:
`DR Finished Goods Inventory ₦2,982 / CR COGS ₦2,982` (7 × ₦426), and a Credit Note
for `₦8,000` (10 × ₦800) `DR Sales Returns / CR Accounts Receivable`.

### 12.2 Supplier Return Accounting — the excess-first allocation

`SupplierReturnRepository.create()` reverses a physical return to a supplier in one
atomic call (no separate request/receive phase, unlike Customer Return — there is no
inspection step; the goods are simply leaving). The reversal must correctly split
between two different liability accounts, because Sprint 8's own Accepted-vs-Payable
split (§9.2) means a `GoodsReceiptItem`'s accepted quantity can already be divided
between a commercially-payable portion (`AP`) and an accepted-but-unapproved excess
portion (`GRNI_PENDING_APPROVAL`).

**The rule**: for a return of quantity `Q` against a `GoodsReceiptItem`, excess is
drawn down _first_ — `excessPortion = min(Q, remainingExcess)`, where
`remainingExcess = max(0, (acceptedQuantity - payableQuantity) - returnedExcessQuantity)`
(cumulative across every prior return against that line); the rest,
`payablePortion = Q - excessPortion`, comes from the payable/`AP` bucket. Two new
cumulative columns on `GoodsReceiptItem` — `returnedQuantity` (caps eligibility at
`acceptedQuantity`) and `returnedExcessQuantity` — make this correct across repeated
partial returns, not just a single one-shot return.

The journal: `DR AP (payablePortion × unitPrice)` + `DR GRNI_PENDING_APPROVAL
(excessPortion × unitPrice)` / `CR INVENTORY (Q × unitPrice)`, zero-skipped per line
when that portion is zero (an all-excess or all-payable return posts only one debit
line, not a zero-value one). Valued at the **original** `PurchaseOrderItem.unitPrice`
the receipt itself posted at — deliberately not the current `averageUnitCost`, which
may have drifted since (a documented assumption, not an oversight): this is what
guarantees the reversal ties out exactly to the amount the original receipt journal
recorded, regardless of what's happened to the moving average since.

Worked example (verified live against this codebase's own seed data, mirroring the
brief's own excess-supply scenario): `GoodsReceiptItem` with `acceptedQuantity = 1100`,
`payableQuantity = 1000` (100 units excess, `unitPrice = ₦150`). Returning 50 of the
excess: `excessPortion = min(50, 100) = 50`, `payablePortion = 0`. Posted journal:
`DR GRNI_PENDING_APPROVAL ₦7,500 / CR Inventory ₦7,500` — **no `AP` line at all**,
leaving the payable liability for the other 1,000 units completely untouched, exactly
as the brief's own worked example (§17/§37) requires.

### 12.3 Replacement Goods — no new accounting logic

A supplier's replacement shipment for previously-rejected goods is posted through the
_existing_, completely unmodified `GoodsReceiptRepository.receive()` — see
[Inventory](inventory.md) §11d for why this is provably safe: `payableQuantity` is
already capped cumulatively by remaining-ordered-quantity across every receipt against
a Purchase Order item (Sprint 8), so a replacement receipt mathematically cannot
create a duplicate payable, regardless of whether the original PO's ordered quantity
still has room (the replacement completes an unmet obligation, correctly becoming
payable) or was already fully consumed by the original receipt (the replacement is
correctly treated as further excess, subject to the same `GRNI_PENDING_APPROVAL`
approval workflow as any other over-delivery). Zero new `SYSTEM_ACCOUNT_KEYS` needed.

### 12.4 Costing assumptions, documented explicitly

- Customer return restock cost = the _specific_ originating `SalesFulfilmentItem`'s
  frozen `unitCost`, never the current `averageUnitCost`.
- Supplier return reversal value = the _specific_ originating `PurchaseOrderItem`'s
  frozen `unitPrice`, never the current `averageUnitCost`.
- Both choices are deliberate: a return reverses a specific, already-recorded
  transaction's value, not "whatever the average happens to be today." Where this
  breaks down (e.g. a location's average has drifted so far that the return's implied
  per-unit reversal no longer matches what's physically removed from
  `InventoryStock.quantityOnHand` in aggregate) is the same class of imprecision
  `averageUnitCost` already carries generally (§10.2/§11.2) — not a new limitation
  introduced by returns.

### 12.5 Zero new `SYSTEM_ACCOUNT_KEYS`

`COGS`, `FINISHED_GOODS_INVENTORY`, `SALES_RETURNS`, `AR` (Customer Return) and `AP`,
`GRNI_PENDING_APPROVAL`, `INVENTORY` (Supplier Return) all already existed, seeded
since Sprint 7/8/9/10. A standard restockable customer return and a standard supplier
return both post using only pre-existing system accounts.

## 13. Supplier Invoice Matching & AP Accounting (Sprint 12)

Sprint 12 built [Finance](finance.md) §12's Accounts Payable foundation on top of this
layer. The accounting mechanics live here; the entities/lifecycle/API live in
`finance.md` §12.

### 13.1 The central formula — `computeLineMatch`

For each Path A `SupplierInvoiceItem` (one that references a `GoodsReceiptItem`),
`apps/api/src/finance/supplier-invoice-matching.ts` computes:

```
remainingPayable = max(0,
  goodsReceiptItem.payableQuantity
  - (goodsReceiptItem.returnedQuantity - goodsReceiptItem.returnedExcessQuantity)
  - goodsReceiptItem.invoicedQuantity
)
recognizedAmount = min(item.lineTotal, remainingPayable × purchaseOrderItem.unitPrice)
varianceAmount   = item.lineTotal - recognizedAmount   // always >= 0
```

`remainingPayable` starts from `payableQuantity` (Sprint 8's accepted-vs-payable
split, §9.2), subtracts whatever Sprint 11 Returns already drew from the _payable_
bucket specifically (`returnedQuantity - returnedExcessQuantity` — excess-first
allocation, §12.2, means a return against pure excess leaves this term at zero), then
subtracts what prior Supplier Invoices already claimed (`invoicedQuantity`, a new
cumulative counter on `GoodsReceiptItem`, incremented only at `post()` time). This one
formula is the entire reconciliation engine — it catches quantity mismatch, price
mismatch, and any combination, without a discrepancy-type enum, and it is
mathematically incapable of recognising more than what Goods Receipt already
established as payable. `computeHeaderMatchStatus` derives the invoice-level
`matchStatus` from Path A lines only: `MATCHED` if every line's `varianceAmount` is
zero, `DISCREPANCY` if any is positive, `UNVERIFIED` if there are no Path A lines at
all (a pure Path B invoice has nothing to reconcile).

**Worked example** (the brief's own over-supply scenario): PO ordered 1,000 kg @
₦1,000; a Goods Receipt delivered 1,100 kg, rejected 0, accepted 1,100, but
`payableQuantity` capped at 1,000 (§9.2 — the 100 kg excess sits in
`GRNI_PENDING_APPROVAL`, not `AP`). If the supplier invoices for the full 1,050 kg they
believe they delivered beyond spec (₦1,050,000), `remainingPayable` is still 1,000 kg
(nothing returned or previously invoiced), so `recognizedAmount = min(1,050,000,
1,000 × 1,000) = ₦1,000,000`, `varianceAmount = ₦50,000`, header `DISCREPANCY` — AP
is credited for exactly what Goods Receipt already recognised, never the inflated
figure, and the ₦50,000 excess remains sitting in `GRNI_PENDING_APPROVAL` untouched
(see §13.4).

### 13.2 Path A posts no new journal — the liability already exists

A Path A line's `recognizedAmount` reconciles against a liability Goods Receipt
already posted (`DR Inventory / CR Accounts Payable`, §9.1) at receiving time. Posting
a matching (or even discrepant) Supplier Invoice for it needs no new
`postSystemJournalEntry` call — the debit/credit pair already exists in the ledger. A
100%-Path-A invoice therefore posts **zero** journal entries; `post()` still calls
`resolveOpenPeriodId` against the invoice date regardless, for consistency with every
other financial event and future period-close integrity.

### 13.3 Path B — a fresh liability against an explicit account

A line with no `GoodsReceiptItem` to reconcile against (freight, a service invoice,
anything Procurement never tracked) instead names a `debitAccountId` — a direct
`ChartOfAccount.id` reference rather than one of the fixed `SYSTEM_ACCOUNT_KEYS`.
This required one small, generic extension to the shared posting boundary itself:
`PostingLineInput` (`accounting/journal-posting.ts`) gained an optional `accountId`
alongside `systemKey` — exactly one of the two is required per line, both resolved
tenant-scoped inside the same transaction (`resolveAccountId`/
`resolveSystemAccountId`). No new posting mechanism, no new mandatory workflow — one
more legal way to name an account. `validatePathBAccount`
(`supplier-invoice-matching.ts`) is the policy layer restricting a Path B account to
non-system `ASSET`/`EXPENSE` types, owned by AP's own code, not baked into the
generic primitive — a deliberate narrowing so this capability stays AP accounting, not
a general-purpose posting surface or an Expense Management module. At `post()`, every
Path B line on one invoice is grouped by account and posted as a single balanced `DR
<account>(s) / CR Accounts Payable` entry (not one journal per line).

### 13.4 Discrepancy resolution stays manual — no reclassification engine

`POST /:id/acknowledge-discrepancy` records a human sign-off
(`discrepancyResolvedAt`/`By`/notes) on a `DISCREPANCY` invoice. It **never** touches
`recognizedAmount`, `varianceAmount`, or any account balance — there is no tolerance
engine and no automatic reclassification of `GRNI_PENDING_APPROVAL` into confirmed
`AP` when a discrepancy is acknowledged, even though that is conceptually the eventual
resolution for the over-supply case. Building that reclassification action (`DR
GRNI_PENDING_APPROVAL / CR AP`, presumably gated on some approval) is explicit,
deferred future work — acknowledging a discrepancy today changes nothing but a record
of who looked at it and when.

### 13.5 Zero new `SYSTEM_ACCOUNT_KEYS`

`AP`, `INVENTORY`, `CASH`, `BANK` all already existed (Sprint 6/7/8). Supplier
Payment's `DR AP / CR Cash-or-Bank` and Supplier Credit Note's `DR AP / CR Inventory`
both reuse them directly. Only one new schema column was needed:
`GoodsReceiptItem.invoicedQuantity` (a cumulative counter, mirroring
`returnedQuantity`/`returnedExcessQuantity` from Sprint 11) — no new account, no new
enum on the accounting side itself.

## 16. Financial Statements & Management Reporting (Sprint 13)

Sprints 7-12 built a real, GL-backed accounting engine but never a way to read it as a
_statement_. Sprint 13 is a reporting layer only — it derives every figure from data
that already exists (posted `JournalEntry`/`JournalEntryLine` rows, `Invoice`/
`SupplierInvoice` rows, `InventoryStock`), and never writes a Journal Entry, adjusts a
balance, or recomputes something another domain already owns. See
[Finance](finance.md) §13 for the API/frontend surface; this section covers the
accounting mechanics.

### 16.1 The central formula — normal-balance-sign summation per `AccountType`

`FinancialStatementService` (`apps/api/src/finance/reports/financial-statement.
service.ts`) derives the Profit & Loss and Balance Sheet from `ChartOfAccount.type`
alone — **no schema change was needed**. Every `POSTED` `JournalEntryLine`, grouped by
account (via a new shared `getAccountBalances` helper in `ledger.service.ts`, also
used by the pre-existing Trial Balance), has a raw `netBalance = debit − credit`.
`Asset`/`Cost-of-Sales`/`Expense` accounts are **debit-normal** (`amount =
netBalance`); `Liability`/`Equity`/`Revenue` accounts are **credit-normal** (`amount =
-netBalance`). Summing signed amounts within one `AccountType` group nets contra
accounts automatically — `SALES_RETURNS` (`type: REVENUE`, a contra-revenue account)
correctly reduces `SALES_REVENUE`'s total with no "is this a contra account" flag
anywhere. **Research confirmed this before any code was written** — this is the direct
answer to "identify the minimum architectural enhancement required... do not create a
large accounting redesign": the minimum is zero.

**Profit & Loss**: Revenue = Σ(REVENUE), Cost of Sales = Σ(COST_OF_SALES), Gross
Profit = Revenue − Cost of Sales, Operating Expenses = Σ(EXPENSE) (every `EXPENSE`
account counts as operating — there is no way to split "Other Expense" from Operating
using only `AccountType`, see §16.6), Net Profit = Gross Profit − Operating Expenses.
Gross Margin = `null` (never `NaN`/`Infinity`) when Revenue is zero.

**Balance Sheet**: Assets = Σ(ASSET), Liabilities = Σ(LIABILITY), recorded Equity =
Σ(EQUITY). Both P&L and Balance Sheet reuse the exact same `getAccountBalances` query
the Trial Balance already used since Sprint 7 — a Balance Sheet is simply "the Trial
Balance's Asset/Liability/Equity rows, cumulative since inception rather than a
period," reusing, never duplicating, the balance computation.

### 16.2 Retained Earnings — computed, never a posted account

This codebase has no year-end closing mechanism (unchanged by this sprint, per its
own explicit non-goal — see §36 of the brief). Because every `JournalEntry` is
balanced by construction, `Σ(Assets) − Σ(Liabilities) − Σ(recorded Equity)` at any
instant _always_ exactly equals cumulative net income since the ledger's first
posting — not a coincidence, the accounting equation holding through double-entry
construction. The Balance Sheet therefore reports a computed **"Retained Earnings
(Undistributed)"** line under Equity, equal to all-time net profit (a `getProfitAndLoss`
call with no `from`, i.e. since inception, through the Balance Sheet's `asOf` date) —
never a posted account, never something a future closing entry needs to reconcile
against. `Assets = Liabilities + Equity` holds exactly, by construction, always; the
service reports the raw `difference` rather than assuming it.

### 16.3 Inventory Valuation & Inventory-to-Ledger Reconciliation

`InventoryValuationService` computes `Σ(InventoryStock.quantityOnHand ×
averageUnitCost)`, reusing Inventory's existing moving-weighted-average costing figure
(Sprint 9) — no second costing engine. This is genuinely new territory for Finance,
which has never read Inventory's tables: rather than importing `InventoryModule`
(which would widen `FinanceModule`'s whole dependency graph), the service reaches
directly into `this.prisma.inventoryStock.findMany(...)` — **read-only, no
transaction** — the same "narrow, documented exception to reach into another domain's
own table" pattern Sprint 11/12 established for _writes_ inside a self-owned
transaction, applied here to a plain read. `finance-independence.spec.ts`'s existing
"`FinanceModule` never imports `InventoryModule`" assertion needed **zero changes**
and stays true (verified by `reports-independence.spec.ts`).

`ReconciliationService` compares that subledger total against the GL's `INVENTORY +
FINISHED_GOODS_INVENTORY` system-account balances (via a new `LedgerService.
getSystemAccountBalance` helper). **`WIP` is deliberately excluded** — it represents
in-progress production value with no corresponding `InventoryStock` row, not physical
stock on a shelf. The report returns `{inventorySubledgerValue, glInventoryBalance,
difference}` and **never adjusts either side** — a real difference (and live
verification against this codebase's own accumulated Sprint 8-12 test data did surface
one) is a genuine finding for accounting to investigate, not something this report may
silently fix (brief §15/§33).

### 16.4 AR/AP Aging, Revenue, and COGS reporting

`AccountsReceivableService`/`AccountsPayableService` gained `getAgingReport()` —
additive methods on the _existing_ services (aging is more AR/AP reporting, not a new
domain). Standard Current/1-30/31-60/61-90/90+ buckets by `asOf − dueDate` in days,
computed purely in the service layer — no aging-bucket concept existed anywhere in
this codebase before (`OVERDUE` was, and remains, a lazy boolean sweep with no
days-past-due number stored). AP's aging additionally surfaces `GRNI_PENDING_
APPROVAL`'s current balance and a count of `DISCREPANCY`-matchStatus invoices.

Revenue/COGS reporting uses two deliberately different, non-competing sources: the
headline **total** always comes from `JournalEntryLine` filtered to `SALES_REVENUE`/
`SALES_RETURNS` or `COGS` (ties exactly to the GL — the same `getAccountBalances`
query underlying §16.1); a supplementary **by-product/by-customer breakdown** comes
from `Invoice`/`InvoiceItem` (Finance's own tables) for revenue, and a new read-only
`SalesFulfilmentRepository.getCogsBreakdownByProduct()` (summing `SalesFulfilmentItem.
costAmount`, exported via `SalesModule`, already imported by `FinanceModule` since
Sprint 10) for COGS. Neither breakdown is treated as a second source of truth for the
headline number.

### 16.5 Management Dashboard

`DashboardService` composes — never recomputes — the above: P&L totals + Gross
Margin, `AccountsReceivableService.getSummary()`, `AccountsPayableService.
getSummary()`, and `InventoryValuationService`'s grand total, for a selected period,
plus an optional comparison to the immediately-preceding period of identical length
(`null`, not misleading zeroes, when that period has zero posted activity at all). A
small Operational section (Sales Orders count/total, `ProductionRun.completedAt`
count) uses the same narrow, direct read-only Prisma reach as §16.3, kept
intentionally tiny — "what is happening right now," not every metric this codebase
could produce (brief §18).

### 16.6 Known classification gap, deliberately not solved by a schema change

`AccountType`'s six values (`ASSET|LIABILITY|EQUITY|REVENUE|COST_OF_SALES|EXPENSE`)
cannot distinguish "Other Income"/"Other Expense" from Operating Revenue/Expense, or a
Current from a Fixed Asset — every `REVENUE` account counts as operating revenue,
every `EXPENSE` account as an operating expense in §16.1's P&L. No organisation's real
Chart of Accounts today has an account that would need this distinction, so this is
recorded as a known limitation (§25) rather than solved with new classification
metadata — directly matching the brief's own "do not create a large accounting
redesign" instruction.

## 17. Cash & Bank Management (Sprint 14)

Sprint 14 connects the General Ledger to the organisation's real-world cash and bank
accounts, and builds a reconciliation workflow entirely on top of the primitives
above — see [Cash & Bank Management](cash-management.md) for the full domain
writeup. Summary of the accounting mechanics:

- **A `CashAccount` is never itself a ledger account.** Each one is linked to its
  own dedicated, non-system `ChartOfAccount` row, system-provisioned at creation as
  a child of the org's `CASH`/`BANK` system account (or the new
  `CASH_BANK_PARENT` key for an `OTHER_CASH_EQUIVALENT`) — never the generic
  `CASH`/`BANK` system account itself, which would collapse every bank's book
  balance into one shared figure. `Payment`/`SupplierPayment` gained an optional
  `cashAccountId`: when set, the cash-side posting line targets that dedicated CoA
  row directly (`accountId`, not `systemKey`); when absent, posting falls back
  unchanged to the pre-Sprint-14 `method`-based `CASH`/`BANK` resolution.
- **Opening balance** posts `DR <the new CoA row> / CR OPENING_BALANCE_EQUITY` (a
  new system key elevating the already-seeded "3100 Owner's Capital" row) —
  idempotent, period-aware, and atomic with the `CashAccount`/`ChartOfAccount`
  creation itself, via the same `postSystemJournalEntry` boundary every other
  domain uses.
- **`CashTransaction`** covers cash movements outside the `Payment`/
  `SupplierPayment` flows (a bank charge, a petty cash top-up, a miscellaneous
  receipt) — `RECEIPT` posts `DR <cash account's CoA> / CR <contra account>`,
  `PAYMENT` posts the reverse, against an explicit, user-chosen, non-system contra
  account (the same "Path B" policy `SupplierInvoiceItem.debitAccountId`, Sprint
  12, already established).
- **Reconciliation posts nothing.** `BankReconciliation`/`ReconciliationMatch` are a
  read/review layer over already-posted `JournalEntryLine` rows and already-
  imported `BankStatementTransaction` rows — a `ReconciliationMatch` references a
  `JournalEntryLine.id` directly (never `Payment`/`SupplierPayment`/
  `CashTransaction` polymorphically), so "book transaction" always means the GL's
  own record, never a second interpretation of it. `complete()` requires zero
  unmatched items on both sides — a real, unexplained numeric difference between
  the entered bank-statement balance and the book balance may still remain even
  after every transaction is matched (e.g. the statement balance was entered before
  a later row was imported), and is deliberately never forced to zero.
- **Zero new system accounts were needed for the CASH/BANK cases themselves** —
  `CASH_BANK_PARENT` and `OPENING_BALANCE_EQUITY` both elevate already-seeded rows,
  the same backfill pattern Sprint 9 used for `FINISHED_GOODS_INVENTORY`.

## 20. Cashflow Management (Sprint 15)

Sprint 15 adds a forward-looking forecast layer on top of the primitives
above — see [Cashflow](cashflow.md) for the full domain writeup. Summary of
the accounting mechanics: **there are none.** This is the one integration
sprint in this document that posts nothing at all.

- **The forecast never calls `postSystemJournalEntry`, ever** — asserted by
  zero occurrences in `cashflow-independence.spec.ts`, not merely undocumented.
  Every figure the forecast shows is either a live read of `Invoice`/
  `SupplierInvoice` outstanding balances (via Sprint 13's own
  `getOutstandingForAging()` queries, reused unmodified), a live read of a
  `CashAccount`'s Book Balance (via `LedgerService.getAccountActivity`,
  unchanged since Sprint 7), or a plain read of one of four new raw-input
  models (`CashflowForecastItem`, `CashflowScenario`,
  `CashflowForecastAdjustment`, `CashflowSettings`) — none of which the
  forecast ever writes a computed result back into.
- **A `CashflowForecastAdjustment` overrides only the forecast, never the
  ledger.** It targets an `Invoice`/`SupplierInvoice` id by `(sourceType,
sourceId)`, but the write lands entirely inside the `CashflowForecastAdjustment`
  table — the source `Invoice`/`SupplierInvoice` row itself is never touched.
  Proven both structurally (the independence spec) and by live verification:
  after saving an adjustment on `CF-INV-0001`, its own `total` and status were
  confirmed unchanged, and the Trial Balance still balanced exactly.
- **Zero new `SYSTEM_ACCOUNT_KEYS`, zero schema changes to any existing
  model.** The four new models hold only raw inputs; no `AccountType`,
  `ChartOfAccount`, or posting concept from earlier sections was touched.

## 23. Budgeting (Sprint 16)

Sprint 16 adds a planning layer on top of the primitives above — see
[Budgeting](budgeting.md) for the full domain writeup. Summary of the
accounting mechanics: **there are none**, the same posture Sprint 15 already
established for Cashflow Management.

- **`Budget`/`BudgetLine` never call `postSystemJournalEntry`, ever** —
  asserted by zero occurrences in `budgeting-independence.spec.ts`. Every
  "actual" figure Budget vs Actual shows is a live read of already-posted
  `JournalEntryLine` rows, using the exact normal-balance-sign convention
  §16.1 already established (`REVENUE` → `credit − debit`; `EXPENSE`/
  `COST_OF_SALES` → `debit − credit`) — not a second formula.
- **Budget vs Forecast composes Sprint 15's `CashflowForecastService`
  directly** — the same "reuse an existing engine rather than build a second
  one" discipline Sprint 15 itself followed for AR/AP aging (§20).
- **Zero new `SYSTEM_ACCOUNT_KEYS`, zero schema changes to any existing
  model.** `Budget`/`BudgetLine`/`CostCentre` hold only planned inputs; no
  `AccountType`, `ChartOfAccount`, or posting concept from earlier sections
  was touched.

## 26. Capital & Debt Management (Sprint 17)

Sprint 17 adds borrowing, debt obligations, and financing analysis on top of
the primitives above — see [Debt Management](debt-management.md) for the
full domain writeup. Unlike Sprints 15/16, this domain **does** post to the
General Ledger — it is the fourth domain-level integration point (after
Sprint 8's Goods Receipt, Sprint 9's Production, Sprint 10's Sales
Fulfilment, Sprint 12's Supplier Invoice/Payment) — but it introduces zero
new `SYSTEM_ACCOUNT_KEYS`.

- **A loan is not revenue.** A `DebtDrawdown` posts `DR <cash account's own
CoA> / CR <facility's liabilityAccountId>`, `sourceType: 'DEBT_DRAWDOWN'`.
  A `DebtRepayment` posts one balanced multi-line entry: `DR
liabilityAccountId (principal) + DR interestExpenseAccountId (interest) [+
DR feeExpenseAccountId (fee)] / CR <cash account's own CoA>`, `sourceType:
'DEBT_REPAYMENT'` — principal, interest, and fees are always separate
  lines, never one collapsed amount.
- **No new `SYSTEM_ACCOUNT_KEYS` — the Sprint 12 "Path B" pattern, reused a
  third time.** `DebtFacility.liabilityAccountId`/`.interestExpenseAccountId`
  and `DebtRepayment.feeExpenseAccountId` are user-chosen, service-validated
  (`LIABILITY`/`EXPENSE` type respectively, non-system), tenant-owned
  `ChartOfAccount` rows — the exact pattern `SupplierInvoiceItem.
debitAccountId` established in Sprint 12 and `BudgetLine.chartOfAccountId`
  reused in Sprint 16, letting one organisation run genuinely different loan
  liability accounts rather than one collapsed global account.
- **`CapitalRequirement` posts nothing** — it is a pre-financing business-
  case record, optionally referencing a `Budget`/`BudgetLine` read-only for
  a live Budget Coverage % computation, never writing back to the budget.
- **A `DebtFacility`'s repayment schedule is generated once, in full, at
  creation** — a pure function (`generateSchedule()`), never recomputed per
  drawdown. A `PROPOSED`/`APPROVED` facility's own schedule exists in the
  database but is excluded from every live query (the debt balance, the
  Trial Balance's own inputs via the drawdown/repayment journals, and the
  Cashflow Forecast) until an actual `DebtDrawdown` activates it — the
  facility's own `status` filter (`ACTIVE`/`PARTIALLY_REPAID` only) is the
  entire mechanism, not a special case.
- **Debt balance is always computed live** — `computeDebtBalance()`, a
  plain DI-free function reused both by read endpoints and inside the
  drawdown/repayment transactions themselves (to validate against
  over-repayment before posting) — never a stored/cached column on
  `DebtFacility`.
- **`CashflowForecastSourceType` gains one additive value,
  `LOAN_REPAYMENT`** — `CashflowForecastService.getForecast()` (Sprint 15's
  own file) reads every outstanding schedule installment for `ACTIVE`/
  `PARTIALLY_REPAID` facilities as `CONFIRMED` financing outflows, the same
  "extend the existing engine in place" discipline Sprint 16 already
  followed for Budget vs Forecast (§23).
- **Idempotency, RBAC, tenant isolation, and closed-period atomicity** all
  follow the exact conventions established since Sprint 9/10 — every write
  checks its own `idempotencyKey` first, inside its own transaction, and a
  transaction against a closed accounting period rolls back completely, no
  partial state.
- **Zero schema changes to any existing model** except the additive
  `LOAN_REPAYMENT` enum value and new back-relations — proven structurally
  by `debt-independence.spec.ts` (zero writes to any table outside the six
  new models, `postSystemJournalEntry` called only from the two transaction
  repositories, no Sales/Inventory/Procurement/Production import).

## 29. Investment / Capital Project Management (Sprint 18)

Sprint 18 adds a management layer over the primitives above (and
Procurement/AP) — see [Investment / Capital Projects](investment-projects.md)
for the full domain writeup. Summary of the accounting mechanics: **there
are none**, the same posture Sprint 15/16 already established for Cashflow
Management/Budgeting.

- **`CapitalProject`/`CapitalProjectCostLine`/`CapitalProjectFunding` never
  call `postSystemJournalEntry`, ever** — asserted by zero occurrences in
  `investment-independence.spec.ts`. Real capital expenditure continues
  through the _existing_ Procurement→Goods Receipt→Supplier Invoice→Payment
  chain and its own existing postings (§9/§13); this domain only reads that
  chain's results (`PurchaseOrder.total`, `SupplierInvoice.
recognizedAmount` via the already-exported `getApByPurchaseOrder()`).
- **Cashflow integration composes Sprint 15's `CashflowForecastService`
  directly** — the same "extend the existing engine in place" discipline
  Sprint 16/17 already followed.
- **Zero new `SYSTEM_ACCOUNT_KEYS`, zero schema changes to any existing
  model** except one additive nullable FK
  (`CapitalProjectCostLine.purchaseOrderId`, pointing outward at
  Procurement's existing `PurchaseOrder` — no change to `PurchaseOrder`
  itself) and the additive `CAPITAL_PROJECT` enum value on Sprint 15's own
  `CashflowForecastSourceType`.

## 30. API Reference

| Endpoint                                                                                                              | Auth                | Notes                                                                                         |
| --------------------------------------------------------------------------------------------------------------------- | ------------------- | --------------------------------------------------------------------------------------------- |
| `GET /api/finance/accounts`                                                                                           | Any authenticated   | `?type=&isActive=&search=`                                                                    |
| `GET /api/finance/accounts/:id`                                                                                       | Any authenticated   |                                                                                               |
| `POST /api/finance/accounts`                                                                                          | Owner/Administrator |                                                                                               |
| `PATCH /api/finance/accounts/:id`                                                                                     | Owner/Administrator | `code`/`type`/`systemKey` immutable                                                           |
| `POST /api/finance/accounts/:id/activate` \| `/deactivate`                                                            | Owner/Administrator | system accounts reject deactivate                                                             |
| `GET /api/finance/accounts/:id/activity`                                                                              | Any authenticated   | `?from=&to=`                                                                                  |
| `GET /api/finance/accounting-periods`                                                                                 | Any authenticated   |                                                                                               |
| `POST /api/finance/accounting-periods`                                                                                | Owner/Administrator | overlap-checked                                                                               |
| `POST /api/finance/accounting-periods/:id/close`                                                                      | Owner/Administrator | only from `OPEN`                                                                              |
| `GET /api/finance/journal-entries`                                                                                    | Any authenticated   | `?status=&sourceType=&accountingPeriodId=`                                                    |
| `GET /api/finance/journal-entries/:id`                                                                                | Any authenticated   |                                                                                               |
| `POST /api/finance/journal-entries`                                                                                   | Owner/Administrator | creates `DRAFT`, balance-validated                                                            |
| `POST /api/finance/journal-entries/:id/post`                                                                          | Owner/Administrator | atomic; period-open re-check                                                                  |
| `POST /api/finance/journal-entries/:id/void`                                                                          | Owner/Administrator | bare status flip                                                                              |
| `GET /api/finance/ledger`                                                                                             | Any authenticated   | `?accountId=&from=&to=&accountingPeriodId=&sourceType=&reference=&status=`                    |
| `GET /api/finance/trial-balance`                                                                                      | Any authenticated   | `?from=&to=` or `?accountingPeriodId=`; rows now include `netBalance`/`systemKey` (Sprint 13) |
| `GET /api/finance/reports/profit-loss`                                                                                | Any authenticated   | `?from=&to=&accountingPeriodId=&compare=previous_period`                                      |
| `GET /api/finance/reports/balance-sheet`                                                                              | Any authenticated   | `?asOf=`                                                                                      |
| `GET /api/finance/receivables/aging`                                                                                  | Any authenticated   | `?asOf=`                                                                                      |
| `GET /api/finance/accounts-payable/aging`                                                                             | Any authenticated   | `?asOf=`                                                                                      |
| `GET /api/finance/reports/inventory-valuation`                                                                        | Any authenticated   | `?locationId=&productType=`                                                                   |
| `GET /api/finance/reports/reconciliation`                                                                             | Any authenticated   | Inventory-to-GL only, this sprint                                                             |
| `GET /api/finance/reports/revenue` \| `/cogs`                                                                         | Any authenticated   | `?from=&to=`                                                                                  |
| `GET /api/finance/reports/dashboard`                                                                                  | Any authenticated   | `?from=&to=&compare=previous_period`                                                          |
| `GET/POST /api/finance/cash/accounts`                                                                                 | Any / Owner+Admin   | `POST` provisions a dedicated CoA row + optional opening balance                              |
| `GET /api/finance/cash/accounts/:id/account-number`                                                                   | Owner/Administrator | Full value — audited with no metadata payload                                                 |
| `GET/POST /api/finance/cash/transactions`                                                                             | Any / Owner+Admin   | Outside the Payment/Supplier Payment flows                                                    |
| `GET /api/finance/cash/bank-statements/transactions`                                                                  | Any authenticated   | `?cashAccountId=&matchStatus=`                                                                |
| `POST /api/finance/cash/bank-statements/:cashAccountId/import`                                                        | Owner/Administrator | Already-mapped JSON rows; re-validated server-side                                            |
| `GET/POST /api/finance/cash/reconciliations`                                                                          | Any / Owner+Admin   | `POST` rejects a second `IN_PROGRESS` session per account                                     |
| `POST /api/finance/cash/reconciliations/:id/auto-match`                                                               | Owner/Administrator | Unambiguous same-date/same-amount pairs only                                                  |
| `POST /api/finance/cash/reconciliations/:id/match`                                                                    | Owner/Administrator | Manual; idempotent on an identical repeat pair                                                |
| `POST /api/finance/cash/reconciliations/:id/complete`                                                                 | Owner/Administrator | Rejects with unmatched counts if not fully matched                                            |
| `GET /api/finance/cash/overview`                                                                                      | Any authenticated   | Cash Position Dashboard                                                                       |
| `GET/PUT /api/finance/cashflow/settings`                                                                              | Any / Owner+Admin   | Minimum reserve, default collection/payment delay days                                        |
| `GET/POST /api/finance/cashflow/items`                                                                                | Any / Owner+Admin   | `sourceType` server-derived from `recurrence`                                                 |
| `GET/POST /api/finance/cashflow/scenarios`                                                                            | Any / Owner+Admin   | Base/Conservative/Optimistic-style delay+multiplier knobs                                     |
| `GET /api/finance/cashflow/adjustments` \| `PUT`                                                                      | Any / Owner+Admin   | Upsert by `(sourceType, sourceId)`; never writes to the source record                         |
| `GET /api/finance/cashflow/forecast`                                                                                  | Any authenticated   | `?horizonDays=&bucketBy=&scenarioId=&cashAccountId=`; never stored, recomputed every call     |
| `GET /api/finance/cashflow/accounts/breakdown`                                                                        | Any authenticated   | `?horizonDays=`; per-cash-account projected closing balances                                  |
| `GET/POST /api/finance/budgets`                                                                                       | Any / Owner+Admin   | `POST` derives `startDate`/`endDate` from `fiscalYear` + org config                           |
| `GET /api/finance/budgets/:id/siblings`                                                                               | Any authenticated   | Every version/scenario sharing this budget's own code+fiscal year                             |
| `POST /api/finance/budgets/:id/approve` \| `/activate` \| `/close` \| `/revise`                                       | Owner/Administrator | Status-guarded lifecycle transitions                                                          |
| `GET/POST /api/finance/budgets/:id/lines`                                                                             | Any / Owner+Admin   | `POST` upserts Revenue/OpEx by natural key; CAPEX is always a fresh insert                    |
| `GET /api/finance/budgets/:id/vs-actual`                                                                              | Any authenticated   | Never stored, recomputed every call                                                           |
| `GET /api/finance/budgets/:id/vs-forecast`                                                                            | Any authenticated   | Composes Sprint 15's forecast; `{applicable: false}` once the fiscal year has ended           |
| `GET/POST /api/finance/cost-centres`                                                                                  | Any / Owner+Admin   | A pure budget-line tag, never linked to the Chart of Accounts                                 |
| `GET/POST /api/finance/debt/lenders`                                                                                  | Any / Owner+Admin   | Lightweight — no full CRM                                                                     |
| `GET/POST /api/finance/debt/capital-requirements`                                                                     | Any / Owner+Admin   | The business case for financing, not yet an approved loan                                     |
| `GET /api/finance/debt/capital-requirements/:id/budget-coverage`                                                      | Any authenticated   | Never mutates the referenced budget                                                           |
| `POST /api/finance/debt/capital-requirements/:id/{propose,approve,fund,complete,cancel}`                              | Owner/Administrator | Status-guarded lifecycle transitions                                                          |
| `GET/POST /api/finance/debt/facilities`                                                                               | Any / Owner+Admin   | `POST` generates the full repayment schedule in the same transaction                          |
| `GET /api/finance/debt/facilities/:id`                                                                                | Any authenticated   | Includes the live debt balance                                                                |
| `GET /api/finance/debt/facilities/:id/schedule`                                                                       | Any authenticated   | Sweeps `OVERDUE` installments lazily first                                                    |
| `GET /api/finance/debt/facilities/:id/preview-impact`                                                                 | Any authenticated   | Overlays a `PROPOSED` facility's schedule onto a real Cashflow Forecast call                  |
| `POST /api/finance/debt/facilities/:id/{approve,cancel,mark-defaulted}`                                               | Owner/Administrator | Status-guarded lifecycle transitions                                                          |
| `POST /api/finance/debt/facilities/:id/drawdowns`                                                                     | Owner/Administrator | Posts `DR Cash / CR Loan Payable`; auto-activates the facility on first drawdown              |
| `POST /api/finance/debt/facilities/:id/repayments`                                                                    | Owner/Administrator | Posts the principal/interest/fee-split entry; auto-transitions `PARTIALLY_REPAID`/`PAID_OFF`  |
| `GET /api/finance/debt/overview`                                                                                      | Any authenticated   | Composed dashboard metrics, never stored                                                      |
| `GET/POST /api/finance/investment/projects`                                                                           | Any / Owner+Admin   | `POST` generates `CAP-000001`-style code                                                      |
| `GET/PATCH /api/finance/investment/projects/:id`                                                                      | Any / Owner+Admin   | `GET` includes server-computed financials; `PATCH` requires `DRAFT`                           |
| `GET /api/finance/investment/projects/:id/budget-allocation`                                                          | Any authenticated   | `null` when no budget referenced                                                              |
| `GET /api/finance/investment/projects/:id/spending`                                                                   | Any authenticated   | Planned/Committed/Actual/Remaining, always derived live from Procurement/AP                   |
| `GET/POST /api/finance/investment/projects/:id/cost-lines`                                                            | Any / Owner+Admin   | `POST` requires `DRAFT`                                                                       |
| `DELETE /api/finance/investment/projects/:id/cost-lines/:costLineId`                                                  | Owner/Administrator | Requires `DRAFT`                                                                              |
| `GET/POST /api/finance/investment/projects/:id/funding`                                                               | Any / Owner+Admin   | `POST` idempotency-checked; allowed through `ACTIVE`                                          |
| `DELETE /api/finance/investment/projects/:id/funding/:fundingId`                                                      | Owner/Administrator | Allowed through `ACTIVE`                                                                      |
| `POST /api/finance/investment/projects/:id/{submit,start-review,approve,reject,activate,hold,resume,complete,cancel}` | Owner/Administrator | Status-guarded, soft-idempotent lifecycle transitions                                         |

## 31. Known Limitations

- No re-opening a closed accounting period, and no year-end closing automation.
- `VOID` never generates an automatic reversing entry — a correction is a new manual
  journal. **Resolved in Sprint 11** for the specific case of a Sales Fulfilment: a
  `CustomerReturn` now provides a real COGS-reversal path (§11.8/§12) — this remains
  a distinct new event, not an automatic reversal of the original journal itself,
  which is still never mutated or voided.
- Running balance in an unfiltered (multi-account) `GET /finance/ledger` view is a
  cumulative net across unrelated accounts — most meaningful once filtered to one
  account; see §6.
- No General Ledger integration for Procurement's own PO-confirmation event or
  Distribution's Dispatch/Delivery events — Finance's three events, Inventory's Goods
  Receipt (Sprint 8), Production's Material Issue/Completion (Sprint 9, see §10), and
  Sales Fulfilment's COGS posting (Sprint 10, see §11) all post automatically;
  Distribution deliberately never posts (§11.7).
- No approval workflow for `GRNI_PENDING_APPROVAL` balances — value posted there stays
  there; a future sprint would add the action that reclassifies it into `AP`. A
  Supplier Invoice's discrepancy acknowledgement (§13.4) does not do this either — it
  is sign-off only.
- No payment runs, AP ageing report, or automated payment scheduling (Sprint 12) — a
  Payables Overview and a flat payment ledger only, see [Finance](finance.md) §12.
- No approval workflow gating which Chart of Accounts entries a Supplier Invoice's
  Path B line may post against — restricted by account type (`ASSET`/`EXPENSE`,
  non-system) only, not by a configurable policy (§13.3).
- No labour, machine-hour, or overhead costing anywhere in Production Accounting (§10)
  or Sales Fulfilment Accounting (§11) — material cost only.
- No FIFO/specific-identification costing, per-lot cost tracking, or landed-cost
  allocation in either Production Material Issue's or Sales Fulfilment's COGS
  postings — both reuse the same moving-weighted-average `averageUnitCost`.
- No full module-level permission engine — RBAC remains binary
  (Owner/Administrator-write, Member-read), same deferred decision as every other
  domain in this codebase.
- No `CreditNoteItem` line detail on a return-issued Credit Note (Sprint 11) — same
  pre-existing limitation as every manually-issued one, see [Finance](finance.md) §11.
- Return cost/value reversals use the specific originating transaction's frozen
  cost/price, never the current `averageUnitCost` (§12.4) — consistent with, not an
  exception to, this document's existing costing-precision limitations.
- **`cashAccountId` on `Payment`/`SupplierPayment` is optional, not required**
  (Sprint 14 §17) — a payment recorded with no cash account still posts correctly
  via the pre-existing `method`-based `CASH`/`BANK` fallback; nothing in this
  codebase forces every payment to name a specific bank account.
- No reopening a `COMPLETED` `BankReconciliation` — a correction happens via a new
  `CashTransaction`/journal entry handled in a later session, the same "never
  rewrite history" convention `Payment.void()` already establishes (§17).
- No bank-statement balance recompute/auto-correct when a `BankReconciliation`'s own
  `openingBankBalance`/`closingBankBalance` disagrees with the sum of its matched
  transactions — both are user-entered facts from the physical statement, surfaced
  as a Difference figure, never silently adjusted (§17).
- **No caching of any kind for the Cashflow forecast** (§20) — every response is
  recomputed live from AR/AP and Cash Account data on every request, per the
  brief's own "no premature caching" instruction; a very large volume of
  outstanding invoices would repeat this cost on every call.
- **A per-cash-account Cashflow forecast excludes AR/AP** (§20) — `Invoice`/
  `SupplierInvoice` carry no `cashAccountId`, so only explicitly-assigned
  `CashflowForecastItem`s appear in a single account's own bucketed view;
  outstanding AR/AP appears only in the consolidated, org-wide forecast.
- **No investment/equity/bond/fixed-asset management, loan-application
  workflow, credit scoring, automatic loan approval, bank/payment-gateway
  integration, collections system, automatic penalty interest, tax
  treatment of financing, or full NPV/IRR/DCF engine** (§26) — Sprint 17 is
  a deliberate data foundation, not the full capital-decision intelligence
  layer described in [Debt Management](debt-management.md) §13.
- **Interest cannot be prepaid ahead of its own schedule accrual** (§26) —
  `computeDebtBalance()`'s `outstandingInterest` only counts installments
  whose `dueDate` has already passed; a repayment naming more interest than
  has accrued is rejected the same way an over-repayment is, a documented
  consequence of the live-accrual model.
- **Future planned drawdowns are not modelled as Cashflow Forecast
  inflows** (§26) — there is no "planned drawdown date" field on
  `DebtFacility` to project from this sprint; only outstanding repayment
  schedule installments appear as outflows.
- **No investment-decision engine, no Purchase Order picker in the
  cost-line create form, no financing-allocation optimisation** (§29) —
  Sprint 18 is a deliberate data foundation for a future Sprint 19 decision
  engine, described in [Investment / Capital Projects](investment-projects.md) §11/§12.
- **A capital project's Committed/Actual Cost only reflects the Procurement→
  Supplier Invoice chain** (§29) — a cost paid outside that chain (a
  training session invoiced directly, a cash withdrawal) shows ₦0 until a
  supporting Purchase Order/Supplier Invoice exists.
