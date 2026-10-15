# Stage 4E.4B — Inventory Adjustment Idempotency: Completion Report

## 1. Previous vulnerability and its resolution

`InventoryStockRepository.adjustStock()` (the sole write path behind `POST
/api/inventory/adjustments`) had no de-duplication at all: every call — a genuine new
request or an accidental client retry (double-click, network timeout + resend, a load
balancer replaying a request) — created a new `InventoryTransaction` row and applied its
`quantity` delta to `InventoryStock.quantityOnHand` again. Two identical submissions of
"add 50 units, Physical Count" moved stock by 100, not 50, with no way to tell afterwards
that it had happened.

**Resolution**: `InventoryTransaction` gained an optional `idempotencyKey` column, scoped
`@@unique([organisationId, idempotencyKey])`. `adjustStock()` now accepts an optional
`idempotencyKey` and, when present, guarantees a repeated request with the same
organisation+key applies the stock change at most once, returning the original
transaction's result on every retry instead of a second mutation. A caller that omits the
key keeps today's exact behaviour — every call is independent, same as before this stage.

## 2. Idempotency-key contract

- **Field**: `idempotencyKey?: string` — optional, client-supplied, on
  `CreateInventoryAdjustmentInput` (`packages/validation/src/inventory.ts`), threaded
  through `InventoryService.adjustStock()` to `InventoryStockRepository.adjustStock()`.
  Validated as `z.string().trim().min(1).optional()` — the exact convention already used
  for `InventoryTransfer.idempotencyKey`/`SalesFulfilment.idempotencyKey`.
- **Persistence**: on `InventoryTransaction.idempotencyKey`, not a new dedicated table.
  Unlike Goods Receipt / Sales Fulfilment / Transfer, a manual adjustment has no parent
  aggregate of its own — the `InventoryTransaction` ledger row IS the adjustment's own
  record, so it carries the key directly. `NULL` for every other transaction type and for
  any adjustment that didn't supply a key (Postgres unique indexes treat every `NULL` as
  distinct, so omitting the key never blocks anything).
- **Scope**: organisation-scoped (`@@unique([organisationId, idempotencyKey])`) — the same
  key reused by two different organisations is two completely independent adjustments,
  verified by an integration test.
- **Retry semantics**: a retry with the _same_ `productId`/`locationId`/`quantity`/
  `reason` as the original returns that original's result (`wasCreated: false`,
  `transactionId` unchanged, no stock mutation). A retry with the _same key_ but
  _different_ `productId`/`locationId`/`quantity`/`reason` is rejected with a new
  `AdjustmentIdempotencyKeyConflictError` (translated to `400 Bad Request` at the service
  layer) — never silently merged or overwritten.
- **Mandatory or optional for new callers**: left optional, matching every sibling
  mutation in this codebase (transfers, goods receipts, sales fulfilment). Making it
  mandatory would be a breaking API change for existing callers and was outside this
  stage's "smallest compatible changes" instruction; the `createInventoryAdjustmentSchema`
  comment documents the convention for any future caller that wants double-submit
  protection.
- **Failed adjustments never consume the key**: a `NegativeStockError` (or any other
  failure) is thrown _inside_ the same `$transaction` the stock mutation runs in, so
  nothing — including the `InventoryTransaction` row carrying the key — ever commits. The
  identical key is free for an immediate, valid retry. Covered by both a unit test and an
  integration test.

## 3. Concurrency and atomicity design

Two layers, matching the most complete existing precedent in this codebase
(`InventoryStockRepository.recordOpeningStock`'s find-then-create-then-recover-from-P2002
pattern) rather than the weaker pre-check-only pattern `InventoryTransferRepository.create()`
uses:

1. **Pre-check** (`prisma.inventoryTransaction.findUnique` on
   `(organisationId, idempotencyKey)`, before opening a transaction) — resolves the common
   case (a sequential retry after the original already committed) without taking any row
   lock or touching stock at all.
