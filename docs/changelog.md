# Changelog

All notable, user-facing or significant changes to Zentuva are documented here, per
[Handbook Principle 7](handbook/engineering-handbook.md#5-product-principles).

## [Unreleased]

_Nothing yet._

## [Sprint 4.9 Sales Execution & Order Fulfilment Foundation] - 2026-08-22

### Added

- **`SalesFulfilment`/`SalesFulfilmentItem`** — the one explicit, atomic, audited
  operation that actually moves inventory for a Sales Order. `SalesOrderStatus` gains
  `PARTIALLY_FULFILLED`/`FULFILLED` (`DRAFT → CONFIRMED → PARTIALLY_FULFILLED →
FULFILLED`, derived from `Σ SalesOrderItem.quantityFulfilled` vs `Σ quantity` after
  every fulfilment, never stored independently). Modelled directly on Production's
  `ProductionMaterialIssue`/`ProductionMaterialIssueItem`: a Sales Order may have many
  fulfilment batches over time (partial shipments), each pinned to one
  `InventoryLocation`.
- **New endpoints**: `GET /api/sales/orders/:id/availability` (read-only
  ordered/fulfilled/remaining/availableStock/shortfall per line, never gates
  fulfilment), `GET /api/sales/orders/:id/fulfilments` (history), `POST
/api/sales/orders/:id/fulfil` (Owner/Administrator only) — the atomic write.
- **Atomicity, mirroring `ProductionMaterialIssueRepository.issue()` exactly**:
  `SalesFulfilmentRepository.create()` runs an idempotency check, a conditional
  eligibility re-check, a per-item `InventoryStock` read-guard-decrement (negative stock
  structurally impossible), the fulfilment+items write, paired `InventoryTransaction`
  `ISSUE` rows (`referenceType: 'SalesFulfilment'` — the same shared ledger Production's
  Material Issue already writes to, no new transaction type), and the item/order status
  recomputation, all inside one `$transaction`, rolled back together on any failure.
- **Idempotency** — a new `SalesFulfilment.idempotencyKey` column +
  `@@unique([salesOrderId, idempotencyKey])`. Both the Admin dialog and the Field Sales
  sheet generate one via `crypto.randomUUID()` per fulfilment attempt; a retried request
  with the same key returns the original fulfilment instead of double-deducting stock —
  verified live (a duplicate submit produced exactly one stock deduction, one
  `InventoryTransaction`, and no duplicate audit event).
- **Cancellation guard** — once any fulfilment is recorded, `POST /:id/cancel` returns a
  clear `400` ("Cannot cancel an order after fulfilment has started") instead of
  silently succeeding or 404ing.
- **A deliberate, documented, narrow exception to Sprint 4.8's "Sales never touches
  Inventory" rule**: `sales.module.ts` now imports `InventoryModule` — but only so the
  new `SalesFulfilmentService`/`SalesFulfilmentRepository` can reach it.
  `SalesOrderService` (order create/update/confirm/cancel) still has zero Inventory
  imports of its own, and `direct-sales-independence.spec.ts`'s structural guard was
  narrowed (not deleted) to assert this precisely against `sales-order.service.ts`'s own
  source rather than the whole module.
- **Admin UI**: a new `SalesFulfilmentDialog` (mirrors `MaterialIssueDialog`'s
  Ordered/Already Fulfilled/Remaining/Available grid, plus a Location picker), wired into
  `sales-order-detail-dialog.tsx`'s footer; a "Fulfilment History" section and a
  "Fulfilled" items column.
- **Field Sales UI**: a full-screen (`Sheet side="full"`) fulfilment flow off the sticky
  action bar on the order detail screen, and an informational, non-blocking "In stock: X
  {unit}" line under each item card on the new-order screen.
- **Seed data**: `SO-000001` now demonstrates a partial fulfilment (one line partially,
  one fully — order lands on `PARTIALLY_FULFILLED`); new `SO-000008`
  (`CONFIRMED`/unfulfilled fixture) and `SO-000009` (fully `FULFILLED` in one batch); a
  new finished-goods stock top-up for the two SKUs these orders sell. Verified idempotent
  (seed run twice, zero double-deduction, identical summary counts).

### Verified live

Full Boby Bites fulfilment walkthrough against the running application (not just unit
tests): partial fulfilment → full fulfilment → terminal-state rejection (fulfil and
cancel both correctly blocked once `FULFILLED`) → over-fulfilment rejected with an exact
message → insufficient-stock rejected with an exact message → RBAC (Member 200 on both
`GET`s, 403 on `POST .../fulfil`) → idempotent duplicate-submit protection → Field Sales
mobile flow at 360/375/430px, including the full-screen fulfilment sheet and the
new-order stock hint.

## [Sprint 4.8 Customer, Territory, Outlet, Retail Network & Sales Foundation] - 2026-08-21

### Added

- **Five new domains**: `Customer` (the commercial account — progressive onboarding,
  only customer type/name/phone required, `customerType` purely descriptive and never a
  sales restriction), `Territory` (a self-referential, tenant-defined hierarchy of
  arbitrary depth — not fixed administrative boundaries — with a service-enforced cycle
  guard on re-parenting), `Outlet` (the physical place of business, distinct from
  `Customer`; optional territory and one-shot browser-geolocation coordinates, never
  required), `DistributionNetworkRelationship` (an optional, separate concept from
  commercial transactions — a customer never requires a distribution-network mapping to
  be registered or to place an order, and adding one never rewrites historical sales),
  and `SalesOrder`/`SalesOrderItem` (server-authoritative totals, SKU-level targeting
  only via Sprint 4.7's Product Family/Variant/SKU architecture, `DRAFT → CONFIRMED`/
  `CANCELLED` lifecycle). `apps/api/src/retail/{territory,customer,outlet,network}/` +
  `apps/api/src/sales/` — six new tables plus `OutletPhoto`, the first
  multi-file-per-entity model in this codebase (the existing single-file `FileStorage`
  port is left unmodified; a new child model calls it once per file instead).
- **The sprint's core architectural guarantee, enforced structurally**: `SalesModule`
  never imports `NetworkRelationshipModule` or `InventoryModule` — creating or confirming
  a Sales Order can neither be gated by a distribution-network relationship nor silently
  move inventory, because the code that could do either isn't even reachable from the
  Sales domain. A dedicated test file,
  `apps/api/src/sales/direct-sales-independence.spec.ts`, verifies this both
  behaviourally (every `CustomerType`, with zero network relationships, can place and
  confirm a direct order; a relationship added later never rewrites a prior order) and
  structurally (asserts the import never appears in `sales.module.ts`'s own source).
- **Outlet photography** — `POST/DELETE /api/retail/outlets/:id/photos(/:photoId)`, the
  first multi-file upload in this codebase (`FilesInterceptor`, up to 6 files per
  request). Foundational capture/store/associate only — no image analysis.
- **A brand-new mobile-first Field Sales workspace** (`apps/web/src/app/(field)/`) — a
  completely separate route group from the desktop `(app)` Workspace shell, with its own
  slim header, sticky bottom tab bar (Home/Customers/Outlets/Orders), and sticky
  bottom-of-screen primary actions on every create/edit screen. Covers: Home (quick
  actions, recent customers/orders), Customer search/detail/progressive-onboarding
  create, Outlet search/detail/create (with location capture and photo staging), and a
  3-step Sales Order flow (customer → outlet → SKU picker via a new bottom-sheet
  component) ending in a clear success screen. Shares every API with the Admin surface —
  no duplicated business logic.
- **`Sheet`** (`packages/ui/src/components/sheet.tsx`) — a new bottom-sheet/full-screen
  overlay primitive, a sibling to the existing centered-modal `Dialog` (which hardcodes
  `max-w-md` with no size variant). A new `touch` `Button` size (`h-12`, ≥44px) was added
  alongside the existing `default`/`sm`/`lg`/`icon` sizes.
- **`MultiImageUploadCard`** (`apps/web/src/components/app/`) — the multi-photo
  counterpart to the existing single-file `ImageUploadCard`, used by both the Field
  Sales outlet screen and the Admin outlet dialog.
- **Admin surfaces**: `/settings/retail` (Customers/Outlets/Territories/Network tabs,
  responsive down to a card layout on narrow viewports — a new pattern introduced only
  in this folder) and `/settings/sales` (Sales Order management), both following the
  existing tabbed-page/dialog conventions from Production/Inventory.
- **Seed data**: 7 territories (Oyo State hierarchy), 9 customers spanning every
  `CustomerType` (including one seeded with only name/type/phone, proving the
  minimum-onboarding path), 7 outlets, 3 network relationships (deliberately covering
  only 4 of 9 customers — 5 remain un-networked and buy directly, by design), and 5
  sales orders demonstrating an un-networked supermarket buying direct, an un-networked
  retailer buying direct, a distributor's own bulk direct order, a _networked_ retailer
  still buying direct, and an order with no outlet at all.
- **New audit events** — `customer.created/updated/activated/deactivated`,
  `territory.created/updated/activated/deactivated`,
  `outlet.created/updated/activated/deactivated/photo_added/photo_removed`,
  `network-relationship.created/updated/deactivated`,
  `sales-order.created/updated/confirmed/cancelled`.

### Fixed

- **Two real bugs caught during this sprint's own live verification, not present in the
  final code**: (1) an unselected native `<select>` with an empty-placeholder option
  (e.g. Territory "Not set") always submits `""`, which `z.string().min(1).optional()`
  rejects — `.optional()` only exempts `undefined`, and `""` fails `.min(1)`. Every
  affected optional id/email field in `packages/validation/src/retail.ts` now
  preprocesses `""` to `undefined` before validation. (2) `params` in a Next.js 14 Client
  Component dynamic route is a plain object, not a `Promise` — three new `[id]` routes
  had mistakenly used the Next.js 15 `use(params)` pattern, which throws
  `An unsupported type was passed to use()`; fixed to the plain `params.id` access every
  other dynamic route in this codebase already uses. Also fixed: an async-loaded
  `<select>`'s preset value (e.g. arriving at "Add Outlet" from a customer's own detail
  page) silently failing to show as selected when the option list resolves after
  `react-hook-form`'s initial mount — the same race `ProductionOrderDialog` had already
  worked around on its own BOM picker, now also applied to the Territory/Customer
  pickers in the Outlet, Customer, and Territory dialogs.

## [Sprint 4.7 Product Family, Variant & SKU Architecture Refinement] - 2026-08-15

### Added

- **`ProductFamily`/`ProductVariant`** — a grouping/reporting hierarchy layered on top of
  the existing flat Product Catalogue: `Organisation → ProductFamily → ProductVariant →
Product (SKU)`. A Family is a commercial grouping (e.g. "Plantain Chips"); a Variant is
  a recipe/formulation within it (e.g. "Sweet & Spicy — Ripe Plantain"); the SKU
  (`Product`) — unchanged, gains only an optional `productVariantId` — remains the actual
  stockable/manufacturable/sellable item every other domain transacts against. Different
  pack sizes of the same variant (30g/500g/1kg) are still each their own independent
  `Product` row; there is no dedicated pack-size entity this sprint. `GET/POST
/api/product-families`, `GET/PATCH /api/product-families/:id`, `GET/POST
/api/product-variants`, `GET/PATCH /api/product-variants/:id` (Owner/Administrator
  write, Member read-only, same `RolesGuard` convention as every other domain). Auto-
  generated immutable `FAM-000001`/`VAR-000001` codes, `ACTIVE`/`INACTIVE` status (a UI
  convenience, not a cross-domain business rule the way `Product.status` is). A variant's
  parent family cannot be changed after creation (no re-parenting) this sprint.
- **`Product` gains `productVariantId`** (nullable, `onDelete: SetNull`) — every
  pre-existing product (including the flagship `PRD-000001` with its already-`COMPLETED`
  Sprint 4.6 production history) is left with `productVariantId: null`, untouched by the
  migration. `GET /api/products`/`GET /api/products/:id` responses now include nested
  `productVariant`/`productFamily` context; write endpoints accept an optional
  `productVariantId` (validated tenant-scoped, `400` on a missing/cross-tenant id).
- **`ProductRepository` gained two new read methods** (`findByIdWithHierarchy`/
  `findManyByOrganisationWithHierarchy`) used only by `ProductService`'s own `getById`/
  `list` — its pre-existing `findById`/`findManyByOrganisation` methods, directly
  consumed by `BillOfMaterialService` for finished-product validation, were left
  byte-for-byte unchanged so Production's own Product lookups are completely unaffected
  by this sprint (confirmed by a new regression test).
- **Frontend `/settings/products`** gained a Flat/Hierarchy view toggle — the hierarchy
  view groups every SKU under its real Family → Variant tree (looked up from the actual
  fetched Family/Variant lists, never fabricated from a product's own narrow nested
  data), with clickable headers opening the corresponding edit dialog. The flat table
  gained a "Family / Variant" column. New "Add Family"/"Add Variant" entry points open
  `ProductFamilyDialog`/`ProductVariantDialog`. The existing `ProductDialog` gained a
  cascading Family → Variant picker (Family selection is local UI state; only the
  resolved `productVariantId` is submitted), shown only when creating/editing a
  `FINISHED_PRODUCT` — a UI convention, not a server-side restriction.
- **Seed data** — a "Plantain Chips" `ProductFamily` with 3 variants (Sweet & Spicy—Ripe,
  Green & Spicy—Unripe, Classic Salted), each with 30g/500g/1kg SKUs (9 total), plus one
  BOM + Production Order against the Sweet & Spicy 30g SKU demonstrating the full
  Family→Variant→SKU→BOM→Production Order chain. Idempotent across repeated runs.
- **New audit events** — `product-family.created/updated`, `product-variant.created/
updated`.

### Fixed

- A seed-data code collision, caught during this sprint's own database verification: the
  originally-chosen seed codes (`PRD-000020`, `BOM-000002`, `PROD-000002`) silently
  collided with pre-existing rows belonging to a _different_ organisation already present
  in the shared dev database — `Product.code`/`BillOfMaterial.bomNumber`/
  `ProductionOrder.productionOrderNumber` are all globally unique, not per-organisation,
  so the seed script's `upsert` no-op'd against the wrong org's row instead of creating
  the intended Boby Bites SKU. Fixed by switching to verified-free codes
  (`PRD-000030`/`BOM-000003`/`PROD-000003`) and documenting the discovery mechanism in
  the seed script for future sprints' awareness.

### Known limitations

- No dedicated pack-size entity, attribute/option engine, product configurator, or
  e-commerce-style variant selector — the hierarchy is a fixed three-level tree, not a
  generic attribute system, per this sprint's explicit anti-over-engineering brief.
- No re-parenting a `ProductVariant` to a different `ProductFamily`, and no way to detach
  a `Product` from its `ProductVariant` once attached.
- No cross-family/variant aggregation query (e.g. total units across every pack size of a
  variant) — the relational structure makes this straightforward to build later, but no
  such query/endpoint exists yet.
- BOM/Production Order/Inventory Stock continue to target the SKU (`Product`) exclusively
  — this is a deliberate, non-negotiable architectural boundary, not a limitation to be
  lifted later.

## [Sprint 4.6 Production Management & Bill of Materials Foundation] - 2026-08-15

### Added

- **`BillOfMaterial`/`BillOfMaterialItem`** — a recipe defining how much of each
  Raw Material/Packaging Material/Consumable a `FINISHED_PRODUCT` needs to produce a
  given yield quantity. `DRAFT → ACTIVE → INACTIVE` lifecycle; only one `ACTIVE` BOM
  per finished product at a time (activating one atomically deactivates any prior
  `ACTIVE` BOM for the same product); editable only while `DRAFT` — a BOM that has
  ever been active is superseded by creating a new version, never edited in place.
  `GET/POST /api/production/boms`, `PATCH .../:id`, `POST .../:id/activate`,
  `POST .../:id/deactivate` (Owner/Administrator write, Member read-only).
- **`ProductionOrder`/`ProductionOrderItem`** — an instruction to manufacture a
  planned quantity of a finished product against one pinned Bill of Materials at one
  `InventoryLocation`. Material requirements are computed once at creation
  (`bomItem.quantity × plannedQuantity ÷ bom.yieldQuantity`) and snapshotted into
  `ProductionOrderItem`, never recalculated even if the source BOM is later edited or
  superseded. Status lifecycle `DRAFT → PLANNED → IN_PROGRESS → COMPLETED`, with
  `CANCELLED` reachable only from `DRAFT`/`PLANNED` — once material is issued,
  cancellation is structurally impossible (documented limitation, not a silent
  inventory reversal). `GET/POST /api/production/orders`, `PATCH .../:id`,
  `POST .../:id/plan`, `POST .../:id/cancel`.
- **Material Availability Check** — `GET /api/production/orders/:id/availability`
  returns Required/Available/Shortfall per component, purely informational — it never
  gates planning, issuing, or completing an order (no stock-reservation engine this
  sprint).
- **`ProductionMaterialIssue`/`ProductionMaterialIssueItem`** —
  `POST /api/production/orders/:id/material-issues` atomically consumes raw materials
  out of Inventory: decrements `InventoryStock` and appends a paired
  `InventoryTransaction` `ISSUE` row per component, inside one transaction (all
  components succeed together or the whole issue rolls back). Over-issue (cumulative
  issued exceeding required) and insufficient stock are both rejected with a `400`.
  Supports multiple partial issues over time. The _first_ successful issue against an
  order automatically transitions it from `PLANNED` to `IN_PROGRESS` — there is no
  separate manual "Start" endpoint.
- **`ProductionRun` — Production Execution** —
  `POST /api/production/orders/:id/complete` records
  Planned/Produced/Rejected/Accepted as distinct figures; `acceptedQuantity` is always
  server-computed (`produced - rejected`) and never accepted from the client. A small
  controlled `ProductionRejectionReason` enum (`BURNT`/`UNDERWEIGHT`/
  `PACKAGING_DEFECT`/`POOR_SEAL`/`OTHER`) + free-text notes, not a full Quality
  Management System. Only reachable from `IN_PROGRESS`; on success the order becomes
  `COMPLETED` and, only when `acceptedQuantity > 0`, the finished product's
  `InventoryStock` increases via a paired `InventoryTransaction` `RECEIPT` row — a
  fully-rejected run writes no stock/ledger row at all.
- **`InventoryModule` now exports** `InventoryStockRepository`,
  `InventoryTransactionRepository`, `InventoryLocationRepository` (previously exported
  nothing), so Production can read stock/location data directly. The atomic
  stock-_moving_ writes (Material Issue, Finished Goods Receipt) reuse
  `GoodsReceiptRepository.receive`'s own precedent — a narrow, documented exception to
  ADR-002's domain-ownership convention, made for atomicity — writing directly into
  `inventory_stock`/`inventory_transactions` from Production's own repositories rather
  than through Inventory's controller/service.
- **Frontend `/settings/production`** — Bills of Materials and Production Orders tabs,
  consistent with the existing Zentuva Workspace UI. `BillOfMaterialDialog`
  (create/edit with a component grid, Add/Remove rows); `ProductionOrderDialog`
  (select an active BOM → live client-computed Material Requirements preview scaling
  with planned quantity); `ProductionOrderDetailDialog` (requirement snapshot,
  availability banner, material issue history, production result, and every reachable
  status-transition action); `MaterialIssueDialog` (Required/Already Issued/
  Remaining/Available per component, blocks over-issue/over-available client-side);
  `ProductionRunDialog` (live-computed, read-only Accepted preview). Production nav
  item activated (`/settings/production`, no longer "Coming Soon").
- **New audit events** — `production.bom.created/updated/activated/deactivated`,
  `production.order.created/updated/planned/started/cancelled`,
  `production.material-issued`, `production.completed`,
  `production.finished-goods-received`.

## [Sprint 4.5 Inventory Control & Stock Management] - 2026-08-15

### Added

- **`InventoryLocation`** — a minimal physical-location model (name + Active/Inactive
  status, no bins/shelves/zones/barcodes). Every stock balance is now
  `Organisation + Product + Location`, not just `Organisation + Product`. Every
  organisation gets a "Main Warehouse" default location, created lazily and
  idempotently the first time it's actually needed (first Goods Receipt, first
  Adjustment, or first visit to the Locations tab) rather than hooked into
  organisation registration. Owner/Administrator can add, rename, and
  activate/deactivate additional locations via `GET/POST /api/inventory/locations`,
  `PATCH /api/inventory/locations/:id`; the default location can never be
  deactivated (every caller that doesn't pick a location falls back to it).
- **Manual stock adjustments** — `POST /api/inventory/adjustments` (Owner/Administrator
  only), the first controlled write path to `InventoryStock` outside of receiving.
  Takes a Product, an optional Location (default location if omitted), a signed
  quantity delta, a structured reason (`PHYSICAL_COUNT`/`DAMAGE`/`SPOILAGE`/`LOSS`/
  `FOUND_STOCK`/`DATA_CORRECTION`/`OTHER`), and optional notes. Writes a new
  `InventoryTransaction` `ADJUSTMENT` row and updates `InventoryStock.quantityOnHand`
  atomically, in that order, inside one transaction — the same "ledger first, cache
  second" discipline `GoodsReceiptRepository.receive` already established. Hard
  negative-stock prevention: an adjustment that would take `quantityOnHand` below zero
  is rejected (`400`), never silently clamped.
- **Frontend `StockAdjustmentDialog`** — Product/Location/Adjustment Type
  (Increase/Decrease)/Quantity/Reason/Notes, with a live-computed, read-only "New
  Balance" preview and the Save button disabled if that preview would go negative.
- **Frontend Locations tab** — list every location with its status and how many
  distinct products currently have stock there; create/rename/deactivate via
  `LocationDialog`.
- **Frontend Inventory Summary enhancements** — new Code/Type/UoM/Location/Quantity
  Available/Last Movement columns, plus Product Status and Location filters alongside
  the existing search and Product Type filter.
- **Frontend running balance** — the Transactions tab, once filtered to a single
  product, shows a client-computed running balance per row (ascending cumulative sum
  of the ledger's `quantity`, displayed against the existing newest-first ordering) —
  no new endpoint, since `GET /api/inventory/transactions?productId=` already returns
  everything needed.
- **New audit events** — `inventory.adjusted`, `inventory.location.created`,
  `inventory.location.updated`, `inventory.location.deactivated`.

### Changed

- **`InventoryStock`**'s unique key changed from `(organisationId, productId)` to
  `(organisationId, productId, locationId)`; gained `quantityReserved` (always `0`
  this sprint — reservation itself isn't implemented, the column exists purely so a
  future Sales/Production workflow doesn't need a shape change) and a computed
  `quantityAvailable` (`quantityOnHand - quantityReserved`) in API responses.
- **`InventoryTransaction`** gained `locationId`, `adjustmentReason`, `notes`, and
  `createdById`; `referenceId` became nullable (a manual adjustment has no other
  entity to point at, unlike a `GoodsReceipt`-sourced `RECEIPT` row).
- **`GoodsReceipt`** gained `locationId` — every receipt now records which location it
  was received into (always the organisation's default location this sprint; there is
  still no location picker on the Goods Receiving form, per the brief's explicit
  "without breaking the existing flow" instruction).
- **`GET /api/inventory`** gained `?productStatus=`/`?locationId=` filters alongside
  the existing `?search=`/`?productType=`.

### Fixed

- `InventoryModule` was missing `InventoryLocationRepository` from its provider list,
  which crashed the whole API at boot (`Nest can't resolve dependencies of
InventoryService`) the moment `InventoryService`'s constructor grew a fourth
  repository dependency — caught during this sprint's own live-server verification,
  fixed before merge.

## [Sprint 4.4.1 Goods Receiving, Inspection & Supplier Discrepancy Refinement] - 2026-08-13

### Changed

- **Redesigned the receiving model** to distinguish what was ordered from what a
  supplier actually delivered, what passed inspection, what was rejected, what remains
  outstanding, and what happened to the discrepancy — a real manufacturing receiving
  workflow gap identified during Sprint 4.4's own local testing. `GoodsReceiptItem` now
  records `deliveredQuantity`, `rejectedQuantity`, and a server-computed
  `acceptedQuantity` (`delivered - rejected`, never accepted from the client) against
  the specific `PurchaseOrderItem` it's fulfilling, instead of a single
  `quantityReceived` figure.
- **Inventory now increases only by the accepted quantity, never the delivered
  quantity** — a rejected portion never enters usable stock or writes an
  `InventoryTransaction` row.
- **A Purchase Order may now be received more than once** — the original "received
  once" restriction is gone. Short deliveries can be completed later, a rejected batch
  can be followed by a supplier replacement, and a delivery can even be recorded against
  an order that's already fully `RECEIVED` (the brief's own worked example: order 1,000,
  receive 1,100 with 50 rejected, then later receive 50 replacement units). "Duplicate
  receipt protection" is redesigned around receipt identity — every `POST` always
  creates its own new, immutable, uniquely-numbered `GoodsReceipt` — rather than a
  status gate that blocked legitimate repeat receiving.
- **`PurchaseOrderStatus` gained `PARTIALLY_RECEIVED`.** A Purchase Order's status now
  tracks delivery completeness (cumulative delivered vs. ordered quantity across every
  receipt), not acceptance — an order can reach `RECEIVED` even if some of what arrived
  was rejected; that rejection is tracked separately, per receipt. Once a Purchase Order
  reaches `PARTIALLY_RECEIVED`/`RECEIVED`, it can no longer be edited or cancelled
  (`PurchaseOrderService`), matching the existing rule for `CANCELLED` orders.

### Added

- **A lightweight supplier-discrepancy resolution state** on each `GoodsReceipt` —
  `discrepancyStatus` (`NONE`/`PENDING_SUPPLIER`/`REPLACEMENT_EXPECTED`/
  `REPLACEMENT_RECEIVED`/`CREDIT_EXPECTED`/`RESOLVED`) plus free-text
  `discrepancyNotes`, auto-set to `PENDING_SUPPLIER` when a receipt has any rejected
  quantity. Progressable via the new
  `PATCH /api/inventory/goods-receipts/:id/discrepancy` endpoint — the one mutation ever
  applied to an otherwise-immutable `GoodsReceipt`. Deliberately not a full Supplier
  Claims/Returns/Credit-Note system.
- **Structured rejection reasons** — a `RejectionReason` enum
  (`DAMAGED`/`DEFECTIVE`/`WRONG_ITEM`/`WRONG_SPECIFICATION`/`CONTAMINATED`/`OTHER`) plus
  free-text notes per rejected line.
- **`GET /api/inventory/purchase-orders/:purchaseOrderId/receiving`** — a per-item
  Ordered/Delivered/Accepted/Rejected/Outstanding/Excess aggregate plus the full receipt
  history for a Purchase Order, powering both the Goods Receiving dialog's "previously
  delivered" context and a new read-only "Receiving Summary" table embedded in
  Procurement's own Purchase Order dialog.
- **Frontend `/settings/inventory` "Goods Receipts" tab** — the full receiving history
  (every receipt's delivered/rejected/accepted breakdown per item, rejection
  reason/notes) with an inline control to progress a receipt's discrepancy status.
- **Goods Receiving dialog reworked** — selecting a Purchase Order now loads its full
  receiving context (Ordered/Previously Delivered/Accepted/Rejected/Outstanding per
  item); the user enters Delivered Quantity and, if applicable, Rejected Quantity +
  Reason + Notes; Accepted Quantity is always shown computed, never editable; an
  "Excess Supply" badge appears when delivering more than what's outstanding, never
  blocked or capped.
- Three new audit actions: `goods-receipt.discrepancy-recorded` (a receipt has a
  rejection), `goods-receipt.replacement-received` (not the first receipt against the
  order), `goods-receipt.resolved` (`PATCH .../discrepancy` sets `RESOLVED`).
- **Seed data** — three additional Purchase Orders and five Goods Receipts spanning
  every scenario: a complete/perfect delivery, a short delivery left open, a delivery
  with rejected goods followed by an immediate replacement (demonstrating multi-receipt
  history), and an excess delivery accepted in full.
- 13 new/updated backend unit tests (`InventoryService`/`InventoryController`/
  `PurchaseOrderService`) — 200/200 total.

### Known limitations

- No Quality Management module, Supplier Claims module, Supplier Returns module,
  Accounts Payable, Credit Notes, Warehouse Management, Batch/Lot tracking, Expiry
  tracking, multi-warehouse support, or automated supplier communication — all
  explicitly out of scope per the brief, reserved for future modules.
- No automatic linkage between a rejected Goods Receipt and the later replacement that
  resolves it — a person must mark the original `RESOLVED`; the system doesn't infer the
  connection.
- The Purchase Order status write remains a deliberate, documented exception to
  ADR-002's domain-ownership convention (now guarding against a concurrent cancel rather
  than blocking repeat receiving) — see `docs/domains/inventory.md` §6.

## [Sprint 4.4 Inventory Management (Goods Receiving)] - 2026-08-13

### Added

- **Inventory domain** (`apps/api/src/inventory/`) — the fourth non-Identity business
  domain module, and the first to consume Procurement directly: it receives an existing
  `PurchaseOrder`'s items into a live per-product stock balance and transitions the order
  to `RECEIVED`. Not a stock management sprint — no warehouse transfers, stock
  adjustments, or inventory counts — see `docs/domains/inventory.md`.
- **`GoodsReceipt`/`GoodsReceiptItem`, `InventoryStock`, `InventoryTransaction` Prisma
  models** (migration `20260813153410_add_inventory_goods_receiving`): auto-generated
  immutable `goodsReceiptNumber` (`GRN-000001`, ...), a live `quantityOnHand` balance per
  `(Organisation, Product)`, and a new `InventoryTransactionType` enum
  (Receipt/Issue/Adjustment — this sprint only ever writes `RECEIPT` rows).
- **A ledger-centric design from day one** — per the brief's own architectural
  recommendation, `InventoryTransaction` is the immutable, insert-only source of truth
  for every stock movement; `InventoryStock` is a fast-to-query cache of where that
  ledger currently nets out. Every future module that moves stock (Production, Sales,
  Stock Adjustment) is expected to write into this same table.
- **Receiving Rules** — a Purchase Order may only be received once; only a `PENDING`
  order is eligible (`CANCELLED` and already-`RECEIVED` orders are rejected with
  distinct `400`s); every submitted item must already belong to the Purchase Order being
  received. Enforced in `InventoryService.receiveGoods` _and_ re-checked inside
  `GoodsReceiptRepository.receive`'s own database transaction — the transaction's own
  `updateMany` only matches a `PENDING` order, so a concurrent duplicate-receive attempt
  finds zero rows and the whole transaction rolls back, preventing a partial stock
  increment against an order that didn't actually transition.
- **API** — `GET /api/inventory`, `GET /api/inventory/:productId`,
  `GET /api/inventory/transactions`, `GET`/`POST /api/inventory/goods-receipts`,
  `GET /api/inventory/goods-receipts/:id`. `GET` requires only authentication (Member has
  read-only access); the one write (`POST .../goods-receipts`) requires Owner or
  Administrator (`RolesGuard`). No `PATCH`/`DELETE` endpoints — Goods Receipts are
  immutable.
- **`packages/validation/src/inventory.ts`** — `createGoodsReceiptSchema`, the line-item
  schema, and the `InventoryTransactionType` enum schema, mirroring
  `procurement.ts`/`suppliers.ts`'s conventions.
- **Frontend `/settings/inventory`** (under the Sprint 3.5 Workspace shell): an Inventory
  Summary tab (Product, Product Type, Quantity On Hand, Last Updated, with search and a
  Product Type filter) and a read-only Transactions tab (Date, Product, Type, Quantity,
  Reference), plus a `GoodsReceivingDialog` — select an eligible (`PENDING`) Purchase
  Order, its Supplier and items with expected quantities load automatically, enter each
  line's received quantity, Save.
- **Workspace navigation** — "Inventory" in the sidebar and the `/workspace` dashboard's
  Platform Modules grid now point at `/settings/inventory` and lost their "Coming Soon"
  state; every other future module continues showing "Coming Soon."
- **Seed data** — one goods receipt (`GRN-000001`) fully receiving `PO-000001` (Fresh
  Farms Ltd, Plantain, 2,000 kg — the brief's own worked example), bringing `PO-000001`
  to `RECEIVED` and seeding `InventoryStock`/`InventoryTransaction` rows to match.
- Every mutating action is audited twice per receipt: `goods-receipt.received` and
  `inventory.increased` (brief: "Record: Goods Received, Inventory Increased").
- 18 new backend unit tests (`InventoryService`/`InventoryController`) — 187/187 total.

### Known limitations

- No Stock Adjustments, Warehouse Transfers, Multiple Warehouses, Inventory Counts,
  Production Consumption, Sales Deductions, Returns, Batch/Lot Tracking, or Expiry
  Tracking — all explicitly out of scope per the brief, reserved for later Inventory and
  Production sprints.
- A Purchase Order can only be received in full, in one event — no partial receiving or
  discrepancy workflow when received quantity differs from ordered quantity.
- The Purchase Order status flip to `RECEIVED` writes to Procurement's table directly
  from inside `GoodsReceiptRepository`'s own transaction — a deliberate, documented
  exception to the "domains reference each other only through exported
  repositories/services" convention, made so all four writes (receipt, stock, ledger, PO
  status) commit or roll back together. See `docs/domains/inventory.md` §6.

## [Sprint 4.3 Procurement (Purchase Orders)] - 2026-08-02

### Added

- **Procurement domain** (`apps/api/src/procurement/purchase-order/`) — the third
  non-Identity business domain module, following the same repository/service/controller
  architecture as Product Catalogue/Supplier Management. Covers the purchasing workflow
  from creating a Purchase Order through issuing it to a supplier; goods receiving into
  Inventory is explicitly out of scope (Sprint 4.4) — see `docs/domains/procurement.md`.
- **`PurchaseOrder`/`PurchaseOrderItem` Prisma models** (migration
  `20260802171910_add_procurement_purchase_orders`): auto-generated immutable
  `purchaseOrderNumber` (`PO-000001`, ...), `PurchaseOrderStatus` enum (Draft/Pending/
  Approved/Cancelled/Received — this sprint only reaches Draft/Pending/Cancelled,
  Approved/Received are reserved for the future approval and goods-receiving workflows),
  a `Supplier` relation, and one-to-many `PurchaseOrderItem` rows (`productId`, quantity,
  unit price, and a server-calculated line total).
- **A fourth Product Type — `CONSUMABLE`** — added to the existing `ProductType` enum
  (Sprint 4.1) alongside Raw Material/Packaging Material, so Procurement has a complete
  set of purchasable input types distinct from Finished Products.
- **Automatic, server-side calculations** — every line's total is always
  `quantity * unitPrice`, the order subtotal is the sum of every line, and the total
  equals the subtotal (no taxes or discounts in MVP). Nothing submitted by the client is
  trusted for these figures; the server recomputes them from the submitted items on
  every create/update.
- **Product-type validation** — only products whose type is Raw Material, Packaging
  Material, or Consumable may appear on a Purchase Order line; Finished Products are
  rejected with a `400`. Enforced in `PurchaseOrderService` (the source of truth) and
  mirrored in the frontend's product picker, which only lists purchasable types, so a
  user can't even select a Finished Product in the first place.
- **API** — `GET`/`POST /api/procurement/purchase-orders`,
  `GET`/`PATCH /api/procurement/purchase-orders/:id`,
  `POST /api/procurement/purchase-orders/:id/cancel`. `GET` requires only authentication
  (Member has read-only access); every write requires Owner or Administrator
  (`RolesGuard`). No `DELETE` endpoint — cancelled purchase orders remain in history and
  become read-only (no further edits allowed).
- **`packages/validation/src/procurement.ts`** — `createPurchaseOrderSchema`,
  `updatePurchaseOrderSchema`, the line-item schema, and the `PurchaseOrderStatus` enum
  schema, mirroring `suppliers.ts`/`catalogue.ts`'s conventions.
- **Frontend `/settings/procurement`** (under the Sprint 3.5 Workspace shell): a purchase
  order table (number, supplier, order date, expected delivery, status badge, total,
  actions), client-side search (PO number/supplier) plus status and supplier filter
  dropdowns, and a reusable `PurchaseOrderDialog` with a header (supplier, order date,
  expected delivery, remarks) and an items grid (product picker filtered to purchasable
  types, quantity, unit price, a live-computed line total, Add/Remove Row) with running
  Subtotal/Total. A `CANCELLED` order opens the same dialog fully disabled with no submit
  button, satisfying the brief's "Cancelled POs become read-only."
- **Workspace navigation** — "Procurement" in the sidebar and the `/workspace`
  dashboard's Platform Modules grid now point at `/settings/procurement` and lost their
  "Coming Soon" state; every other future module continues showing "Coming Soon."
- **Seed data** — 5 additional raw-material/packaging Products (Plantain, Vegetable Oil,
  Printed Nylon, Salt, Cartons) and 3 example Boby Bites Purchase Orders spanning every
  status this sprint reaches: `PO-000001` (Fresh Farms Ltd, Plantain, `PENDING` — already
  issued, matching the brief's own worked example), `PO-000002` (Golden Oil Ltd,
  Vegetable Oil, `DRAFT`), `PO-000003` (PackRight Nigeria, Printed Nylon, `CANCELLED`).
- Every mutating endpoint is audited: `purchase-order.created`, `purchase-order.updated`,
  `purchase-order.cancelled`.
- 16 new backend unit tests (`PurchaseOrderService`/`PurchaseOrderController`) —
  169/169 total.

### Known limitations

- No Goods Receiving, Inventory Transactions, Supplier Invoices, Purchase Approval
  Workflow, Payments, multi-currency, taxes, discounts, partial deliveries, or back
  orders — all explicitly out of scope per the brief, reserved for later Procurement and
  Inventory sprints.
- Reaching `PENDING` ("issued to supplier") happens by editing a `DRAFT` order and
  changing its Status field — there is no separate "Issue" action/endpoint this sprint.
- Amounts are stored as `Float`, not an arbitrary-precision `Decimal` type — consistent
  with the rest of this schema, which has no precedent for `Decimal` yet, and sufficient
  for the MVP figures involved; each calculation step rounds to 2 decimal places to limit
  floating-point drift.

## [Sprint 4.2 Supplier Management] - 2026-08-02

### Added

- **Supplier Management domain** (`apps/api/src/suppliers/supplier/`) — the second
  non-Identity business domain module, following the same repository/service/controller
  architecture as the Product Catalogue (Sprint 4.1): `SupplierRepository`,
  `SupplierService`, `SupplierController`, `SupplierModule`. Deliberately **not**
  Procurement — no Purchase Orders, Goods Receiving, Invoices, or Product–Supplier
  relationships; this is the master vendor record Procurement (Sprint 4.3+) is expected to
  reference by id — see `docs/domains/suppliers.md`.
- **`Supplier` Prisma model** (migration `20260802163405_add_supplier_management`):
  auto-generated immutable `supplierCode`, `supplierName`, `displayName`, contact fields
  (`contactPerson`, `email`, `phoneNumber`, `website`), location fields (`country`,
  `state`, `city`, `address`), `taxIdentificationNumber`, `supplierCategory` enum (Raw
  Material/Packaging/Logistics/Maintenance/Utility/Service/Other), `status` enum
  (Active/Inactive — never physically deleted), `notes`, and `createdById`/`updatedById`
  metadata (plain columns, no FK relation, same convention as `Product.createdById`).
- **Supplier Code generation** — `SUP-000001`, `SUP-000002`, ... — a global sequential
  collision-avoidance loop mirroring `ProductService.generateUniqueCode` (Sprint 4.1).
  Immutable and never accepted on create/update input.
- **API** — `GET`/`POST /api/suppliers`, `GET`/`PATCH /api/suppliers/:id`. `GET` requires
  only authentication (Member has read-only access); every write requires Owner or
  Administrator (`RolesGuard`, same mechanism as every other domain since Sprint 2.1). No
  `DELETE` endpoint — suppliers become `INACTIVE` via `PATCH` instead. Unlike Product's
  dedicated activate/archive routes, a status change here is just another `PATCH` field;
  the controller still records a distinct `supplier.activated`/`supplier.deactivated`
  audit event when it happens (same "status event wins" pattern as
  `UserController.resolveUpdateAuditAction`).
- **`packages/validation/src/suppliers.ts`** — `createSupplierSchema`,
  `updateSupplierSchema`, and the `SupplierCategory`/`SupplierStatus` enum schemas,
  mirroring `catalogue.ts`'s plain-string-literal convention.
- **Frontend `/settings/suppliers`** (under the Sprint 3.5 Workspace shell): a supplier
  table (code, name, category, contact person, phone, status badge, actions), client-side
  search (name/code/contact person) plus status and category filter dropdowns, and a
  proper empty-state for an organisation with no suppliers yet. A reusable
  `SupplierDialog` handles both Create and Edit, including the full field set from the
  brief (name, display name, contact person, email, phone, website, country, state, city,
  address, tax ID, category, notes, status).
- **Workspace navigation** — "Suppliers" in the sidebar and the `/workspace` dashboard's
  Platform Modules grid now point at `/settings/suppliers` and lost their "Coming Soon"
  state (added in Sprint 3.5.1); every other future module continues showing "Coming
  Soon."
- **Seed data** — 5 example Boby Bites suppliers (Fresh Farms Ltd, Golden Oil Ltd,
  PackRight Nigeria, Salt Masters Ltd, Lagos Cartons Ltd), all `ACTIVE` with realistic
  contact/location details.
- Every mutating endpoint is audited: `supplier.created`, `supplier.updated`,
  `supplier.activated`, `supplier.deactivated`.
- 14 new backend unit tests (`SupplierService`/`SupplierController`) — 153/153 total.

### Known limitations

- No Purchase Orders, Goods Receiving, Invoices, Vendor Payments, Procurement Workflows,
  Contracts, Price Lists, or Product–Supplier relationships — all explicitly out of scope
  per the brief, reserved for Procurement (Sprint 4.3+).
- Category is a fixed enum, not tenant-configurable.
- "Inactive suppliers cannot receive future Purchase Orders" is a stated business rule with
  nothing to enforce it against yet, since Purchase Orders don't exist.

## [Sprint 3.5.1 Workspace Navigation Refinement] - 2026-08-02

### Added

- Three future modules now appear as disabled "Coming Soon" entries in the Workspace
  sidebar and the `/workspace` dashboard's Platform Modules grid, so the navigation
  communicates the full long-term Manufacturing Operating System roadmap rather than
  only the modules already scheduled: **Suppliers** (`/suppliers`), **Asset Register**
  (`/assets`), and **Maintenance** (`/maintenance`). All three use the existing
  `comingSoon` mechanism from `navigation-config.ts` (Sprint 3.5) — non-clickable,
  visually identical to Procurement/Inventory/Production/Sales/Distribution/Finance/
  Reports, no routes or pages created.

### Notes

- Navigation-only change: no backend, database, API, or authentication changes. No new
  domain documentation, since these modules haven't been designed yet.

## [Sprint 4.1 Product Catalogue Foundation] - 2026-08-01

### Added

- **Product Catalogue domain** (`apps/api/src/catalogue/product/`) — the first
  non-Identity business domain module, following the same repository/service/controller
  architecture established for Identity: `ProductRepository`, `ProductService`,
  `ProductController`, `ProductModule`. Product is the master source of truth every
  future manufacturing module (Inventory, Production, Sales, ...) is expected to
  reference by id — see `docs/domains/catalogue.md`.
- **`Product` Prisma model** (migration `20260801184041_add_product_catalogue`):
  identity fields (auto-generated immutable `code`, `name`, `displayName`, `slug`),
  classification (`ProductCategory` enum — Snacks/Beverage/Water/Confectionery/Raw
  Materials/Packaging/Others; `ProductType` enum — Finished Product/Raw Material/
  Packaging Material), free-text `unit`, one image (`imageUrl`/`imageKey`, same
  `FileStorage` pattern as `Organisation.logoUrl`/`User.avatarUrl`), `ProductStatus`
  (Draft/Active/Archived — never physically deleted), and `createdById`/`updatedById`
  metadata (plain columns, no FK relation, same convention as `AuditLog.actorUserId`).
- **Product Code generation** — `PRD-000001`, `PRD-000002`, ... (`ProductService.
generateUniqueCode`), a global sequential collision-avoidance loop mirroring
  `OrganisationService.generateUniqueOrganisationCode` (Sprint 3.2). Immutable and never
  accepted on create/update input.
- **API** — `GET`/`POST /api/products`, `GET`/`PATCH /api/products/:id`,
  `POST /api/products/:id/activate`, `POST /api/products/:id/archive`,
  `POST`/`DELETE /api/products/:id/image`. `GET` requires only authentication (Member has
  read-only access); every write requires Owner or Administrator (`RolesGuard`, same
  mechanism as every other domain since Sprint 2.1). Status transitions are validated —
  activating an already-active product (or archiving an already-archived one) is a `400`,
  not a silent no-op.
- **`packages/validation/src/catalogue.ts`** — `createProductSchema`,
  `updateProductSchema`, and the `ProductCategory`/`ProductType`/`ProductStatus` enum
  schemas, mirroring `identity.ts`'s plain-string-literal convention (no `@prisma/client`
  import, since `apps/web` also depends on this package).
