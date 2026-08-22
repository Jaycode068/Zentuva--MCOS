# Sprint 4.6 Completion Report — Production Management & Bill of Materials Foundation

**Date:** 2026-08-15
**Status:** Complete

## 1. Objective

Close the loop in Zentuva's manufacturing chain — Product Catalogue → Procurement →
Goods Receiving → Inventory currently stops at "we know what raw material we have."
Sprint 4.6 adds the missing middle: a Bill of Materials (recipe), a Production Order
(instruction to manufacture, with a server-authoritative material requirement snapshot),
Material Issue (atomically consuming raw materials out of Inventory), Production
Execution (planned/produced/rejected/accepted), and Finished Goods Receipt (accepted
output back into Inventory) — deliberately an MVP foundation, not a full MRP or Quality
Management System. Explicit non-goals reaffirmed throughout: no scheduling/capacity
planning, no multi-level/sub-assembly BOMs, no labour/machine/overhead costing, no
batch/lot/expiry tracking, no automatic Purchase Order creation from a shortfall, no
stock-reservation engine, no full Quality Management System.

## 2. Implementation Summary

### Schema — six new models, three new enums

Migration `20260815143917_add_production_and_bom` — purely additive, no destructive
change to any existing table, applied cleanly on the first `prisma migrate dev` attempt
(unlike prior sprints' non-interactive-confirmation wall, since nothing here changed an
existing column or constraint):

