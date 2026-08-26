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

### 11.8 Returns — prepared for, not built

No Sales Return, Reverse Fulfilment, Inventory Return, COGS Reversal, or Customer
Credit mechanism exists. `SalesOrderService.cancel()` already blocks cancellation once
any fulfilment exists (Sprint 4.9) — a real reversal remains a future capability. A
future implementation would post `DR Finished Goods Inventory / CR Cost of Goods Sold`
(reversing the fulfilment's own posting) and, separately, `DR Sales Returns / CR
Accounts Receivable` (reversing revenue, mirroring Sprint 7's existing Credit Note
posting) — the architecture doesn't prevent either, but neither is implemented.

### 11.9 Deferred (unchanged scope boundary)

Sales Returns, Customer Claims, Supplier Returns, a payment gateway, full P&L, Balance
Sheet, budgeting, financial forecasting, payroll, labour costing, factory overhead
allocation, depreciation, an advanced pricing engine, customer credit limits, and full
credit management are all explicitly out of scope this sprint.

## 12. API Reference

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

## 13. Known Limitations

- No re-opening a closed accounting period, and no year-end closing automation.
- `VOID` never generates an automatic reversing entry — a correction is a new manual
  journal. As of Sprint 10, no Sales Return/Reverse Fulfilment COGS-reversal mechanism
  exists either — see §11.8.
- Running balance in an unfiltered (multi-account) `GET /finance/ledger` view is a
  cumulative net across unrelated accounts — most meaningful once filtered to one
  account; see §6.
- Trial Balance has no financial-statement layer on top of it (no P&L, no Balance
  Sheet) — see §9.4.
- No General Ledger integration for Procurement's own PO-confirmation event or
  Distribution's Dispatch/Delivery events — Finance's three events, Inventory's Goods
  Receipt (Sprint 8), Production's Material Issue/Completion (Sprint 9, see §10), and
  Sales Fulfilment's COGS posting (Sprint 10, see §11) all post automatically;
  Distribution deliberately never posts (§11.7).
- No approval workflow for `GRNI_PENDING_APPROVAL` balances — value posted there stays
  there; a future sprint would add the action that reclassifies it into `AP`.
- No labour, machine-hour, or overhead costing anywhere in Production Accounting (§10)
  or Sales Fulfilment Accounting (§11) — material cost only.
- No FIFO/specific-identification costing, per-lot cost tracking, or landed-cost
  allocation in either Production Material Issue's or Sales Fulfilment's COGS
  postings — both reuse the same moving-weighted-average `averageUnitCost`.
- No full module-level permission engine — RBAC remains binary
  (Owner/Administrator-write, Member-read), same deferred decision as every other
  domain in this codebase.
