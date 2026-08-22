# Sales Domain

- **Status:** Foundation implemented — Sprint 4.8 ("Customer, Territory, Outlet, Retail
  Network & Sales Foundation").
- **Sprint:** 4.8
- **Depends on:** [Identity](identity.md) (tenant boundary, `RolesGuard`),
  [Customers](customers.md), [Outlets](outlets.md) (optional),
  [Product Catalogue](catalogue.md) (SKU-level `Product` only — Sprint 4.7's Family →
  Variant → SKU architecture).
- **Explicitly does not depend on:** [Retail Network](retail-network.md) — see §2.
- **See also:** [Sprint 4.8 Completion Report](../sprint-4.8-completion-report.md).

## 1. Business Purpose

`SalesOrder` records customer demand: what a customer ordered, from which outlet (if
any), and for how much. It is deliberately an MVP foundation — no fulfilment, no
invoicing, no payments, no inventory movement. See [retail-network.md](retail-network.md)
§1 for the architectural principle this domain most directly serves: **any customer,
regardless of type or distribution-network mapping, can place a direct sales order.**

## 2. `SalesModule` Never Imports `NetworkRelationshipModule` — or `InventoryModule`

Two independent, deliberate non-imports, each enforcing a hard rule from the brief:

1. **No distribution-network gating.** `SalesOrderService` never injects
   `NetworkRelationshipRepository`. The only customer-eligibility check
   (`assertCustomerEligible`) is "does this customer exist in this organisation, and is
   it `ACTIVE`" — `customerType` and network relationships are never inspected. See
   [retail-network.md](retail-network.md) §2 for the full reasoning and the dedicated
   test file that verifies this both behaviourally and structurally.
2. **No inventory deduction.** Creating or confirming a Sales Order **never** touches
   `InventoryStock` or `InventoryTransaction`. No inventory repository of any kind is
   injected into `SalesOrderService`. This is intentional and permanent for this sprint
   — future capabilities (Sales Order → Inventory Reservation → Picking → Dispatch) are
   explicitly deferred, and if ever implemented must be explicit, atomic, and documented,
   never silent.

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
- **Status lifecycle:** `DRAFT → CONFIRMED`, or `→ CANCELLED` from either `DRAFT` or
  `CONFIRMED`. Deliberately **not** extended with `PICKED`/`DISPATCHED`/`DELIVERED`/
  `INVOICED`/`PAID` this sprint — those belong to future fulfilment/accounting work.
  Since confirming never moves stock, cancelling never needs to reverse anything —
  unlike Production's `ProductionOrder`, there is no "cancellation becomes structurally
  impossible past a point" rule here.
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

## 4. Inventory Is Never Touched

Stated plainly because it is the sprint's most safety-critical rule: **no code path in
this domain writes to `InventoryStock` or `InventoryTransaction`.** If a future sprint
wants to show live stock availability while building an order, the correct pattern
(already used by the Field new-order screen) is a purely informational read of the
existing `GET /api/inventory/:productId` endpoint — reusing another domain's read-only
endpoint makes it structurally impossible for availability to ever gate order creation.
This is exactly Production's own Material Availability Check pattern
(`ProductionOrderService.getAvailability`) applied here.

## 5. Workflows

- **Create a Sales Order** — `POST /api/sales/orders` (Owner/Administrator only). Always
  starts `DRAFT`. Validates customer (exists, `ACTIVE`), outlet (if supplied — belongs to
  the customer, `ACTIVE`), every SKU (exists, `FINISHED_PRODUCT`). Computes
  `subtotal`/`total` server-side.
- **Edit** — `PATCH /api/sales/orders/:id`, `DRAFT` only.
- **Confirm** — `POST /:id/confirm`, `DRAFT → CONFIRMED` only.
- **Cancel** — `POST /:id/cancel`, from `DRAFT` or `CONFIRMED`.
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

Same conventions as every other Sprint 4.8 domain — `RolesGuard`, Owner/Administrator
write, Member read-only, tenant-scoped repository methods. Audit events:
`sales-order.created`, `sales-order.updated`, `sales-order.confirmed`,
`sales-order.cancelled`.

## 8. API Reference

| Endpoint                             | Auth                | Notes                                    |
| ------------------------------------ | ------------------- | ---------------------------------------- |
| `GET /api/sales/orders`              | Any authenticated   | `?status=&customerId=&outletId=&search=` |
| `GET /api/sales/orders/:id`          | Any authenticated   |                                          |
| `POST /api/sales/orders`             | Owner/Administrator | Server-computed totals                   |
| `PATCH /api/sales/orders/:id`        | Owner/Administrator | `DRAFT` only                             |
| `POST /api/sales/orders/:id/confirm` | Owner/Administrator | `DRAFT → CONFIRMED`                      |
| `POST /api/sales/orders/:id/cancel`  | Owner/Administrator | From `DRAFT` or `CONFIRMED`              |

## 9. Known Limitations

- No fulfilment states (`PICKED`/`DISPATCHED`/`DELIVERED`) — a future domain's scope.
- No invoicing, payments, or accounting integration.
- No pricing engine, price lists, or customer-specific pricing — `unitPrice` is entered
  freely per line at order time.
- No inventory reservation, deduction, or availability gating of any kind — see §4.
- No discounts beyond a single order-level amount (not a percentage, not per-line).
- No sales commissions, targets, or agent performance tracking.
- No return/refund workflow.
