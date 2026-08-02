# Sprint 4.3 Completion Report — Procurement (Purchase Orders)

**Date:** 2026-08-02
**Status:** Complete

## 1. Objective

Implement Procurement — the purchasing workflow from creating a Purchase Order (PO)
through issuing it to a supplier (`PENDING`, this sprint's explicit finish line). Explicit
constraints from the brief: build only Purchase Order management (no Goods Receiving,
Approval Workflow, Invoices, or Payments), reject Finished Products as line items, always
calculate totals server-side, and match the production quality of every module already
built (Identity, Workspace, Organisation, Users, Product Catalogue, Supplier Management).

## 2. Implementation Summary

### A third non-Identity domain, referencing the two before it

`apps/api/src/procurement/purchase-order/` mirrors the Product Catalogue/Supplier
Management modules' shape: `PurchaseOrderRepository`, `PurchaseOrderService`,
`PurchaseOrderController`, `PurchaseOrderModule`. Unlike those two, this domain has a
header/line-item structure (`PurchaseOrder` + `PurchaseOrderItem`) and depends on both
prior domains — `PurchaseOrderService` injects `SupplierRepository` and
`ProductRepository` (newly exported from their respective modules) to validate a PO's
supplier and item products without duplicating Prisma access, per ADR-002's
domain-ownership rule.

### Schema — two new models, one new enum, one enum extension

Migration `20260802171910_add_procurement_purchase_orders` adds `PurchaseOrder`
(`organisationId`-scoped, `onDelete: Cascade`), `PurchaseOrderItem`
(`onDelete: Cascade` from its parent PO, `onDelete: Restrict` on its `Product`), the
`PurchaseOrderStatus` enum, and a fourth `ProductType` value — `CONSUMABLE` — needed
because the brief's purchasable-type list (Raw Material/Packaging Material/Consumable)
included a type that didn't exist yet from Sprint 4.1. Key decisions:

- **`purchaseOrderNumber`** (`PO-000001`, ...) — globally unique, immutable, same
  collision-avoidance generator pattern as `Product.code`/`Supplier.supplierCode`.
- **`status`** — `DRAFT` (default) → `PENDING` → (`APPROVED`/`RECEIVED`, not reachable
  this sprint) or `CANCELLED`. No dedicated "Issue" endpoint exists — a PO reaches
  `PENDING` via a `PATCH` with `status: "PENDING"` (the Edit dialog's Status field),
  restricted by the validation schema to `DRAFT`/`PENDING` only; `CANCELLED` is reachable
  only through the dedicated `POST /:id/cancel` endpoint.
- **`subtotal`/`total`** — `Float`, always server-calculated from submitted items, never
  accepted on input. `total` always equals `subtotal` this sprint (no taxes/discounts).
- **Amounts as `Float`, not `Decimal`** — this schema has no prior precedent for
  arbitrary-precision `Decimal` types; `Float` with per-calculation rounding to 2 decimal
  places was judged sufficient for MVP figures, documented as a known limitation.

### Product-type validation — the brief's explicit second line of defense

`PurchaseOrderService.buildItems` rejects any item whose product `type` isn't
`RAW_MATERIAL`/`PACKAGING_MATERIAL`/`CONSUMABLE` with a `400`, before any calculation or
persistence happens. The frontend's product picker independently filters to the same
three types client-side (the brief's own suggested refinement), so a user can't even
select a Finished Product — but the backend check is the actual source of truth and was
verified directly via `curl` with a Finished Product id, independent of the UI.

### Automatic calculations — never trusted from the client

Every line's `lineTotal` (`quantity × unitPrice`), the order `subtotal` (sum of line
totals), and `total` (`= subtotal`, no tax/discount in MVP) are computed in
`PurchaseOrderService`, not accepted from the request body — `createPurchaseOrderSchema`/
`updatePurchaseOrderSchema` have no `lineTotal`/`subtotal`/`total` fields at all.

### API and authorization — identical shape to every prior domain

`GET`/`POST /api/procurement/purchase-orders`, `GET`/`PATCH .../:id`,
`POST .../:id/cancel`. `GET` requires only authentication; every write requires
`@Roles('Owner', 'Administrator')` via the existing `RolesGuard`. No `DELETE` endpoint —
cancelled orders remain in history and become read-only (`PurchaseOrderService.update`
rejects editing a `CANCELLED` order with a `400`).

### Frontend — `/settings/procurement`, reusing the Sprint 3.5 shell

- **Table** — PO Number, Supplier, Order Date, Expected Delivery, Status, Total, Actions,
  matching the brief's exact column list.
- **Search + filters** — client-side substring search (PO number/supplier name) plus
  status and supplier `<select>` filters.
- **`PurchaseOrderDialog`** — header (Supplier, Order Date, Expected Delivery, Remarks)
  plus an items grid built with `react-hook-form`'s `useFieldArray` (product picker
  filtered to purchasable types, quantity, unit price, a live client-computed line total
  for display, Add/Remove Row) with a running Subtotal/Total footer. `Status` is a field
  only in Edit mode (not Create, matching the brief's Create dialog field list) —
  reaching `PENDING` happens by editing a `DRAFT` order. A `CANCELLED` order opens the
  same dialog fully disabled with no submit button and its real status shown as static
  text (see "Errors and Fixes" below for why that needed a specific fix).
- **Workspace navigation** — "Procurement" in the sidebar and the `/workspace`
  dashboard's Platform Modules grid now point at `/settings/procurement` and lost their
  "Coming Soon" state; the Platform Status card now shows Procurement `✓ Complete` with
  Inventory as the next "Coming Next" module (Sprint 4.4).

### Seed data

Five raw-material/packaging Products were added (Plantain, Vegetable Oil, Printed Nylon,
Salt, Cartons — one per Supplier's category) alongside three example Boby Bites Purchase
Orders spanning every status this sprint reaches: `PO-000001` (Fresh Farms Ltd, Plantain,
`PENDING` — matching the brief's own worked example exactly), `PO-000002` (Golden Oil
Ltd, Vegetable Oil, `DRAFT`), `PO-000003` (PackRight Nigeria, Printed Nylon,
`CANCELLED`).

## 3. Errors and Fixes (found during this sprint's own verification)

Three real bugs were found and fixed while manually verifying this sprint's own work —
none were pre-existing issues in prior sprints:

1. **Seed data code collision** — the new raw-material products were initially seeded at
   `PRD-000006`–`PRD-000008`, which turned out to already be occupied by unrelated
   products created organically during Sprint 4.1/4.2's own live browser testing (e.g.
   "Coconut Rock"). Since the seed's `upsert` is keyed by `code`, this silently no-opped
   instead of creating the intended Plantain/Vegetable Oil/Printed Nylon rows, and the
   seeded Purchase Orders ended up referencing the wrong products. Fixed by moving those
   three products to genuinely free codes (`PRD-000011`–`PRD-000013`), deleting the
   three incorrectly-wired seeded POs, and re-seeding — verified correct via a direct
   Prisma query afterward.
2. **`PATCH` update crashing with `Internal server error`** — `PurchaseOrderService.update`
   built the header update using Prisma's relation `connect` syntax
   (`supplier: { connect: { id } } }`), but `PurchaseOrderRepository.update` executes it
   via `prisma.purchaseOrder.updateMany()`, which has no relation-connect syntax at all
   (only the singular `update()` does) — TypeScript didn't catch this at compile time
   because the value was built via a conditional object spread, which bypasses excess-
   property checking. Caught live: editing a PO to change its status to `PENDING`
   returned `500` with a Prisma `PrismaClientValidationError` in the server logs. Fixed
   by passing the plain scalar `supplierId` instead of the relation form, and changing
   the repository's parameter type from `Prisma.PurchaseOrderUpdateManyMutationInput`
   (which hides raw FK scalars) to `Prisma.PurchaseOrderUncheckedUpdateManyInput` (which
   exposes them) — re-verified live afterward (Draft → Pending → Cancelled all worked).
3. **Cancelled PO's Status field misleadingly showed "Draft"** — the Edit dialog's Status
   `<select>` only ever has `DRAFT`/`PENDING` options (matching what a real edit can set),
   so when the same dialog opened read-only for a `CANCELLED` order, the field silently
   fell back to displaying "Draft" — wrong, since the real status is `Cancelled` (correctly
   shown as a badge on the list page). Fixed by rendering the actual status as plain text
   when the dialog is read-only, instead of a `<select>` that structurally cannot
   represent that value.

A fourth issue was **not** a bug: a Product picker in a freshly-opened dialog briefly
showed "Select a product…" for an already-selected line, because the Products query
hadn't resolved yet when the uncontrolled `<select>` first mounted (Suppliers had already
been prefetched by the list page and so didn't show this; Products hadn't). Fixed
pre-emptively by gating the dialog's form on both queries having loaded, rather than
letting a race condition surface intermittently.

## 4. Testing / Verification Performed

- Full monorepo quality gate: `pnpm lint`, `pnpm type-check`, `pnpm test`, `pnpm build`
  all green (re-run after each of the three fixes above). 169/169 backend unit tests pass
  (153 pre-existing + 16 new: `PurchaseOrderService` — total/line calculation, PO number
  generation and collision handling, supplier/product existence checks, Finished Product
  rejection, cancelled-order edit rejection, cancel idempotency guard;
  `PurchaseOrderController` — list with search/status/supplier filters, 404 handling,
  create/update/cancel with audit assertions).
- Live end-to-end browser verification against the running dev servers (both the Next.js
  dev server and the NestJS API dev server needed a clean restart partway through this
  sprint — the API server was still running pre-Procurement-module code and returned
  `Cannot GET /api/procurement/purchase-orders` until restarted; documented here since it
  recurred as a real blocker, not just the web server's already-known stale-HMR quirk):
  1. `/settings/procurement` renders the sidebar with "Procurement" active (no "Coming
     Soon"), table shows all 3 seeded POs with correct dates/status badges/totals.
  2. Status filter ("Pending") correctly narrowed to `PO-000001` only.
  3. Create: opened the dialog (no Status field, as designed), confirmed the product
     picker excludes every Finished Product (`Plantain Chips`, `Coconut Rock`,
     `MATHS COMBAT`, etc. — none appeared), filled Fresh Farms Ltd / Plantain / 500kg /
     ₦350, watched the live client-side Line Total compute to ₦175,000.00, submitted —
     `PO-000004` appeared with auto-generated number and `DRAFT` status. Verified server-
     side via a direct Prisma query that `subtotal`/`total`/`lineTotal` were all exactly
     175000, matching the client's own (advisory-only) calculation.
  4. Edit → Status → Pending → Save: found and fixed the `updateMany`/relation-connect
     bug (above) during this exact step; after the fix, the row updated to `Pending`
     live.
  5. Cancel (quick action): the row updated to `Cancelled`, its Edit button switched to
     "View," and re-opening it showed every field disabled with the correct read-only
     status text and no submit button.
  6. No console errors from the application itself.
  7. Mobile viewport (375px): sidebar collapses to hamburger, filters stack, and the
     table scrolls horizontally inside its own container with no page-level horizontal
     scroll.
- Manual API verification (`curl`) directly against the live backend:
  - **Role authorization**: Member `GET` → `200`; Member `POST`/`cancel` → `403` (both
    checked); Owner `POST` → `201`.
  - **Finished Product rejection**: Owner `POST` with a Finished Product line item → `400`
    with the exact expected message, confirming the backend check is authoritative
    independent of the frontend's picker filter.
  - **Tenant isolation**: the same "Sprint42 Tenant Isolation Test" organisation from
    Sprint 4.2's verification returns an empty purchase-order list, and `GET`/`PATCH`/
    `cancel` against a Boby Bites PO id from that tenant's token all return `404` — no
    cross-tenant read, write, or existence leak.
  - **Audit logging**: queried the `audit_logs` table directly after a full
    create → update(status→Pending) → cancel sequence on the same PO and confirmed all
    three events recorded correctly: `purchase-order.created`, `purchase-order.updated`
    (with `fields` metadata listing `supplierId`/`orderDate`/`status`/`items`),
    `purchase-order.cancelled`.
  - **Database migration + seed**: `prisma migrate dev` applied cleanly (including the
    `ProductType` enum's new `CONSUMABLE` value via `ALTER TYPE ... ADD VALUE`);
    `prisma db seed` created all 3 purchase orders with the expected numbers, statuses,
    and line items (verified via a direct Prisma query, twice — once to catch the code-
    collision issue, once to confirm the fix).

## 5. Known Limitations

- No Goods Receiving, Inventory Transactions, Supplier Invoices, Purchase Approval
  Workflow, Payments, multi-currency, taxes, discounts, partial deliveries, or back
  orders — all explicitly out of scope per the brief, reserved for later Procurement and
  Inventory sprints (Sprint 4.4+).
- Amounts are stored as `Float`, not an arbitrary-precision `Decimal` — consistent with
  the rest of this schema (no domain before this one has dealt with money), sufficient
  for MVP figures; each calculation step rounds to 2 decimal places to limit
  floating-point drift.
- Reaching `PENDING` ("issued to supplier") has no dedicated "Issue" action or endpoint —
  it's a Status field change via the Edit dialog/`PATCH`, same mechanism as every other
  header edit, since the brief's Create dialog has no Status field of its own.

## 6. Deferred / Future Work

Per `docs/roadmap.md` Phase 2, Inventory (Sprint 4.4) is the next module, and is expected
to build directly on this foundation: goods receiving will reference a `PurchaseOrder`/
`PurchaseOrderItem` to record what was actually received (partial deliveries explicitly
out of scope this sprint) and transition orders toward `RECEIVED`. A future Purchase
Approval Workflow will use the `APPROVED` status and `approvedById` column, both already
present in the schema but unused.
