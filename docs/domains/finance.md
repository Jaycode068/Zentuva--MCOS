# Finance Domain

- **Status:** Foundation implemented — Sprint 6 ("Finance Foundation"). **Not** a General
  Ledger / accounting system — see §9.
- **Sprint:** 6
- **Depends on:** [Identity](identity.md) (tenant boundary, `RolesGuard`,
  `OrganisationService` for the currency snapshot), [Sales](sales.md)
  (`SalesOrderRepository`, read-only, via `SalesModule`'s existing export),
  [Customers](customers.md), [Outlets](outlets.md).
- **Explicitly does not depend on:** [Inventory](inventory.md),
  [Distribution](distribution.md) — see §2.
- **See also:** [Sprint 6 Completion Report](../sprint-6-completion-report.md).

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
narrow widths, full tables on wide), not a redesigned mobile-first flow. Five routes,
each rendering a shared bespoke `FinanceTabs` component (no generic `Tabs` primitive
exists in this codebase; `FinanceTabs` follows the exact precedent already set by
`AccountTabs`): Overview (`/settings/finance`), Invoices, Payments, Receivables, Credit
Notes. Invoice creation is a two-step dialog (pick an eligible Sales Order → the invoice
form, with live client-side preview totals that are never trusted on submit); the
Invoice detail dialog nests "Record Payment" and "Issue Credit Note" as their own
dialogs, mirroring Distribution's `DispatchDetailDialog` → `DeliveryDialog` composition.

## 8. RBAC / Tenant Isolation / Audit

Same conventions as every other domain — `RolesGuard`, Owner/Administrator write, Member
read-only (enforced server-side only; the frontend does not hide write actions from
Member, consistent with every other domain's existing convention), tenant-scoped
repository methods, cross-tenant access returns 404 (not a data leak) on direct-by-id
reads and 403 on writes. Audit actions: `invoice.created`, `invoice.issued`,
`invoice.voided`, `payment.recorded`, `payment.voided`, `credit-note.created`,
`credit-note.issued`, `credit-note.voided`. A replayed idempotent create
(`wasCreated === false`) never emits a second audit event.

## 9. Deferred Accounting Work — This Is Not the General Ledger

Sprint 6 is a financial **record-entry foundation**, not an accounting system. The
following are explicitly out of scope and deferred to future sprints: Chart of
Accounts, Journal Entries, General Ledger, Trial Balance, Profit & Loss, Balance Sheet,
Cash Flow Statement, Bank Reconciliation, payroll, fixed assets, a full multi-
jurisdiction tax engine, sophisticated customer/distributor pricing, credit scoring,
Nigerian bank/payment-gateway integration, advanced financial analytics, budgeting, and
financial forecasting.

Today's financial events are, however, shaped so a future General Ledger sprint could
generate journal entries from them without a Finance rewrite: a `payment.recorded`
event carries everything a future posting rule would need (amount, currency, method,
the invoice it settled) to eventually generate `Debit Bank/Cash, Credit Accounts
Receivable`; `invoice.issued` carries what a future rule would need to generate `Debit
Accounts Receivable, Credit Revenue`. No GL posting logic exists yet — this is a design
note for future integration, not an implemented feature.

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
- **`OVERDUE` collapses `PARTIALLY_PAID`.** See §3 — an overdue invoice's status label
  does not distinguish "nothing paid" from "partially paid"; the underlying
  `amountPaid`/`amountOutstanding` figures remain fully accurate regardless.
- **No `CreditNoteItem` line detail** — a single flat `amount` per credit note.
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
