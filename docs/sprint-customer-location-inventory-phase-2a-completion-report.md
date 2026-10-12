# Phase 2A — Inventory Location & Ownership Foundation: Completion Report

**Status:** Complete. Purely additive schema foundation, verified against real
seeded data in the running dev environment. **Not committed or pushed** —
working tree only.

**Scope:** Implements Phase 2A of the roadmap proposed in
[`docs/customer-location-inventory-architecture-audit.md`](customer-location-inventory-architecture-audit.md)
§11 — the schema vocabulary to express physical location type, stock ownership,
and stock arrangement as three independent dimensions, with zero behavioural
change to any existing warehouse/B2B/D2C flow. Phase 2B (customer outlet stock
tracking) and Phase 2C (Collection Point cutover) are untouched, as instructed.

---

## 1. Pre-Implementation Verification

The audit's central finding — that the seeded Collection Point outlet's
`inventoryLocationId` points at the same "Main Warehouse" location B2B
fulfilment uses — was re-verified directly against the current working tree
before any schema change, via a live read-only query:

```
outletsWithLocation: [
  { outletCode: 'OUT-000011', name: 'Sprint36 Concurrency Outlet', inventoryLocationId: 'cmt962zdo002i7bjpc3ezgqji' },
  { outletCode: 'OUT-000003', name: 'Bodija Supermart — Bodija Branch', inventoryLocationId: 'cmt962zdo002i7bjpc3ezgqji' }
]
```

Both seeded Collection-Point-enabled outlets share the identical
`inventoryLocationId` — the audit's finding is confirmed accurate, unchanged,
and (as instructed) **not addressed by this phase**.

## 2. Required Pre-Implementation Design Decision

The brief required establishing, before any schema change, whether ownership/
arrangement belong on `InventoryStock`, on a finer-grained lot/ledger entity, or
elsewhere — and explicitly warned against putting them on `InventoryStock` if
doing so would let mixed-ownership stock collapse into one balance, create
ambiguous uniqueness, corrupt costing, or make reversals unreliable.

**Decision: `InventoryStock.ownership`/`.arrangement`, at the existing
`(organisation, product, location)` grain — the same grain `averageUnitCost`
already uses.** Reasoning, addressing each of the brief's named risks directly:

- **Collapse into one balance**: a real risk _only_ once two different
  ownership states need to coexist for the same product at the same location
  simultaneously. Phase 2A creates **zero** stock-bearing `CUSTOMER_LOCATION`
  rows — every row that exists post-migration is still exactly the warehouse
  stock that existed before, all uniformly `ORGANISATION`/`WHOLESALE`. The risk
  does not manifest in practice this phase. It is recorded, explicitly, as a
  **Phase 2B/2C design question** (schema comment on `InventoryStock.ownership`,
  and §13.1/§13.7 of the updated `docs/domains/inventory.md`): if mixed
  ownership at one location is ever genuinely needed, that requires a new
  design (e.g. a separate ownership ledger) — not a wider enum on this row —
  and this phase deliberately does not attempt to solve it in advance.
- **Ambiguous uniqueness**: `ownership`/`arrangement` are **not** part of
  `InventoryStock`'s `@@unique([organisationId, productId, locationId])` — the
  existing uniqueness boundary is completely unchanged.
- **Corrupting costing**: the weighted-average formula
  (`(priorQty×priorCost + incomingQty×incomingCost) / newQty`) never reads
  either new column — they are orthogonal metadata, confirmed by inspecting
  every call site (`GoodsReceiptRepository.receive()`,
  `ProductionRunRepository.complete()`, `CustomerReturnRepository.receive()`)
  before writing the migration.
- **Unreliable reversals**: `decrementStockIfAvailable()`/
  `applyStockAdjustmentIfNonNegative()` operate on `quantityOnHand` alone, keyed
  by `(organisationId, productId, locationId)` — neither reads nor needs
  `ownership`/`arrangement` to function correctly.

