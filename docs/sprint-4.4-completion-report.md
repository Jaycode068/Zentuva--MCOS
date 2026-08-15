# Sprint 4.4 Completion Report — Inventory Management (Goods Receiving)

**Date:** 2026-08-13
**Status:** Complete

## 1. Objective

Implement the first part of the Inventory module: Goods Receiving. Record the physical
receipt of materials purchased through Purchase Orders, increase a live per-product stock
balance, and write an immutable stock-movement ledger — not a stock management sprint (no
warehouse transfers, stock adjustments, or inventory counts). Explicit brief
recommendation: make `InventoryTransaction` the source of truth for inventory movement
from day one, with `InventoryStock` as a fast-to-query cache of where that ledger nets
out.

## 2. Implementation Summary

### A fourth non-Identity domain, and the first to consume Procurement

`apps/api/src/inventory/` mirrors the Product Catalogue/Supplier Management/Procurement
modules' shape, but as a single cohesive module (not per-entity subfolders) covering
three related entities under one `/api/inventory` surface: `GoodsReceiptRepository`,
`InventoryStockRepository`, `InventoryTransactionRepository`, `InventoryService`,
`InventoryController`, `InventoryModule`. `InventoryService` injects `PurchaseOrderModule`
and `ProductModule`'s exported repositories (`PurchaseOrderRepository` newly exported this
sprint) to validate a Purchase Order and its items without duplicating Prisma access.

### Schema — two new models, plus a live-balance table and an immutable ledger

Migration `20260813153410_add_inventory_goods_receiving` adds `GoodsReceipt`/
`GoodsReceiptItem` (`onDelete: Cascade` from the parent Receipt, `onDelete: Restrict` on
its `PurchaseOrder`/`Supplier`/`Product` references), `InventoryStock`
(`@@unique([organisationId, productId])` — one row per product per tenant), and
`InventoryTransaction` with a new `InventoryTransactionType` enum
(`RECEIPT`/`ISSUE`/`ADJUSTMENT` — this sprint only ever writes `RECEIPT`). Key decisions:

- **`goodsReceiptNumber`** (`GRN-000001`, ...) — globally unique, immutable, same
  collision-avoidance generator pattern as `PurchaseOrder.purchaseOrderNumber`.
- **`InventoryStock` created lazily** — a product that's never been received has no row
  at all; `GET /api/inventory/:productId` synthesizes a zero-balance view instead of
  `404`ing, since "never received anything" is a normal state, not a missing resource.
- **`InventoryTransaction.quantity` is always positive** — direction is carried by
  `transactionType`, not sign, so a future `ISSUE` row reads naturally too.
- **`receivedById`** — plain id, no FK relation, same convention as
  `PurchaseOrder.createdById`/`AuditLog.actorUserId`; always the authenticated caller,
  never accepted as input.

### Receiving Rules — atomicity as the actual mechanism for "duplicate receipt prevention"

`InventoryService.receiveGoods` pre-validates (Purchase Order exists, is `PENDING` —
not `DRAFT`/`CANCELLED`/already-`RECEIVED` — and every submitted item's product is
actually on that order) before touching the database, then delegates the entire write to
`GoodsReceiptRepository.receive`, which runs inside one `$transaction`:

1. `purchaseOrder.updateMany({ where: { ..., status: PENDING }, data: { status: RECEIVED } })`
   — the `status: PENDING` in the `where` clause is the actual duplicate-receipt guard: a
   concurrent second attempt (or a retried request) matches zero rows here, and the whole
   transaction throws `GoodsReceiptConflictError` and rolls back before any stock is
   touched.
2. Create the `GoodsReceipt` + `GoodsReceiptItem` rows.
3. `inventoryStock.upsert` per item (increment `quantityOnHand`, creating the row if
   absent).
4. `inventoryTransaction.createMany` — one `RECEIPT` row per item, referencing the new
   `GoodsReceipt`.

**A deliberate, documented exception to ADR-002:** step 1 writes to Procurement's
`purchase_orders` table directly from inside Inventory's own transaction, rather than
calling back through `PurchaseOrderRepository`/`PurchaseOrderService`. This is because
Prisma's `$transaction` has no mechanism to compose an externally-injected repository's
own method into one atomic unit — splitting the status flip into a second call after this
transaction commits would reintroduce exactly the non-atomicity this design exists to
prevent (a Goods Receipt succeeding while the order stayed `PENDING`, or the reverse, if
the process crashed between the two calls). Documented in the repository's own doc
comment and in `docs/domains/inventory.md` §6.