- **Frontend `/settings/products`** (under the Sprint 3.5 Workspace shell): a product
  table (image, code, name, category, type, status badge, updated date, actions), simple
  client-side search by name/code (no pagination, per the brief), and a proper empty-state
  for a catalogue with no products yet. A reusable `ProductDialog` handles both Create and
  Edit (the image upload control only appears in Edit mode, since uploading requires an
  existing product id); `ProductViewDialog` is a read-only details modal. Product image
  upload/preview/replace/remove reuses the Sprint 3.4 `ImageUploadCard` component.
- **Workspace navigation** — "Products" in the sidebar and the `/workspace` dashboard's
  Quick Actions/Platform Modules now point at `/settings/products` and lost their "Coming
  Soon" state; every other module continues showing "Coming Soon."
- **Seed data** — 5 example Boby Bites products (Plantain Chips, Potato Chips, Roasted
  Groundnut, Kulikuli, Chin Chin), all `SNACKS`/`FINISHED_PRODUCT`/`ACTIVE`, no images.
- Every mutating endpoint is audited: `product.created`, `product.updated`,
  `product.activated`, `product.archived`, `product.image.uploaded`,
  `product.image.removed`.
- 24 new backend unit tests (`ProductService`/`ProductController`) — 139/139 total.

### Known limitations

