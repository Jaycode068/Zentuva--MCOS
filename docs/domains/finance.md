# Finance Domain

- **Status:** Foundation implemented — Sprint 6 ("Finance Foundation"), extended
  Sprint 7 with automatic General Ledger posting — see [Accounting](accounting.md).
  Sprint 12 added Accounts Payable / Supplier Invoice Management — see §12. Sprint 13
  added a read-only Financial Statements & Management Reporting layer — see §13.
  Sprint 14 added Cash & Bank Management / Reconciliation — see §14 and
  [Cash & Bank Management](cash-management.md). Sprint 15 added a forward-looking
  Cashflow Management & Forecasting layer — see §15 and [Cashflow](cashflow.md).
  Sprint 16 added a Budgeting & Financial Planning layer — see §16 and
  [Budgeting](budgeting.md). **Not** a General Ledger / accounting system itself —
  that layer lives in `accounting.md`, see §9.
- **Sprint:** 6 (Sprint 7 added the accounting integration described in §9; Sprint 12
  added Accounts Payable described in §12; Sprint 13 added Reporting described in
  §13; Sprint 14 added Cash & Bank Management described in §14; Sprint 15 added
  Cashflow Management & Forecasting described in §15; Sprint 16 added Budgeting &
  Financial Planning described in §16)
- **Depends on:** [Identity](identity.md) (tenant boundary, `RolesGuard`,
  `OrganisationService` for the currency snapshot), [Sales](sales.md)
  (`SalesOrderRepository`, read-only, via `SalesModule`'s existing export),
  [Customers](customers.md), [Outlets](outlets.md). Sprint 12 additionally depends,
  read-only, on [Suppliers](suppliers.md) (`SupplierRepository`) and
  [Procurement](procurement.md) (`PurchaseOrderRepository`) — see §12.
- **Explicitly does not depend on:** [Inventory](inventory.md),
  [Distribution](distribution.md) — see §2. Still true after Sprint 12:
  `SupplierInvoiceRepository` reaches directly into `GoodsReceiptItem` inside its own
  transaction (the same narrow exception `SupplierReturnRepository` established in
  Sprint 11) rather than importing `InventoryModule`.
- **See also:** [Sprint 6 Completion Report](../sprint-6-completion-report.md),
  [Sprint 7 Completion Report](../sprint-7-completion-report.md),
  [Sprint 12 Completion Report](../sprint-12-completion-report.md),
  [Sprint 13 Completion Report](../sprint-13-completion-report.md),
  [Sprint 14 Completion Report](../sprint-14-completion-report.md),
  [Sprint 15 Completion Report](../sprint-15-completion-report.md),
  [Sprint 16 Completion Report](../sprint-16-completion-report.md),
  [Accounting](accounting.md), [Cash & Bank Management](cash-management.md),
  [Cashflow](cashflow.md), [Budgeting](budgeting.md).

## 1. Business Purpose

Every domain through Sprint 5 (Sales → Fulfilment → Dispatch → Delivery) records that
goods moved. None of them record the financial consequence: what a customer was billed,
what they've paid, what they still owe. This sprint adds that layer:

- **Invoice** — a bill raised against a fulfilled Sales Order, snapshotting the
  commercial terms at the moment it is created.
- **Payment** — money received from a customer, allocated against one or more invoices,
  supporting partial payment.
- **Credit Note** — the financial consequence of a customer return or commercial
  adjustment (the physical return itself is Sales/Logistics/Inventory's concern, out of
  scope here).
- **Accounts Receivable** — what every customer has been invoiced, paid, credited, and
  still owes, derived from the above, never independently stored.

Creating or confirming a Sales Order never creates an Invoice automatically — invoicing
is a deliberate Finance-owned action, decoupled from the commercial-order and
fulfilment/dispatch/delivery chain that precedes it.

## 2. `FinanceModule` Never Touches `SalesOrder`/`Dispatch`/`Delivery`/`InventoryStock`, Never Imports `InventoryModule`/`DistributionModule`

Proven executably by `finance-independence.spec.ts` (not just documented here):

- `FinanceModule` imports only `IdentityModule`, `AuthModule`, `SalesModule`,
  `CustomerModule`, `OutletModule`. It does **not** import `InventoryModule` or
  `DistributionModule` at all — Finance is structurally unable to read Dispatch/Delivery
  status.
- `invoice.repository.ts`/`payment.repository.ts`/`credit-note.repository.ts` never
  write to `tx.salesOrder`, `tx.salesOrderItem`, `tx.dispatch`, `tx.dispatchItem`,
  `tx.delivery`, `tx.deliveryItem`, `tx.inventoryStock`, or `tx.inventoryTransaction` —
  Finance may **read** `SalesOrder` data (via `SalesOrderRepository`, a plain
  non-transactional call, read-only) but never writes to any upstream domain's tables.

This drove a direct architectural consequence: **invoice eligibility is
`SalesOrder.status === 'FULFILLED'` only** — nothing about dispatch or delivery
completion, since that data is architecturally unreachable from Finance. The brief's
narrative sequencing ("confirmed → fulfilled → dispatched → delivered → invoice")
describes typical real-world timing, not a technical dependency Finance can enforce.

## 3. Key Concepts / Entities

### Invoice

- **Fields:** `invoiceCode` (auto-generated `INV-000001`, ..., globally unique,
  immutable), `customerId`, `outletId` (optional), `salesOrderId` (the source order),
  `invoiceDate`, `dueDate` (server-computed from `paymentTerms`), `paymentTerms`
  (`CASH`/`DUE_ON_RECEIPT`/`NET_7`/`NET_14`/`NET_30` — a closed enum, not a table; see
  §6), `status`, `currency` (snapshotted from `Organisation.currency` at creation —
  never a second currency system), `subtotal`/`discount`/`taxAmount`/`total` (all
  server-computed, never client-supplied), `amountPaid`/`amountCredited` (cumulative
  columns, each incremented only inside the relevant repository's own atomic
  transaction), `notes`.
- **`amountOutstanding` is never stored.** It is always derived as
  `total - amountPaid - amountCredited` at every read site (repository, service,
  response mapper) — the same "don't store a redundant derived value" reasoning already
  applied elsewhere in this codebase.
- **No header-level `taxRate`.** Only `InvoiceItem.taxRate`/`taxAmount` are stored, per
  line; `Invoice.taxAmount` is their sum. A header-level rate would drift from per-line
  reality the moment two lines carry different rates.
- **Status lifecycle:** `DRAFT → ISSUED → {PARTIALLY_PAID → PAID}`, plus `OVERDUE` and
  `VOID`. `issue()`: `DRAFT → ISSUED` only. `void()`: from `DRAFT` freely; from `ISSUED`
  only if `amountPaid === 0 && amountCredited === 0` (nothing applied yet — otherwise
  rejected, forcing a Credit Note as the corrective path instead). Never from
  `PARTIALLY_PAID`/`PAID`/`OVERDUE`/`VOID`.
- **`OVERDUE` is a lazy sweep, not a scheduled job.** No cron/scheduler infrastructure
  exists anywhere in this codebase. `InvoiceRepository.findById`/
  `findManyByOrganisation`/`getArByCustomer`/`getArSummary` all call a private
  `sweepOverdue(organisationId)` first — a tenant-scoped `updateMany({where: {status:
{in: [ISSUED, PARTIALLY_PAID]}, dueDate: {lt: now}}, data: {status: OVERDUE}})` —
  keeping `status` genuinely authoritative in the database without background-job
  infrastructure. **`OVERDUE` takes precedence over `PARTIALLY_PAID`** once the due date
  lapses: a partially-paid invoice past its due date displays `OVERDUE`, not
  `PARTIALLY_PAID`, on every subsequent read — the partial-payment progress remains
  fully visible via `amountPaid`/`amountOutstanding`, only the status label
  collapses the two conditions into one. `PAID` and `VOID` are excluded from the sweep
  and never get overwritten.

### InvoiceItem

- Snapshots `productCode`/`productName`/`unitPrice`/`quantity`/`discount`/`taxRate`/
  `taxAmount`/`lineTotal` at invoice-creation time, referencing the source
  `salesOrderItemId` for traceability — **never reconstructed from the live Product
  Catalogue**. A historical invoice remains accurate even if the product is renamed,
  re-priced, or deactivated later.

### Payment

- **Fields:** `customerId` (not `invoiceId` — see the allocation model below),
  `paymentDate`, `amount`, `currency` (server-derived from the target invoice, never
  client-supplied — a payment can only ever apply to one currency, its target invoice's,
  so accepting it from the client would be an unvalidated, spoofable duplicate),
  `method` (`CASH`/`BANK_TRANSFER`/`POS`/`OTHER`), `reference` (free-text bank/
  transaction reference), `notes`, `status` (`RECORDED`/`VOIDED`).
- **Allocation model.** `Payment` has no direct `invoiceId` FK. A separate
  `PaymentAllocation` join table (`paymentId`, `invoiceId`, `amount`) links payments to
  invoices. Sprint 6's `PaymentService.create()` always creates exactly **one**
  allocation row per payment — single-invoice allocation only, explicitly a Sprint 6
  limitation — but the schema already supports N allocations per payment with **zero
  future migration**: multi-invoice allocation is a service-layer change only.
- **Overpayment/void guards.** `amount` must be `> 0` and `<= amountOutstanding` at the
  target invoice (exact boundary: `amount === outstanding` succeeds, one cent more is
  rejected). Payment against a `VOID`/`DRAFT`/`PAID` invoice is rejected. `void()`
  reverses the cumulative `amountPaid` increment and recomputes the invoice's status
  back down — the payment row is never deleted, only marked `VOIDED`.

### CreditNote

- **Fields:** `creditNoteCode` (auto-generated `CN-000001`, ...), `customerId`,
  `invoiceId` (optional — nullable for future unapplied-credit scenarios, though Sprint 6
  always supplies one), `reason` (required, non-empty), `amount`, `currency`
  (server-derived from the target invoice, same reasoning as `Payment.currency`),
  `status` (`DRAFT`/`ISSUED`/`VOID`), `creditNoteDate`, `notes`.
- **Lightweight, deliberately.** A single flat `amount` — no `CreditNoteItem` line
  detail. Matches the brief's own scenario (a flat ₦250,000 credit for a partial
  return) and its explicit "lightweight foundation" framing; a full Returns Management
  system (reason-code taxonomy, return-to-stock, multi-line credits) is out of scope.
  Do not use a negative Invoice as a substitute for a Credit Note — voiding is the
  correction path for an invoice that hasn't had money applied yet; a Credit Note is the
  correction path once it has.
