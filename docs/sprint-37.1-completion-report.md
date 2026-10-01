# Sprint 37.1 Completion Report — Inventory Fulfillment Concurrency Integrity Hardening

## 1. Confirmed Defect

Sprint 37's own live verification (`docs/domains/d2c.md` §78) empirically reproduced a
lost-update race in `SalesFulfilmentRepository.create()`: two concurrent D2C
`SalesOrder`s (15 units each) against 23 units on hand both reported success and were
both marked fully `FULFILLED` (30 units recorded as fulfilled), while
`InventoryStock.quantityOnHand` only ever dropped to 8 — one decrement silently
overwrote the other's already-committed decrement. This is a real data-integrity
defect, not a theoretical one: it was reproduced against the real dev PostgreSQL
database via genuinely concurrent HTTP requests, not a mock.

## 2. Root Cause

`SalesFulfilmentRepository.create()`'s per-item stock mutation was a classic
read-modify-write: `tx.inventoryStock.findUnique(...)` to read `quantityOnHand`,
`newQuantity = currentQuantity - item.quantity` computed in application code, then
`tx.inventoryStock.upsert({ update: { quantityOnHand: newQuantity } })` writing that
precomputed absolute value back. Under Postgres's default READ COMMITTED isolation,
two concurrent transactions can both read the same starting quantity before either
commits; whichever commits second overwrites the first's decrement with its own
independently-computed "new" value, silently discarding the first transaction's
already-applied consumption.

## 3. Architecture Audit (Performed Before Any Code Change)

Read end-to-end before writing a single line: `SalesFulfilmentRepository.create()`,
`SalesFulfilmentService.fulfil()`, the `InventoryStock` schema, every other Inventory
repository, and the full `SalesOrder` fulfilment flow's interaction with COGS/
accounting. Then searched the entire codebase for every `InventoryStock` mutation —
8 files touch it outside read-only reporting. All 8 were read and classified (see §4).

## 4. Other Vulnerable Patterns Investigated

| Call site                                                | Shape                                                                                                                 | Classification                                                                             | Action                              |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------- |
| `SalesFulfilmentRepository.create()` (Sales)             | Decrement + insufficient-stock guard, no cost recompute                                                               | Confirmed, same defect as the primary                                                      | **Fixed**                           |
| `SupplierReturnRepository` (Inventory)                   | Decrement + insufficient-stock guard, no cost recompute                                                               | Confirmed, identical shape                                                                 | **Fixed**                           |
| `ProductionMaterialIssueRepository.issue()` (Production) | Decrement + insufficient-stock guard, no cost recompute                                                               | Confirmed, identical shape                                                                 | **Fixed**                           |
| `MaintenancePartUsageRepository.issue()` (Maintenance)   | Decrement + insufficient-stock guard, no cost recompute                                                               | Confirmed, identical shape                                                                 | **Fixed**                           |
| `InventoryStockRepository.adjustStock()` (Inventory)     | Bidirectional delta + non-negative guard, no cost recompute                                                           | Confirmed, same guard technique applies both directions                                    | **Fixed**                           |
| `CustomerReturnRepository` (Sales)                       | Increment + moving-weighted-average cost recompute (`newAvgCost = f(priorQty, priorCost, incomingQty, incomingCost)`) | Confirmed to share the "read outside the write" structure, but a genuinely different shape | **Documented, not fixed** — see §14 |
| `GoodsReceiptRepository.receive()` (Inventory)           | Same increment+weighted-average shape                                                                                 | Same as above                                                                              | **Documented, not fixed**           |
| `ProductionRunRepository.complete()` (Production)        | Same increment+weighted-average shape                                                                                 | Same as above                                                                              | **Documented, not fixed**           |

Not every occurrence was assumed vulnerable — each was individually read and its
mutation shape confirmed before classification, per this sprint's own instruction.

## 5. Fix Implemented

A new file, `apps/api/src/inventory/inventory-stock-concurrency.util.ts`, exports:

- `decrementStockIfAvailable(tx, ref, quantity): Promise<boolean>` — a single
  conditional `updateMany({ where: { ..., quantityOnHand: { gte: quantity } }, data: {
quantityOnHand: { decrement: quantity } } })`. Returns `true` only if the decrement
  was actually applied.
