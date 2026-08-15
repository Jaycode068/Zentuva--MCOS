# Inventory Domain

- **Status:** Goods Receiving implemented — Sprint 4.4 ("Inventory Management (Goods
  Receiving)"), refined Sprint 4.4.1 ("Goods Receiving, Inspection & Supplier
  Discrepancy Refinement").
- **Sprint:** 4.4, 4.4.1
- **Depends on:** [Identity](identity.md) (tenant boundary, authentication, `RolesGuard`),
  [Procurement](procurement.md) (every Goods Receipt receives an existing Purchase
  Order), [Product Catalogue](catalogue.md) (every stock balance/transaction/receipt line
  references a Product), [ADR-002 — Modular Monolith](../adr/ADR-002-modular-monolith.md),
  [ADR-003 — Multi-Tenancy](../adr/ADR-003-multi-tenancy.md)
- **See also:** [Sprint 4.4 Completion Report](../sprint-4.4-completion-report.md),
  [Sprint 4.4.1 Completion Report](../sprint-4.4.1-completion-report.md) for what was
  implemented and why.

## 1. Business Purpose

Inventory answers **"What do we physically have, and where did it come from?"** — Sprint
4.4 answered only the first half of that (record a delivery, increase stock). Real
receiving is messier: a truck rarely delivers exactly what was ordered, exactly on time,
in perfect condition. Sprint 4.4.1 closes that gap so Zentuva can accurately answer:

> "What did we order, what did the supplier actually deliver, what did we accept, what
> did we reject, what remains outstanding, and what happened to the discrepancy?"

Still **not** a stock management sprint — no warehouse transfers, stock adjustments, or
inventory counts (brief's Constraints, unchanged since 4.4) — and deliberately not a
Quality Management/Supplier Claims/Returns/Credit-Note system either (4.4.1's own
Architectural Constraints). This is the fourth non-Identity business domain module, and
the first to consume Procurement directly: every `GoodsReceipt` receives one
`PurchaseOrder` (Sprint 4.3), whose own items reference `Product` (Sprint 4.1).

## 2. Key Concepts / Entities

### GoodsReceipt

- **Responsibility:** records one physical delivery event against a Purchase Order.
- **Ownership:** owned by the Inventory domain (`apps/api/src/inventory/`). References
  `PurchaseOrder`/`Supplier` by id; no other domain writes to the
  `goods_receipts`/`goods_receipt_items` tables directly (ADR-002 domain-ownership rule).
- **Tenant scoping:** every `GoodsReceipt` belongs to exactly one `Organisation`
  (`organisationId`, `onDelete: Cascade`) — same convention as every other domain
  (identity.md §7).
- **Immutability, with one narrow exception:** there is no `PATCH`/`DELETE` endpoint for
  what was actually received (brief: "No editing. No deleting."). Sprint 4.4.1 added
  exactly one mutable pair of fields — `discrepancyStatus`/`discrepancyNotes` (see
  "Supplier Resolution" below) — reachable only via
  `PATCH /api/inventory/goods-receipts/:id/discrepancy`, which never touches
  `deliveredQuantity`/`rejectedQuantity`/`acceptedQuantity` or any other field.
- **Multiplicity:** Sprint 4.4.1 removed the original "received once" restriction — a
  Purchase Order may now have many `GoodsReceipt` rows (a short delivery followed later
  by the remainder, a rejected batch followed by a replacement, even a delivery against
  an already-fully-`RECEIVED` order — see "Receiving Rules" below).
- **Fields:** `goodsReceiptNumber` (auto-generated, immutable), `purchaseOrderId`
  (required), `supplierId` (denormalised from the Purchase Order at receiving time —
  never accepted on input), `receivedDate` (required), `receivedById` (always the
  authenticated caller), `remarks` (optional), `discrepancyStatus`
  (`DiscrepancyStatus`, default `NONE`), `discrepancyNotes` (optional).

### GoodsReceiptItem

- **Responsibility:** one line of a Goods Receipt — distinguishes what physically
  arrived from what passed inspection into usable stock.
- **Relationships:** belongs to one `GoodsReceipt` (`onDelete: Cascade`); references the
  specific `PurchaseOrderItem` it's delivering against (`purchaseOrderItemId`,
  `onDelete: Restrict`) — not just a `productId` — so "what was ordered" always reads
  from that row's own immutable `quantity`, never re-entered here. `productId` is
  denormalised from `purchaseOrderItem.productId` for convenient joins.