- No variants, batch numbers, expiry dates, barcode/QR generation, taxes, multi-image
  galleries, bulk import/export, pricing, or inventory/procurement/sales integration —
  all explicitly out of scope per the brief, reserved for their own future sprints.
- Category and Product Type are fixed enums, not a tenant-configurable taxonomy.
- The Create Product dialog cannot attach an image in the same request — a product must
  be created first (its id is needed by the upload endpoint), then edited to add an
  image.

## [Sprint 3.5 Workspace Dashboard & Global Navigation] - 2026-08-01

### Added

- **Permanent Workspace shell** — `apps/web/src/components/workspace/` (`WorkspaceLayout`,
  `Sidebar`, `Topbar`, `NavigationGroup`, `NavigationItem`, `WorkspaceHeader`,
  `QuickActionCard`, `ModuleCard`) replaces the ad-hoc `AuthenticatedNav` every
  `/settings/*`/`/account/*` route previously imported on its own. Desktop renders a fixed
  left sidebar + top bar; mobile/tablet collapse the sidebar into a slide-over drawer
  opened from a hamburger button. Wired in once via `apps/web/src/app/(app)/layout.tsx` (a
  Next.js route group — adds no URL segment), so every authenticated route shares one
  layout instance instead of duplicating navigation per route.
