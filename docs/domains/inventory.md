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
  **Added Phase 2A** (§13): `locationType` (`LocationType`, default `WAREHOUSE`) and
  `outletId` (nullable, `CUSTOMER_LOCATION`-only) — set only at creation, never on
  update. **Added Phase 2B** (§14): `outletId` now carries a database `@@unique`
  constraint — at most one dedicated location per outlet, ever.

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
  `GoodsReceiptRepository.receive` (receiving), `InventoryStockRepository.adjustStock`
  (corrections), and, **added Phase 2B** (§14), `InventoryStockRepository
.recordOpeningStock` (first confirmed count at a location) and
  `InventoryTransferRepository.create`/`.reverse` (relocating stock between two
  locations) are the write paths.
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
- **`ownership`/`arrangement` (Phase 2A, §13):** WHO owns this stock position
  (`StockOwnership`, default `ORGANISATION`) and WHY/under what commercial purpose it's
  held (`StockArrangement`, default `WHOLESALE`) — two independent classification
  dimensions, distinct from `InventoryLocation.locationType`, never inferred from it.
  **Added Phase 2B** (§14): both are now written by `recordOpeningStock` (caller-
  supplied, validated against `locationType`) and copied forward unchanged by every
  `Transfer` — never client-supplied on a transfer, never inferred from the
  destination's `locationType`. A location+product pair's `ownership`/`arrangement`
  cannot be changed once stock exists there under a different value — a conflicting
  write is rejected (`OwnershipMismatchError`), never merged.

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
| `GET /api/inventory/locations/:id/stock` _(Phase 2B)_           | Any authenticated user                         | —                                                                                                                                                                           | `200 { items: InventoryStockSummary[] }` scoped to one location; `404` if the location doesn't exist in this organisation                                 |
| `POST /api/inventory/locations/:id/opening-stock` _(Phase 2B)_  | Owner or Administrator only (`403` for Member) | `{ productId, quantity, ownership, arrangement?, notes? }`                                                                                                                  | `201` — the resulting balance/transaction; `400` if a balance already exists for this (location, product), or ownership is incompatible with the location |
| `GET /api/inventory/transfers` _(Phase 2B)_                     | Any authenticated user                         | Optional `?productId=`, `?locationId=`                                                                                                                                      | `200 { items: InventoryTransfer[] }`                                                                                                                      |
| `GET /api/inventory/transfers/:id` _(Phase 2B)_                 | Any authenticated user                         | —                                                                                                                                                                           | `200` — a single `InventoryTransfer`; `404` if not found                                                                                                  |
| `POST /api/inventory/transfers` _(Phase 2B)_                    | Owner or Administrator only (`403` for Member) | `{ productId, sourceLocationId, destinationLocationId, quantity, notes?, idempotencyKey? }`                                                                                 | `201` — the created `InventoryTransfer`; `400` if source/destination are equal, stock is insufficient, or ownership/arrangement would be ambiguous        |
| `POST /api/inventory/transfers/:id/reverse` _(Phase 2B)_        | Owner or Administrator only (`403` for Member) | `{ notes? }`                                                                                                                                                                | `201` — the reversing `InventoryTransfer`; `400` if not `COMPLETED` or the destination can no longer supply the reversal; `404` if not found              |
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
| `inventory.transfer.created`           | `POST /api/inventory/transfers` — every fresh call (Phase 2B); never on an idempotent replay |
| `inventory.transfer.reversed`          | `POST /api/inventory/transfers/:id/reverse` — every call (Phase 2B)                          |
| `inventory.opening-stock.recorded`     | `POST /api/inventory/locations/:id/opening-stock` — every call (Phase 2B)                    |

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
  no bins, shelves, zones, barcode/RFID scanning, or capacity limits. **Updated Phase
  2B** (§14): a real, atomic stock transfer between two locations now exists
  (`POST /api/inventory/transfers`) — the "two unlinked `ADJUSTMENT` rows" workaround
  this bullet used to describe is superseded for the general case. What remains
  genuinely absent: multi-stage dispatch/in-transit tracking (a transfer is modelled
  as instantaneous, never "in transit" — §14.2), and any Collection-Point-specific
  transfer workflow (Phase 2C).
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

## 12. Concurrent Stock Mutation (Sprint 37.1 — Inventory Fulfillment Concurrency Integrity Hardening)

**The defect.** Sprint 37 (D2C Collection Point Fulfillment) live-verified a genuine
data-integrity bug in `SalesFulfilmentRepository.create()` (Sprint 4.9): its stock
decrement read `InventoryStock.quantityOnHand`, computed a new value in application
code, then wrote that precomputed absolute value back via `upsert`. Under Postgres's
default READ COMMITTED isolation, two concurrent transactions decrementing the SAME
row could both read the same starting quantity and both commit — the second's write
silently overwrote the first's already-applied decrement. Reproduced live: two D2C
orders (15 units each) against 23 units on hand both reported success and were both
marked fully fulfilled (30 units "consumed"), while `quantityOnHand` only ever dropped
to 8 (one decrement, not two) — a genuine, unrecoverable 15-unit inventory
discrepancy with no error and no audit flag.

**The audit.** Before any fix, every `InventoryStock` write path in the codebase was
read end to end and classified:

