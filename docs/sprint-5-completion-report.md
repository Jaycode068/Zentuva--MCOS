# Sprint 5 Completion Report — Distribution & Delivery Operations Foundation

## 1. Objective

Extend the Sales chain shipped in Sprint 4.8/4.9 (`SalesOrder → SalesFulfilment`, the
sole, atomic, inventory-deducting event) two stages further downstream: **Dispatch**
(the physical release of already-fulfilled goods toward a destination) and **Delivery**
(confirmation of what actually arrived, supporting partial/short/failed delivery), while
preserving the absolute rule that inventory is deducted exactly once — at Fulfilment —
and never again at Dispatch or Delivery time.

**Business problem:** Boby Bites needed to track what happens to goods _after_ they are
fulfilled from stock — did they physically leave the warehouse, and did the customer
actually receive what was sent? Sales Fulfilment alone cannot answer either question.
Direct sales at any tier must remain possible throughout, with the Distribution Network
staying purely informational context, never a gate on whether goods can be dispatched or
delivered.

## 2. Architecture Decisions

| Decision                             | Choice                                                                                                                                                                                       | Why                                                                                                                                              |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Model shape                          | Two new aggregate pairs mirroring `SalesOrder`/`SalesFulfilment` one level further down: `Dispatch`+`DispatchItem`, `Delivery`+`DeliveryItem`                                                | Reuses the exact established "aggregate with derived status" + "immutable child event incrementing a cumulative column" pattern, twice more      |
| Cumulative-progress columns          | `SalesFulfilmentItem.quantityDispatched` (new), `DispatchItem.quantityDelivered` (new) — completing `quantityFulfilled → quantityDispatched → quantityDelivered`                             | Mirrors `SalesOrderItem.quantityFulfilled` exactly; incremented only inside the relevant atomic transaction, status always derived, never stored |
| Inventory independence               | `DistributionModule` imports `InventoryModule` **only** for `InventoryLocationRepository`; never `InventoryStockRepository`/`InventoryTransactionRepository`                                 | The sprint's single most safety-critical rule, proven executably by `distribution-inventory-independence.spec.ts`, not just documented           |
| Network/Territory independence       | `DistributionModule` never imports `NetworkRelationshipModule`/`TerritoryModule`; "Associated Distributor" is a frontend-only call to the pre-existing public network-relationships endpoint | Keeps "the network is intelligence, not a gatekeeper" structurally enforced the same way Sales already established for order placement           |
| Cross-module read access             | `sales.module.ts` gains its first `exports: [SalesOrderRepository, SalesFulfilmentRepository]`                                                                                               | Same ADR-002 convention `InventoryModule`/`ProductModule` already use; a one-line additive change                                                |
| `SalesFulfilmentRepository.findById` | New method added (didn't exist before this sprint) returning a fulfilment with its parent order's `customerId`/`outletId`                                                                    | `DispatchService` needs the order's destination without a second round trip through `SalesOrderRepository`                                       |
| Proof of delivery                    | Single optional `photoUrl`/`photoKey` pair directly on `Delivery`, uploaded via a follow-up multipart request — not an `OutletPhoto`-style child table                                       | Exactly one photo is ever needed per delivery event; a child table is the multi-photo pattern, reserved for genuinely multi-photo cases          |
| Discrepancy tracking                 | Derived (`dispatched − Σdelivered`), captured via free-text `notes`, never a stored reason-code column                                                                                       | The brief explicitly forbids building a Returns/Claims system this sprint — free text is the minimum auditable foundation                        |
| RBAC                                 | Every write `@Roles('Owner','Administrator')`; every `GET` auth-only                                                                                                                         | Reuses `RolesGuard` exactly as-is, per the brief's explicit "no full permission engine yet"                                                      |

## 3. Backend Implementation

### Schema (`apps/api/prisma/schema.prisma`, migration `20260822211903_add_distribution_dispatch_delivery`)

- `SalesFulfilmentItem.quantityDispatched Float @default(0)` — new column.
- New `DispatchStatus` enum: `READY | DISPATCHED | IN_TRANSIT | PARTIALLY_DELIVERED |
DELIVERED | CANCELLED | FAILED`.
- New `Dispatch` model: `dispatchCode` (`@unique`), `salesFulfilmentId`/`salesOrderId`
  (denormalised)/`customerId`/`outletId` (nullable)/`sourceLocationId` — all FK
  `Restrict`; `status`, `notes`, `idempotencyKey`
  (`@@unique([salesFulfilmentId, idempotencyKey])`).
- New `DispatchItem`: `salesFulfilmentItemId` (FK `Restrict`, precise traceability),
  `quantityDispatched`, `quantityDelivered @default(0)`. No `@@unique([dispatchId,
productId])` — duplicate-line prevention is Zod-only, same precedent
  `SalesFulfilmentItem` already sets.
- New `Delivery`: `dispatchId` (FK `Restrict`), `deliveryDate`, `receivedByName`,
  `notes`, `photoUrl`/`photoKey`, `idempotencyKey`
  (`@@unique([dispatchId, idempotencyKey])`).
- New `DeliveryItem`: `dispatchItemId` (FK `Restrict`), `quantityDelivered`.
- Back-relations added to `Organisation`, `Product`, `InventoryLocation` (its only new
  relation this sprint), `Customer`, `Outlet`, `SalesOrder`, `SalesFulfilment`.
- Purely additive migration — applied cleanly against the populated dev database.

### New files

- `apps/api/src/distribution/dispatch.repository.ts` — `create()` (atomic transaction:
  idempotency check-then-return, eligibility guard, per-item over-dispatch guard against
  `SalesFulfilmentItem.quantityDispatched`, aggregate+items create), `findById`,
  `findManyByOrganisation`, `existsByCode`, `updateStatus`. Exports
  `OverDispatchError`/`DispatchConflictError`.
- `apps/api/src/distribution/dispatch.service.ts` — `getById`, `list`, `create`,
  `dispatch`, `markInTransit`, `cancel`, `fail`, `getDispatchAvailability`,
  `generateUniqueCode` (`DSP-000001` collision loop).
- `apps/api/src/distribution/delivery.repository.ts` — `create()` (mirrors
  `dispatch.repository.ts`'s shape against `DispatchItem.quantityDelivered`, plus the
  dispatch's own status recomputation), `findManyByDispatch`, `setPhoto`. Exports
  `OverDeliveryError`/`DeliveryConflictError`.
- `apps/api/src/distribution/delivery.service.ts` — `create()` (three-part pre-check/
  delegate/catch pattern), `setPhoto()` (mirrors `ProductService.setImage`).
- `apps/api/src/distribution/dispatch.controller.ts` — all 11 routes, RBAC/audit wiring,
  `toDispatchResponse`/`toDeliveryResponse` free functions.
- `apps/api/src/distribution/distribution-audit-actions.ts`,
  `distribution.module.ts`.
- `apps/api/src/distribution/distribution-inventory-independence.spec.ts` — the
  structural guard (see §2).
- `apps/api/src/distribution/{dispatch.service,delivery.service,dispatch.controller}.spec.ts`
  — unit tests (see §5).

### Modified files

- `apps/api/src/sales/sales-fulfilment.repository.ts` — new `findById()` method and
  `SalesFulfilmentWithOrder` type (see §2); `SalesFulfilmentWithItems.items` gains
  `quantityDispatched`.
- `apps/api/src/sales/sales.module.ts` — first-ever `exports` array.
- `apps/api/src/app.module.ts` — `DistributionModule` registered after `SalesModule`.
- `packages/validation/src/distribution.ts` (new file) — `createDispatchSchema`,
  `failDispatchSchema`, `createDeliverySchema`, and their item schemas, each with a
  duplicate-line `.refine()`.
- `apps/api/prisma/seed.ts` — new customer `CUS-000012` "Mama Nkechi Stores", outlet
  `OUT-000009`, order `SO-000011`, a matching fulfilment, and a new
  `seedDispatchesAndDeliveries` helper creating `DSP-000001` (500 dispatched) + one
  partial delivery (470/500, `PARTIALLY_DELIVERED`); `PRD-000027`'s stock top-up bumped
  to comfortably cover the additional draw.

## 4. Frontend Implementation

- **Admin** (`apps/web/src/app/(app)/settings/distribution/`) — `api.ts`, `labels.ts`,
  `page.tsx` (search+status filter, desktop table/mobile card), `dispatch-dialog.tsx`
  (a three-step flow: search a fulfillable Sales Order → pick its Sales Fulfilment →
  the Fulfilled/Already Dispatched/Remaining item grid — necessary because, unlike
  "Fulfil Order," a Dispatch has no parent already open on screen), `dispatch-detail-
dialog.tsx` (header, item table, delivery history, status-conditional actions, the
  informational "Associated Distributor" card), `delivery-dialog.tsx` (Dispatched/
  Already Delivered/Remaining grid, notes, idempotency key).
- **Field Sales** (`apps/web/src/app/(field)/field/deliveries/`) — `page.tsx` (card list
  defaulting to dispatches still needing action), `[id]/page.tsx` with a co-located
  `FieldDeliverySheet` (full-screen, mirrors `FieldFulfilSheet`'s exact shape) that
  transitions to a second "Add photo" step after a successful delivery, using
  `ImageUploadCard`'s new additive `preferCamera` prop (`capture="environment"`, same
  attribute `MultiImageUploadCard` already uses).
- `FieldBottomNav.tsx` gains a 5th tab ("Deliveries", new inline-SVG `TruckIcon`);
  `navigation-config.ts` gains a "Distribution" entry (new `SendIcon`).
- `field/api.ts`/`field/labels.ts` re-export the new distribution module, same
  convention as the existing sales/retail re-exports.

## 5. Testing

- `dispatch.service.spec.ts` (new, 20 cases): create (happy path, partial quantity,
  over-dispatch pre-check, repository-race-error translation, unknown source location,
  outlet-override-belongs-to-customer validation, unknown/cross-tenant fulfilment);
  `dispatch()`/`markInTransit()` invalid-transition guards; `cancel()` guard (`it.each`
  across eligible statuses, blocked once `PARTIALLY_DELIVERED`/`DELIVERED`/already-
  terminal); `fail()` guard (`it.each` across eligible statuses, rejects from `READY`);
  tenant isolation; `getDispatchAvailability`.
- `delivery.service.spec.ts` (new, 9 cases): rejects an ineligible dispatch status, an
  item not belonging to the dispatch, over-delivery; allows a partial (short) delivery;
  translates `OverDeliveryError`/`DeliveryConflictError`; `setPhoto` (uploads, deletes
  the previous key, `NotFoundException` for an unknown delivery).
- `dispatch.controller.spec.ts` (new, 9 cases): audit fires only on `wasCreated ===
true` for both `create`/`createDelivery`; every lifecycle transition records its own
  audit action; `getDispatchAvailability` delegates correctly.
- `distribution-inventory-independence.spec.ts` (new, 5 cases): the structural guards
  from §2.
- **Deliberate deviation from the test plan, same convention Sprint 4.9 established:**
  no dedicated `dispatch.repository.spec.ts`/`delivery.repository.spec.ts` — no
  atomic-transaction repository in this codebase has one; the guarantee is proven at the
  service level (repository mocked at its public-method boundary) plus live verification.
- **Full suite:** 43 test suites, 465 tests, all passing (100 of them new — 96
  distribution + sales-fulfilment additions, plus 4 pre-existing sales suites re-verified
  unmodified). `tsc --noEmit` clean on both `apps/api` and `apps/web`. `eslint` clean on
  every touched file. Production builds (`nest build`, `next build`) both succeed.

## 6. Live Verification Performed

Against the actual running application (API on :4000, Web on :3000), not just unit
tests:

1. **Admin desktop** — the seeded `DSP-000001` (Mama Nkechi Stores, 500 dispatched, 470
   delivered) listed as "Partially Delivered"; detail view resolved territory to
   "Bodija" (the outlet's, not the customer's "Ibadan North" — the outlet-precedence
   display rule confirmed live) and correctly showed "None on record — this customer
   buys directly" for Associated Distributor.
2. **Full partial→complete delivery** — recorded the remaining 30 units through the
   Admin dialog: status flipped to "Delivered," 500/500, "Record Delivery" no longer
   offered.
3. **Full dispatch lifecycle** — created a fresh dispatch (`DSP-000002`) from a
   different Sales Fulfilment, stepped through Dispatch → In Transit → a full delivery;
   every status transition and every Fulfilled/Already Dispatched/Remaining number
   verified correct at each step.
4. **Associated Distributor informational card** — created `DSP-000003` for Amala Spot
   Restaurant (a customer _with_ a real `DISTRIBUTES_TO` network relationship seeded);
   the card correctly displayed "Adeyemi Distribution Ltd (informational only — never a
   gate on dispatch or delivery)" and the dispatch proceeded normally, unaffected.
5. **Fail flow** — dispatched `DSP-000003`, then failed it with a required reason
   ("Vehicle broke down..."); status flipped to terminal "Failed," notes persisted, no
   further actions offered; the "Confirm Failed" button was correctly disabled until
   notes were entered.
6. **Inventory never double-deducted** — `PRD-000027` stock (230 on hand after the
   seeded fulfilments) was queried directly before and after every dispatch/delivery
   action performed live in this session: unchanged in every case. Network-tab
   inspection during every dispatch/delivery action confirmed zero requests to any
   inventory-stock-shaped endpoint.
7. **Field Sales mobile (360×800, 375×812, 430×900)** — the new "Deliveries" tab
   rendered correctly at every width with no overlap; opened a dispatched shipment,
   recorded a real partial delivery (28 of 30 units, with notes) through the full-screen
   `FieldDeliverySheet`, confirmed the sheet transitioned to the "Add photo" step, and
   confirmed the underlying dispatch flipped to "Partially Delivered" (28/30) after
   closing — cross-verified against the same dispatch on desktop Admin.
8. **No unexpected console errors** — the only console errors observed were 401s from
   two separate access-token-expiry events during a long verification session (expected
   token TTL behaviour, not a defect) and the one 400 from the bug in §7 below, before
   it was fixed.

## 7. Bugs Found and Fixed During This Sprint

- **`DispatchDialog`'s Source Location default was cosmetic only.** The `<Select>`
  displayed the organisation's default location by resolving a fallback
  (`sourceLocationId || defaultLocation?.id`) purely for its `value` prop, but the
  underlying `sourceLocationId` state variable was never updated to match — so
  submitting without manually touching the dropdown sent an empty `sourceLocationId`
  and the server correctly rejected it with `400 { sourceLocationId: ["Source location
is required"] }`. Caught live while creating the second test dispatch through the
  Admin UI. Fixed by resolving the effective value once
  (`resolvedSourceLocationId`) and using that single resolved value consistently for
  the select's display, the disabled-check, and the actual submitted payload.
- **Seed customer/outlet code collision with pre-existing dev data.** The original seed
  plan reused codes `CUS-000010`/`OUT-000008`/`SO-000010` for the new Sprint 5 fixture,
  but the shared dev database already contained real rows at `CUS-000010`/`OUT-000008`
  (artifacts of earlier live-testing sessions, created through the running application
  itself, predating this sprint). The seed script's upsert-by-code logic silently
  no-opped and left the pre-existing "Bodija Supermart — Test Branch" customer/outlet in
  place, so the new Dispatch/Delivery ended up linked to the wrong customer. Fixed by
  renumbering to `CUS-000012`/`OUT-000009`/`SO-000011` (verified free), cleaning up the
  incorrectly-linked rows and reversing their stock deduction directly against the dev
  database, and re-running the seed to produce the correct "Mama Nkechi Stores" fixture.

## 8. Known Limitations

See `docs/domains/distribution.md` §9 for the full list. Highlights: no fleet/route/GPS
tracking; no Sales Returns/Claims Management (free-text notes only, no reason-code enum,
no return-to-stock path); no multi-photo proof of delivery; no delivery e-signature; no
real "Delivery Agent" RBAC role; no Distribution Analytics.

## 9. Deferred / Future Work

Sales Returns/Claims Management workflow; multi-location dispatch per batch; Route
Planning/GPS tracking/live vehicle location; multi-photo proof of delivery; structured
damaged/lost/refused reason codes; delivery e-signature capture; a real "Delivery
Agent"/"Sales Agent" RBAC role; automatic re-dispatch linkage after a `FAILED` dispatch;
Distribution Analytics (on-time rate, shortfall trends). See `docs/backlog.md` Epic 8.

## 10. Documentation Updated

New `docs/domains/distribution.md`, this completion report. Updated:
`docs/domains/README.md`, `docs/backlog.md` (Epic 8), `docs/roadmap.md`,
`docs/changelog.md`.

## 11. Constraint

Nothing in this sprint was committed or pushed, per the explicit instruction carried
through the brief. All changes remain in the working tree, pending explicit instruction
from the user to commit.
