# Sprint 12 Completion Report — Accounts Payable & Supplier Invoice Management

## 1. Objective

Build the Supplier Invoice / Accounts Payable foundation on top of what Sprints 1-11
already established, governed by one central rule the brief states repeatedly:
**never let a Supplier Invoice silently inflate what's owed.** Sprint 8 already posts
`DR Inventory / CR Accounts Payable` (+ `CR GRNI_PENDING_APPROVAL` for any excess) at
Goods Receipt time — the moment goods are physically accepted, not the moment the
supplier's paperwork arrives. A Supplier Invoice's job is to become the specific,
dated, numbered document Supplier Payments allocate against, and to reconcile what it
claims against what Goods Receipt already recognised — surfacing a discrepancy, never
hiding one inside an inflated payable balance.

```
Purchase Order (ordered) → Goods Receipt (accepted, payable) → Supplier Invoice (billed) → Accounts Payable (owed)
                                        ↑                              ↓
                                        └──── capped, never exceeded ──┘
```

## 2. Architecture Decisions

| #   | Question                                    | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Module home                                 | `SupplierInvoice`/`SupplierPayment`/`SupplierCreditNote`/`AccountsPayableService` all live inside `FinanceModule` — AP is Finance's domain, mirroring where AR lives. `FinanceModule` gained two new read-only imports (`SupplierModule`, `PurchaseOrderModule`, via their exported repositories) — same ADR-002 shape as its existing `SalesModule`/`CustomerModule`/`OutletModule` imports. **No `InventoryModule` import** — `SupplierInvoiceRepository` reaches directly into `GoodsReceiptItem` inside its own self-owned transaction, the exact precedent `SupplierReturnRepository`/`CustomerReturnRepository` (Sprint 11) already established. |
| 2   | Path A capping formula                      | `remainingPayable = max(0, payableQuantity - (returnedQuantity - returnedExcessQuantity) - invoicedQuantity)`; `recognizedAmount = min(lineTotal, remainingPayable × purchaseOrderItem.unitPrice)`; `varianceAmount = lineTotal - recognizedAmount` (always ≥ 0). One formula catches quantity mismatch, price mismatch, and any combination — AP can never be inflated by an invoice, by construction, not as a special case.                                                                                                                                                                                                                         |
| 3   | Path B — PO-less/GR-less bills              | **Mid-planning refinement, superseding an earlier "require a Goods Receipt link" proposal**: a line with no Goods Receipt reference instead carries a `debitAccountId` — an explicit, user-chosen Chart of Accounts entry, restricted to non-system `ASSET`/`EXPENSE` types, never a guessed/defaulted "Expense Account." Recognised in full (`recognizedAmount = lineTotal`, `varianceAmount = 0` always). A single invoice may mix Path A and Path B lines. Deliberately narrow AP accounting — explicitly **not** an Expense Management module (no claims, no approvals, no budgeting).                                                             |
| 4   | Does posting call `postSystemJournalEntry`? | Only for the Path B portion, if any — grouped by account into one balanced `DR <account>(s) / CR AP` entry per invoice, not per line. A 100%-Path-A invoice posts **zero** journal entries (the liability already exists from Goods Receipt); `resolveOpenPeriodId` is still called regardless, for consistency and future period-close integrity. Required one small, generic extension to the shared posting boundary: `PostingLineInput` gained an optional `accountId` alongside `systemKey` (exactly one required per line).                                                                                                                      |
| 5   | Lifecycle                                   | `SupplierInvoiceStatus { DRAFT POSTED PARTIALLY_PAID PAID OVERDUE VOID }`, direct mirror of `InvoiceStatus`. `DRAFT` is freely editable, including a line with neither `goodsReceiptItemId` nor `debitAccountId` yet (brief's "no unnecessary restrictions"); `post()` is the one-way transition that resolves every line to exactly one path, computes/freezes `matchStatus`/`recognizedAmount`/`varianceAmount`, increments `GoodsReceiptItem.invoicedQuantity` for Path A lines, and conditionally posts the Path B journal. `void()` mirrors `Invoice.void()`'s exact guard shape.                                                                 |
| 6   | Discrepancy resolution                      | No auto-resolution, no tolerance engine. `matchStatus` (`UNVERIFIED`/`MATCHED`/`DISCREPANCY`) is derived from Path A lines only. `POST /:id/acknowledge-discrepancy` records a human sign-off (`discrepancyResolvedAt`/`By`/notes) — **never** changes `recognizedAmount`/AP. Reclassifying `GRNI_PENDING_APPROVAL` excess into confirmed `AP` remains explicit deferred work.                                                                                                                                                                                                                                                                         |
| 7   | Payments                                    | `SupplierPayment`/`SupplierPaymentAllocation` — exact structural mirror of `Payment`/`PaymentAllocation`. The over-payment guard bounds against `recognizedAmount - amountPaid - amountCredited`, never `total` — this is what makes "no overpayment exposure on a discrepant invoice" automatic. Posts `DR AP / CR Cash-or-Bank`.                                                                                                                                                                                                                                                                                                                     |
| 8   | Credit Notes                                | A new, small `SupplierCreditNote` model — not a reuse of the customer-side `CreditNote` (whose `customerId` is a required, non-nullable FK). Mirrors `CreditNote`'s `DRAFT → ISSUED → VOID` shape; posts `DR AP / CR Inventory` (the mirror image of Goods Receipt's own posting).                                                                                                                                                                                                                                                                                                                                                                     |
| 9   | Schema                                      | One new column: `GoodsReceiptItem.invoicedQuantity Float @default(0)`, incremented only at `post()` time for Path A lines.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 10  | AP read model                               | `AccountsPayableService`, exact structural mirror of `AccountsReceivableService` — every figure derived live via `groupBy`/`aggregate`, never a stored balance. Includes a Purchase Order financial summary deliberately blind to received/inventory quantities (Inventory's own Receiving Summary covers that half).                                                                                                                                                                                                                                                                                                                                  |
| 11  | Cross-domain UI                             | New `SupplierDetailDialog` (Suppliers) and a new read-only "Financial Summary" block on the Purchase Order dialog (Procurement) — both sourced from Finance's own new endpoints, neither domain reading the other's tables.                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 12  | RBAC / idempotency / atomicity / audit      | Identical conventions to every prior sprint — `JwtAuthGuard` class-level, `RolesGuard` + `Owner`/`Administrator` per write; idempotency checked before business-rule pre-checks; one `$transaction` per write; a new `ACCOUNTS_PAYABLE_AUDIT_ACTIONS` file, self-namespaced per entity.                                                                                                                                                                                                                                                                                                                                                                |

## 3. Database Changes

Migration `20260828215302_sprint12_accounts_payable_supplier_invoices`:

- New enums: `SupplierInvoiceStatus`, `SupplierInvoiceMatchStatus`.
- New models: `SupplierInvoice`, `SupplierInvoiceItem` (with `goodsReceiptItemId`/
  `debitAccountId` as the Path A/B discriminator, and frozen
  `recognizedAmount`/`varianceAmount`), `SupplierPayment`,
  `SupplierPaymentAllocation`, `SupplierCreditNote` (reuses the existing
  `CreditNoteStatus` enum — no duplicate).
- Additive column: `GoodsReceiptItem.invoicedQuantity Float @default(0)`.
- Uniqueness: `(supplierId, invoiceNumber)` — never global, a supplier's own
  numbering; `(supplierId, idempotencyKey)` for `create()`; a separate
  `postIdempotencyKey` for `post()` — the same two-key convention Sprint 11's
  `CustomerReturn` established for its own two-phase lifecycle.

## 4. API

| Endpoint                                                          | Auth              | Notes                                           |
| ----------------------------------------------------------------- | ----------------- | ----------------------------------------------- |
| `GET/POST /api/finance/supplier-invoices`                         | Any / Owner+Admin | `?status=&supplierId=&purchaseOrderId=&search=` |
| `GET/PATCH /api/finance/supplier-invoices/:id`                    | Any / Owner+Admin | `PATCH` is `DRAFT`-only                         |
| `POST /api/finance/supplier-invoices/:id/post`                    | Owner+Admin       | Computes/freezes the match result               |
| `POST /api/finance/supplier-invoices/:id/acknowledge-discrepancy` | Owner+Admin       | Sign-off only                                   |
| `POST /api/finance/supplier-invoices/:id/void`                    | Owner+Admin       | Guarded per lifecycle                           |
| `GET/POST /api/finance/supplier-payments`                         | Any / Owner+Admin | Single-invoice allocation                       |
| `POST /api/finance/supplier-payments/:id/void`                    | Owner+Admin       | Reverses cumulative increment                   |
| `GET/POST /api/finance/supplier-credit-notes`                     | Any / Owner+Admin | Create → issue, two calls                       |
| `POST /api/finance/supplier-credit-notes/:id/issue` \| `/void`    | Owner+Admin       |                                                 |
| `GET /api/finance/accounts-payable/summary`                       | Any               | Org-wide AP aggregate                           |
| `GET /api/finance/accounts-payable/by-supplier`                   | Any               | Per-supplier rows                               |
| `GET /api/finance/accounts-payable/suppliers/:id`                 | Any               | Single supplier's balance                       |
| `GET /api/finance/accounts-payable/purchase-orders/:id`           | Any               | Single PO's AP rollup                           |

## 5. Backend Implementation

- **`apps/api/src/finance/accounting/journal-posting.ts`** — extended `PostingLineInput`
  with an optional `accountId`; new `resolveAccountId`/`InvalidPostingLineError`.
  Behaviour-preserving for every existing call site (all keep using `systemKey` only).
- **`apps/api/src/finance/supplier-invoice-matching.ts`** — pure, DI-free functions:
  `computeLineMatch` (Path A cap), `computeHeaderMatchStatus`, `validatePathBAccount`
  (Path B policy check) — the one formula shared by the create dialog's client-side
  preview and the immutable snapshot `post()` freezes.
- **`apps/api/src/finance/supplier-invoice.repository.ts`** — `create()`/`update()`
  (plain DRAFT writes), `post()` (the one atomic, money-critical transaction:
  idempotency-check-first → per-line path resolution → `computeLineMatch`/
  `validatePathBAccount` → increment `invoicedQuantity` → conditional Path B
  journal → freeze header), `void()`, plus the AP aggregate query methods backing
  `AccountsPayableService`.
- **`apps/api/src/finance/supplier-payment.repository.ts`** — direct structural copy
  of `payment.repository.ts`'s `create()`/`void()`, targeting `recognizedAmount`
  instead of `total` for the over-payment guard.
- **`apps/api/src/finance/supplier-credit-note.repository.ts`** — direct structural
  copy of `credit-note.repository.ts`'s `create()`/`issue()`/`void()`.
- **`apps/api/src/finance/accounts-payable.service.ts`** — mirrors
  `accounts-receivable.service.ts`; a self-caught layering issue (an initial direct
  `PrismaService` injection for two ad-hoc aggregates) was refactored into proper
  repository methods before this became a real violation.
- Controllers: `supplier-invoice.controller.ts`, `supplier-payment.controller.ts`,
  `supplier-credit-note.controller.ts`, `accounts-payable.controller.ts`.
- `finance.module.ts`: added `SupplierModule`/`PurchaseOrderModule` imports, all new
  providers/controllers.
- `accounts-payable-audit-actions.ts` — new file, per decision 12.
- **Inventory** — `goods-receipt.repository.ts`'s `RELATIONS_INCLUDE` extended with
  `purchaseOrderItem: { select: { unitPrice } }`; `toGoodsReceiptResponse`
  (`inventory.controller.ts`) extended to surface `returnedQuantity`/
  `returnedExcessQuantity`/`invoicedQuantity`/`unitPrice` — all genuinely
  `GoodsReceiptItem`'s own data (the first two are Sprint 11 columns already; the
  third is this sprint's), exposed purely for the Supplier Invoice line picker's
  "available to invoice" hint and default price. Inventory computes nothing from
  them and still imports nothing from Finance.
- Chart of accounts: **zero new `SYSTEM_ACCOUNT_KEYS`** — `AP`, `INVENTORY`, `CASH`,
  `BANK` all pre-existed.

## 6. Frontend Implementation

- **Admin `apps/web/src/app/(app)/settings/finance/payables/`** — `page.tsx` (AP
  summary cards + Supplier Invoice list), `supplier-invoice-dialog.tsx` (pick a
  supplier → optionally search/pick one of that supplier's Goods Receipts → its
  accepted lines become editable Path A candidates with a live, client-side
  discrepancy preview → "Add Line" for manual Path B lines with a Debit Account
  picker filtered to non-system Asset/Expense accounts → header fields → a
  "preview only, recalculated authoritatively on post" totals block, mirroring
  `InvoiceDialog`'s own convention), `supplier-invoice-detail-dialog.tsx` (frozen
  per-line match result, payment/credit-note history, Post/Void/Acknowledge actions,
  nests the two dialogs below), `supplier-payment-dialog.tsx`,
  `supplier-credit-note-dialog.tsx` — both direct structural mirrors of their
  customer-side counterparts.
- **Admin `apps/web/src/app/(app)/settings/finance/supplier-payments/page.tsx`** — a
  flat, read-only ledger + void, mirroring `payments/page.tsx`.
- **`FinanceTabs`** — two new tabs, "Payables" and "Supplier Payments".
- **`apps/web/src/app/(app)/settings/suppliers/supplier-detail-dialog.tsx`** —
  new read-only dialog (identity + Finance's AP financial summary); the Suppliers
  list's row click now opens it instead of jumping straight to Edit, which stays a
  separate, explicit action.
- **`apps/web/src/app/(app)/settings/procurement/purchase-order-dialog.tsx`** — a
  new read-only "Financial Summary" block (invoiced/recognized/paid/outstanding,
  discrepancy count) inserted after the existing Receiving Summary block.
- **`apps/web/src/app/(app)/settings/finance/api.ts`/`labels.ts`** — a new
  `// === Accounts Payable (Sprint 12) ===` section and new status/match-status
  label maps, following the existing one-shared-file convention.

## 7. Accounting Rules

See `docs/domains/accounting.md` §13 for the full writeup (the `computeLineMatch`
formula, the over-supply worked example, Path A/B posting rules, discrepancy
resolution, zero new system accounts). Summary:

- Path A: no new journal — reconciles against Goods Receipt's own existing posting.
- Path B: `DR <chosen account>(s) / CR Accounts Payable`, grouped per invoice.
- Supplier Payment: `DR Accounts Payable / CR Cash-or-Bank`.
- Supplier Credit Note: `DR Accounts Payable / CR Inventory`.

## 8. Tests

- New `supplier-invoice.repository.spec.ts` (21 tests, deliberate exception to "no
  repository tests for atomic transactions," same justification as
  `supplier-return.repository.spec.ts`) — create/idempotent replay; Scenario A (full
  match, zero journal); Scenario C (over-invoice capped at payable, `DISCREPANCY`,
  GRNI untouched); Scenario D (partial invoice, a second invoice settling the
  remainder against the same `GoodsReceiptItem`, a third against an already-fully-
  invoiced line correctly recognising zero); Path B (posts `DR <account> / CR AP`,
  rejects a system account / wrong type / cross-tenant account, rejects a line with
  neither reference); a mixed Path A + Path B invoice (summed recognition, one
  journal for the Path B portion only, `matchStatus` from Path A lines only);
  Goods-Receipt cross-tenant rejection; non-DRAFT re-post rejection; idempotent
  `post()` replay (no double-increment); closed-period rejection (both a Path B and
  a Path-A-only invoice); void(); tenant isolation.
- New `supplier-payment.repository.spec.ts` (12 tests) — Scenario A/E's exact
  partial-then-full payment cycle; DR AP/CR Cash-or-Bank per method; over-payment
  rejection bounded by `recognizedAmount` even when `total` is higher (the Scenario
  C guard); boundary-value rejection; DRAFT/VOID/cross-supplier rejection;
  idempotent replay; void (+ never-negative, + double-void rejection).
- New `supplier-credit-note.repository.spec.ts` (8 tests) — issue posts `DR AP / CR
Inventory` and reduces the invoice's outstanding balance; over-credit rejection;
  ineligible-invoice/non-DRAFT/nonexistent rejection; void reverses the effect;
  double-void rejection; cross-tenant void returns `null`.
- New `accounts-payable-independence.spec.ts` (5 tests) — structural guards: no AP
  repository writes `JournalEntry`/`JournalEntryLine` directly (only through
  `postSystemJournalEntry`); no AP file imports an Inventory/Procurement/Supplier
  service or controller; no AP file imports `InventoryModule`; `FinanceModule`
  still never imports `InventoryModule`; `SupplierInvoiceRepository` reaches
  `GoodsReceiptItem` only through `tx.`, never `this.prisma.`.
- Updated `inventory.controller.spec.ts`/`inventory.service.spec.ts` fixtures for
  the new `purchaseOrderItem` include.
- Full monorepo quality gate: `prisma validate`, `lint`, `type-check`, `test`, and
  `build`, all green. **77 test suites / 782 tests, all passing** (up from 73/736
  before this sprint).

## 9. Live Verification Performed

Using the actual running API (`nest start --watch`) and web (`next dev`) apps,
logged in as the seeded Owner account. Both Postgres/Redis (Docker) and a stale,
pre-Sprint-12 compiled-`dist` API process (same recurring pattern noted in the
Sprint 10/11 reports) needed restarting before verification.

1. **Scenario A (normal purchase, full cycle).** Created a Supplier Invoice against
   PackRight Nigeria's existing over-supply Goods Receipt (`GRN-000005`/`PO-000011`,
   accepted 1,100 kg, `payableQuantity` capped at 1,000), pulling its one Path A line
   at the full 1,000 kg/₦150 default. Posted: `Matched`, `Recognized (Payable)
₦150,000.00`. Recorded a ₦90,000 partial payment → `Partially Paid`, then the
   remaining ₦60,000 → `Paid`, Accounts Payable back to `₦0.00`, both payments
   correctly listed in Payment History. Confirmed via `GET
/finance/journal-entries`: `JE-000032`/`JE-000033` (`DR Accounts Payable / CR Bank
Transfer`, ₦90,000/₦60,000) — and, notably, **no** new journal entry for the
   invoice's own `post()` (Path A correctly posts nothing — Goods Receipt's own
   `JE-000005` already covers the liability).