| Call site                                                | Shape                                                       | Fixed this sprint?                          |
| -------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------- |
| `SalesFulfilmentRepository.create()` (Sales)             | Decrement + insufficient-stock guard, no cost recompute     | Yes — the confirmed, live-reproduced defect |
| `SupplierReturnRepository` (Inventory)                   | Decrement + insufficient-stock guard, no cost recompute     | Yes — identical shape                       |
| `ProductionMaterialIssueRepository.issue()` (Production) | Decrement + insufficient-stock guard, no cost recompute     | Yes — identical shape                       |
| `MaintenancePartUsageRepository.issue()` (Maintenance)   | Decrement + insufficient-stock guard, no cost recompute     | Yes — identical shape                       |
| `InventoryStockRepository.adjustStock()` (Inventory)     | Bidirectional delta + non-negative guard, no cost recompute | Yes — same guard technique, both directions |
| `CustomerReturnRepository` (Sales)                       | Increment + moving-weighted-average cost recompute          | **No** — different shape, see below         |
| `GoodsReceiptRepository.receive()` (Inventory)           | Increment + moving-weighted-average cost recompute          | **No** — different shape, see below         |
| `ProductionRunRepository.complete()` (Production)        | Increment + moving-weighted-average cost recompute          | **No** — different shape, see below         |

**The fix.** `inventory-stock-concurrency.util.ts` (a plain, transaction-scoped utility
function taking `tx: Prisma.TransactionClient` directly — the same non-injected-service
shape `postSystemJournalEntry(tx, ...)` already establishes for Finance, chosen for the
same reason: it must participate in the CALLER's own transaction, not open its own)
provides `decrementStockIfAvailable`/`applyStockAdjustmentIfNonNegative`. Both replace
the read-then-write with a single conditional `UPDATE ... WHERE quantityOnHand >= $x`
— the database's own row lock on that statement is the concurrency guard now, not a
value read moments earlier in application code. Each of the five call sites above keeps
its OWN domain-specific error class and message (`InsufficientStockError` is
deliberately three separate local classes in Sales/Production/Maintenance, unchanged);
only the underlying atomic primitive is shared. `averageUnitCost` is read separately
(via `getCurrentAverageUnitCost`) and is never touched by any decrement/issue path, so
this read never races against the guarded write.

**Why the three increment-with-cost-recompute call sites were NOT converted.** A plain
conditional `increment` cannot express "new weighted average = f(prior quantity, prior
cost, incoming quantity, incoming cost)" atomically the same way a guarded decrement
can — that requires its own single-statement SQL expression (or an explicit row lock)
and deserves dedicated review, not a rushed fold into this hardening pass. These three
are CONFIRMED to share the same underlying "read outside the write" structure and are
therefore theoretically exposed to an equivalent lost-update risk on `averageUnitCost`
(and, less severely, on quantity) under genuine concurrent receipts/returns/completions
of the SAME product+location — this is documented here as a known, open finding, not
fixed.

**Verification.** A real-PostgreSQL integration test suite
(`inventory-stock-concurrency.integration.spec.ts`, run via `pnpm run test:integration`
— deliberately excluded from the default `pnpm test` run, since it needs a live
database no other spec in this codebase requires) proves the fix under genuine
concurrent transactions: two/three-way contention at various stock levels, a
single-request-exceeds-stock case, a ten-way stress test, the bidirectional adjustment
primitive, and a multi-item transaction rollback test (an earlier item's successful
decrement is correctly undone when a later item in the SAME transaction fails). The
original live defect scenario (23 on hand, two 15-unit D2C orders racing through the
real HTTP API) was re-run after the fix: one order succeeded (stock 23 → 8, `SalesOrder`
`FULFILLED`), the other was cleanly rejected (`400 Insufficient stock...`, left
`READY_FOR_COLLECTION`, fully retryable — not stranded), and a subsequent retry after
restocking succeeded cleanly. See `docs/sprint-37.1-completion-report.md`.

## 13. Customer-Location Inventory Foundation (Phase 2A)

**Status: foundation only.** This section documents a purely additive schema
extension — see
[`docs/customer-location-inventory-architecture-audit.md`](../customer-location-inventory-architecture-audit.md)
for the full audit and roadmap this implements, and
[`docs/sprint-customer-location-inventory-phase-2a-completion-report.md`](../sprint-customer-location-inventory-phase-2a-completion-report.md)
for the complete implementation record, tests, and reconciliation evidence. **No
operational workflow — no transfer, no customer-outlet stock tracking, no Collection
Point cutover — was built this phase.** Every example below describing what a future
phase will do is exactly that: a documented plan, not working code.

### 13.1 Three independent dimensions, never conflated

The audit's own central design principle, now reflected in the schema: physical
**location**, stock **ownership**, and stock **arrangement** are three separate
questions, each answered by its own field, none ever inferred from another.

| Dimension   | Question it answers                           | Field                            | Values                                                         |
| ----------- | --------------------------------------------- | -------------------------------- | -------------------------------------------------------------- |
| Location    | Where is this stock physically?               | `InventoryLocation.locationType` | `WAREHOUSE` (default) · `CUSTOMER_LOCATION`                    |
| Ownership   | Who legally/commercially owns it?             | `InventoryStock.ownership`       | `ORGANISATION` (default) · `CUSTOMER`                          |
| Arrangement | Why/under what commercial purpose is it held? | `InventoryStock.arrangement`     | `WHOLESALE` (default) · `CONSIGNMENT` · `D2C_COLLECTION_POINT` |

A `CUSTOMER_LOCATION` does **not** imply `CUSTOMER` ownership — consignment stock
sitting at a customer's premises is physically at a `CUSTOMER_LOCATION` while
remaining `ORGANISATION`-owned under a `CONSIGNMENT` arrangement. A Collection Point
is a fulfilment _capability_ of an existing `Outlet`; enabling it never, by itself,
changes any location's type or any stock's ownership/arrangement.

### 13.2 `InventoryLocation.outletId` — the new, opposite-direction bridge