- `applyStockAdjustmentIfNonNegative(tx, ref, delta): Promise<boolean>` — the same
  guard for a signed delta (positive always safe via `upsert`; negative guarded
  identically to the decrement above).
- `getCurrentQuantityOnHand`/`getCurrentAverageUnitCost` — plain, explicitly
  non-authoritative reads used only to build a helpful error message or to cost a
  fulfilment, never to decide whether a mutation may proceed.

This is a plain, transaction-scoped utility function taking `tx: Prisma.TransactionClient`
directly — not an `@Injectable()` service — the exact shape
`postSystemJournalEntry(tx, ...)` (Finance) already establishes for a cross-domain
primitive that must participate in the CALLER's own transaction. Each of the five
converted call sites keeps its own local, pre-existing error class
(`InsufficientStockError` is deliberately three separate classes in Sales/Production/
Maintenance, `InsufficientReturnableStockError` in Supplier Return,
`NegativeStockError` in Inventory Adjustment) and its own error message — only the
underlying atomic SQL pattern is shared. No new dependency-injected service was
introduced; no domain boundary was crossed that wasn't already crossed before (the
ADR-002 exception these five files already had for writing `InventoryStock` directly is
unchanged — the actual write now happens inside a shared, Inventory-domain-owned
utility function called FROM each of them, not a new cross-domain service call).

## 6. Transaction Semantics Preserved

The atomic decrement/adjustment remains one statement inside each call site's existing
`$transaction` — never a standalone operation with its own transaction. A later item's
failure in a multi-item loop still throws inside the same transaction Prisma already
wraps the whole operation in, so Postgres's own COMMIT/ROLLBACK semantics are unchanged
and untouched by this fix. Verified directly: the new
`inventory-stock-concurrency.integration.spec.ts`'s "Test F" seeds two products, applies
one successful real decrement, then a second that fails inside the SAME `$transaction`,
and confirms the first product's decrement was rolled back along with everything else —
proving actual Postgres transaction atomicity across multiple sequential statements
inside one transaction, which no mock can prove either way.

## 7. Weighted-Average Costing Preserved

`averageUnitCost` is read via `getCurrentAverageUnitCost`, a plain `findUnique` entirely
separate from the atomic quantity decrement — exactly as before, at the moment of
consumption, per Sprint 10's own documented moving-weighted-average behaviour (this
comment is preserved verbatim at every call site). This read does not race against the
guarded write: no issue/decrement path anywhere in this codebase ever WRITES
`averageUnitCost` (only the three increment-with-cost-recompute paths this sprint
deliberately did not touch write it — see §14), so there is no write-write race on this
field during a decrement, only the same pre-existing, accepted, documented read-timing
variance in which exact moving-average snapshot a given fulfilment/issue is costed at.
Live-verified: the successful order in the re-run 23-vs-15+15 scenario (§11) posted a
journal entry (`JE-000053`, `POSTED`, `DR COGS 6390 / CR Finished Goods Inventory 6390`,
`unitCost: 426 × 15 = 6390`) — costing arithmetic byte-identical to before this fix.

## 8. Multi-Item Behaviour Preserved

`SalesFulfilmentRepository.create()`'s per-item loop is otherwise unchanged — it still
iterates every item, still reads cost before the guarded decrement, still throws
`InsufficientStockError` (unchanged message format) the moment any single item's
decrement fails, and that throw still propagates out of the same `$transaction`
callback it always did, rolling back every earlier item's already-applied decrement in
the same operation (§6). No partial inventory consumption is possible — verified by the
same "Test F" integration test.

## 9. Concurrency Strategy — Automated Real-PostgreSQL Tests

Per this sprint's own explicit instruction not to rely only on mocked unit tests, a new
integration test suite,
`apps/api/src/inventory/inventory-stock-concurrency.integration.spec.ts`, connects
directly to the real dev PostgreSQL database (the same one the running application
uses) via `PrismaClient`, creates a disposable `Product`/`InventoryLocation` pair in
`beforeAll`, and destroys them in `afterAll` — never touching real seeded/demo data.
Deliberately excluded from the default `pnpm test` run (`jest.config.js`'s new
`testPathIgnorePatterns`, since every other spec in this codebase is fully mocked and
needs no database) and run instead via a new `pnpm run test:integration` script
(`jest.integration.config.js`). All 7 tests pass against the real database:

