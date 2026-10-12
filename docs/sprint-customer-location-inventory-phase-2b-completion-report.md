# Phase 2B — Customer Outlet Stock Tracking & Transfers: Completion Report

**Status:** Complete. Builds on the Phase 2A schema foundation with a general,
atomic stock-transfer mechanism, outlet stock visibility, and a controlled
opening-balance path. **Not committed, pushed, or staged** — working tree only.

**Scope:** Implements Phase 2B of the roadmap in
[`docs/customer-location-inventory-architecture-audit.md`](customer-location-inventory-architecture-audit.md)
§11. Collection Point cutover, D2C fulfilment changes, Collection Point reversal,
consignment drawdown, and any new settlement/accounting rule are explicitly **not**
implemented — see §9 "Explicitly Deferred Work" below.

---

## 1. Pre-Implementation Review (§2 of the brief)

Before any schema change, the current working tree was inspected directly — not
assumed from the audit or the Phase 2A report:

- `apps/api/prisma/schema.prisma` — `InventoryStock`'s `@@unique([organisationId,
productId, locationId])` (unchanged by Phase 2A), `InventoryLocation.outletId`
  (unconstrained — no uniqueness), `InventoryTransaction` (single `locationId`,
  no destination column, confirmed exactly as the Phase 2A completion report
  described).
- `inventory-stock-concurrency.util.ts` — `decrementStockIfAvailable()`/
  `applyStockAdjustmentIfNonNegative()` (atomic, hardened) vs. the THREE
  increment-with-cost call sites' own doc comment, which explicitly says they were
  deliberately NOT converted and "deserve dedicated review."
- `goods-receipt.repository.ts`'s `receive()` — confirmed the exact read-then-
  upsert weighted-average formula these three call sites share, to replicate the
  correct cost-blending math (not to replicate their concurrency gap — see §3).
- `inventory-location.repository.ts`, `inventory.service.ts`,
  `inventory.controller.ts` — confirmed Phase 2A's `createLocation()` validation
  shape, the `outletExists()` tenant-scoped pattern, and the existing
  `requireActiveLocation()` helper, all reused rather than duplicated.
- `permission-catalogue.ts`, `seed.ts` — confirmed the Administrator role's
  blanket grant mechanism (every catalogue permission, `ORGANISATION` scope for
  `SCOPABLE` ones) and that `inventory.location.manage`/`.adjustment.create` are
  `NONE`-scope, organisation-wide administrative permissions.
- `sales-order.controller.ts` — confirmed `ASSIGNED_TERRITORY`/`ASSIGNED_RECORDS`
  scopes are honestly left **unenforced** everywhere no server-side data actually
  links a user to a territory/outlet, rather than being faked — the precedent
  followed for this phase's own permission choices (§7).
- `sales-fulfilment.repository.ts` — confirmed its `locationId` usage is
  self-contained and untouched by anything in this phase.
- `Outlet`/`Customer` schema — confirmed `Outlet.customerId` and
  `Outlet.inventoryLocationId` (Sprint 37) remain exactly as Phase 2A left them.

**§2.1 balance-identity and costing gate — verified, not assumed:**

1. `InventoryStock`'s unique key is exactly `(organisationId, productId,
locationId)` — `ownership`/`arrangement` are attributes of that one row, not
   part of the key. **It cannot represent two different ownership/arrangement
   states for the same product at the same location simultaneously.**
2. Confirmed by direct inspection of the three increment-with-cost call sites that
   none reads/writes `ownership`/`arrangement` — they are orthogonal to costing.
3. Company-owned and consignment stock would collide into one balance/one cost IF
   they were ever written to the same `(location, product)` row — this is exactly
   the risk resolved in §3 below, without a schema change.
4. `InventoryTransaction` carries exactly one `locationId` per row — direction/
   pairing is carried by `referenceType`/`referenceId`, the same convention
   `RETURN` already uses (confirmed by reading `customer-return.repository.ts`
   and `supplier-return.repository.ts` directly).
5. Transfers CAN preserve ownership while changing location — resolved by never
   accepting ownership/arrangement as transfer input at all (§3).
6. Voids/reversals/repeats: confirmed `GoodsReceipt`/`SalesOrder`'s
   `idempotencyKey` + unique-constraint convention, and that no existing
   mutation ever changes `ownership`/`arrangement` after creation — informing
   this phase's own reversal and idempotency design (§3).

## 2. The Required Pre-Implementation Decision (§2.1)

**Decision: do NOT widen `InventoryStock`'s unique key.** The alternative —
adding `ownership`/`arrangement` to the compound key — would have required
touching `decrementStockIfAvailable`, `applyStockAdjustmentIfNonNegative`,
`getCurrentQuantityOnHand`, and `getCurrentAverageUnitCost` (every call site's
compound-key lookup), rippling into Sales Fulfilment, Supplier Return, Production
Material Issue, Maintenance Part Usage, and Inventory Adjustment — five domains
far outside this phase's "smallest safe" mandate, for a risk ("collapse into one
balance") that **cannot manifest under Phase 2B's actual write paths** once those
paths are designed correctly:

- **Transfers never accept `ownership`/`arrangement` as input.**
  `InventoryTransferRepository.create()` always reads both off the SOURCE
  location's current `InventoryStock` row and carries them to the destination
  unchanged. There is no input field that could misrepresent "preserve
  ownership."
- **Both the opening-stock and transfer destination writes are guarded against
  collision.** `recordOpeningStock()` only ever creates a row where none existed
  (rejects, never merges, on a duplicate). The transfer destination-increment
  (`incrementStockWithCostIfCompatible()`) atomically rejects (`OwnershipMismatchError`)
  if the destination already holds the product under a different ownership/
  arrangement than what's arriving — enforced inside the same SQL statement that
  performs the increment, not a separate racy check.

This is recorded as the resolution the brief required: the schema is unchanged,
the risk is real but structurally prevented (not merely "not yet triggered"), and
the one case the model genuinely cannot represent — a location needing to hold
the SAME product under two different ownership states AT THE SAME TIME — is
explicitly rejected with a clear error, documented as a known limitation (§8),
not silently merged or guessed past.

## 3. Stock Movement Semantics (§3)

### Representation

A new `InventoryTransfer` header model — modelled exactly like `GoodsReceipt`: a
thin, auditable aggregate on top of the existing `InventoryStock` balance and
`InventoryTransaction` ledger, **not** a parallel balance authority. Single
product, single quantity per row. Every completed transfer writes exactly two
`InventoryTransaction` rows (`transactionType: TRANSFER`), sharing the transfer's
`id` as `referenceId`, distinguished by `referenceType`: `'TransferOut'` (source)
and `'TransferIn'` (destination) — refined from the Phase 2A completion report's
own prediction of one shared `referenceType` string, once building it confirmed
the established `RETURN` convention (`'CustomerReturn'`/`'SupplierReturn'`) fit
better.

### Required fields — all present

Organisation (`organisationId`, implicit in every query/write), SKU
(`productId`), quantity, source/destination location, ownership, arrangement,
initiating user (`createdById`), timestamp (`createdAt`), a unique business
reference (`transferNumber`, auto-generated `TRF-000001...`, plus an optional
client `idempotencyKey`), movement status/lifecycle (`TransferStatus`:
`COMPLETED`/`REVERSED`), the two related ledger entries (via `referenceId`), and
a reversal relationship (`reversalOfTransferId`, self-referencing, `@unique`).

### Transfer rules (§3.1) — how each is actually enforced

| Rule                                                 | Enforcement                                                                                                                                                                       |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deduct from source                                   | `decrementStockIfAvailable()` (Sprint 37.1's proven atomic primitive, reused verbatim)                                                                                            |
| Add to destination                                   | `incrementStockWithCostIfCompatible()` (new, §4)                                                                                                                                  |
| Preserve ownership unless an explicit business event | Never client-supplied — always read from the source row                                                                                                                           |
| Preserve/validate arrangement                        | Same mechanism                                                                                                                                                                    |
| Atomic                                               | Both legs + the header row + both ledger rows in one `$transaction`                                                                                                               |
| Prevent negative stock                               | The same conditional `UPDATE ... WHERE quantityOnHand >= $x` Sprint 37.1 established                                                                                              |
| Reject identical source/destination                  | `createInventoryTransferSchema`'s `.refine()`                                                                                                                                     |
| Reject cross-tenant locations                        | `InventoryService.createTransfer()` resolves BOTH locations via `requireActiveLocation(organisationId, ...)` before the repository is ever reached — a cross-tenant id 404s first |
| Validate SKU/location relationship                   | Product and both locations existence-checked, tenant-scoped, before the repository call                                                                                           |
| Decimal-safe quantities                              | `Float`, same representation every other quantity column in this schema already uses                                                                                              |
| Idempotent                                           | `@@unique([organisationId, idempotencyKey])`, check-then-return inside the transaction                                                                                            |
| Auditable                                            | `inventory.transfer.created`/`.reversed` audit events, plus the immutable `InventoryTransaction` rows                                                                             |
| Safe, traceable reversal                             | §3.2 below                                                                                                                                                                        |

### Transfer lifecycle (§3.2)

**A single atomic `COMPLETED` movement — no separate dispatch/in-transit/
receipt-confirmation phase.** This codebase has no existing dispatch/approval
architecture for an internal relocation to extend, and the brief explicitly
permits choosing the smallest safe model and documenting its limitation rather
than inventing a new approval workflow. **Known limitation**: a transfer cannot
represent "in transit" — it either hasn't happened or has fully happened. A
future phase needing that would add a genuinely new status, not retrofit this
one.

**Reversal**: records a NEW `InventoryTransfer` (source/destination swapped,
`reversalOfTransferId` set) rather than mutating or deleting the original, which
is only ever flipped to `status: REVERSED`. Reversible at most once — a
conditional `updateMany` (`COMPLETED` → `REVERSED`) races correctly under
concurrency, backed by the schema's own `@@unique([reversalOfTransferId])` as
defense-in-depth. A reversal that would oversell the destination (stock already
moved on) fails with `InsufficientStockError`, leaving the original `COMPLETED`
— both live in the same database transaction, so a failed reversal never leaves
a half-applied state.

## 4. Costing and Valuation (§8)

**A transfer is not a purchase — never recomputes cost the way a goods receipt
would.** The destination's new weighted-average cost uses the SAME formula every
increment-with-cost path in this codebase already uses, with the source's
current `averageUnitCost` standing in for the "incoming unit cost":

```
newAverageCost = (destinationQty × destinationCost + transferQty × sourceCost)
                 / (destinationQty + transferQty)