- **Fields (Sprint 4.4.1 redesign):**
  - `deliveredQuantity` — the physical quantity counted at receiving. May be less than
    ordered (short delivery), more than ordered (excess supply — never capped), or
    exactly ordered.
  - `rejectedQuantity` — the portion of `deliveredQuantity` rejected as defective,
    damaged, wrong item, etc. Defaults to `0`.
  - `acceptedQuantity` — `deliveredQuantity - rejectedQuantity`, always computed
    server-side by `InventoryService`, **never accepted from the client** (brief §12:
    "Do not allow the user to manually enter Accepted Quantity"). This is the only
    figure that ever increases `InventoryStock` or writes an `InventoryTransaction` —
    see "Important Business Rule" below.
  - `rejectionReason` (`RejectionReason?`) / `rejectionNotes` (optional free text) — set
    only when `rejectedQuantity > 0`.
- **Restriction:** `purchaseOrderItemId` must reference a line on the Purchase Order
  being received — enforced in `InventoryService.receiveGoods`, not the database, same
  "second line of defense behind the frontend" pattern `PurchaseOrderService` used for
  product-type restriction.

### RejectionReason

A simple structured enum for why a receiving inspector rejected some (or all) of a
delivered quantity — `DAMAGED`, `DEFECTIVE`, `WRONG_ITEM`, `WRONG_SPECIFICATION`,
`CONTAMINATED`, `OTHER` — plus a free-text `rejectionNotes` field. Deliberately not a
full Quality Management System (4.4.1 brief §4/§18).

### InventoryStock

- **Responsibility:** the live, queryable stock balance — one row per
  `(Organisation, Product)`.
- **Created lazily:** a product with no receiving history has no `InventoryStock` row at
  all; `GET /api/inventory/:productId` returns a synthesized zero-balance view in that
  case rather than `404`.
- **Relationship to the ledger:** per the Sprint 4.4 brief's "One Architectural
  Improvement," `InventoryStock` is a fast-to-query cache of where `InventoryTransaction`
  currently nets out — always re-derivable by summing that product's transactions, never
  the source of truth itself.
- **Important Business Rule (4.4.1):** inventory only ever increases by **Accepted**
  quantity, never **Delivered** quantity. A line that was entirely rejected
  (`acceptedQuantity === 0`) writes no stock/ledger row at all.

### InventoryTransaction

- **Responsibility:** the immutable stock ledger — every inventory movement, ever,
  insert-only, never updated or deleted.
- **`transactionType`:** `RECEIPT` | `ISSUE` | `ADJUSTMENT`. Inventory only ever writes
  `RECEIPT` rows so far, and only for the **accepted** portion of a receipt — rejected
  quantities never enter available stock and never produce a ledger row. `ISSUE`
  (Production consumption, Sales) and `ADJUSTMENT` (manual stock corrections) exist in
  the enum for forward-compatibility but no endpoint yet produces them — see "Future
  Production Consumption" below.
- **`quantity`** is always positive — direction is carried by `transactionType`.
- **`referenceType`/`referenceId`:** a polymorphic pointer to whatever business event
  produced the row (`"GoodsReceipt"` + the `GoodsReceipt.id`) — same shape as
  `AuditLog.entityType`/`entityId`, not a real foreign key.

### DiscrepancyStatus — Supplier Resolution

A lightweight, manually-progressed state on each `GoodsReceipt`, representing whether
_that specific receipt's_ shortfall/rejection still needs supplier resolution:

```
NONE
PENDING_SUPPLIER
REPLACEMENT_EXPECTED
REPLACEMENT_RECEIVED
CREDIT_EXPECTED
RESOLVED
```

Auto-set at creation: `PENDING_SUPPLIER` if any item on the receipt was rejected
(`rejectedQuantity > 0`), else `NONE`. It deliberately does **not** factor in whether the
receipt leaves the Purchase Order outstanding — a normal, defect-free partial delivery
in progress is not a "supplier dispute," so it stays `NONE`. Progressed afterward via
`PATCH /api/inventory/goods-receipts/:id/discrepancy` (Owner/Administrator only), which
also accepts free-text `discrepancyNotes`. This is deliberately **not** a Supplier
Claims/Returns/Credit-Note system — no automated supplier notification, no financial
claim, no return logistics (all explicitly out of scope, brief §5/§18). There is no
automatic linkage between a rejected receipt and a later replacement receipt that covers
it — a human marks the original `RESOLVED` once satisfied; the system only preserves the
state and history, never fabricates the connection.

