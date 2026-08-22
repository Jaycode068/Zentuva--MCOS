# Sprint 4.9 Completion Report — Sales Execution & Order Fulfilment Foundation

## 1. Objective

Extend the Sales capability shipped in Sprint 4.8 — a pure record-of-demand
(`SalesOrder`/`SalesOrderItem`, `DRAFT → CONFIRMED/CANCELLED`, never touching inventory)
— into a full commercial order lifecycle that can move an order from Customer/Outlet
through Confirmation, Availability Check, Fulfilment, and Stock Movement, while
preserving the domain boundaries established in prior sprints: Sales must not become
Inventory, Inventory must not become Sales, and the Distribution Network must remain
completely irrelevant to whether an order can be placed or fulfilled.

**Business problem:** Boby Bites needed a way to record that goods were _actually
supplied_ against a confirmed order — potentially across multiple partial shipments —
without conflating "the customer wants this" (confirmation) with "we physically gave
them this" (fulfilment). Confirming an order must never silently reserve or deduct
stock; only an explicit, auditable Fulfilment action may do that.

## 2. Architecture Decisions

| Decision                                  | Choice                                                                                                                                                                   | Why                                                                                                                                                 |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Where Fulfilment code lives               | Inside the existing `apps/api/src/sales/` directory (new files alongside `sales-order.*`), not a new top-level module                                                    | Mirrors Production's own precedent — `ProductionOrder`/`ProductionMaterialIssue`/`ProductionRun` are three aggregates inside one `ProductionModule` |
| `SalesModule` importing `InventoryModule` | Yes — a deliberate, narrow, Sprint-4.9-only exception to Sprint 4.8's "Sales never touches Inventory" rule                                                               | Required for `SalesFulfilmentService`/`SalesFulfilmentRepository` to read/write `InventoryStock`; `SalesOrderService` itself gets zero new imports  |
| Structural guard revision                 | `direct-sales-independence.spec.ts`'s guard moved from asserting `sales.module.ts` never imports Inventory to asserting `sales-order.service.ts` never imports Inventory | Preserves the guarantee exactly where it matters — order create/update/confirm/cancel — while permitting the new, separate Fulfilment bridge        |
| Order-status derivation                   | Derived from `Σ quantityFulfilled` vs `Σ quantity` across items, recomputed inside the same transaction as every fulfilment write, never stored as an independent flag   | Prevents any window where items and order status could disagree                                                                                     |
| Idempotency                               | New `SalesFulfilment.idempotencyKey` + `@@unique([salesOrderId, idempotencyKey])`                                                                                        | No idempotency-key convention existed anywhere in this codebase; this is a minimal, practical, database-backed mechanism — not a distributed system |
| Inventory transaction type                | Reused the existing `InventoryTransactionType.ISSUE` with `referenceType: 'SalesFulfilment'`                                                                             | `ISSUE` already exists and is already used by Production Material Issue — one shared ledger, no new enum value, no parallel ledger                  |
| Fulfilment granularity                    | One `SalesFulfilment` per event, pinned to exactly one `InventoryLocation`, one or more `SalesFulfilmentItem` rows                                                       | Exact mirror of `ProductionMaterialIssue`/`ProductionMaterialIssueItem`; multi-location-per-batch fulfilment is explicitly deferred                 |
| RBAC                                      | `POST .../fulfil` gated `@Roles('Owner','Administrator')`; `GET .../availability` and `GET .../fulfilments` auth-only                                                    | Reuses `RolesGuard` exactly as-is — no new roles, no permission engine, per the brief                                                               |

## 3. Backend Implementation

### Schema (`apps/api/prisma/schema.prisma`, migration `20260822120840_add_sales_fulfilment`)

- `SalesOrderStatus` extended: `DRAFT | CONFIRMED | PARTIALLY_FULFILLED | FULFILLED | CANCELLED`.
- `SalesOrderItem.quantityFulfilled Float @default(0)` — new column.
- New `SalesFulfilment` model: `organisationId`, `salesOrderId` (FK `Restrict`),
  `locationId` (FK `Restrict`), `fulfilmentDate`, `fulfilledById`, `notes`,
  `idempotencyKey` (`@@unique([salesOrderId, idempotencyKey])`).
- New `SalesFulfilmentItem` model: `salesFulfilmentId` (FK `Cascade`), `productId` (FK
  `Restrict`), `salesOrderItemId` (FK `Restrict`), `quantityFulfilled`.
- Purely additive migration — no existing column renamed, retyped, or dropped; applied
  cleanly against the populated dev database.

