# Sprint 4.5 Completion Report — Inventory Control & Stock Management

**Date:** 2026-08-15
**Status:** Complete

## 1. Objective

Extend Inventory from "record what came in" (Sprint 4.4/4.4.1) into a foundational
inventory-control layer that Production, Sales, Distribution, and Finance can build on —
while staying strictly MVP-scoped. Two additions: a minimal physical-location model
(every stock balance is now `Organisation + Product + Location`, not just
`Organisation + Product`) and a single controlled write for manual stock corrections
(`ADJUSTMENT`), both following the exact "ledger first, cache second" transactional
discipline `GoodsReceiptRepository.receive` already established. Explicit non-goals (the
brief's own instruction, reaffirmed throughout): no full Warehouse Management System (no
bins/shelves/zones, no barcode/RFID, no transfers between locations), no
reservation/allocation workflow, no `ISSUE` endpoint (no generic "remove stock" button —
`ISSUE` stays reserved for a future Production/Sales domain), no Low Stock/reorder-level
alerting (would require a cross-domain schema change to Product Catalogue), and no
valuation (FIFO/weighted-average/COGS).

## 2. Implementation Summary

### Schema — `InventoryLocation`, `AdjustmentReason`, and three extended models

Migration `20260815100007_add_inventory_locations_and_stock_adjustments`:

