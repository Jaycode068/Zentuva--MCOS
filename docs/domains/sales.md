# Sales Domain

- **Status:** Foundation implemented — Sprint 4.8; Fulfilment added — Sprint 4.9 ("Sales
  Execution & Order Fulfilment Foundation").
- **Sprint:** 4.8 / 4.9
- **Depends on:** [Identity](identity.md) (tenant boundary, `RolesGuard`),
  [Customers](customers.md), [Outlets](outlets.md) (optional),
  [Product Catalogue](catalogue.md) (SKU-level `Product` only — Sprint 4.7's Family →
  Variant → SKU architecture), and (Sprint 4.9, Fulfilment only) [Inventory](inventory.md)
  — see §4a.
- **Explicitly does not depend on:** [Retail Network](retail-network.md) — see §2.
- **See also:** [Sprint 4.8 Completion Report](../sprint-4.8-completion-report.md),
  [Sprint 4.9 Completion Report](../sprint-4.9-completion-report.md).

## 1. Business Purpose

`SalesOrder` records customer demand: what a customer ordered, from which outlet (if
any), and for how much. Sprint 4.8 shipped it as a pure record-of-demand — no fulfilment,
no invoicing, no payments, no inventory movement. Sprint 4.9 adds **Fulfilment** (§4a):
the one explicit, atomic operation that actually supplies the goods and moves inventory.
See [retail-network.md](retail-network.md) §1 for the architectural principle this domain
most directly serves: **any customer, regardless of type or distribution-network
mapping, can place a direct sales order** — and, as of Sprint 4.9, have it fulfilled —
with zero network dependency at any stage.

## 2. `SalesModule` Never Imports `NetworkRelationshipModule`

**Confirming a Sales Order never consumes inventory — only Fulfilment does.** These are
two independent, deliberate rules:

1. **No distribution-network gating.** `SalesOrderService` never injects
   `NetworkRelationshipRepository`, and `sales.module.ts` never imports
   `NetworkRelationshipModule`. The only customer-eligibility check
   (`assertCustomerEligible`) is "does this customer exist in this organisation, and is
   it `ACTIVE`" — `customerType` and network relationships are never inspected. See
   [retail-network.md](retail-network.md) §2 for the full reasoning and the dedicated
   test file (`direct-sales-independence.spec.ts`) that verifies this both behaviourally
   and structurally.
2. **`SalesOrderService` never touches inventory, even after Sprint 4.9.** Creating,
   updating, confirming, or cancelling a Sales Order still never touches `InventoryStock`
   or `InventoryTransaction` — no inventory repository of any kind is injected into
   `SalesOrderService`. `direct-sales-independence.spec.ts`'s structural guard now reads
   `sales-order.service.ts`'s own source (not `sales.module.ts`'s) to prove this narrowly
   and precisely. `sales.module.ts` _does_ now import `InventoryModule` (Sprint 4.9) —
   but exclusively so `SalesFulfilmentService`/`SalesFulfilmentRepository` (§4a), a
   completely separate pair of files, can perform the one explicit, atomic, audited
   inventory-moving write this domain has. This is exactly the "explicit, atomic,
   documented, never silent" bridge this document's Sprint 4.8 edition pre-authorized.

## 3. Key Concepts / Entities

### SalesOrder

- **Ownership:** owned by `apps/api/src/sales/` — a flat, single-module domain (one
  aggregate root + a nested item collection, the same shape as `BillOfMaterial`+
  `BillOfMaterialItem` from Production).