2. **Live discrepancy preview.** In the same create dialog, entering an invoiced
   quantity of 1,050 against the 1,000 kg available immediately flagged a
   "Discrepancy" badge client-side, before saving — confirming the preview
   correctly mirrors the server's own capping formula.
3. **Path B (no PO/GR).** Created a second invoice against Lagos Cartons Ltd with
   no Purchase Order and a single manual line ("Freight and logistics", ₦45,000)
   coded to a `6500 — Transport` (non-system Expense) account via the Debit Account
   picker. Posted: `Unverified` (correct — a pure-Path-B invoice has nothing to
   reconcile), `Recognized (Payable) ₦45,000.00`. Confirmed via the journal list:
   `JE-000034` "Supplier invoice LC-FRT-0001 posted", `₦45,000.00`.
4. **Cross-domain read models.** The Supplier detail dialog for PackRight Nigeria
   correctly showed `Total Invoiced ₦150,000 / Total Paid ₦150,000 / Outstanding
₦0 / 1 invoice · 2 payments recorded`; the Purchase Order dialog for `PO-000011`
   showed the existing Receiving Summary (Ordered 1,000 / Delivered 1,100 +100
   excess / Accepted 1,100 / Rejected 0) directly alongside the new Financial
   Summary block (`Invoiced ₦150,000 / Recognized ₦150,000 / Paid ₦150,000 /
Outstanding ₦0`) — two domains' data shown together, neither reading the other's
   tables.