This is recorded as the authoritative rationale; the audit's own §7 proposal
sketch (which already anticipated this exact design, including flagging the
same collapse-risk boundary) is confirmed, not superseded — see §11 below for
the two refinements made during implementation.

## 3. What Was Implemented

### 3.1 Schema (additive only)

| Change                                        | Type                   | Default        | Notes                                              |
| --------------------------------------------- | ---------------------- | -------------- | -------------------------------------------------- |
| `LocationType` enum                           | new                    | —              | `WAREHOUSE`, `CUSTOMER_LOCATION`                   |
| `StockOwnership` enum                         | new                    | —              | `ORGANISATION`, `CUSTOMER`                         |
| `StockArrangement` enum                       | new                    | —              | `WHOLESALE`, `CONSIGNMENT`, `D2C_COLLECTION_POINT` |
| `InventoryTransactionType.TRANSFER`           | new enum value         | —              | Vocabulary only — nothing writes it                |
| `InventoryLocation.locationType`              | new column             | `WAREHOUSE`    | NOT NULL                                           |
| `InventoryLocation.outletId`                  | new column             | `NULL`         | Nullable FK → `Outlet`, `onDelete: SetNull`        |
| `InventoryStock.ownership`                    | new column             | `ORGANISATION` | NOT NULL                                           |
| `InventoryStock.arrangement`                  | new column             | `WHOLESALE`    | NOT NULL                                           |
| `inventory_locations_type_outlet_consistency` | new `CHECK` constraint | —              | `WAREHOUSE ⟺ outletId IS NULL`                     |
| `inventory_locations_outletId_fkey`           | new FK                 | —              | `ON DELETE SET NULL`                               |
| `inventory_locations_outletId_idx`            | new index              | —              |                                                    |

No existing column was altered, renamed, or dropped. No existing row's
`quantityOnHand`/`averageUnitCost`/`locationId`/`organisationId` changed.

### 3.2 Relation disambiguation (Prisma-level only, zero DB/column impact)

Adding `InventoryLocation.outletId` created a _second_ relation between
`Outlet` and `InventoryLocation` (the existing Sprint 37
`Outlet.inventoryLocationId` bridge is the first). Both relations were given
explicit Prisma relation names (`"CollectionPointSourceLocation"` for the
existing one, `"InventoryLocationOutlet"` for the new one) to disambiguate —
this is a Prisma-Client-level naming construct only; it generates no SQL and
changes no existing column, constraint, or query behaviour.

### 3.3 Application layer (minimal, additive, no new endpoint)

- `InventoryLocationRepository.outletExists(organisationId, outletId)` — a new,
  narrow, tenant-scoped read. Reads `Outlet` directly via `PrismaService` rather
  than importing `OutletModule`, avoiding what would otherwise be this
  codebase's first circular module dependency (`OutletModule` already imports
  `InventoryModule`).
- `InventoryService.createLocation()` — widened to accept optional
  `locationType`/`outletId` on the **existing** `POST /api/inventory/locations`
  endpoint (no new route). Validates the mutual-exclusion rule and, when
  `outletId` is supplied, its tenant-scoped existence — both as UX-only
  fast-fail pre-checks; the database `CHECK`/`FOREIGN KEY` constraints remain
  the true authority.
- `InventoryService.updateLocation()` — **deliberately unchanged**. Neither
  field is accepted on `PATCH`, by design (§4 below).
- `InventoryLocationSummary`/`listLocations()`/`updateLocation()`'s response
  mapping — widened to surface `locationType`/`outletId` on reads, since
  accepting them on write without ever returning them would be incomplete, not
  minimal.
- `InventoryController.createLocation()` — the existing `LOCATION_CREATED`
  audit event's metadata now includes `locationType`/`outletId`. **No new audit
  action was added** — per the brief's own instruction not to invent audit
  events for operations that don't yet exist, and this is not a new operation,
  only richer metadata on an existing one.

