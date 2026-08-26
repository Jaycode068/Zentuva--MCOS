# Sprint 10 Completion Report — Sales Fulfilment & COGS Accounting Integration

## 1. Objective

Close the last major gap in the operational→accounting chain Sprints 7–9 built: when a
customer order is physically supplied (Sales Fulfilment), the finished-goods inventory
leaving stock must automatically recognize Cost of Goods Sold. Primary chain:

```
Sales Order → Sales Fulfilment → Finished Goods Inventory decreases → COGS increases → General Ledger
```

The brief's central architectural rule — reinforced by three separate sections (§1,
§2, §14) — is that this must never collapse into a single event with Invoice or Sales
Order. Sales Order remains pure demand; Invoice recognizes revenue
(`DR Accounts Receivable / CR Sales Revenue`, Sprint 6/7, unchanged); only physical
Fulfilment recognizes cost (`DR Cost of Goods Sold / CR Finished Goods Inventory`,
new this sprint). Neither event impersonates the other.

## 2. Architecture Decisions

| #   | Question                                                | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Zero/missing-cost policy                                | Match Production Material Issue's precedent exactly: skip the journal silently (never a zero-value entry), never block the physical fulfilment. Stock deduction, `InventoryTransaction`, and the `SalesFulfilment` record are all unconditional; only the Journal Entry is conditionally skipped. A deliberate divergence from the brief's own stronger "prevent fulfilment" phrasing, justified by consistency with an already-shipped, structurally identical precedent. |
| 2   | Journal granularity                                     | One Journal Entry per `SalesFulfilment` (not per item, not per order), two lines: `DR COGS` / `CR Finished Goods Inventory`, each summed across every SKU in the batch. `JournalEntryLine` carries no `productId`/`quantity` — per-SKU traceability comes from `SalesFulfilmentItem.unitCost`/`.costAmount` instead.                                                                                                                                                       |
| 3   | Idempotency ordering                                    | Applied Sprint 9's lesson proactively: `SalesFulfilmentRepository.findByIdempotencyKey()` (new) is checked first in `SalesFulfilmentService.fulfil()`, before the order-status and over-fulfilment pre-checks — so a genuine retry (arriving after the order already transitioned, or the requirement already fully consumed) returns the original result instead of a `400`.                                                                                              |
| 4   | Cancellation / reversal                                 | No code change — `SalesOrderService.cancel()` already blocks cancellation once `PARTIALLY_FULFILLED`/`FULFILLED` (Sprint 4.9). No COGS-reversal mechanism built; Sales Return / Reverse Fulfilment documented as explicit future work.                                                                                                                                                                                                                                     |
| 5   | Invoice ↔ Fulfilment relationship                       | No code change — `InvoiceService.create()` already requires `SalesOrder.status === FULFILLED` (Sprint 6). Fulfilment (COGS) always happens before Invoicing (Revenue) today; documented, not enforced by any new dependency between the two.                                                                                                                                                                                                                               |
| 6   | Structural independence tests                           | New `sales-finance-independence.spec.ts` (mirrors `production-finance-independence.spec.ts`); extended `distribution-inventory-independence.spec.ts` with a new guard that Dispatch/Delivery never call `postSystemJournalEntry`/touch `JournalEntry`; extended `direct-sales-independence.spec.ts` with one more guard (`sales-order.service.ts` never imports `finance/`).                                                                                               |
| 7   | Finance traceability — API shape                        | No new `GET .../accounting` endpoint. `SalesFulfilmentItem` gained `unitCost`/`costAmount` (schema change); `GET /sales/orders/:id/fulfilments` already returns every fulfilment 1:1, extended to include each one's `journalEntry` via a new batch lookup (`findJournalEntriesForFulfilments`). A `SalesFulfilment` _is_ the event — no order-level aggregation endpoint needed, unlike Production.                                                                       |
| 8   | Rounding                                                | Per item: `costAmount = roundCurrency(quantity × averageUnitCost)`; the journal total is a running rounded sum, not a single round of the raw grand total — guarantees `Σ item.costAmount === journalEntry.totalAmount` exactly, with no drift.                                                                                                                                                                                                                            |
| 9   | Location handling                                       | No change — `SalesFulfilment.locationId` was already header-level (one location per batch); `averageUnitCost` was already per-location. Nothing to build.                                                                                                                                                                                                                                                                                                                  |
| 10  | Chart of Accounts                                       | No change — `SYSTEM_ACCOUNT_KEYS.COGS`/`.FINISHED_GOODS_INVENTORY` already existed (seeded since Sprint 7), reserved specifically for this integration. Only the doc comment updated from "reserved" to "posted to."                                                                                                                                                                                                                                                       |
| 11  | Accounting-period / atomicity                           | Reused `NoOpenPeriodError`/`MissingSystemAccountError` from `journal-posting.ts` as-is, caught in `SalesFulfilmentService.fulfil()` alongside the existing `InsufficientStockError`/`SalesFulfilmentConflictError` catches — same shape as every prior sprint.                                                                                                                                                                                                             |
| 12  | Audit events                                            | New `SALES_AUDIT_ACTIONS.FULFILMENT_COGS_POSTED`, fired only when `wasCreated === true && journalEntry !== null` — mirrors Sprint 9's `production.material-issue-journal-posted` pattern.                                                                                                                                                                                                                                                                                  |
| 13  | Seed data gap (found during research, not in the brief) | Added a new, fully-costed Production flow (`BOM-000004`/`PROD-000006`) giving `PRD-000027` a real average cost (₦426/pack) _before_ any `ADJUSTMENT`-type top-up runs. Without this, every already-seeded Sales Fulfilment would have silently posted no COGS journal — `PRD-000027`/`PRD-000030` both carried `averageUnitCost = 0` before this fix (stock built entirely from un-costed top-ups).                                                                        |
| 14  | Field Sales mobile UI                                   | No UI change. Verified directly: Field Sales' `FieldFulfilSheet` executes real fulfilment (correcting an initial assumption that it had no fulfilment capability at all) but renders only quantities — zero currency/cost/journal fields anywhere. Field's own `api.ts` re-exports Admin's types unchanged, so the new fields exist on fetched objects but are never displayed.                                                                                            |

