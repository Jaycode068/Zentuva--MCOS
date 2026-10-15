# Stage 4E.4B.1 — Idempotency Final Review and Safe Development Migration: Completion Report

## 1. Transaction-boundary and P2002 recovery assessment

Re-inspected `InventoryStockRepository.adjustStock()` line by line, focused specifically on
whether a `P2002` recovery query could ever run inside an already-aborted PostgreSQL
transaction.

**Finding: no defect.** The stock mutation and `InventoryTransaction.create()` both run
inside `this.prisma.$transaction(async (tx) => {...})` — Prisma's interactive-transaction
API. When the callback throws (here: `tx.inventoryTransaction.create()` hitting the
`organisationId_idempotencyKey` unique constraint under a genuine race), Prisma issues a
`ROLLBACK`, releases that transaction's connection back to the pool, and only _then_
re-throws the original error to the code that called `$transaction()`. The `catch` block
that handles `P2002` sits **outside** that `$transaction()` call, and its recovery query
(`this.prisma.inventoryTransaction.findUnique(...)`) uses `this.prisma` — the top-level
client — never the aborted `tx`. It therefore always runs on a fresh connection, after the
rollback has already completed, never inside the aborted transaction block. (The one other
way this could fail — Postgres returning `ERROR: current transaction is aborted, commands
ignored until end of transaction block` for a later statement on the _same_ connection — is
exactly what a `tx`-scoped query would trigger; this code never does that.)

Two supporting facts close the remaining question of _whether the winner is reliably
visible yet_:

- Postgres serializes concurrent inserts on the same unique key: the losing transaction's
  `INSERT` blocks until the winner's transaction resolves, then only raises `P2002` if the
  winner _committed_ (if the winner rolled back instead, the blocked insert simply
  proceeds). A `P2002` is therefore only ever observable after the winning row has already
  committed — the recovery query cannot race against a not-yet-visible winner.
- `applyStockAdjustmentIfNonNegative` (the only other write in the transaction) uses
  `upsert`/`updateMany`, neither of which can raise `P2002` — confirmed by reading
  `inventory-stock-concurrency.util.ts` directly. The only possible source of a `P2002`
  inside this transaction is the one `create()` call, so the `catch` block's
  `error.code === 'P2002'` check cannot be accidentally triggered by an unrelated
  constraint; and if it ever were, the `if (winner)` guard falls through to re-throwing the
  original error rather than fabricating a result.

Re-ran the two genuine-concurrency integration tests (2-way and 10-way `Promise.all`/
`Promise.allSettled` against real Postgres) fresh in this session — both passed cleanly,
with no "transaction is aborted" errors and exactly one effective stock mutation each time.

Other review points, all confirmed correct by re-reading the code and/or re-running tests:

- **Concurrent retries return the committed original adjustment** — confirmed by the
  passing 2-way/10-way concurrency tests: the loser's `resolveExistingAdjustment` returns
  `wasCreated: false` with the winner's `transaction.id`.
- **Conflicting payloads are rejected consistently** — both the pre-check path and the
  `P2002`-recovery path route through the same private `resolveExistingAdjustment`, so the
  `productId`/`locationId`/`quantity`/`reason` comparison is identical regardless of which
  path detected the reused key. (`notes` is deliberately excluded from this comparison —
  free-text commentary, not part of the operation's identity. This is implicit in the
  existing code; worth stating explicitly if this method is touched again, but not a defect.)