### API and authorization — identical shape to every prior domain

`GET /api/inventory`, `GET /api/inventory/:productId`, `GET /api/inventory/transactions`,
`GET`/`POST /api/inventory/goods-receipts`, `GET /api/inventory/goods-receipts/:id`. `GET`
requires only authentication; the one write requires `@Roles('Owner', 'Administrator')`
via the existing `RolesGuard`. No `PATCH`/`DELETE` — Goods Receipts are immutable. Route
declaration order in `InventoryController` matters: `transactions` and `goods-receipts`
are literal segments declared _before_ the `:productId` wildcard route, so they aren't
accidentally matched as a product id.

### Frontend — `/settings/inventory`, reusing the Sprint 3.5 shell

- **Two-tab layout** (lightweight button-pair tabs, not a new shared `Tabs` primitive —
  matches this codebase's existing "each page owns its own simple tab switcher" pattern
  from `/settings/organisation`): **Inventory Summary** (Product, Product Type, Quantity
  On Hand, Last Updated; client-side search + Product Type filter) and **Transactions**
  (Date, Product, Type, Quantity, Reference; read-only).
- **`GoodsReceivingDialog`** — select an eligible (`PENDING`) Purchase Order from a
  `<select>`; on selection, `form.reset()` re-derives the items grid from that order's own
  lines (Product, read-only Expected Quantity, editable Received Quantity pre-filled to
  the expected figure) — no Add/Remove Row, since the brief's workflow is "system loads
  items," not free-form entry. Gated on the Purchase Orders query having loaded, same
  race-avoidance pattern `PurchaseOrderDialog` established in Sprint 4.3.
- **Workspace navigation** — "Inventory" in the sidebar and the `/workspace` dashboard's
  Platform Modules grid now point at `/settings/inventory` and lost their "Coming Soon"
  state; the Platform Status card shows Inventory `✓ Complete` with Production as the next
  "Coming Next" module.

### Seed data