### Goods Receipt Number

Format: `GRN-000001`, `GRN-000002`, ... (fixed `GRN` prefix + 6-digit zero-padded
sequence). Generated by `InventoryService`'s private number generator — the same
collision-avoidance loop shape as `PurchaseOrderService`/`SupplierService`/
`ProductService`'s generators, globally unique.

## 3. Receiving Rules

- **A Purchase Order is receivable in every status except `DRAFT` (never issued) and
  `CANCELLED` (called off) — including `RECEIVED` itself.** Sprint 4.4 originally
  blocked receiving once `RECEIVED`; Sprint 4.4.1 removed that block because a
  supplier's later replacement shipment must still be recordable against an order whose
  original delivery already fully met its ordered quantity (brief §6/§7). "Duplicate
  protection" no longer means "you can only receive once" — it means every `POST`
  creates its own new, immutable, uniquely-numbered `GoodsReceipt`; nothing is ever
  merged into or overwrites a prior one (brief §15 test #17: "Duplicate/repeated receipt
  protection must be redesigned around receipt identity rather than blocking all
  subsequent receipts").
- `CANCELLED` orders are rejected with a specific `400`; a `DRAFT` order (never issued)
  is rejected with a different `400`.
- Every submitted item must reference a `purchaseOrderItemId` that's actually on the
  order.
- Excess delivery (more than what's still outstanding) is explicitly **allowed and never
  capped** (brief §3 Scenario E) — the frontend flags it as "Excess Supply" for
  visibility, but the backend accepts it as-is.
- On success, inside one atomic transaction (see "Integration Points" below): a
  `GoodsReceipt` + items are created, `InventoryStock.quantityOnHand` increases by each
  item's **accepted** quantity (creating the row if it didn't exist), an
  `InventoryTransaction` `RECEIPT` row is appended per item with `acceptedQuantity > 0`,
  and the Purchase Order's status is recomputed (see "Purchase Order Status" below).

### Purchase Order Status

Governed purely by **delivery completeness** — cumulative `deliveredQuantity` (across
every receipt ever recorded) versus each item's ordered `quantity` — **not** by
acceptance/rejection:

- **Outstanding** (per item) = `max(0, ordered − cumulative delivered)`.
- **Excess** (per item) = `max(0, cumulative delivered − ordered)`.
- The order becomes `RECEIVED` once every item's outstanding is `0` — even if some of
  what was delivered was rejected. A receipt that fully meets the ordered quantity but
  includes a rejection still completes the order; the rejection is tracked separately
  via that receipt's own `discrepancyStatus`, not by keeping the order open.
- Otherwise, once at least one receipt has been recorded, the order is
  `PARTIALLY_RECEIVED`.
- This is why "Outstanding" and "Rejected" are independent figures — see the worked
  examples in `docs/domains/procurement.md`'s Purchase Order status section.

Once a Purchase Order reaches `PARTIALLY_RECEIVED`/`RECEIVED`, `PurchaseOrderService`
rejects further edits/cancellation (`docs/domains/procurement.md` §"Status") — its
items/supplier can no longer change without corrupting the ordered-quantity figures this
calculation depends on.

## 4. Workflows

- **Receive Goods** — `POST /api/inventory/goods-receipts` (Owner/Administrator only).
  The frontend's `GoodsReceivingDialog`: select an eligible Purchase Order → the dialog
  loads its full receiving history via `GET .../purchase-orders/:id/receiving`
  (Ordered/Previously Delivered/Accepted/Rejected/Outstanding per item, pre-filling
  Delivered Quantity to Outstanding) → the user enters this delivery's Delivered
  Quantity and, if applicable, Rejected Quantity + Reason + Notes → Save.
  `InventoryService.receiveGoods` validates eligibility and item membership, computes
  each item's `acceptedQuantity` and this receipt's `discrepancyStatus`, generates the
  `goodsReceiptNumber`, and delegates the atomic write to
  `GoodsReceiptRepository.receive`.
- **Resolve a Discrepancy** — `PATCH /api/inventory/goods-receipts/:id/discrepancy`
  (Owner/Administrator only). Progresses `discrepancyStatus`/`discrepancyNotes` on an
  existing receipt; never touches what was actually received. Surfaced in the frontend's
  Goods Receipts tab as an inline status selector + Update button next to each receipt
  that has a discrepancy.
- **View a Purchase Order's Receiving Summary** —
  `GET /api/inventory/purchase-orders/:purchaseOrderId/receiving` (any authenticated
  user). Returns the per-item Ordered/Delivered/Accepted/Rejected/Outstanding/Excess
  aggregate plus the full receipt history for that order — powers both the Goods
  Receiving dialog's "previously delivered" context and Procurement's own
  `PurchaseOrderDialog`, which embeds this same data as a read-only "Receiving Summary"
  table.
- **Browse Inventory Summary** — `GET /api/inventory` (any authenticated user, Member
  included — read-only). Accepts optional `?search=`, `?productType=`.
- **View one product's stock** — `GET /api/inventory/:productId`.
- **Browse the transaction ledger** — `GET /api/inventory/transactions`. Read-only,
  accepts optional `?productId=`, `?transactionType=`.
- **Browse Goods Receipts** — `GET /api/inventory/goods-receipts`; **view one** —
  `GET /api/inventory/goods-receipts/:id`. The frontend's Goods Receipts tab renders
  this as a read-only receiving history (brief §13): every receipt, its
  delivered/rejected/accepted breakdown per item, rejection reason/notes, and
  discrepancy status.

## 5. Authorization

Reuses `RolesGuard` exactly as every other domain does (identity.md §6, Sprint 2.1):

| Role          | Access                                             |
| ------------- | -------------------------------------------------- |
| Owner         | Full access (Receive Goods, resolve discrepancies) |
| Administrator | Full access (Receive Goods, resolve discrepancies) |
| Member        | Read-only (`GET` endpoints only)                   |

No permission-key engine — same minimal role-name check every other write surface in
this codebase uses.

## 6. Integration Points

- **Procurement** ([procurement.md](procurement.md)) — every `GoodsReceipt` references a
  `PurchaseOrder.id`; `InventoryService` validates eligibility via Procurement's exported
  `PurchaseOrderRepository` (no direct Prisma access to the `purchase_orders` table for
  _reads_). The Purchase Order's status write, however, happens as a **deliberate,
  narrow exception** inside `GoodsReceiptRepository.receive`'s own database transaction,
  writing to `purchase_orders` directly rather than going back through Procurement's
  repository/service. This is documented in that file's doc comment: Prisma's
  `$transaction` has no way to compose an externally-injected repository's own method
  into one atomic unit, and splitting the status write into a second call after the
  transaction commits would reintroduce the exact non-atomicity this design exists to
  avoid. Sprint 4.4.1 also changed _what_ the transaction's own conditional `updateMany`
  guards against: instead of matching only `PENDING`/`PARTIALLY_RECEIVED` (which would
  reject a legitimate replacement receipt against an already-`RECEIVED` order), it now
  matches every status except `DRAFT`/`CANCELLED` — its job is closing the race against
  a _concurrent cancel_, not blocking repeat receiving.
- **Product Catalogue** ([catalogue.md](catalogue.md)) — every stock/transaction/receipt
  line references `Product.id`, read directly (no write access).
- **Production (future, not yet built)** — the natural next consumer of the
  `InventoryTransaction` ledger: raw materials will be issued (`ISSUE`) to a production
  batch, and finished output will be received (`RECEIPT`) back into stock, using the same
  ledger this sprint established rather than a new one.
- **Supplier Management** ([suppliers.md](suppliers.md)) — the Supplier relationship is
  preserved on every `GoodsReceipt`/discrepancy record, so a future Supplier Performance
  feature can calculate delivery accuracy, rejection rate, excess/short-supply
  frequency, and replacement frequency from this history without a schema change. No
  such analytics exist yet (brief §11).

## 7. API Reference

| Endpoint                                                        | Auth                                           | Input                                                                                                                                                   | Output                                                                                                               |
| --------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `GET /api/inventory`                                            | Any authenticated user                         | Optional `?search=`, `?productType=`                                                                                                                    | `200 { items: InventoryStockSummary[] }`                                                                             |
| `GET /api/inventory/transactions`                               | Any authenticated user                         | Optional `?productId=`, `?transactionType=`                                                                                                             | `200 { items: InventoryTransaction[] }`                                                                              |
| `GET /api/inventory/goods-receipts`                             | Any authenticated user                         | Optional `?search=`, `?purchaseOrderId=`                                                                                                                | `200 { items: GoodsReceipt[] }`                                                                                      |
| `GET /api/inventory/goods-receipts/:id`                         | Any authenticated user                         | —                                                                                                                                                       | `200` — a single `GoodsReceipt`                                                                                      |
| `POST /api/inventory/goods-receipts`                            | Owner or Administrator only (`403` for Member) | `{ purchaseOrderId, receivedDate, remarks?, items: [{ purchaseOrderItemId, deliveredQuantity, rejectedQuantity, rejectionReason?, rejectionNotes? }] }` | `201` — the created `GoodsReceipt`; `400` if the order is `DRAFT`/`CANCELLED`; `404` if the order/item doesn't exist |
| `PATCH /api/inventory/goods-receipts/:id/discrepancy`           | Owner or Administrator only (`403` for Member) | `{ status, notes? }`                                                                                                                                    | `200` — the updated `GoodsReceipt`; `404` if it doesn't exist                                                        |
| `GET /api/inventory/purchase-orders/:purchaseOrderId/receiving` | Any authenticated user                         | —                                                                                                                                                       | `200` — per-item receiving summary + full receipt history; `404` if the order doesn't exist                          |
| `GET /api/inventory/:productId`                                 | Any authenticated user                         | —                                                                                                                                                       | `200` — a zero-balance view if the product has never been received; `404` if the product doesn't exist               |

Route order matters for the underlying Nest controller: `/transactions`,
`/goods-receipts`, and `/purchase-orders/:id/receiving` are literal-prefixed segments
declared before the `/:productId` wildcard, so they aren't accidentally matched as a
product id. Every write is scoped to the caller's own `organisationId` (from their JWT)
— a cross-tenant `id` 404s exactly like a nonexistent one. There is no `DELETE`
endpoint, and `PATCH` only ever touches `discrepancyStatus`/`discrepancyNotes` — never
what was actually received.

## 8. Audit Events

| Action                               | When                                                                                 |
| ------------------------------------ | ------------------------------------------------------------------------------------ |
| `goods-receipt.received`             | `POST /api/inventory/goods-receipts` — every call                                    |
| `inventory.increased`                | Same call, only when at least one item's `acceptedQuantity > 0`                      |
| `goods-receipt.discrepancy-recorded` | Same call, only when at least one item was rejected                                  |
| `goods-receipt.replacement-received` | Same call, only when this wasn't the first `GoodsReceipt` recorded against the order |
| `goods-receipt.resolved`             | `PATCH .../discrepancy`, only when the new status is `RESOLVED`                      |

Only these five events exist — no audit action was invented for functionality that
isn't actually implemented (brief §14).

## 9. Prisma Schema (excerpt)

```prisma
enum PurchaseOrderStatus {
  DRAFT
  PENDING
  APPROVED
  PARTIALLY_RECEIVED
  RECEIVED
  CANCELLED
}

model GoodsReceipt {
  id                 String            @id @default(cuid())
  organisationId     String
  goodsReceiptNumber String            @unique
  purchaseOrderId    String
  supplierId         String
  receivedDate       DateTime
  receivedById       String?
  remarks            String?
  discrepancyStatus  DiscrepancyStatus @default(NONE)
  discrepancyNotes   String?
  createdAt          DateTime          @default(now())
  updatedAt          DateTime          @updatedAt

  organisation  Organisation       @relation(fields: [organisationId], references: [id], onDelete: Cascade)
  purchaseOrder PurchaseOrder      @relation(fields: [purchaseOrderId], references: [id], onDelete: Restrict)
  supplier      Supplier           @relation(fields: [supplierId], references: [id], onDelete: Restrict)
  items         GoodsReceiptItem[]

  @@index([organisationId])
  @@index([organisationId, purchaseOrderId])
  @@map("goods_receipts")
}

enum RejectionReason {
  DAMAGED
  DEFECTIVE
  WRONG_ITEM
  WRONG_SPECIFICATION
  CONTAMINATED
  OTHER
}

model GoodsReceiptItem {
  id                  String           @id @default(cuid())
  goodsReceiptId      String
  purchaseOrderItemId String
  productId           String
  deliveredQuantity   Float
  rejectedQuantity    Float            @default(0)
  acceptedQuantity    Float
  rejectionReason     RejectionReason?
  rejectionNotes      String?
  createdAt           DateTime         @default(now())

  goodsReceipt      GoodsReceipt      @relation(fields: [goodsReceiptId], references: [id], onDelete: Cascade)
  purchaseOrderItem PurchaseOrderItem @relation(fields: [purchaseOrderItemId], references: [id], onDelete: Restrict)
  product           Product           @relation(fields: [productId], references: [id], onDelete: Restrict)

  @@index([goodsReceiptId])
  @@index([purchaseOrderItemId])
  @@index([productId])
  @@map("goods_receipt_items")
}

enum DiscrepancyStatus {
  NONE
  PENDING_SUPPLIER
  REPLACEMENT_EXPECTED
  REPLACEMENT_RECEIVED
  CREDIT_EXPECTED
  RESOLVED
}

model InventoryStock {
  id             String   @id @default(cuid())
  organisationId String
  productId      String
  quantityOnHand Float    @default(0)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  organisation Organisation @relation(fields: [organisationId], references: [id], onDelete: Cascade)
  product      Product      @relation(fields: [productId], references: [id], onDelete: Cascade)

  @@unique([organisationId, productId])
  @@index([organisationId])
  @@map("inventory_stock")
}

enum InventoryTransactionType {
  RECEIPT
  ISSUE
  ADJUSTMENT
}

model InventoryTransaction {
  id              String                   @id @default(cuid())
  organisationId  String
  productId       String
  transactionType InventoryTransactionType
  quantity        Float
  referenceType   String
  referenceId     String
  createdAt       DateTime                 @default(now())

  organisation Organisation @relation(fields: [organisationId], references: [id], onDelete: Cascade)
  product      Product      @relation(fields: [productId], references: [id], onDelete: Cascade)

  @@index([organisationId])
  @@index([organisationId, productId])
  @@index([referenceType, referenceId])
  @@map("inventory_transactions")
}
```

See migrations `20260813153410_add_inventory_goods_receiving` (Sprint 4.4) and
`20260813175301_refine_goods_receiving_discrepancy` (Sprint 4.4.1) for the exact SQL.

## 10. Future Production Consumption

Per the Sprint 4.4 brief's "One Architectural Improvement," `InventoryTransaction` is
meant to be the source of truth for every future stock movement, not just receiving:

- **Production** will `ISSUE` raw materials/packaging/consumables to a production batch
  (decreasing `InventoryStock`), and `RECEIPT` finished output back into stock once a
  batch completes.
- **Sales** will `ISSUE` finished goods as orders are fulfilled.
- **Stock Adjustment** (a future Inventory sprint) will use `ADJUSTMENT` for manual
  corrections — cycle counts, damage, shrinkage.

Every one of those is expected to write into the same `inventory_transactions` table
this sprint created, the same way every domain already writes into `AuditLog`
(identity.md §8) — no new ledger table, no bespoke movement-tracking per domain.

## 11. Known Limitations (Sprint 4.4.1)

- No Stock Adjustments, Warehouse Transfers, Multiple Warehouses, Inventory Counts,
  Production Consumption, Sales Deductions, Batch/Lot Tracking, or Expiry Tracking —
  explicitly out of scope, reserved for later Inventory and Production sprints.
- No Quality Management module, Supplier Claims module, Supplier Returns module,
  Accounts Payable, Credit Notes, or automated supplier communication — `discrepancyStatus`
  is deliberately lightweight (a status + free-text notes), not a workflow engine (brief
  §18).
- No automatic linkage between a rejected Goods Receipt and the later replacement that
  resolves it — a person must mark the original `RESOLVED`; the system doesn't infer or
  enforce the connection.
- The Purchase Order status write remains a deliberate, documented exception to
  ADR-002's domain-ownership convention (see `docs/domains/inventory.md` §6) — its
  purpose shifted from "prevent duplicate receiving" (Sprint 4.4) to "prevent a race
  against a concurrent cancel" (this sprint), since duplicate/repeat receiving is now
  the intended behavior.
- Amounts (`deliveredQuantity`, `rejectedQuantity`, `acceptedQuantity`,
  `quantityOnHand`, ledger `quantity`) are stored as `Float`, not an arbitrary-precision
  `Decimal` — same convention (and rationale) as Procurement's monetary fields.