`packages/validation/src/inventory.ts` — `createInventoryLocationSchema`
widened with the same optional pair and the same mutual-exclusion `.refine()`,
mirrored from the database rule. `updateInventoryLocationSchema` is
**unchanged**.

### 3.4 What was deliberately NOT built (confirmed by the diff itself)

No new controller route. No new permission (the existing
`inventory.location.manage` already gates the widened endpoint). No change to
`SalesFulfilmentService`, `CollectionPointFulfillmentService`,
`CustomerReturnRepository`, `GoodsReceiptRepository`, `ProductionRunRepository`,
or `InventoryValuationService` — all five were inspected and confirmed to need
no change, and none was made. No frontend/`apps/web` file was touched at all.

## 4. Why `locationType`/`outletId` Are Immutable After Creation

Both the Zod schema and the service layer deliberately exclude these two
fields from `PATCH /api/inventory/locations/:id`. A location that already holds
stock (which, per this phase's own exclusion, no new `CUSTOMER_LOCATION` will
until Phase 2B) could otherwise have its type silently changed after the fact —
retroactively reclassifying already-counted warehouse stock as "customer
location" stock, or vice versa, with no corresponding physical event. The
brief's own final instruction — "if a schema decision risks changing stock
ownership... stop and explain the risk rather than guessing" — applies directly
here; immutability-at-creation is the safe resolution, not a guess.

## 5. Migration

**File:**
`apps/api/prisma/migrations/20261012090000_phase2a_inventory_location_ownership_foundation/migration.sql`