- **A failed adjustment never consumes the key** — `applyStockAdjustmentIfNonNegative` is
  called, and `NegativeStockError` is thrown, _before_ `tx.inventoryTransaction.create()` is
  ever reached in the source order; the whole transaction (including the stock mutation)
  rolls back together, so no row carrying the key is ever committed. Confirmed by both a
  unit test and an integration test ("an insufficient-stock failure leaves the key free for
  a later, valid retry").
- **The uniqueness constraint protects the intended operation** — precisely: the DB
  constraint guarantees at most one _committed_ `InventoryTransaction` row can ever exist
  per `(organisationId, idempotencyKey)`; the application-level
  `resolveExistingAdjustment` check is what additionally guarantees that committed row
  actually matches what the caller intended, rejecting a mismatched reuse rather than
  silently returning or merging. The two layers are complementary, not redundant.
- **Audit records are created only once** — `inventory.controller.ts`'s
  `createAdjustment` route gates its `auditService.record(...)` call behind
  `if (result.wasCreated)`, so a resolved retry never writes a second entry. Confirmed by
  the controller's own unit test.
- **No-key behavior is explicitly documented** — stated in the doc comments on
  `AdjustStockData.idempotencyKey` ("A caller that never sends one is never blocked") and
  `AdjustStockResult.wasCreated` ("Always `true` when no `idempotencyKey` was supplied"),
  and covered by a dedicated unit test ("no idempotencyKey supplied: every call is
  independent, same as before this stage").

**No genuine implementation defect was found anywhere in this review.** No code changes
were made to the repository, service, or controller files in this stage.

## 2. Idempotency contract and limitations

Unchanged from Stage 4E.4B, re-confirmed accurate on re-reading:

- Optional, client-supplied `idempotencyKey` on `CreateInventoryAdjustmentInput`, persisted
  on `InventoryTransaction.idempotencyKey`, scoped
  `@@unique([organisationId, idempotencyKey])`.
- Omitting the key reproduces pre-stage behavior exactly — every call independent.
- A retry with an identical payload returns the original result (`wasCreated: false`, no
  stock mutation, no second audit entry).
- A reused key with a _different_ `productId`/`locationId`/`quantity`/`reason` is rejected
  with `AdjustmentIdempotencyKeyConflictError` → `400 Bad Request`.
- Organisation-scoped: the same key reused by a different organisation is a fully
  independent adjustment.
- **Limitation, unchanged**: the key is optional, not mandatory, matching every sibling
  mutation in this codebase — a caller that doesn't send one gets no protection. Enforcing
  it would be a breaking API change, outside this stage's scope.
- **Limitation, unchanged**: key generation is the caller's responsibility — a client that
  generates a _new_ key on every retry gets no benefit from this protection.

## 3. Test-isolation findings

Re-read `inventory-adjustment-idempotency.integration.spec.ts` in full: every fixture
(product, warehouse location, and — for the one test that needs it — Customer + Outlet +
`CUSTOMER_LOCATION`) is created fresh and disposable, scoped to this file's own ids; every
cleanup (`afterEach`/`afterAll`, plus the one test's own `try/finally`) deletes by specific
id, never a bare filter. This matches the established engagement-wide convention and
required no changes.

**Pre-existing, unrelated gap — re-examined and corrected in this stage's
characterization.** The previous completion report stated this gap was "confirmed to fail
intermittently... independent of timing" between `inventory-transfer.integration.spec.ts`
and `inventory-location-ownership-foundation.integration.spec.ts` (both resolve "the"
single seeded outlet via a bare `findFirst` and create a `CUSTOMER_LOCATION` against it,
which has a real `@@unique(outletId)` constraint). Re-testing this stage shows that
characterization overstated the risk: **19 consecutive fresh runs of those two files
together produced zero failures.** Correlating against the earlier failing runs, those
failures were traced to one specific stale `CUSTOMER_LOCATION` row
(`TEST-PHASE-2A-DISPOSABLE-...`) left behind by an earlier _crashed_ run of
`inventory-location-ownership-foundation.integration.spec.ts`'s own test (which creates
then deletes a `CUSTOMER_LOCATION` inline — a failure between those two lines, or a process
crash, skips the delete). Once that orphan was removed, the deterministic conflict
disappeared.

The accurate characterization: **the latent structural gap is real** — two integration
files assume exclusive ownership of the single seeded outlet's one-and-only
`CUSTOMER_LOCATION` slot, with no reservation between them — but it manifests reliably only
when one file's own cleanup fails to run (crash, an earlier assertion failure, or similar),
not from ordinary parallel-worker timing alone, which this session could not reproduce as a
live race across repeated attempts. Documented here only — neither file was modified.

## 4. Development migration result

**Applied successfully.** Used `pnpm run db:migrate:deploy:guarded` (from `apps/api`) —
the non-interactive `prisma migrate deploy` wrapper, deliberately chosen over the
interactive `migrate dev` variant since it cannot prompt, cannot generate a new migration,
and cannot trigger drift-recovery or a reset; it only applies already-written, pending
migrations in order. The identity guard verified the connection as the designated
development database before anything ran.

```
[db-identity-guard] Identity verified — running `prisma migrate deploy` (non-resetting) against the development database.
Applying migration `20261015070000_inventory_transaction_adjustment_idempotency`
All migrations have been successfully applied.
```

No `db reset`, no `migrate reset`, no volume command, no interactive prompt, at any point.

## 5. Before/after database integrity checks

**Preflight (before migration):**

- Dev identity: database `zentuva`, container `zentuva-dev-postgres-1`, port 5432.
- Test identity: database `zentuva_test`, container `zentuva-dev-test-postgres-test-1`, port 5433.
- Migration status: 65 applied, exactly 1 pending (this stage's).
- Backup checksum: `OK` against `zentuva-dev-20261014-230612.dump.sha256`.
- Restore-verification evidence: the disposable `zentuva-restore-verify` container (still
  running from an earlier stage) holds restored data matching dev's counts exactly
  (1 organisation, 35 `InventoryTransaction` rows) — concrete proof the backup is
  restorable, not just checksum-valid.
- Migration SQL re-read in full: one `ALTER TABLE ... ADD COLUMN "idempotencyKey" TEXT`
  (nullable, no default) and one `CREATE UNIQUE INDEX` — additive only, no destructive
  statement of any kind.
- Git: working tree unchanged from the prior stage — nothing staged or committed.

**After migration:**

- `idempotencyKey` column: present, `TEXT`, nullable — exactly as designed.
- `inventory_transactions_organisationId_idempotencyKey_key` unique index: present.
- `InventoryTransaction` row count: **35 — unchanged.** All 35 existing rows carry
  `idempotencyKey = NULL` (verified by direct count), confirming the additive migration
  altered zero existing data.
- `InventoryStock` row count: **8 — unchanged.** Total `quantityOnHand` across all rows:
  **6700.5 — unchanged.**
- `Organisation` count: **1 — unchanged.**
- Baseline financial/operational counts (captured post-migration, with no application
  writes having occurred at any point in this stage to have moved them):
  `JournalEntry` 35, `JournalEntryLine` 73, total debits = total credits =
  **102,702,768.16** (GL remains balanced), `AccountingPeriod` 3, `Product` 19.
- Backup checksum: re-verified `OK` at the end of this stage.
- Safety copy (`/Users/user/Zentuva--MCOS-SAFE-COPY-20261014-080827`): untouched.

## 6. Application health

**Important live finding, discovered during preflight, not introduced by this stage's
actions:** the development API's `nest start --watch` process had already auto-restarted
(`dist/main`, uptime ~40 minutes at the time of the preflight check) after the _previous_
stage's schema edit and `prisma generate` — meaning the regenerated Prisma Client had
already been loaded into the live process, and it had **already been failing** on any
unrestricted `InventoryTransaction` query. Confirmed directly: `GET
/api/inventory/transactions` returned `500 Internal Server Error` _before_ this stage's
migration was applied, while `GET /api/inventory/locations` (a different table) returned
`200` normally — isolating the failure precisely to the known-pending schema gap, not a
broader outage.

**After the migration — verified without restarting anything:**

- `GET /api/health` → `200`.
- `GET /api/inventory/transactions` → `200`, correct data (the exact request that was
  `500` moments earlier, now fixed by the migration alone).
- `GET /api/inventory/transactions?transactionType=ADJUSTMENT` → `200`, correct data.
- `GET /api/inventory` (stock listing) → `200`, correct data.
- `GET /api/inventory/locations` → `200` (still fine, confirming no new breakage from
  side effects of the migration).

**No restart was necessary or performed.** Prisma does not cache "column missing" at the
client level — the already-running process's very next query against
`InventoryTransaction` succeeded as soon as the column existed in the database. No
development inventory adjustment was created as a smoke test, per instruction — every
verification above was a read-only `GET`.

## 7. Tests executed

- Focused unit tests (`inventory-stock.repository.spec.ts`, `inventory.service.spec.ts`,
  `inventory.controller.spec.ts`): **74/74 passed.**
- Isolated integration tests (`src/inventory/` — all 4 files, against the guarded test
  database): **49/49 passed**, including the 12 idempotency tests and the real-Postgres
  concurrency tests re-run fresh in this stage.
- Type-check (`pnpm run type-check`, full monorepo): clean.
- Lint (`pnpm run lint`, full monorepo): 0 errors; 27 pre-existing warnings, all in
  unrelated `finance/budgeting/*.spec.ts` files, untouched.

## 8. Files changed

**None.** This stage was a review-and-migration stage only — no source file was edited.
The only change to persistent state was the development database migration itself
(Section 4) and this report.

## 9. Remaining risks

1. **The latent structural test-isolation gap** (Section 3) between
   `inventory-transfer.integration.spec.ts` and
   `inventory-location-ownership-foundation.integration.spec.ts` remains unfixed by design
   (out of scope, no refactoring performed). It will resurface as a deterministic failure
   again if either file's own cleanup is ever skipped by a crash or an early failure,
   leaving its `CUSTOMER_LOCATION` orphaned against the one seeded outlet.
2. **`idempotencyKey` remains optional** (Section 2) — unchanged risk profile from Stage
   4E.4B; no enforcement was added or requested.
3. **`notes` is excluded from the conflict-check comparison** (Section 1) — an intentional,
   reasonable design choice (free-text commentary isn't part of an operation's identity),
   but not explicitly called out in the code's own comments. Worth a one-line
   clarification if this method is touched again; not addressed here as it is not a
   defect and doing so would be an unrelated change.
4. **No further dev-side follow-up remains from Stage 4E.4B** — the previously-flagged
   "migration pending" risk is now fully resolved; the dev API is healthy and the schema
   matches the regenerated client.

---

Stage 4E.4B.1 is complete. Stopping here for review, per instruction.