| Test       | Scenario                                         | Result                                                        |
| ---------- | ------------------------------------------------ | ------------------------------------------------------------- |
| A          | 23 in stock, two concurrent 15-unit decrements   | Exactly 1 succeeds, exactly 1 fails, final quantity 8         |
| B          | 30 in stock, two concurrent 15-unit decrements   | Both succeed, final quantity 0                                |
| C          | 30 in stock, three concurrent 15-unit decrements | Exactly 2 succeed, exactly 1 fails, final quantity 0          |
| D          | 10 in stock, one 15-unit decrement               | Fails cleanly, stock unchanged                                |
| Stress     | 100 in stock, ten concurrent 15-unit decrements  | Exactly 6 succeed, 4 fail, final quantity 10                  |
| Adjustment | 100 in stock, five concurrent -30 adjustments    | Exactly 3 succeed, final quantity 10, never negative          |
| F          | Multi-item transaction, second item insufficient | First item's decrement rolled back with the whole transaction |

Every test enforces the core invariant (§18 below): `initial = remaining + successfully
consumed`, and `remaining >= 0`, always.

Additionally, `inventory-stock.repository.spec.ts` (new) adds mocked, real-transaction-
callback-level tests for `adjustStock` specifically (the fifth converted call site,
previously covered only by a service-level mock), matching the depth the other four
converted repositories already had before this sprint. The four pre-existing
"deliberate exception" repository spec files (`sales-fulfilment.repository.spec.ts`,
`supplier-return.repository.spec.ts`, `production-material-issue.repository.spec.ts`,
`maintenance-part-usage.repository.spec.ts`) had their in-memory fake `tx.inventoryStock`
mocks updated from `upsert` to `updateMany`, mirroring the real atomic-conditional
semantics — all pre-existing behavioural assertions in these files pass unmodified.

## 10. Real Database Verification — the Original Scenario, Re-Run

After the fix, stock for the same product used in Sprint 37's original demonstration
was topped up to exactly 23 again, and two fresh D2C orders (15 units each, real
conversation → payment → webhook → auto-assignment → Preparing → Ready flow) were fired
at `confirm-collection` truly concurrently:

- **HTTP responses**: one `201 COLLECTED`, one `400 Insufficient stock for product ...
(available: 8, requested: 15)`.
- **SalesOrder statuses**: the winner reached `FULFILLED` (`quantityFulfilled: 15`); the
  loser remained `CONFIRMED` (`quantityFulfilled: 0`) — completely untouched.
- **CollectionPointFulfillment status**: the winner reached `COLLECTED`; the loser
  correctly reverted to `READY_FOR_COLLECTION` (Sprint 37's own Bug 1 fix, §12 of
  `docs/sprint-37-completion-report.md`) — retryable, never stranded.
- **Inventory**: `23 → 8`, exactly one decrement, matching the winning order's 15 units
  exactly.
- **Retry**: after restocking (+10 → 18), the previously-rejected order was retried and
  succeeded cleanly (`18 → 3`, `COLLECTED`, `FULFILLED`).

No lost update, no duplicate inventory transaction, no inconsistent fulfillment state —
the exact failure mode from Sprint 37 no longer reproduces.

## 11. Stress Test

Covered by the integration suite's "Stress" test (§9): 100 units on hand, 10 genuinely
concurrent 15-unit decrements. Result: exactly 6 succeed, 4 fail, final quantity 10 —
`6 × 15 + 10 = 100`, the invariant holds exactly. Not repeated multiple times as a
statistical sample (a single genuinely-concurrent run against a real database with a
deterministic atomic guard is sufficient to prove the mechanism — the guard is a
database-level `WHERE` clause, not a probabilistic race that needs repeated sampling to
trust).

## 12. Accounting / COGS Verification

Verified live (§10): the successful order in the re-run scenario posted
`JE-000053` (`POSTED`, `DR COGS 6390 / CR Finished Goods Inventory 6390`), with
`unitCost: 426` and `costAmount: 6390` for 15 units — identical arithmetic to what this
exact fulfilment would have posted before this sprint's change. The rejected order
posted no journal entry and left the `SalesOrder`/inventory completely unchanged,
confirmed directly (§10).