- **`create()`/`issue()` split**, mirroring Invoice's own `DRAFT`/`ISSUED` split:
  `create()` only writes the `DRAFT` row, no side effects. `issue()` is the atomic step
  that (when `invoiceId` is present) re-validates the target invoice's eligible status,
  guards against crediting more than the outstanding balance, increments
  `Invoice.amountCredited`, and recomputes the invoice's status — via the **same shared
  derivation helpers** `payment.repository.ts` exports
  (`deriveInvoiceStatusAfterApplication`/`deriveInvoiceStatusAfterReversal`), so a
  payment and a credit note applied to the same invoice always agree on what status
  results. `void()` reverses the increment if the note had been `ISSUED`.

### Accounts Receivable

- Not a stored table — `AccountsReceivableService` computes everything on read via
  `prisma.invoice.groupBy`/`.aggregate()` (the idiomatic cross-entity reporting pattern
  in this codebase, matching `InventoryTransactionRepository.getLastMovementByProduct`/
  `GoodsReceiptRepository.getReceivingTotals`), never `findMany` + JS reduction.
  `getArByCustomer()` returns per-customer totals invoiced/paid/credited/outstanding;
  `getArSummary()` returns the organisation-wide Overview cards (Total Outstanding,
  Overdue, Invoiced This Period, Payments Received This Period — "this period" is the
  current calendar month).

## 4. Money Precision, Tax, and Currency

- **Float, not Decimal**, throughout — matching this codebase's existing, unbroken
  convention on `SalesOrder`/`PurchaseOrder` (this codebase has never used Prisma
  `Decimal` anywhere). Each repository/service applies its own `roundCurrency(v) =>
Math.round(v * 100) / 100` helper at every computed monetary value, and financial
  arithmetic is tested explicitly for floating-point drift (e.g. repeated partial
  payments summing exactly to `total` must land on `amountOutstanding === 0` exactly,
  never `0.0000000001`).