- **`InventoryLocation`** (new) — `name`, `status` (`LocationStatus`: `ACTIVE`/
  `INACTIVE`, reusing Supplier/Product's exact enum values), `isDefault` (`Boolean`),
  `createdById`/`updatedById`. No delete — same "retire, never remove" convention as
  every other domain.
- **`InventoryStock`** — `locationId` added; unique constraint changed from
  `(organisationId, productId)` to `(organisationId, productId, locationId)`;
  `quantityReserved` added (`Float @default(0)`) for forward-compatibility with a future
  reservation workflow that isn't implemented this sprint.
- **`InventoryTransaction`** — `locationId`, `adjustmentReason` (`AdjustmentReason?`),
  `notes`, `createdById` added; `referenceId` changed from required to optional (a
  manual adjustment has no other entity to point at, unlike a `GoodsReceipt`-sourced
  `RECEIPT` row).
- **`GoodsReceipt`** — `locationId` added (required — every receipt now records which
  location it landed at).
- **`AdjustmentReason` enum** — `PHYSICAL_COUNT`/`DAMAGE`/`SPOILAGE`/`LOSS`/
  `FOUND_STOCK`/`DATA_CORRECTION`/`OTHER`.

`prisma migrate dev` fails hard in this non-interactive environment whenever a schema
change needs confirmation (here: the `InventoryStock` unique-constraint change) — no
combination of `--create-only` or piped stdin gets past it. Worked around by generating
the raw SQL via `prisma migrate diff --from-schema-datasource ... --to-schema-datamodel
... --script`, hand-placing it into a timestamped migration folder, then running `prisma
migrate deploy` (built for exactly this non-interactive case) followed by `prisma
generate`. Existing `InventoryStock`/`InventoryTransaction`/`GoodsReceipt`/
`GoodsReceiptItem` rows were deleted and their Purchase Orders reset to `PENDING` first
(same "clean dev data before migrating" pattern Sprint 4.4.1 used), so the new `NOT NULL
locationId` columns and the tightened unique constraint applied cleanly.

### `InventoryLocationRepository` — lazy, idempotent default-location creation

`getOrCreateDefault(organisationId, actorUserId)` looks for an existing `isDefault: true`
row and creates "Main Warehouse" only if none exists. Deliberately not hooked into
Identity's organisation-registration flow — that would be a cross-domain write outside
Inventory's own ownership (ADR-002) — so every organisation gets its default location on
first actual need instead: its first Goods Receipt, its first Adjustment, or an
Owner/Administrator's first visit to the Locations tab.

### `InventoryStockRepository.adjustStock` — the one new write path

Mirrors `GoodsReceiptRepository.receive`'s shape: wraps `prisma.$transaction`, reads the
current balance for `(organisationId, productId, locationId)` _inside_ the transaction
(not from a pre-check the caller already did — closing the race between two concurrent
adjustments a stale pre-check couldn't), computes `newQuantity = current + signedDelta`,
throws `NegativeStockError` if that's below zero, then upserts `InventoryStock` and
creates the `InventoryTransaction` `ADJUSTMENT` row together. `InventoryService.
adjustStock` resolves the product (must exist) and location (explicit + must be
`ACTIVE`, or the organisation's default) before delegating to this atomic write, and
translates `NegativeStockError` into a `400` reusing the repository's own message.

### `GoodsReceiptRepository.receive` — threaded `locationId` through, unchanged logic

`ReceiveGoodsData` gained a required `locationId`; every `InventoryStock` upsert and
`InventoryTransaction` insert inside the transaction now includes it, and the unique-key
lookup changed to the three-column `organisationId_productId_locationId` key. No other
behavior changed — outstanding/excess/status calculations are unaffected by locations.
`InventoryService.receiveGoods` resolves the location via `getOrCreateDefault` before
calling `receive` — there is still no location picker on the Goods Receiving form (the
brief's own "without breaking the existing flow" instruction), so this stays a one-line
resolution rather than a new form field.

### `InventoryService` — richer stock summary, location CRUD, `adjustStock`

- `listStock`/`getStockByProduct` now return `location`, `quantityReserved`,
  `quantityAvailable` (computed, `quantityOnHand - quantityReserved`), and
  `lastMovement` (the latest `InventoryTransaction.createdAt` for that product, fetched
  via one `groupBy` for the whole list rather than an N+1 query per row).
  `getStockByProduct` — which predates locations and existing callers expect a single
  balance per product — sums across every location the product has stock at instead of
  returning one row per location.
- `listLocations`/`createLocation`/`updateLocation` — Owner/Administrator-write,
  Member-read; the default location can be renamed but `updateLocation` explicitly
  rejects deactivating it (`400`) — every caller that doesn't specify a location falls
  back to it, so taking it offline would silently strand them.
- `adjustStock` — see above.

### API — three new endpoints, one extended endpoint

`GET/POST /api/inventory/locations`, `PATCH /api/inventory/locations/:id`,
`POST /api/inventory/adjustments` — all declared before the pre-existing `/:productId`
wildcard, same route-ordering discipline every prior Inventory sprint established.
`GET /api/inventory` gained `?productStatus=`/`?locationId=` filters.

### Frontend

- **`StockAdjustmentDialog`** — Product/Location/Adjustment Type (Increase/Decrease)/
  Quantity/Reason/Notes, with a live-computed read-only "New Balance" preview
  (`current + signed delta`) and Save disabled if that preview would go negative —
  mirrors, doesn't replace, the server-side guard.
- **`LocationDialog`** — create/rename/activate/deactivate; the Status field is disabled
  entirely when editing the default location.
- **Locations tab** — name, status, product count, created date, Edit action.
- **Inventory Summary tab** — new Code/Type/UoM/Location/Quantity Available/Last
  Movement columns; Product Status and Location filter dropdowns alongside the existing
  search and Product Type filter.
- **Transactions tab** — a Product filter; once a specific product is selected, a
  Running Balance column appears, computed client-side (reverse the API's newest-first
  order, walk oldest-to-newest accumulating `quantity`, then read each row's balance
  back off in the original display order) — deliberately not a new endpoint, since
  `GET /api/inventory/transactions?productId=` already returns everything needed.

### Seed data

Two locations (`Main Warehouse`, default; `Cold Storage`, empty) looked up by
`(organisationId, name)` rather than upserted by a unique key (no schema-level
uniqueness constraint was added on `name`, so the seed script checks for an existing row
itself before creating one). One example adjustment — a `-5kg` `PHYSICAL_COUNT`
correction on Salt at Main Warehouse — idempotency-checked by matching the exact
`(organisationId, productId, locationId, transactionType, quantity)` tuple, since a
manual adjustment has no natural unique business key the way `goodsReceiptNumber` gives
goods receipts. `seedGoodsReceipts` threads the resolved Main Warehouse id through every
receipt it creates.

## 3. Testing / Verification Performed

- Full quality gate: `tsc --noEmit` (both `apps/api` and `apps/web`), `eslint` (both
  apps, zero warnings after fixing one `react-hooks/exhaustive-deps` warning),
  `pnpm --filter @zentuva/validation run build`, and `prisma validate` all clean.
  207/207 backend unit tests pass (173 pre-existing + 34 new/updated in
  `inventory.service.spec.ts`/`inventory.controller.spec.ts`: aggregated stock-by-product,
  positive/negative-guarded adjustments, product-not-found, location audit-action
  resolution for create/update/deactivate, plus every pre-existing receiving scenario
  re-verified against the now-location-aware repository signatures).
- Live end-to-end browser verification against freshly started dev servers (logged in as
  the seeded Owner):
  1. Inventory Summary tab renders the new Code/Type/UoM/Location/Quantity Available/
     Last Movement columns and all four filters; Salt correctly shows `445` (450
     received − 5 seeded adjustment).
  2. Locations tab lists `Main Warehouse` (Default, Active, 4 products stocked) and
     `Cold Storage` (Active, 0 products); opening Edit on the default location shows the
     Status field disabled with the "cannot be deactivated" message.
  3. Live adjustment: opened `StockAdjustmentDialog`, selected Salt at Main Warehouse
     (current `445`), chose Decrease/10/Spoilage — the New Balance preview live-updated
     to `435` before submission; saved successfully.
  4. Confirmed the result: Inventory Summary's Salt row updated to `435` with a fresh
     Last Movement timestamp; Transactions tab filtered to Salt showed all three ledger
     rows (`Receipt +450 → 450`, `Adjustment -5 → 445`, `Adjustment -10 → 435`) with a
     correctly-computed Running Balance column.
  5. Regression check: Goods Receipts tab still renders all 5 seeded receipts with their
     full delivered/rejected/accepted/discrepancy detail, confirming Sprint 4.4/4.4.1
     behavior is unaffected by the location threading.
- **One bug caught and fixed during this verification pass, before merge**:
  `InventoryModule`'s `providers` array was missing `InventoryLocationRepository`, which
  crashed the entire API at boot (`Nest can't resolve dependencies of InventoryService`)
  the moment its constructor grew a fourth repository parameter — unit tests didn't catch
  this because Jest never exercises the real Nest DI container. Fixed by adding the
  import + provider entry; confirmed via `preview_logs` that the server booted cleanly
  and every `/api/inventory/*` route mapped correctly afterward.

## 4. Known Limitations

See `docs/domains/inventory.md` §11 for the full, current list — summarized:

- No full Warehouse Management System (bins/shelves/zones/barcode/capacity/transfers
  between locations); moving stock between locations today means two separate
  `ADJUSTMENT` calls, not one atomic transfer.
- No reservation/allocation — `quantityReserved` exists in the schema but nothing writes
  to it yet; `quantityAvailable` always equals `quantityOnHand` in practice.
- No `ISSUE` endpoint — deliberately deferred to a future Production/Sales domain.
- No Low Stock/reorder-level alerting — deferred because it needs a Product Catalogue
  schema change, out of this sprint's scope.
- No valuation (FIFO/weighted-average/COGS) — this ledger is a quantity ledger only.
- No dedicated Inventory Count session entity — a physical count is just one
  `ADJUSTMENT` with reason `PHYSICAL_COUNT`.
- Amounts remain `Float`, not `Decimal` — unchanged convention from every prior sprint.

## 5. Deferred / Future Work

Per `docs/roadmap.md` Phase 2, Production is expected to be the next consumer of this
ledger: raw materials will `ISSUE` out of `InventoryStock` (decreasing it, at a specific
location) and finished output will `RECEIPT` back in. A future Inventory/Warehouse sprint
may add transfers-between-locations as a first-class atomic operation instead of the
two-adjustment workaround available today, and a future Sales/Production sprint would be
the natural place to implement `quantityReserved` for real. Low Stock alerting and
Product-level `reorderLevel` remain explicitly deferred pending a Product Catalogue
schema change.