### New files

- `apps/api/src/sales/sales-fulfilment.repository.ts` — `create()` (the atomic
  transaction described below), `findManyBySalesOrder()`. Exports
  `InsufficientStockError`/`SalesFulfilmentConflictError`.
- `apps/api/src/sales/sales-fulfilment.service.ts` — `getAvailability()`,
  `listFulfilments()`, `fulfil()` (pre-checks + delegation to the repository).
- `apps/api/src/sales/sales-fulfilment.service.spec.ts` — unit tests (see §5).

### Modified files

- `apps/api/src/sales/sales-order.repository.ts` — `SalesOrderWithRelations.items` gains
  `quantityFulfilled`.
- `apps/api/src/sales/sales-order.service.ts` — `cancel()` gains a guard branch:
  `PARTIALLY_FULFILLED`/`FULFILLED` → `BadRequestException('Cannot cancel an order after
fulfilment has started')`, checked before the existing "already cancelled" branch. No
  other change — `create`/`update`/`confirm`/`buildItems` are untouched and remain fully
  Inventory-unaware.
- `apps/api/src/sales/sales-order.controller.ts` — three new routes (below), and
  `toSalesOrderResponse` gains `quantityFulfilled` per item.
- `apps/api/src/sales/sales-audit-actions.ts` — new `ORDER_FULFILLED:
'sales-order.fulfilled'` key (covers both partial and full fulfilment events;
  `newStatus` in the audit metadata distinguishes them).
- `apps/api/src/sales/sales.module.ts` — imports `InventoryModule`; providers gain
  `SalesFulfilmentRepository`/`SalesFulfilmentService`. Docblock states plainly that this
  is a deliberate, narrow exception, confirmed to apply only to the Fulfilment path.
- `apps/api/src/sales/direct-sales-independence.spec.ts` — structural guard narrowed (see
  §"Architecture Decisions" above); all pre-existing behavioural tests (direct sale with
  zero network relationships, a relationship added later never rewriting history, the
  9-`CustomerType` parametrized case) pass completely unmodified.
- `packages/validation/src/sales.ts` — `salesOrderStatusSchema` extended;
  new `salesFulfilmentItemInputSchema`/`createSalesFulfilmentSchema`.

### API surface

| Method | Path                                 | Guard               |
| ------ | ------------------------------------ | ------------------- |
| `GET`  | `/api/sales/orders/:id/availability` | Auth only           |
| `GET`  | `/api/sales/orders/:id/fulfilments`  | Auth only           |
| `POST` | `/api/sales/orders/:id/fulfil`       | Owner/Administrator |

### The atomic transaction

`SalesFulfilmentRepository.create()` mirrors `ProductionMaterialIssueRepository.issue()`
step for step, inside one Prisma interactive `$transaction`:

1. **Idempotency check** — if a client-supplied `idempotencyKey` matches an existing
   `SalesFulfilment` for this order, return it unchanged (`wasCreated: false`), no
   further writes.
2. **Eligibility guard** — re-reads the order's status (`CONFIRMED`/
   `PARTIALLY_FULFILLED` only) inside the transaction, closing the race a service-level
   pre-check alone can't close.
3. **Per-item stock guard + decrement** — reads current `InventoryStock.quantityOnHand`,
   computes the new balance, throws `InsufficientStockError` if it would go negative,
   otherwise upserts.
4. **Create** the `SalesFulfilment` + nested `SalesFulfilmentItem` rows.
5. **Paired ledger rows** — `InventoryTransaction.createMany` with
   `transactionType: ISSUE`, `referenceType: 'SalesFulfilment'`.
6. **Increment** each `SalesOrderItem.quantityFulfilled`, then recompute and write the
   order's own `status` from the new totals.

Any failure at any step rolls back every prior write in the same transaction — no
partial stock movement, no orphan fulfilment, no incorrect order status.

## 4. Frontend Implementation

### Admin (`apps/web/src/app/(app)/settings/sales/`)

- New `sales-fulfilment-dialog.tsx` — mirrors `MaterialIssueDialog`'s
  Ordered/Already-Fulfilled/Remaining/Available grid, plus a Location `<Select>` (the
  same `listInventoryLocations()` + `ACTIVE`-filter + `isDefault`-default pattern as
  `stock-adjustment-dialog.tsx`). Generates one `crypto.randomUUID()` idempotency key per
  dialog open.
