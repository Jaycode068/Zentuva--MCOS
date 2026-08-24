# Sprint 6 Completion Report — Finance Foundation

## 1. Objective

Build the first production-grade Finance domain — Invoices, Payments (with
partial-payment support), Credit Notes, Accounts Receivable, Payment Terms, and a
minimal tax foundation — as a clean, extensible foundation. Explicitly **not** a
complete accounting system: no Chart of Accounts, Journal Entries, General Ledger,
Trial Balance, Profit & Loss, Balance Sheet, or Bank Reconciliation this sprint.

**Business problem:** every domain through Sprint 5 (Sales → Fulfilment → Dispatch →
Delivery) records that goods moved, but nothing recorded the financial consequence —
what a customer was billed, what they've paid, what they still owe. Sales owns
Customers/Outlets/Sales Orders; Finance must consume that read-only and never become
responsible for physical inventory, dispatch, or delivery, and must not automatically
invoice a confirmed order — invoicing is a deliberate, separate Finance-owned action.

## 2. Architecture Decisions

| Decision                                 | Choice                                                                                                                                          | Why                                                                                                                                                                             |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Invoice eligibility gate                 | `SalesOrder.status === 'FULFILLED'` only — nothing about Dispatch/Delivery status                                                               | Finance cannot import `DistributionModule` without violating its own "no tight coupling to every operational module" rule; `FULFILLED` is the only technically-reachable signal |
| Payment Terms modelling                  | A closed `PaymentTermType` enum (`CASH`/`DUE_ON_RECEIPT`/`NET_7`/`NET_14`/`NET_30`), not a table                                                | Matches every other closed status-set in this codebase; no sophisticated credit-management engine this sprint                                                                   |
| Payment → Invoice allocation             | `Payment` (customer-scoped, no `invoiceId` FK) + a `PaymentAllocation` join table                                                               | The brief requires the schema support future multi-invoice allocation _without rewriting `Payment`_ — the join table costs nothing now and needs zero migration later           |
| Money precision                          | Prisma `Float` throughout, per-file `roundCurrency()` helper — same as `SalesOrder`/`PurchaseOrder`                                             | This codebase has never used `Decimal`; introducing it for Finance alone would be an unprecedented, unjustified deviation                                                       |
| Header-level `Invoice.taxRate`           | **Not stored** — only `InvoiceItem.taxRate`/`taxAmount` exist, per line                                                                         | A header rate would drift from per-line reality the moment two lines carry different rates                                                                                      |
| `amountOutstanding`                      | **Never stored** — derived as `total - amountPaid - amountCredited` at every read site                                                          | Every input is already a durable column; no strong architectural reason to duplicate it                                                                                         |
| `Payment.currency`/`CreditNote.currency` | Server-derived from the target Invoice's own snapshotted currency, never client input                                                           | A payment/credit-note can only ever apply to one currency — its target invoice's                                                                                                |
| `OVERDUE` transition                     | A lazy sweep inside `InvoiceRepository`'s own read methods (`updateMany` before every read)                                                     | No cron/scheduler infrastructure exists anywhere in this codebase; keeps `status` genuinely authoritative without background-job infrastructure                                 |
| Credit Note line items                   | **Not implemented** — a single flat `amount`, no `CreditNoteItem`                                                                               | Matches the brief's explicit "lightweight foundation" framing and its own flat-amount worked example                                                                            |
| AR aggregation                           | `prisma.invoice.groupBy`/`.aggregate()`, never `findMany` + JS reduction                                                                        | The idiomatic cross-entity reporting pattern in this codebase (`InventoryTransactionRepository.getLastMovementByProduct`, `GoodsReceiptRepository.getReceivingTotals`)          |
| Tax default                              | A configurable `finance.defaultTaxRatePercent` (env `FINANCE_DEFAULT_TAX_RATE_PERCENT`, default `7.5`), applied only when a line omits its rate | Never hardcoded into calculation logic; whatever rate is used is permanently snapshotted, never recomputed later                                                                |
| Repository-level unit tests              | A deliberate exception: `payment.repository.ts`/`credit-note.repository.ts` get narrow specs using an in-memory fake `$transaction`             | No test-DB/env-loading infrastructure exists in this codebase; money correctness at exact boundary values is worth the deviation                                                |
| RBAC                                     | Every write `@Roles('Owner','Administrator')`; every `GET` auth-only                                                                            | Reuses `RolesGuard` exactly as-is, per the brief's "no new permission engine yet"                                                                                               |