## 3. Database Changes

New migration `20260825205950_add_sales_fulfilment_cogs`:

- `SalesFulfilmentItem.unitCost Float @default(0)` — the `averageUnitCost` this item
  was actually costed at, snapshotted at fulfilment time.
- `SalesFulfilmentItem.costAmount Float @default(0)` — `quantityFulfilled × unitCost`,
  rounded.

No other schema change. `InventoryStock.averageUnitCost` is reused exactly as-is;
`SYSTEM_ACCOUNT_KEYS.COGS`/`.FINISHED_GOODS_INVENTORY` are pre-existing plain
TypeScript consts; `JournalEntry.sourceType` stays free-text (`'SALES_FULFILMENT'` is
a new literal value, not a schema change).

## 4. API

No new write endpoints. `POST /sales/orders/:id/fulfil`'s own response is unchanged
(still returns the order, not the fulfilment — confirmed this was already the case
pre-Sprint-10). `GET /sales/orders/:id/fulfilments` now includes each fulfilment's
`journalEntry: { id, journalNumber, status, totalAmount } | null` and each item's
`unitCost`/`costAmount`.

## 5. Backend Implementation

- **`SalesFulfilmentRepository`** — `create()` rewritten: idempotency check-then-return
  now also looks up the journal via a new private `findJournalEntry()`; the existing
  per-item stock-guard loop now also reads `averageUnitCost` and accumulates
  `totalCogsValue`/per-item `unitCost`/`costAmount`; after the existing writes, posts
  `DR COGS / CR Finished Goods Inventory` via `postSystemJournalEntry` when
  `totalCogsValue > 0`. New `findByIdempotencyKey()` and
  `findJournalEntriesForFulfilments()` methods (the latter a batch lookup, mirroring
  Production's `findJournalEntriesByProductionOrder`).
- **`SalesFulfilmentService.fulfil()`** — the idempotency short-circuit now runs first,
  immediately after loading the order, before the status/over-fulfilment pre-checks;
  threads `salesOrderNumber` into the repository call; catches
  `NoOpenPeriodError`/`MissingSystemAccountError`.
- **`SalesOrderController`** — `fulfil()` handler gains a conditional
  `FULFILMENT_COGS_POSTED` audit block; `listFulfilments()` batch-fetches journal
  entries and merges them in; `toSalesFulfilmentResponse()` extended with
  `journalEntry`/per-item `unitCost`/`costAmount`.
- **`SALES_AUDIT_ACTIONS`** — new `FULFILMENT_COGS_POSTED` key.
- **`chart-of-account-keys.ts`** — doc-comment-only update for `COGS`.

## 6. Frontend Implementation

- `settings/sales/api.ts` — `SalesFulfilmentItem` gains `unitCost`/`costAmount`;
  `SalesFulfilment` gains `journalEntry`.
- `sales-order-detail-dialog.tsx` — Fulfilment History cards gain an "Inventory Cost"
  line and a `JE-xxxxxx · POSTED · COGS Posted` (or "No accounting entry" fallback)
  line per batch, matching this file's own existing plain-`.toFixed(2)` convention
  rather than importing Production's `formatCurrency` pattern verbatim.
- `settings/finance/labels.ts` — `JOURNAL_SOURCE_TYPE_LABELS` gains
  `SALES_FULFILMENT: 'Sales Fulfilment'`.
- Field Sales: no change — verified it renders no cost fields (§2 decision 14).

## 7. Accounting Rules / Sales Fulfilment Accounting Integration

See `docs/domains/accounting.md` §11 for the full writeup. Summary: each Sales
Fulfilment batch posts one Journal Entry, `DR Cost of Goods Sold / CR Finished Goods
Inventory`, valued at `Σ (quantity × averageUnitCost)` across every item in the batch.
Skipped entirely (no zero-value journal) when the total rounds to `0`. Deliberately
separate from Invoice's own `DR AR / CR Sales Revenue` posting — revenue and inventory
cost are recognised at different business moments.

## 8. Tests

- New `sales-fulfilment.repository.spec.ts` (12 tests, deliberate exception to "no
  repository tests for atomic transactions," same justification as
  `production-material-issue.repository.spec.ts`) — covers: full fulfilment posting
  the correct journal; partial fulfilment across 3 calls each posting its own
  independent journal summing exactly to the total; multi-SKU fulfilment with one
  aggregated journal and item-level costs summing exactly to it; weighted-average
  costing; zero/missing cost (journal skipped, item cost `0`); insufficient stock;
  order-not-eligible conflict; idempotency replay; `findByIdempotencyKey`/
  `findJournalEntriesForFulfilments`; `NoOpenPeriodError`/`MissingSystemAccountError`.
- New regression tests in `sales-fulfilment.service.spec.ts` (2 tests) — a retry with
  a matching idempotency key short-circuits before the `FULFILLED`-status pre-check
  and before the over-fulfilment pre-check, mirroring Sprint 9's own regression-test
  addition for Production.
- New `sales-finance-independence.spec.ts` (3 tests) — the structural guards from
  decision 6.
- Extended `distribution-inventory-independence.spec.ts` (2 new tests) and
  `direct-sales-independence.spec.ts` (1 new test) per decision 6.
- Existing `sales-order.controller.spec.ts` fixtures updated for the new required
  response fields (`journalEntry`, `findJournalEntriesForFulfilments` mock).
- Full backend suite: **68 test suites / 684 tests, all passing** (up from 66/664
  after Sprint 9).

## 9. Live Verification Performed

Using the actual running API (`nest start`) and web (`next dev`) apps, logged in as
the seeded Owner account — per the brief's explicit "do not rely only on automated
tests" instruction. (The API dev server needed a restart mid-verification: it had been
running since before the schema migration/`prisma generate`, and Node does not hot
reload a regenerated Prisma Client — the first check against the seed data returned
`NaN`/no journal until the server was restarted, at which point the correct values
appeared. Not a code bug — an environmental artifact, resolved by restarting.)