Sprint 37 already added `Outlet.inventoryLocationId` ("which location does this
outlet's Collection Point draw stock FROM" — often a shared warehouse). Phase 2A
adds the reverse relation, `InventoryLocation.outletId` ("this location physically
IS/represents this outlet's own premises") — a genuinely different relationship,
not a duplicate. The two FKs are independent: a location can have neither, either,
or (in a future phase) both set to a mutually consistent pair.

`outletId`, not `customerId`, deliberately — an `Outlet` is the precise, unambiguous
physical place; the owning `Customer` is always one join away
(`InventoryLocation.outlet.customerId`) and is never duplicated onto
`InventoryLocation` itself. Enforced, not just documented: a database `CHECK`
constraint requires `locationType = 'WAREHOUSE' ⟺ outletId IS NULL` (equivalently,
`locationType = 'CUSTOMER_LOCATION' ⟺ outletId IS NOT NULL`) — the same
defense-in-depth pattern Phase 1's `Customer.creditLimit` non-negativity check
already established, re-validated at the Zod and service layers as a fast-fail UX
convenience, but the database constraint is the true authority. Tenant isolation for
`outletId` is enforced at the service layer
(`InventoryService.createLocation()` → `InventoryLocationRepository.outletExists()`,
a tenant-scoped existence check) — the raw foreign key alone only proves the
referenced `Outlet` row exists _somewhere_, not that it belongs to the caller's own
organisation (verified directly, not assumed — see the Phase 2A completion report's
test evidence).

**Immutable after creation.** Neither `locationType` nor `outletId` can be changed
via `PATCH /api/inventory/locations/:id` — both are accepted only on
`POST /api/inventory/locations`. Allowing either to change after a location already
holds stock would silently reclassify that stock's meaning with no corresponding
physical event — exactly the kind of risk this phase's own brief required stopping
and flagging rather than guessing past.

### 13.3 How existing warehouse stock remains compatible

Every `InventoryLocation` row that existed before this phase is, and remains,
`locationType = WAREHOUSE` with `outletId = NULL` — definitionally correct, since no
other kind of location existed under the prior architecture. Every existing
`InventoryStock` row is, and remains, `ownership = ORGANISATION` /
`arrangement = WHOLESALE` — equally definitionally correct. These are not guesses or
best-effort backfills; they are the only values that could ever have been true,
confirmed by reconciling exact pre- and post-migration row counts, summed
quantities, and total valuation (`quantityOnHand × averageUnitCost`) against the
real seeded "Boby Bites" organisation — byte-identical before and after (full
figures in the completion report). No existing Goods Receipt, Production Completion,
Sales Fulfilment, Customer Return, or Adjustment code path was touched — all four
continue to read/write exactly the columns they always did, now alongside two new
columns with safe defaults they never reference.

### 13.4 Why no historical customer-outlet balance is backfilled

Phase 2A creates **zero** `CUSTOMER_LOCATION` rows against real data (the only ones
that exist anywhere are disposable test fixtures, created and deleted within a
single test). No customer/outlet has ever had its stock tracked separately from the
organisation's own warehouse pool, so there is no historical position to recover —
attempting to synthesize one from past `SalesFulfilment`/`Dispatch` records would
assert something never actually verified (a sold wholesale customer's goods are
simply gone from this system's perspective, by design — see the audit's §8). Any
future `CUSTOMER_LOCATION`'s opening balance must come from an explicit, physically
confirmed count or a real forward-dated transfer — never a computed guess.

### 13.5 The transfer foundation — vocabulary only

`InventoryTransactionType.TRANSFER` now exists as a reserved enum value. **Nothing
writes one.** No `destinationLocationId` column was added to `InventoryTransaction`
— the audit's own finding was that the existing single-`locationId`-per-row shape
can represent a transfer safely only as an additive pattern, not a schema widening,
so none was forced. The required semantics for a future implementation (Phase 2B):

- **Representation**: two `InventoryTransaction` rows — a decrease at the source
  location, an increase at the destination — sharing one `referenceType`/
  `referenceId` pair (e.g. `referenceType: 'InventoryTransfer'`), reusing the exact
  polymorphic-reference convention every other event in this table already uses.
  No new pairing column.
- **Atomicity**: both legs, plus the owning `InventoryTransfer`-equivalent record
  (if one is introduced) and any ownership/arrangement change, must commit in one
  `$transaction` — the same convention `SalesFulfilmentRepository.create()` already
  establishes.
- **SKU/quantity**: the destination leg's quantity must always equal the source
  leg's — a transfer never creates or destroys stock, only relocates it.
- **Ownership/arrangement preservation or change**: an ordinary warehouse-to-
  warehouse transfer preserves `ownership`/`arrangement` unchanged; a transfer that
  deliberately changes them (e.g. placing organisation-owned stock at a customer
  location under a new `CONSIGNMENT` arrangement) must do so explicitly, never
  implicitly from the destination's `locationType` alone (§13.1).
- **Idempotency**: the same `@@unique([..., idempotencyKey])` convention every other
  write path in this domain already uses (`GoodsReceipt`, `SalesFulfilment`,
  `CustomerReturn`).
- **Concurrency**: the source leg's decrement must reuse
  `decrementStockIfAvailable()` verbatim — the same Sprint 37.1-proven primitive,
  never a new concurrency mechanism.
- **Audit**: a new `inventory.transfer.created` action (and a reversal action, if a
  transfer reversal is built) — not yet added to `inventory-audit-actions.ts`,
  since no operation exists to generate it (per this phase's own "do not invent
  audit events for operations that do not yet exist" instruction).
- **Reversal**: an explicit, separate reversing `TRANSFER` pair (source and
  destination swapped) — never a destructive edit of the original rows, matching
  this domain's append-only ledger convention throughout.

### 13.6 Remaining, explicitly unresolved risks (not addressed by this phase)

Two material findings from the architecture audit remain **fully open** after Phase
2A — neither was in this phase's scope, and neither should be read as resolved:

- **The shared-`InventoryStock`-row risk between B2B and D2C Collection Point
  fulfilment** (audit §3.3): the seeded Collection Point's
  `Outlet.inventoryLocationId` still points at the same "Main Warehouse" location
  B2B fulfilment uses, confirmed unchanged by this phase's own migration
  verification (the completion report's reconciliation evidence). Closing this is
  explicitly Phase 2C's job — it requires giving the Collection Point its own
  `CUSTOMER_LOCATION` (now schema-possible) and re-pointing
  `Outlet.inventoryLocationId` at it, an operational cutover this phase does not
  perform.
- **The missing Collection Point reversal/cancellation path** (audit §3.2 item 7):
  still no code path anywhere restores inventory for a collected D2C order. This is
  independent of the location-sharing problem and remains a Phase 2C deliverable.

### 13.7 The increment-side weighted-average-cost concurrency gap — unaffected, not fixed

`GoodsReceiptRepository.receive()`, `ProductionRunRepository.complete()`, and
`CustomerReturnRepository.receive()`'s read-then-write cost recompute (§12 above)
is **unmodified by Phase 2A**. The two new columns on `InventoryStock`
(`ownership`/`arrangement`) are written with their default values via the exact
same `upsert`/`create` calls those three methods already use — no new read-then-
write window was introduced, and the existing one was not closed either. The
Phase 2A completion report evaluated fixing it as part of this foundation and
concluded it is not necessary as a prerequisite: Phase 2A creates no location where
concurrent, cost-bearing increments against mixed-ownership stock could occur (no
`CUSTOMER_LOCATION` carries real stock yet), so the gap's consequences are
unchanged in practice by this phase. It remains an open, documented finding,
inherited by Phase 2B — which should revisit whether it becomes a hard
prerequisite once `CUSTOMER_LOCATION` rows start accumulating real, cost-bearing
stock via the transfer mechanism (§13.5).

### 13.8 Separation from Phase 3 commercial/accounting decisions

Nothing in Phase 2A changes any accounting posting, introduces any new GL account,
or implies any commission/settlement/reimbursement treatment. `StockArrangement
.CONSIGNMENT`/`.D2C_COLLECTION_POINT` are vocabulary only — what financial event (if
any) should fire when stock under either arrangement is drawn down or consumed
remains an entirely open, unresolved business decision (audit §9/§13), explicitly
deferred to Phase 3. Phase 2A's own test suite asserts zero unexpected
`JournalEntry` rows are produced by any of its schema changes or the one new
service-layer code path it adds (location creation) — see the completion report.

## 14. Customer Outlet Stock Tracking & Transfers (Phase 2B)

**Status: general outlet stock tracking and transfers only.** Builds directly on
§13's foundation. See
[`docs/customer-location-inventory-architecture-audit.md`](../customer-location-inventory-architecture-audit.md)
and
[`docs/sprint-customer-location-inventory-phase-2b-completion-report.md`](../sprint-customer-location-inventory-phase-2b-completion-report.md)
for the full rationale, tests, and reconciliation evidence. **Collection Point
cutover, D2C fulfilment changes, Collection Point reversal, consignment drawdown,
and any new settlement/accounting rule remain out of scope — explicitly deferred to
Phase 2C/3, exactly as before.**

### 14.1 Outlet location association

`InventoryLocation.outletId` now carries a database `@@unique` constraint (it was
unconstrained in Phase 2A) — an outlet may have at most one dedicated location,
ever. `POST /api/inventory/locations` (unchanged route, same body shape introduced
in Phase 2A) is the only way to create one; `InventoryService.createLocation()`
rejects a second attempt for the same outlet with a friendly `400`
(`InventoryLocationRepository.findByOutletId`) before the database constraint is
ever reached. No location is created automatically for any outlet — establishing
one remains a controlled, explicit, permission-gated action
(`inventory.location.manage`), exactly as §13.2 described.

Reading an outlet's stock reuses the existing stock-listing machinery rather than a
new read path: `GET /api/inventory/locations/:id/stock` is a thin, tenant-checked
wrapper over `GET /api/inventory?locationId=`. Three states are distinguishable by
construction, never conflated:

| State                                                   | How it looks                                                                                                                                          |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Outlet exists, no dedicated location                    | `InventoryLocationRepository.findByOutletId` returns `null` — there is nothing to view at `.../locations/:id/stock` because no location id exists yet |
| Dedicated location exists, no confirmed opening balance | The location exists; `GET .../stock` returns an empty list (no `InventoryStock` row for any product yet)                                              |
| Dedicated location with reconciled stock                | `GET .../stock` returns one row per product that has ever had an opening count or a transfer land there                                               |

An outlet is never described as "zero stock" merely because no row exists — the
absence of a row and a confirmed zero-quantity row are different, explicit states
(see §14.3).

### 14.2 Stock transfers — lifecycle, representation, and why

A new `InventoryTransfer` header model (`POST /api/inventory/transfers`,
`inventory.transfer.create`) — modelled exactly like `GoodsReceipt`: a thin,
auditable aggregate on top of the existing `InventoryStock` balance and
`InventoryTransaction` ledger, never a second balance authority. Single product,
single quantity per row (no multi-line items — the brief's own required-field list
and "smallest safe" instruction both point at this shape).

**Lifecycle: a single atomic `COMPLETED` movement, not a multi-stage dispatch/
in-transit/receipt-confirmation workflow.** §13.5 anticipated this choice would need
making; Phase 2B makes it explicitly, for the smallest-safe reason the brief itself
allows: this codebase has no existing dispatch/approval architecture for an internal
stock relocation to plug into, and inventing one here would be new complexity the
brief did not ask for. **Known limitation**: the system cannot represent a transfer
"in transit" — a transfer either hasn't happened or has fully happened,
instantaneously, in the same database transaction. A multi-day physical movement
between a warehouse and a distant outlet is not modelled as a separate state; it is
simply recorded once it is known to be complete. A future phase that needs
in-transit visibility would add that as a genuinely new status, not retrofit this
one.

**Representation** — refined from §13.5's prediction once real implementation
confirmed the right shape: TWO `InventoryTransaction` rows, `transactionType:
TRANSFER`, sharing the `InventoryTransfer.id` as `referenceId`, but with TWO
DISTINCT `referenceType` strings — `'TransferOut'` (source, decrease) and
`'TransferIn'` (destination, increase) — rather than one shared string. This
mirrors the established convention `RETURN` already uses (`'CustomerReturn'` vs.
`'SupplierReturn'` distinguish direction), which turned out to be the better fit
than a single shared `referenceType` once the model was actually built.

**Ownership/arrangement are never client-supplied.** `createInventoryTransferSchema`
has no `ownership`/`arrangement` fields at all. `InventoryTransferRepository.create`
always reads both off the SOURCE location's current `InventoryStock` row and
carries them to the destination unchanged — this is the actual mechanism behind
"preserve ownership unless an explicitly supported business event authorises a
change" (brief §3.1): there is no input that could misrepresent it, because there
is no input for it.

**Collapse-into-one-balance protection** (the §2.1 gate this phase's brief
required resolving before writing any code — see the completion report for the
full reasoning): if the destination already holds this product under a DIFFERENT
`ownership`/`arrangement` than the source is about to bring in, the transfer is
rejected outright (`OwnershipMismatchError`), not merged. This is enforced
atomically inside the same `INSERT ... ON CONFLICT ... DO UPDATE ... WHERE` that
performs the increment (§14.4) — never a separate, racy read-then-check.
`InventoryStock`'s own `@@unique([organisationId, productId, locationId])`
constraint is **unchanged** — a location still holds at most one balance per
product, which is what makes this guard necessary in the first place.

**Atomicity, idempotency, reversal**:

- The source decrement and destination increment happen inside one
  `$transaction` — a failed transfer leaves both balances exactly as they were
  (proven by an integration test that deliberately overdraws the source and
  confirms neither side moved).
- `idempotencyKey` + `@@unique([organisationId, idempotencyKey])` — the same
  convention `GoodsReceipt`/`SalesOrder` already use. A retried submission returns
  the original transfer; no stock moves twice.
- Reversal (`POST /api/inventory/transfers/:id/reverse`,
  `inventory.transfer.reverse`) records a NEW `InventoryTransfer` row
  (`reversalOfTransferId` set, source/destination swapped) rather than mutating or
  deleting the original — the original is only ever flipped to `status: REVERSED`.
  A transfer can be reversed at most once: enforced by BOTH a conditional
  `status`-claiming `updateMany` (`COMPLETED` → `REVERSED`, racing concurrent
  reversal attempts correctly — proven by a concurrency test) AND the schema's own
  `@@unique([reversalOfTransferId])` as defense-in-depth. A reversal that would
  oversell the destination (some of the transferred stock already moved on by the
  time of reversal) fails cleanly with `InsufficientStockError` and leaves the
  original `COMPLETED`, not stuck half-reversed.

**Deliberately NOT wired to B2B SalesOrder fulfilment.** §5.1/§5.2 of the brief
permitted stopping and reporting this as a blocker rather than guessing, and that
is the path taken: connecting a completed wholesale sale's ownership transfer to
outlet stock requires deciding exactly WHEN ownership transfers (order
confirmation? invoice? payment? physical delivery?) — an unreviewed accounting-
timing decision this phase does not make. The general transfer mechanism above is
entirely manual and decoupled from `SalesFulfilmentRepository`; no existing B2B
code path was touched. Wiring the two together is required Phase 2C/3 work, not
yet attempted.

### 14.3 Opening stock and reconciliation

`InventoryStockRepository.recordOpeningStock()`
(`POST /api/inventory/locations/:id/opening-stock`, reuses the existing
`inventory.adjustment.create` permission — it IS a stock adjustment, just one that
establishes rather than deltas a balance) — usable only when no `InventoryStock`
row yet exists for `(organisation, product, location)`. The existence of the row
IS the "confirmed" marker the brief required (§6): absence means unconfirmed,
presence with `quantityOnHand = 0` means a confirmed physical count of zero — two
different, legible states, never conflated.

**Idempotency needs no new column.** A duplicate submission either finds no row
(and genuinely is the first count) or hits `InventoryStock`'s own
`@@unique([organisationId, productId, locationId])` constraint, caught and
translated to `OpeningStockAlreadyRecordedError` — the same "find-then-create-
then-recover-from-P2002" convention `SalesOrder.idempotencyKey`'s own schema
comment already documents elsewhere in this codebase, specialised here to a
natural uniqueness check instead of a client-supplied key. Proven under genuine
concurrency: two simultaneous opening-count submissions for the same
location/product, exactly one succeeds.

**`averageUnitCost` is always `0`** — there is no reliable cost basis for a manual
physical count (brief: "Do not fabricate... where reliable evidence is missing").
This is a deliberate, conservative simplification with a direct, useful
consequence: opening stock recorded this way contributes nothing to inventory
valuation (`quantityOnHand × 0 = 0`) until a later, COSTED movement (a `Transfer`
FROM a costed warehouse location, §14.2) establishes a real cost at that location.
See §14.5 and §14.6 below.

A `WAREHOUSE` location may only record `ORGANISATION`-owned opening stock
(`InventoryService.recordOpeningStock` rejects `CUSTOMER` ownership there) — the
mirror of the invariant the database `CHECK` constraint already enforces for
`locationType`/`outletId` pairing, now extended by application-layer validation to
`locationType`/`ownership` pairing. A `CUSTOMER_LOCATION` may record either value.

No historical sales order, dispatch, or fulfilment record is ever read to fabricate
an opening count — every opening balance traces to an explicit, server-recorded,
human-confirmed count, matching §13.4's reasoning exactly.

### 14.4 Costing and valuation treatment

Preserves the existing moving-weighted-average architecture completely — a
transfer is explicitly NOT treated like a goods receipt (not a purchase, carries
no new cost information of its own). The destination's new average cost is
computed the same formula every increment-with-cost path in this codebase already
uses, with the SOURCE's current `averageUnitCost` standing in for the "incoming
unit cost" a goods receipt would otherwise supply:

```
newAverageCost = (destinationQty × destinationCost + transferQty × sourceCost)
                 / (destinationQty + transferQty)
```

**A genuine concurrency improvement over the existing three increment-with-cost
call sites, scoped only to this new path.** §13.7 flagged that
`GoodsReceiptRepository`/`ProductionRunRepository`/`CustomerReturnRepository`'s
read-then-upsert cost recompute carries a known, accepted, documented lost-update
race under concurrent increments into the SAME `(organisation, product, location)`
row, and asked Phase 2B to assess whether it becomes a hard prerequisite once
`CUSTOMER_LOCATION` rows start accumulating real transferred stock. The answer: it
would have, so the new transfer destination-increment does NOT reuse that
read-then-upsert pattern. `incrementStockWithCostIfCompatible()`
(`inventory-stock-concurrency.util.ts`) is a single atomic
`INSERT ... ON CONFLICT ... DO UPDATE` statement — the entire read-prior-state,
compute-new-weighted-average, write-new-state sequence happens against whatever row
state Postgres has just locked, in one statement, closing the lost-update class of
race for transfers specifically. Proven under genuine concurrency: two simultaneous
transfers from two different sources into the same destination, both increments
land, no total is lost. **The three pre-existing call sites are deliberately left
exactly as they were** — retrofitting them was explicitly out of this phase's
"smallest safe" scope and risked destabilising established, working warehouse
operations for no requirement this phase actually has; see §14.6.

No new revenue, COGS, or GL posting is ever produced by a transfer or an opening
count — both are pure stock/ledger operations. Customer-owned stock is excluded
from company valuation by construction, not by a special-cased filter: its
`averageUnitCost` is always `0` from the moment it is recorded (opening count) or
inherited (a transfer can only ever carry `CUSTOMER` ownership onward from a source
that was already `CUSTOMER`-owned, which itself only ever got that way via an
opening count — see §14.3).

### 14.5 Permissions and audit

Two new permissions (`inventory.transfer.create`, `inventory.transfer.reverse`),
`NONE`-scope, matching the existing `inventory.adjustment.create`/
`inventory.location.manage` convention — administrative mutations, organisation-
wide the moment granted, no fabricated territory/location scope (this codebase's
own `ASSIGNED_TERRITORY`/`ASSIGNED_RECORDS` scopes are honestly left unenforced
wherever no server-side data actually links a user to a territory or outlet —
exactly the existing `sales.order.view` precedent documented in
`SalesOrderController`). Viewing a transfer or an outlet's stock reuses the
existing `inventory.stock.view`; recording opening stock reuses
`inventory.adjustment.create` — both are genuinely the same class of action as
their existing permission already covers, so no new permission was added for
either (brief §7: "Add new permissions only when necessary").

Three new audit actions (`inventory.transfer.created`, `inventory.transfer.reversed`,
`inventory.opening-stock.recorded`) — each recorded only on the operation it
actually names, `wasCreated`-gated for transfer creation (an idempotent replay
never re-emits an audit event, matching every other write path's convention).

### 14.6 Known limitations

- **The shared-`InventoryStock`-row risk between B2B and D2C Collection Point
  fulfilment (§13.6) remains fully open.** Nothing in Phase 2B touches
  `Outlet.inventoryLocationId` for either seeded Collection Point outlet —
  confirmed unchanged by this phase's own regression tests.
- **The Collection Point reversal/cancellation path (§13.6) remains missing.**
  Unrelated to transfers; still a Phase 2C deliverable.
- **No in-transit transfer state** (§14.2) — a transfer is atomic/instantaneous in
  this system's model, never "dispatched but not yet received."
- **No mixed ownership at one `(location, product)` pair** — if a location ever
  genuinely needs to hold two different ownership/arrangement states of the SAME
  product simultaneously (e.g. some consignment-arranged units alongside some
  customer-owned units of the same SKU on the same outlet shelf), this schema
  cannot represent it; `OwnershipMismatchError` rejects the attempt rather than
  silently merging. Solving this, if ever required, needs a genuinely new design
  (e.g. a separate ownership ledger at a finer grain than today's
  `(organisation, product, location)` balance row) — not a wider enum.
- **B2B SalesOrder fulfilment is not connected to outlet stock** (§14.2) — an
  explicit, reported blocker, not an oversight.
- **The increment-side costing concurrency gap is fixed ONLY for transfers**
  (§14.4) — `GoodsReceiptRepository`/`ProductionRunRepository`/
  `CustomerReturnRepository` still carry the original, documented race. Revisiting
  those three remains open, unscoped work.
- **No consignment drawdown, Collection Point consumption rule, commission, or
  settlement** — `StockArrangement.CONSIGNMENT`/`.D2C_COLLECTION_POINT` remain
  vocabulary only, exactly as §13.8 described; nothing in Phase 2B changes that.

### 14.7 Separation from Phase 2C/3

Nothing in Phase 2B reassigns a Collection Point's `inventoryLocationId`, changes
the Sprint 42 Collection Point deduction path, implements a reservation/allocation
concept, or introduces any new GL account or accounting treatment. The general
transfer mechanism (§14.2) is intentionally generic — usable by a future Collection
Point cutover without any Collection-Point-specific code existing yet — but no
Collection-Point-specific workflow was activated. Phase 2C/3 remain exactly as
scoped in the original audit.

## 15. Customer Outlet Inventory Integration, Collection Point Cutover & D2C Accounting (Phase 2C)

**Status: partial — see each subsection.** Full detail, test evidence, and the
required D2C accounting decision note are in
[the Phase 2C completion report](../sprint-customer-location-inventory-phase-2c-completion-report.md).
This section documents only what actually shipped.

### 15.1 B2B outlet-stock recognition — timing and mechanism

**Approved direction, implemented exactly as specified**: outlet stock is
recognised at the SAME `SalesFulfilmentRepository.create()` event that already
removes warehouse stock and posts COGS — never at Dispatch/Delivery, and the
existing COGS timing/amount is completely unchanged.

- **Destination resolution** (`SalesFulfilmentService.resolveOutletStockDestination`):
  the authoritative relationship is `SalesOrder.outletId` — the order's own
  ordering Outlet, for `B2B` orders only. Resolves to "no destination" (today's
  pre-Phase-2C behaviour, exactly preserved) whenever: the order is D2C; `outletId`
  is `null` (a real, common case — a B2B order placed directly against a Customer
  with no named Outlet); the Outlet has no dedicated, `ACTIVE` `CUSTOMER_LOCATION`
  yet (Phase 2B's own opt-in model — nothing here ever creates one); or the
  resolved destination would equal the fulfilment's own warehouse source
  (defensive, never actually reachable given `CUSTOMER_LOCATION`/`WAREHOUSE` are
  mutually exclusive by the Phase 2A `CHECK` constraint).
- **The write itself is NOT a `Transfer`.** `SalesFulfilmentRepository.create()`
  already performs the source-side decrement (the existing `ISSUE` row); adding a
  second, independent source decrement via `InventoryTransfer` would double-deduct.
  Instead, a new `InventoryTransactionType.DELIVERY` row is written directly inside
  the SAME transaction, sharing the fulfilment's own id as `referenceId` with the
  existing `ISSUE` row (two rows, one business event — the same
  `referenceType`/`referenceId` pairing convention `TRANSFER`/`RETURN` already
  established). A new `SalesFulfilment.destinationLocationId` (nullable) records
  which location, if any.
- **Ownership transition**: always `StockOwnership.CUSTOMER` /
  `StockArrangement.WHOLESALE` — never copied from anywhere, never client-supplied.
  This is the one explicit business event Phase 2B's own design reserved for a
  genuine ORGANISATION→CUSTOMER ownership change (a `Transfer` only ever
  preserves ownership). The increment reuses Phase 2B's
  `incrementStockWithCostIfCompatible()` — the SAME atomic
  `INSERT … ON CONFLICT … DO UPDATE` primitive, carrying forward the EXACT
  `unitCost` already computed for the COGS line (never a second, invented cost
  basis).
- **Atomicity**: a destination-side failure (most likely `OutletOwnershipTransitionError`
  — the destination already holds this product under a different
  ownership/arrangement) rolls back the ENTIRE fulfilment, including the warehouse
  decrement and the COGS posting already applied earlier in the same transaction —
  "succeed or fail together," never a partial fulfilment.
- **Idempotency**: no new mechanism — the EXISTING `(salesOrderId, idempotencyKey)`
  check-then-return at the top of `create()` already covers the whole operation;
  a retry returns the original fulfilment (with its own `destinationLocationId`
  intact) without re-running anything.
- **Value conservation, proven, not assumed**: a real-database integration test
  seeded two different costs at source and destination and confirmed the
  organisation's total valuation is byte-identical before and after a transfer of
  this kind — stock relocates, value is neither created nor destroyed. See the
  completion report §"Migration and Reconciliation Evidence."

### 15.2 Returns reconcile the outlet claim, independently of disposition

`CustomerReturnRepository.receive()` gained one new step, inserted before the
existing disposition-write loop: for every returned item whose originating
`SalesFulfilmentItem.salesFulfilment.destinationLocationId` is non-null, the
OUTLET's `CUSTOMER`-owned balance is decremented by the item's FULL
`quantityReturned` — resalable, damaged, quarantined, and scrapped alike, since
all four dispositions equally mean the outlet no longer has those units in its
own claimed position. This is completely independent of, and never conflated
with, the EXISTING COGS-reversal/credit-note logic (which continues to operate
exactly as before, driven only by `quantityResalable`/`quantityCredited`) — a
physical ownership correction and a financial credit are two separate questions,
answered by two separate, non-interfering code paths.

A return whose originating fulfilment recorded no outlet delivery at all (a D2C
order, an outlet-less B2B order, or a pre-Phase-2C fulfilment) is completely
unaffected — nothing new runs.

**Documented, open policy gap** (a genuine Mandatory Stop Gate outcome, not
guessed past): if the outlet's recorded `CUSTOMER`-owned balance can no longer
cover the quantity being returned — for example, something this phase doesn't
model already reduced it — the `receive()` call is rejected with
`OutletStockReconciliationError`, rolling back the whole receive (financial
postings included). There is no existing business policy for what should happen
in that case (write off the difference? treat it as a shortage/loss event
requiring its own disposition? Those are new accounting/ownership decisions
this phase does not make); until one exists, the return is simply blocked
rather than silently clamped.

### 15.3 Collection Point dedicated-location requirement

Closes the audit's central shared-row finding for the SUPPORTED rollout, without
performing an unverifiable cutover of the two real seeded Collection Points.

- **New assignment requires a dedicated location.**
  `CollectionPointFulfillmentService.isEligible()`/`.findEligibleOutlet()`/
  `.listEligibleOutletsForReassignment()` now require the outlet to have its OWN
  `ACTIVE` `CUSTOMER_LOCATION` (the Phase 2A/2B `outletId` bridge) — not merely a
  non-null `outlet.inventoryLocationId` (the Sprint 37 bridge, which may point at
  the shared Main Warehouse). `autoAssign`/`assignManually`/`reassign` can
  therefore NEVER newly point an order at the shared location again.
- **Already-assigned orders are never stranded.**
  `resolveFulfilmentLocation()` — used by `markReadyForCollection`/
  `confirmCollection`/`getInventoryViewForOutlet` — prefers the dedicated location
  if one now exists, and falls back to the legacy `outlet.inventoryLocationId`
  ONLY for an order that was already `ASSIGNED` before its outlet had a dedicated
  location. Because the assignment gate above guarantees every NEWLY-assigned
  order already has one, this fallback branch is provably exercised only by
  pre-existing, already-in-progress assignments — never a new one. Every time the
  fallback is actually used, it is recorded in the `READY_FOR_COLLECTION`/
  `COLLECTED` audit event's own metadata (`usedLegacySharedLocation: true`) —
  visible, never silent.
- **Establishing a dedicated location reuses EXISTING Phase 2B tooling —
  nothing new was built for "cutover" itself.** `POST /api/inventory/locations`
  (create the dedicated `CUSTOMER_LOCATION`) and
  `POST /api/inventory/locations/:id/opening-stock` (record a verified physical
  count, `ownership: ORGANISATION`, `arrangement: D2C_COLLECTION_POINT` — the
  exact arrangement value Phase 2A added for precisely this purpose and left
  unused until now) together ARE the cutover mechanism. Eligibility for new
  assignment is derived automatically the moment a dedicated location exists —
  there is no separate "mark this Collection Point cut over" flag to set.
- **Neither real seeded Collection Point was cut over this phase** — see §15.6.

### 15.4 Collection Point pre-consumption cancellation

A new `CollectionPointFulfillmentService.cancel()` (`POST
/d2c/collection-point-fulfillments/:id/cancel`, same `.fulfil` permission as
every other mutation on this controller — no new permission) cancels a paid
order from `ASSIGNED`, `PREPARING`, or `READY_FOR_COLLECTION` — collapsed into
one operation because all three have the identical system consequence:
`confirmCollection()` is the ONLY point stock is ever deducted, so nothing before
it has anything physical to reverse. The `CollectionPointFulfillment` status
flip (a new `CANCELLED` value) is the race-guard, claimed first; the underlying
`SalesOrder` is then cancelled via the EXISTING, unmodified
`SalesOrderService.cancel()`; a failure there compensates the CPF status back to
its exact prior value, the same "never strand a record at a terminal status"
pattern `confirmCollection()`'s own failure handling already established.

**No refund is issued.** This codebase has no payment-refund mechanism at all
(verified by inspection, not assumed) — issuing one would require inventing
financial-architecture behaviour the brief explicitly forbids guessing at. A
cancelled, paid order's refund remains an explicit, manual, off-system
follow-up until a real refund mechanism exists.

**No consumer WhatsApp notification is sent.** `ConsumerNotificationKind`
only covers `COLLECTION_READY`/`COLLECTION_CONFIRMED` today; widening it would
require a new value on the `ConsumerWhatsAppNotificationKind` Prisma enum and a
label fix in the operational-exceptions dashboard — a real, small piece of work,
deliberately deferred rather than bundled speculatively into a phase scoped to
inventory/ownership/accounting, not consumer messaging infrastructure.

**Deliberately NOT implemented**: cancellation/reversal of an already-`COLLECTED`
order (stock already consumed), a damaged/missing/incorrectly-collected
correction, and anything refund-contingent — every one of these needs a
compensating inventory and/or accounting event this phase's own D2C accounting
decision gate (§15.5) leaves unresolved. See the completion report's "Known
Limitations" for the full, un-narrowed list from the original brief's §7.

### 15.5 D2C accounting — the decision note is in the completion report

The prior audit's finding is reconfirmed by direct inspection of the current
code, not assumed from history: a D2C order's entire payment lifecycle
(`PaymentRepository.createPendingForConsumer` → `D2CPaymentService
.handleProviderCallback` → `applyProviderCallback`) posts **zero** `JournalEntry`
rows — no cash, no AR, no revenue — anywhere. The only GL effect a D2C order
ever produces is the `DR COGS / CR Finished Goods Inventory` posting at
fulfilment (unchanged by this phase). `InvoiceService` explicitly refuses to
create an Invoice for a D2C order, so the existing B2B Invoice/Payment revenue
path structurally cannot apply either.

Per Mandatory Stop Gate §15 item 5, **no new GL posting was added for D2C
payments this phase.** The required accounting-policy analysis, viable
alternatives, and recommendation are recorded in the completion report's own
"D2C Accounting Decision Note" section — this remains an **open production
blocker**, not resolved by documenting it.

### 15.6 Collection Point cutover status (per audit §12's own reporting requirement)

| Collection Point                              | Status                                                                                                                                                |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| OUT-000011 (Sprint36 Concurrency Outlet)      | Awaiting a verified physical count — shares the Main Warehouse location; no reliable ownership/quantity determination exists for this phase to act on |
| OUT-000003 (Bodija Supermart — Bodija Branch) | Awaiting a verified physical count — same shared-location situation                                                                                   |
| OUT-000004 (Mama Ngozi Provisions Shop)       | Never configured with any inventory location (pre-existing gap, unrelated to this phase) — unaffected either way                                      |

Three real `CollectionPointFulfillment` rows are currently in-flight
(`ASSIGNED`/`PREPARING`/`READY_FOR_COLLECTION`) against the two shared-location
outlets above — none were migrated, reassigned, or otherwise touched; they
remain eligible to proceed via the legacy-fallback path described in §15.3 and
will complete normally when the holding rep works through the queue.