- **Tax is a minimal, configurable default — never a hardcoded rate in calculation
  logic.** `finance.defaultTaxRatePercent` (env `FINANCE_DEFAULT_TAX_RATE_PERCENT`,
  default `7.5` for local Boby Bites/NGN dev) is applied only when an invoice line
  omits its own `taxRate`; whichever rate is actually used is permanently snapshotted
  onto the `InvoiceItem`, never recomputed later even if the configured default
  changes. This is not a tax engine — no jurisdiction rules, no multi-rate schedules,
  no tax-exempt product categories.
- **Currency** reuses `Organisation.currency` as-is — no second currency system.
  `Invoice.currency` is snapshotted at creation from `OrganisationService.getById()`;
  `Payment.currency`/`CreditNote.currency` are always derived from their target
  invoice's own snapshotted currency, never accepted as client input.

## 5. Payment Terms

`PaymentTermType` is a closed enum (`CASH`/`DUE_ON_RECEIPT`/`NET_7`/`NET_14`/`NET_30`),
not a tenant-configurable table — matching every other closed status-set in this
codebase. A pure `PAYMENT_TERM_DAYS` map derives `dueDate = invoiceDate +
paymentTermDays(paymentTerms)` server-side. No credit-management engine (customer
credit limits, approval workflows, credit scoring) — explicitly deferred. Note:
`DUE_ON_RECEIPT` maps to 0 days, so `dueDate === invoiceDate`; because dates carry no
time-of-day granularity beyond the calendar boundary, a `DUE_ON_RECEIPT` invoice
becomes technically overdue (via the lazy sweep) any time after midnight on its issue
date — this is a known, intentional consequence of "due the same day," not a bug.

## 6. Workflows

- **Create an Invoice** — `POST /api/finance/invoices` (Owner/Administrator only).
  Validates the Sales Order is `FULFILLED` and has no existing non-`VOID` invoice,
  snapshots items from the order's own lines (never re-derived from the live Product
  Catalogue), computes every total server-side, computes `dueDate` from `paymentTerms`.
- **Issue / Void** — `POST /:id/issue`, `POST /:id/void` — guarded per §3.
- **Record a Payment** — `POST /api/finance/payments` (Owner/Administrator only) —
  atomic: idempotency check-then-return, eligibility guard, over-payment guard, create
  `Payment` + one `PaymentAllocation`, increment `Invoice.amountPaid`, recompute status.
- **Void a Payment** — `POST /finance/payments/:id/void` — reverses the increment.
- **Create + Issue a Credit Note** — `POST /api/finance/credit-notes` then
  `POST /:id/issue` (Owner/Administrator only) — see §3's `create()`/`issue()` split.
- **Void a Credit Note** — `POST /finance/credit-notes/:id/void`.
- **Browse Accounts Receivable** — `GET /finance/receivables/summary`,
  `GET /finance/receivables/by-customer`, `GET /finance/receivables/customers/:id` (any
  authenticated user, Member read-only).
- **Drill-down** — `GET /finance/invoices/:id/payments`,
  `GET /finance/invoices/:id/credit-notes`.

## 7. Admin Surface (`apps/web/src/app/(app)/settings/finance/`)

Finance is an administrative workflow, not a field-agent surface — it deliberately does
**not** get the mobile-first Field Sales treatment Distribution/Delivery received;
responsive support means desktop/tablet/mobile all render cleanly (card layouts on
narrow widths, full tables on wide), not a redesigned mobile-first flow. Five Finance
routes, each rendering a shared bespoke `FinanceTabs` component (no generic `Tabs`
primitive exists in this codebase; `FinanceTabs` follows the exact precedent already
set by `AccountTabs`): Overview (`/settings/finance`), Invoices, Payments, Receivables,
Credit Notes — plus five more Accounting routes Sprint 7 added to the same
`FinanceTabs` bar (Chart of Accounts, Journal Entries, General Ledger, Trial Balance,
Accounting Periods; see [Accounting](accounting.md) §8). Invoice creation is a two-step
dialog (pick an eligible Sales Order → the invoice form, with live client-side preview
totals that are never trusted on submit); the Invoice detail dialog nests "Record
Payment" and "Issue Credit Note" as their own dialogs, mirroring Distribution's
`DispatchDetailDialog` → `DeliveryDialog` composition.

## 8. RBAC / Tenant Isolation / Audit