- **`BillOfMaterial`**/**`BillOfMaterialItem`** — the recipe. `bomNumber` (`BOM-000001`,
  auto-generated, globally unique), `productId` (must be `FINISHED_PRODUCT`),
  `yieldQuantity`, `status` (`DRAFT`/`ACTIVE`/`INACTIVE`); items reference a
  `RAW_MATERIAL`/`PACKAGING_MATERIAL`/`CONSUMABLE` component with `@@unique([billOfMaterialId, componentProductId])` duplicate defense.
- **`ProductionOrder`**/**`ProductionOrderItem`** — the instruction to manufacture.
  `productionOrderNumber` (`PROD-000001` — `PO-` was already `PurchaseOrder`'s prefix),
  `billOfMaterialId` (pinned forever), `plannedQuantity`, `locationId` (reuses
  `InventoryLocation`), `status` (`DRAFT`/`PLANNED`/`IN_PROGRESS`/`COMPLETED`/
  `CANCELLED`). `ProductionOrderItem.requiredQuantity` is the immutable snapshot,
  computed once at creation.
- **`ProductionMaterialIssue`**/**`ProductionMaterialIssueItem`** — one immutable batch
  event per issue call (a header + item rows, exact structural mirror of
  `GoodsReceipt`/`GoodsReceiptItem`).
- **`ProductionRun`** — the single completion event, `productionOrderId @@unique` (at
  most one run per order this sprint). `producedQuantity`/`rejectedQuantity`/
  `acceptedQuantity` kept as distinct figures; `rejectionReason`
  (`ProductionRejectionReason?`)/`rejectionNotes`.
- `Organisation`/`Product`/`InventoryLocation` each gained the standard back-relation
  array, matching every prior sprint's pattern.

### The one real architectural decision — reusing ADR-002's narrow exception a third time

Material Issue and Production Completion both need to atomically write to
`InventoryStock`/`InventoryTransaction` — tables Inventory owns — from inside
Production's own domain. Rather than inventing a new pattern (e.g. injecting a
`Prisma.TransactionClient` into an externally-owned repository), this sprint reuses the
exact precedent `GoodsReceiptRepository.receive` already established for writing
`purchase_orders.status` from inside its own transaction: `ProductionMaterialIssueRepository.issue()`
and `ProductionRunRepository.complete()` each open their own `prisma.$transaction`,
read/validate current stock _inside_ it, and write `inventory_stock`/
`inventory_transactions` directly — a deliberate, narrow, now-three-times-used exception
to ADR-002, not a new architectural primitive. `InventoryModule` needed one change —
`exports: [InventoryStockRepository, InventoryTransactionRepository, InventoryLocationRepository]`
(it previously exported nothing) — so Production can inject them for **reads**
(availability checks, location validation); the writes never go through these exports.

### Repositories — `BillOfMaterialRepository`, `ProductionOrderRepository`, `ProductionMaterialIssueRepository`, `ProductionRunRepository`

- `BillOfMaterialRepository.activate()` is the one multi-row atomic write on that
  aggregate: setting a BOM `ACTIVE` and deactivating any prior `ACTIVE` BOM for the same
  product happen together, inside one transaction.
- `ProductionMaterialIssueRepository.issue()` — the critical atomic write: a conditional
  `updateMany` both re-validates the order is still `PLANNED`/`IN_PROGRESS` _and_
  performs the `PLANNED → IN_PROGRESS` transition (idempotently, if already
  `IN_PROGRESS`) in one call; then for each component, reads the current
  `InventoryStock` balance inside the transaction (not from a pre-check), decrements it,
  throwing `InsufficientStockError` if that would go negative; appends the
  `ProductionMaterialIssue` + items; appends one `InventoryTransaction` `ISSUE` row per
  component. Any single component being short rolls back the entire transaction.
- `ProductionRunRepository.complete()` — a conditional `updateMany` re-validates
  `IN_PROGRESS → COMPLETED`; creates the `ProductionRun`; only when
  `acceptedQuantity > 0`, upserts the finished product's `InventoryStock` and appends an
  `InventoryTransaction` `RECEIPT` row.
- Both repositories expose their own `Error` subclasses (`InsufficientStockError`,
  `ProductionMaterialIssueConflictError`, `ProductionCompletionConflictError`) —
  framework-agnostic, translated to `BadRequestException` one layer up in
  `ProductionOrderService`, same convention as `InventoryStockRepository`'s
  `NegativeStockError`/`GoodsReceiptRepository`'s conflict error.

### Services — `BillOfMaterialService`, `ProductionOrderService`

- `BillOfMaterialService` owns finished-product/component-type validation, the
  "one `ACTIVE` per product" rule, the "DRAFT-only editing" rule, and the `BOM-000001`
  number generator — mirrors `PurchaseOrderService`'s shape almost exactly.
- `ProductionOrderService` owns requirement-calculation (the snapshot taken at
  order-creation, and recomputed from the order's own pinned BOM — never "whatever's
  currently active" — if `plannedQuantity` is edited while still `DRAFT`), the
  availability check, every status-transition rule, and delegates the two atomic
  stock-moving operations to the repositories above. `issueMaterial()` validates every
  submitted component belongs to the order's own requirement snapshot, rejects
  over-issue (`already issued + this request > required`), pre-checks stock
  availability for a fast `400`, then delegates to the atomic write (which
  re-validates authoritatively). `completeProduction()` computes
  `acceptedQuantity = producedQuantity - rejectedQuantity` itself — the request schema
  has no `acceptedQuantity` field at all, so a client cannot even attempt to supply one.

### API surface

`BillOfMaterialController` (`production/boms`) and `ProductionOrderController`
(`production/orders`) — every `GET` open to any authenticated user (Member read-only),
every write additionally gated by `RolesGuard`/`@Roles('Owner', 'Administrator')`. No
wildcard routes in either controller, so the "literal segments before the wildcard"
ordering discipline other controllers need doesn't apply here. Every write handler calls
the service, then records one or more `auditService.record(...)` calls — one per
logically distinct event, including two conditional ones:
`production.order.started` (only when a material issue is what caused the
`PLANNED → IN_PROGRESS` transition) and `production.finished-goods-received` (only when
`acceptedQuantity > 0`).

### Frontend

`apps/web/src/app/(app)/settings/production/` — `api.ts`/`labels.ts`, `page.tsx` (Bills
of Materials / Production Orders tabs, following the exact tab-bar pattern
`InventorySettingsPage` established), `bom-dialog.tsx` (create/edit with a
free-form add/remove component grid, mirroring `PurchaseOrderDialog`'s item grid),
`production-order-dialog.tsx` (select an active BOM → a dedicated `getBillOfMaterial`
query drives a live, client-computed Material Requirements preview that scales with
planned quantity — the server always recomputes and pins this same calculation
authoritatively), `production-order-detail-dialog.tsx` (requirement snapshot with a live
availability banner, material issue history, production result, and every reachable
status-transition action button), `material-issue-dialog.tsx` (one row per outstanding
component: Required/Already Issued/Remaining/Available, blocks over-issue/
over-available client-side), `production-run-dialog.tsx` (Produced/Rejected inputs,
conditional rejection-reason fields, a live-computed read-only Accepted preview).
`navigation-config.ts`'s existing `{ label: 'Production', ..., comingSoon: true }` entry
became `{ label: 'Production', href: '/settings/production' }`; the Workspace dashboard's
development-progress checklist updated Production from "Coming Next" to "✓ Complete".

### Seed data

Idempotent, added to `apps/api/prisma/seed.ts`: a raw-material top-up
(`ADJUSTMENT`/`FOUND_STOCK`, `referenceType: 'ProductionSeedTopUp'`) for Plantain,
Vegetable Oil, Salt, and Printed Nylon — Vegetable Oil had zero stock going into this
sprint (its only Purchase Order was seeded `DRAFT` and never received), the rest already
carried stock from Sprint 4.4.1's goods-receiving seed data but were topped up for
headroom. One `ACTIVE` BOM (`BOM-000001`, Plantain Chips, `yieldQuantity: 1000`, four
components) and one Production Order (`PROD-000001`, `plannedQuantity: 500`, seeded
`PLANNED` so the live verification pass below could exercise Material Issue
immediately) — both seeded directly at their "end state" (bypassing the DRAFT-first
lifecycle a real API call would go through), same convention `BOBY_BITES_PRODUCTS`
already uses for seeding `ACTIVE` instead of `DRAFT`.

## 3. Testing / Verification Performed

- **Full quality gate:** `tsc --noEmit` clean on both `apps/api` and `apps/web`; `eslint`
  clean on every new/modified file (two unused-import warnings caught and fixed —
  `ProductionOrder` type import in the detail dialog, `Textarea` import in the run
  dialog); `prisma validate` clean; `prisma format` applied.
- **Backend unit tests — 267/267 passing** (207 pre-existing + 60 new, zero
  regressions): `bill-of-material.service.spec.ts` (create/number-generation/
  collision-increment, finished-product-only validation, component-type restriction,
  Finished-Product-as-component rejection, DRAFT-only editing, activate/deactivate
  transitions, tenant isolation); `bill-of-material.controller.spec.ts` (list filters,
  create/activate/deactivate + their audit calls); `production-order.service.spec.ts`
  (requirement-calculation scaling, BOM-snapshot immutability after the source BOM
  changes, active-BOM/active-location validation, status transitions, cancellation
  rules — including the structural "blocked once `IN_PROGRESS`" invariant —
  availability computation, over-issue/insufficient-stock rejection, atomic-issue
  delegation, repository-error-to-`BadRequestException` translation,
  server-computed-accepted-ignoring-client-value, zero-accepted-writes-nothing,
  tenant isolation); `production-order.controller.spec.ts` (conditional
  `production.order.started`/`production.finished-goods-received` audit firing).
- **Live end-to-end verification** against the actual running application (dev servers
  started fresh, logged in as the seeded Owner):
  1. `/settings/production` renders both tabs; Bills of Materials shows the seeded
     `BOM-000001` (Active, 4 components); Production Orders shows `PROD-000001`
     (Planned, 500 Pack).
  2. Opened the Production Order detail dialog: Material Requirements table showed
     Required/Available/Shortfall correctly scaled at half the BOM's yield (250kg
     Plantain, 25L Vegetable Oil, 2.5kg Salt, 500 Roll Printed Nylon), all with ample
     availability and no shortfall.
  3. Issued a **partial** quantity (100kg of the 250kg Plantain requirement) via the
     Material Issue dialog — verified via API: `InventoryTransaction` `ISSUE` row
     created (`referenceType: 'ProductionMaterialIssue'`), Plantain stock dropped
     `3000 → 2900`, order transitioned to `IN_PROGRESS` automatically.
  4. Attempted to over-issue (9,999kg against a 150kg remaining balance) — rejected with
     a `400` and a clear message ("only 150 Kilogram remains outstanding").
  5. Issued the remaining materials for all four components via the API — all
     `ISSUE` transactions recorded; requirement snapshot's Required/Already
     Issued/Remaining reconciled correctly in the detail view afterward.
  6. Attempted to complete with `rejectedQuantity > producedQuantity` — rejected by Zod
     validation before it reached the server. Attempted to complete with a
     client-supplied `acceptedQuantity: 999` alongside valid produced/rejected values —
     the server silently ignored it and computed `acceptedQuantity = 450` itself
     (`480 - 30`) — confirmed via the response body and the DB row.
  7. Verified the finished-goods side effect: an `InventoryTransaction` `RECEIPT` row
     (`referenceType: 'ProductionRun'`, `quantity: 450`) and Plantain Chips stock at
     `450` — both correct.
  8. Confirmed terminal-state guards: cancelling a `COMPLETED` order returns `400`
     ("Completed production orders cannot be cancelled"); issuing material against a
     `COMPLETED` order returns `400` ("This production order has already been
     completed").
  9. Confirmed the full audit trail: `production.material-issued` (×2),
     `production.order.started` (×1, only on the first issue), `production.completed`,
     `production.finished-goods-received` — all present, correctly ordered, correctly
     conditional.
  10. Confirmed Member RBAC: `GET /api/production/boms` returns `200`;
      `POST /api/production/boms` and `POST /:id/plan` both return `403`
      ("You do not have permission to perform this action").
  11. Confirmed BOM validation: duplicate `componentProductId` in one request rejected
      by Zod; a `FINISHED_PRODUCT` used as a component rejected by
      `BillOfMaterialService` with a clear message.
  12. Reloaded the completed Production Order's detail view in the browser — Material
      Requirements, updated Available quantities, full Material Issue History (both
      issue events), and Production Result (Produced 480 / Rejected 30 / Accepted 450,
      "Burnt — edges burnt") all rendered correctly; only a "Close" action remained
      (no Cancel/Issue/Complete buttons on a terminal-state order).
  13. Verified a mobile viewport (375×812) — the detail dialog and its tables render
      responsively via the same `overflow-x-auto` wrapper convention every other table
      in this codebase uses.
  14. Checked the browser console throughout — zero errors.
- **No bugs found during this verification pass** — unlike Sprint 4.5's caught-and-fixed
  `InventoryModule` DI gap, every piece worked on the first live pass, likely because the
  plan's own research phase had already surfaced and closed the equivalent gap
  (`InventoryModule` exports) before implementation began.

## 4. Known Limitations

See `docs/domains/production.md` §10 for the full, current list — summarized:

- No MRP (scheduling, capacity planning, multi-order material netting).
- No automatic Purchase Order creation from a Material Availability shortfall.
- No stock-reservation engine — the availability check is a live read, not a hold.
- No multi-level/sub-assembly BOMs.
- No production costing (labour/machine/overhead, standard/actual cost, COGS,
  valuation).
- No batch/lot or expiry tracking.
- No barcode/RFID scanning.
- No full Quality Management System — `ProductionRejectionReason` is a small controlled
  enum + free-text notes.
- No waste-management workflow beyond the rejection reason code.
- No maintenance/equipment-utilisation/capacity-planning integration.
- At most one `ProductionRun` per Production Order (`@@unique` at the schema level).
- No silent inventory reversal — once material is issued, cancellation is blocked with
  no reversal workflow this sprint.
- No Sales/Distribution/Accounting integration.
- No demand forecasting or AI-assisted planning.

## 5. Deferred / Future Work

Per `docs/roadmap.md` Phase 2, Production is now a real consumer of the
`InventoryTransaction` ledger Inventory established (Sprint 4.4) and reserved `ISSUE` for
(Sprint 4.4/4.5's own "Future Production Consumption" notes). A future Costing sprint
would build on the `ISSUE`/`RECEIPT` rows this sprint writes (each already carries the
Production Order, component/finished product, and quantity) without needing a schema
change. A future MRP/Scheduling sprint would add capacity planning and multi-order
material netting on top of the availability check already in place. Multi-level BOMs,
batch/lot/expiry tracking, and a real stock-reservation workflow all remain explicitly
deferred pending their own dedicated design work — none of today's schema choices block
them, but none of them are implemented.
