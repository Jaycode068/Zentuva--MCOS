# Production Domain

- **Status:** Manufacturing foundation implemented — Sprint 4.6 ("Production Management &
  Bill of Materials Foundation").
- **Sprint:** 4.6
- **Depends on:** [Identity](identity.md) (tenant boundary, authentication, `RolesGuard`),
  [Product Catalogue](catalogue.md) (a Bill of Materials references a `FINISHED_PRODUCT`
  and consumes `RAW_MATERIAL`/`PACKAGING_MATERIAL`/`CONSUMABLE` products — no new product
  concept is introduced), [Inventory](inventory.md) (material issue consumes, and
  finished-goods receipt increases, `InventoryStock` via the same `InventoryTransaction`
  ledger Goods Receiving and Adjustments already write into), [ADR-002 — Modular
  Monolith](../adr/ADR-002-modular-monolith.md), [ADR-003 —
  Multi-Tenancy](../adr/ADR-003-multi-tenancy.md)
- **See also:** [Sprint 4.6 Completion Report](../sprint-4.6-completion-report.md) for
  what was implemented and why.

## 1. Business Purpose

Production answers **"How do we turn raw materials into finished goods, and what did
that actually consume and produce?"** Every prior domain (Product Catalogue, Procurement,
Inventory) answers "what do we sell" and "what do we have" — Production is the missing
middle: a **recipe** (Bill of Materials) that says how much of each input a finished
product needs, an **instruction to manufacture** (Production Order) with a
server-computed material requirement snapshotted at creation, a **record of what raw
material was actually taken** (Material Issue), a **record of what was actually produced**
(Production Run: planned/produced/rejected/accepted, kept as distinct figures for future
yield/waste/costing analysis), and the resulting **finished-goods receipt** back into
Inventory. This is deliberately an MVP foundation, not a full Manufacturing Resource
Planning (MRP) or Quality Management System — no scheduling, no multi-level/sub-assembly
BOMs, no labour/machine/overhead costing, no batch/lot or expiry tracking, no automatic
procurement from a shortfall. See "Known Limitations" for the complete list. This is the
fifth non-Identity business domain module, and the first to write into Inventory's own
`InventoryStock`/`InventoryTransaction` tables from outside Inventory's own controller —
see "Integration Points" below for the documented, narrow exception this required.

## 2. Key Concepts / Entities

### BillOfMaterial (BOM)

- **Responsibility:** the recipe — how much of each input a finished product needs to
  produce a given yield quantity.
- **Ownership:** owned by Production (`apps/api/src/production/`). References `Product`
  by id; never creates a Product.
- **Finished-product-only:** `productId` must reference a `FINISHED_PRODUCT` — enforced
  in `BillOfMaterialService`, the same "second line of defense behind the frontend's
  type-filtered picker" pattern `PurchaseOrderService` uses for purchasable product
  types.
- **Status/versioning:** `DRAFT` → `ACTIVE` → `INACTIVE`. Only one BOM may be `ACTIVE`
  per finished product at a time — activating one atomically deactivates any prior
  `ACTIVE` BOM for the same product, inside the same database transaction. A BOM is
  **editable only while `DRAFT`** — once it has ever been `ACTIVE`, it is never edited in
  place; a new version is created and activated instead, so historical Production Orders
  that pinned the old BOM's requirements are never retroactively rewritten.