2. **`P2002`-catch-and-recover** (the real safety net) — the stock mutation
   (`applyStockAdjustmentIfNonNegative`, unmodified) and the `InventoryTransaction.create()`
   happen inside one `$transaction`. If two requests with the same key both pass the
   pre-check (neither can see the other's not-yet-committed row — a genuine race, not a
   sequencing bug), exactly one `create()` wins the database's own unique constraint; the
   other's `create()` throws `P2002`, which **aborts that request's whole transaction**,
   rolling back its own stock mutation. The loser then re-queries the now-committed winner
   and returns its result instead of its own failed attempt.

This is explicitly **not** a check-then-write pattern vulnerable to a race — the
pre-check is only an optimisation; the actual safety guarantee is the database's own
unique index plus the transaction rollback, the same mechanism `recordOpeningStock`
already relies on for the same class of claim. Either resolution path re-validates the
reused key's request against the already-committed transaction's recorded values and
throws `AdjustmentIdempotencyKeyConflictError` on any mismatch.

Proven against **real PostgreSQL**, not just mocks, in the new integration test (two and
ten genuinely concurrent `Promise.all`/`Promise.allSettled` requests with the same key:
exactly one `wasCreated: true`, the rest resolve to the same transaction, stock moves
exactly once) — a mock cannot demonstrate this, since its callback runs to completion in
one synchronous tick with nothing able to interleave.

`applyStockAdjustmentIfNonNegative` itself is untouched: existing ownership checks,
negative-stock prevention, location/permission checks (including the Phase 2B
CUSTOMER_LOCATION opening-balance guard in `InventoryService.adjustStock`), and the
moving-average-cost behaviour (adjustments never touch `averageUnitCost`) are all
unaffected — the idempotency logic wraps around the existing primitive, it does not
replace or alter it. No GL journal posting was added anywhere in this stage.

## 4. Migration and compatibility implications

**Migration** `20261015070000_inventory_transaction_adjustment_idempotency`: additive
only — `ALTER TABLE inventory_transactions ADD COLUMN "idempotencyKey" TEXT;` plus
`CREATE UNIQUE INDEX ... ("organisationId", "idempotencyKey")`. No existing row's data
changes; every pre-existing row gets `idempotencyKey = NULL`, which — because Postgres
treats every `NULL` as distinct under a unique index — can never collide with another
existing row or any future `NULL`-keyed row.

**Applied to**: the isolated test database only (`zentuva_test`, via the guarded
`scripts/migrate-test-db.js`), per this stage's explicit "no development database
mutation is authorized" instruction. **Confirmed NOT applied** to the development
database (`zentuva`) via direct query — `idempotencyKey` does not exist on dev's
`inventory_transactions` table.

**⚠️ Outstanding risk requiring separate approval**: `npx prisma generate` was run to
pick up the schema change (a filesystem-only operation, no DB connection), which
regenerates the Prisma Client against the _current_ `schema.prisma` — the client now
expects `idempotencyKey` to exist in whatever database it connects to. Since the
migration was deliberately not applied to dev, **any future restart of the dev API
process will fail on the first query touching `InventoryTransaction`** with a Postgres
"column does not exist" error, until the migration is applied to dev. The
currently-running dev API process is unaffected (Node does not hot-reload
`node_modules`; the old client stays loaded in memory) — verified healthy via
`GET /api/health` → `200` at the end of this stage. **Do not restart the dev API process
before running `pnpm db:migrate` against dev** (the existing interactive, guarded
workflow) — that step was intentionally not run in this stage and needs separate
approval.

## 5. Unit and integration test results

- **Unit** (`inventory-stock.repository.spec.ts`, `inventory.service.spec.ts`,
  `inventory.controller.spec.ts`): 99 tests passed, including 8 new repository-level
  idempotency cases (first call, sequential retry, conflicting quantity, conflicting
  reason, cross-organisation independence, failed-then-valid-retry, no-key-supplied
  baseline, and a simulated true-concurrency P2002 recovery via a forced-pre-check-miss
  harness) and 4 new service/controller-level cases (conflict → `400`, key pass-through,
  `wasCreated` propagation, audit-log suppression on a retry).