## 13. Tenant Isolation

Unchanged — every converted call site's atomic `updateMany`/`upsert` scopes its `WHERE`/
composite-key lookup by `organisationId` exactly as the code it replaced did; no
tenant-scoping logic was touched. Not independently live-tested against a second
organisation this sprint (the defect and its fix are both about SAME-tenant concurrent
requests racing for the SAME stock row — tenant isolation itself was not in question and
is already covered by every other domain's own cross-tenant tests).

## 14. Remaining Known Issues

Three call sites share the SAME underlying "read a value, compute something dependent
on it in application code, write it back" structure, but with an increment +
moving-weighted-average cost recalculation rather than a plain guarded decrement:
`CustomerReturnRepository`, `GoodsReceiptRepository.receive()`, and
`ProductionRunRepository.complete()`. A plain conditional `increment` cannot atomically
express "new weighted average = f(prior quantity, prior cost, incoming quantity,
incoming cost)" the way a guarded decrement can — a correct fix needs its own
single-statement SQL expression (or an explicit row lock) and deserves dedicated review
rather than being folded into this hardening pass. This is a genuine, confirmed
(by code inspection, not yet live-reproduced) theoretical exposure — documented in
`docs/domains/inventory.md` §12 and left as explicit future follow-up, per this sprint's
own instruction not to over-scope into a general Inventory refactor.

## 15. Regression Testing

Sprint 37's own baseline: 231 suites / 2084 tests. After this sprint: **232 suites /
2089 tests, 0 failures, 0 regressions** — 1 new suite
(`inventory-stock.repository.spec.ts`) and 5 new tests. The new
`inventory-stock-concurrency.integration.spec.ts` is intentionally NOT counted in this
figure (it requires a live database and runs via a separate `pnpm run test:integration`
command — see §9); it was run explicitly and all 7 of its tests pass against the real
dev database.

## 16. Quality Gates

| Check                                            | Result                                                                                          |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `prisma validate`                                | Pass                                                                                            |
| `prisma migrate status`                          | Pass — 55 migrations, up to date (no schema change this sprint)                                 |
| `pnpm exec tsc --noEmit` (API)                   | Pass                                                                                            |
| `pnpm exec eslint src` (API)                     | Pass — 0 errors (27 pre-existing warnings, unrelated `finance/budgeting` spec files, untouched) |
| `pnpm exec jest` (API)                           | Pass — 232/232 suites, 2089/2089 tests                                                          |
| `pnpm run test:integration` (API, real Postgres) | Pass — 1/1 suite, 7/7 tests                                                                     |

No frontend changes were needed or made — the confirm-collection error surface the Web
Field UI already handles (`400` with a message, displayed via the existing
`ApiError`/`error` rendering already built in Sprint 37) required no adjustment; the
error message format for `InsufficientStockError` is byte-identical to before.

## 17. Documentation

- `docs/domains/inventory.md` — new §12 ("Concurrent Stock Mutation"): the defect, root
  cause, full audit table, the fix, why the three increment-with-cost-recompute paths
  were deliberately not converted, and verification summary.
- `docs/domains/d2c.md` §78/§80 — annotated (not rewritten) to note the defect described
  there is now fixed, cross-referencing this report and `inventory.md` §12, while
  preserving the original section as an accurate historical record of the discovery.
- `docs/sprint-37.1-completion-report.md` — this document.
- `docs/roadmap.md`, `docs/backlog.md`, `docs/changelog.md`, `README.md` — Sprint 37.1
  entries added.

## 18. Git State

- **Branch**: `main`
- **HEAD**: `23ac1ce` (Sprint 36: Existing Outlet -> Collection Point Enablement) —
  unchanged by this sprint (Sprint 37's own work also remains uncommitted, per its own
  explicit instruction).
- **Commit**: **NOT MADE.**
- **Push**: **NOT MADE.**
- **Working tree**: this sprint's changes (the new `inventory-stock-concurrency.util.ts`,
  the five converted repositories, two new spec files, the new integration-test
  infrastructure, `jest.config.js`/`jest.integration.config.js`/`package.json` script,
  and this documentation) sit on top of Sprint 37's own still-uncommitted working tree.