- **Fields:** `orderCode` (auto-generated `SO-000001`, ...; `PO-` was already
  `PurchaseOrder`'s prefix, hence `SO-` here), `customerId` (required, immutable),
  `outletId` (optional — see §4 "Outlet Attribution"), `salesAgentId` (always the
  authenticated caller, plain id, no FK relation — same convention as
  `GoodsReceipt.receivedById`), `status` (`DRAFT`/`CONFIRMED`/`CANCELLED`), `orderDate`,
  `notes`, `subtotal`/`discount`/`total` (all server-computed).
- **Status lifecycle (Sprint 4.9):** `DRAFT → CONFIRMED → PARTIALLY_FULFILLED →
FULFILLED`, or `→ CANCELLED` from `DRAFT`/`CONFIRMED` only. `PARTIALLY_FULFILLED`/
  `FULFILLED` are driven exclusively by `SalesFulfilment` records (§4a) — never set
  directly. Still deliberately **not** extended with `PICKED`/`DISPATCHED`/`DELIVERED`/
  `INVOICED`/`PAID` — those remain future fulfilment/delivery/accounting work. Since
  confirming still never moves stock, there is nothing to reverse up to `CONFIRMED`; but
  once _any_ fulfilment has been recorded, cancellation is blocked outright (`"Cannot
cancel an order after fulfilment has started"`) — reversing partially-shipped goods is
  a future "Sales Returns" capability (§9), not this one.
- **`update`** is only reachable while `status === DRAFT`.

### SalesOrderItem

- One line per SKU. `productId` **must** reference a SKU-level `Product` whose `type` is
  `FINISHED_PRODUCT` — never a `ProductFamily` or `ProductVariant`, which are grouping
  labels from Sprint 4.7's hierarchy and were never transactional targets. Enforced in
  `SalesOrderService.buildItems`, mirroring `PurchaseOrderService`'s identical
  purchasable-type restriction pattern.
- `lineTotal` is always server-computed as `quantity * unitPrice` — the client cannot
  even express a value for it (`salesOrderItemInputSchema` omits the field entirely, same
  convention as `completeProductionOrderSchema`'s omitted `acceptedQuantity`).
- `@@unique([salesOrderId, productId])` — no duplicate SKU lines on one order, same
  defence-in-depth shape as `BillOfMaterialItem`.

### Outlet Attribution

`outletId` is optional — a corporate account with no storefront, or a customer whose
outlets haven't been mapped yet, can still order. **When supplied, it must genuinely
belong to the order's own `customerId`** — `SalesOrderService.assertOutletBelongsToCustomer`
rejects a mismatched pair with a `400`, the same "validate referenced-entity coherence
via the referencing domain's own tenant-scoped `findById`" pattern
`BillOfMaterialService.assertFinishedProduct` established. This matters specifically for
Retail Intelligence: `outletId` is meant to truthfully answer "which physical place
received these goods," and a silently-inconsistent pair would poison every future
outlet-level report.

## 4. Order Creation/Confirmation Never Touches Inventory

Stated plainly because it is the sprint's most safety-critical rule: **no code path in
`SalesOrderService` writes to `InventoryStock` or `InventoryTransaction`.** While building
an order, the Field new-order screen shows live stock as a purely informational read of
the existing `GET /api/inventory/:productId` endpoint — reusing another domain's
read-only endpoint makes it structurally impossible for availability to ever gate order
creation. This is exactly Production's own Material Availability Check pattern
(`ProductionOrderService.getAvailability`) applied here. **Confirmation never consumes
inventory — only Fulfilment does** (§4a).

## 4a. Fulfilment (Sprint 4.9)

Fulfilment is the one explicit, atomic, audited bridge between a Sales Order and
Inventory — the single place this domain's inventory is ever actually deducted.

```
DRAFT ──confirm──> CONFIRMED ──fulfil(partial)──> PARTIALLY_FULFILLED ──fulfil(rest)──> FULFILLED
  │                    │
  └──────cancel────────┘   (blocked once any fulfilment exists)
```

- **`SalesFulfilment`** — one physical-supply event/batch: header (`organisationId`,
  `salesOrderId`, `locationId`, `fulfilmentDate`, `fulfilledById`, `notes`,
  `idempotencyKey`) + one or more `SalesFulfilmentItem` rows (`productId`,
  `salesOrderItemId`, `quantityFulfilled`). A Sales Order may have many fulfilments over
  time (partial shipments) — exact mirror of Production's `ProductionMaterialIssue`/
  `ProductionMaterialIssueItem` shape.
- **`SalesOrderItem.quantityFulfilled`** — cumulative quantity supplied so far,
  `0 <= quantityFulfilled <= quantity`, incremented only inside the fulfilment
  transaction. The order's own `status` is _derived_, never stored independently: after
  every fulfilment, `Σ quantityFulfilled` vs `Σ quantity` across all items decides
  `PARTIALLY_FULFILLED` (some but not all) vs `FULFILLED` (all).
- **Atomicity** — `SalesFulfilmentRepository.create()` runs the entire operation inside
  one `$transaction`, mirroring `ProductionMaterialIssueRepository.issue()`: an
  idempotency check-then-return, a conditional eligibility re-check
  (`CONFIRMED`/`PARTIALLY_FULFILLED` only), a per-item `InventoryStock`
  read-guard-decrement (never negative), the `SalesFulfilment`+items write, paired
  `InventoryTransaction` `ISSUE` rows (`referenceType: 'SalesFulfilment'` — the same
  ledger Production's Material Issue already writes to, no new transaction type, no
  parallel ledger), and the item/order status recomputation — all rolled back together
  on any failure. `SalesOrderService`'s pre-checks (order state, over-fulfilment,
  informational stock) are UX-only fast-fail 400s; the repository's transaction is the
  real, authoritative guard.
- **Idempotency** — an optional client-supplied `idempotencyKey`, paired with a
  `@@unique([salesOrderId, idempotencyKey])` constraint. A retried request (double-tap,
  flaky mobile connection) carrying the _same_ key against the _same_ order returns the
  original `SalesFulfilment` instead of deducting stock twice. Postgres treats every
  `NULL` as distinct, so a caller that never sends a key is unaffected. Both the Admin
  dialog and the Field Sales sheet generate one via `crypto.randomUUID()` once per
  fulfilment attempt and reuse it across retries of that same submit.
- **Location** — one `InventoryLocation` per fulfilment batch (multi-location fulfilment
  of a single order in one batch is out of scope — see §9).
- **Cancellation guard** — once `status` is `PARTIALLY_FULFILLED` or `FULFILLED`,
  `POST /:id/cancel` returns a `400` ("Cannot cancel an order after fulfilment has
  started") rather than a generic not-found. `SalesOrderRepository.updateStatus`'s
  `fromStatuses` for cancel is unchanged (`[DRAFT, CONFIRMED]`) — it already structurally
  can't reach these states; the guard exists purely to produce a clear, specific message.

## 5. Workflows

- **Create a Sales Order** — `POST /api/sales/orders` (Owner/Administrator only). Always
  starts `DRAFT`. Validates customer (exists, `ACTIVE`), outlet (if supplied — belongs to
  the customer, `ACTIVE`), every SKU (exists, `FINISHED_PRODUCT`). Computes
  `subtotal`/`total` server-side.
- **Edit** — `PATCH /api/sales/orders/:id`, `DRAFT` only.
- **Confirm** — `POST /:id/confirm`, `DRAFT → CONFIRMED` only.
- **Cancel** — `POST /:id/cancel`, from `DRAFT` or `CONFIRMED` only (blocked once any
  fulfilment exists — §4a).
- **View availability** — `GET /:id/availability?locationId=` (any authenticated user) —
  read-only, per-line ordered/fulfilled/remaining/availableStock/shortfall.
- **View fulfilment history** — `GET /:id/fulfilments` (any authenticated user).
- **Fulfil** — `POST /:id/fulfil` (Owner/Administrator only) — atomically decrements
  inventory and records the batch (§4a).
- **Browse** — `GET /api/sales/orders?status=&customerId=&outletId=&search=` (any
  authenticated user, Member read-only).

## 6. Field Sales vs. Admin — Two Surfaces, One Backend

Both surfaces call the exact same `/api/sales/orders` endpoints.

- **Field Sales** (`apps/web/src/app/(field)/field/orders/new/page.tsx`) — a
  mobile-first flow: select Customer (no type/network filter, with a visible "Any
  customer can order directly" note) → select Outlet if applicable (an explicit "No
  outlet / direct delivery" option is always present) → add SKU lines via a bottom-sheet
  picker (`@zentuva/ui`'s `Sheet`) restricted to `FINISHED_PRODUCT` SKUs → a live,
  client-computed running total with an explicit "the server recalculates this total
  authoritatively when you save" caption → Confirm → a clear success screen with "View
  Order"/"Create Another Order" actions.
- **Admin** (`apps/web/src/app/(app)/settings/sales/`) — the same live-preview,
  server-authoritative-recompute pattern, presented as a desktop dialog with a
  repeating-row item grid, following `ProductionOrderDialog`'s established template.

Why two surfaces rather than one responsive one: see
[retail-network.md](retail-network.md) §8 and the Field Sales shell's own docblock
(`apps/web/src/components/field/FieldShell.tsx`) — the existing desktop Workspace shell
has no mobile-first primitives, and a sales agent's phone-based, task-focused workflow is
different enough in kind (not just in screen width) from a desktop admin's browsing/
filtering workflow to warrant its own route group rather than a single responsive layout
serving both.

## 7. RBAC / Tenant Isolation / Audit

Same conventions as every other domain — `RolesGuard`, Owner/Administrator write, Member
read-only, tenant-scoped repository methods. Audit events: `sales-order.created`,
`sales-order.updated`, `sales-order.confirmed`, `sales-order.cancelled`, and (Sprint 4.9)
`sales-order.fulfilled` — one action name covers both partial and full fulfilment events,
distinguished by the `newStatus` field in its metadata. A replayed idempotent fulfilment
request (`wasCreated === false`) never emits a second audit event.

## 8. API Reference

| Endpoint                                 | Auth                | Notes                                                          |
| ---------------------------------------- | ------------------- | -------------------------------------------------------------- |
| `GET /api/sales/orders`                  | Any authenticated   | `?status=&customerId=&outletId=&search=`                       |
| `GET /api/sales/orders/:id`              | Any authenticated   |                                                                |
| `POST /api/sales/orders`                 | Owner/Administrator | Server-computed totals                                         |
| `PATCH /api/sales/orders/:id`            | Owner/Administrator | `DRAFT` only                                                   |
| `POST /api/sales/orders/:id/confirm`     | Owner/Administrator | `DRAFT → CONFIRMED`                                            |
| `POST /api/sales/orders/:id/cancel`      | Owner/Administrator | From `DRAFT` or `CONFIRMED` only                               |
| `GET /api/sales/orders/:id/availability` | Any authenticated   | `?locationId=` optional; informational, never gates fulfilment |
| `GET /api/sales/orders/:id/fulfilments`  | Any authenticated   | Fulfilment history                                             |
| `POST /api/sales/orders/:id/fulfil`      | Owner/Administrator | Atomic — decrements inventory, updates order status            |

## 9. Known Limitations

- No delivery/route tracking within Sales itself — a fulfilment records "supplied," not
  "delivered" or "in transit"; see [Distribution](distribution.md) (Sprint 5) for
  Dispatch/Delivery, chained off Fulfilment.
- Invoicing, Payments, Credit Notes, and Accounts Receivable now live in their own
  domain — see [Finance](finance.md) (Sprint 6). `FULFILLED` remains Sales' own
  fulfilment-lifecycle terminal state; Finance reads `SalesOrder.status` read-only to
  gate invoice eligibility, but Sales itself has no invoicing/payment concept.
- No pricing engine, price lists, or customer-specific pricing — `unitPrice` is frozen at
  order-creation time and never re-priced at fulfilment.
- No inventory reservation on confirmation — `InventoryStock.quantityReserved` remains
  unwritten by Sales even after Sprint 4.9; two `CONFIRMED` orders can race for the same
  limited stock at fulfilment time (first-fulfilled-wins, enforced only by the atomic
  per-fulfilment stock guard, not by an earlier reservation).
- No discounts beyond a single order-level amount (not a percentage, not per-line).
- No sales commissions, targets, or agent performance tracking.
- No Sales Returns / reverse fulfilment — once any fulfilment is recorded, the order can
  no longer be cancelled at all, and there is no credit-back path for a customer return
  or damaged-in-transit shipment.
- No multi-location fulfilment within a single batch — one `SalesFulfilment` is pinned to
  exactly one `InventoryLocation`; splitting one order's fulfilment across two warehouses
  requires two separate fulfilment batches.
- No barcode-scanning fulfilment entry — quantity entry is manual numeric input on both
  Admin and Field Sales.
- A real "Sales Agent" RBAC role remains undelivered — fulfilment write access rides on
  `@Roles('Owner','Administrator')`, same deferred decision as order creation/confirmation.