- **`/workspace` — the new permanent landing page after login**
  (`apps/web/src/app/(app)/workspace/page.tsx`): a welcome header (organisation logo/name +
  workspace theme), a Quick Actions grid (Manage Organisation, Manage Users, Product
  Catalogue, View Profile), a Platform Modules grid covering every domain from
  `docs/roadmap.md` Phase 2/3 (active modules link out, unbuilt ones render disabled with a
  "Coming Soon" badge), and two static placeholder cards (Recent Activity, Platform
  Status) — deliberately not metric-heavy or backed by any new API, per the brief's
  explicit "Out of Scope: analytics, charts, KPIs, notifications, activity feeds."
- `apps/web/src/components/workspace/navigation-config.ts` — single source of truth for
  the sidebar's three sections (Workspace/Administration/Support) and the sidebar/Platform
  Modules grid it drives. Adding a future module means adding one entry here.
- `apps/web/src/components/workspace/icons.tsx` — a small hand-rolled stroke-icon set (no
  icon-library dependency added), same rationale as the existing hand-rolled `Dialog`/
  `DropdownMenu`/marketing `Logo`.
- **Orange and teal brand tokens** (`--brand-orange`, `--brand-teal` in
  `packages/ui/src/styles.css`, `brandOrange`/`brandTeal` in
  `packages/config/tailwind/preset.js`) — decorative accents (not tenant-customisable like
  `--primary`/`--accent-pink`, not the platform identity mark like `--brand-purple`) used
  to rotate purple/pink/orange/teal across the Platform Modules grid, per the brief's
  "navigation should reflect these brand colours, not just purple."