- **Fields:** `bomNumber` (auto-generated `BOM-000001`, globally unique, immutable),
  `productId`, `name?` (a cosmetic version label, e.g. "Plantain Chips v1"), `status`,
  `yieldQuantity` (positive — "this recipe produces this many units of the finished
  product's own unit of measure"), `notes?`.

### BillOfMaterialItem

- **Responsibility:** one component line of a BOM.
- **Component-type restriction:** `componentProductId` must be `RAW_MATERIAL`,
  `PACKAGING_MATERIAL`, or `CONSUMABLE` — never another `FINISHED_PRODUCT`. A recipe
  consumes inputs, it never references another recipe (no multi-level/sub-assembly BOMs
  this sprint).
- **Fields:** `quantity` (positive, scoped to the BOM's own `yieldQuantity`),
  `unitOfMeasure` (free text, same convention as `Product.unit`), `notes?`.
- **No duplicate components:** `@@unique([billOfMaterialId, componentProductId])` at the
  schema level, plus a Zod `.refine()` rejecting duplicates in the request body —
  defense in depth, same two-layer pattern used throughout this codebase.

### ProductionOrder

- **Responsibility:** an instruction to manufacture a specific planned quantity of a
  finished product, against one pinned Bill of Materials, at one production location.
- **Status lifecycle:** `DRAFT → PLANNED → IN_PROGRESS → COMPLETED`, with `CANCELLED`
  reachable only from `DRAFT`/`PLANNED` — see "Status Lifecycle" below.
- **The BOM is pinned forever:** `billOfMaterialId` is set once at creation and never
  changes — even if that BOM is later edited (impossible once `ACTIVE`, per BOM
  versioning above), deactivated, or superseded by a new version, this order's own
  requirement snapshot (see `ProductionOrderItem` below) is unaffected.
- **`locationId`:** reuses `InventoryLocation` (Sprint 4.5) — no separate warehouse/floor
  concept for Production. Must be `ACTIVE`.
- **Fields:** `productionOrderNumber` (auto-generated `PROD-000001`, globally unique —
  `PO-` was already Procurement's `PurchaseOrder` prefix), `productId` (denormalised from
  the BOM), `plannedQuantity` (positive), `notes?`.

### ProductionOrderItem — the immutable requirement snapshot

- **Responsibility:** this is the mechanism that makes "later BOM edits never
  retroactively change an existing order's requirements" true. Computed exactly once, at
  order-creation time:

  ```
  requiredQuantity = bomItem.quantity × (plannedQuantity ÷ bom.yieldQuantity)
  ```

  Never recalculated afterward, even if `plannedQuantity` is later edited (only
  reachable while the order is still `DRAFT` — the snapshot is recomputed from the
  order's own pinned BOM in that case, never from whatever BOM happens to be `ACTIVE`
  at edit time).

- **Fields:** `componentProductId`, `requiredQuantity`, `unitOfMeasure` (copied from the
  BOM item at creation).

### Material Availability Check

`GET /:id/availability` returns, per required component: `requiredQuantity`,
`availableQuantity` (`quantityOnHand - quantityReserved` at the order's own location,
via Inventory's `InventoryStockRepository`), and `shortfall`
(`max(0, required - available)`). **Purely informational** — it is computed on every call
but never gates `plan()`, material issue, or completion. There is no stock-reservation
engine this sprint; this is a live snapshot, not a hold.

### ProductionMaterialIssue / ProductionMaterialIssueItem

- **Responsibility:** one immutable batch event recording what raw material was actually
  taken out of Inventory against a Production Order — a header (date, actor, notes) +
  item rows, exact structural mirror of `GoodsReceipt`/`GoodsReceiptItem`.
- **Multiplicity:** a Production Order may have many material issues over time (partial
  issues, e.g. issue what's available now, the remainder once more stock arrives).
- **Over-issue rejected:** the cumulative issued quantity for a component (across every
  issue ever recorded against the order) may never exceed that component's
  `requiredQuantity`. Checked both in `ProductionOrderService` (a fast, clear `400`
  before the atomic write even starts) and re-validated inside the write's own
  transaction (closing the race against a concurrent issue).
- **Atomicity:** issuing multiple components in one request either succeeds for all of
  them or none — if any single component is short on stock, the whole transaction
  rolls back (brief: "never partially issue materials").
- **Insufficient stock rejected:** a component's `quantityOnHand` at the order's location
  must cover the requested issue quantity, checked both as a pre-check (fast `400`) and
  authoritatively inside the write transaction.
- **Side effect — automatic `PLANNED → IN_PROGRESS`:** there is no separate manual
  "Start Production" endpoint. The _first successful_ material issue against an order is
  what transitions it from `PLANNED` to `IN_PROGRESS`, atomically, as part of the same
  conditional `updateMany` that re-validates eligibility. This is deliberate — see
  "Status Lifecycle" below for why it makes "no cancellation once material issued" a
  structural invariant rather than a separately-maintained check.
- **Writes the ledger, never `InventoryStock` directly:** each issued item decrements
  `InventoryStock.quantityOnHand` at the order's location and appends an
  `InventoryTransaction` `ISSUE` row (`referenceType: 'ProductionMaterialIssue'`) — both
  inside the same atomic transaction. Production never writes `InventoryStock` without a
  paired ledger row, same discipline every Inventory write path already follows.

### ProductionRun — Production Execution

- **Responsibility:** the single completion event for a Production Order — what was
  actually produced, rejected, and accepted. MVP-scoped to at most one run per order
  (`ProductionRun.productionOrderId` is `@@unique` at the schema level — see "Decisions"
  in the completion report for why, and how this would relax later if multi-run support
  is ever needed).
- **`acceptedQuantity` is always server-computed** (`producedQuantity - rejectedQuantity`)
  — there is no `acceptedQuantity` field anywhere in the request schema, so a client
  cannot even attempt to supply one. `rejectedQuantity` may never exceed
  `producedQuantity` (Zod `.refine()`).
- **Planned/Produced/Rejected/Accepted stay distinct figures**, never collapsed into one
  number — the brief's own instruction, preserving the data future yield/waste/costing
  analysis would need.
- **`ProductionRejectionReason`** — a small controlled enum (`BURNT`/`UNDERWEIGHT`/
  `PACKAGING_DEFECT`/`POOR_SEAL`/`OTHER`) + free-text `rejectionNotes`, only present when
  `rejectedQuantity > 0`. Deliberately not a full Quality Management System, same "small
  controlled enum, not a workflow engine" convention as Inventory's own
  `RejectionReason`.
- **Finished-goods receipt is conditional:** only when `acceptedQuantity > 0` does
  completion increase the finished product's `InventoryStock` and append an
  `InventoryTransaction` `RECEIPT` row (`referenceType: 'ProductionRun'`) — a fully
  rejected run (`acceptedQuantity === 0`) writes no stock/ledger row at all, exact mirror
  of a fully-rejected `GoodsReceiptItem`.
- **Only becomes `COMPLETED` through this path** — never a bare status-flip endpoint. A
  Production Order reaches `COMPLETED` only when a `ProductionRun` is actually recorded.

### Bill of Materials Number / Production Order Number

`BOM-000001`, `BOM-000002`, ... and `PROD-000001`, `PROD-000002`, ... — fixed prefix +
6-digit zero-padded sequence, globally unique, generated by each service's own private
number generator — the same collision-avoidance loop shape as every other auto-numbered
entity in this codebase (`PurchaseOrder`/`Supplier`/`Product`/`GoodsReceipt`).

## 3. Status Lifecycle

```
(create) → DRAFT → PLANNED → IN_PROGRESS → COMPLETED
              ↓        ↓
          CANCELLED  CANCELLED
```

- **`DRAFT → PLANNED`:** `POST /:id/plan`, an explicit action, Owner/Administrator only.
- **`PLANNED → IN_PROGRESS`:** automatic, as a side effect of the first successful
  material issue — see `ProductionMaterialIssue` above. There is no manual "Start"
  endpoint.
- **`IN_PROGRESS → COMPLETED`:** `POST /:id/complete`, only after a `ProductionRun` is
  actually recorded — never a bare status flip.
- **`CANCELLED`:** only reachable from `DRAFT` or `PLANNED`, via `POST /:id/cancel`. Once
  any material has been issued (i.e. once the order is `IN_PROGRESS`), cancellation is
  **structurally impossible** — not a separately-maintained business rule, but a direct
  consequence of `cancel()`'s own conditional `updateMany` only ever matching
  `[DRAFT, PLANNED]`. This is the documented, deliberate limitation the brief asks for:
  once material has moved, undoing it would require a real reversal workflow (a second
  `InventoryTransaction` putting the issued material back), which does not exist this
  sprint. Corrections, if ever needed, must happen through additional auditable
  transactions — never a silent inventory reversal.
- `COMPLETED` and `CANCELLED` are both terminal — no transition ever leaves either state.

Every transition is enforced via the same tenant-scoped conditional `updateMany` +
`count === 0` → specific `BadRequestException` pattern used throughout this codebase
(`PurchaseOrderService.cancel`, `GoodsReceiptRepository.receive`'s own eligibility guard).

## 4. Workflows

- **Create a Bill of Materials** — `POST /api/production/boms` (Owner/Administrator
  only). Select a Finished Product, a yield quantity, and one or more components (each a
  Raw Material/Packaging Material/Consumable product, quantity, and unit of measure).
  Always starts `DRAFT`.
- **Edit a Bill of Materials** — `PATCH /api/production/boms/:id` (Owner/Administrator
  only, `DRAFT` only). Replaces the full component list if `items` is supplied.
- **Activate / Deactivate a Bill of Materials** — `POST /:id/activate` /
  `POST /:id/deactivate` (Owner/Administrator only). Activating atomically deactivates
  any prior `ACTIVE` BOM for the same finished product.
- **Create a Production Order** — `POST /api/production/orders` (Owner/Administrator
  only). Select an `ACTIVE` Bill of Materials, a planned quantity, and an `ACTIVE`
  production location. The frontend's `ProductionOrderDialog` shows a live,
  client-computed Material Requirements preview as the planned quantity changes — purely
  a UX preview; the server always recomputes and pins the same calculation
  authoritatively at save time.
- **Check Material Availability** — `GET /:id/availability` (any authenticated user).
  Required/Available/Shortfall per component, informational only.
- **Plan a Production Order** — `POST /:id/plan` (Owner/Administrator only, `DRAFT`
  only).
- **Issue Material** — `POST /:id/material-issues` (Owner/Administrator only, `PLANNED`
  or `IN_PROGRESS` only). The frontend's `MaterialIssueDialog` shows, per outstanding
  component: Required/Already Issued/Remaining/Available, blocking submission
  client-side if the entered quantity would exceed Remaining or Available (a UX
  convenience — the server is the actual source of truth). On the first successful
  issue, the order becomes `IN_PROGRESS`.
- **Complete Production** — `POST /:id/complete` (Owner/Administrator only,
  `IN_PROGRESS` only). The frontend's `ProductionRunDialog` collects Produced
  Quantity/Rejected Quantity/Rejection Reason+Notes, showing a live-computed, read-only
  Accepted Quantity preview (`produced - rejected`) — never an input field. On success,
  the order becomes `COMPLETED` and, if `acceptedQuantity > 0`, the finished product's
  stock increases.
- **Cancel a Production Order** — `POST /:id/cancel` (Owner/Administrator only, `DRAFT`
  or `PLANNED` only).
- **Browse / view** — `GET /api/production/boms`, `GET /api/production/boms/:id`,
  `GET /api/production/orders`, `GET /api/production/orders/:id`,
  `GET /:id/material-issues`, `GET /:id/production-run` — all any authenticated user
  (Member included, read-only).

## 5. Authorization

Reuses `RolesGuard` exactly as every other domain does (identity.md §6):

| Role          | Access                                                                                                  |
| ------------- | ------------------------------------------------------------------------------------------------------- |
| Owner         | Full access (create/edit/activate BOMs; create/plan/cancel orders; issue material; complete production) |
| Administrator | Full access (same as Owner)                                                                             |
| Member        | Read-only (`GET` endpoints only)                                                                        |

No new permission-key engine — same minimal role-name check every other write surface in
this codebase uses.

## 6. Integration Points

- **Product Catalogue** ([catalogue.md](catalogue.md)) — every BOM/component/production
  order references `Product.id`, read directly via its exported `ProductRepository`.
  Production never creates a Product; only existing Products can appear in a BOM,
  Production Order, Material Issue, or Finished Goods receipt. Sprint 4.7 added an
  optional `ProductFamily → ProductVariant` grouping on top of `Product` — this is purely
  a catalogue-side organisational layer and changes nothing here: a BOM belongs to one
  specific `Product` (SKU), a Production Order targets that same SKU, and neither ever
  targets a `ProductFamily` or `ProductVariant` directly. `BillOfMaterialService`'s own
  direct use of `ProductRepository.findById` is untouched by that sprint (confirmed by a
  dedicated regression test), so a finished product with or without a variant attached
  behaves identically here.
- **Inventory** ([inventory.md](inventory.md)) — `InventoryModule` now exports
  `InventoryStockRepository`, `InventoryTransactionRepository`, and
  `InventoryLocationRepository` (previously exported nothing) so Production can inject
  them for **read-only** availability checks and location validation. The
  stock-_moving_ writes — Material Issue and Finished Goods Receipt — are a **deliberate,
  narrow exception to ADR-002's domain-ownership convention**, made for atomicity, and
  directly reuse the exact precedent `GoodsReceiptRepository.receive` already
  established for writing into another domain's tables (`purchase_orders.status`) from
  inside its own `$transaction`. `ProductionMaterialIssueRepository.issue()` and
  `ProductionRunRepository.complete()` each open their own transaction, read/validate
  current `InventoryStock` _inside_ it, and write `inventory_stock`/
  `inventory_transactions` directly — never through Inventory's controller or service.
  This was the single most significant architectural decision of this sprint, explicitly
  chosen over inventing a new "inject a `Prisma.TransactionClient` into another domain's
  repository" primitive, which would itself be a new pattern the brief's "no parallel
  patterns" instruction forbids.
- **`InventoryTransaction` ledger** — Production writes `ISSUE` (raw material
  consumption, always positive quantity, `referenceType: 'ProductionMaterialIssue'`) and
  `RECEIPT` (finished-goods output, `referenceType: 'ProductionRun'`) rows — both
  pre-existing enum values that had no writer until this sprint (`ISSUE` was reserved,
  per `inventory.md`'s own "Future Production Consumption" section, exactly for this).
  `InventoryTransaction.quantity`'s sign convention is unchanged: always positive except
  `ADJUSTMENT` rows, which carry a signed delta.
- **Procurement / Suppliers** — no direct integration this sprint. If a Material
  Availability check reveals a shortfall, Production surfaces it purely as data — there
  is no automatic Purchase Order creation, no Supplier notification. A human would place
  a Purchase Order manually through Procurement's own existing UI.
- **Future Finance/Costing** — every `InventoryTransaction` `ISSUE`/`RECEIPT` row this
  sprint writes carries enough structure (Production Order via `referenceId`, component
  or finished product, quantity consumed/produced) for a future Costing module to
  compute standard/actual cost without a schema change — no costing exists yet (no
  labour, machine, or overhead allocation).

## 7. API Reference

| Endpoint                                          | Auth                                           | Input                                                                                                           | Output                                                                                                                                                                 |
| ------------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/production/boms`                        | Any authenticated user                         | Optional `?productId=`, `?status=`, `?search=`                                                                  | `200 { items: BillOfMaterial[] }`                                                                                                                                      |
| `GET /api/production/boms/:id`                    | Any authenticated user                         | —                                                                                                               | `200` — a single BOM; `404` if not found                                                                                                                               |
| `POST /api/production/boms`                       | Owner or Administrator only (`403` for Member) | `{ productId, name?, yieldQuantity, notes?, items: [{ componentProductId, quantity, unitOfMeasure, notes? }] }` | `201` — the created BOM (`DRAFT`); `400` for a non-Finished-Product target or a non-component-type/duplicate item                                                      |
| `PATCH /api/production/boms/:id`                  | Owner or Administrator only (`403` for Member) | `{ name?, yieldQuantity?, notes?, items? }`                                                                     | `200` — the updated BOM; `400` if not `DRAFT`; `404` if not found                                                                                                      |
| `POST /api/production/boms/:id/activate`          | Owner or Administrator only (`403` for Member) | —                                                                                                               | `200` — the activated BOM; `400` if already `ACTIVE`; `404` if not found                                                                                               |
| `POST /api/production/boms/:id/deactivate`        | Owner or Administrator only (`403` for Member) | —                                                                                                               | `200` — the deactivated BOM; `400` if not currently `ACTIVE`; `404` if not found                                                                                       |
| `GET /api/production/orders`                      | Any authenticated user                         | Optional `?status=`, `?productId=`, `?search=`                                                                  | `200 { items: ProductionOrder[] }`                                                                                                                                     |
| `GET /api/production/orders/:id`                  | Any authenticated user                         | —                                                                                                               | `200` — a single order; `404` if not found                                                                                                                             |
| `POST /api/production/orders`                     | Owner or Administrator only (`403` for Member) | `{ billOfMaterialId, plannedQuantity, locationId, notes? }`                                                     | `201` — the created order (`DRAFT`) with its computed requirement snapshot; `400` if the BOM isn't `ACTIVE` or the location isn't `ACTIVE`; `404` if not found         |
| `PATCH /api/production/orders/:id`                | Owner or Administrator only (`403` for Member) | `{ plannedQuantity?, locationId?, notes? }`                                                                     | `200` — the updated order; `400` if not `DRAFT`; `404` if not found                                                                                                    |
| `GET /api/production/orders/:id/availability`     | Any authenticated user                         | —                                                                                                               | `200 { items: MaterialAvailabilityRow[] }`                                                                                                                             |
| `POST /api/production/orders/:id/plan`            | Owner or Administrator only (`403` for Member) | —                                                                                                               | `200` — the planned order; `400` if not `DRAFT`; `404` if not found                                                                                                    |
| `POST /api/production/orders/:id/cancel`          | Owner or Administrator only (`403` for Member) | —                                                                                                               | `200` — the cancelled order; `400` if `IN_PROGRESS`/`COMPLETED`/already `CANCELLED`; `404` if not found                                                                |
| `GET /api/production/orders/:id/material-issues`  | Any authenticated user                         | —                                                                                                               | `200 { items: ProductionMaterialIssue[] }`                                                                                                                             |
| `POST /api/production/orders/:id/material-issues` | Owner or Administrator only (`403` for Member) | `{ issuedDate, notes?, items: [{ componentProductId, quantity }] }`                                             | `201` — the created issue; `400` for over-issue, insufficient stock, or ineligible order status; `404` if not found                                                    |
| `GET /api/production/orders/:id/production-run`   | Any authenticated user                         | —                                                                                                               | `200` — the run, or `null` if not yet completed                                                                                                                        |
| `POST /api/production/orders/:id/complete`        | Owner or Administrator only (`403` for Member) | `{ producedQuantity, rejectedQuantity, rejectionReason?, rejectionNotes? }`                                     | `201` — the completed order + run (`acceptedQuantity` always server-computed); `400` if not `IN_PROGRESS` or `rejectedQuantity > producedQuantity`; `404` if not found |

Every write is scoped to the caller's own `organisationId` (from their JWT) — a
cross-tenant `id` `404`s exactly like a nonexistent one, same convention as every other
domain. Neither controller has any wildcard route — every path has a literal segment
prefix (`orders/`, `.../plan`, `.../material-issues`, ...) — so the "literal-before-
wildcard" route-ordering discipline other controllers need doesn't apply here.

## 8. Audit Events

| Action                               | When                                                                                            |
| ------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `production.bom.created`             | `POST /api/production/boms` — every call                                                        |
| `production.bom.updated`             | `PATCH /api/production/boms/:id` — every call                                                   |
| `production.bom.activated`           | `POST .../activate` — every call                                                                |
| `production.bom.deactivated`         | `POST .../deactivate` — every call                                                              |
| `production.order.created`           | `POST /api/production/orders` — every call                                                      |
| `production.order.updated`           | `PATCH /api/production/orders/:id` — every call                                                 |
| `production.order.planned`           | `POST .../plan` — every call                                                                    |
| `production.order.started`           | `POST .../material-issues`, only when that call is what moved the order `PLANNED → IN_PROGRESS` |
| `production.order.cancelled`         | `POST .../cancel` — every call                                                                  |
| `production.material-issued`         | `POST .../material-issues` — every call                                                         |
| `production.completed`               | `POST .../complete` — every call                                                                |
| `production.finished-goods-received` | Same call, only when `acceptedQuantity > 0`                                                     |

`production.finished-goods-received` is one addition beyond the brief's own suggested
list, mirroring Inventory's own `GOODS_RECEIVED`/`INVENTORY_INCREASED` split — it makes
the stock-increase side effect independently auditable from the order-completion event
itself, fired from Production's own controller since Inventory's controller is bypassed
for this atomic cross-domain write. It does not duplicate any existing Inventory audit
event.

## 9. Prisma Schema (excerpt)

```prisma
enum BillOfMaterialStatus {
  DRAFT
  ACTIVE
  INACTIVE
}

model BillOfMaterial {
  id             String               @id @default(cuid())
  organisationId String
  bomNumber      String               @unique
  productId      String
  name           String?
  status         BillOfMaterialStatus @default(DRAFT)
  yieldQuantity  Float
  notes          String?
  createdById    String?
  updatedById    String?
  createdAt      DateTime             @default(now())
  updatedAt      DateTime             @updatedAt

  organisation    Organisation       @relation(fields: [organisationId], references: [id], onDelete: Cascade)
  product         Product            @relation(fields: [productId], references: [id], onDelete: Restrict)
  items           BillOfMaterialItem[]
  productionOrders ProductionOrder[]

  @@index([organisationId])
  @@index([organisationId, productId, status])
  @@map("bill_of_materials")
}

model BillOfMaterialItem {
  id                  String   @id @default(cuid())
  billOfMaterialId    String
  componentProductId  String
  quantity            Float
  unitOfMeasure       String
  notes               String?
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  billOfMaterial   BillOfMaterial @relation(fields: [billOfMaterialId], references: [id], onDelete: Cascade)
  componentProduct Product        @relation(fields: [componentProductId], references: [id], onDelete: Restrict)

  @@unique([billOfMaterialId, componentProductId])
  @@map("bill_of_material_items")
}

enum ProductionOrderStatus {
  DRAFT
  PLANNED
  IN_PROGRESS
  COMPLETED
  CANCELLED
}

model ProductionOrder {
  id                  String                 @id @default(cuid())
  organisationId      String
  productionOrderNumber String               @unique
  productId           String
  billOfMaterialId    String
  plannedQuantity     Float
  locationId          String
  status              ProductionOrderStatus  @default(DRAFT)
  notes               String?
  createdById         String?
  updatedById         String?
  createdAt           DateTime               @default(now())
  updatedAt           DateTime               @updatedAt

  organisation    Organisation                @relation(fields: [organisationId], references: [id], onDelete: Cascade)
  product         Product                     @relation(fields: [productId], references: [id], onDelete: Restrict)
  billOfMaterial  BillOfMaterial              @relation(fields: [billOfMaterialId], references: [id], onDelete: Restrict)
  location        InventoryLocation           @relation(fields: [locationId], references: [id], onDelete: Restrict)
  items           ProductionOrderItem[]
  materialIssues  ProductionMaterialIssue[]
  productionRun   ProductionRun?

  @@index([organisationId])
  @@index([organisationId, status])
  @@map("production_orders")
}

model ProductionOrderItem {
  id                  String   @id @default(cuid())
  productionOrderId   String
  componentProductId  String
  requiredQuantity    Float
  unitOfMeasure       String
  createdAt           DateTime @default(now())

  productionOrder  ProductionOrder @relation(fields: [productionOrderId], references: [id], onDelete: Cascade)
  componentProduct Product         @relation(fields: [componentProductId], references: [id], onDelete: Restrict)

  @@map("production_order_items")
}

model ProductionMaterialIssue {
  id                 String   @id @default(cuid())
  organisationId     String
  productionOrderId  String
  issuedDate         DateTime
  issuedById         String?
  notes              String?
  createdAt          DateTime @default(now())

  organisation    Organisation                  @relation(fields: [organisationId], references: [id], onDelete: Cascade)
  productionOrder ProductionOrder               @relation(fields: [productionOrderId], references: [id], onDelete: Restrict)
  items           ProductionMaterialIssueItem[]

  @@index([organisationId, productionOrderId])
  @@map("production_material_issues")
}

model ProductionMaterialIssueItem {
  id                        String   @id @default(cuid())
  productionMaterialIssueId String
  componentProductId        String
  quantityIssued            Float
  createdAt                 DateTime @default(now())

  productionMaterialIssue ProductionMaterialIssue @relation(fields: [productionMaterialIssueId], references: [id], onDelete: Cascade)
  componentProduct        Product                 @relation(fields: [componentProductId], references: [id], onDelete: Restrict)

  @@map("production_material_issue_items")
}

enum ProductionRejectionReason {
  BURNT
  UNDERWEIGHT
  PACKAGING_DEFECT
  POOR_SEAL
  OTHER
}

model ProductionRun {
  id                String                     @id @default(cuid())
  organisationId    String
  productionOrderId String                     @unique
  producedQuantity  Float
  rejectedQuantity  Float
  acceptedQuantity  Float
  rejectionReason   ProductionRejectionReason?
  rejectionNotes    String?
  completedById     String?
  completedAt       DateTime                   @default(now())

  organisation    Organisation    @relation(fields: [organisationId], references: [id], onDelete: Cascade)
  productionOrder ProductionOrder @relation(fields: [productionOrderId], references: [id], onDelete: Restrict)

  @@index([organisationId])
  @@map("production_runs")
}
```

See migration `20260815143917_add_production_and_bom` for the exact SQL — purely
additive (six new models, three new enums, four new back-relation arrays on
`Organisation`/`Product`/`InventoryLocation`), no destructive change to any existing
table.

## 10. Known Limitations

- **No Manufacturing Resource Planning (MRP).** No automatic scheduling, no capacity
  planning, no multi-order material netting.
- **No automatic Purchase Order creation from a shortfall.** A Material Availability
  shortfall is exposed as data only — a human places a Purchase Order manually through
  Procurement.
- **No stock-reservation engine.** The availability check reads live
  `quantityOnHand - quantityReserved`; nothing is held/reserved for a specific order.
- **No multi-level / sub-assembly BOMs.** A BOM's components must be
  Raw Material/Packaging Material/Consumable — never another Finished Product's own BOM.
- **No production costing.** No labour, machine, or overhead allocation; no
  standard/actual cost, no COGS, no inventory valuation. `InventoryTransaction` rows
  carry enough structure for a future Costing module to build on, but nothing computes a
  monetary figure today.
- **No batch/lot tracking or expiry tracking** on either raw materials consumed or
  finished goods produced.
- **No barcode/RFID scanning** anywhere in Material Issue or Production Execution.
- **No full Quality Management System.** `ProductionRejectionReason` is a small
  controlled enum + free-text notes, not a workflow engine, inspection checklist, or
  CAPA (Corrective and Preventive Action) system.
- **No waste-management module beyond the rejection reason code** — rejected output is
  recorded, not tracked through a disposal/recycling workflow.
- **No maintenance/equipment-utilisation/capacity-planning integration** — Production
  and Asset & Maintenance Management (Epic 14, not started) are unrelated this sprint.
- **At most one `ProductionRun` per Production Order** (`@@unique` at the schema level)
  — a full re-run or correction after completion isn't supported this sprint; see the
  completion report for how this would relax later.
- **No silent inventory reversal.** Once material has been issued, an order cannot be
  cancelled — there is no reversal workflow this sprint. A correction, if ever needed,
  would have to be a new, explicit, auditable transaction, never an automatic undo.
- **No Sales/Distribution/Accounting integration.** Finished-goods output enters
  Inventory exactly like a Goods Receipt does; nothing downstream of that exists yet.
- **No demand forecasting or AI-assisted production planning.**
- Amounts (`yieldQuantity`, item `quantity`, `plannedQuantity`, `requiredQuantity`,
  `quantityIssued`, `producedQuantity`/`rejectedQuantity`/`acceptedQuantity`) are stored
  as `Float`, not an arbitrary-precision `Decimal` — same convention as every other
  quantity field in this codebase.