- `sales-order-detail-dialog.tsx` — new "Fulfil Order" footer button
  (`CONFIRMED`/`PARTIALLY_FULFILLED`), a "Fulfilled" items column, a read-only
  "Fulfilment History" section, and the "Cancel Order" button's visibility narrowed to
  `DRAFT`/`CONFIRMED` only.
- `api.ts`/`labels.ts` — new types/functions (`getSalesOrderAvailability`,
  `listSalesFulfilments`, `fulfilSalesOrder`) and new status labels/badge variants
  (`PARTIALLY_FULFILLED` → warning, `FULFILLED` → success).

### Field Sales (`apps/web/src/app/(field)/field/orders/`)

- `[id]/page.tsx` — sticky action bar widened to include `PARTIALLY_FULFILLED`; a new
  "Fulfil Order" button opens a full-screen (`Sheet side="full"`) flow with a touch-sized
  Location select and per-line Ordered/Fulfilled/Remaining/Available cards; "Cancel
  Order" narrowed to `DRAFT`/`CONFIRMED`.
- `new/page.tsx` — a small, purely informational "In stock: X {unit}" line under each
  item card, sourced live from the existing Inventory endpoint; never blocks adding items
  or submitting.
- `(field)/field/api.ts` — gained `getInventoryStockByProduct`/`listInventoryLocations`
  re-exports; `SalesFulfilment` types/functions already flow through automatically via
  the existing `export * from '.../settings/sales/api'`.

## 5. Testing

- `sales-fulfilment.service.spec.ts` (new, 14 cases): `getAvailability` shape
  (ordered/fulfilled/remaining/availableStock/shortfall, zero-stock handling, default
  location resolution, `NotFoundException` for an unknown order); `fulfil` rejecting
  `DRAFT`/`CANCELLED`/`FULFILLED`, an item not belonging to the order, over-fulfilment
  (single-shot and cumulative-across-fulfilments), insufficient stock; a happy-path
  partial fulfilment asserting the exact repository call shape; translation of
  `InsufficientStockError`/`SalesFulfilmentConflictError` into `BadRequestException`.
- `sales-order.service.spec.ts` — two new cases: cancelling a `PARTIALLY_FULFILLED`/
  `FULFILLED` order rejected with the exact message, asserting `updateStatus` is never
  called.
- `sales-order.controller.spec.ts` — new cases for `getAvailability`/`listFulfilments`/
  `fulfil`, including the audit-only-on-`wasCreated` assertion.
- `direct-sales-independence.spec.ts` — structural guard revised (see §2); all
  pre-existing behavioural cases pass unmodified.
- **Deliberate deviation from the original test plan:** no dedicated
  `sales-fulfilment.repository.spec.ts` was written. A codebase-wide check confirmed
  that no other atomic-transaction repository in this codebase (`GoodsReceiptRepository.
receive`, `InventoryStockRepository.adjustStock`, `ProductionMaterialIssueRepository.
issue`, `ProductionRunRepository.complete`) has a repository-level unit test that mocks
  Prisma's interactive `$transaction` — that guarantee is instead proven by the
  service-level specs (repository mocked at the public-method boundary) plus live
  verification against a real Postgres instance. `sales-fulfilment.repository.ts` follows
  the same convention rather than inventing a new one.
- **Full suite:** 39 test suites, 419 tests, all passing. `tsc --noEmit` clean on both
  `apps/api` and `apps/web`. `eslint --max-warnings=0` clean on every touched file.
  Production builds (`nest build`, `next build`) both succeed.

## 6. Live Verification Performed

Against the actual running application (API on :4000, Web on :3000), not just unit
tests:

1. **Admin desktop (1280×800 effective / 817×442 captured)** — opened `SO-000008`
   (seeded `CONFIRMED`, unfulfilled): both "Fulfil Order" and "Cancel Order" visible.
   Fulfilled 40 of 60 units at Main Warehouse — badge flipped to "Partially Fulfilled,"
   items table showed `40 / 60`, Fulfilment History showed the new batch, and "Cancel
   Order" correctly disappeared from the footer. Fulfilled the remaining 20 units across
   two more batches — badge flipped to "Fulfilled," Fulfil button disappeared.
2. **Stock/ledger verification** — `InventoryStock.quantityOnHand` for the sold SKU
   decreased by exactly the fulfilled quantity after each batch (verified via direct
   database queries throughout, arithmetic tracked exactly across 6 sequential
   fulfilments with zero drift); `InventoryTransaction` row count increased by exactly
   one per fulfilled line; `AuditLog` recorded one `sales-order.fulfilled` entry per
   real fulfilment.