### Changed

- **Login now redirects to `/workspace`** instead of `/settings/organisation`
  (`apps/web/src/app/login/page.tsx`); the forced first-login `mustChangePassword` →
  `/change-password` branch is unchanged, and `/change-password`'s own post-success
  redirect now also lands on `/workspace` (`apps/web/src/app/change-password/page.tsx`).
- **Route restructuring, no URL changes**: `settings/organisation`, `settings/users`,
  `account/profile`, `account/security`, `account/sessions` moved under a new
  `app/(app)/` route group so they share `WorkspaceLayout`. Because route groups add no
  URL segment, every existing link/bookmark to these pages keeps working unchanged —
  confirmed in the production build's route table and via live browser navigation.
  `apps/web/src/app/settings/layout.tsx` and `apps/web/src/app/account/layout.tsx` (each
  independently rendering `AuthenticatedNav`) are deleted, replaced by the one
  `app/(app)/layout.tsx`.
- `AuthenticatedNav` is retired; its logic (account/workspace queries, branding
  application, `mustChangePassword` guard, account dropdown) moved into `Topbar`, which
  also gained a mobile hamburger button and now shows the user's uploaded profile photo in
  the account-menu trigger when one exists (falls back to initials otherwise).

### Fixed

- **`/account/profile`'s "Profile Photo" card is a real upload**, not the Sprint 3.3
  disabled placeholder. Built the same way as Sprint 3.4's organisation logo upload:
  `POST`/`DELETE /api/account/avatar` (`apps/api/src/identity/account/account.controller.ts`)
  reuse the same `FileStorage` port and a new shared `assertValidImageFile` validator
  (`apps/api/src/identity/common/image-upload-validation.ts`, extracted from the
  logo-upload validation `SettingsController` already had). `User.avatarUrl`/`avatarKey`
  are new plain nullable columns (migration `20260801010000_add_user_avatar_fields`) —
  `avatarKey` is its own column rather than stashed in a JSON `settings` blob the way
  Organisation does it, since `User` has no such bucket. Frontend: a new shared
  `ImageUploadCard` component (`apps/web/src/components/app/image-upload-card.tsx`)
  replaces what would otherwise be two near-identical upload/preview/replace/remove
  implementations — the Branding tab's logo cards were refactored to use it too, so both
  features share one implementation instead of two.

### Known limitations

- Platform Modules grid descriptions and the module list itself are static copy — nothing
  reads from `docs/backlog.md`'s Epics programmatically.
- No `defaultLandingPage` preference is consumed anywhere yet (Sprint 3.4 added the
  Preferences toggle; login always redirects to a fixed destination regardless of its
  value) — unchanged by this sprint.
- "Workspace Settings" (Administration section) and every module below Dashboard render
  as "Coming Soon" per the brief — no route exists for them yet.

## [Sprint 3.4 Workspace Configuration & Organisation Branding] - 2026-08-01

### Added

- `apps/web/src/app/settings/organisation/page.tsx` — replaces the single-page
  Organisation Settings (Sprint 2.1) with a multi-tab Workspace Configuration Center:
  General, Branding, Regional, Business, Preferences, and a Security placeholder. A
  sidebar on desktop collapses to a horizontal scrollable tab bar on mobile/tablet. Every
  tab shares one `GET /api/settings/workspace` query and saves independently via its own
  `PATCH`.
- `apps/api/src/identity/settings/` — a new `SettingsController`/`SettingsModule` at
  `/api/settings/*`, built entirely on the existing `OrganisationService`/`AuditService`
  (no new repository):
  - `GET`/`PATCH /api/settings/workspace` — the full workspace profile (General +
    Branding + Regional + Business + Preferences fields) as one partial-update surface,
    same pattern as `PATCH /api/organisation/me` (Sprint 2.1).
  - `POST`/`DELETE /api/settings/logo?variant=light|dark` — multipart logo upload/removal,
    type/size validated server-side, with old files cleaned up on replace.
  - Every write requires Owner or Administrator (`RolesGuard`, reused from Sprint 2.1);
    `GET` is open to any authenticated user.