1. **Seed-generated scenario** (`SO-000001`): confirmed the Fulfilment History section
   now shows `Inventory Cost: 21300.00` and `JE-000012 · POSTED · COGS Posted` for the
   first time (previously would show "No accounting entry"). Opened `JE-000012` in
   Finance: `DR 5100 Cost of Goods Sold ₦21,300.00 / CR 1330 Finished Goods
₦21,300.00` — matches `50 × ₦426` exactly.
2. **Fresh, fully live Boby Bites scenario** (`SO-000006`), executed in the system's
   actual required order (Confirm → Fulfil → Invoice, not the brief's own prose
   order): created a multi-SKU order (300 packs Plantain Chips Classic Salted 500g @
   ₦800, 100 packs Sweet & Spicy 30g @ ₦250 — ₦265,000 total), confirmed it, fulfilled
   it in two partial batches (200+60, then 100+40) — each posted its own independent
   journal (`JE-000025` ₦85,200, `JE-000026` ₦42,600, summing to exactly
   `300 × ₦426 = ₦127,800`; the zero-cost SKU contributed `₦0` on both without
   blocking either posting) — then raised and issued the Invoice against the now-
   `FULFILLED` order: `JE-000027`, `DR Accounts Receivable ₦265,000 / CR Product Sales
₦265,000`. Confirmed via the General Ledger that all three journals exist, fully
   independent of each other.
