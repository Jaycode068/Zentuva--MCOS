# Sprint 4.4.1 Completion Report — Goods Receiving, Inspection & Supplier Discrepancy Refinement

**Date:** 2026-08-13
**Status:** Complete

## 1. Objective

During local testing of Sprint 4.4 (Inventory Management — Goods Receiving), a
significant business-process gap was identified: the implementation let a user enter a
single "quantity received" figure, but couldn't distinguish quantity ordered, quantity
physically delivered, quantity accepted into usable inventory, quantity rejected,
quantity still outstanding, excess quantity supplied, goods awaiting supplier
resolution, or replacement goods received later. This sprint corrects that — the
smallest robust domain model that supports real manufacturing receiving scenarios —
before Production gets built on top of Inventory. Explicit non-goals (brief's
Architectural Constraints): no Quality Management, Supplier Claims, Supplier Returns,
Accounts Payable, Credit Notes, Warehouse Management, Batch/Lot tracking, Expiry
tracking, multi-warehouse support, or automated supplier communication.

## 2. Implementation Summary

### The core insight that reshaped the design mid-sprint

The brief's own worked examples (Scenario C, and the Definition of Done) show a Purchase
Order reaching `RECEIVED` immediately after a delivery that fully met the ordered
quantity — _even when part of that delivery was rejected_ — and then later accepting a
_second_ delivery (a supplier replacement) against that same, already-`RECEIVED` order.
That directly falsified my first draft of the design, which computed "outstanding" from
`ordered − accepted` and blocked receiving once `RECEIVED`. The correct model, confirmed
against every one of the brief's Scenarios A–E:

- **Outstanding** = `max(0, ordered − cumulative delivered)` — based on _delivered_, not
  _accepted_. Rejections are a quality issue, tracked separately; they don't
  automatically reopen the original delivery commitment.
- **A Purchase Order's status tracks delivery completeness, not acceptance** — it
  reaches `RECEIVED` once every item's cumulative delivered quantity meets its ordered
  quantity, regardless of rejections.
- **Receiving eligibility has nothing to do with the order's current status**, other
  than excluding `DRAFT` (never issued) and `CANCELLED` (called off) — `RECEIVED` and
  `PARTIALLY_RECEIVED` are both receivable, because a replacement shipment must still be
  recordable. Brief §15 test #17 ("Duplicate/repeated receipt protection must be
  redesigned around receipt identity rather than blocking all subsequent receipts")
  confirms this directly.

Getting this ordering-of-concepts right first was the highest-leverage part of the
sprint — every schema/service/frontend decision below follows from it.

### Schema — `GoodsReceiptItem` redesigned, two new enums, `PurchaseOrderStatus` extended

Migration `20260813175301_refine_goods_receiving_discrepancy`:

- **`GoodsReceiptItem`** — `quantityReceived` removed; replaced with
  `purchaseOrderItemId` (FK to the specific ordered line, not just a `productId`),
  `deliveredQuantity`, `rejectedQuantity` (`@default(0)`), `acceptedQuantity` (always
  server-computed), `rejectionReason` (`RejectionReason?`), `rejectionNotes`.
  Referencing `purchaseOrderItemId` directly (not re-deriving "ordered" from a
  productId lookup) is what makes "ordered quantity ... must remain immutable
  historical information" (brief §1) trivially true.
- **`RejectionReason` enum** — `DAMAGED`/`DEFECTIVE`/`WRONG_ITEM`/
  `WRONG_SPECIFICATION`/`CONTAMINATED`/`OTHER`.
- **`GoodsReceipt`** gained `discrepancyStatus` (`DiscrepancyStatus`, default `NONE`)
  and `discrepancyNotes` — the one mutable pair of fields on an otherwise-immutable row.
- **`DiscrepancyStatus` enum** — `NONE`/`PENDING_SUPPLIER`/`REPLACEMENT_EXPECTED`/
  `REPLACEMENT_RECEIVED`/`CREDIT_EXPECTED`/`RESOLVED`.