- **File storage abstraction** — `FileStorage` port
  (`apps/api/src/identity/organisation/ports/file-storage.port.ts`) plus a
  `LocalFileStorage` adapter that writes to local disk and serves files via
  `/api/uploads/*` (mounted in `main.ts`). Mirrors the `PasswordHasher`/`TokenService`/
  `SessionStore` port pattern from Sprint 1B.2 — a future S3-backed adapter implements the
  same interface with no change to `OrganisationService`/`SettingsController`.
- **Nine new `Organisation` columns** (migration
  `20260801000000_add_workspace_branding_fields`): `darkLogoUrl`, `primaryColor`,
  `accentColor`, `timeFormat`, `numberFormat`, `registrationNumber`, `taxId`,
  `employeeCount` — plain typed columns, same convention as the Sprint 1B.1/2.1 profile
  fields. `businessType` (existing, previously unused) is now used for "Manufacturing
  Sector". Workspace theme and every Preferences toggle live inside the existing
  `settings` Json column instead of new columns — see
  `apps/api/src/identity/organisation/workspace-settings.ts`
  (`DEFAULT_WORKSPACE_SETTINGS`, deep-merged with stored settings on every read).
- **Live tenant branding** — `apps/web/src/lib/branding.ts` converts a tenant's chosen
  hex primary/accent colours to the app's existing HSL CSS custom properties
  (`--primary`/`--ring`/`--accent-pink`) and applies them via `useApplyBranding`, called
  from `AuthenticatedNav` (rendered on every authenticated page) alongside the
  light/dark/system theme class toggle. No component was changed to consume tenant
  colours — everything already read `hsl(var(--primary))` via the existing Tailwind
  tokens. Zentuva's own `--brand-purple` is deliberately never overridden — it stays the
  platform's own identity colour across every tenant.
- `AuthenticatedNav` now also renders the organisation's own logo (or a colour-matched
  initials avatar when none is uploaded, `apps/web/src/lib/org-initials.ts`) next to the
  organisation name — alongside, not replacing, the Zentuva product mark.
- Client-side logo validation (`apps/web/src/lib/logo-validation.ts`): type, size (2 MB),
  and — for raster images — pixel dimensions, checked before the upload request for fast
  feedback; type and size are re-validated server-side as the authority.
- Every workspace write is audited: `workspace.settings.updated`,
  `workspace.logo.uploaded`, `workspace.logo.removed`
  (`apps/api/src/identity/organisation/workspace-audit-actions.ts`).
- 17 new backend unit tests (workspace settings merge, logo upload/replace/remove
  key-tracking, `SettingsController` mapping/validation/authorization) — 106/106 total.

### Known limitations

- **"Reset to Zentuva default" isn't a real "unset."** The colour pickers default to
  Zentuva's own pink shades when no override is stored, but saving always writes a
  concrete hex value — there's no way to explicitly clear back to "inherit the platform
  default" once a colour has been customised (a cosmetic gap, not a data-integrity one).
- **Favicon and Email Header Logo are placeholders only**, per the brief — disabled
  upload buttons, no backend support.
- **Security tab is a placeholder only**, per the brief — five "Coming Soon" cards
  (Password Policy, Sessions, MFA, SSO, API Keys). This is workspace-wide security
  _policy_, distinct from the per-user `/account/security` page Sprint 3.3 already
  shipped (linked from this tab, not duplicated).
- **Server-side image-dimension validation doesn't exist** — only client-side (no
  image-parsing dependency was added this sprint). Type and size are validated on both
  sides.
- **"Business Description" isn't a separate field from General's "Description".** The
  brief listed both, but they're the same underlying `Organisation.description` column —
  duplicating an editable field across two tabs risked two conflicting unsaved drafts of
  the same value, so it's rendered in General only.

## [Sprint 3.3 Account Management & Authentication Experience] - 2026-07-31

### Added

- `apps/api/src/identity/account/` — a new `AccountController`/`AccountModule` at
  `/api/account/*`, entirely reusing existing services (`UserService`,
  `OrganisationService`, `AuthService`, `AuditService`) rather than new repositories:
  - `GET /account/profile` / `PATCH /account/profile` — the caller's own name, phone
    number, and (read-only) employee code, email, role, organisation, joined date, plus
    the security fields (`lastLoginAt`, `failedLoginAttempts`, `passwordChangedAt`,
    `mustChangePassword`) reused by the Security page.
  - `POST /account/change-password` — verifies the current password, hashes and stores
    the new one, and revokes every _other_ active session while keeping the calling
    session signed in (`AuthService.changePassword` + a new
    `SessionRepository.revokeAllForUserExcept`).
  - `GET /account/sessions` / `DELETE /account/sessions/:id` — lists the caller's active
    sessions and revokes one by id, with an ownership check
    (`AuthService.revokeSession`) so a session can only be revoked by the user who owns
    it.
- `User.phoneNumber`, `User.mustChangePassword`, `User.passwordChangedAt` — three new
  columns (migration `20260731000000_add_user_account_management_fields`).
  `mustChangePassword` defaults `true` only for accounts created with an admin-chosen
  temporary password (`UserService.createUser`, Sprint 2.2); self-registered Owners and
  invitation-acceptance users default `false`, since both already chose their own
  password. `passwordChangedAt` is stamped by `UserRepository.updatePasswordHash`
  (shared by change-password and reset-password) and starts `null` ("Never changed").
- `strongPasswordSchema` in `@zentuva/validation` (min length + upper/lower/number/
  special character), applied to both the new `changePasswordSchema` and — as a
  consistency fix — the existing `resetPasswordSchema` (Sprint 1B.2), so every "set a new
  password" path enforces the same policy.
- Frontend: `/change-password` (shared by voluntary changes and the forced first-login
  redirect), `/reset-password/[token]` (completes the Sprint 3.2 forgot-password flow —
  `POST /auth/password/reset` existed since Sprint 1B.2 but had no frontend page until
  now), and `/account/profile`, `/account/security`, `/account/sessions` (wrapped in a
  shared `AccountTabs` sub-nav).
- `PasswordStrength` and `PasswordInput` components
  (`apps/web/src/components/auth/`) — a live strength checklist and a show/hide-password
  toggle, shared across `/login`, `/change-password`, and `/reset-password/[token]`.
- `packages/ui/src/components/dropdown-menu.tsx` — hand-rolled (no Radix, same rationale
  as `Dialog` in Sprint 2.2), used by `AuthenticatedNav`'s new user menu (My Profile /
  Security / Active Sessions / Logout), replacing the bare Logout button from Sprint 3.2.
- `AuthenticatedNav` now calls the new `GET /api/account/profile` instead of Sprint 3.2's
  `GET /api/users/:id` + client-side JWT decode — one request now covers the avatar's
  display data _and_ the `mustChangePassword` flag, which the component uses to redirect
  to `/change-password` before rendering anything else on any `/settings/*`/`/account/*`
  page. `UserController`'s `getUser`-for-self hack and `api-client.ts`'s
  `getCurrentUserId` are removed as a result — both are now genuinely dead code.
- Login page improvements: Remember Me checkbox (backed by a new `remember` parameter on
  `setTokens` — `true` uses `localStorage`, `false` uses `sessionStorage`), show/hide
  password, autofocus on the email field, and a "password updated" banner after a
  successful reset (`/login?passwordReset=1`).
- `POST /auth/password/request-reset`'s dev-mode `resetToken` is now surfaced on
  `/login/forgot-password` as a clickable dev-only link — there's still no real email
  service ("mock for now" per the brief), so this is how the reset flow is testable at
  all without one.
- Every new mutation is audited: `account.profile.updated`, `account.password.changed`
  (new — `apps/api/src/identity/account/account-audit-actions.ts`), plus session
  revocation and password-reset events reusing the existing `auth.session.revoked`/
  `auth.password.reset_requested`/`auth.password.reset` actions from Sprint 1B.2.
- 12 new backend unit tests (`account.controller.spec.ts`, plus `changePassword`/
  `revokeSession` cases added to `auth.service.spec.ts`) — 89/89 total.

### Known limitations

- Discovered (not introduced) during this sprint's manual verification: rapidly calling
  `POST /auth/refresh` within the same wall-clock second as the token it's rotating was
  issued can throw a 500 (Prisma unique-constraint collision on `tokenHash`), because
  refresh JWTs are signed deterministically and `iat` only has second granularity. Only
  reachable via back-to-back scripted requests, not normal browser use. Flagged as a
  follow-up task rather than fixed here, per this sprint's "do not redesign already
  implemented authentication" constraint.
- "Profile Photo" is a placeholder only, per the brief — no upload endpoint exists.

## [Sprint 3.2 Tenant Registration & Organisation Onboarding] - 2026-07-31

### Added

- `POST /api/auth/register` (`apps/api/src/identity/auth/auth.controller.ts`) — the first
  self-service entry point into Zentuva. Accepts organisation details plus an Owner
  account and atomically provisions a new tenant: organisation, its default system roles,
  the Owner user, and an audit entry, all inside one Prisma interactive transaction
  (`OrganisationRepository.registerTenant`) so any failure rolls back every write. Rejects
  duplicate organisation names and duplicate emails with `409 Conflict`
  (`OrganisationService.register`).
- `registerOrganisationSchema` (`packages/validation/src/identity.ts`) — full rewrite of
  the unused Sprint 1B.1 draft to match the real wire contract (`organisationName`,
  `country`, owner `firstName`/`lastName`/`email`/`password`/`confirmPassword`,
  `acceptTerms`, plus optional display name, industry, address fields, phone, business
  email, and website).
- Slug and organisation-code generation: slug = kebab-case of the organisation name with a
  numeric collision suffix (`-2`, `-3`, ...); organisation code = first 3 uppercase letters
  of the name (fallback `ZEN`) + zero-padded 4-digit sequence, incrementing on collision
  (e.g. `SAH-0001`).
- `apps/web/src/app/register/` — the two-section registration form (Organisation
  Information, Owner Account) and `/register/success` confirmation page showing the new
  organisation's name, code, and owner email (passed via URL query params from the
  registration response, not client state, so it survives the full-page navigation).
- `apps/web/src/app/login/` and `apps/web/src/app/login/forgot-password/` — sign-in page
  (stores tokens, redirects to `/settings/organisation`) and a password-reset request page
  that reuses the Sprint 1B.2 `POST /auth/password/request-reset` endpoint, previously
  built but never wired to any frontend.
- `apps/web/src/components/app/authenticated-nav.tsx` + `apps/web/src/app/settings/layout.tsx`
  — a top nav (Logo, organisation name, user avatar with initials, Logout) wrapping all
  `/settings/*` pages. The current user's id comes from decoding the access token's `sub`
  claim client-side (`getCurrentUserId`, display-only, never an authorization decision);
  the name/initials come from the existing `GET /api/users/:id` endpoint — no new backend
  surface was added for this.
- `apps/web/src/lib/auth.ts` (`registerOrganisation`, `login`, `logout`,
  `requestPasswordReset`) and `api-client.ts` additions (`setTokens`, `clearTokens`,
  `getCurrentUserId`).