## 3. Backend Implementation

### Schema (`apps/api/prisma/schema.prisma`, migration `20260823224540_add_finance_foundation`)

- Five new enums: `PaymentTermType`, `InvoiceStatus`, `PaymentMethod`, `PaymentStatus`,
  `CreditNoteStatus`.
- New `Invoice`: `invoiceCode` (`@unique`), `customerId`/`outletId`/`salesOrderId` (FK
  `Restrict`), `invoiceDate`, `dueDate`, `paymentTerms`, `status`, `currency`,
  `subtotal`/`discount`/`taxAmount`/`total`, `amountPaid`/`amountCredited @default(0)`
  (cumulative), `notes`, `idempotencyKey`
  (`@@unique([salesOrderId, idempotencyKey])`, a double-submit guard only — the "no
  multiple invoices per order" business rule is a service-level check, not a schema
  constraint, so future partial invoicing needs no migration).
- New `InvoiceItem`: snapshots `productCode`/`productName`/`unitPrice`/`quantity`/
  `discount`/`taxRate`/`taxAmount`/`lineTotal`, referencing `salesOrderItemId` for
  traceability.
- New `Payment`: `customerId` (no `invoiceId`), `paymentDate`, `amount`, `currency`,
  `method`, `reference`, `notes`, `status`, `idempotencyKey`
  (`@@unique([customerId, idempotencyKey])`).
- New `PaymentAllocation`: `paymentId`, `invoiceId` (FK `Restrict`), `amount`.
- New `CreditNote`: `creditNoteCode` (`@unique`), `customerId`, `invoiceId` (nullable,
  FK `Restrict`), `reason`, `amount`, `currency`, `status`, `creditNoteDate`, `notes`,
  `idempotencyKey` (`@@unique([invoiceId, idempotencyKey])`).
- Back-relations added to `Organisation`, `Customer`, `Outlet`, `SalesOrder`,
  `Product`, `SalesOrderItem`.
- Purely additive migration — applied cleanly against the populated dev database.

### New files (`apps/api/src/finance/`)

- `invoice.repository.ts` — `create()`, `findById`/`findManyByOrganisation` (both call
  private `sweepOverdue()` first), `findManyBySalesOrderExcludingVoid()`,
  `existsByCode()`, `updateStatus()`, `getArByCustomer()`, `getArSummary()`,
  `sumInvoicedBetween()`. Exports `PAYABLE_INVOICE_STATUSES`.
- `invoice.service.ts` — `getById`/`list`/`listEligibleSalesOrders()`/`create()`
  (validates `FULFILLED`+no-duplicate-invoice, snapshots items, computes every total
  server-side, computes `dueDate`)/`issue()`/`void()`/`generateUniqueCode()`
  (`INV-` collision loop).
- `invoice.controller.ts` — 7 routes incl. drill-downs into Payment/CreditNote.
  Exports `toInvoiceResponse()`.
- `payment.repository.ts` — `create()` (the full atomic transaction — see §2),
  `void()`, `findById`/`findManyByOrganisation`/`sumRecordedBetween()`. Exports
  `OverPaymentError`/`PaymentInvoiceConflictError`/`PaymentAlreadyVoidedError`, and
  the shared `deriveInvoiceStatusAfterApplication`/`deriveInvoiceStatusAfterReversal`
  helpers `credit-note.repository.ts` also imports.
- `payment.service.ts`/`payment.controller.ts` — mirrors `invoice.*`'s three-part
  pre-check/delegate/catch pattern.
- `credit-note.repository.ts` — `create()` (plain, `DRAFT`, no side effects),
  `issue()` (the atomic apply-to-invoice step, mirrors `payment.repository.ts`),
  `void()`. Exports `OverCreditError`/`CreditNoteInvoiceConflictError`/
  `CreditNoteStateError`/`CreditNoteNotFoundError`.