- **`PurchaseOrderStatus`** gained `PARTIALLY_RECEIVED`.

Since this is local dev data with no production constraint, existing `GoodsReceipt`/
`InventoryStock`/`InventoryTransaction` rows (and the `RECEIVED` status they'd set on
`PO-000001`/`PO-000007`/`PO-000008`) were deleted and those orders reset to `PENDING`
_before_ running the migration, so it applied cleanly with no data-loss prompts or
backfill needed.

### `GoodsReceiptRepository.receive` — the transaction that computes everything

Redesigned to accept `purchaseOrderItems: { id, quantity }[]` (every one of the order's
items, supplied by `InventoryService` from its own `PurchaseOrderRepository.findById`
call — this transaction never queries `purchase_order_items` itself). Inside the
transaction: aggregate every prior receipt's `deliveredQuantity` per item
(`groupBy` on `goodsReceiptItem`, scoped through `goodsReceipt.organisationId`), add
this receipt's own deliveries, and decide `RECEIVED` (every item's cumulative delivered
≥ ordered) vs. `PARTIALLY_RECEIVED`. The conditional `purchaseOrder.updateMany`'s `where`
clause changed from `status: { in: [PENDING, PARTIALLY_RECEIVED] }` (Sprint 4.4) to
`status: { notIn: [DRAFT, CANCELLED] }` — its job is now closing the race against a
_concurrent cancel_, not blocking legitimate repeat receiving. Only the **accepted**
portion of each item ever upserts `InventoryStock` or appends an `InventoryTransaction`
row (brief's "Important Business Rule"); an item rejected in full writes neither.

### `InventoryService` — validation, computed fields, and the new read/update surfaces

- `receiveGoods` rejects `DRAFT`/`CANCELLED` explicitly (specific `400` each); every
  other status is receivable. Computes `acceptedQuantity` server-side
  (`delivered − rejected`, rounded to guard floating-point drift) and this receipt's
  `discrepancyStatus` (`PENDING_SUPPLIER` if any item was rejected, else `NONE`) — never
  trusts either from the client.
- `getPurchaseOrderReceivingSummary` — new. Combines Procurement's own
  `PurchaseOrderRepository` (ordered quantities, read-only) with Inventory's own
  aggregated `GoodsReceiptItem` totals to produce the per-item
  Ordered/Delivered/Accepted/Rejected/Outstanding/Excess view plus the full receipt
  history, in one call — reused by both the Goods Receiving dialog and Procurement's
  own PO dialog.
- `updateDiscrepancyStatus` — new, backs the `PATCH .../discrepancy` endpoint.

### `PurchaseOrderService` — receiving now locks editing/cancellation

`update`/`cancel` both gained a second guard alongside the existing `CANCELLED` check:
`PARTIALLY_RECEIVED`/`RECEIVED` orders reject with a `400`
("...cannot be edited"/"cannot be cancelled") — once Inventory has recorded a delivery,
changing the order's items would corrupt the ordered-quantity figures the receiving
calculations depend on.

### API — one new write endpoint, one new read endpoint

`PATCH /api/inventory/goods-receipts/:id/discrepancy` (Owner/Administrator) and
`GET /api/inventory/purchase-orders/:purchaseOrderId/receiving` (any authenticated
user) — both declared before the pre-existing `/:productId` wildcard route, same route-
ordering discipline established in Sprint 4.4.

### Frontend

- **Goods Receiving dialog** — rebuilt around the receiving summary: selecting a
  Purchase Order (now including already-`RECEIVED` orders, labelled with their status
  in the dropdown) loads Ordered/Previously Delivered/Accepted/Rejected/Outstanding per
  item; Delivered Quantity defaults to Outstanding; a Rejected Quantity above zero
  reveals Reason/Notes fields; Accepted Quantity is always shown computed, never an
  input; an "Excess Supply" badge appears when Delivered exceeds Outstanding.
- **Inventory page's new "Goods Receipts" tab** — full receiving history per the
  brief's §13 example, plus an inline discrepancy-status selector + Update button next
  to any receipt with a rejection.
- **Procurement's `PurchaseOrderDialog`** — gained a read-only "Receiving Summary"
  table (fetched from the same new endpoint) shown whenever the order has any receiving
  activity; `STATUS_LABELS`/`STATUS_VARIANT`/`PurchaseOrderStatus` all extended for
  `PARTIALLY_RECEIVED`.

### Seed data

Three new Purchase Orders (`PO-000009` Salt Masters/Salt, `PO-000010` Lagos Cartons/
Cartons, `PO-000011` PackRight Nigeria/Printed Nylon — renumbered from the brief's
natural `PO-000004`–`006` after discovering those numbers were already occupied by
artifacts from earlier live-browser testing, same collision this codebase hit with
product codes in Sprint 4.3) and five Goods Receipts:

| GRN        | Against                  | Delivered | Rejected     | Accepted | Result                                                       |
| ---------- | ------------------------ | --------- | ------------ | -------- | ------------------------------------------------------------ |
| GRN-000001 | PO-000001 (2000 ordered) | 2000      | 0            | 2000     | `RECEIVED`, Scenario A                                       |
| GRN-000002 | PO-000009 (500 ordered)  | 450       | 0            | 450      | `PARTIALLY_RECEIVED`, Scenario B                             |
| GRN-000003 | PO-000010 (1000 ordered) | 1000      | 50 (Damaged) | 950      | `RECEIVED` despite the rejection, Scenario C                 |
| GRN-000004 | PO-000010 (replacement)  | 50        | 0            | 50       | Second receipt against an already-`RECEIVED` order, brief §6 |
| GRN-000005 | PO-000011 (1000 ordered) | 1100      | 0            | 1100     | `RECEIVED`, 100 excess accepted, Scenario E                  |

`seedGoodsReceipts` mirrors `GoodsReceiptRepository.receive`'s transaction logic
directly against Prisma (same "talks to Prisma directly" convention as the rest of the
seed script); `pnpm db:seed` run twice in a row produced identical output both times.

## 3. Testing / Verification Performed

- Full monorepo quality gate: `pnpm lint`, `pnpm type-check`, `pnpm test`, `pnpm build`
  all green. 200/200 backend unit tests pass (187 pre-existing + 13 new/updated:
  `InventoryService` — Scenarios A/C/E, excess never capped, receiving a
  `PARTIALLY_RECEIVED` and a `RECEIVED` order, draft/cancelled rejection, item-not-on-
  order rejection, conflict-error translation, GRN collision handling, receiving-summary
  outstanding/excess math, discrepancy-status update; `InventoryController` — audit
  assertions for every combination of `hasDiscrepancy`/`isFirstReceipt`/
  `RESOLVED`-vs-not; `PurchaseOrderService` — reject edit/cancel for
  `PARTIALLY_RECEIVED` and `RECEIVED`).
- Live end-to-end browser verification against freshly restarted dev servers:
  1. Inventory Summary/Goods Receipts tabs render every seeded scenario correctly
     (stock quantities matching the table above exactly, including `Cartons` correctly
     showing `1000` — the sum of two separate receipts, 950 + 50 — proving the
     cumulative-aggregation logic works).
  2. Opened `PO-000009`'s (Partially Received) `PurchaseOrderDialog` and confirmed its
     embedded Receiving Summary showed `Salt: Ordered 500, Delivered 450, Accepted 450,
Rejected 0, Outstanding 50` exactly.
  3. Live receive against `PO-000009`: the Goods Receiving dialog's Purchase Order
     dropdown correctly listed every non-`DRAFT`/`CANCELLED` order including already-
     `RECEIVED` ones (`PO-000001`, `PO-000010`, `PO-000011`); selecting `PO-000009`
     pre-filled Delivered Quantity to its Outstanding (50); entered Rejected Quantity 10
     with reason `DEFECTIVE`, watched Accepted Quantity live-compute to 40, saved.
  4. Verified the result: Salt stock became `490` (450 + 40, not 450 + 50); `PO-000009`
     transitioned to `RECEIVED` (cumulative delivered 450 + 50 = 500 = ordered, despite
     the 10-unit rejection); the new `GRN-000006` appeared in the Goods Receipts tab
     with `discrepancyStatus: Pending Supplier` and the correct
     delivered/rejected/accepted/reason/notes.
  5. Resolved that discrepancy via the inline control (selected "Resolved," clicked
     Update) and confirmed the badge updated live.
  6. Mobile viewport (375px): Goods Receipts tab renders correctly, no page-level
     horizontal scroll. No console errors.
- Manual API verification (`curl`) directly against the live backend:
  - **Audit trail**: queried `audit_logs` after the live receive above and confirmed all
    five possible events fired correctly for that single call:
    `goods-receipt.received`, `inventory.increased` (metadata: `acceptedQuantity: 40`,
    not 50), `goods-receipt.discrepancy-recorded` (metadata: `rejectedQuantity: 10,
rejectionReason: DEFECTIVE`), `goods-receipt.replacement-received` (this was
    `PO-000009`'s second receipt), and later `goods-receipt.resolved`.
  - **Editing/cancelling a `RECEIVED` order**: both `PATCH` and `POST .../cancel`
    against `PO-000009` → `400` with the new specific messages.
  - **Receiving eligibility**: `POST .../goods-receipts` against a `DRAFT` order → `400`
    "Only purchase orders that have been issued..."; against a `CANCELLED` order → `400`
    "Cancelled purchase orders cannot be received".
  - **RBAC**: Member `GET` on both new endpoints → `200`; Member `PATCH .../discrepancy`
    → `403`.
  - **Tenant isolation**: a freshly-registered isolation-test tenant's token → `404` on
    both `GET .../purchase-orders/:id/receiving` and `PATCH .../discrepancy` against
    Boby Bites resources.
  - **Database migration + seed**: applied cleanly after the pre-migration data cleanup;
    `pnpm db:seed` run twice in a row produced identical output, confirming idempotency.

## 4. Known Limitations

- No Quality Management module, Supplier Claims module, Supplier Returns module,
  Accounts Payable, Credit Notes, Warehouse Management, Batch/Lot tracking, Expiry
  tracking, multi-warehouse support, or automated supplier communication — all
  explicitly out of scope per the brief.
- No automatic linkage between a rejected Goods Receipt and the later replacement that
  resolves it — a person must mark the original `RESOLVED`; the system doesn't infer or
  enforce the connection.
- The Purchase Order status write remains a deliberate, documented exception to
  ADR-002's domain-ownership convention (see `docs/domains/inventory.md` §6) — its
  purpose shifted from "prevent duplicate receiving" (Sprint 4.4) to "prevent a race
  against a concurrent cancel" (this sprint), since duplicate/repeat receiving is now
  the intended behavior.
- Amounts are stored as `Float`, not an arbitrary-precision `Decimal` — same convention
  as every other domain in this schema.

## 5. Deferred / Future Work

Per `docs/roadmap.md` Phase 2, Production is the next module and is expected to build
directly on this sprint's ledger and receiving conventions: raw materials will be
`ISSUE`d to a production batch and finished output `RECEIPT`ed back into stock using the
same `InventoryTransaction` table. A future Inventory sprint may introduce
`ADJUSTMENT` for manual stock corrections, and a future Supplier Performance feature
(Epic 15) can calculate delivery accuracy/rejection rate/excess-or-short-supply
frequency directly from the `GoodsReceipt`/`discrepancyStatus` history this sprint
preserved — no schema change needed for that when it's built.