- **Brand rebalance**: `packages/ui/src/styles.css`'s `--primary` now means pink (was
  purple in Sprint 3.1), so every interactive element that reads `primary` — the default
  `Button` variant, focus rings, links — becomes pink automatically. A new `--brand-purple`
  token was introduced for non-interactive brand elements (headings, icons, illustrations,
  section titles) and applied across the Sprint 3.1 marketing components. This corrects
  Sprint 3.1's purple-heavy balance per this sprint's explicit brief.
- `packages/ui/src/components/checkbox.tsx` — native checkbox styled with
  `accent-primary`, used for the registration form's Terms of Service acceptance.
- `apps/api/src/identity/organisation/organisation.service.spec.ts` — 8 tests covering
  `register()`: success, duplicate name, duplicate email, slug/code collision handling.

### Known limitations

- `OrganisationRepository.registerTenant` writes directly against the Prisma transaction
  client rather than through `UserRepository`/`RoleRepository`/`AuditRepository`, because
  none of those repositories currently accept an external `tx` client. This is a deliberate,
  documented exception to "reuse existing repositories" — the alternative (adding `tx`
  parameters to every repository method) was judged out of scope for this sprint. See
  `docs/sprint-3.2-completion-report.md` for the full rationale.
- No dedicated "current user" endpoint exists yet; the authenticated nav's user info comes
  from decoding the JWT for the id and re-fetching via `GET /api/users/:id`. Fine for
  display, but a future sprint should consider a proper `/auth/me` endpoint if more
  session-derived data is needed.
- "Book a Demo" on the landing page remains a static anchor link — no demo-booking flow
  exists, unchanged from Sprint 3.1.

## [Sprint 3.1 Public Marketing Website — Landing Page] - 2026-07-31

### Added

- Public landing page at `/` (`apps/web/src/app/page.tsx`): Navbar, Hero, Trusted By,
  Problem, What is Zentuva, Platform Modules, Why Zentuva, Retail Intelligence, AI,
  Platform Vision Timeline, CTA, and Footer sections — replaces the Sprint 0 placeholder
  page. No authentication, no backend integration, per the brief.
- `apps/web/src/components/marketing/`: 13 new components (`navbar`, `hero`,
  `trusted-by`, `problem-section`, `what-is-zentuva`, `platform-modules`, `why-zentuva`,
  `retail-intelligence`, `ai-section`, `vision-timeline`, `cta-section`, `footer`,
  `logo`, `container`, `icons`) — all reusable, no lorem ipsum, all copy original.
- Repositioned the product: "The Operating System for African Manufacturing," not an ERP
  or SaaS product — reflected in `layout.tsx` metadata and throughout the page copy.
- **Rebrand**: `packages/ui/src/styles.css`'s `--primary` changed from green to a deep
  purple, plus two new brand tokens (`--lavender`, `--accent-pink`) registered in
  `packages/config/tailwind/preset.js`. This is a shared design-system change — it also
  restyles the existing `/settings/organisation` and `/settings/users` pages, which is
  intentional (one consistent brand, not a marketing-only skin).
- `buttonVariants` now exported from `packages/ui` (was previously internal to
  `Button`) — needed to style `<a>` elements as buttons (nav links, CTAs) without adding
  a Radix `Slot`/`asChild` dependency.

### Known limitations

- **No real logo file.** The brief said to use an attached logo; no image file was ever
  placed in the repo (only shared as an inline chat image mid-session). `ZentuvaMark`
  (`apps/web/src/components/marketing/logo.tsx`) is a best-effort geometric recreation of
  the "Z" mark in the same colors, not the literal source asset. See
  `docs/sprint-3.1-completion-report.md` "Known limitations."
- "Get Started," "Book a Demo," "Request Demo," "Join Early Access," and "Sign In" are all
  static links with no form or backend behind them yet — explicitly out of scope (Sprint
  3.2 covers authentication UI).

## [Sprint 2.2 Organisation Management — User Management] - 2026-07-31

### Added

- `apps/api/src/identity/user/user.controller.ts` + `user.module.ts` — the User
  Management HTTP surface: `GET /api/users` (list), `GET /api/users/:id` (view), both any
  authenticated user; `POST /api/users` (create) and `PATCH /api/users/:id` (combined
  profile/role/status update), both Owner/Administrator only via the same `RolesGuard`
  introduced in Sprint 2.1.
- `UserRepository.findManyWithRolesByOrganisation` / `findByIdWithRoles` /
  `createWithRole`, and `RoleRepository.replaceUserRole` — a user's role assignment is
  treated as "exactly one" for this sprint's MVP model (even though `UserRole` technically
  permits many), resolved by system role _name_ rather than `roleId` (no role-listing
  endpoint exists yet).
- `createUserSchema` / `updateUserSchema` / `userManagementStatusSchema` /
  `systemRoleNameSchema` (`packages/validation/src/identity.ts`) — the wire contract for
  this sprint's endpoints, including the 3-value `ACTIVE`/`INACTIVE`/`LOCKED` status view
  mapped onto the DB's 5-value `UserStatus` enum (`INACTIVE` → `SUSPENDED`).
- `user.activated` / `user.deactivated` audit actions (`user-audit-actions.ts`), alongside
  the existing `user.created`/`user.updated`, recorded on every `POST`/`PATCH` via the
  existing `AuditService`.
- `packages/ui`: `Dialog`/`DialogHeader`/`DialogTitle`/`DialogFooter` (hand-rolled, no new
  dependency), `Select`, `Badge`.
- `apps/web/src/app/settings/users/` — the Users settings page: a table (Name, Email,
  Employee Code, Role, Status), a Create User dialog, an Edit User dialog, and one-click
  Activate/Deactivate per row. No pagination/search/filter/sort, per the brief.
- Seed script (`apps/api/prisma/seed.ts`) now seeds Administrator and Member development
  accounts alongside the existing Owner, via a new `seedUser` helper — same
  "no hardcoded credentials, required env vars" pattern. `apps/api/.env.example`'s
  `SEED_ADMIN_*` placeholder values were also replaced with the actual predictable
  local-development credentials (previously only present in the untracked `.env`), plus
  new `SEED_ADMINISTRATOR_*`/`SEED_MEMBER_*` vars.

### Fixed

- Discovered (not introduced by this sprint) that this app has no global exception filter
  converting the shared `AppError` class into an HTTP response — a `@zentuva/utils`
  `AppError` thrown inside a request handler silently becomes a generic `500`, losing its
  intended status code. `UserService` uses NestJS's own `ConflictException`/
  `NotFoundException` instead (matching `AuthService`'s existing convention), and
  `updateUser` checks the target exists up front so it never reaches
  `UserRepository`'s `AppError`-throwing path. The underlying gap (no filter) is
  pre-existing and unchanged; flagged for a future sprint.

Documentation: `docs/domains/identity.md` reconciled with the shipped User Management API
(§10 Users table, §6 RolesGuard note, §8 audit events table), plus `docs/roadmap.md` and
`docs/database/README.md` swept for the same staleness — see
`docs/sprint-2.2-completion-report.md` §9 for the full list.

## [Sprint 2.1 Organisation Management — Organisation Profile] - 2026-07-30

### Added

- `apps/api/src/identity/organisation/organisation.controller.ts` + `organisation.module.ts`
  — the Organisation Management HTTP surface: `GET /api/organisation/me` (any authenticated
  member) and `PATCH /api/organisation/me` (Owner/Administrator only), backed by the
  `OrganisationService`/`OrganisationRepository` built in Sprint 1B.1.
- `RolesGuard` + `@Roles(...)` decorator (`apps/api/src/identity/auth/guards/roles.guard.ts`,
  `.../decorators/roles.decorator.ts`) — a minimal role-name authorization check (Owner or
  Administrator may update; Member is read-only), per this sprint's explicit "a simple
  role-name check is sufficient... do not build a permission engine" scope. Not the
  generalized permission-key evaluation system identity.md §6 describes long-term — that
  remains future work.
- `RoleRepository.findRoleNamesForUser` / `RoleService.getRoleNamesForUser` — needed by
  `RolesGuard`; didn't exist after Sprint 1B.1/1B.2.
- `Organisation.displayName` column (migration
  `20260730180000_add_organisation_display_name`) — a new MVP field this sprint's field
  list introduced that wasn't in the original identity.md design.
- `updateOrganisationProfileSchema` (`packages/validation/src/identity.ts`) rewritten to
  match this sprint's exact wire contract (`organisationName`, `displayName`, `description`,
  `email`, `phoneNumber`, `website`, `country`, `state`, `city`, `addressLine`, `industry`,
  `currency`, `timezone`) — supersedes the unused Sprint 1B.1 draft, which had no controller
  consumer yet. The controller maps these wire names to their Prisma column names
  (`name`, `phone`, `addressLine1`, `timeZone`).
- `organisation.updated` audit action (`organisation-audit-actions.ts`), recorded on every
  successful profile update via the existing `AuditService`.
- `packages/ui`: `Input`, `Label`, `Textarea`, `Card`/`CardHeader`/`CardTitle`/
  `CardDescription`/`CardContent` — shadcn/ui-style primitives, following the existing
  `Button` component's pattern.
