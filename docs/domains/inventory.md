# Inventory Domain

- **Status:** Goods Receiving implemented — Sprint 4.4 ("Inventory Management (Goods
  Receiving)"), refined Sprint 4.4.1 ("Goods Receiving, Inspection & Supplier
  Discrepancy Refinement"), extended Sprint 4.5 ("Inventory Control & Stock Management")
  with physical locations and controlled manual stock adjustments, extended Sprint 8
  ("Procurement, Inventory & Accounting Integration") with automatic accounting posting
  and idempotency protection on Goods Receipt, extended Sprint 9 ("Manufacturing
  Accounting Integration") with a persisted moving-weighted-average costing engine
  (`InventoryStock.averageUnitCost`) that Production's Material Issue/Completion
  postings consume, extended Sprint 10 ("Sales Fulfilment & COGS Accounting
  Integration") with Sales Fulfilment as a second reader of that same costing engine.
- **Sprint:** 4.4, 4.4.1, 4.5, 8, 9, 10
- **Depends on:** [Identity](identity.md) (tenant boundary, authentication, `RolesGuard`),
  [Procurement](procurement.md) (every Goods Receipt receives an existing Purchase
  Order), [Product Catalogue](catalogue.md) (every stock balance/transaction/receipt line
  references a Product), [Production](production.md) (Sprint 9 — Material Issue reads,
  and Production Completion writes, `InventoryStock.averageUnitCost`),
  [Sales](sales.md) (Sprint 10 — Sales Fulfilment reads
  `InventoryStock.averageUnitCost`), [Accounting](accounting.md) (Sprint 8/9/10 —
  `postSystemJournalEntry`, a plain function import, not a module dependency),
  [ADR-002 — Modular Monolith](../adr/ADR-002-modular-monolith.md),
  [ADR-003 — Multi-Tenancy](../adr/ADR-003-multi-tenancy.md)
- **See also:** [Sprint 4.4 Completion Report](../sprint-4.4-completion-report.md),
  [Sprint 4.4.1 Completion Report](../sprint-4.4.1-completion-report.md),
  [Sprint 4.5 Completion Report](../sprint-4.5-completion-report.md),
  [Sprint 8 Completion Report](../sprint-8-completion-report.md),
  [Sprint 9 Completion Report](../sprint-9-completion-report.md),
  [Sprint 10 Completion Report](../sprint-10-completion-report.md) for what was
  implemented and why.

## 1. Business Purpose

Inventory answers **"What do we physically have, and where did it come from?"** — Sprint
4.4 answered only the first half of that (record a delivery, increase stock). Real
receiving is messier: a truck rarely delivers exactly what was ordered, exactly on time,
in perfect condition. Sprint 4.4.1 closes that gap so Zentuva can accurately answer:

> "What did we order, what did the supplier actually deliver, what did we accept, what
> did we reject, what remains outstanding, and what happened to the discrepancy?"

Sprint 4.5 answers the next question: **"Where is it, and can we correct it when the
system and the shelf disagree?"** It adds a minimal notion of physical location (every
balance is now `Organisation + Product + Location`, not just `Organisation + Product`)
and a single controlled write for manual corrections (`ADJUSTMENT`), so a physical stock
count can be reconciled without ever bypassing the ledger. It deliberately stays an MVP
foundation, not a full Warehouse Management System — no bins/shelves/zones, no
barcode/RFID, no transfers between locations, no reservation/allocation workflow, and no
valuation (FIFO/weighted-average/COGS) — those are explicitly deferred (see "Known
Limitations" below). This is the fourth non-Identity business domain module, and the
first to consume Procurement directly: every `GoodsReceipt` receives one `PurchaseOrder`
(Sprint 4.3), whose own items reference `Product` (Sprint 4.1).

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
  never accepted on input), `locationId` (Sprint 4.5 — the physical location this
  delivery was received into; always resolved server-side to the organisation's default
  location, since the Goods Receiving form has no location picker — see "Location" below
  and Known Limitations), `receivedDate` (required), `receivedById` (always the
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

### InventoryLocation (Sprint 4.5)

- **Responsibility:** a minimal physical location a Product's stock can sit at — "Main
  Warehouse," "Cold Storage," etc. Not a full Warehouse Management concept: no bins,
  shelves, zones, barcodes, or capacity — just a name and a status.
- **Default location, created lazily:** every organisation needs at least one active
  location for Goods Receiving/Adjustments to fall back to. Rather than hooking this into
  Identity's organisation-registration flow (a cross-domain change outside Inventory's
  own ownership — ADR-002), `InventoryLocationRepository.getOrCreateDefault` creates
  "Main Warehouse" lazily, idempotently, the first time any organisation actually needs
  one — whether that's its first Goods Receipt, its first Adjustment, or an
  Owner/Administrator opening the Locations tab.
- **No delete, only deactivate:** `status: ACTIVE | INACTIVE` — same "retire, never
  remove" convention as `Supplier`/`Product` (reusing their exact enum values). The
  default location can be renamed but can never be deactivated — Goods Receiving and
  Adjustments both silently fall back to it when no location is specified, so taking it
  offline would strand every caller that doesn't pick one explicitly.
- **Fields:** `name`, `status` (`LocationStatus`, default `ACTIVE`), `isDefault`
  (`Boolean`, exactly one `true` row per organisation), `createdById`/`updatedById`.

### InventoryStock

- **Responsibility:** the live, queryable stock balance — one row per
  `(Organisation, Product, Location)` (Sprint 4.5 — previously `(Organisation, Product)`
  before locations existed).
- **Created lazily:** a product with no receiving/adjustment history at a given location
  has no `InventoryStock` row there at all. `GET /api/inventory/:productId` aggregates
  across every location the product has stock at into one summed view (sum of
  `quantityOnHand`, sum of `quantityReserved`) — this endpoint predates locations and
  existing callers expect a single balance per product, not one row per location. It
  still returns a synthesized zero-balance view (not `404`) when the product exists but
  has no stock anywhere.
- **Relationship to the ledger:** per the Sprint 4.4 brief's "One Architectural
  Improvement," `InventoryStock` is a fast-to-query cache of where `InventoryTransaction`
  currently nets out — always re-derivable by summing that product's transactions, never
  the source of truth itself. Every write to this table happens as a side effect of
  first writing an `InventoryTransaction` row, inside the same database transaction —
  `GoodsReceiptRepository.receive` (receiving) and `InventoryStockRepository.adjustStock`
  (corrections) are the only two write paths.
- **Important Business Rule (4.4.1, unchanged by 4.5):** inventory only ever increases by
  **Accepted** quantity, never **Delivered** quantity. A line that was entirely rejected
  (`acceptedQuantity === 0`) writes no stock/ledger row at all.
- **`quantityReserved`/`quantityAvailable` (Sprint 4.5):** the schema carries
  `quantityReserved` (always `0` today) so a future Sales/Production reservation
  workflow doesn't need a shape change; `quantityAvailable` is computed
  (`quantityOnHand - quantityReserved`), never stored. Reservation itself is **not**
  implemented this sprint — see Known Limitations.
- **Negative-stock guard:** any write that would leave `quantityOnHand < 0` is rejected
  (`NegativeStockError` → `400`), never silently clamped to zero.

### AdjustmentReason (Sprint 4.5)

A small controlled enum for why a manual stock correction was made — `PHYSICAL_COUNT`,
`DAMAGE`, `SPOILAGE`, `LOSS`, `FOUND_STOCK`, `DATA_CORRECTION`, `OTHER` — paired with a
free-text `notes` field on the `InventoryTransaction` row itself. Same "structured reason

- free text, not a full workflow engine" convention as `RejectionReason`.

### InventoryTransaction

- **Responsibility:** the immutable stock ledger — every inventory movement, ever,
  insert-only, never updated or deleted. Remains the sole authoritative source of stock
  history; `InventoryStock` is only ever a derived cache of it.
- **`transactionType`:** `RECEIPT` | `ISSUE` | `ADJUSTMENT`. Inventory writes `RECEIPT`
  rows for the **accepted** portion of a Goods Receipt, and — Sprint 4.5 — `ADJUSTMENT`
  rows for manual corrections via `POST /api/inventory/adjustments`. `ISSUE` has no
  endpoint of its own in this module — deliberately not added (brief: "do not add a
  generic 'remove stock' button"). Instead, `ISSUE` is written directly by the two
  domains that have a real business operation to attach it to, each inside its own
  self-owned atomic transaction (a narrow, documented exception to ADR-002 — see "Future
  Production Consumption" below): **Production** (`ProductionMaterialIssueRepository.
issue`, `referenceType: 'ProductionMaterialIssue'`, Sprint 4.6) and **Sales**
  (`SalesFulfilmentRepository.create`, `referenceType: 'SalesFulfilment'`, Sprint 4.9).
  One shared ledger, no bespoke per-domain movement table.
- **`quantity`:** positive for `RECEIPT` (direction carried by `transactionType`), but
  **signed** for `ADJUSTMENT` — a positive delta increases stock, a negative delta
  decreases it. This is the one place in the ledger where `quantity`'s sign itself
  carries meaning, since an adjustment can go either direction and the running-balance
  view (frontend Transactions tab) sums `quantity` directly across every row.
- **`referenceType`/`referenceId`:** a polymorphic pointer to whatever business event
  produced the row (`"GoodsReceipt"` + the `GoodsReceipt.id` for receipts; `"ManualAdjustment"`
  with a `null` `referenceId` for adjustments, since a manual correction has no other
  entity to point at) — same shape as `AuditLog.entityType`/`entityId`, not a real
  foreign key.
- **`locationId` (Sprint 4.5):** every transaction now records which location it moved
  stock at. **`adjustmentReason`/`notes`/`createdById` (Sprint 4.5):** populated only on
  `ADJUSTMENT` rows — `createdById` is the actor who made the correction (receipts
  already have this via the owning `GoodsReceipt.receivedById`, so it wasn't needed
  there until now).

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
- **Location (Sprint 4.5):** every receipt is recorded into the organisation's default
  location, resolved server-side via `InventoryLocationRepository.getOrCreateDefault`.
  There is deliberately no location picker on the Goods Receiving form this sprint — the
  brief's own instruction was to extend locations "without breaking the existing flow,"
  so the existing single-field form stays unchanged rather than gaining a new required
  input.

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
  included — read-only). Accepts optional `?search=`, `?productType=`, `?productStatus=`
  (Sprint 4.5 — the Product Catalogue's own Draft/Active/Archived status, filtered via a
  join, not a column on this table), `?locationId=`. The frontend's Inventory Summary
  table (Sprint 4.5) adds Code/Type/UoM/Location/Quantity Available/Last Movement
  columns alongside the original Product/Quantity On Hand/Last Updated.
- **View one product's stock** — `GET /api/inventory/:productId` — aggregated across
  every location (see `InventoryStock` above).
- **Browse the transaction ledger** — `GET /api/inventory/transactions`. Read-only,
  accepts optional `?productId=`, `?transactionType=`. The frontend's Transactions tab
  (Sprint 4.5) shows a client-computed running balance once filtered to a single
  product — see "Known Limitations" for why this isn't a separate endpoint.
- **Browse Goods Receipts** — `GET /api/inventory/goods-receipts`; **view one** —
  `GET /api/inventory/goods-receipts/:id`. The frontend's Goods Receipts tab renders
  this as a read-only receiving history (brief §13): every receipt, its
  delivered/rejected/accepted breakdown per item, rejection reason/notes, and
  discrepancy status.
- **Adjust Stock (Sprint 4.5)** — `POST /api/inventory/adjustments`
  (Owner/Administrator only). The frontend's `StockAdjustmentDialog`: pick a Product and
  Location (defaulting to the organisation's default location), an Adjustment Type
  (Increase/Decrease) and a positive Quantity, and a Reason (+ optional Notes) — the
  dialog live-computes and displays `New Balance = current + signed delta` before
  submission, and disables Save if that would go negative. `InventoryService.adjustStock`
  resolves the product and location (rejecting an inactive location), then delegates the
  atomic negative-stock-guarded write to `InventoryStockRepository.adjustStock`, which
  re-reads the current balance _inside_ the transaction (not from a pre-check) so two
  concurrent adjustments can't both pass a stale guard. There is no field for typing a
  new absolute balance directly — only the signed delta, so every correction is
  traceable to a reason in the ledger.
- **Manage Locations (Sprint 4.5)** — `GET/POST /api/inventory/locations`,
  `PATCH /api/inventory/locations/:id`. The frontend's Locations tab lists every
  location with its status and how many distinct products currently have stock there;
  Owner/Administrator can add a new location or rename/deactivate an existing one
  (never the default, and never delete). Member has read-only access, same convention
  as every other write surface in this domain.

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
  line references `Product.id`, read directly (no write access). Sprint 4.7 added an
  optional `ProductFamily → ProductVariant` grouping on top of `Product`; `InventoryStock`
  continues to be keyed to `(Organisation, Product, Location)` exactly as before — stock
  for two SKUs in the same family/variant (e.g. two pack sizes of the same recipe) is
  never combined into one balance. Family-level aggregation (e.g. "total stock across
  every pack size of this variant") is a future reporting capability, not something this
  table computes today.
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

| Endpoint                                                        | Auth                                           | Input                                                                                                                                                                       | Output                                                                                                                                                    |
| --------------------------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/inventory`                                            | Any authenticated user                         | Optional `?search=`, `?productType=`                                                                                                                                        | `200 { items: InventoryStockSummary[] }`                                                                                                                  |
| `GET /api/inventory/transactions`                               | Any authenticated user                         | Optional `?productId=`, `?transactionType=`                                                                                                                                 | `200 { items: InventoryTransaction[] }`                                                                                                                   |
| `GET /api/inventory/goods-receipts`                             | Any authenticated user                         | Optional `?search=`, `?purchaseOrderId=`                                                                                                                                    | `200 { items: GoodsReceipt[] }`                                                                                                                           |
| `GET /api/inventory/goods-receipts/:id`                         | Any authenticated user                         | —                                                                                                                                                                           | `200` — a single `GoodsReceipt`                                                                                                                           |
| `POST /api/inventory/goods-receipts`                            | Owner or Administrator only (`403` for Member) | `{ purchaseOrderId, receivedDate, remarks?, items: [{ purchaseOrderItemId, deliveredQuantity, rejectedQuantity, rejectionReason?, rejectionNotes? }] }`                     | `201` — the created `GoodsReceipt`; `400` if the order is `DRAFT`/`CANCELLED`; `404` if the order/item doesn't exist                                      |
| `PATCH /api/inventory/goods-receipts/:id/discrepancy`           | Owner or Administrator only (`403` for Member) | `{ status, notes?, resolutionAction? }` (Sprint 11: `resolutionAction` accepts only the manual values)                                                                      | `200` — the updated `GoodsReceipt`; `404` if it doesn't exist                                                                                             |
| `GET /api/inventory/supplier-returns`                           | Any authenticated user                         | Optional `?supplierId=`, `?purchaseOrderId=`, `?goodsReceiptId=`, `?search=` (Sprint 11)                                                                                    | `200 { items: SupplierReturn[] }`                                                                                                                         |
| `GET /api/inventory/supplier-returns/:id`                       | Any authenticated user                         | — (Sprint 11)                                                                                                                                                               | `200` — a single `SupplierReturn`                                                                                                                         |
| `POST /api/inventory/supplier-returns`                          | Owner or Administrator only (`403` for Member) | `{ purchaseOrderId, goodsReceiptId, locationId, returnDate, reason, reasonNotes?, notes?, idempotencyKey?, items: [{ goodsReceiptItemId, quantityReturned }] }` (Sprint 11) | `201` — the created `SupplierReturn` + `journalEntry`; atomic, posts the excess/payable-split reversal journal                                            |
| `GET /api/inventory/purchase-orders/:purchaseOrderId/receiving` | Any authenticated user                         | —                                                                                                                                                                           | `200` — per-item receiving summary + full receipt history; `404` if the order doesn't exist                                                               |
| `GET /api/inventory/locations`                                  | Any authenticated user                         | —                                                                                                                                                                           | `200 { items: InventoryLocation[] }`                                                                                                                      |
| `POST /api/inventory/locations`                                 | Owner or Administrator only (`403` for Member) | `{ name }`                                                                                                                                                                  | `201` — the created `InventoryLocation`                                                                                                                   |
| `PATCH /api/inventory/locations/:id`                            | Owner or Administrator only (`403` for Member) | `{ name?, status? }`                                                                                                                                                        | `200` — the updated `InventoryLocation`; `400` if trying to deactivate the default location; `404` if not found                                           |
| `POST /api/inventory/adjustments`                               | Owner or Administrator only (`403` for Member) | `{ productId, locationId?, quantity, reason, notes? }`                                                                                                                      | `201` — the resulting balance/transaction; `400` if the result would be negative or the location is inactive; `404` if the product/location doesn't exist |
| `GET /api/inventory/:productId`                                 | Any authenticated user                         | —                                                                                                                                                                           | `200` — a zero-balance view if the product has never been received; `404` if the product doesn't exist                                                    |

Route order matters for the underlying Nest controller: `/locations`, `/adjustments`,
`/transactions`, `/goods-receipts`, and `/purchase-orders/:id/receiving` are
literal-prefixed segments declared before the `/:productId` wildcard, so they aren't
accidentally matched as a product id. Every write is scoped to the caller's own `organisationId` (from their JWT)
— a cross-tenant `id` 404s exactly like a nonexistent one. There is no `DELETE`
endpoint, and `PATCH` only ever touches `discrepancyStatus`/`discrepancyNotes` — never
what was actually received.

## 8. Audit Events

| Action                                 | When                                                                                         |
| -------------------------------------- | -------------------------------------------------------------------------------------------- |
| `goods-receipt.received`               | `POST /api/inventory/goods-receipts` — every call                                            |
| `inventory.increased`                  | Same call, only when at least one item's `acceptedQuantity > 0`                              |
| `goods-receipt.discrepancy-recorded`   | Same call, only when at least one item was rejected                                          |
| `goods-receipt.replacement-received`   | Same call, only when this wasn't the first `GoodsReceipt` recorded against the order         |
| `goods-receipt.journal-entry-posted`   | Same call, only when a Journal Entry was actually posted (Sprint 8)                          |
| `goods-receipt.resolved`               | `PATCH .../discrepancy`, only when the new status is `RESOLVED`                              |
| `inventory.adjusted`                   | `POST /api/inventory/adjustments` — every call                                               |
| `inventory.location.created`           | `POST /api/inventory/locations` — every call                                                 |
| `inventory.location.updated`           | `PATCH /api/inventory/locations/:id`, when the new status isn't `INACTIVE`                   |
| `inventory.location.deactivated`       | `PATCH /api/inventory/locations/:id`, only when the new status is `INACTIVE`                 |
| `supplier-return.created`              | `POST /api/inventory/supplier-returns` — every fresh call (Sprint 11)                        |
| `supplier-return.journal-entry-posted` | Same call, only when a non-zero-value reversal Journal Entry was actually posted (Sprint 11) |

No audit action was invented for functionality that isn't actually implemented
(Sprint 4.4.1 brief §14, extended Sprint 4.5, extended Sprint 8, extended Sprint 11).
Sprint 8 also gates every event on this list fired from `POST .../goods-receipts` on
`wasCreated === true` — an idempotent replay (a retried request with the same
`idempotencyKey`) re-emits none of them; Sprint 11's own `supplier-return.*` events
follow the identical convention.

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
  locationId         String
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
  location      InventoryLocation  @relation(fields: [locationId], references: [id], onDelete: Restrict)
  items         GoodsReceiptItem[]

  @@index([organisationId])
  @@index([organisationId, purchaseOrderId])
  @@index([locationId])
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

enum LocationStatus {
  ACTIVE
  INACTIVE
}

model InventoryLocation {
  id             String         @id @default(cuid())
  organisationId String
  name           String
  status         LocationStatus @default(ACTIVE)
  isDefault      Boolean        @default(false)
  createdById    String?
  updatedById    String?
  createdAt      DateTime       @default(now())
  updatedAt      DateTime       @updatedAt

  organisation Organisation           @relation(fields: [organisationId], references: [id], onDelete: Cascade)
  goodsReceipts GoodsReceipt[]
  stock        InventoryStock[]
  transactions InventoryTransaction[]

  @@index([organisationId])
  @@index([organisationId, status])
  @@map("inventory_locations")
}

model InventoryStock {
  id               String   @id @default(cuid())
  organisationId   String
  productId        String
  locationId       String
  quantityOnHand   Float    @default(0)
  quantityReserved Float    @default(0)
  averageUnitCost  Float    @default(0)  // Sprint 9 — see §11b
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  organisation Organisation      @relation(fields: [organisationId], references: [id], onDelete: Cascade)
  product      Product           @relation(fields: [productId], references: [id], onDelete: Cascade)
  location     InventoryLocation @relation(fields: [locationId], references: [id], onDelete: Restrict)

  @@unique([organisationId, productId, locationId])
  @@index([organisationId])
  @@index([locationId])
  @@map("inventory_stock")
}

enum InventoryTransactionType {
  RECEIPT
  ISSUE
  ADJUSTMENT
}

enum AdjustmentReason {
  PHYSICAL_COUNT
  DAMAGE
  SPOILAGE
  LOSS
  FOUND_STOCK
  DATA_CORRECTION
  OTHER
}

model InventoryTransaction {
  id               String                   @id @default(cuid())
  organisationId   String
  productId        String
  locationId       String
  transactionType  InventoryTransactionType
  quantity         Float
  referenceType    String
  referenceId      String?
  adjustmentReason AdjustmentReason?
  notes            String?
  createdById      String?
  createdAt        DateTime                 @default(now())

  organisation Organisation      @relation(fields: [organisationId], references: [id], onDelete: Cascade)
  product      Product           @relation(fields: [productId], references: [id], onDelete: Cascade)
  location     InventoryLocation @relation(fields: [locationId], references: [id], onDelete: Restrict)

  @@index([organisationId])
  @@index([organisationId, productId])
  @@index([referenceType, referenceId])
  @@index([locationId])
  @@map("inventory_transactions")
}
```

See migrations `20260813153410_add_inventory_goods_receiving` (Sprint 4.4),
`20260813175301_refine_goods_receiving_discrepancy` (Sprint 4.4.1), and
`20260815100007_add_inventory_locations_and_stock_adjustments` (Sprint 4.5) for the exact
SQL.

## 10. Future Production Consumption

Per the Sprint 4.4 brief's "One Architectural Improvement," `InventoryTransaction` is
the source of truth for every stock movement, not just receiving — now realized by two
domains:

- **Production** (Sprint 4.6) `ISSUE`s raw materials/packaging/consumables to a
  production batch (decreasing `InventoryStock`), and `RECEIPT`s finished output back
  into stock once a batch completes.
- **Sales** (Sprint 4.9) `ISSUE`s finished goods as orders are fulfilled — see
  [sales.md](sales.md) §4a "Fulfilment."

`ADJUSTMENT` (Sprint 4.5) already writes into this same `inventory_transactions` table
for manual corrections — cycle counts, damage, shrinkage — so `RECEIPT`/`ISSUE`/
`ADJUSTMENT` all now share one ledger, the same way every domain already writes into
`AuditLog` (identity.md §8). No new ledger table, no bespoke movement-tracking per
domain.

## 11a. Accounting Integration (Sprint 8)

`GoodsReceiptRepository.receive()` now posts a Journal Entry (`DR Inventory` for the
full accepted value, split across `CR Accounts Payable`/`CR GRNI — Pending Approval`
per the accepted-vs-payable rule — see [Accounting](accounting.md) §9) inside the same
`$transaction` that writes the `GoodsReceipt`/`InventoryStock`/`InventoryTransaction`
rows, via a plain function import (`postSystemJournalEntry`, not a NestJS module
dependency — `InventoryModule` gains no new `imports` entry). If the receipt's date has
no open accounting period, or a required system account is missing, the **entire**
receipt rolls back — inventory can never increase while accounting silently fails.

`GoodsReceipt` also gained `idempotencyKey String?` +
`@@unique([purchaseOrderId, idempotencyKey])` this sprint — closing a gap every other
Sprint 6/7 write path already had: a retried `POST /goods-receipts` with the same key
against the same Purchase Order now returns the original receipt instead of creating a
second one, a second `InventoryStock` increment, and a second Journal Entry.

Each `GoodsReceiptItem` also gained `payableQuantity` — see
[Accounting](accounting.md) §9.2 for the full accepted-vs-payable computation. The
`GET`/`POST /goods-receipts` responses include a `journalEntry` field
(`{ id, journalNumber, status, totalAmount } | null`) so Procurement/Inventory UI can
show the linked accounting entry without a second round trip.

## 11b. Costing Engine & Production Accounting Integration (Sprint 9, extended Sprint 10)

Sprint 9 adds `InventoryStock.averageUnitCost Float @default(0)` — **the first
persisted inventory valuation figure in this codebase.** Sprint 8's Goods Receipt
posting (§11a) computed a monetary value for the accounting _event_ but never stored a
reusable cost; Material Issue structurally needs one (it consumes from a stock pile
that may have been built up from many receipts at different prices, with nothing
persisted to read). `averageUnitCost` is a moving weighted average per
`(organisation, product, location)`:

```
newAvgCost = (existingQty × existingAvgCost + receivedQty × receivedUnitCost)
             / (existingQty + receivedQty)
```

- **Writers:** `GoodsReceiptRepository.receive()` (extended this sprint — on a first
  receipt into empty stock, the formula degenerates to `receivedUnitCost`, byte-identical
  to what Sprint 8 already posted to the journal) and
  `ProductionRunRepository.complete()`'s finished-goods `InventoryStock` upsert (new —
  the finished product's per-unit cost is its accepted share's own portion of the
  transferred WIP value, see [Production](production.md) §11).
- **Readers:** `ProductionMaterialIssueRepository.issue()`, valuing each consumed
  component at its _current_ cost at the moment of consumption — never passed in by the
  caller. Two issues at two different times can legitimately value the same component
  differently if stock was replenished at a different price in between; this is the
  correct, standard behaviour of a moving weighted average, not a bug to special-case.
  **Added Sprint 10:** `SalesFulfilmentRepository.create()` reads the exact same field
  the exact same way, for the exact same reason — a Sales Fulfilment consumes
  finished-goods stock that may have been produced (or received) at different costs
  over time, and needs a real, current cost to value the COGS it posts. See §11c.
- **Never touched by `InventoryStockRepository.adjustStock`**, in either direction — a
  manual correction (cycle count, damage, shrinkage) carries no monetary event. An
  Adjustment increase gets no cost basis; an Adjustment decrease doesn't need one (the
  weighted average of what remains is mathematically unchanged by removing units at the
  existing average). This is a deliberate, documented decision, not an oversight — see
  the [Sprint 9 Completion Report](../sprint-9-completion-report.md).
- **This is still not a full costing engine.** No FIFO/specific-identification/standard
  costing, no per-lot cost tracking, no landed-cost allocation (freight, duty, handling
  charges are not blended in). It is the minimum durable mechanism Material Issue
  structurally requires, applied consistently, not an invented sophistication the system
  doesn't otherwise support.

See [Accounting](accounting.md) §"Production Accounting" and
[Production](production.md) §11 for the full Material Issue/Production Completion
posting rules this costing figure feeds.

## 11c. Sales Fulfilment Accounting Integration (Sprint 10)

Sprint 10 makes `SalesFulfilmentRepository.create()` — the one place a Sales Order's
finished-goods inventory is physically deducted — the second reader of
`averageUnitCost` (§11b), posting `DR Cost of Goods Sold / CR Finished Goods Inventory`
for the exact value of stock leaving. No schema change to `InventoryStock` itself was
needed; only `SalesFulfilmentItem` gained two new snapshot columns (`unitCost`,
`costAmount`) recording what each line was actually costed at, at the moment of
fulfilment — see [Sales](sales.md) §4b and
[Accounting](accounting.md) §"Sales Fulfilment Accounting" for the full posting rules,
the zero-cost policy (matches Production's own precedent — skip the journal, never
block the physical fulfilment), and the idempotency-ordering fix applied proactively
this sprint.

## 11d. Returns & Replacement Goods (Sprint 11)

Sprint 11 adds the reverse-flow half of the receiving chain, entirely within this
domain — full detail in [Accounting](accounting.md) §"Supplier Return Accounting" and
the [Sprint 11 Completion Report](../sprint-11-completion-report.md).

- **`SupplierReturn`** (`apps/api/src/inventory/supplier-return.*`) — a physical return
  of previously-accepted goods to a supplier, created and posted atomically in a single
  call (unlike `CustomerReturn`'s two-phase request/receive — there is no separate
  inspection step; the goods are simply leaving). Always references a specific
  `GoodsReceiptItem`. New cumulative columns `returnedQuantity`/
  `returnedExcessQuantity` on `GoodsReceiptItem` cap eligibility at `acceptedQuantity`
  and track the **excess-first allocation** rule: a return's value is drawn from the
  remaining excess/`GRNI_PENDING_APPROVAL` balance before spilling into the payable/`AP`
  balance, valued at the _original_ `PurchaseOrderItem.unitPrice` the receipt itself
  posted at (never the current, possibly-drifted `averageUnitCost`) so the reversal
  ties out exactly to the original receipt journal.
- **Replacement goods need no new accounting logic at all.** A replacement is an
  ordinary `GoodsReceipt` against the same Purchase Order, posted through the existing,
  completely unmodified `receive()` — because `payableQuantity` is already capped
  cumulatively by remaining-ordered-quantity across every receipt against a PO item
  (Sprint 8), a replacement mathematically cannot create a duplicate payable. Only two
  traceability fields were added: `GoodsReceipt.replacesGoodsReceiptId` and
  `GoodsReceiptItem.replacesRejectedItemId` (+ a `replacedQuantity` cap preventing a
  line from "replacing" more than was actually rejected).
- **Discrepancy auto-resolution.** A `SupplierReturn` or replacement receipt that
  references a `GoodsReceipt` with an active discrepancy automatically advances
  `discrepancyStatus` toward `RESOLVED`/`REPLACEMENT_RECEIVED` and sets the new
  `discrepancyResolutionAction` (`REPLACEMENT`/`RETURN`, auto-set; `CREDIT`/
  `ACCEPT_AS_IS`/`PRICE_ADJUSTMENT`/`OTHER` remain a manual flip via the existing
  `PATCH .../discrepancy` endpoint, Sprint 4.4.1, unchanged) — still not a workflow
  engine, per that sprint's own explicit constraint.
- **New `InventoryTransactionType.RETURN`** — both a customer-return restock (increase)
  and a supplier-return removal (decrease) use this one new value, distinguishable from
  `ADJUSTMENT` (a manual correction) and from `RECEIPT`/`ISSUE` (the forward-flow
  events) — a return is a business event, not a stock correction.
- **Customer-return disposition is the smallest safe extension, not a WMS.**
  `CustomerReturn` (owned by [Sales](sales.md) §4c) splits a returned quantity into
  resalable/damaged/quarantine/scrap — only the resalable portion ever touches
  `InventoryStock`/`InventoryTransaction`. Damaged/quarantine/scrap quantities are
  recorded as plain data on the return row; there is no physical quarantine-location
  or hold-status model on `InventoryStock` itself. A future warehouse module would add
  that; Sprint 11 deliberately does not.

## 11e. Finance's Read-Only Reporting Reach (Sprint 13)

Sprint 13 gave [Finance](finance.md) §13 an Inventory Valuation report and an
Inventory-to-Ledger Reconciliation report — both need `InventoryStock.
quantityOnHand × averageUnitCost`, reusing this domain's own Sprint 9
moving-weighted-average costing figure rather than building a second costing engine.
This is the first time Finance has ever read Inventory's tables. Rather than
importing `InventoryModule` (which would widen `FinanceModule`'s whole dependency
graph and weaken the "Finance never imports InventoryModule" guarantee
`finance-independence.spec.ts` has held since Sprint 6), `InventoryValuationService`
reaches directly into `this.prisma.inventoryStock.findMany(...)` — **read-only, no
transaction, no write verb anywhere in the file** — the same "narrow, documented
exception to reach into another domain's own table" pattern Sprint 11/12 already used
for _writes_ inside a self-owned transaction (`SupplierReturnRepository`/
`SupplierInvoiceRepository` reaching into `tx.goodsReceiptItem`), applied here to a
plain read instead. `finance-independence.spec.ts`'s existing assertion needed **zero
changes**; a new `reports-independence.spec.ts` (in Finance) separately confirms the
new reporting files never write to `inventoryStock`/`inventoryTransaction` and never
import an Inventory service or controller — only the plain Prisma client. Inventory's
own module boundary and costing logic are unchanged by this; it is purely a new,
narrow consumer reading a table it already owned.

## 11. Known Limitations (Sprint 4.5)

- **No full Warehouse Management System.** `InventoryLocation` is deliberately minimal —
  no bins, shelves, zones, barcode/RFID scanning, capacity limits, or transfers between
  locations. Moving stock from one location to another today means one `ADJUSTMENT`
  decreasing the source and a second increasing the destination — there is no atomic
  "transfer" operation.
- **No reservation/allocation.** `InventoryStock.quantityReserved` exists in the schema
  (always `0` today) so a future Sales/Production reservation workflow doesn't need a
  shape change, but nothing writes to it yet — `quantityAvailable` always equals
  `quantityOnHand` in practice.
- **No generic `ISSUE` endpoint in this module.** There is deliberately no generic
  "remove stock" button in Inventory itself — `ISSUE` rows are written only by
  Production's Material Issue (Sprint 4.6) and Sales's Fulfilment (Sprint 4.9), each a
  real business operation with its own validation, not a bare stock-removal form (see
  "Future Production Consumption").
- **No Low Stock / reorder-level alerting.** Deferred — it would require a schema change
  to `Product` (Product Catalogue's own table, a cross-domain change out of this sprint's
  scope) to add a `reorderLevel` field.
- **Valuation is a moving weighted average, not a full costing engine.** Sprint 9 added
  `InventoryStock.averageUnitCost` (§11b) — a real, persisted, continuously-updated
  cost basis, no longer just Sprint 8's one-time accounting-event snapshot. What's still
  absent: FIFO/specific-identification/standard costing, per-lot cost tracking, and
  landed-cost allocation (freight, duty, handling). `COGS` remains unposted — Sales
  Fulfilment consuming finished-goods stock still writes no accounting entry; that
  integration is deferred to a future sprint (see [Production](production.md) §11 and
  [Accounting](accounting.md)).
- **No Inventory Counts (cycle counts as a first-class workflow), Batch/Lot Tracking, or
  Expiry Tracking** — a physical count today is recorded as one `ADJUSTMENT` with reason
  `PHYSICAL_COUNT`, not a dedicated count-session entity.
- **No Quality Management module, Supplier Claims/dispute-management module,
  full Accounts Payable module (supplier invoice matching, payment runs, AP ageing,
  vendor statements), or automated supplier communication** —
  `discrepancyStatus` is deliberately lightweight (a status + free-text notes, extended
  Sprint 11 with `discrepancyResolutionAction`), not a workflow engine (Sprint 4.4.1
  brief §18). Sprint 8 posts to a basic `AP` system account (see
  §11a/[Accounting](accounting.md) §9), which is a liability-recognition foundation,
  not a full AP module. **Resolved in Sprint 11**: Supplier Returns and Replacement
  Goods are now built (§11d) — the "Supplier Returns module" and automatic
  rejected↔replacement linkage gaps this bullet used to flag no longer exist.
- **No physical quarantine-location or hold-status model** (Sprint 11, §11d) — a
  customer return's damaged/quarantine/scrap disposition is recorded as data only, not
  as a distinct physical stock state on `InventoryStock`.
- **The Purchase Order status write happens directly from inside
  `GoodsReceiptRepository`'s own transaction** — a deliberate, documented exception to
  ADR-002's domain-ownership convention, made for atomicity. See "Integration Points"
  above.
- Amounts (`deliveredQuantity`, `rejectedQuantity`, `acceptedQuantity`,
  `quantityOnHand`, `quantityReserved`, ledger `quantity`) are stored as `Float`, not an
  arbitrary-precision `Decimal` — same convention (and rationale) as Procurement's
  monetary fields.