One goods receipt, `GRN-000001`, fully receives `PO-000001` (Fresh Farms Ltd, Plantain,
2,000 kg — the brief's own worked example), bringing that order to `RECEIVED` and seeding
matching `InventoryStock`/`InventoryTransaction` rows. `PO-000002` (`DRAFT`) and
`PO-000003` (`CANCELLED`) are deliberately not receivable, so this is the only seed-time
receipt. `seedGoodsReceipts` mirrors `GoodsReceiptRepository.receive`'s transaction
directly against Prisma (the seed script runs outside the NestJS DI container, same
convention as every other seed function) and is idempotent on re-run — verified by running
`pnpm db:seed` twice in a row with no errors and no duplicate rows.

## 3. Testing / Verification Performed

- Full monorepo quality gate: `pnpm lint`, `pnpm type-check`, `pnpm test`, `pnpm build`
  all green on the first pass — no bugs were found during this sprint's own verification
  (unlike Sprint 4.3, which found three). 187/187 backend unit tests pass (169
  pre-existing + 18 new: `InventoryService` — GRN number generation/collision, PENDING-
  only eligibility with distinct rejection messages for cancelled/already-received/draft,
  item-not-on-order rejection, conflict-error translation, zero-balance-view vs. 404
  branches; `InventoryController` — list/filter pass-through, audit-entry assertions for
  both `goods-receipt.received` and `inventory.increased`).
- Live end-to-end browser verification against freshly restarted dev servers (API +
  web, `.next` cache cleared per this session's established convention):
  1. `/settings/inventory` renders with "Inventory" active in the sidebar (no "Coming
     Soon"); Inventory Summary tab shows the seeded `Plantain` row (2000 Kilogram, Raw
     Material) with search and Product Type filter controls present.
  2. Transactions tab shows the matching seeded `RECEIPT` row (Plantain, 2000 Kilogram,
     reference `GoodsReceipt`).
  3. Opening "Receive Goods" with no eligible orders correctly showed "No purchase orders
     are currently eligible…" (every seeded PO was already `RECEIVED`/`DRAFT`/`CANCELLED`
     at that point).
  4. Created a new Purchase Order (`PO-000007`, Salt Masters Ltd, Salt × 500 @ ₦200),
     edited its status to `Pending`, then used "Receive Goods": selecting `PO-000007`
     correctly auto-loaded Supplier "Salt Masters Ltd" and one item row ("Salt (Kilogram)"
     — 500 expected, pre-filled to 500). Changed the received quantity to 480 (a
     deliberate discrepancy from the ordered 500) and saved.
  5. Verified the result live: Inventory Summary immediately showed a new "Salt" row at
     480 Kilogram; `/settings/procurement` showed `PO-000007` transitioned to `Received`.
  6. Re-opened "Receive Goods": the dialog again showed "No purchase orders are currently
     eligible" — `PO-000007` was no longer offered, confirming the frontend-level
     duplicate-receipt guard.
  7. No console errors from the application itself.
  8. Mobile viewport (375px): sidebar collapses to hamburger, tabs/filters stack, and the
     summary table scrolls horizontally inside its own container with no page-level
     horizontal scroll (screenshot captured).
- Manual API verification (`curl`) directly against the live backend:
  - **Duplicate-receipt prevention (server-side)**: `POST .../goods-receipts` against the
    now-`RECEIVED` `PO-000007` → `400 "This purchase order has already been received"`.
  - **Cancelled-PO rejection**: `POST .../goods-receipts` against `PO-000003`
    (`CANCELLED`) → `400 "Cancelled purchase orders cannot be received"`.
  - **RBAC**: Member `GET /api/inventory` → `200`; Member
    `POST /api/inventory/goods-receipts` → `403`.
  - **Tenant isolation**: registered a fresh isolation-test tenant
    ("Sprint44 Isolation Test") via `POST /api/auth/register` and confirmed its token
    gets `{"items":[]}` from `GET /api/inventory` (a different organisation's stock is
    invisible), `404` fetching a Boby Bites `GoodsReceipt` id, and `404` fetching a Boby
    Bites `Product` id via `GET /api/inventory/:productId` (product-existence check is
    also tenant-scoped, not just the stock lookup) — no cross-tenant read, write, or
    existence leak anywhere in the domain.
  - **Audit logging**: queried the `audit_logs` table directly after the live receive
    (step 4 above) and confirmed both events recorded correctly for the same
    `GoodsReceipt` id: `goods-receipt.received` (metadata: `goodsReceiptNumber`,
    `purchaseOrderId`, `purchaseOrderNumber`) and `inventory.increased` (metadata: an
    `items` array with `productId`/`productName`/`quantityReceived`).
  - **Database migration + seed**: `prisma migrate dev` applied cleanly; `pnpm db:seed`
    run twice in a row produced identical output both times (`goodsReceiptsSeeded: 1`),
    confirming the idempotent-skip logic (existing-GRN-number check, then
    no-longer-`PENDING` check) works as designed.

## 4. Known Limitations

- No Stock Adjustments, Warehouse Transfers, Multiple Warehouses, Inventory Counts,
  Production Consumption, Sales Deductions, Returns, Batch/Lot Tracking, or Expiry
  Tracking — all explicitly out of scope per the brief, reserved for later Inventory and
  Production sprints.
- A Purchase Order can only be received once, in full, in one event — no partial
  receiving across multiple receipts, and no discrepancy workflow when the received
  quantity differs from the ordered quantity (the received figure is simply what gets
  recorded and added to stock, as exercised live in verification step 4 above).
- The Purchase Order status flip to `RECEIVED` writes to Procurement's table directly
  from inside `GoodsReceiptRepository`'s own transaction — a deliberate, documented
  exception to ADR-002's domain-ownership convention, made for atomicity (see
  "Implementation Summary" above and `docs/domains/inventory.md` §6).
- Amounts (`quantityReceived`, `quantityOnHand`, ledger `quantity`) are stored as
  `Float`, not an arbitrary-precision `Decimal` — same convention (and rationale) as
  every other domain in this schema.

## 5. Deferred / Future Work

Per `docs/roadmap.md` Phase 2, Production is the next module, and is expected to build
directly on this sprint's ledger: raw materials will be `ISSUE`d to a production batch,
and finished output will be `RECEIPT`ed back into stock, writing into the same
`inventory_transactions` table this sprint created rather than a new bespoke ledger. Sales
will later `ISSUE` finished goods, and a future Inventory sprint will introduce
`ADJUSTMENT` for manual stock corrections (cycle counts, damage, shrinkage) — both
enum values already exist, unused, reserved for that work.