5. **Cross-sprint composition check.** `GRN-000005` already had a real Sprint 11
   `SupplierReturn` (`SRET-000001`, 50 units) recorded against it before this
   sprint's testing began. Because that return's excess-first allocation had drawn
   entirely from the excess/GRNI bucket (`returnedExcessQuantity = returnedQuantity
= 50`, leaving the payable-bucket term `returnedQuantity - returnedExcessQuantity`
   at zero), the Sprint 12 invoice's `remainingPayable` was correctly unaffected —
   the full 1,000 kg still matched cleanly. This is a genuine, unplanned end-to-end
   proof that Sprint 11's excess-first Return allocation and Sprint 12's Path A
   capping formula compose correctly, not just independently.
6. **Zero browser console errors** on every page exercised (Payables, Supplier
   Payments, Suppliers detail, Procurement PO dialog), confirmed via
   `read_console_messages`.
7. **Full production build** (`next build`) succeeds with `/settings/finance/
payables` and `/settings/finance/supplier-payments` in the route manifest;
   `tsc --noEmit` and `eslint` clean on both `apps/api` and `apps/web`.

Not separately clicked through in the browser this session (proven instead via the
21 automated repository tests in §8, to the same numeric precision): Scenario B in
isolation (subsumed by Scenario A's use of the same over-supply fixture), Scenario D
(partial-then-completing invoices against the same Goods Receipt line — repository
tests §8 assert the exact 600/400/1000 sequence), and voiding a Supplier Invoice /
issuing a Supplier Credit Note through the UI specifically (both call the same
`SupplierInvoiceDetailDialog` action buttons already exercised structurally, and both
have dedicated repository-level coverage).

## 10. Known Limitations

- **No automatic GRNI-to-AP reclassification.** Acknowledging a discrepancy is
  sign-off only — a future sprint would need to build the explicit action that
  moves confirmed-resolved excess out of `GRNI_PENDING_APPROVAL` into `AP`.
- **No approval workflow gating Path B postings** — any Owner/Administrator can
  post against any eligible non-system Asset/Expense account; restricted by
  account type only, not a configurable policy.
- **No payment runs, AP ageing report, or automated payment scheduling** — a
  Payables Overview and a flat payment ledger only, matching the brief's own
  non-goals.
- **Single-invoice payment/credit allocation**, same deferred decision as the
  customer-side equivalent (`finance.md` §11).
- **No supplier portal/self-service, payment-gateway integration, or bank
  reconciliation.**
- **No procurement bidding/RFQ, multi-currency beyond what already exists, or
  full financial reporting/BI** — all explicit brief non-goals, unchanged.
- The client-side matching preview in `SupplierInvoiceDialog` is informational
  only (a simple min/cap computed from fields the Goods Receipt endpoint now
  exposes) — the authoritative result is always recomputed and frozen server-side
  at `post()`, never trusted from the client, same posture `InvoiceDialog`'s own
  preview already has.

## 11. Deferred / Future Work

- GRNI → AP reclassification action for acknowledged discrepancies.
- Configurable approval policy for which Chart of Accounts entries a Path B line
  may target.
- Payment runs, AP ageing, automated payment scheduling.
- Multi-invoice payment/credit allocation (the schema already supports it).
- Supplier portal, payment-gateway integration, bank reconciliation.

## 12. Documentation Updated

`docs/domains/finance.md` (header block, updated §9, new §12 "Accounts Payable &
Supplier Invoice Management"), `docs/domains/accounting.md` (new §13 "Supplier
Invoice Matching & AP Accounting" with 5 subsections, renumbered API
Reference/Known Limitations to §14/§15, updated §15's limitations list),
`docs/domains/procurement.md` (updated Integration Points), `docs/domains/
suppliers.md` (updated Integration Points), `docs/domains/README.md` (Procurement/
Finance/Accounting status rows), `docs/backlog.md` (Epic 4/15/16/17, Current
Sprint Status), `docs/roadmap.md` (Phase 2 Supplier Management/Procurement/Finance/
Accounting rows), `docs/changelog.md` (new dated entry), this completion report.

## 13. Constraint

Per this session's established convention, nothing in this sprint's work has been
committed or pushed — that remains the user's own explicit instruction to give.
