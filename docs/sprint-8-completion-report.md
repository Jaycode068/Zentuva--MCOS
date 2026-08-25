# Sprint 8 Completion Report — Procurement, Inventory & Accounting Integration

## 1. Objective

Connect the operational Procurement/Inventory flow to the General Ledger established
in Sprint 7, so that receiving purchased materials against a Purchase Order
automatically produces the correct accounting entries — without turning Procurement or
Inventory into a dependency on the Finance module. Primary chain:

```
Supplier → Purchase Order → Goods Receipt → Inventory increases → Journal Entry → General Ledger
```

A mid-planning requirement, supplied directly by the user, became the sprint's most
consequential design decision: **accepted quantity must not be assumed equal to
payable quantity.** Goods can be physically accepted into inventory beyond what a
Purchase Order commercially covers without the organisation owing the supplier for
that excess — see §2.

## 2. Architecture Decisions

| #   | Question                        | Decision                                                                                                                                                                                                                                                                                                                                                                           |
| --- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Where does the posting call go? | Inside `GoodsReceiptRepository.receive()`'s existing `$transaction`, calling `postSystemJournalEntry(tx, {...})` directly — a plain, non-DI function import from `finance/accounting/journal-posting.ts`, exactly the Sprint 7 pattern `PaymentRepository.create()`/`CreditNoteRepository.issue()` already established. `InventoryModule` gains zero new NestJS module dependency. |
| 2   | Accepted vs. Payable            | A new `payableQuantity` on `GoodsReceiptItem`, computed as `min(acceptedQuantity, remainingOrderedQuantity)`, where the remaining figure is the Purchase Order item's own ordered quantity minus every prior receipt's cumulative payable total against it.                                                                                                                        |
| 3   | AP vs. GRNI                     | Two system accounts: the existing `AP` (the commercially-agreed, PO-capped liability) plus a new `GRNI_PENDING_APPROVAL` ("Goods Received – Pending Approval," code `2110`) for accepted value beyond that cap. Not a general GRNI-vs-invoiced split — a payable-vs-unapproved split.                                                                                              |
| 4   | Journal line construction       | `DR Inventory` = full accepted value (always); `CR AP` = payable value (only if `> 0`); `CR GRNI_PENDING_APPROVAL` = excess value (only if `> 0`). Balanced by construction.                                                                                                                                                                                                       |
| 5   | Valuation                       | `PurchaseOrderItem.unitPrice` — the PO's own frozen price — applied to all three sums. No new valuation model; matches `inventory.md`'s own "a future Finance domain would build valuation on top of this ledger" framing.                                                                                                                                                         |
| 6   | All-rejected receipt            | Skip posting entirely — no journal at all, not even zero-amount, when nothing was accepted.                                                                                                                                                                                                                                                                                        |
| 7   | Idempotency                     | `GoodsReceipt.idempotencyKey` + `@@unique([purchaseOrderId, idempotencyKey])`, exact shape of `Invoice.idempotencyKey`. Checked first inside `receive()`'s transaction, mirroring `SalesFulfilmentRepository.create()`.                                                                                                                                                            |
| 8   | Closed-period handling          | No new code — `postSystemJournalEntry` already throws `NoOpenPeriodError`, propagating out of the whole `$transaction` and rolling back the Goods Receipt, `InventoryStock`, and `InventoryTransaction` writes together with it.                                                                                                                                                   |
| 9   | Traceability                    | No new FK fields — `sourceType: 'GOODS_RECEIPT'` / `sourceId` / `reference`, the same polymorphic design `JournalEntry` already uses for `INVOICE`/`PAYMENT`/`CREDIT_NOTE`.                                                                                                                                                                                                        |
| 10  | Audit events                    | New `INVENTORY_AUDIT_ACTIONS.JOURNAL_ENTRY_POSTED` (`goods-receipt.journal-entry-posted`), fired only when a journal was actually created. All four `POST /goods-receipts` audit events are now gated on `wasCreated === true` — previously none were, since no idempotency existed to make replay possible.                                                                       |
| 11  | Future approval workflow        | Not built this sprint. The data model (`payableQuantity` stored per line, `GRNI_PENDING_APPROVAL`'s balance) is sufficient for a future sprint to add the reclassification step without a schema rework.                                                                                                                                                                           |

## 3. Database Changes

New migration `20260824225247_add_goods_receipt_accounting`:

- `GoodsReceipt.idempotencyKey String?` + `@@unique([purchaseOrderId, idempotencyKey])`.
- `GoodsReceiptItem.payableQuantity Float @default(0)`, with a backfill (`UPDATE ...
SET "payableQuantity" = "acceptedQuantity"`) for every pre-existing row — safe since
  no accounting integration (and therefore no payable/excess distinction) existed
  before this migration, so there was nothing to reconcile.
- `SYSTEM_ACCOUNT_KEYS` gains `GRNI_PENDING_APPROVAL` (plain TypeScript const, no
  schema enum change — `ChartOfAccount.systemKey` is already a free-text column).

## 4. API

No new endpoints. `POST /api/inventory/goods-receipts` accepts a new optional
`idempotencyKey`; its response (and `GET /goods-receipts`, `GET /goods-receipts/:id`)
now include `journalEntry: { id, journalNumber, status, totalAmount } | null`, and each
item includes `payableQuantity`.

## 5. Backend Implementation

- **`GoodsReceiptRepository.receive()`** — extended with: an idempotency
  check-then-return at the top of the transaction (mirroring
  `SalesFulfilmentRepository.create()`); a per-item `payableQuantity` computation
  alongside the existing cumulative-delivered tracking; and, after the existing
  `InventoryStock`/`InventoryTransaction` writes, the 2-or-3-line
  `postSystemJournalEntry` call. A new `findJournalEntriesByGoodsReceiptIds` batch
  lookup powers the read-path (`GET`) responses.
- **`InventoryService.receiveGoods()`** — threads `idempotencyKey`/`unitPrice`/
  `purchaseOrderNumber` into the repository call; catches `NoOpenPeriodError`/
  `MissingSystemAccountError` alongside the existing `GoodsReceiptConflictError`.
- **`InventoryService.listGoodsReceipts()`/`getGoodsReceiptById()`** — now merge in
  each receipt's linked Journal Entry via the batch lookup.
- **`InventoryController`** — all four audit blocks (`GOODS_RECEIVED`,
  `INVENTORY_INCREASED`, `DISCREPANCY_RECORDED`, `REPLACEMENT_RECEIVED`) plus the new
  `JOURNAL_ENTRY_POSTED` block are gated on `wasCreated`.
- **`packages/validation/src/inventory.ts`** — `createGoodsReceiptSchema` gains an
  optional `idempotencyKey`.
- **`journal-posting.ts`/`chart-of-account-keys.ts`** — reused as-is; only
  `SYSTEM_ACCOUNT_KEYS` gained the one new key.

## 6. Frontend Implementation

- `goods-receiving-dialog.tsx` — generates and sends a fresh `idempotencyKey`
  (`crypto.randomUUID()`) per dialog open, matching the codebase's established
  create-dialog convention.
- `settings/inventory/page.tsx` (Goods Receipts tab) — a new "Payable" column
  (flagging any accepted-beyond-payable amount as "pending approval"), and an
  "Accounting: JE-000123 · Posted · ₦X" line linking to
  `/settings/finance/journal-entries`, or "No accounting entry — nothing was accepted"
  when `journalEntry` is `null`.
- `settings/finance/labels.ts` — `JOURNAL_SOURCE_TYPE_LABELS` gains `GOODS_RECEIPT:
'Goods Receipt'`, so the General Ledger/Journal Entries pages render it as a
  readable label rather than the raw enum string.
- Procurement's own PO dialog was confirmed (not assumed) to have no embedded
  Goods-Receipt list to extend — receiving happens entirely through Inventory's own
  flow, so no Procurement UI changes were needed.

## 7. Accounting Rules / Accepted-vs-Payable Integration

See `docs/domains/accounting.md` §9 for the full writeup. Summary: `DR Inventory` is
always the full accepted value; the credit side is `AP` up to the Purchase Order's own
ordered quantity (cumulative across every receipt against that PO item), and any
value beyond that goes to `GRNI_PENDING_APPROVAL` instead of inflating `AP`. Rejected
quantity contributes to neither inventory nor accounting value, at any point.

## 8. Tests

- New `goods-receipt.repository.spec.ts` (a deliberate exception to the "no
  repository tests for atomic transactions" convention, same justification as
  `payment.repository.spec.ts`/`journal-posting.spec.ts`) — 9 tests against the real
  `receive()` transaction logic via an in-memory fake `tx` combining the Goods Receipt
  tables with the same `chartOfAccount`/`accountingPeriod`/`journalEntry` fakes
  `payment.repository.spec.ts` established: happy path (fully payable, 2-line
  journal), the user's own worked example (1,100/50/1,050/1,000/50, 3-line journal),
  the payable-cap edge case (a PO item already fully consumed — no `AP` line at all),
  all-rejected (no journal), idempotency replay (exactly one receipt, one journal),
  `GoodsReceiptConflictError`, `NoOpenPeriodError` (zero journals created),
  `MissingSystemAccountError`, and multiple receipts against one PO (three balanced
  journals, no excess line on any).
- Existing `inventory.service.spec.ts`/`inventory.controller.spec.ts` fixtures updated
  for the new required fields (`idempotencyKey`, `payableQuantity`, `journalEntry`,
  `wasCreated`) — all pre-existing assertions still pass unchanged.
- Full backend suite: **63 test suites / 638 tests, all passing.**

## 9. Live Verification Performed

Using the actual running API (`nest start`) and web (`next dev`) apps, logged in as
the seeded Owner account:

1. **Fresh Farms Ltd scenario** (the brief's own worked example): created PO-000004
   (500kg Raw Plantain @ ₦1,000/kg = ₦500,000 with Fresh Farms Ltd), issued it,
   received 300kg delivered / 10kg rejected (Damaged) / 290kg accepted → confirmed via
   direct database query that Journal Entry JE-000014 posted `DR Inventory ₦290,000 /
CR AP ₦290,000`. Received the 10kg replacement → JE-000015, `DR Inventory ₦10,000 /
CR AP ₦10,000`. Final state confirmed: Inventory +300kg total, GL Inventory/AP each
   moved by exactly ₦300,000 from this PO — matching the brief's exact numbers.
2. **Accepted-vs-payable scenario** (the user's own worked example, which the Fresh
   Farms scenario alone never exercises since 300kg never exceeds its 500kg PO):
   created PO-000005 (1,000kg Salt @ ₦1,000/kg = ₦1,000,000 with Salt Masters Ltd),
   issued it, received 1,100kg delivered / 50kg rejected (Defective) / 1,050kg
   accepted. The UI itself showed "Excess Supply: 100" and "Accepted Quantity: 1050
   Kilogram" before submission. Confirmed via direct database query: `payableQuantity`
   = 1,000 (not 1,050), and JE-000016 posted exactly three lines — `DR Inventory
₦1,050,000 / CR Accounts Payable ₦1,000,000 / CR GRNI — Pending Approval ₦50,000`.
3. **Full-stack traceability**, driven entirely through the UI: Inventory's Goods
   Receipts tab → "Accounting: JE-000016 · Posted · ₦1,050,000.00" (clickable) →
   Finance's Journal Entries list (Source column correctly rendered "Goods Receipt",
   not the raw `GOODS_RECEIPT` string) → the entry's own detail dialog, showing
   "Source: Goods Receipt — GRN-000008," the description, period, and all three
   journal lines.
4. **Real application startup/DI**: `node dist/main.js` against the production build
   started cleanly — every controller/route mapped, Prisma connected, "Nest
   application successfully started," with no dependency-injection errors (per the
   brief's explicit "unit tests alone can miss runtime DI problems" concern).

Duplicate-submission and closed-accounting-period behaviour were verified at the unit
level (`goods-receipt.repository.spec.ts`'s idempotency-replay and
`NoOpenPeriodError` tests, both exercising the real transaction logic) rather than
re-driven live a second time, since the live scenarios above already exercised the
same code paths that guard both cases.

## 10. Bugs Found and Fixed During This Sprint

- **Seed ordering.** `seedGoodsReceipts` originally ran before `seedChartOfAccounts`/
  `seedAccountingPeriods` in `seed.ts`'s `main()` — harmless before this sprint (no
  accounting dependency existed), but once Goods Receipts started posting journals,
  every receipt would have failed with "no open accounting period configured." Fixed
  by moving the Chart of Accounts/Accounting Period seeding earlier, ahead of
  Procurement/Inventory seeding.
