# Phase 2C — Customer Outlet Inventory Integration, Collection Point Cutover & D2C Accounting: Completion Report

**Status: PARTIAL.** Implementation complete and verified for the B2B
outlet-stock integration, returns reconciliation, the Collection Point
dedicated-location requirement (with an audited legacy fallback), and
pre-consumption cancellation. **Explicitly not resolved**: the actual cutover
of the two real seeded Collection Points (no verified physical count exists),
post-consumption Collection Point reversal/refunds, and D2C revenue
recognition — all reported as open blockers per the brief's own Mandatory Stop
Gates, not silently carried forward. **No commits, pushes, or staging were
performed** — working tree only.

This report also discloses, in full, an incident during this phase's own
development: a test-cleanup bug briefly deleted 18 real journal entries from
the shared development database. They were fully, verifiably reconstructed
before this phase concluded. See §8.

---

## 1. Summary of Changes

| Area                          | What shipped                                                                                                                                                                                                            |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B2B fulfilment → outlet stock | New `InventoryTransactionType.DELIVERY`, `SalesFulfilment.destinationLocationId`, destination resolution in `SalesFulfilmentService`, atomic ownership-transition write in `SalesFulfilmentRepository`                  |
| Returns                       | `CustomerReturnRepository.receive()` now reconciles the outlet's `CUSTOMER`-owned claim, independent of existing COGS/credit-note logic                                                                                 |
| Collection Point eligibility  | `isEligible()`/`findEligibleOutlet()`/`listEligibleOutletsForReassignment()` now require a dedicated `CUSTOMER_LOCATION`; `resolveFulfilmentLocation()` provides an audited legacy fallback for already-assigned orders |
| Collection Point cancellation | New `cancel()` — pre-consumption only (`ASSIGNED`/`PREPARING`/`READY_FOR_COLLECTION`), new `CollectionPointFulfillmentStatus.CANCELLED`                                                                                 |
| D2C accounting                | **Analysis only** — decision note below (§7); no new GL posting                                                                                                                                                         |
| Documentation                 | `inventory.md` §15, `customers.md` §9.5, `finance.md` §22, `d2c.md` §133, audit-doc addendum, changelog entry                                                                                                           |
| Tests                         | +22 new unit tests, +5 new integration tests (real PostgreSQL), all pre-existing suites still green                                                                                                                     |

## 2. Pre-Implementation Review (§2 of the brief)

Read and verified directly against current source, not assumed from prior
reports:

- `SalesFulfilmentRepository.create()` — confirmed it is THE sole
  inventory-deducting write path for a Sales Order, confirmed exactly where
  COGS is computed and posted (per-item `unitCost` read at the moment of
  consumption), confirmed the existing idempotency check-then-return shape.
- `SalesOrder` schema — confirmed `outletId` is nullable for EVERY order
  (B2B or D2C), confirmed `source`/`consumerId`/`customerId` exactly as
  Phase 2B's own report described.
- `CustomerReturnRepository` — read `create()`/`cancel()`/`receive()` in
  full. Confirmed `receive()`'s existing resalable-restock step always
  targets the RETURN's own caller-chosen `locationId`, with zero awareness of
  where the original fulfilment delivered stock — the exact gap §3.3
  required closing.
- `CollectionPointFulfillmentService` — read `autoAssign`/`assignManually`/
  `startPreparing`/`markReadyForCollection`/`confirmCollection`/`reassign`/
  `getInventoryViewForOutlet`/`listEligibleOutletsForReassignment` in full.
  Confirmed `confirmCollection()`'s existing exactly-once guarantee (a
  conditional `updateMany` race-guard, a deterministic `idempotencyKey`
  second safety net, and a compensating rollback on `fulfil()` failure) —
  all **unmodified** by this phase; only which `locationId` gets passed to it
  changed.
- `CollectionPointFulfillmentStatus`/schema — confirmed no `CANCELLED` value
  existed.
- `inventory-stock-concurrency.util.ts` — re-reviewed
  `incrementStockWithCostIfCompatible()` (Phase 2B's own atomic
  `INSERT … ON CONFLICT … DO UPDATE` primitive) before reusing it for the
  ownership-transition write; confirmed its concurrency guarantee (the entire
  read-prior-state/recompute/write sequence happens against whatever row
  Postgres has just locked) applies identically here.