- `apps/web/src/lib/api-client.ts` — a minimal token-aware `fetch` wrapper (reads a bearer
  token from `localStorage`; no login page exists yet, see the completion report's "Known
  limitations").
- `apps/web/src/app/settings/organisation/` — the Organisation Settings page
  (`GET`/`PATCH` via TanStack Query, React Hook Form + Zod validation, four sections:
  General Information, Contact Information, Address, Business Settings), plus Save
  Changes/Cancel.
- `react-hook-form`, `@hookform/resolvers` added to `apps/web`.

### Fixed

- NestJS applies method-level `@UsePipes()` to every parameter, including custom
  decorators like `@CurrentUser()` — not just `@Body()`. Combined with a Zod schema, this
  silently stripped the `@CurrentUser()` payload down to `{}` (Zod's default "strip unknown
  keys" behaviour), which surfaced as a Prisma error on `PATCH /api/organisation/me`. Fixed
  by scoping the pipe to `@Body(new ZodValidationPipe(schema))` instead of the method-level
  `@UsePipes()`, which no other existing endpoint had triggered (none previously combined a
  body-validated `@UsePipes()` with `@CurrentUser()` on the same handler).

Known limitations and deferred work are documented in
`docs/sprint-2.1-completion-report.md`.

## [Sprint 1B.3 Product Backlog] - 2026-07-30

### Added

- `docs/backlog.md` — the single source of truth for Zentuva's long-term product roadmap:
  purpose, product vision, guiding principles, a 13-Epic roadmap (Epic 0 Engineering
  Foundation through Epic 12 AI Platform), current sprint status, a "Future Ideas (Not
  Prioritised Yet)" list, and backlog-maintenance guidance.

Documentation only — no application code, schema, packages, APIs, UI, tests, migrations,
or configuration were touched, per the Sprint 1B.3 brief.

## [Sprint 1B.2 Identity Domain Implementation — Authentication Layer] - 2026-07-30

### Added

- `apps/api/src/identity/auth/` — the Authentication Layer: `AuthService` (login, refresh
  token rotation with reuse detection, logout/logout-all, password reset, invitation
  acceptance, account locking), `AuthController` exposing the 8 `/auth/*` endpoints,
  `JwtAuthGuard` + `@CurrentUser()` (pure authentication, no RBAC), `ZodValidationPipe`, and
  the three brief-required ports behind interfaces: `PasswordHasher` (bcrypt),
  `TokenService` (JWT via `@nestjs/jwt`), `SessionStore` (database-backed, wraps
  `SessionRepository`).
- `apps/api/src/identity/crypto/` — `CryptoModule` providing `PASSWORD_HASHER`, split out
  from `AuthModule`/`IdentityModule` to avoid a circular dependency (`UserService` needs it
  too).
- `apps/api/src/identity/password-reset/` — `PasswordResetRepository` + `PasswordResetService`
  (not built in Sprint 1B.1 since nothing called them yet).
- `User.failedLoginAttempts` column (migration
  `20260730173455_add_user_failed_login_attempts`) — the mechanism `UserStatus.LOCKED`
  (added 1A.1) deliberately left as "a Sprint 1B implementation detail."
- `RoleRepository.assignToUser` / `RoleService.assignRoleToUser` — invitation acceptance
  needs to create a `UserRole` row; this capability didn't exist after Sprint 1B.1.
- New environment variables: `BCRYPT_SALT_ROUNDS`, `JWT_ACCESS_SECRET`,
  `JWT_REFRESH_SECRET`, `JWT_ACCESS_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN`,
  `MAX_LOGIN_ATTEMPTS` — validated at boot (non-empty, ≥32 chars for JWT secrets, access ≠
  refresh secret).
- `packages/validation/src/identity.ts`: `acceptInvitationWithTokenSchema`, extending the
  existing `acceptInvitationSchema` with `token`/`firstName`/`lastName`.
- 47 unit tests across 4 new spec files, covering every test target the brief lists
  (password hashing, JWT generation, login, refresh, logout, password reset, invitation
  acceptance, account locking, session management, token rotation).
- `docs/sprint-1B.2-completion-report.md`.

### Changed

- `apps/api/prisma/seed.ts` — switched from `argon2` to `bcrypt` for the seeded admin
  user's password, matching the Authentication Layer's chosen hasher (the `argon2` choice
  in Sprint 1B.1 predated this sprint settling the question; without this change the
  seeded user could never log in). The `argon2` dependency was removed.
- `docs/domains/identity.md` — updated where implementation revealed genuine discrepancies:
  password hashing is bcrypt (not the earlier unconfirmed argon2id assumption); the refresh
  token is a JWT with its own secret (per this sprint's brief) while remaining hashed,
  rotated, and reuse-detected exactly as originally designed; invitation acceptance now
  collects `firstName`/`lastName` (not carried by the `Invitation` entity); `User.status
LOCKED`'s triggering mechanism is now specified; four audit action strings were added to
  §8's event table (`auth.logout_all`, `auth.password.reset_requested`,
  `auth.session.revoked`, `user.locked`). See the completion report's "Deviations" for full
  reasoning on each.

No RBAC evaluation, permission guards, role/organisation/user-management APIs, email
delivery, MFA, OAuth, or SSO were implemented — per the Sprint 1B.2 brief, this was the
Authentication Layer only.

## [Sprint 1B.1 Identity Domain Implementation] - 2026-07-29

### Added

- `apps/api/prisma/schema.prisma` — implemented the full Identity Domain schema (11 models, 3
  enums) exactly per `docs/domains/identity.md` §9. Removed the Sprint 0 placeholder `HealthCheck`
  model.
- Migration `20260729182400_init_identity_domain` — drops `_health_check`, creates all 11 Identity
  tables. Applied and verified against a live Postgres database.
- `apps/api/prisma/seed.ts` — seeds the "Boby Bites" organisation, system roles (Owner,
  Administrator, Member), the full permission catalog, and the first admin user. Admin
  email/password come from required environment variables — no hardcoded credentials.
- `apps/api/src/identity/` — six repositories (Organisation, User, Role, Invitation, Session,
  Audit) with real, tenant-scoped Prisma access, and six matching domain services wired into a new
  `IdentityModule` (imported into `AppModule`, no controllers yet). Verified the full provider
  graph resolves via NestJS dependency injection at runtime.
- `packages/validation/src/identity.ts` — Zod schemas for every documented Identity API contract
  (registration, login, profile updates, invitations, roles, etc.), not yet wired into any
  controller.
- `argon2` added as an `apps/api` dependency, used only to hash the seeded admin user's password.
- `docs/sprint-1B.1-completion-report.md`.

### Changed

- `docs/domains/identity.md` — renamed the system role "Admin" to "Administrator" throughout
  (prose, tables, sequence diagrams), matching the Sprint 1B.1 brief and resolving an existing
  inconsistency with the doc's own "Administrator Name"/"Administrator Email" registration fields.
  Label rename only — no schema or behavioural change.
- `docs/database/README.md` — documented the real Identity Domain models, migrations, and seed
  data (previously a stub).

No authentication, JWT, login, controllers, guards, Swagger, or frontend work was done — per the
Sprint 1B.1 brief, this was Database & Domain Layer only.

## [Sprint 1A.1 Identity Design Refinements] - 2026-07-29

### Changed

- `docs/domains/identity.md` — post-review MVP refinements to the Identity Domain design
  (documentation only, no code/schema/migrations touched): added immutable
  `Organisation.organisationCode`, added optional `User.employeeCode`, expanded `UserStatus` with
  a `LOCKED` state, and added two intentionally-deferred items (Organisation Type, Feature
  flags/module enablement) to the Risks & Future Expansion table.
- `docs/sprint-1A-identity-design-report.md` — added a "Post-Review Refinements" section
  summarising what changed, why, what was deferred, and re-confirming Sprint 1B approval.

The Prisma schema changes were re-validated with `prisma validate`/`prisma format` against a
scratch file, same as the original Sprint 1A schema — still not written into
`apps/api/prisma/schema.prisma`.

## [Sprint 1A Identity Design] - 2026-07-29

### Added

- `docs/domains/identity.md` — complete Identity Domain design: business rules, Organisation
  Registration/Profile split, entity design for all ten entities (Organisation, User, Role,
  Permission, UserRole, RolePermission, Invitation, Session, RefreshToken, PasswordResetToken,
  AuditLog), authentication and authorisation design, tenant isolation strategy, audit strategy,
  a Prisma schema (validated via `prisma validate`/`format` against a scratch file, not yet
  implemented in `apps/api/prisma/schema.prisma`), an API contract sketch, six Mermaid sequence
  diagrams, and a risks/future-expansion table.
- `docs/sprint-1A-identity-design-report.md` — design decisions, assumptions, open questions, and
  recommendations before Sprint 1B implementation.
- `docs/domains/README.md` — added a domain status table.
- `docs/roadmap.md` — checked off Identity domain design under Phase 1.

No API, frontend, authentication logic, or real migrations were implemented — this sprint was
design-and-documentation only, per the Sprint 1A brief.

## [Sprint 0 Finalisation] - 2026-07-29

### Added

- Root convenience scripts for the entire daily dev loop: `infra:up`, `infra:down`,
  `infra:restart`, `infra:logs`, `infra:reset`, `db:generate`, `db:migrate`, `db:studio`,
  `db:seed`, `db:reset` — no developer needs to remember a raw `docker compose` or `prisma`
  command.
- `apps/api/prisma/seed.ts` — placeholder seed script wired up via `pnpm db:seed`, ready for
  domain modules to extend.
- `apps/api` `dev:debug` script (`nest start --watch --debug`) for VS Code debugging.
- `.vscode/launch.json` — shared debug configs for NestJS (attach) and Next.js (server-side +
  client-side), plus a combined compound; `.vscode/extensions.json` and `.vscode/settings.json`
  for a consistent editor setup. (`.gitignore` updated — it previously excluded all of `.vscode/`
  except `extensions.json`, which would have silently dropped `launch.json`.)
- `docs/development/local-development.md` — the complete local development guide (first-time
  setup, command reference, migrations, Prisma Studio, debugging, environment file breakdown,
  port-conflict and Docker troubleshooting).
- Handbook Principle 10 — **Developer Experience Is a Feature** — added to
  [engineering-handbook.md](handbook/engineering-handbook.md) (version bumped to 0.2).

### Changed

- `docker-compose.yml` renamed to `docker-compose.production.yml` and documented as the
  full-stack/production-verification path, **not** the daily development workflow.
  `docker-compose.dev.yml` (Postgres + Redis only) is now the canonical dev-infra file, wrapped by
  the `infra:*` scripts above.
- Simplified the environment file story: local development now needs exactly two files
  (`apps/api/.env`, `apps/web/.env.local`) instead of copying `.env.example` into three or more
  locations. Root `.env` and the non-`.local` app `.env` files are now clearly documented as
  optional/production-compose-only.
- `docs/handbook/getting-started.md` trimmed to a quick-start that links to the full
  [Local Development Guide](development/local-development.md), removing duplicated detail between
  the two documents.
- `docs/handbook/development-workflow.md` and `docs/handbook/architecture-overview.md` updated to
  reflect the `infra:up` / `dev` / `infra:down` workflow and the dev/production compose split.

No business functionality was touched — this sprint was scoped entirely to developer experience
and local development tooling, per the Sprint 0 finalisation brief.

## [Sprint 0 Foundation]

### Added

- Initial engineering foundation: Turborepo monorepo (`apps/web`, `apps/api`, `packages/ui`,
  `packages/types`, `packages/config`, `packages/utils`, `packages/validation`).
- NestJS backend skeleton with global config module, Prisma integration, and a `/api/health`
  endpoint (`@nestjs/terminus`, checks database + heap).
- Next.js frontend skeleton (App Router) with Tailwind CSS, shadcn/ui (`packages/ui`), and
  TanStack Query provider.
- Shared tooling: ESLint, Prettier, Husky + lint-staged, EditorConfig, path aliases, shared
  TypeScript configs.
- Docker Compose for full-stack (`docker-compose.yml`, later renamed to
  `docker-compose.production.yml`) and infra-only local dev (`docker-compose.dev.yml`), plus
  per-app Dockerfiles.
- `docs/` structure: engineering handbook, coding standards, architecture overview, development
  workflow, getting started, ADRs (001–004), API/database/domain doc stubs, roadmap.

No business modules (authentication, users, product catalogue, or any domain module) were
implemented — this is foundation-only, per the task scope.