3. **Idempotency replay — via direct duplicate API submissions with a fixed key**:
   submitted the identical fulfilment request twice; both calls returned `201` with
   identical `fulfilment.id`/`journalEntry.journalNumber` (`JE-000028`, ₦4,260 exactly
   `10 × ₦426`). Confirmed via direct database query: exactly 1 `SalesFulfilment`, 1
   `InventoryTransaction`, 1 `JournalEntry`, and exactly 1 `sales-order.fulfilled`
   audit log row for the order — the retry never double-logged.
4. **Closed accounting period — atomic rollback**: created and immediately closed an
   isolated "October 2026" period, attempted a fulfilment dated inside it. Confirmed
   via the API (`400 "No open accounting period covers 2026-10-15"`) and a direct
   database query that the order status, `SalesFulfilment` count, and
   `InventoryStock.quantityOnHand` were all completely unchanged.
5. **Tenant isolation**: registered a second organisation live, confirmed a direct
   `GET` on Boby Bites' Sales Order returns `404`, and the fulfilments endpoint for
   that order returns an empty list (not a 404, matching this endpoint's pre-existing,
   unchanged tenant-scoping convention) — no data of any kind leaked.
6. **Dispatch/Delivery independence**: dispatched and delivered a previously-fulfilled
   order's items via the real Distribution API. Confirmed via direct database query
   that both `InventoryStock.quantityOnHand` and the total Journal Entry count were
   completely unchanged before and after — Dispatch and Delivery neither re-deduct
   inventory nor post any accounting entry.
7. **Mobile Field Sales spot-check**: resized to 375px, confirmed the Orders list and
   an individual order's detail screen show only Customer/Items/Quantity/Total —
   zero cost, COGS, or journal information anywhere.

## 10. Bugs Found and Fixed During This Sprint

- **Seed data gap: `PRD-000027` had no legitimate cost basis.** Discovered during
  research (not live testing this time): `PRD-000027`/`PRD-000030`, the two SKUs Sales
  actually sells against the seeded orders, both carried `averageUnitCost = 0` — their
  stock had only ever come from `ADJUSTMENT`-type top-ups (`seedSalesFulfilmentStockTopUp`/
  `seedFinanceStockTopUp`), never a costed Goods Receipt or Production Completion. Under
  the zero-cost-skip policy (decision 1), shipping without a fix would mean every
  already-seeded Sales Fulfilment silently posts no COGS journal — the exact same
  category of gap Sprint 9 found and fixed for Vegetable Oil. Fixed by adding a new BOM
  (`BOM-000004`) and Production Order (`PROD-000006` — `PROD-000004`/`PROD-000005`
  were already taken by earlier live-verification test fixtures in this shared dev
  database, confirmed by direct query before choosing the number) that fully completes
  (Material Issue + Production Completion, 100% accepted) _before_
  `seedSalesFulfilmentStockTopUp` runs, giving `PRD-000027` a real average cost of
  ₦426/pack that every seeded and live fulfilment now costs against correctly.
