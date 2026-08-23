# Distribution Domain

- **Status:** Foundation implemented — Sprint 5 ("Distribution & Delivery Operations
  Foundation").
- **Sprint:** 5
- **Depends on:** [Identity](identity.md) (tenant boundary, `RolesGuard`),
  [Sales](sales.md) (`SalesFulfilmentRepository`/`SalesOrderRepository`, read-only, via
  `SalesModule`'s export), [Customers](customers.md), [Outlets](outlets.md),
  [Inventory](inventory.md) (`InventoryLocationRepository` only — never
  `InventoryStockRepository`/`InventoryTransactionRepository`).
- **Explicitly does not depend on:** [Retail Network](retail-network.md),
  [Territories](territories.md) — see §2.
- **See also:** [Sprint 5 Completion Report](../sprint-5-completion-report.md).

## 1. Business Purpose

Sales Fulfilment (Sprint 4.9) answers "has this order been supplied from stock?" It does
not answer "has it physically left the warehouse?" or "did it actually arrive?" This
sprint adds the two stages that close that gap:

- **Dispatch** — the physical release of already-fulfilled goods toward a destination.
- **Delivery** — confirmation of what actually arrived, including partial/short
  deliveries.

Zentuva's Final Product Principle applies directly here: capture the transaction (Sales
Order), fulfil it (Sales Fulfilment), dispatch it (this domain), deliver it (this
domain) — each layer built on the last, none skipped or hard-coded around. Inventory is
deducted exactly once, at Fulfilment; Dispatch and Delivery never touch it again.

## 2. `DistributionModule` Never Touches `InventoryStock`/`InventoryTransaction`, Never Imports `NetworkRelationshipModule`/`TerritoryModule`

Two independent, deliberate rules, both proven executably by
`distribution-inventory-independence.spec.ts` (not just documented here):

1. **No second inventory deduction.** `DispatchService`/`DeliveryService`/
   `DispatchRepository`/`DeliveryRepository` never import
   `inventory-stock`/`inventory-transaction`, and `DispatchRepository`/
   `DeliveryRepository`'s own `$transaction` blocks never reference
   `tx.inventoryStock`/`tx.inventoryTransaction`. `DistributionModule` imports
   `InventoryModule` **only** for `InventoryLocationRepository` — source-location
   validation and display. `SalesFulfilment` remains the sole inventory-deducting event
   in this codebase; Dispatch tracks its own `quantityDispatched` cumulative column on
   `SalesFulfilmentItem`, and Delivery tracks its own `quantityDelivered` cumulative
   column on `DispatchItem` — neither ever writes to `InventoryStock`.
2. **No distribution-network gating.** `DistributionModule` never imports
   `NetworkRelationshipModule` or `TerritoryModule` at all. A dispatch's destination is
   always resolved from the commercial chain (`Customer → SalesOrder → SalesFulfilment →
Dispatch`), never from a `DistributionNetworkRelationship`. The "Associated
   Distributor" card shown on a dispatch's detail view (Admin) is a **frontend-only**
   composition against the pre-existing public `GET /api/retail/network-relationships?
customerId=` endpoint — purely informational, never a gate on creating, dispatching,
   or delivering anything. Territory is resolved as a response-shaping decision
   (`outlet.territoryId ?? customer.territoryId`, outlet takes precedence as the more
   specific destination) — not a new backend dependency. See
   [retail-network.md](retail-network.md) §1 ("the network is intelligence, not a
   gatekeeper") — this sprint extends that same guarantee two stages further downstream.

## 3. Key Concepts / Entities

### Dispatch

- **Ownership:** owned by `apps/api/src/distribution/` — a flat, two-aggregate domain
  (`Dispatch`+`DispatchItem`, `Delivery`+`DeliveryItem`), mirroring `SalesOrder`+
  `SalesFulfilment`'s own two-tier shape one level further down the chain.
- **Fields:** `dispatchCode` (auto-generated `DSP-000001`, ..., globally unique),
  `salesFulfilmentId` (required — a Dispatch always originates from an existing
  fulfilment), `salesOrderId` (denormalised from the fulfilment's own order, for simple
  list filtering), `customerId` (always resolved from the order, never client-supplied),
  `outletId` (optional override — defaults to the order's own outlet; when supplied, must
  belong to the same customer), `sourceLocationId` (an `InventoryLocation` — read-only
  context, never a second deduction point), `dispatchDate`, `status`, `notes`.
- **Status lifecycle:** `READY → DISPATCHED → IN_TRANSIT → {PARTIALLY_DELIVERED →
DELIVERED}`, with `CANCELLED` (from `READY`/`DISPATCHED`/`IN_TRANSIT`, blocked once any
  delivery exists — "Cannot cancel a dispatch once delivery has started") and `FAILED`
  (from `DISPATCHED`/`IN_TRANSIT` only, terminal, requires a non-empty explanation) as
  terminal side-branches. `PARTIALLY_DELIVERED`/`DELIVERED` are driven exclusively by
  `Delivery` records — never set directly. Neither `cancel()` nor `fail()` ever reverses
  `quantityDispatched`/`quantityDelivered` — there is nothing to reverse, since neither
  ever touched inventory.
- **Idempotency:** `idempotencyKey` + `@@unique([salesFulfilmentId, idempotencyKey])` —
  same pattern as `SalesFulfilment.idempotencyKey`, protecting `create()` against a
  double-tap or flaky-network retry.

### DispatchItem

- One line per product per dispatch, referencing the exact `SalesFulfilmentItem` it was
  released from (`salesFulfilmentItemId`) for precise traceability. `quantityDispatched`
  is fixed at creation; `quantityDelivered` is a cumulative column incremented only
  inside `DeliveryRepository.create()`'s transaction (`0 <= quantityDelivered <=
quantityDispatched`). No `@@unique([dispatchId, productId])` — duplicate-line
  prevention is Zod-only, same precedent `SalesFulfilmentItem` itself already sets.

### Delivery

- **Ownership:** the immutable child/event, mirroring `SalesFulfilment`'s own role.
- **Fields:** `dispatchId`, `deliveryDate`, `receivedByName` (plain text, not a FK — often
  not a system user), `notes` (captures **why** a delivery is short — damaged/lost/
  refused — this sprint deliberately builds no reason-code enum, no return-to-stock
  path, no Returns/Claims Management system: free text is the minimum auditable
  foundation), `photoUrl`/`photoKey` (a single optional proof-of-delivery photo,
  populated by a separate follow-up upload request, mirroring `Product.imageUrl`/
  `imageKey`'s single-photo shape — not `OutletPhoto`'s multi-photo child table).
  Signature capture is explicitly deferred to future scope.
- **Idempotency:** `idempotencyKey` + `@@unique([dispatchId, idempotencyKey])`.

### DeliveryItem

- One line per product per delivery, referencing the exact `DispatchItem` it confirms
  (`dispatchItemId`). `quantityDelivered` need not sum to the dispatch's full quantity —
  a short/partial delivery is the expected case, not an error.

### The cumulative-column chain

```
SalesOrderItem.quantityFulfilled  →  SalesFulfilmentItem.quantityDispatched  →  DispatchItem.quantityDelivered
     (Sprint 4.9)                         (Sprint 5)                                (Sprint 5)
```

Each column is incremented only inside the relevant atomic `$transaction`, and each
aggregate's own `status` is always _derived_ from its items' cumulative totals versus
their bound — never stored as an independently-settable flag. `DispatchRepository.create()`
and `DeliveryRepository.create()` both mirror `SalesFulfilmentRepository.create()`'s exact
shape: idempotency check-then-return, an eligibility guard re-reading the parent's current
state inside the transaction, a per-item read-guard-increment, the child aggregate+items
create, and (for Delivery only) the dispatch's own status recomputation.

## 4. Source Location / Destination

- **Source** — reuses the existing `InventoryLocation` architecture as-is (a `<Select>`
  defaulting to the organisation's default location, same pattern as Sales Fulfilment's
  own location picker). No warehouse/WMS concepts introduced.
- **Destination** — reuses the existing `Customer`/`Outlet` architecture: `Customer` is
  the commercial relationship, `Outlet` is the physical place, never merged. A dispatch's
  outlet defaults from its Sales Order's own outlet; an override is validated to belong
  to the same customer (mirrors `SalesOrderService.assertOutletBelongsToCustomer`).

## 5. Workflows

- **Create a Dispatch** — `POST /api/distribution` (Owner/Administrator only). Validates
  the referenced Sales Fulfilment exists, resolves `customerId` from its order, validates
  any outlet override, validates the source location, and blocks any line exceeding its
  fulfilment's remaining undispatched quantity.
- **Dispatch / Mark In Transit** — `POST /:id/dispatch`, `POST /:id/in-transit` — plain
  conditional status flips.
- **Cancel** — `POST /:id/cancel`, blocked once any delivery exists.
- **Fail** — `POST /:id/fail`, requires a non-empty `notes` explanation.
- **View dispatch availability** — `GET /fulfilments/:salesFulfilmentId/dispatch-
availability` (any authenticated user) — read-only, per-line fulfilled/dispatched/
  remaining, never gates `create()`.
- **View delivery history** — `GET /:id/deliveries` (any authenticated user).
- **Record a Delivery** — `POST /:id/deliveries` (Owner/Administrator only) — atomically
  confirms receipt, supports partial/short delivery, recomputes the dispatch's status.
- **Upload proof-of-delivery photo** — `POST /distribution/deliveries/:deliveryId/photo`
  (Owner/Administrator only) — a separate follow-up multipart request, reusing the
  existing `FileStorage` port exactly as `ProductController.uploadImage` does.
- **Browse** — `GET /api/distribution?status=&customerId=&salesOrderId=&search=` (any
  authenticated user, Member read-only).

## 6. Admin vs. Field Sales — Two Surfaces, One Backend

Both surfaces call the exact same `/api/distribution` endpoints.

- **Admin** (`apps/web/src/app/(app)/settings/distribution/`) — a dispatches list with
  search/status filters, a multi-step "Create Dispatch" dialog (search a fulfilled Sales
  Order → pick its Sales Fulfilment → the Fulfilled/Already Dispatched/Remaining item
  grid), and a detail dialog with header/items/delivery history/status-conditional
  actions/the informational "Associated Distributor" card.
- **Field Sales** (`apps/web/src/app/(field)/field/deliveries/`) — a mobile card list
  defaulting to dispatches a field agent still has an action on
  (`DISPATCHED`/`IN_TRANSIT`/`PARTIALLY_DELIVERED`), a detail page with sticky primary
  actions, and a full-screen delivery-confirmation `Sheet` (`FieldDeliverySheet`,
  mirroring `FieldFulfilSheet`'s exact shape) with a Dispatched/Delivered/Remaining grid,
  recipient name, notes, and — once the delivery is recorded — a second "Add photo" step
  using `ImageUploadCard`'s new `preferCamera` prop to open the device's rear camera
  directly.

## 7. RBAC / Tenant Isolation / Audit

Same conventions as every other domain — `RolesGuard`, Owner/Administrator write, Member
read-only, tenant-scoped repository methods. Audit actions: `dispatch.created`,
`dispatch.dispatched`, `dispatch.in-transit`, `dispatch.cancelled`, `dispatch.failed`,
`dispatch.delivery-recorded` (covers both partial and full delivery, distinguished by
`newStatus` in its metadata), `dispatch.delivery-photo-uploaded`. A replayed idempotent
create (`wasCreated === false`) never emits a second audit event.

## 8. API Reference

| Endpoint                                                                     | Auth                | Notes                                        |
| ---------------------------------------------------------------------------- | ------------------- | -------------------------------------------- |
| `GET /api/distribution`                                                      | Any authenticated   | `?status=&customerId=&salesOrderId=&search=` |
| `GET /api/distribution/:id`                                                  | Any authenticated   |                                              |
| `POST /api/distribution`                                                     | Owner/Administrator | Creates from an existing Sales Fulfilment    |
| `POST /api/distribution/:id/dispatch`                                        | Owner/Administrator | `READY → DISPATCHED`                         |
| `POST /api/distribution/:id/in-transit`                                      | Owner/Administrator | `DISPATCHED → IN_TRANSIT`                    |
| `POST /api/distribution/:id/cancel`                                          | Owner/Administrator | Blocked once any delivery exists             |
| `POST /api/distribution/:id/fail`                                            | Owner/Administrator | Body `{ notes }` required                    |
| `GET /api/distribution/:id/deliveries`                                       | Any authenticated   | Delivery history                             |
| `POST /api/distribution/:id/deliveries`                                      | Owner/Administrator | Atomic — never touches inventory             |
| `POST /api/distribution/deliveries/:deliveryId/photo`                        | Owner/Administrator | Multipart, single file                       |
| `GET /api/distribution/fulfilments/:salesFulfilmentId/dispatch-availability` | Any authenticated   | Informational, never gates `create()`        |

## 9. Known Limitations

- No fleet/vehicle/driver management, no route optimisation or GPS tracking — a dispatch
  records "left the source location," not a live position.
- No advanced Warehouse Management — one `sourceLocationId` per dispatch, same
  single-location restriction Sales Fulfilment already carries.
- No pricing engine, distributor commissions, credit management, or trade promotions.
- No Sales Returns / Claims Management — discrepancies are captured as free-text `notes`
  only; no structured reason-code enum, no return-to-stock path.
- No multi-photo proof of delivery — exactly one photo per delivery this sprint.
- No delivery e-signature capture.
- No automatic re-dispatch linkage after a `FAILED` dispatch — a new dispatch must be
  created independently.
- A real "Delivery Agent"/"Sales Agent" RBAC role remains undelivered — write access
  rides on `@Roles('Owner','Administrator')`, same deferred decision as every other
  domain in this codebase.
- No Distribution Analytics (on-time rate, shortfall trends) — deferred to a future
  Business Intelligence epic.
- No full module-level permission engine — RBAC remains binary
  (Owner/Administrator-write, Member-read), though the domain boundaries here are
  designed so a future engine could distinguish Sales/Distribution/Warehouse/Management/
  Field Sales roles without a rewrite.