3. **Over-fulfilment rejected** — a direct API call requesting more than the remaining
   quantity returned `400` with the exact message: `Cannot fulfil 25 Pack of "..." —
only 20 Pack remains outstanding`.
4. **Insufficient stock rejected** — a direct API call against a zero-stock SKU (ordered
   100, available 0) returned `400`: `Insufficient stock for "..." (available: 0,
requested: 50)`.
5. **Terminal-state protection** — once `FULFILLED`, both a further `POST .../fulfil`
   (`"This sales order has already been fully fulfilled"`) and `POST .../cancel`
   (`"Cannot cancel an order after fulfilment has started"`) were rejected with `400`.
6. **Idempotency** — two identical `POST .../fulfil` requests with the same
   `idempotencyKey` were issued back to back: only the first deducted stock and wrote an
   `InventoryTransaction`/`SalesFulfilment`; the second returned the identical result
   with no further writes, and no second audit event was recorded.
7. **RBAC** — logged in as `Member`: `GET .../availability` and `GET .../fulfilments`
   both returned `200`; `POST .../fulfil` returned `403 Forbidden`.
8. **Field Sales mobile (360×800, 375×812, 430×932)** — the order detail screen, the
   full-screen fulfilment sheet (touch-sized Location select, per-line grid, sticky
   footer), and the new-order screen's informational stock hint all rendered correctly
   with no horizontal scroll or overlap. Submitted a real 50-unit fulfilment through the
   mobile sheet against `SO-000001` (a seeded `PARTIALLY_FULFILLED` order) — the order
   detail screen updated automatically via React Query invalidation with no manual
   refresh, and the corresponding stock/ledger changes were confirmed in the database.
9. **Seed idempotency** — `prisma db seed` run twice back to back; identical summary
   counts both times, and direct database inspection confirmed exactly 2
   `SalesFulfilment` rows and no duplicate stock deduction after the second run.
10. **No unexpected console errors** — the only console errors observed were the
    intentional 400/403 responses from the negative-path tests above.

## 7. Bugs Found and Fixed During This Sprint

- **Order-code collision with pre-existing dev data.** The original seed plan reused
  order codes `SO-000006`/`SO-000007` for the new fixtures, but the shared dev database
  already contained real orders at those exact codes (artifacts of an earlier live-testing
  session, created through the running application itself). The seed script's
  upsert-by-code logic silently no-opped on the header and left the pre-existing items
  untouched, causing a downstream `salesOrderItemId: undefined` failure in
  `seedSalesFulfilments`. Fixed by renumbering the new fixtures to `SO-000008`/
  `SO-000009` (verified free) rather than touching the pre-existing rows.

## 8. Known Limitations

See `docs/domains/sales.md` §9 for the full list. Highlights: no Sales Returns/reverse
fulfilment (an order can no longer be cancelled at all once any fulfilment exists, and
there is no credit-back path); no inventory reservation on confirmation
(`quantityReserved` stays unwritten — two `CONFIRMED` orders can race for the same stock
at fulfilment time, resolved first-fulfilled-wins by the atomic per-fulfilment guard, not
by an earlier reservation); one `InventoryLocation` per fulfilment batch (no
multi-location split within one batch); no barcode scanning; no re-pricing at fulfilment
time; no real "Sales Agent" RBAC role (fulfilment write access still rides on
Owner/Administrator).

## 9. Deferred / Future Work

Sales Returns / Reverse Fulfilment; Inventory Reservation on Confirm; Multi-location
fulfilment per batch; Delivery/Route Tracking; Invoicing/Payments/Accounts Receivable;
Warehouse/bin-level picking; Barcode-scanning fulfilment entry; a real "Sales Agent" RBAC
role; pricing engine/discounts/promotions at fulfilment time; sales analytics/reporting
dashboards; network-based order routing. See `docs/backlog.md` Epic 7.

## 10. Documentation Updated

`docs/domains/sales.md` (new §4a "Fulfilment," revised §2/§4/§5/§7/§8/§9),
`docs/domains/inventory.md` (updated `ISSUE`/reference-type notes to reflect Sales as a
second real consumer alongside Production), `docs/domains/README.md`, `docs/backlog.md`
(Epic 7), `docs/roadmap.md`, `docs/changelog.md`, this completion report.

## 11. Constraint

Nothing in this sprint was committed or pushed, per the explicit instruction carried
through the brief. All changes remain in the working tree, pending explicit instruction
from the user to commit.