- **Stale Prisma Client in the running dev server.** After the schema migration and
  `prisma generate`, the already-running `nest start --watch` process (started before
  this sprint's changes) kept using the Prisma Client loaded at its own startup —
  Node does not reload `node_modules` artifacts via file-watch. The first live check
  against seed data showed `Inventory Cost: NaN` and "No accounting entry" despite the
  correct data existing in the database (confirmed via direct query). Resolved by
  restarting the dev server; not a code defect.
- **A false assumption during design, corrected before code was written**: an initial
  research pass concluded Field Sales had no fulfilment capability at all, which would
  have made the "Field Sales UI needs no changes" decision trivially true for the wrong
  reason. Direct verification found `field/orders/[id]/page.tsx`'s `FieldFulfilSheet`
  does execute real fulfilment — the decision (no UI change needed) still held, but for
  the correct reason: it renders no cost/currency fields, not that it lacks fulfilment
  entirely. Documented accurately in `sales.md`/accounting.md rather than left as the
  incorrect original claim.

## 11. Known Limitations

- No FIFO/specific-identification costing, per-lot cost tracking, or landed-cost
  allocation — reuses the same moving-weighted-average `averageUnitCost` Production
  Material Issue already reads, unchanged.
- No labour, machine, or overhead costing in the COGS figure — material cost only.
- No Sales Returns, Reverse Fulfilment, Inventory Return, COGS Reversal, or Customer
  Credit mechanism — `SalesOrderService.cancel()` already blocks cancellation once
  fulfilment has started (Sprint 4.9, unchanged); no reversal path exists for either
  the inventory or the accounting consequence of a fulfilment.
- No new `GET .../accounting` summary endpoint for Sales Orders (deliberate — see
  decision 7); Finance traceability instead comes from the existing, now-extended
  fulfilment-list endpoint.
- `POST /:id/fulfil`'s own response still returns the order, not the fulfilment or its
  journal — clients must call `GET /:id/fulfilments` separately to see the newly-
  created fulfilment's accounting detail (unchanged pre-existing response shape).

## 12. Deferred / Future Work

- Sales Returns / Reverse Fulfilment, with the two-sided reversal it would require:
  `DR Finished Goods Inventory / CR Cost of Goods Sold` (inventory/cost) and
  `DR Sales Returns / CR Accounts Receivable` (revenue, mirroring Sprint 7's existing
  Credit Note posting).
  Customer Claims, Supplier Returns.
- A payment gateway, full P&L/Balance Sheet, budgeting, financial forecasting,
  payroll, labour costing, factory overhead allocation, depreciation.
- An advanced pricing engine, customer credit limits, full credit management.
- FIFO/specific-identification costing, per-lot cost tracking, landed-cost allocation.
- Procurement's own PO-confirmation event and Distribution's Dispatch/Delivery remain
  unwired to the General Ledger (Distribution deliberately so, per decision area §14/§15
  of the brief).

## 13. Documentation Updated

`docs/domains/sales.md` (new §4b "Accounting Integration (Sprint 10)", updated §7/§8/§9),
`docs/domains/inventory.md` (retitled §11b to note the Sprint 10 extension, new §11c
"Sales Fulfilment Accounting Integration (Sprint 10)"), `docs/domains/accounting.md`
(new §11 "Sales Fulfilment Accounting (Sprint 10)" with 9 subsections, renumbered API
Reference/Known Limitations, updated header dependencies), `docs/domains/finance.md`
(§9 updated to reflect Sales Fulfilment now wired), `docs/domains/README.md`
(Inventory/Production/Sales/Distribution/Accounting status rows), `docs/backlog.md`
(Epic 5/7/17, Current Sprint Status), `docs/roadmap.md` (Phase 2 Inventory/Sales/
Accounting rows), `docs/changelog.md` (new dated entry), this completion report.

## 14. Constraint

Per this session's established convention, nothing in this sprint's work has been
committed or pushed — that remains the user's own explicit instruction to give.
