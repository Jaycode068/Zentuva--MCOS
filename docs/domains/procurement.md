# Procurement Domain

- **Status:** Purchase Order management implemented — Sprint 4.3 ("Procurement (Purchase
  Orders)"); status lifecycle extended Sprint 4.4.1 with `PARTIALLY_RECEIVED` and
  receiving-driven edit/cancel restrictions.
- **Sprint:** 4.3, 4.4.1
- **Depends on:** [Identity](identity.md) (tenant boundary, authentication, `RolesGuard`),
  [Supplier Management](suppliers.md) (every Purchase Order belongs to a Supplier),
  [Product Catalogue](catalogue.md) (every Purchase Order line references a Product),
  [ADR-002 — Modular Monolith](../adr/ADR-002-modular-monolith.md),
  [ADR-003 — Multi-Tenancy](../adr/ADR-003-multi-tenancy.md)
- **See also:** [Sprint 4.3 Completion Report](../sprint-4.3-completion-report.md),
  [Sprint 4.4.1 Completion Report](../sprint-4.4.1-completion-report.md),
  [Inventory](inventory.md) (owns the receiving workflow that now drives this domain's
  `PARTIALLY_RECEIVED`/`RECEIVED` transitions).

## 1. Business Purpose

Procurement covers the purchasing workflow from creating a Purchase Order (PO) through
issuing it to a Supplier. It answers **"What are we buying, from whom, and how much will
it cost?"** — nothing beyond that. Per the Sprint 4.3 brief, this sprint deliberately ends
the moment a PO has been issued (`PENDING`): what happens next in the real world (the
supplier accepts, a truck arrives, goods are received into stock) is explicitly out of
scope, reserved for Inventory (Sprint 4.4 — Goods Receiving) and a future Purchase
Approval Workflow.

This is the third non-Identity business domain module, built directly on top of the two
that came before it: every Purchase Order references a [Supplier](suppliers.md) (Sprint
4.2) instead of a free-text supplier name, and every Purchase Order line references a
[Product](catalogue.md) (Sprint 4.1) instead of a free-text item description — exactly
what those two domains' own documentation predicted Procurement would do with them.

## 2. Key Concepts / Entities

### PurchaseOrder

- **Responsibility:** a request to buy a set of items from one Supplier, with a
  server-calculated total.
- **Ownership:** owned by the Procurement domain (`apps/api/src/procurement/`).
  References `Supplier`/`Product` by id; no other domain writes to the
  `purchase_orders`/`purchase_order_items` tables directly (ADR-002 domain-ownership
  rule).