Applied via `prisma migrate deploy` against the real local development database
(the same one every other migration this session has used — confirmed by
inspecting `.env`'s `DATABASE_URL` before running). `prisma migrate status`
reports "Database schema is up to date!" afterward.

### Pre/post reconciliation (real queries, real seeded "Boby Bites" data)

| Metric                                                         | Before                             | After                                                                                            |
| -------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------ |
| `InventoryLocation` row count                                  | 2                                  | 2                                                                                                |
| `InventoryStock` row count                                     | 8                                  | 8                                                                                                |
| Σ `quantityOnHand`                                             | 6,232.5                            | 6,232.5                                                                                          |
| Σ `quantityReserved`                                           | 0                                  | 0                                                                                                |
| Total valuation (Σ `quantityOnHand × averageUnitCost`)         | ₦2,238,474                         | ₦2,238,474                                                                                       |
| `InventoryTransaction` row count                               | 57                                 | 57                                                                                               |
| Collection-Point-enabled outlets' `inventoryLocationId` values | both = `cmt962zdo002i7bjpc3ezgqji` | both = `cmt962zdo002i7bjpc3ezgqji` (unchanged)                                                   |
| New-field defaults on existing rows                            | —                                  | `locationType`: 2/2 `WAREHOUSE`; `ownership`: 8/8 `ORGANISATION`; `arrangement`: 8/8 `WHOLESALE` |
| `CUSTOMER_LOCATION` rows created                               | —                                  | 0 (outside disposable test fixtures, created and deleted within the same test)                   |

Every figure above was captured by direct Prisma queries against the real
database immediately before and immediately after `prisma migrate deploy`, not
inferred. The `CHECK` constraint was independently verified (and the one
disposable test row immediately deleted) before any application code was
written, confirming both failure cases (`WAREHOUSE`+`outletId`,
`CUSTOMER_LOCATION`+no `outletId`) are genuinely rejected by the database, and
the valid case genuinely succeeds.

## 6. Tests

All commands below were actually executed this session.

| Check                                                                                             | Result                                                                                                            |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| API unit tests (`pnpm --filter @zentuva/api test`)                                                | **269 suites / 2,492 tests passing**, 0 failing (+5 new tests vs. the pre-Phase-2A baseline of 2,487)             |
| API integration tests (`pnpm exec jest --config jest.integration.config.js --runInBand`)          | **12 suites / 56 tests passing**, 0 failing (+1 suite / +8 tests — the new Phase 2A migration-verification suite) |
| Root typecheck (`pnpm --filter @zentuva/api type-check`, `pnpm --filter @zentuva/web type-check`) | **0 errors**, both packages                                                                                       |
| API lint (`pnpm --filter @zentuva/api lint`)                                                      | **0 errors**, 27 pre-existing warnings (unchanged from before this phase, none in new/changed files)              |
| API build (`pnpm --filter @zentuva/api build`)                                                    | Succeeds                                                                                                          |
| Web typecheck                                                                                     | Succeeds — confirms zero `apps/web` files were touched, as required                                               |
| `prisma migrate status`                                                                           | "Database schema is up to date!"                                                                                  |

### New test files/coverage

- `apps/api/src/inventory/inventory.service.spec.ts` — new `describe('createLocation', ...)`
  block (5 tests, mocked): backward-compatible creation (no new fields supplied,
  behaviour unchanged); valid `CUSTOMER_LOCATION`+`outletId` creation; rejection
  of `CUSTOMER_LOCATION` with no `outletId`; rejection of `WAREHOUSE` with an
  `outletId`; rejection of a nonexistent/cross-tenant `outletId` via
  `outletExists()`.
- `apps/api/src/inventory/inventory-location-ownership-foundation.integration.spec.ts`
  (new, real PostgreSQL, 8 tests): every existing `InventoryLocation`/
  `InventoryStock` row defaulted correctly; Collection Point
  `inventoryLocationId` assignments unchanged; valuation computation unaffected;
  the database `CHECK` constraint genuinely rejects both invalid combinations;
  a valid combination succeeds with zero `JournalEntry`/`InventoryStock`
  side effects and is cleanly reversible; an explicit demonstration that the
  raw FK alone does **not** enforce tenant isolation (documenting why the
  service-layer `outletExists()` check, not the FK, is the real tenant guard).
- `apps/api/src/production/production-order.service.spec.ts` — one pre-existing
  test fixture (`location`) updated to include the two new required fields
  (`locationType`/`outletId`), required only because the fixture is typed
  against the widened Prisma `InventoryLocation` type — no behavioural change
  to the test itself.

### What was deliberately NOT tested (per the brief's own instruction)

No test claims to verify transfer execution, Collection Point cutover, or
reversal workflows — none of those exist yet. The `TRANSFER` enum value is
confirmed present in the schema (implicitly, by the migration applying
successfully) but no test exercises writing a `TRANSFER` row, since no code
path does so.

## 7. No Unintended Accounting Entries

Confirmed, not assumed: the integration test suite's "zero GL/stock side
effects" test explicitly counts `JournalEntry` and `InventoryStock` rows
immediately before and after creating a disposable `CUSTOMER_LOCATION`,
asserting both counts are unchanged. Separately, every one of the five existing
write paths that post journal entries or mutate `InventoryStock`
(`GoodsReceiptRepository`, `ProductionRunRepository`,
`SalesFulfilmentRepository`, `CustomerReturnRepository`,
`InventoryStockRepository.adjustStock`) was inspected and confirmed unmodified
by this phase's diff.

## 8. Known Limitations and Deferred Work (explicit, per the brief's own list)

Not implemented this phase, by design:

- Customer outlet stock dispatch/receipt workflows.
- Operational inventory transfers (the `TRANSFER` enum value is reserved
  vocabulary only).
- Customer outlet inventory dashboards or any new UI.
- Collection Point dedicated-location creation against real data, or any
  cutover of `Outlet.inventoryLocationId`.
- Collection Point cancellation/reversal paths.
- Stock reservation or allocation (`InventoryStock.quantityReserved` remains
  unwritten, unchanged from before this phase).
- Consignment operations or drawdown.
- Customer return/damage/loss/reconciliation workflows at outlet locations.
- Commission, settlement, reimbursement, or any new accounting rule.
- D2C revenue/COGS accounting fixes.
- The increment-side weighted-average-cost concurrency gap
  (`GoodsReceiptRepository`/`ProductionRunRepository`/`CustomerReturnRepository`)
  — evaluated explicitly (§2 above, `docs/domains/inventory.md` §13.7) and
  confirmed **not** a Phase 2A prerequisite, since no location exists yet where
  its consequences could manifest differently than they already do today. It
  remains open and is flagged for re-evaluation at the start of Phase 2B, once
  `CUSTOMER_LOCATION` rows begin accumulating real, cost-bearing stock via a
  future transfer mechanism.

Both findings the audit flagged as the most material — the shared-stock risk
between B2B and Collection Point fulfilment, and the missing Collection Point
reversal path — remain **fully open and unaddressed**, exactly as instructed.
Neither was touched, and both are explicitly re-confirmed, not silently
carried forward, in this report and in `docs/domains/inventory.md` §13.6.

## 9. Documentation

- `docs/domains/inventory.md` — new §13 "Customer-Location Inventory Foundation
  (Phase 2A)" with eight subsections covering the three-dimension model, the
  new `outletId` bridge, warehouse-compatibility evidence, why no historical
  backfill was attempted, the transfer foundation's required future semantics,
  the two remaining open risks, the costing-concurrency assessment, and the
  Phase 3 boundary. Small inline additions to §2's existing `InventoryLocation`/
  `InventoryStock` field lists and §11's "no transfers" limitation bullet.
- `docs/customer-location-inventory-architecture-audit.md` — a short header
  addendum recording the two verified design refinements made during
  implementation (`outletId` not `customerId`; `StockOwnership` simplified to
  two values) and a "✅ Implemented" marker on the Phase 2A roadmap section.
  **No original finding, risk, or recommendation in the document was rewritten
  or removed.**
- `docs/changelog.md` — new entry, matching this session's established
  convention.
- This completion report.

## 10. Files Changed

### Created

- `apps/api/prisma/migrations/20261012090000_phase2a_inventory_location_ownership_foundation/migration.sql`
- `apps/api/src/inventory/inventory-location-ownership-foundation.integration.spec.ts`
- `docs/sprint-customer-location-inventory-phase-2a-completion-report.md` (this file)

### Modified (Phase 2A)

- `apps/api/prisma/schema.prisma`
- `apps/api/src/inventory/inventory-location.repository.ts`
- `apps/api/src/inventory/inventory.controller.ts`
- `apps/api/src/inventory/inventory.service.ts`
- `apps/api/src/inventory/inventory.service.spec.ts`
- `apps/api/src/production/production-order.service.spec.ts` (test-fixture
  compatibility fix only — no production code in `production/` was changed)
- `packages/validation/src/inventory.ts`
- `docs/domains/inventory.md`
- `docs/customer-location-inventory-architecture-audit.md` (addendum only)
- `docs/changelog.md`

### Pre-existing, unrelated changes preserved untouched

Every file modified by Sprint 45/46, Customer Account Phase 1, the Phase 1
documentation closure, and the Phase 2 audit itself remains exactly as it was
at the start of this session — confirmed by `git status` showing no entry
outside the list above (beyond the pre-existing untracked `.claude/`
directory) was added or altered by this phase's work.

## 11. Confirmation

**No commit or push was performed.** No file was staged. No reset, clean,
stash, or discard operation was run at any point. `git status` at the end of
this session shows exactly the files listed in §10 above, plus every
pre-existing uncommitted change from prior sessions, untouched.

**No Phase 2B or Phase 2C behaviour was implemented**: no transfer executes, no
customer-outlet stock is tracked against real data, no Collection Point was
re-pointed to a dedicated location, and no reversal/cancellation path exists.
Every acceptance criterion in the brief's §9 is satisfied by the evidence in
this report.