- **Integration** (`inventory-adjustment-idempotency.integration.spec.ts`, new, against
  real Postgres in the guarded test database): **12/12 passed** — first adjustment,
  sequential retry (positive and negative deltas), conflicting quantity/reason rejection,
  cross-organisation independence, failed-adjustment-frees-the-key, customer-owned stock
  (ownership/arrangement preserved through an idempotent retry), two genuinely concurrent
  requests (exactly one effective adjustment), ten genuinely concurrent requests (same
  guarantee at higher contention), distinct keys are never deduplicated, and
  `averageUnitCost` is unaffected by an idempotent adjustment or its retry. Repeated 5
  consecutive times with no flakiness.
- **Full inventory suite** (unit + integration): 148/148 passed.
- **Full default suite** (`pnpm --filter @zentuva/api test`): **2612/2612 passed**, 273
  suites — no regressions anywhere else in the codebase.
- **Type-check**: `pnpm run type-check` (full monorepo, including `@zentuva/validation`
  and `@zentuva/api`) — clean.
- **Lint**: `pnpm run lint` (full monorepo) — 0 errors; the 27 pre-existing warnings are
  all in unrelated `finance/budgeting/*.spec.ts` files, untouched by this stage.

### Incidental finding (pre-existing, out of scope, fixed as a side effect)

While stress-testing the new integration test alongside the existing inventory
integration suite, a **pre-existing** cross-file test-isolation gap surfaced:
`inventory-transfer.integration.spec.ts` and `inventory-location-ownership-foundation.
integration.spec.ts` both resolve "the" seeded outlet via a bare `prisma.outlet.findFirst`
and create a `CUSTOMER_LOCATION` against it (a real `@@unique(outletId)` constraint
allows only one), with no isolation between them — confirmed to fail intermittently even
with none of this stage's files involved, purely between those two pre-existing files
when run under real parallel Jest workers. This stage's own new test file was written to
use its own fully disposable Customer + Outlet rather than the shared seeded one, so it
does not participate in that collision. A handful of disposable test-fixture rows left
behind in the **test** database by earlier failed debugging runs (while this pre-existing
race was being diagnosed) were cleaned up directly; nothing in the development database
or the verified backup was touched. The underlying pre-existing gap between those two
other files is unrelated to Stage 4E.4B and was not otherwise modified — worth a follow-up
if it recurs.

## 6. Files changed