- `credit-note.service.ts`/`credit-note.controller.ts`.
- `accounts-receivable.service.ts`/`accounts-receivable.controller.ts` — read-only,
  `groupBy`/`.aggregate()`-based.
- `finance-audit-actions.ts`, `finance.module.ts` (imports
  `IdentityModule`/`AuthModule`/`SalesModule`/`CustomerModule`/`OutletModule` only —
  no `exports`).
- `finance-independence.spec.ts` — the structural guard (see §2 of `finance.md`).
- 10 spec files (see §5).

### Modified files

- `apps/api/src/app.module.ts` — `FinanceModule` registered after `DistributionModule`.
- `apps/api/src/config/configuration.ts`/`env.validation.ts` —
  `finance.defaultTaxRatePercent` / `FINANCE_DEFAULT_TAX_RATE_PERCENT`.
- `packages/validation/src/finance.ts` (new) — all enum schemas, `createInvoiceSchema`,
  `voidInvoiceSchema`, `createPaymentSchema`, `createCreditNoteSchema` — the latter two
  deliberately have no `currency` field (server-derived, see §2).
- `apps/api/prisma/seed.ts` — new customer `CUS-000013` "ABC Supermarket" + outlet
  `OUT-000010`; new Sales Orders `SO-000012`/`SO-000013` (500× PRD-000027 @ ₦5,000
  each) + matching fulfilments; a new `seedFinanceStockTopUp()`; a new `seedFinance()`
  helper writing 4 invoices/3 payments/1 credit note directly via `$transaction`
  (bypassing the services, same convention `seedDispatchesAndDeliveries` established):
  `INV-000001` (PAID, two payments summing to ₦2,500,000), `INV-000002`
  (`PARTIALLY_PAID`, ₦1,000,000 paid + `CN-000001` ₦250,000 credit, ₦1,250,000
  outstanding), `INV-000003` (backdated, demonstrates the `OVERDUE` lazy sweep),
  `INV-000004` (issued, not yet due, demonstrates the 7.5% tax default). Also fixed
  `organisation.upsert` to set `currency: 'NGN'` explicitly in both `create` and
  `update` blocks (the live dev DB already had `NGN` set via an earlier manual Settings
  update — the seed script itself needed the explicit fix for a fresh DB/CI run to be
  correct too).

## 4. Frontend Implementation

`apps/web/src/app/(app)/settings/finance/` — `api.ts` (all Finance REST calls),
`labels.ts` (status/method/term label+variant maps), `page.tsx` (Overview: 4 summary
cards from `GET /receivables/summary`), `invoices/page.tsx` (list, search/status
filter, desktop table/mobile card), `invoices/invoice-dialog.tsx` (two-step create:
pick an eligible Sales Order → the invoice form, live client-side preview totals never
trusted on submit), `invoices/invoice-detail-dialog.tsx` (full detail + status-
conditional actions, nesting `payment-dialog.tsx`/`credit-note-dialog.tsx`),
`payments/page.tsx` (flat ledger with Void action), `receivables/page.tsx` (AR by
customer, sortable), `credit-notes/page.tsx` + `credit-note-detail-dialog.tsx` (list +
independent Issue/Void detail view for reviewing a credit note outside the invoice
detail flow).