- **Identifiers:** `id` (internal cuid PK), `purchaseOrderNumber` (see "Purchase Order
  Number" below).
- **Tenant scoping:** every `PurchaseOrder` belongs to exactly one `Organisation`
  (`organisationId`, `onDelete: Cascade`) — same tenant-isolation convention as every
  other domain (identity.md §7).
- **Lifecycle:** `DRAFT` → `PENDING` → (`APPROVED` → `RECEIVED`, future sprints) or
  `CANCELLED` at any point before receiving. Never physically deleted (see "Status"
  below).

**Fields:**

| Field                                      | Notes                                                                                                                                                                                                                 |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PO Number (`purchaseOrderNumber`)          | Auto-generated (`PO-000001`, `PO-000002`, ...), globally unique, immutable — never accepted on create or update input. See "Purchase Order Number" below.                                                             |
| Supplier (`supplierId`)                    | Required. Must exist within the caller's own organisation (`404` otherwise).                                                                                                                                          |
| Order Date (`orderDate`)                   | Required.                                                                                                                                                                                                             |
| Expected Delivery (`expectedDeliveryDate`) | Optional.                                                                                                                                                                                                             |
| Status (`status`)                          | Enum. See "Status" below.                                                                                                                                                                                             |
| Remarks (`remarks`)                        | Optional free text.                                                                                                                                                                                                   |
| Subtotal (`subtotal`) / Total (`total`)    | Always server-calculated, never accepted on input. See "Automatic Calculations" below.                                                                                                                                |
| Created/Updated/Approved By                | `createdById`/`updatedById`/`approvedById` — plain nullable string columns, no FK relation, same convention as `AuditLog.actorUserId`. `approvedById` is always `null` this sprint — no approval workflow exists yet. |
| Created/Updated At                         | Standard `createdAt`/`updatedAt` timestamps, automatically maintained.                                                                                                                                                |

### PurchaseOrderItem

- **Responsibility:** one line of a Purchase Order — "buy this much of this product at
  this price."
- **Relationships:** belongs to one `PurchaseOrder` (`onDelete: Cascade` — deleting the
  parent, which never happens via any endpoint, would take its lines with it);
  references one `Product` (`onDelete: Restrict` — a product referenced by a PO line
  can't be removed out from under it; moot in practice since Product also has no delete
  endpoint).
- **Type restriction:** only products whose `type` is `RAW_MATERIAL`,
  `PACKAGING_MATERIAL`, or `CONSUMABLE` may be referenced — enforced in
  `PurchaseOrderService.buildItems`, not the database (brief: "This validation belongs
  inside the service layer"). A `FINISHED_PRODUCT` line is rejected with a `400`: a
  manufacturer buys inputs, not its own output.

**Fields:** `productId`, `quantity`, `unitPrice`, and a server-calculated `lineTotal`
(`quantity * unitPrice`) — see "Automatic Calculations" below.

### Purchase Order Number

Format: `PO-000001`, `PO-000002`, ... (fixed `PO` prefix + 6-digit zero-padded sequence).
Generated by `PurchaseOrderService`'s private number generator — a collision-avoidance
loop identical in shape to `SupplierService`/`ProductService`'s code generators, globally
unique (checked via `PurchaseOrderRepository.existsByNumber` with no `organisationId`
filter, same as `Product.code`/`Supplier.supplierCode`). Requirements enforced: unique,
immutable, never editable, always generated automatically — `purchaseOrderNumber` is
absent from both `createPurchaseOrderSchema` and `updatePurchaseOrderSchema`.

### Status

`DRAFT` (default) → `PENDING` → (`APPROVED`, not reachable yet) →
`PARTIALLY_RECEIVED` → `RECEIVED`, or `CANCELLED` from `DRAFT`/`PENDING`. Sprint 4.3
only reached `DRAFT`/`PENDING`/`CANCELLED` — `APPROVED`/`RECEIVED` existed in the enum
unused. Sprint 4.4.1 added `PARTIALLY_RECEIVED` and gave Inventory the only path to
`PARTIALLY_RECEIVED`/`RECEIVED`: `InventoryService.receiveGoods`
(`POST /api/inventory/goods-receipts`), documented fully in
[`inventory.md`](inventory.md) §3 "Purchase Order Status." In short: the status tracks
**delivery completeness** (cumulative delivered quantity vs. ordered quantity, summed
across every Goods Receipt), not acceptance/rejection — a Purchase Order can reach
`RECEIVED` even if some of what was delivered was rejected; that rejection is tracked
separately, per receipt, via `GoodsReceipt.discrepancyStatus`.

There is no dedicated "Issue" action — a new PO always starts `DRAFT` (the Create
dialog has no Status field), and reaching `PENDING` ("issued to a supplier") happens by
editing the order and changing its Status field via `PATCH`, which is restricted by the
validation schema to `DRAFT`/`PENDING` only — `PARTIALLY_RECEIVED`/`RECEIVED` are never
settable through this endpoint, only through actually receiving goods. `CANCELLED` is
reachable only through the dedicated `POST /:id/cancel` endpoint, keeping cancellation a
distinct, separately-audited, one-way action.

**Purchase orders are never physically deleted** (brief: "No DELETE. Cancelled POs
remain in history"). Three states are terminal for editing/cancelling purposes:

- `CANCELLED` — `PurchaseOrderService.update`/`cancel` both reject with a `400`
  ("Cancelled purchase orders cannot be edited"/"...is already cancelled").
- `PARTIALLY_RECEIVED`/`RECEIVED` (Sprint 4.4.1) — `PurchaseOrderService.update`/`cancel`
  both reject with a `400` ("Purchase orders that have already started receiving cannot
  be edited/cancelled") — once Inventory has recorded a delivery against an order,
  changing its items/supplier would corrupt the ordered-quantity figures Inventory's
  outstanding/excess calculations depend on, and cancelling an order that's already (at
  least partly) fulfilled doesn't reflect reality.

The frontend's `PurchaseOrderDialog` renders every field disabled with no submit button
for all three of these states (`EDITABLE_STATUSES = ['DRAFT', 'PENDING']`), and instead
shows a read-only "Receiving Summary" table (Ordered/Delivered/Accepted/Rejected/
Outstanding per item) whenever the order has any receiving activity — see
[`inventory.md`](inventory.md) §4.

## 3. Workflows

- **Create** — `POST /api/procurement/purchase-orders` (Owner/Administrator only).
  Validates the supplier exists in the caller's organisation and every item's product
  exists and is a purchasable type, computes `lineTotal`/`subtotal`/`total`, generates
  `purchaseOrderNumber`, and always starts `DRAFT`. Audited as `purchase-order.created`.
- **Edit** — `PATCH /api/procurement/purchase-orders/:id` (Owner/Administrator only,
  `DRAFT`/`PENDING` only — `400` if the order is `CANCELLED`). Partial update of any
  header field; submitting `items` replaces the entire line list (delete-then-recreate
  within a transaction, not a line-level diff) and recalculates totals. Audited as
  `purchase-order.updated`.
- **Cancel** — `POST /api/procurement/purchase-orders/:id/cancel` (Owner/Administrator
  only). The only path to `CANCELLED`; rejects an already-cancelled order with a `400`
  rather than silently no-opping. Audited as `purchase-order.cancelled`.
- **Browse** — `GET /api/procurement/purchase-orders` (any authenticated user, Member
  included — read-only). Accepts optional `?search=`, `?status=`, `?supplierId=` query
  params; the frontend applies all three filters client-side over the already-fetched
  list (no pagination, matching the Product Catalogue/Supplier Management convention for
  a small dataset).
- **View one** — `GET /api/procurement/purchase-orders/:id` (any authenticated user).

## 4. Authorization

Reuses `RolesGuard` exactly as every other domain does (identity.md §6, Sprint 2.1):

| Role          | Access                           |
| ------------- | -------------------------------- |
| Owner         | Full access (create/edit/cancel) |
| Administrator | Full access (create/edit/cancel) |
| Member        | Read-only (`GET` endpoints only) |

No permission-key engine — same minimal role-name check every other write surface in
this codebase uses.

## 5. Automatic Calculations

Every figure is computed server-side and never trusted from the client (brief: "Never
trust frontend calculations"):

- **Line Total** = `quantity × unitPrice`, computed per item in
  `PurchaseOrderService.buildItems`.
- **Subtotal** = the sum of every line's `lineTotal`.
- **Total** = `subtotal` — no taxes or discounts in MVP (brief's explicit constraint).
  Kept as its own column rather than always reading `subtotal` directly so a future
  tax/discount migration is additive, not a rename.

Every calculation step rounds to 2 decimal places to limit floating-point drift
accumulating across line items — see "Known Limitations" for why this schema uses `Float`
rather than an arbitrary-precision `Decimal` type.

## 6. Integration Points

- **Supplier Management** ([suppliers.md](suppliers.md)) — every `PurchaseOrder`
  references `Supplier.id`; `PurchaseOrderService` validates the supplier exists in the
  caller's organisation via the exported `SupplierRepository` (no direct Prisma access
  to the `suppliers` table from Procurement code).
- **Product Catalogue** ([catalogue.md](catalogue.md)) — every `PurchaseOrderItem`
  references `Product.id`; validated via the exported `ProductRepository` the same way.
  Sprint 4.3 also added a fourth `ProductType` — `CONSUMABLE` — so Procurement has a
  complete set of purchasable input types alongside Raw Material/Packaging Material.
- **Inventory** ([inventory.md](inventory.md), Sprint 4.4/4.4.1) — the natural next
  consumer: `InventoryService.receiveGoods` references `PurchaseOrder`/
  `PurchaseOrderItem` (via the exported `PurchaseOrderRepository`, read-only) to record
  what was actually delivered/accepted/rejected, and is the _only_ code path that ever
  writes `PurchaseOrder.status` to `PARTIALLY_RECEIVED`/`RECEIVED` — a deliberate,
  documented exception to the "domains write only their own tables" convention, made
  for the receiving transaction's atomicity (see `inventory.md` §6).
- **Purchase Approval Workflow (future, not yet built)** — `APPROVED` and `approvedById`
  already exist in the schema, unused, reserved for whenever that workflow is designed.
- **Accounting** ([accounting.md](accounting.md), Sprint 8) — indirect only: it is
  **Inventory's** Goods Receipt event, not any Procurement action, that triggers a
  Journal Entry posting (`DR Inventory / CR Accounts Payable`, with any
  accepted-beyond-ordered excess split into `GRNI — Pending Approval` — see
  accounting.md §9). Confirming, issuing, or otherwise progressing a `PurchaseOrder`'s
  own status creates no accounting entry by itself; a supplier's commercial liability
  is still recognised only once goods are actually received.
- **Supplier Returns & Replacement Goods** ([inventory.md](inventory.md), Sprint 11) —
  the reverse of Goods Receipt: physically returning previously-accepted goods to a
  supplier (`SupplierReturn`), and a supplier's replacement shipment for previously-
  rejected goods (`GoodsReceipt.replacesGoodsReceiptId`). Both live entirely in
  Inventory's domain, same rationale as Goods Receipt itself — `PurchaseOrder` is only
  ever read, never written, by either mechanism.

## 7. API Reference

| Endpoint                                           | Auth                                           | Input                                                                                                     | Output                                                                                                 |
| -------------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `GET /api/procurement/purchase-orders`             | Any authenticated user                         | Optional `?search=`, `?status=`, `?supplierId=`                                                           | `200 { items: PurchaseOrder[] }`                                                                       |
| `GET /api/procurement/purchase-orders/:id`         | Any authenticated user                         | —                                                                                                         | `200` — a single `PurchaseOrder`                                                                       |
| `POST /api/procurement/purchase-orders`            | Owner or Administrator only (`403` for Member) | `{ supplierId, orderDate, expectedDeliveryDate?, remarks?, items: [{ productId, quantity, unitPrice }] }` | `201` — the created `PurchaseOrder` (`status: DRAFT`)                                                  |
| `PATCH /api/procurement/purchase-orders/:id`       | Owner or Administrator only                    | Partial of the same fields as create, plus optional `status` (`DRAFT`/`PENDING` only)                     | `200` — the updated `PurchaseOrder`; `400` if the order is `CANCELLED`/`PARTIALLY_RECEIVED`/`RECEIVED` |
| `POST /api/procurement/purchase-orders/:id/cancel` | Owner or Administrator only                    | —                                                                                                         | `200` — `400` if already `CANCELLED`, or `PARTIALLY_RECEIVED`/`RECEIVED`                               |

Every write is scoped to the caller's own `organisationId` (from their JWT) — a
cross-tenant `id` 404s exactly like a nonexistent one, never leaking whether the
purchase order exists in another tenant. There is no `DELETE` endpoint (see "Status"
above). `PARTIALLY_RECEIVED`/`RECEIVED` are set only by
[`POST /api/inventory/goods-receipts`](inventory.md#7-api-reference), never by this
domain's own endpoints.

## 8. Audit Events

| Action                     | When                                               |
| -------------------------- | -------------------------------------------------- |
| `purchase-order.created`   | `POST /api/procurement/purchase-orders`            |
| `purchase-order.updated`   | `PATCH /api/procurement/purchase-orders/:id`       |
| `purchase-order.cancelled` | `POST /api/procurement/purchase-orders/:id/cancel` |

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

model PurchaseOrder {
  id                   String              @id @default(cuid())
  organisationId       String
  purchaseOrderNumber  String              @unique
  supplierId           String
  orderDate            DateTime
  expectedDeliveryDate DateTime?
  status               PurchaseOrderStatus @default(DRAFT)
  remarks              String?
  subtotal             Float
  total                Float
  createdById          String?
  updatedById          String?
  approvedById         String?
  createdAt            DateTime            @default(now())
  updatedAt            DateTime            @updatedAt

  organisation Organisation       @relation(fields: [organisationId], references: [id], onDelete: Cascade)
  supplier     Supplier           @relation(fields: [supplierId], references: [id], onDelete: Restrict)
  items        PurchaseOrderItem[]

  @@index([organisationId])
  @@index([organisationId, status])
  @@index([organisationId, supplierId])
  @@map("purchase_orders")
}

model PurchaseOrderItem {
  id              String   @id @default(cuid())
  purchaseOrderId String
  productId       String
  quantity        Float
  unitPrice       Float
  lineTotal       Float
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  purchaseOrder PurchaseOrder @relation(fields: [purchaseOrderId], references: [id], onDelete: Cascade)
  product       Product       @relation(fields: [productId], references: [id], onDelete: Restrict)

  @@index([purchaseOrderId])
  @@index([productId])
  @@map("purchase_order_items")
}
```

See migration `20260802171910_add_procurement_purchase_orders` for the exact SQL
(including the `ProductType` enum's new `CONSUMABLE` value, added in the same
migration).

## 10. Known Limitations (Sprint 4.4.1)

- No Supplier Invoices, Purchase Approval Workflow, Payments, multi-currency, taxes, or
  discounts — all explicitly out of scope, reserved for later Procurement sprints.
  Goods Receiving itself now exists — see [`inventory.md`](inventory.md) — including
  partial deliveries and excess supply, which this document's Sprint 4.3 revision had
  listed as out of scope.
- Amounts (`unitPrice`, `quantity`, `lineTotal`, `subtotal`, `total`) are stored as
  `Float`, not an arbitrary-precision `Decimal` — this schema has no prior precedent for
  `Decimal` (no domain before this one has dealt with money), and Float with
  per-calculation rounding to 2 decimal places is sufficient for the MVP figures
  involved. Worth revisiting if/when real accounting precision becomes a requirement.
- Reaching `PENDING` has no dedicated "Issue" UI action or endpoint — it's a Status field
  change via the Edit dialog/`PATCH`, same mechanism as every other header edit.
  `PARTIALLY_RECEIVED`/`RECEIVED`, by contrast, have no UI action at all in this
  domain — they're set exclusively by Inventory's receiving endpoint.
- **Resolved in Sprint 11** — Supplier Returns and Replacement Goods are now built (see
  [inventory.md](inventory.md) "Supplier Returns"/"Replacement Goods"), closing a gap
  this document previously left as future Procurement work. No Supplier Claims/dispute-
  management workflow exists beyond the lightweight discrepancy-resolution state
  (Sprint 4.4.1, extended Sprint 11) — deliberately out of scope, same as before.