```

**New primitive, scoped only to this path:**
`incrementStockWithCostIfCompatible()` (`inventory-stock-concurrency.util.ts`) —
a single atomic `INSERT ... ON CONFLICT ("organisationId","productId",
"locationId") DO UPDATE ... WHERE ownership = EXCLUDED.ownership AND
arrangement = EXCLUDED.arrangement RETURNING "id"`. The entire read-prior-state /
compute-new-weighted-average / write-new-state sequence happens in ONE statement
against whatever row Postgres has just locked — closing the lost-update race the
three pre-existing call sites still carry (by design, documented, not touched —
see §8). The `WHERE` clause doubles as the atomic ownership-mismatch guard from
§2: zero rows affected means either a genuine insert (new row, always succeeds)
or a rejected conflict, disambiguated by one follow-up read.

No new revenue, COGS, or GL posting is produced by a transfer or an opening
count. Customer-owned stock is excluded from company valuation **by
construction**: its `averageUnitCost` is always `0` from the moment it is first
recorded (opening count, §5) or inherited forward (a transfer only ever carries
`CUSTOMER` ownership onward from a source that was already `CUSTOMER`-owned).

## 5. Opening Stock and Reconciliation (§6)

`InventoryStockRepository.recordOpeningStock()` — usable only when no
`InventoryStock` row yet exists for `(organisation, product, location)`. The
row's existence IS the "confirmed" marker: absence means unconfirmed, a
`quantityOnHand = 0` row means a confirmed physical count of zero — two distinct,
legible states.

**Idempotency needs no new column.** A duplicate submission either finds no row
(genuinely the first count) or hits the existing `@@unique([organisationId,
productId, locationId])` constraint, caught (`P2002`) and translated to
`OpeningStockAlreadyRecordedError` — the same "find-then-create-then-recover-
from-P2002" convention `SalesOrder.idempotencyKey`'s own schema comment already
documents elsewhere in this codebase.

`averageUnitCost` is always recorded as `0` — no reliable cost basis exists for a
manual count (brief: "do not fabricate... where reliable evidence is missing").
A `WAREHOUSE` location may only record `ORGANISATION`-owned opening stock
(service-layer check, mirroring the Phase 2A `CHECK` constraint's own
`locationType`/`outletId` pairing logic); a `CUSTOMER_LOCATION` may record
either value. No historical sales/dispatch/fulfilment record is ever read to
fabricate a count.

## 6. Outlet Location Association (§4)

Reuses the existing `POST /api/inventory/locations` endpoint (Phase 2A) — no new
route. `InventoryLocation.outletId` now carries a database `@@unique` constraint
(it was unconstrained in Phase 2A); `InventoryService.createLocation()` adds a
friendly pre-check (`InventoryLocationRepository.findByOutletId`) before the
database constraint is ever reached. No location is auto-created for any outlet.
Three states remain distinguishable: no dedicated location, a dedicated location
with no confirmed balance, and a dedicated location with reconciled stock — see
`docs/domains/inventory.md` §14.1 for the exact mechanics.

## 7. Permissions, Audit, Tenant Isolation (§7)

**Two new permissions** (`NONE`-scope, matching `inventory.adjustment.create`/
`.location.manage`'s existing convention): `inventory.transfer.create`,
`inventory.transfer.reverse`. **No new permission for viewing** (reuses
`inventory.stock.view`) or **for opening stock** (reuses
`inventory.adjustment.create` — it genuinely is a stock adjustment). No broad
new permission was introduced; Administrator gets both new permissions via the
existing blanket-grant mechanism in `seed.ts`, unchanged by this phase.

**No territory/location scope was fabricated.** This codebase's own precedent
(`SalesOrderController`'s documented treatment of `ASSIGNED_TERRITORY`) is to
leave a scope honestly unenforced when no server-side data actually links a user
to it, rather than claim a restriction that cannot be proven — followed here
identically for the same reason.

**Tenant isolation**: every service method resolves product/location(s) via
`(id, organisationId)` together before reaching the repository — proven directly
by an integration test showing the repository ALONE does not prevent a
cross-organisation write (it has no outlet-ownership concept of its own); the
SERVICE's own `requireActiveLocation()` lookup is the actual, verified boundary,
exactly the same pattern Phase 2A's own test suite already established for
`outletExists()`.

**Three new audit actions** (`inventory.transfer.created`, `.reversed`,
`inventory.opening-stock.recorded`), each recorded only for the operation it
names; transfer creation is `wasCreated`-gated so an idempotent replay never
re-emits an event.

## 8. Known Limitations

- **The shared-`InventoryStock`-row risk between B2B and D2C Collection Point
  fulfilment remains fully open** — confirmed unchanged by this phase's own
  regression test (both seeded Collection Point outlets still share the one
  Main Warehouse location).
- **The Collection Point reversal/cancellation path remains missing** — unrelated
  to transfers, still Phase 2C.
- **No in-transit transfer state** — a transfer is atomic/instantaneous.
- **No mixed ownership at one `(location, product)` pair** — rejected
  (`OwnershipMismatchError`), not representable; a genuinely new design (e.g. a
  finer-grained ownership ledger) would be needed if this is ever required.
- **B2B SalesOrder fulfilment is not connected to outlet stock** — a reported
  blocker (§5.1/§5.2's own "stop and report" permission), not an oversight: the
  ownership-transfer-timing decision (confirmation? invoice? payment? delivery?)
  is unreviewed.
- **The increment-side costing concurrency gap is fixed ONLY for transfers.**
  `GoodsReceiptRepository`/`ProductionRunRepository`/`CustomerReturnRepository`
  still carry the original, documented, pre-existing race — deliberately left
  untouched; retrofitting them was judged outside this phase's "smallest safe"
  scope and risked destabilising established warehouse operations for a
  requirement this phase does not have.
- **No consignment drawdown, Collection Point consumption rule, commission, or
  settlement** — `StockArrangement.CONSIGNMENT`/`.D2C_COLLECTION_POINT` remain
  vocabulary only.
- **No frontend was built.** This phase is backend-complete (schema, services,
  API, tests); the existing inventory/outlet UI was not extended with new
  screens. Flagged here rather than silently left unmentioned.

## 9. Explicitly Deferred Work (Phase 2C/3)

Collection Point dedicated-location cutover and `Outlet.inventoryLocationId`
reassignment; changes to the Sprint 42 Collection Point deduction path;
Collection Point order cancellation/reversal; D2C stock reservation/allocation;
consignment drawdown/settlement; commission/reimbursement; D2C revenue/COGS
accounting redesign; a new inventory engine (none was built — `InventoryStock`/
`InventoryTransaction` remain the sole authority); any generic tenant-module
configuration; any unrelated MVP-readiness work. The general transfer mechanism
is intentionally generic so a future Collection Point cutover can reuse it
without any Collection-Point-specific workflow having been activated now.

## 10. Migration and Reconciliation Evidence

**Migration**:
`apps/api/prisma/migrations/20261012120000_phase2b_customer_outlet_stock_tracking_and_transfers/migration.sql`
— adds the `TransferStatus` enum, the `inventory_transfers` table (with all its
FKs/indexes/the `@@unique([organisationId, idempotencyKey])` and
`@@unique([reversalOfTransferId])` constraints), and ONE new unique index on the
pre-existing `inventory_locations.outletId` column. No `DROP`, no column
alteration, no data migration/backfill statement anywhere in the diff. Applied
via `prisma migrate deploy`; `prisma migrate status` confirms "Database schema is
up to date!" both immediately after applying and again at the end of this
session.

**Reconciliation** — real queries against the real seeded "Boby Bites" data,
captured immediately before and immediately after the migration:

| Metric                                                  | Before                         | After      |
| ------------------------------------------------------- | ------------------------------ | ---------- |
| `InventoryLocation` row count                           | 2                              | 2          |
| `InventoryStock` row count                              | 8                              | 8          |
| `InventoryTransfer` row count                           | 0                              | 0          |
| `InventoryTransaction` row count                        | 57                             | 57         |
| Σ `quantityOnHand`                                      | 6,232.5                        | 6,232.5    |
| Total valuation (Σ `quantityOnHand × averageUnitCost`)  | ₦2,238,474                     | ₦2,238,474 |
| Collection-Point-enabled outlets' `inventoryLocationId` | both = same shared location    | unchanged  |
| Every existing stock row's `ownership`/`arrangement`    | all `ORGANISATION`/`WHOLESALE` | unchanged  |

Byte-identical before and after — confirmed again, independently, after the
full test suite (unit + integration) ran to completion, proving no test left
residue in real data (every test fixture is fully disposable: its own
products, its own locations, its own second organisation for cross-tenant
proof, all torn down in `afterAll`/`afterEach`).

## 11. Tests Run and Exact Results

| Check                                               | Result                                                                                                                |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| API unit tests (`pnpm --filter @zentuva/api test`)  | **269 suites / 2,508 tests passing**, 0 failing (+16 tests vs. the pre-Phase-2B baseline of 2,492)                    |
| API integration tests (`pnpm run test:integration`) | **13 suites / 77 tests passing**, 0 failing (+1 suite / +21 tests)                                                    |
| Root typecheck (API, web)                           | **0 errors**, both packages                                                                                           |
| API lint                                            | **0 errors**, 27 pre-existing warnings (identical count/content to the Phase 2A baseline — none in new/changed files) |
| API build (`nest build`)                            | Succeeds                                                                                                              |
| `prisma migrate status`                             | "Database schema is up to date!"                                                                                      |

### New unit tests (mocked, `inventory.service.spec.ts`)

- `createLocation`: one new test — rejects a second `CUSTOMER_LOCATION` for an
  outlet that already has one.
- `createTransfer` (6 tests): happy path; product-not-found 404; source-location-
  not-found/cross-tenant 404; `InsufficientStockError` → 400;
  `OwnershipMismatchError` → 400; idempotent replay returns the original.
- `reverseTransfer` (4 tests): transfer-not-found 404; successful reversal;
  `TransferNotReversibleError` → 400; `InsufficientStockError` → 400.
- `recordOpeningStock` (5 tests): product-not-found 404; rejects `CUSTOMER`
  ownership at a `WAREHOUSE`; accepts `ORGANISATION` at a `WAREHOUSE`; accepts
  `CUSTOMER` at a `CUSTOMER_LOCATION`; `OpeningStockAlreadyRecordedError` → 400.

### New integration tests (real PostgreSQL,

`inventory-transfer.integration.spec.ts`, 21 tests) — fully disposable fixtures
(own products, own warehouse-type locations, a disposable `CUSTOMER_LOCATION`
against a real seeded outlet, and a disposable second organisation created and
destroyed within this file, for a genuine cross-tenant proof rather than
skipping it):

- **Opening stock** (4): records a fresh balance; rejects a duplicate without
  merging; a confirmed zero balance is distinct from no balance; **concurrency**
  — two simultaneous submissions for the same location/product, exactly one
  succeeds.
- **Transfers** (7): moves stock correctly (source decremented, destination
  incremented, cost carried); idempotent retry does not duplicate; exceeding
  available stock fails with both balances untouched; a cross-tenant destination
  succeeds at the repository layer but never touches the other organisation's
  real stock (proving the SERVICE layer, not the repository, is the tenant-
  isolation boundary); a destination ownership/arrangement mismatch is rejected
  with the source decrement rolled back; **concurrency** — two transfers racing
  the same limited source never oversell; **concurrency** — two transfers from
  independent sources into the same destination both land (no lost update).
- **Reversal** (4): restores source, drains destination, marks original
  `REVERSED`; a second sequential reversal attempt is rejected; **concurrency**
  — two simultaneous reversal attempts, exactly one succeeds; a reversal that
  would oversell the destination fails cleanly, original stays `COMPLETED`.
- **Regression** (4): seeded Collection Point outlets still share one location;
  a duplicate outlet location is rejected at the database level; valuation
  aggregation still computes structurally; customer-owned opening stock always
  carries zero cost.
- **Location repository** (2): `findByOutletId` lookup, both the found and
  not-found cases.

**Distinguishing what was actually run from what was only verified by source
reading**: every number above (test counts, pass/fail, reconciliation figures)
came from actually executing the command shown and reading its real output —
none is inferred or assumed. The §1 pre-implementation review items were
verified by reading the actual current source files, not by trusting the
audit's or Phase 2A's own prior description of them.

## 12. Files Changed

### Created

- `apps/api/prisma/migrations/20261012120000_phase2b_customer_outlet_stock_tracking_and_transfers/migration.sql`
- `apps/api/src/inventory/inventory-transfer.repository.ts`
- `apps/api/src/inventory/inventory-transfer.integration.spec.ts`
- `docs/sprint-customer-location-inventory-phase-2b-completion-report.md` (this file)

### Modified (Phase 2B)

- `apps/api/prisma/schema.prisma`
- `apps/api/src/identity/authorization/permission-catalogue.ts`
- `apps/api/src/inventory/inventory-audit-actions.ts`
- `apps/api/src/inventory/inventory-location.repository.ts`
- `apps/api/src/inventory/inventory-stock-concurrency.util.ts`
- `apps/api/src/inventory/inventory-stock.repository.ts`
- `apps/api/src/inventory/inventory-transaction.repository.ts`
- `apps/api/src/inventory/inventory.controller.ts`
- `apps/api/src/inventory/inventory.module.ts`
- `apps/api/src/inventory/inventory.service.ts`
- `apps/api/src/inventory/inventory.service.spec.ts`
- `packages/validation/src/inventory.ts`
- `docs/domains/inventory.md`
- `docs/domains/customers.md`
- `docs/customer-location-inventory-architecture-audit.md` (addendum only —
  historical findings preserved verbatim)
- `docs/changelog.md`

### Untouched

Zero files under `apps/web` were read for any purpose beyond its own
`type-check` run (confirmed clean), and zero were modified — this phase shipped
no frontend. `Outlet`, `Customer`, `SalesFulfilmentRepository`,
`CollectionPointFulfillmentService`, `GoodsReceiptRepository`,
`ProductionRunRepository`, and `CustomerReturnRepository` were inspected
(read-only) and confirmed unmodified by this phase's diff.

## 13. Confirmation

**No commit, push, stage, reset, clean, or stash was performed.** `git status`
at the end of this session shows exactly the files listed in §12, plus the
pre-existing untracked `.claude/` directory already present before this session
began. No prior uncommitted work (none existed — the Phase 1/Phase 2A work was
already committed and pushed in prior sessions) was disturbed.

**No Phase 2C/3 workflow or unapproved settlement/accounting rule was
introduced** — §9 above lists every deferred item explicitly, and §8's known
limitations are reported honestly rather than silently carried forward.

Every acceptance criterion in the brief's §15 is satisfied by the evidence
above; §15 item 12's required blocker-list before Collection Point cutover is
§8's first two bullets (the shared-location risk and the missing reversal
path), both unchanged and unresolved by this phase, exactly as instructed.