New shared files: `apps/web/src/components/app/finance-tabs.tsx` (`FinanceTabs`, an
exact clone of the existing `AccountTabs` precedent — no generic `Tabs` primitive
exists in this codebase); `apps/web/src/lib/format-currency.ts` (the first
currency-formatting helper in this codebase that isn't hardcoded to one currency).

Nav fixes: `navigation-config.ts`'s Finance entry corrected from the placeholder
`href: '/finance'` (with `comingSoon: true`) to `href: '/settings/finance'` (no
`comingSoon`); `workspace/page.tsx`'s `MODULE_DESCRIPTIONS` key corrected to match.

## 5. Testing

- `invoice.service.spec.ts` (24 tests), `payment.service.spec.ts` (15),
  `credit-note.service.spec.ts` (13), `accounts-receivable.service.spec.ts` (4),
  `invoice.controller.spec.ts`/`payment.controller.spec.ts`/
  `credit-note.controller.spec.ts` (12 combined), `finance-independence.spec.ts` (5) —
  all mocking the repository at its public-method boundary, matching this codebase's
  standard convention.
- **Deliberate exception**: `payment.repository.spec.ts` (10)/
  `credit-note.repository.spec.ts` (9) exercise the real atomic-transaction code
  against an in-memory fake `$transaction` (no test-DB infrastructure exists in this
  codebase) — covering the concurrent-double-payment race and exact over-payment/
  over-credit boundary values.
- Coverage highlights: invoice creation happy path/tax-default/each-non-`FULFILLED`-
  status-rejected/duplicate-invoice-rejected/due-date-per-payment-term (`it.each`
  across all 5 terms); payment partial/final-landing-`PAID`/over-payment-rejected at
  the exact `+0.01` boundary/exact-boundary-allowed-at-`0`/each-ineligible-status-
  rejected/idempotent-replay/void-reverses; credit-note mirrored shape; AR
  per-customer computation+sort/zero-floor/tenant-scoping of every aggregate call;
  RBAC and audit-fires-only-on-`wasCreated` for every controller.
- **Full suite:** 53 test suites, 557 tests, all passing. `tsc --noEmit` clean on both
  `apps/api` and `apps/web`. `eslint` clean on every touched file. Production builds
  (`nest build`, `next build`) both succeed.

## 6. Live Verification Performed

Against the actual running application (API on :4000, Web on :3000), not just unit
tests:

1. **Overview cards** — Total Outstanding (₦3,038,800.00), Overdue (₦2,970,000.00,
   correctly including a `PARTIALLY_PAID` invoice whose due date had lapsed — proving
   the lazy sweep also promotes `PARTIALLY_PAID` to `OVERDUE`), Invoiced This Period
   (₦5,068,800.00), Payments Received (₦3,500,000.00) — all independently recomputed
   by hand against the seed data and matched exactly.
2. **Scenario 1 (full payment)** — `INV-000001` displayed `PAID`, ₦0 outstanding.
3. **Scenario 2 (partial payment + credit note)** — `INV-000002` displayed
   `PARTIALLY_PAID` → `Overdue` (due date lapsed same day, `DUE_ON_RECEIPT`), Amount
   Paid ₦1,000,000, Amount Credited ₦250,000, Outstanding ₦1,250,000, with `CN-000001`
   visible in its Credit Notes history. Recorded a live final payment of ₦1,250,000
   (exact-boundary amount) — invoice flipped to `PAID`, ₦0 outstanding; Accounts
   Receivable's ABC Supermarket row correctly showed ₦0 outstanding afterward.
4. **Full new-invoice creation flow, live** — picked the one eligible Sales Order
   (`SO-000008`, Bodija Wholesale Hub, ₦15,000), created `INV-000005` (server-computed
   total ₦16,125.00 exactly matching the client preview), issued it, recorded a
   ₦10,000 partial payment (correctly displayed `Overdue` — `DUE_ON_RECEIPT` due date
   already lapsed by afternoon), then the remaining ₦6,125 — landed on `PAID`, ₦0
   outstanding, and stayed `PAID` (excluded from the sweep) even past due.
5. **Over-payment guard** — attempting ₦2,000,000 against a ₦1,250,000 outstanding
   balance was rejected client-side with the exact message; the submit button
   remained disabled.
6. **RBAC** — logged in as Member: every `GET` succeeded (invoice list rendered);
   a direct `POST /api/finance/payments` call returned `403 Forbidden` with the exact
   "You do not have permission to perform this action" message. The Create/Record
   Payment buttons remain visible to Member (consistent with every other domain's
   existing convention of server-only RBAC enforcement, no frontend hiding).
7. **Tenant isolation** — minted a valid access token for a real user in a second
   organisation (Sahara Textiles) and confirmed: `GET /finance/invoices` returned an
   empty list (no Boby Bites data), a direct `GET` of a real Boby Bites invoice id
   returned `404 Invoice not found` (no data leak), and a `POST .../void` against it
   returned `403`.
8. **Audit trail** — queried the database directly after the live flow above and
   confirmed exactly one `invoice.created`, one `invoice.issued`, and two
   `payment.recorded` rows, each correctly scoped to the acting user — no double-
   logging on any step.
9. **Credit Note detail view** — opened `CN-000001` from the standalone Credit Notes
   list (independent of the Invoice detail dialog's combined create+issue flow);
   detail view correctly showed Customer/Invoice/Date/Amount/Reason and offered
   "Void" for an `ISSUED` note.
10. **Responsive check (375px mobile)** — Invoices/Payments/Receivables/Credit Notes
    all render as card lists with no horizontal overflow and no overlap; `FinanceTabs`
    wraps cleanly at narrow widths.
11. **Workspace dashboard** — confirmed Finance shows its real description (not
    "Coming Soon") and, after the bug fix in §7, Distribution does too.

## 7. Bugs Found and Fixed During This Sprint

- **`workspace/page.tsx`'s `MODULE_DESCRIPTIONS` map never gained a
  `/settings/distribution` entry when Distribution shipped in Sprint 5.** The
  Workspace dashboard's Platform Modules grid silently fell back to "Coming soon." for
  a module that had been fully live for a full sprint — a pre-existing bug from
  Sprint 5, not introduced this sprint, but caught during this sprint's own live
  verification pass over the whole Workspace dashboard. Fixed by adding the missing
  entry with a real description.
- **`PaymentDialog`/`CreditNoteDialog` were missing the `max-h-[75vh] overflow-y-auto`
  wrapper** every other multi-field Finance dialog (`InvoiceDialog`,
  `InvoiceDetailDialog`) already applies. On a reduced-height viewport their
  Cancel/Submit footer buttons rendered outside the fixed-height `Dialog` panel with
  no way to scroll to them — caught live while recording the first test payment.
  Fixed by applying the same scroll wrapper to both dialogs' `<form>` elements.
- **`payments/page.tsx`/`receivables/page.tsx` had no mobile card view.** Unlike
  `invoices/page.tsx`/`credit-notes/page.tsx`, which both follow this sprint's own
  established desktop-table/mobile-card responsive split, these two only rendered a
  horizontally-scrolling table at every width — caught during the mobile
  responsiveness pass at 375px. Fixed by adding the matching card layout to both,
  mirroring the pattern already used elsewhere in the same sprint.
- A production build run mid-session against a live `next dev` server corrupted the
  dev server's `.next` chunk manifest (a Next.js dev/build coexistence issue, not an
  application bug) — resolved by restarting the dev server; noted here only because
  it interrupted live verification twice and is worth remembering for future sprints.

## 8. Known Limitations

See `docs/domains/finance.md` §11 for the full list. Highlights: single-invoice
payment allocation only (the schema already supports multi-invoice allocation with no
migration); `OVERDUE` status collapses `PARTIALLY_PAID` once a due date lapses (the
underlying paid/outstanding figures remain fully accurate); no `CreditNoteItem` line
detail; no credit-management engine; no Nigerian bank/payment-gateway integration; no
full multi-jurisdiction tax engine; invoice eligibility is `FULFILLED`-only since
Finance cannot technically observe Dispatch/Delivery completion.

## 9. Deferred / Future Work — Not the General Ledger

Chart of Accounts, Journal Entries, General Ledger, Trial Balance, Profit & Loss,
Balance Sheet, Cash Flow Statement, Bank Reconciliation, payroll, fixed assets, a full
tax engine, sophisticated customer/distributor pricing, credit scoring, Nigerian
bank/payment-gateway integration, advanced financial analytics, budgeting, and
financial forecasting. Today's financial events (`payment.recorded`, `invoice.issued`)
are shaped so a future General Ledger sprint could generate journal entries from them
without a Finance rewrite — see `docs/domains/finance.md` §9. See `docs/backlog.md`
Epic 16.

## 10. Documentation Updated

New `docs/domains/finance.md`, this completion report. Updated: `docs/domains/README.md`,
`docs/backlog.md` (new Epic 16 + Epic 7's stale status paragraph reconciled),
`docs/roadmap.md`, `docs/changelog.md`, `docs/domains/sales.md` (its own stale "No
invoicing, payments, or accounts-receivable integration" Known-Limitations bullet
reconciled to point at Finance).

## 11. Constraint

Nothing in this sprint was committed or pushed, per the explicit instruction carried
through the brief. All changes remain in the working tree, pending explicit
instruction from the user to commit.