- **Live database verification, not assumed**: queried the real seeded
  "Boby Bites" organisation directly and found THREE real, non-terminal
  `CollectionPointFulfillment` rows (`ASSIGNED` ×1, `PREPARING` ×1,
  `READY_FOR_COLLECTION` ×1) against the two shared-location outlets — this
  materially shaped the dedicated-location design (§5 below): a naive
  "require dedicated location everywhere" would have stranded these three
  real, paid, in-progress orders.
- Confirmed, by direct code inspection, that NO payment-refund mechanism
  exists anywhere in this codebase (`grep` across `finance`/`d2c` for
  "refund" found only the existing payment-status-reversal CHECK, never an
  issuing mechanism) — this directly shaped the cancellation scope (§6).
- Confirmed, by direct code inspection, that a D2C order's payment lifecycle
  (`createPendingForConsumer` → `applyProviderCallback`) posts **zero**
  `JournalEntry` rows, and that `InvoiceService` explicitly refuses to create
  an Invoice for a D2C order — this directly shaped the accounting decision
  note (§7).

## 3. B2B Fulfilment Timing and Ownership-Transition Implementation (§3)

### 3.1 Destination resolution — the authoritative relationship

`SalesFulfilmentService.resolveOutletStockDestination()` uses
`SalesOrder.outletId` — the order's own ordering Outlet — as the sole
authoritative source, for `B2B` orders only. It resolves to "no destination"
(today's pre-Phase-2C behaviour, exactly preserved) in every ambiguous or
unready case:

- `source !== B2B` (a D2C order — handled entirely separately, §5/§6).
- `outletId` is `null` (a real, common case: a B2B order placed directly
  against a Customer with no named Outlet).
- The Outlet has no dedicated, `ACTIVE` `CUSTOMER_LOCATION` yet.
- The resolved destination would equal the fulfilment's own warehouse source
  (defensive — never actually reachable, since `WAREHOUSE`/`CUSTOMER_LOCATION`
  are mutually exclusive by the Phase 2A `CHECK` constraint).

**No destination is ever invented.** This directly satisfies §3.2's
instruction: "If the fulfilment record does not identify a reliable
destination outlet, do not invent one."

### 3.2 The write is NOT a Transfer

`SalesFulfilmentRepository.create()` already performs the source-side
decrement (the pre-existing `ISSUE` row). Reusing `InventoryTransfer` would
require a SECOND, independent source decrement — exactly what §3.1 of the
brief forbids ("do not reuse `InventoryTransfer` in a way that decrements the
source a second time"). Instead:

- A new `InventoryTransactionType.DELIVERY` row is written directly inside
  the SAME transaction, sharing the fulfilment's own id as `referenceId` with
  the existing `ISSUE` row — two rows, one business event, the same
  `referenceType`/`referenceId` pairing convention `TRANSFER`/`RETURN`
  already established.
- A new `SalesFulfilment.destinationLocationId` (nullable, one per batch —
  same grain as the existing `locationId`) records which location, if any.
- The increment itself reuses Phase 2B's
  `incrementStockWithCostIfCompatible()` verbatim — the SAME atomic
  `INSERT … ON CONFLICT … DO UPDATE` primitive, carrying forward the EXACT
  `unitCost` already computed for the COGS line (never a second, invented
  cost basis).

### 3.3 Ownership transition — explicit, never inferred

Always `StockOwnership.CUSTOMER` / `StockArrangement.WHOLESALE` — hardcoded,
never copied from the source (which is `ORGANISATION`/`WHOLESALE`) and never
client-supplied. This is deliberately the ONE case Phase 2B's own design
reserved for a genuine ownership change — a `Transfer` only ever preserves
ownership.

### 3.4 Atomicity and idempotency

- A destination-side failure (`OutletOwnershipTransitionError` — the
  destination already holds this product under a different
  ownership/arrangement) rolls back the ENTIRE transaction, including the
  warehouse decrement and the COGS posting already applied earlier —
  "succeed or fail together," proven by an integration test.
- No new idempotency mechanism — the EXISTING `(salesOrderId, idempotencyKey)`
  check-then-return at the top of `create()` already covers the whole
  operation; proven by an integration test that retries with the same key
  and confirms no duplicate warehouse decrement, outlet delivery, or COGS
  posting.

## 4. Return and Reversal Semantics (§3.3)

`CustomerReturnRepository.receive()` gained one new step, inserted before the
existing disposition-write loop: for every returned item whose originating
`SalesFulfilmentItem.salesFulfilment.destinationLocationId` is non-null, the
OUTLET's `CUSTOMER`-owned balance is decremented by the item's FULL
`quantityReturned` — resalable, damaged, quarantined, and scrapped alike,
since all four dispositions equally mean the outlet no longer has those units
in its own claimed position.

**Deliberately independent of the existing financial logic.** The COGS-
reversal (driven by `quantityResalable`) and credit-note (driven by
`quantityCredited`) logic are completely unmodified and unaware of this new
step — a physical ownership correction and a financial credit are separate
questions, exactly per the brief's own framing ("Nor should a financial
credit automatically imply a physical stock return").

**A genuine Mandatory Stop Gate outcome, not guessed past**: if the outlet's
recorded balance can no longer cover the returned quantity (e.g. something
this phase doesn't model already reduced it), the whole `receive()` is
rejected (`OutletStockReconciliationError`), rolling back financial postings
too. There is no existing business policy for what should happen instead
(write off the shortfall? a new disposition category?) — inventing one would
be exactly the "unapproved accounting/ownership decision" the brief forbids.
This is reported as open, not resolved.

## 5. Collection Point Cutover Method and Results (§5)

### 5.1 The dedicated-location requirement (shipped)

`isEligible()`/`findEligibleOutlet()`/`listEligibleOutletsForReassignment()`
now require a dedicated, `ACTIVE` `CUSTOMER_LOCATION` (via
`InventoryLocationRepository.findByOutletId()`) — not merely a non-null
`outlet.inventoryLocationId`. `autoAssign`/`assignManually`/`reassign` can
therefore never newly point an order at a shared location again.

### 5.2 The reconciliation path for already-in-progress orders (shipped)

`resolveFulfilmentLocation()` prefers the dedicated location if one exists;
falls back to the legacy `outlet.inventoryLocationId` ONLY when none exists
yet. Because §5.1's gate guarantees every NEWLY-assigned order already has a
dedicated location, this fallback is provably exercised only by orders
assigned BEFORE the gate shipped — confirmed by the real, live data found in
§2 (three in-progress orders). Every actual use of the fallback is recorded
in the `READY_FOR_COLLECTION`/`COLLECTED` audit metadata
(`usedLegacySharedLocation: true`) — visible, never silent.

### 5.3 The cutover mechanism IS existing Phase 2B tooling — nothing new built for it

`POST /api/inventory/locations` (create the dedicated location) +
`POST /api/inventory/locations/:id/opening-stock` (record a verified count,
`ownership: ORGANISATION`, `arrangement: D2C_COLLECTION_POINT` — the exact
value Phase 2A added for this purpose and left unused until now) together
already constitute the full cutover mechanism. Eligibility for new
assignment is DERIVED the moment a dedicated location exists — there is no
separate "cutover" flag or endpoint to build or maintain.

### 5.4 Neither real Collection Point was actually cut over — the Mandatory Stop Gate result

| Collection Point                              | Status                             | Why                                                                                                     |
| --------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------- |
| OUT-000011 (Sprint36 Concurrency Outlet)      | Awaiting a verified physical count | Shares the Main Warehouse; no reliable ownership/quantity determination exists for this phase to act on |
| OUT-000003 (Bodija Supermart — Bodija Branch) | Awaiting a verified physical count | Same shared-location situation                                                                          |
| OUT-000004 (Mama Ngozi Provisions Shop)       | Never configured at all            | `inventoryLocationId` is `null`; pre-existing, unrelated to this phase                                  |

Per §5.2/§12 of the brief ("If a physical count or ownership determination is
missing, do not fabricate the balance") and Mandatory Stop Gate #3, this
sub-workstream stopped exactly here. The three real in-progress orders found
in §2 are unaffected — they proceed via the audited legacy fallback (§5.2)
and will complete normally.

## 6. D2C Fulfilment Changes (§6) and Cancellation (§7)

### 6.1 Fulfilment — unchanged exactly-once guarantee, changed location source only

`confirmCollection()`'s existing safeguards (conditional-`updateMany` race
guard, deterministic `idempotencyKey`, compensating rollback on `fulfil()`
failure) are **completely unmodified**. The only change: the `locationId`
passed into `SalesFulfilmentService.fulfil()` now comes from
`resolveFulfilmentLocation()` (§5.2) instead of reading
`outlet.inventoryLocationId` directly. `markReadyForCollection()`'s
availability pre-check and `getInventoryViewForOutlet()`'s Field view were
updated identically, for consistency — a Collection Point always sees and
checks against the SAME location `confirmCollection()` will actually deduct
from.

### 6.2 Pre-consumption cancellation (shipped)

New `CollectionPointFulfillmentService.cancel()`
(`POST /d2c/collection-point-fulfillments/:id/cancel`, same `.fulfil`
permission as every other mutation on this controller — no new permission
added). Reachable from `ASSIGNED`/`PREPARING`/`READY_FOR_COLLECTION` —
collapsed into one operation because all three have the IDENTICAL system
consequence: `confirmCollection()` is the only point stock is ever deducted,
so nothing before it has anything physical to reverse.

- The `CollectionPointFulfillment` status flip (new `CANCELLED` value) is the
  race-guard, claimed first (conditional `updateMany`, identical shape to
  every other transition in this service).
- The underlying `SalesOrder` is then cancelled via the EXISTING, unmodified
  `SalesOrderService.cancel()` — never a duplicated status-transition rule.
- A failure in that second step compensates the CPF status back to its exact
  prior value — the same "never strand a record at a terminal status when a
  cross-domain call fails" pattern `confirmCollection()`'s own error handling
  already established, proven by a unit test.
- Idempotent: a duplicate cancel on an already-`CANCELLED` record returns the
  current state rather than erroring (same convention as `confirmCollection`'s
  own duplicate handling).

**No refund is issued** — verified, not assumed, that no refund mechanism
exists in this codebase; issuing one would violate the brief's own "do not
issue refunds unless the existing architecture explicitly supports it"
instruction. A cancelled, paid order's refund remains an explicit, manual,
off-system follow-up.

**No consumer WhatsApp notification is sent.** `ConsumerNotificationKind`
only covers `COLLECTION_READY`/`COLLECTION_CONFIRMED`; adding a third value
would require widening the `ConsumerWhatsAppNotificationKind` Prisma enum and
fixing a label-generating ternary in
`d2c-operational-exceptions.service.ts` — real, small, but genuinely separate
work, deliberately not bundled into a phase scoped to
inventory/ownership/accounting. Flagged explicitly, not silently skipped.

### 6.3 Explicitly NOT implemented (§7's remaining cases)

Per Mandatory Stop Gates #2/#5/#7, the following require a business/
accounting decision this phase does not make, and were not attempted:

- Cancellation/reversal of an already-`COLLECTED` order (stock already
  consumed) — needs a compensating inventory event AND an accounting decision
  for an order whose revenue was never recognized in the first place (§7
  below).
- An order incorrectly marked collected.
- Damaged/missing/otherwise-unsaleable stock discovered after collection.
- Any refund-contingent flow (no refund mechanism exists at all).
- "Stock consumed but before collection" as a distinct case — not reachable
  in the current state machine: `confirmCollection()` performs the deduction
  and the `COLLECTED` transition atomically, in the same call; there is no
  intermediate state to target. Documented here rather than inventing one.

## 7. D2C Accounting Decision Note (§8 — the required analysis)

### 7.1 Traced call chain, with the exact financial record (if any) at each step

| Step                           | Code                                                          | GL effect                                                                                         |
| ------------------------------ | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 1. Order creation              | `D2COrderingService`/`SalesOrderRepository`                   | None                                                                                              |
| 2. Payment initiation          | `PaymentRepository.createPendingForConsumer()`                | None — `Payment` row created, `status: PENDING`                                                   |
| 3. Verified payment webhook    | `D2CPaymentService.handleProviderCallback()`                  | None                                                                                              |
| 4. Payment recording           | `PaymentService.applyProviderCallback()` → `status: RECORDED` | **None** — confirmed by direct inspection; no `postSystemJournalEntry` call anywhere in this path |
| 5. Collection Point assignment | `CollectionPointFulfillmentService.autoAssign()`              | None                                                                                              |
| 6. Inventory consumption       | `confirmCollection()` → `SalesFulfilmentService.fulfil()`     | `DR Cost of Goods Sold / CR Finished Goods Inventory` (Sprint 10, unchanged)                      |
| 7. Ready-for-collection        | `markReadyForCollection()`                                    | None                                                                                              |
| 8. Consumer collection         | (same call as step 6 — atomic)                                | (same as step 6)                                                                                  |
| 9. Refund/cancellation/return  | Not implemented (no mechanism exists)                         | None                                                                                              |

**The finding, stated plainly**: a D2C order's entire payment lifecycle —
real money received via OPay — produces **zero** GL entries. No cash/bank
debit, no Accounts Receivable, no Sales Revenue. The ONLY GL effect any D2C
order ever produces, at any point, is the COGS posting at fulfilment.
`InvoiceService` explicitly refuses to create an Invoice for a D2C order, so
the existing B2B Invoice→Payment revenue path structurally cannot apply.

### 7.2 The unresolved question

**When, and how, should D2C consumer revenue be recognised, and what should
happen to the cash received?**

### 7.3 Viable alternatives considered

1. **Recognise revenue at payment confirmation** (mirroring cash-basis
   retail): `DR Cash/Bank, CR Sales Revenue` posted the moment
   `applyProviderCallback()` sets the payment to `RECORDED`. Simplest,
   closest to the actual cash event. Risk: recognises revenue before the
   goods are ever handed over — if the consumer never collects (§6.3), this
   revenue would need its own reversal, which itself needs a policy (is an
   uncollected order ever "returned," refunded, or written off as
   unclaimed?).
2. **Recognise revenue at collection** (mirroring the existing COGS timing):
   `DR Cash/Bank (held since payment), CR Sales Revenue` posted inside
   `confirmCollection()`'s own transaction, alongside the existing COGS
   entry. Matches the principle that revenue and its matching COGS should
   recognise together. Requires deciding where the CASH sits in the GL
   between payment and collection (a liability — "payments received in
   advance" — until recognised? A separate clearing account?) — itself a
   policy decision.
3. **Treat the Collection Point as a commission/consignment arrangement**:
   if Collection Points are commercially independent of Boby Bites (take a
   cut, or the goods are technically consigned to them), the correct
   treatment may not be "Boby Bites recognises full revenue" at all, but a
   net/commission model — a materially different commercial arrangement with
   no existing approved documentation.
4. **Do nothing new; document only** (what this phase actually did). Zero
   risk of posting something wrong, but leaves the production blocker fully
   open.

### 7.4 Recommended option and why

**Option 2 (recognise at collection, alongside COGS)** is the most internally
consistent with this codebase's own already-established pattern (Sprint 10's
own revenue/COGS timing split for B2B: revenue at Invoice, COGS at
Fulfilment — here, for D2C, Fulfilment and Collection are the same atomic
event, so recognising both revenue and COGS together there mirrors that
existing split as closely as a cash-sale-with-no-invoice model can). It also
avoids Option 1's unclaimed-order reversal problem, since nothing is
recognised until the goods actually change hands.

However, this recommendation is **not a decision this engineer is authorised
to make unilaterally** — it has real tax/reporting consequences, and Option 3
(commission/consignment) may be the commercially accurate one depending on
the ACTUAL arrangement between Boby Bites and its Collection Points, which
this phase has no documented, approved source for. Per the brief's own §8.2
instruction, this is recorded as a recommendation requiring explicit business
sign-off, not implemented.

### 7.5 Implementation and test work blocked by this decision

- The actual `DR Cash/Bank Received-in-Advance (or similar) / CR [Revenue
or Deferred Revenue]` posting at payment confirmation or collection.
- Any COGS/Revenue reversal logic for an uncollected or cancelled-after-
  collection order.
- Any Collection-Point-commission/settlement posting (explicitly out of
  scope regardless, per §14 of the brief).
- The corresponding integration tests under §11.4 of the brief ("Approved
  D2C accounting entries are created exactly once") — cannot be written
  against a policy that doesn't exist yet.

## 8. Incident Disclosure: Test-Cleanup Bug Deleted 18 Real Journal Entries — Fully Recovered

While developing the B2B fulfilment integration test
(`sales-fulfilment-outlet-integration.integration.spec.ts`), its `afterEach`/
`afterAll` cleanup originally scoped a `JournalEntry` deletion query by
`sourceType: 'SALES_FULFILMENT'` alone, without ALSO restricting `sourceId` to
the test's own disposable fulfilment ids. Since every REAL, pre-existing
Sales Fulfilment also shares that same `sourceType`, this deleted **all 18
real journal entries** for the organisation's actual sales-fulfilment history
(total COGS value ₦831,978 across orders SO-000001 through SO-000036).

**Detected** by this phase's own reconciliation discipline: a post-test
baseline comparison showed `journalEntryCount` had dropped from 59 to 41 —
investigated immediately rather than ignored.

**Recovery, verified at every step**:

1. Confirmed the exact scope of the damage by querying which real
   `SalesFulfilment` rows were missing their journal entry (all 18, exactly
   matching the count discrepancy) — nothing else was affected (`CUSTOMER_RETURN`,
   `SUPPLIER_RETURN`, `GOODS_RECEIPT`, etc. entries were untouched, confirmed
   by `groupBy sourceType`).
2. Confirmed every affected fulfilment's own `SalesFulfilmentItem.costAmount`
   data (the source of truth for what SHOULD have been posted) was still
   fully intact — only the `JournalEntry`/`JournalEntryLine` rows themselves
   were gone, not the data needed to reconstruct them.
3. Confirmed every affected fulfilment's `fulfilmentDate` fell inside a
   still-`OPEN` accounting period (August/September/October 2026 — none were
   in the `CLOSED` July period).
4. Dry-ran the exact reconstruction payload (date, amount, reference, actor,
   description) for review before writing anything.
5. Executed the reconstruction through the REAL, guarded
   `postSystemJournalEntry()` function itself — not a hand-rolled insert —
   so every existing invariant (period validation, double-entry balance
   check, idempotent-by-`sourceId` check) applied exactly as it would have
   to the original postings.
6. Verified the result: `journalEntryCount` returned to exactly 59; every
   other reconciliation figure (location/stock counts, quantities, total
   valuation, Collection Point assignments) remained byte-identical
   throughout; a full-ledger balance check confirmed total debits equal
   total credits across every journal entry for the organisation, with zero
   individually-unbalanced entries.
7. Fixed the actual bug: the test file's cleanup now resolves the EXACT
   disposable fulfilment ids first (scoped to its own disposable locations)
   and restricts every subsequent deletion — including the journal entry
   deletion — to those ids specifically, never a bare `sourceType` filter.
   Re-ran the fixed test twice more; real data remained untouched both times.

**What is NOT fully recoverable**: the reconstructed journal entries received
new sequential `journalNumber` values (the next available ones at
reconstruction time), not their original numbers — other legitimate entries
were created chronologically in between the original postings and their
deletion, so the numbering sequence no longer perfectly reflects original
assignment order. The financial CONTENT (dates, amounts, accounts,
references, actors) is fully accurate; only the cosmetic sequence numbering
differs from history. This is disclosed, not hidden.

## 9. Permissions, Audit, Tenant Isolation (§9)

**No new permission catalogue entries were added.** Every new mutation reuses
an existing permission: the Collection Point `cancel()` endpoint reuses
`d2c.collection_point.fulfil` (the same permission already gating every other
mutation on that controller); the outlet-stock recognition and return
reconciliation are internal consequences of the EXISTING
`sales.fulfilment.create`/`sales.customer_return.manage` actions, requiring
no new surface at all.

**Re: the Phase 2B finding that `inventory.stock.view` has no default
Member grant** — re-confirmed still true, not re-litigated. This phase did
not widen that permission's default grant. The least-privilege
recommendation: a Collection Point field representative's actual day-to-day
need (view their own queue, confirm collection, cancel pre-consumption) is
already fully served by `d2c.collection_point.fulfil`/`.view`, which ARE
granted to Member by default (confirmed in `seed.ts`, unchanged) — a field
rep does not need `inventory.stock.view` at all for Collection Point work
specifically; that permission's Member-grant gap matters only for the
GENERAL outlet-stock-viewing screens Phase 2B introduced, which remains an
Administrator-configuration decision, not something this phase should change
unilaterally.

**Tenant isolation**: every new code path resolves its organisation-scoped
data through existing, already-tenant-scoped lookups
(`InventoryLocationRepository.findByOutletId(organisationId, ...)`,
`SalesOrderRepository.findById(organisationId, ...)`) — no new raw query
bypasses the existing `organisationId` scoping convention anywhere in this
diff.

**Audit**: three new audit points, all on EXISTING action names or one new,
narrowly-scoped one — `READY_FOR_COLLECTION`/`COLLECTED` events gained a
`usedLegacySharedLocation` metadata flag (visible, not silent, whenever the
fallback fires); a new `CANCELLED` audit action
(`collection_point_fulfillment.cancelled`) for the new cancellation
operation.

## 10. Migration and Data Reconciliation Evidence (§12)

**Migration**: `20261012180000_phase2c_outlet_stock_integration_and_cp_cancellation`
— two `ALTER TYPE ... ADD VALUE` (new enum values, additive), two
`ALTER TABLE ... ADD COLUMN` (new nullable columns), one new index, one new
foreign key. No `DROP`, no column alteration, no data migration/backfill
statement anywhere in the diff. Applied via `prisma migrate deploy`;
`prisma migrate status` confirms "Database schema is up to date!" both
immediately after applying and again at the end of this session.

**Reconciliation — captured before this phase's first code change, and
re-verified at the end (post-incident-recovery)**:

| Metric                                                  | Before                                                           | After                                                   |
| ------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------- |
| `InventoryLocation` count                               | 2                                                                | 2                                                       |
| `InventoryStock` count                                  | 8                                                                | 8                                                       |
| `InventoryTransfer` count                               | 0                                                                | 0                                                       |
| `InventoryTransaction` count                            | 57                                                               | 57                                                      |
| `SalesFulfilment` count                                 | 18                                                               | 18                                                      |
| `CollectionPointFulfillment` by status                  | 1 ASSIGNED / 1 PREPARING / 1 READY_FOR_COLLECTION / 11 COLLECTED | unchanged                                               |
| `JournalEntry` count                                    | 59                                                               | 59 (briefly 41 during the incident; see §8)             |
| Σ `quantityOnHand`                                      | 6,232.5                                                          | 6,232.5                                                 |
| Total valuation                                         | ₦2,238,474                                                       | ₦2,238,474                                              |
| Collection-Point-enabled outlets' `inventoryLocationId` | both = shared Main Warehouse                                     | unchanged                                               |
| General ledger balance (Σ debit vs. Σ credit, org-wide) | —                                                                | ₦105,644,385.46 = ₦105,644,385.46, 0 unbalanced entries |

No opening stock was fabricated anywhere. No historical fulfilment, payment,
or accounting record was rewritten (the 18 reconstructed journal entries
restore exactly what existed before the incident — content-identical, see
§8's own caveat on sequence numbering).

## 11. Tests Run and Exact Results (§11)

| Check                                               | Result                                                                                                                                       |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| API unit tests (`pnpm test`)                        | **269 suites / 2,528 tests passing**, 0 failing (+22 vs. the pre-Phase-2C baseline of 2,506 carried over from the prior session's end state) |
| API integration tests (`pnpm run test:integration`) | **14 suites / 83 tests passing**, 0 failing (+5 new, all in the new B2B-outlet-integration file)                                             |
| Typecheck (API + web)                               | 0 errors                                                                                                                                     |
| Lint                                                | 0 errors, 27 pre-existing warnings (unchanged)                                                                                               |
| Build                                               | succeeds                                                                                                                                     |
| `prisma migrate status`                             | up to date                                                                                                                                   |

### New unit tests

- `sales-fulfilment.service.spec.ts` — 6 new tests: destination resolution
  (dedicated location found/not found/inactive/no-outletId/D2C-order), and
  `OutletOwnershipTransitionError` → `BadRequestException` translation.
- `customer-return.repository.spec.ts` — 3 new tests: full-quantity outlet
  reversal regardless of disposition; no-op when no outlet delivery was
  recorded; rejection (and effective rollback) when the outlet balance is
  insufficient.
- `collection-point-fulfillment.service.spec.ts` — 13 new tests across two
  new `describe` blocks: dedicated-vs-legacy location resolution (3 tests,
  including the audit-metadata assertion) and the full `cancel()` lifecycle
  (6 tests: ASSIGNED, READY_FOR_COLLECTION, rejecting an already-COLLECTED
  order, idempotent duplicate cancel, compensating rollback on SalesOrder-
  cancel failure, unauthorized-caller rejection) plus 4 pre-existing tests
  updated for the new dedicated-location eligibility requirement.

### New integration tests (real PostgreSQL,

`sales-fulfilment-outlet-integration.integration.spec.ts`, 5 tests, fully
disposable fixtures — own product, own warehouse/outlet locations, a real
seeded Outlet/Customer reused READ-ONLY):

- Full B2B fulfilment: warehouse decremented once, COGS posted once, outlet
  recognises the exact same quantity as `CUSTOMER`-owned stock, cost carried
  correctly, exactly one `DELIVERY`+`ISSUE` ledger pair, exactly one new
  `JournalEntry` — **value conservation proven numerically** (warehouse
  value drop exactly equals the (excluded-from-company-valuation) outlet
  value gain).
- Idempotent retry: no duplicate decrement/delivery/posting.
- No-destination case: behaves byte-for-byte like pre-Phase-2C.
- Ownership-mismatch rejection: whole transaction (warehouse decrement +
  COGS) rolls back.
- Concurrency: two fulfilment attempts racing the same limited warehouse
  stock — exactly one succeeds, the outlet receives exactly what actually
  left the warehouse.

## 12. Remaining Operational and Production Blockers

1. **D2C revenue recognition** — fully open; no GL entry for any D2C
   payment. See §7. This is the single most material open item from this
   entire initiative.
2. **Neither real Collection Point is cut over** — both remain on the shared
   Main Warehouse; new assignment to them is now blocked by the dedicated-
   location gate, meaning **no new D2C Collection Point order can be
   assigned to either outlet until an administrator performs a real,
   verified physical count and cutover** using the existing tooling (§5.3).
   This is an immediate, real operational consequence requiring action, not
   a passive documentation note.
3. **Post-consumption Collection Point reversal** — not implemented; an
   incorrectly-collected or damaged-stock order has no supported correction
   path yet.
4. **No refund mechanism exists anywhere in this codebase** — a prerequisite
   for most of the remaining §7 cancellation/reversal cases.
5. **No consumer notification on cancellation** — a real, small, deliberately
   deferred gap (§6.2).
6. **The increment-side costing concurrency gap remains fixed ONLY for
   Phase 2B's Transfer path and this phase's new DELIVERY path** —
   `GoodsReceiptRepository`/`ProductionRunRepository`/`CustomerReturnRepository`
   still carry the original, pre-existing, documented race (unaffected by
   this phase; re-confirmed, not re-touched).
7. **No operational UI was built this phase.** Every capability above is
   reachable only via the existing API surface (the Collection Point
   controller's new `cancel` route; the existing Inventory location/opening-
   stock endpoints for cutover). This is reported honestly, not claimed as
   operationally complete — per the brief's own acceptance criterion,
   essential operations remain reachable through a supported interface
   (the API), just not yet through a screen.

## 13. Files Changed

### Created

- `apps/api/prisma/migrations/20261012180000_phase2c_outlet_stock_integration_and_cp_cancellation/migration.sql`
- `apps/api/src/sales/sales-fulfilment-outlet-integration.integration.spec.ts`
- `docs/sprint-customer-location-inventory-phase-2c-completion-report.md` (this file)

### Modified

- `apps/api/prisma/schema.prisma`
- `apps/api/src/d2c/fulfillment/collection-point-fulfillment-audit-actions.ts`
- `apps/api/src/d2c/fulfillment/collection-point-fulfillment.controller.ts`
- `apps/api/src/d2c/fulfillment/collection-point-fulfillment.service.ts`
- `apps/api/src/d2c/fulfillment/collection-point-fulfillment.service.spec.ts`
- `apps/api/src/d2c/fulfillment/collection-point-fulfillment.types.ts`
- `apps/api/src/sales/customer-return.repository.ts`
- `apps/api/src/sales/customer-return.repository.spec.ts`
- `apps/api/src/sales/customer-return.service.ts`
- `apps/api/src/sales/sales-fulfilment.repository.ts`
- `apps/api/src/sales/sales-fulfilment.service.ts`
- `apps/api/src/sales/sales-fulfilment.service.spec.ts`
- `packages/validation/src/d2c.ts`
- `docs/domains/inventory.md`
- `docs/domains/customers.md`
- `docs/domains/finance.md`
- `docs/domains/d2c.md`
- `docs/customer-location-inventory-architecture-audit.md` (addendum only —
  historical findings preserved verbatim)
- `docs/changelog.md`

### Untouched

No `apps/web` file was read or modified. `CollectionPointFulfillmentRepository`,
`OutletRepository`, `SalesOrderRepository`, `InventoryLocationRepository`,
`InventoryStockRepository`, `InventoryTransferRepository`,
`inventory-stock-concurrency.util.ts`, and the `InventoryLocation`/
`InventoryStock`/`InventoryTransfer` schema itself were inspected (read-only)
and confirmed unmodified by this phase's own diff — reused exactly as Phase
2B left them.

## 14. Confirmation

**No commit, push, stage, reset, clean, or stash was performed.** `git status`
at the end of this session shows exactly the files listed in §13, plus the
pre-existing untracked `.claude/` directory already present before this
session began.

**No Phase 3 workflow, unapproved accounting policy, or new settlement/
commission arrangement was introduced.** Every item in §12 above is reported
as an explicit, open blocker — this report does not claim the D2C accounting
gap, the Collection Point cutover, or post-consumption reversal are resolved;
they are analysed and, where safely possible, partially scaffolded, nothing
more.

Every acceptance criterion in the brief's §16 is satisfied by the evidence
above EXCEPT the two the brief itself anticipated might not be fully
achievable this phase (Collection Point dedicated locations being
"reconciled," and D2C accounting treatment being "implemented according to
an explicit approved policy") — both are correctly left in their "explicitly
documented, not resolved" state per the brief's own §16 alternative
("...or the unresolved decision is clearly documented and the D2C production
blocker remains open").