Same conventions as every other domain — `RolesGuard`, Owner/Administrator write, Member
read-only (enforced server-side only; the frontend does not hide write actions from
Member, consistent with every other domain's existing convention), tenant-scoped
repository methods, cross-tenant access returns 404 (not a data leak) on direct-by-id
reads and 403 on writes. Audit actions: `invoice.created`, `invoice.issued`,
`invoice.voided`, `payment.recorded`, `payment.voided`, `credit-note.created`,
`credit-note.issued`, `credit-note.voided`. A replayed idempotent create
(`wasCreated === false`) never emits a second audit event.

## 9. Accounting Integration (Sprint 7) — No Longer Fully Deferred

Sprint 6 shaped Finance's events so a future General Ledger sprint could post journal
entries from them without a Finance rewrite. **Sprint 7 built that layer** — see
[Accounting](accounting.md) for the full design. `Invoice.issue()`,
`PaymentRepository.create()`, and `CreditNoteRepository.issue()` now each atomically
post a double-entry `JournalEntry` (`DR Accounts Receivable / CR Sales Revenue`,
`DR Cash-or-Bank / CR Accounts Receivable`, `DR Sales Returns / CR Accounts
Receivable`, respectively) via `accounting/journal-posting.ts`'s plain, DI-free
helpers — in the same transaction as the Finance write that triggered them, so an
invoice can never end up `ISSUED` with no accounting behind it.

What remains genuinely deferred, unchanged by Sprint 7: Chart of Accounts →
financial-statement closing (Trial Balance → Profit & Loss, Balance Sheet), Cash Flow
Statement, Bank Reconciliation, payroll, fixed assets, a full multi-jurisdiction tax
engine, sophisticated customer/distributor pricing, credit scoring, Nigerian
bank/payment-gateway integration, advanced financial analytics, budgeting, and
financial forecasting. Accounts Payable / supplier invoices — listed here as deferred
through Sprint 11 — got its foundation in **Sprint 12**; see §12. Sprint 8 wired Inventory's Goods
Receipt, Sprint 9 wired Production's Material Issue/Completion, and Sprint 10 wired
Sales's Fulfilment (`DR Cost of Goods Sold / CR Finished Goods Inventory`, deliberately
a separate event from this section's own `DR Accounts Receivable / CR Sales Revenue`
Invoice posting — see [Sales](sales.md) §4b and `accounting.md` §11) — Distribution
(Dispatch/Delivery) and Procurement's own PO-confirmation event remain unwired.
**Sprint 11** resolves the "COGS-reversal for Sales Returns" gap this section used to
flag: `CustomerReturn.receive()` (owned by [Sales](sales.md) §4c) posts the mirror
entry (`DR Finished Goods Inventory / CR Cost of Goods Sold`) and reuses this domain's
own Credit Note engine for the commercial settlement side, via a small extraction —
`CreditNoteRepository.issue()`'s atomic body is now also available as a plain, DI-free
`issueCreditNoteWithinTransaction(tx, ...)` function (same "plain function, not a
NestJS provider" contract `postSystemJournalEntry` already established), so a Return's
inventory movement, COGS reversal, and Credit Note issuance all share one outer
transaction — no second, competing credit-note engine. `CreditNote` also gained a
polymorphic `sourceType`/`sourceId` pair (mirroring `JournalEntry`'s own, `NULL` for
every credit note created the original, purely-manual way) so Finance can trace a
credit note back to the `CustomerReturn` that issued it. See `accounting.md`
§9.4/§11.9 for the full remaining deferred-integration list.

## 10. API Reference

| Endpoint                                     | Auth                | Notes                                         |
| -------------------------------------------- | ------------------- | --------------------------------------------- |
| `GET /api/finance/eligible-sales-orders`     | Any authenticated   | `FULFILLED`, no non-`VOID` invoice yet        |
| `GET /api/finance/invoices`                  | Any authenticated   | `?status=&customerId=&salesOrderId=&search=`  |
| `GET /api/finance/invoices/:id`              | Any authenticated   |                                               |
| `POST /api/finance/invoices`                 | Owner/Administrator | Create from an eligible Sales Order           |
| `POST /api/finance/invoices/:id/issue`       | Owner/Administrator | `DRAFT → ISSUED`                              |
| `POST /api/finance/invoices/:id/void`        | Owner/Administrator | Guarded per §3                                |
| `GET /api/finance/invoices/:id/payments`     | Any authenticated   | Drill-down                                    |
| `GET /api/finance/invoices/:id/credit-notes` | Any authenticated   | Drill-down                                    |
| `GET /api/finance/payments`                  | Any authenticated   | `?customerId=&invoiceId=`                     |
| `GET /api/finance/payments/:id`              | Any authenticated   |                                               |
| `POST /api/finance/payments`                 | Owner/Administrator | Atomic, idempotent, single-invoice allocation |
| `POST /api/finance/payments/:id/void`        | Owner/Administrator | Reverses the cumulative increment             |
| `GET /api/finance/credit-notes`              | Any authenticated   | `?customerId=&invoiceId=`                     |
| `GET /api/finance/credit-notes/:id`          | Any authenticated   |                                               |
| `POST /api/finance/credit-notes`             | Owner/Administrator | Creates `DRAFT`, no side effects yet          |
| `POST /api/finance/credit-notes/:id/issue`   | Owner/Administrator | `DRAFT → ISSUED`, applies the credit          |
| `POST /api/finance/credit-notes/:id/void`    | Owner/Administrator | Reverses if it had been `ISSUED`              |
| `GET /api/finance/receivables/summary`       | Any authenticated   | Org-wide AR aggregate (Overview cards)        |
| `GET /api/finance/receivables/by-customer`   | Any authenticated   | Per-customer AR rows                          |
| `GET /api/finance/receivables/customers/:id` | Any authenticated   | Single customer's balance                     |

## 11. Known Limitations

- **Single-invoice payment allocation.** A payment always settles exactly one invoice
  this sprint. The `PaymentAllocation` join table already supports N invoices per
  payment; extending to multi-invoice allocation or unapplied customer credit is a
  service-layer change only, requiring no schema migration.
  `GET /api/finance/receivables/aging` (Sprint 13, §13) now provides
  Current/1-30/31-60/61-90/90+ buckets — this limitation is about allocation, not aging.
- **`OVERDUE` collapses `PARTIALLY_PAID`.** See §3 — an overdue invoice's status label
  does not distinguish "nothing paid" from "partially paid"; the underlying
  `amountPaid`/`amountOutstanding` figures remain fully accurate regardless.
- **No `CreditNoteItem` line detail** — a single flat `amount` per credit note, even
  when Sprint 11's `CustomerReturn` issues one for a multi-line return (the sum across
  every returned line, not a breakdown).
- **No sophisticated credit management** — no customer credit limits, approval
  workflows, or credit scoring.
- **No Nigerian bank/payment-gateway integration** — Payments are a manual
  record-entry foundation (Cash/Bank Transfer/POS/Other), not a live payment rail.
- **No General Ledger / accounting** — see §9.
- **No full multi-jurisdiction tax engine** — a single configurable default rate,
  overridable per line, snapshotted at invoice creation.
- Invoice eligibility is `SalesOrder.status === 'FULFILLED'` only — Finance cannot
  technically observe Dispatch/Delivery completion (see §2), so an invoice can be
  created before goods are confirmed delivered if a user chooses to.
- No full module-level permission engine — RBAC remains binary
  (Owner/Administrator-write, Member-read), same deferred decision as every other
  domain in this codebase.

## 12. Accounts Payable & Supplier Invoice Management (Sprint 12)

Sprint 12 built the supplier-side mirror of §3's customer-side engine: what a supplier
bills, what's actually owed, and what's been paid — reconciled against what Sprint 8's
Goods Receipt already recognised, never a second, independent liability.

**The central insight.** Goods Receipt already posts `DR Inventory / CR Accounts
Payable` (+ `CR GRNI_PENDING_APPROVAL` for any excess) for the payable portion at
receiving time (accounting.md §9). A Supplier Invoice that matches what was already
recognised needs **no new journal entry** — it only becomes the specific, dated,
numbered document Supplier Payments allocate against, and verifies/caps what it claims
against what Goods Receipt already established. This is why every `SupplierInvoiceItem`
takes exactly one of two paths:

- **Path A** (`goodsReceiptItemId` set) — reconciles against a Goods Receipt line
  already recognised as payable. `recognizedAmount = min(lineTotal, remainingPayable ×
purchaseOrderItem.unitPrice)`, where `remainingPayable` is that line's payable
  quantity minus whatever Sprint 11 Returns already drew from the payable bucket
  specifically, minus what prior invoices already claimed
  (`supplier-invoice-matching.ts`'s `computeLineMatch`). This caps recognition by
  construction — an over-invoice can never inflate AP, it only surfaces a
  `varianceAmount` and flags the header `DISCREPANCY`. No new journal is posted for a
  Path A line: the liability already exists.
- **Path B** (`debitAccountId` set) — no Goods Receipt to reconcile against (a
  PO-less/GR-less bill — freight, a service invoice, anything Procurement never
  tracked). The line names an explicit, user-chosen Chart of Accounts "Debit Account"
  (restricted to non-system `ASSET`/`EXPENSE` types — never a default, never guessed),
  recognised in full. At `post()`, every Path B line on an invoice is grouped by
  account into one balanced `DR <account>(s) / CR Accounts Payable` journal entry per
  invoice (not per line). This is deliberately narrow AP accounting, **not** an
  Expense Management module — no claims, no approvals, no budgeting.

A single invoice may freely mix both kinds of lines (e.g. goods reconciled against a
Goods Receipt plus a freight line coded to a Logistics Expense account on the same
supplier bill).

### Entities

- **`SupplierInvoice`** — `DRAFT → POSTED → {PARTIALLY_PAID → PAID}`, with `OVERDUE`
  (lazy sweep, same convention as `Invoice`) and `VOID` side branches. `DRAFT` is
  freely editable, including a line with neither `goodsReceiptItemId` nor
  `debitAccountId` yet (brief's "no unnecessary restrictions" requirement) — `post()`
  is the one-way transition that resolves every line to exactly one path, computes and
  freezes `matchStatus`/`recognizedAmount`/`varianceAmount`, increments each Path A
  line's `GoodsReceiptItem.invoicedQuantity`, and posts the Path B journal if any.
  `matchStatus` (`UNVERIFIED`/`MATCHED`/`DISCREPANCY`) is derived from Path A lines
  only — a pure-Path-B invoice is `UNVERIFIED`, never "matched" or "in discrepancy"
  (there is nothing to reconcile). Uniqueness is `(supplierId, invoiceNumber)`, never
  global — a supplier's own numbering.
- **`SupplierInvoiceItem`** — `goodsReceiptItemId`/`debitAccountId` (mutually
  exclusive by the time the invoice posts), frozen `recognizedAmount`/`varianceAmount`.
- **`SupplierPayment`/`SupplierPaymentAllocation`** — exact structural mirror of
  `Payment`/`PaymentAllocation`. The over-payment guard bounds against
  `recognizedAmount - amountPaid - amountCredited`, never `total` — this is what makes
  "no overpayment exposure on a discrepant invoice" automatic rather than a special
  case. Posts `DR Accounts Payable / CR Cash-or-Bank`.
- **`SupplierCreditNote`** — a small, dedicated model (not a reuse of `CreditNote`,
  whose `customerId` is a required, non-nullable FK). Mirrors `CreditNote`'s
  `DRAFT → ISSUED → VOID` shape, posts `DR Accounts Payable / CR Inventory` — the
  mirror image of Goods Receipt's own posting.
- **Discrepancy acknowledgement** — `POST /:id/acknowledge-discrepancy` records a
  human sign-off (`discrepancyResolvedAt`/`By`/notes) on a `DISCREPANCY` invoice.
  **Never** changes `recognizedAmount`/AP — no tolerance engine, no auto-resolution.
  Converting GRNI excess into confirmed AP some future sprint may want remains explicit
  deferred work (accounting.md §12.4).

### Accounts Payable Read Model

`AccountsPayableService` mirrors `AccountsReceivableService` exactly — every figure
derived live via `groupBy`/`aggregate` over `SupplierInvoice`/`SupplierPayment`, never
a stored balance. Powers the Payables Overview cards, a per-supplier balance (also
surfacing on the Supplier detail view via [Suppliers](suppliers.md) §6), and a
Purchase Order financial summary (also surfacing on the [Procurement](procurement.md)
PO dialog) that is deliberately blind to received/inventory quantities — Finance never
reads `GoodsReceiptItem`/`InventoryStock` for this figure, Inventory's own Receiving
Summary covers that half.

### Admin Surface

Two new tabs on `/settings/finance/*`: **Payables** (summary cards + Supplier Invoice
list; `SupplierInvoiceDialog` picks a supplier, optionally pulls Path A lines from one
of that supplier's Goods Receipts with a live client-side preview of the
Ordered/Payable/Invoiced/Discrepancy result, and/or adds Path B lines with a Debit
Account picker) and **Supplier Payments** (a flat, read-only ledger + void, mirroring
`payments/page.tsx`). The client-side preview is informational only — `post()` always
recomputes and freezes the authoritative result server-side, same "preview only"
convention `InvoiceDialog` already uses for its own live totals.

### API Reference (Sprint 12)

| Endpoint                                                          | Auth                | Notes                                               |
| ----------------------------------------------------------------- | ------------------- | --------------------------------------------------- |
| `GET /api/finance/supplier-invoices`                              | Any authenticated   | `?status=&supplierId=&purchaseOrderId=&search=`     |
| `GET /api/finance/supplier-invoices/:id`                          | Any authenticated   |                                                     |
| `POST /api/finance/supplier-invoices`                             | Owner/Administrator | Creates `DRAFT` — lines may be incomplete           |
| `PATCH /api/finance/supplier-invoices/:id`                        | Owner/Administrator | `DRAFT` only                                        |
| `POST /api/finance/supplier-invoices/:id/post`                    | Owner/Administrator | `DRAFT → POSTED`, computes/freezes the match result |
| `POST /api/finance/supplier-invoices/:id/acknowledge-discrepancy` | Owner/Administrator | Sign-off only, never changes AP                     |
| `POST /api/finance/supplier-invoices/:id/void`                    | Owner/Administrator | Guarded per lifecycle above                         |
| `GET /api/finance/supplier-payments`                              | Any authenticated   | `?supplierId=&supplierInvoiceId=`                   |
| `POST /api/finance/supplier-payments`                             | Owner/Administrator | Atomic, idempotent, single-invoice allocation       |
| `POST /api/finance/supplier-payments/:id/void`                    | Owner/Administrator | Reverses the cumulative increment                   |
| `GET /api/finance/supplier-credit-notes`                          | Any authenticated   | `?supplierId=&supplierInvoiceId=`                   |
| `POST /api/finance/supplier-credit-notes`                         | Owner/Administrator | Creates `DRAFT`                                     |
| `POST /api/finance/supplier-credit-notes/:id/issue`               | Owner/Administrator | `DRAFT → ISSUED`, applies the credit                |
| `POST /api/finance/supplier-credit-notes/:id/void`                | Owner/Administrator | Reverses if it had been `ISSUED`                    |
| `GET /api/finance/accounts-payable/summary`                       | Any authenticated   | Org-wide AP aggregate (Payables Overview cards)     |
| `GET /api/finance/accounts-payable/by-supplier`                   | Any authenticated   | Per-supplier AP rows                                |
| `GET /api/finance/accounts-payable/suppliers/:supplierId`         | Any authenticated   | Single supplier's balance + recent-activity counts  |
| `GET /api/finance/accounts-payable/purchase-orders/:id`           | Any authenticated   | Single PO's AP rollup (never received/inventory)    |

### Known Limitations (Sprint 12)

- **No automatic GRNI-to-AP reclassification.** A `DISCREPANCY` invoice's excess is
  never automatically moved into confirmed AP — acknowledgement is sign-off only. A
  future sprint may want an explicit `DR GRNI_PENDING_APPROVAL / CR AP` reclassification
  action; not built now (accounting.md §12.4).
- **Single-invoice payment/credit allocation**, same deferred decision as §11's
  customer-side equivalent.
- **No approval workflow** for Path B postings — any Owner/Administrator can post
  against any eligible non-system Asset/Expense account, restricted by account type
  only, not by a configurable policy.
- **No payment runs or automated payment scheduling** — a Payables Overview and a
  flat payment ledger only, matching the brief's own non-goals.
  (`GET /api/finance/accounts-payable/aging`, Sprint 13 §13, added the ageing report
  itself — this limitation now covers scheduling/runs only, not ageing visibility.)
- **No supplier portal/self-service, no payment-gateway integration, no bank
  reconciliation** — Supplier Payments are a manual record-entry foundation, same
  posture as customer-side Payments.

## 13. Financial Statements & Management Reporting (Sprint 13)

Sprint 13 added a read-only reporting layer over the GL/AR/AP/Inventory data §1-12
already produce — a Profit & Loss, a Balance Sheet, AR/AP ageing, an Inventory
Valuation tied back to the GL, and a Management Dashboard. It introduces **no new
transactional writes anywhere in Finance** — every figure is derived from existing
`JournalEntry`/`Invoice`/`SupplierInvoice`/`InventoryStock` rows. Full accounting
mechanics (the normal-balance-sign formula, the computed Retained Earnings treatment,
the Inventory read-only boundary exception, the two-path COGS/Revenue approach) are
documented in [Accounting](accounting.md) §16 — this section covers the Finance-facing
surface only.

### New read endpoints

All under `GET /api/finance/reports/*` plus two additions to the existing AR/AP
controllers, any-authenticated-member readable (no `RolesGuard`), same convention as
every other Finance read endpoint:

| Endpoint                                       | Notes                                                                |
| ---------------------------------------------- | -------------------------------------------------------------------- |
| `GET /api/finance/reports/profit-loss`         | `?from=&to=&accountingPeriodId=&compare=previous_period`             |
| `GET /api/finance/reports/balance-sheet`       | `?asOf=`                                                             |
| `GET /api/finance/receivables/aging`           | `?asOf=` — Current/1-30/31-60/61-90/90+                              |
| `GET /api/finance/accounts-payable/aging`      | `?asOf=` — plus GRNI-pending and discrepancy-count surfacing         |
| `GET /api/finance/reports/inventory-valuation` | `?locationId=&productType=`                                          |
| `GET /api/finance/reports/reconciliation`      | Inventory subledger vs GL — surfaces, never corrects, a difference   |
| `GET /api/finance/reports/revenue` \| `/cogs`  | `?from=&to=` — GL-tied headline + a by-product/by-customer breakdown |
| `GET /api/finance/reports/dashboard`           | `?from=&to=&compare=previous_period`                                 |

### Admin Surface

Three new tabs on `/settings/finance/*`: **Profit & Loss**, **Balance Sheet**,
**Inventory Valuation** — each with a period-preset filter (`report-date-range.ts`),
a Print button (`window.print()`), and clickable account lines opening a new,
reusable `AccountActivityDialog` (Statement → Account → Ledger Activity → Journal
Entry Detail — the drill-down chain now works end-to-end). The Balance Sheet page
also renders the Inventory-to-Ledger Reconciliation result directly beneath its
Inventory asset line. The existing `/settings/finance` Overview page was upgraded in
place into the Management Dashboard (Financial cards, a small Operational section,
two `recharts` bar charts — Revenue vs COGS vs Gross Profit, AR vs AP). Receivables/
Payables pages gained an Ageing section (bucket cards + a per-customer/per-supplier
breakdown table) below their existing list.

### Known Limitations (Sprint 13)

- **No Other-Income/Expense split, no Current-vs-Fixed-Asset distinction** —
  `AccountType` alone drives P&L/Balance Sheet classification (accounting.md §16.1/
  §16.6); every `REVENUE` account is treated as operating revenue, every `EXPENSE`
  account as an operating expense. No account in this codebase's Chart of Accounts
  needs the distinction today.
- **No Revenue trend / time-series endpoint** — the Dashboard's two charts compare
  current-vs-previous-period totals only; a monthly trend line was scoped out as
  requiring a new backend endpoint not yet built.
- **No CSV/Excel export** — Print (`window.print()`) only, on P&L/Balance Sheet/
  Trial Balance. Deferred as a cheap follow-up.
- **No budgeting, forecasting, multi-company consolidation, or configurable KPI
  engine** — explicit non-goals of Sprint 13, unchanged.

## 14. Cash & Bank Management / Reconciliation (Sprint 14)

Sprint 14 connects the General Ledger to the organisation's real-world cash and bank
accounts — full domain writeup in [Cash & Bank Management](cash-management.md);
accounting mechanics in [Accounting](accounting.md) §17. Summary of the
Finance-facing surface:

- **`CashAccount`** — an actual place money is held (a bank account, a petty cash
  drawer, a POS settlement account), each linked to its own dedicated, system-
  provisioned Chart of Accounts row — never the generic `CASH`/`BANK` system
  accounts every `Payment`/`SupplierPayment` posted against pre-Sprint-14. An
  optional opening balance posts atomically with the account's own creation.
  `accountNumber` is stored in full but only ever returned masked
  (`accountNumberMasked`); the full value is available only via a separate,
  Owner/Administrator-only reveal endpoint, and is never written into any audit
  `metadata` payload.
- **`Payment`/`SupplierPayment` gained an optional `cashAccountId`** — reused, not
  duplicated: when supplied, the existing posting logic targets that specific
  account's own Chart of Accounts row instead of the generic `CASH`/`BANK` system
  account resolved from `method`. Fully backward-compatible — omitting it preserves
  the exact pre-Sprint-14 behaviour, so no existing flow or test needed to change.
- **`CashTransaction`** — a controlled mechanism for cash movements outside the
  existing Payment/Supplier Payment flows (a bank charge, a petty cash payment, a
  miscellaneous receipt), posting against an explicit, user-chosen, non-system
  Chart of Accounts "Contra Account" — the same Path B policy Supplier Invoices
  (Sprint 12) already established. Customer/supplier payments continue to use their
  own existing workflows unchanged.
- **Bank Statement Import** — manual entry via a CSV upload, with a client-side
  column-mapping step (`Transaction Date`/`Description`/`Debit`/`Credit`/
  `Reference`/etc. → Zentuva fields) since not every bank exports the same columns.
  The backend independently re-validates and deduplicates every row (a content
  hash plus, where supplied, a stable external reference) — never trusting
  client-side parsing/validation alone.
- **Reconciliation** — a session for one `CashAccount` over one bank-statement
  period, showing Matched / Unmatched Bank / Unmatched Book panels and a live
  Book-Balance-vs-Bank-Statement-Balance Difference. A bulk "Auto-match Exact"
  action matches only unambiguous same-date/same-amount pairs; anything else is
  matched manually, one pair at a time. `complete()` is blocked while any bank or
  book item remains unmatched — never a silent "force the books to equal the
  bank." Once `COMPLETED`, a session is immutable; reopening one is explicit
  deferred work —
  see [Cash & Bank Management](cash-management.md) §10.
- **Book Balance vs Reconciled Balance vs Unreconciled Difference** — the central
  UX distinction (brief-driven): Book Balance is always live from the General
  Ledger (`LedgerService.getAccountActivity`, unchanged since Sprint 7/13);
  Reconciled Balance is the most recent `COMPLETED` session's own
  `closingBankBalance`; Unreconciled Difference is simply their gap. None of the
  three is ever labelled "available cash."

### Admin Surface

Five new tabs on `/settings/finance/*`: **Cash Overview** (the Cash Position
Dashboard — Total Cash, Bank Balances, Cash on Hand, Unreconciled, Recent
Transactions, Accounts Requiring Reconciliation), **Cash Accounts** (list + a full
detail page per account, not a dialog — Book/Reconciled/Unreconciled strip, masked
number + reveal, recent activity, reconciliation history, statement imports),
**Cash Transactions**, **Bank Statements** (the CSV import wizard), and
**Reconciliation** (session list + a matching workspace per session). The existing
Sprint 13 Management Dashboard gained two small cross-link cards (Total Cash,
Unreconciled) rather than being folded into a second, busier dashboard.

### API Reference (Sprint 14)

See [Accounting](accounting.md) §24 for the full endpoint table (`/finance/cash/
accounts`, `/finance/cash/transactions`, `/finance/cash/bank-statements/*`,
`/finance/cash/reconciliations/*`, `/finance/cash/overview`).

### Known Limitations (Sprint 14)

- **No field-level encryption for `accountNumber`** — stored in full, masked at the
  API response layer only. No crypto-at-rest infrastructure exists anywhere else in
  this codebase to build on; documented as a known hardening gap, not a security
  guarantee this sprint claims to provide.
- **No reopening a completed reconciliation** — a correction happens via a new
  `CashTransaction`/journal entry handled in a later session.
- **No bank API integration, Open Banking, or automatic bank connections** — manual
  entry and CSV import only, per the brief's own explicit non-goal.
- **No loan management, debt management, investment management, capital planning,
  or cashflow forecasting** — this sprint is deliberately only the foundation those
  future capabilities would build on (a `CashAccount`/Chart-of-Accounts link and the
  `accountId`-based posting mechanism already support a future `DR Bank / CR Loan
Liability`-style entry without further schema change).
- **No CSV export of reconciliation results, and no multi-currency treasury
  engine** — `CashAccount.currency` is a plain string per account, not a converting
  engine.
- **Reconciliation matching is intentionally simple** — a single deterministic
  same-date/same-amount bulk auto-match plus fully manual matching, never a
  confidence-scored suggestion engine. `ReconciliationMatch.confidenceScore` exists
  as an unused, future-proofing column only.

## 15. Cashflow Management & Forecasting (Sprint 15)

Sprint 15 adds a forward-looking, forecast-only layer on top of the Finance data
already recorded — full domain writeup in [Cashflow](cashflow.md); accounting
mechanics (or rather, the deliberate lack of any) in [Accounting](accounting.md)
§20. This is explicitly **not** budgeting and never posts a journal entry.
Summary of the Finance-facing surface:

- **The forecast is never stored** — `GET /finance/cashflow/forecast` recomputes
  Opening Cash + Inflows − Outflows = Closing Cash live, every request, from
  outstanding AR/AP (Sprint 13's own `getOutstandingForAging()` queries, reused
  unmodified), Cash Account Book Balances (Sprint 14), and management-entered
  `CashflowForecastItem`s.
- **`CashflowForecastItem`** — one model for both a one-time known commitment
  (e.g. a planned equipment purchase) and a recurring item (e.g. monthly rent),
  distinguished by a `recurrence` enum. `sourceType` is server-derived, never a
  user choice.
- **Confidence classification** — server-derived, never AI/ML: an outstanding
  customer invoice is `CONFIRMED`, an outstanding supplier invoice or a
  recurring item is `EXPECTED`, a manual one-time item is `ESTIMATED`.
- **`CashflowScenario`** — Base/Conservative/Optimistic-style named sets of a
  delay-days-plus-multiplier adjustment, applied on top of the base forecast.
  Configurable knobs only, never a predictive model.
- **`CashflowForecastAdjustment`** — lets an authorized user override a single
  AR/AP item's expected date/amount for forecasting purposes only. The
  underlying `Invoice`/`SupplierInvoice` is never written to — proven both by
  `cashflow-independence.spec.ts` and by live verification (the original
  invoice's total was confirmed unchanged after saving an adjustment).
- **Minimum Cash Reserve / shortfall detection** — a configurable,
  management-defined threshold; a period projected below it is flagged, worded
  throughout as a planning signal ("projected cash is below the
  management-defined safety threshold"), never a claim of insolvency.
- **Cash-account-level forecast** — a consolidated (org-wide) view and a
  per-account view are genuinely different computations, never one query that
  could imply money moves between accounts; AR/AP is excluded from any single
  account's own view since neither carries a `cashAccountId` until actually
  collected or paid.

### Admin Surface

Three new tabs on `/settings/finance/*`: **Cashflow** (the forecast dashboard —
horizon/bucket/scenario selectors, a shortfall warning banner, summary cards, a
closing-balance-vs-minimum-reserve chart, an inflows-vs-outflows chart, a
click-to-expand per-period table with inline source-item drill-down and an
"Adjust" action on AR/AP rows, and a cash-account breakdown), **Cashflow
Items** (management-entered commitments + the Cashflow Settings card), and
**Cashflow Scenarios**.

### API Reference (Sprint 15)

See [Accounting](accounting.md) §24 for the full endpoint table (`/finance/
cashflow/settings`, `/finance/cashflow/items`, `/finance/cashflow/scenarios`,
`/finance/cashflow/adjustments`, `/finance/cashflow/forecast`, `/finance/
cashflow/accounts/breakdown`).

### Known Limitations (Sprint 15)

- **No caching of any kind** — the forecast is recomputed on every request, per
  the brief's own "no premature caching" instruction; very large outstanding-
  invoice volumes would repeat this cost on every call.
- **Per-account forecasts exclude AR/AP** — documented, not silently guessed
  (see [Cashflow](cashflow.md) §8).
- **No loan/debt/investment/capital management, budgeting, budget-vs-actual,
  AI/ML forecasting, credit scoring, expense management, payroll, bank API/
  Open Banking/payment gateway integration, treasury management, or advanced
  financial modelling** — explicit non-goals of Sprint 15, unchanged. Budgeting
  and budget-vs-actual were built the very next sprint — see §16.

## 16. Budgeting & Financial Planning (Sprint 16)

Sprint 16 adds a planning layer on top of the primitives above — full domain
writeup in [Budgeting](budgeting.md); accounting mechanics (or rather, the
deliberate lack of any) in [Accounting](accounting.md) §23. Summary of the
Finance-facing surface:

- **A `Budget` never becomes a second accounting system.** `Budget`/
  `BudgetLine` hold only planned amounts; "actual" is always a live read of
  posted `JournalEntryLine` rows via the exact same normal-balance-sign
  convention Sprint 13's `FinancialStatementService` already established.
- **A `Budget` row is its own version _and_ its own scenario** — no separate
  `BudgetVersion`/`BudgetScenario` tables. Revising creates a new sibling row
  (`version+1`, `revisesBudgetId` set) that copies every current line;
  activating it supersedes the row it replaces. A scenario (e.g. "Growth") is
  a sibling sharing the same `budgetCode`, never touching another scenario's
  lines.
- **`BudgetLine` — Revenue, Operating Expense, and CAPEX.** `chartOfAccountId`
  is required for Revenue/OpEx (a real GL row to compare against) and
  optional for CAPEX (no seeded Fixed Asset account exists yet). One unique
  constraint gives both "one line per account+month" upsert behaviour and
  unlimited discrete CAPEX items, for free, via Postgres's own NULL
  semantics.
- **Budget vs Actual** — one scoped `JournalEntryLine` query per budget,
  bucketed in application code, converted to a signed actual per
  `AccountType`, with a null-safe variance percent and a per-line-type
  favourable/unfavourable flag.
- **Budget vs Forecast** — genuinely reuses Sprint 15's own
  `CashflowForecastService`, never a duplicated engine; a budget's own
  optional pairing with a Sprint 15 `CashflowScenario` flows straight
  through.
- **Cost Centres** — a small, standalone tag a Budget Line may optionally
  attach itself to, never linked to the Chart of Accounts.

### Admin Surface

Two new tabs on `/settings/finance/*`: **Budgets** (list + an Overview strip
sourced from the currently `ACTIVE` budget's own Budget vs Actual, + a create
dialog) and **Cost Centres**. Budget detail is its own page
(`/settings/finance/budgets/[id]`, not a tab) — status-gated lifecycle
actions, a monthly grid per line type (editable while `DRAFT`), a CAPEX
section, Budget vs Actual, Budget vs Forecast (a chart + shortfall table),
and a Scenario Comparison table when siblings exist.

### API Reference (Sprint 16)

See [Accounting](accounting.md) §24 for the full endpoint table (`/finance/
budgets`, `/finance/budgets/:id/lines`, `/finance/budgets/:id/vs-actual`,
`/finance/budgets/:id/vs-forecast`, `/finance/cost-centres`).

### Known Limitations (Sprint 16)

- **CAPEX items with no linked account can't be compared against actuals** —
  a documented consequence of no Fixed Assets module existing yet.
- **The Budgets Overview page sources from a single `ACTIVE` budget** —
  aggregating across multiple simultaneously-active budgets is left for a
  future iteration.
- **No loan/debt/investment/capital management, AI/ML financial planning,
  payroll, expense management, tax management, or procurement-commitment
  budgeting** — all explicit non-goals of Sprint 16, unchanged.