- [apps/api/prisma/schema.prisma](apps/api/prisma/schema.prisma) — `InventoryTransaction.idempotencyKey` + `@@unique([organisationId, idempotencyKey])`.
- [apps/api/prisma/migrations/20261015070000_inventory_transaction_adjustment_idempotency/migration.sql](apps/api/prisma/migrations/20261015070000_inventory_transaction_adjustment_idempotency/migration.sql) — new, applied to test DB only.
- [packages/validation/src/inventory.ts](packages/validation/src/inventory.ts) — `createInventoryAdjustmentSchema.idempotencyKey`.
- [apps/api/src/inventory/inventory-stock.repository.ts](apps/api/src/inventory/inventory-stock.repository.ts) — `adjustStock()` rewritten with the idempotency/concurrency logic; new `AdjustmentIdempotencyKeyConflictError`; `AdjustStockData.idempotencyKey`, `AdjustStockResult.wasCreated`; `recordOpeningStock()` now reports `wasCreated: true`.
- [apps/api/src/inventory/inventory.service.ts](apps/api/src/inventory/inventory.service.ts) — `adjustStock()` passes the key through, translates the new conflict error to `BadRequestException`, reports data from the committed transaction (not the input) so a retry reflects the original operation; `StockAdjustmentResult.wasCreated`.
- [apps/api/src/inventory/inventory.controller.ts](apps/api/src/inventory/inventory.controller.ts) — audit-log entry for `POST /api/inventory/adjustments` gated on `wasCreated`, matching `createTransfer`'s existing convention.
- [apps/api/src/inventory/inventory-stock.repository.spec.ts](apps/api/src/inventory/inventory-stock.repository.spec.ts) — 8 new idempotency unit tests; fake-Prisma harness extended with a top-level `inventoryTransaction.findUnique`, P2002 simulation, and transaction-rollback-on-throw semantics.
- [apps/api/src/inventory/inventory.service.spec.ts](apps/api/src/inventory/inventory.service.spec.ts) — 4 new service-level tests; existing `adjustStock`/`recordOpeningStock` mocks updated for `wasCreated`.
- [apps/api/src/inventory/inventory.controller.spec.ts](apps/api/src/inventory/inventory.controller.spec.ts) — 1 new test (no audit entry on a retry); existing mock updated for `wasCreated`.
- [apps/api/src/inventory/inventory-adjustment-idempotency.integration.spec.ts](apps/api/src/inventory/inventory-adjustment-idempotency.integration.spec.ts) — new, 12 real-Postgres tests.

## 7. Database integrity verification

- **Development database** (`zentuva`, port 5432): row counts and balances unchanged —
  `inventoryTransaction` count 35, `inventoryStock` count 8, total `quantityOnHand` across
  all stock rows 6700.5, 1 organisation — matching pre-stage figures. Confirmed the new
  `idempotencyKey` column does **not** exist on dev's schema (migration correctly withheld).
- **Dev API process**: `GET /api/health` → `200`, confirming it is unaffected by the
  schema/client changes made in this stage (still running the pre-stage Prisma Client).
- **Test database** (`zentuva_test`, port 5433): migration applied and verified present;
  used exclusively by the new/updated automated tests; left clean of fixtures after the
  full suite run (verified via direct query — no stray `TEST-`-prefixed organisations,
  customers, outlets, products, or locations remain).
- **Safety copy** (`/Users/user/Zentuva--MCOS-SAFE-COPY-20261014-080827`): untouched.
- **Backup** (`/Users/user/Zentuva--MCOS-backups/zentuva-dev-20261014-230612.dump`):
  checksum re-verified `OK` against its `.sha256` at the end of this stage.
- **Git**: nothing staged or committed — `git status` shows only working-tree
  modifications/untracked files, consistent with this stage's and prior stages' changes.

## 8. Remaining risks

1. **Dev migration still pending** (Section 4) — the single most important follow-up.
   Applying it is low-risk (purely additive) but must go through the separately-approved
   `pnpm db:migrate` workflow, and should happen before the dev API process is next
   restarted for any reason.
2. **`idempotencyKey` is optional, not mandatory** — a caller that doesn't send one gets
   no protection at all, by design (matches every sibling mutation). If a particular
   integration (e.g. a specific frontend flow prone to double-submission) needs
   guaranteed protection, that caller must be updated to always generate and send a key;
   this stage does not enforce that at the API layer.
3. **The incidental pre-existing cross-file test-isolation gap** (Section 5) between
   `inventory-transfer.integration.spec.ts` and
   `inventory-location-ownership-foundation.integration.spec.ts` remains unfixed — it is
   unrelated to this stage's scope and was not modified, but will resurface if those two
   suites' outlet-selection strategy is not eventually scoped more tightly.
4. **Client-side key generation is the caller's responsibility** — this stage explicitly
   does not generate idempotency keys server-side (doing so for every retry would defeat
   the purpose, per the brief). If a future caller generates a _new_ key on every retry
   instead of reusing one, this protection provides no benefit for that caller; that is a
   client-side correctness requirement outside this stage's control.

---

Stage 4E.4B is complete. Stopping here for review, per instruction.