- **Dev database had a closed accounting period.** The dev database's "August 2026"
  period had been closed during Sprint 7's own live-verification testing. Re-seeding
  against that state correctly triggered the new closed-period guard — but that guard
  made the dev database unusable for a repeatable idempotency check. Resolved (with
  the user's explicit confirmation) via `prisma migrate reset`, giving a clean
  baseline; both a first seed run and a second (idempotency) run then completed with
  zero errors and zero duplicate journals.
- **Historical `payableQuantity` on already-seeded receipts.** The migration's own
  blanket backfill (`payableQuantity = acceptedQuantity`) is correct for every
  pre-Sprint-8 row _except_ the seeded excess-delivery fixture (`GRN-000005`, 1,100
  accepted against a 1,000-unit PO), where naively trusting that backfilled value
  would have posted the full ₦165,000 to `AP` instead of splitting `₦150,000 AP / 
₦15,000 GRNI`. `seedGoodsReceipts` now recomputes `payableQuantity` in-memory (via a
  cumulative tracker over the seed script's own fixed, chronological receipt order)
  for every receipt — whether newly created or already present from an earlier
  seed run — and backfills the corrected value onto existing rows before posting.

## 11. Known Limitations

- No approval workflow exists to move value out of `GRNI_PENDING_APPROVAL` into `AP`
  — a future sprint's job, per the brief's own explicit scope boundary.
- Valuation remains a one-time snapshot at receipt time
  (`acceptedQuantity × PurchaseOrderItem.unitPrice`), not a running FIFO/
  weighted-average costing ledger.
- `COGS` remains unposted — no Production/Sales Fulfilment accounting integration yet.
- Procurement's own UI was not extended (it has no embedded Goods Receipt list to
  extend) — the accounting reference is visible via Inventory's Goods Receipts tab and
  the General Ledger, both reachable from a Purchase Order's own receiving history.
- No full Accounts Payable module — no supplier invoice matching, no payment runs, no
  AP ageing, no vendor statements, no supplier credit management.

## 12. Deferred / Future Work

- A `GRNI_PENDING_APPROVAL` → `AP` approval/three-way-match workflow (PO quantity ↔
  Goods Received quantity ↔ Supplier Invoice quantity ↔ Approved payable quantity).
- Production → WIP/COGS accounting integration.
- Sales Fulfilment → COGS accounting integration.
- A running inventory-valuation ledger (FIFO/weighted-average).
- Full Accounts Payable (supplier invoices, payment runs, AP ageing).

## 13. Documentation Updated

`docs/domains/accounting.md` (new §9.1–§9.4, replacing the old §9),
`docs/domains/inventory.md` (new §11a, updated Known Limitations, updated Audit Events
table), `docs/domains/procurement.md` (§6 Integration Points), `docs/domains/README.md`,
`docs/backlog.md` (Epic 4/5/17, Current Sprint Status), `docs/roadmap.md` (Phase 2),
`docs/changelog.md` (new dated entry), this completion report.

## 14. Constraint

Per this session's established convention, nothing in this sprint's work has been
committed or pushed — that remains the user's own explicit instruction to give.
