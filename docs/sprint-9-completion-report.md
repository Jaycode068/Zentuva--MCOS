# Sprint 9 Completion Report — Manufacturing Accounting Integration

## 1. Objective

Extend Sprint 8's Supplier→PO→GoodsReceipt→Inventory→GL bridge one stage further into
manufacturing, so that consuming raw material against a Production Order and completing
that order automatically produce the correct accounting entries — without turning
Production into a Finance dependency. Primary chain:

```
Raw Materials → Material Issue → Work In Progress → Production →
Finished Goods → Inventory → General Ledger
```

The single hardest problem this sprint had to solve, identified during pre-code
research: **there was no persisted raw-material unit cost to read.** Sprint 8's
valuation source (`PurchaseOrderItem.unitPrice`) was a one-time, per-PO-item number,
computed into a journal value and then discarded — Material Issue consumes from a stock
pile potentially built up from many receipts at different prices, with nothing
retrievable to value that consumption. Direct schema inspection confirmed
`InventoryStock`/`InventoryTransaction`/`Product` carried zero cost fields anywhere.
Solving this — not inventing a second costing method, and not pretending a
sophistication the system doesn't have — was the sprint's central architectural
decision (see §2, decision 1).

## 2. Architecture Decisions

| #   | Question                                                        | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | How is a raw material's unit cost known at Material Issue time? | New `InventoryStock.averageUnitCost Float @default(0)` — a moving weighted-average cost per (organisation, product, location): `newAvgCost = (existingQty × existingAvgCost + receivedQty × receivedUnitCost) / (existingQty + receivedQty)`. Written by `GoodsReceiptRepository.receive()` (extended) and `ProductionRunRepository.complete()`'s finished-goods upsert (new). Read — never written — by Material Issue, valued at the component's _current_ cost at the moment of consumption.        |
| 2   | Does Stock Adjustment touch `averageUnitCost`?                  | No, in either direction. An Adjustment increase has no monetary event to derive a cost from; an Adjustment decrease doesn't change the weighted average of what remains. Documented as a known limitation, not an oversight.                                                                                                                                                                                                                                                                           |
| 3   | New Chart of Accounts system keys                               | `WIP` (new, Asset), `PRODUCTION_LOSS` (new, Expense), and **elevating** the pre-existing Sprint 7-seeded "Finished Goods" account (never a system account) to `FINISHED_GOODS_INVENTORY`. `INVENTORY` keeps its exact Sprint 7/8 meaning, used as Material Issue's credit side.                                                                                                                                                                                                                        |
| 4   | Material Issue journal                                          | One Journal Entry per `ProductionMaterialIssue` (not per order — partial issues each post independently): `DR WIP = Σ quantity × averageUnitCost` / `CR Inventory` same total. Skipped (no journal, not zero-value) only when every issued component has a `0` cost.                                                                                                                                                                                                                                   |
| 5   | Production Order's cumulative WIP value                         | Not stored as a column — computed by summing the `DR WIP` line of every Journal Entry sourced from this order's own Material Issues. Always correct by construction; can never drift from what was actually posted.                                                                                                                                                                                                                                                                                    |
| 6   | Production Completion journal — accepted vs. rejected split     | One Journal Entry per `ProductionRun`: `CR WIP` = full cumulative WIP value; `DR Finished Goods Inventory` = `totalWipValue × acceptedQuantity / producedQuantity`; `DR Production Loss` = `totalWipValue − acceptedValue` (subtraction, not a second multiplication, so the two always sum to exactly the credited total). Documented assumption: proportional-by-produced-quantity, standard for a single homogeneous run — doesn't model a rejection consuming less material than a completed unit. |
| 7   | Idempotency — Material Issue                                    | `ProductionMaterialIssue.idempotencyKey` + `@@unique([productionOrderId, idempotencyKey])`, exact shape of Sprint 8's `GoodsReceipt.idempotencyKey`.                                                                                                                                                                                                                                                                                                                                                   |
| 8   | Idempotency — Production Completion                             | Plain `ProductionRun.idempotencyKey` column — no new composite unique needed, since `productionOrderId` is already `@@unique` at the schema level (structurally at most one run per order).                                                                                                                                                                                                                                                                                                            |
| 9   | Closed-period / missing-account handling                        | Reused `NoOpenPeriodError`/`MissingSystemAccountError` from `journal-posting.ts` as-is — both routes gained the same two `catch` clauses Sprint 8's `InventoryService.receiveGoods()` established.                                                                                                                                                                                                                                                                                                     |
| 10  | Traceability                                                    | No new FK fields — `sourceType`/`sourceId` on the Journal Entry, the same polymorphic design as every other system posting.                                                                                                                                                                                                                                                                                                                                                                            |
| 11  | Audit events                                                    | Two new events (`production.material-issue-journal-posted`, `production.completion-journal-posted`), fired only when a journal was actually posted. Every existing audit block on both write routes gated on `wasCreated === true` — previously none were, since no idempotency existed to make replay possible.                                                                                                                                                                                       |
| 12  | Structural independence test                                    | New `production-finance-independence.spec.ts` — asserts Production's repositories never call `tx.journalEntry.*` directly (only via `postSystemJournalEntry`) and `production.module.ts` never imports `FinanceModule`.                                                                                                                                                                                                                                                                                |
| 13  | SKU-level accounting                                            | No change needed — `ProductionOrder.productId` already references the exact SKU, never a Product Family/Variant (Sprint 4.7's own guarantee, re-verified not re-implemented).                                                                                                                                                                                                                                                                                                                          |
| 14  | COGS / Sales Fulfilment integration                             | Not built this sprint — explicitly deferred, documented as the next accounting integration.                                                                                                                                                                                                                                                                                                                                                                                                            |

## 3. Database Changes

New migration `20260825142739_add_production_accounting`:

- `InventoryStock.averageUnitCost Float @default(0)` — the first persisted inventory
  valuation figure in the codebase.
- `ProductionMaterialIssue.idempotencyKey String?` + `@@unique([productionOrderId,
idempotencyKey])`.
- `ProductionRun.idempotencyKey String?` (no new unique constraint).
- `SYSTEM_ACCOUNT_KEYS` gains `WIP`, `FINISHED_GOODS_INVENTORY`, `PRODUCTION_LOSS`
  (plain TypeScript const additions — `ChartOfAccount.systemKey` is already a free-text
  column, no schema enum change).

## 4. API

No new write endpoints. `POST .../material-issues` and `POST .../complete` each accept
a new optional `idempotencyKey`, and their responses now include `journalEntry:
{ id, journalNumber, status, totalAmount } | null`. New read endpoint:
`GET /api/production/orders/:id/accounting` → `{ materialCost, journalEntries }`.

## 5. Backend Implementation

- **`GoodsReceiptRepository.receive()`** — extended with the `averageUnitCost`
  weighted-average computation alongside the existing `InventoryStock` upsert (reusing
  the pre-upsert `quantityOnHand` read already in place).
- **`ProductionMaterialIssueRepository.issue()`** — rewritten: idempotency
  check-then-return first, then the existing status-transition/stock-decrement logic
  (now also accumulating each component's `quantity × averageUnitCost`), then posts the
  `DR WIP / CR Inventory` journal from inside the same transaction. New
  `getTotalWipValue()`/`findJournalEntriesByProductionOrder()`/`findByIdempotencyKey()`
  methods.
- **`ProductionRunRepository.complete()`** — rewritten: idempotency check via comparing
  the existing run's own stored key, then the existing transition/create/finished-goods
  logic (now also computing and writing `averageUnitCost` on the finished-goods upsert),
  then posts the `CR WIP / DR Finished Goods / DR Production Loss` journal. New
  `findJournalEntryForOrder()`/`findByIdempotencyKey()` methods.
- **`ProductionOrderService`** — new `getAccountingSummary()`; `issueMaterial()`/
  `completeProduction()` thread `idempotencyKey`/`productionOrderNumber`/
  `totalWipValue` into the repository calls and catch `NoOpenPeriodError`/
  `MissingSystemAccountError`. **Both methods now check `findByIdempotencyKey` first,
  before any business-rule pre-check** — see §9 "Bugs Found and Fixed."
- **`ProductionOrderController`** — audit blocks gated on `wasCreated`; two new
  conditional audit blocks for the journal-posted events; new `GET .../accounting`
  route.
- **`packages/validation/src/production.ts`** — both write schemas gain an optional
  `idempotencyKey`.
- **`journal-posting.ts`/`chart-of-account-keys.ts`** — reused as-is; only
  `SYSTEM_ACCOUNT_KEYS` gained the three new keys.

## 6. Frontend Implementation

- `material-issue-dialog.tsx`/`production-run-dialog.tsx` — each generate and send a
  fresh `idempotencyKey` (`crypto.randomUUID()`) per dialog open, matching the
  codebase's established create-dialog convention.
- `production-order-detail-dialog.tsx` — new "Accounting" section showing Material Cost
  and every linked Journal Entry, each linking to `/settings/finance/journal-entries` —
  read-only, deliberately not a Finance workspace embedded in Production.
- `settings/finance/labels.ts` — `JOURNAL_SOURCE_TYPE_LABELS` gains
  `PRODUCTION_MATERIAL_ISSUE: 'Material Issue'`, `PRODUCTION_RUN: 'Production
Completion'`.

## 7. Accounting Rules / Production Accounting Integration

See `docs/domains/accounting.md` §10 for the full writeup. Summary: Material Issue
posts `DR WIP / CR Inventory` per issue, valued at each component's current
`averageUnitCost`; Production Completion posts `CR WIP` (the order's full cumulative
posted WIP value) split into `DR Finished Goods Inventory` (accepted share) and
`DR Production Loss / Scrap` (rejected share), proportional by produced quantity.
Rejected output's cost is preserved in the ledger, never silently dropped, but never
enters sellable inventory (only `acceptedQuantity` is ever added to finished-goods
stock).

## 8. Tests

- New `production-material-issue.repository.spec.ts` (9 tests) and
  `production-run.repository.spec.ts` (11 tests) — deliberate exceptions to the "no
  repository tests for atomic transactions" convention, same justification as
  `goods-receipt.repository.spec.ts`. Cover: partial/complete issues, multiple issues
  at different average costs (cost is read at consumption time, not blended/stale),
  insufficient stock, conflict errors, idempotency replay, `NoOpenPeriodError`/
  `MissingSystemAccountError`, zero-cost skip, `getTotalWipValue` summation; fully
  accepted / the brief's own 980/20 split (asserting the two output lines sum to
  exactly `totalWipValue`) / zero accepted (100% to loss) / `producedQuantity === 0`
  total-loss edge case / idempotency replay (matching and mismatched keys).
- New `production-finance-independence.spec.ts` (4 tests) — the structural guards from
  decision 12.
- New regression tests in `production-order.service.spec.ts` (2 tests, added after the
  idempotency bug below was found and fixed) — assert a retry with a matching
  idempotency key short-circuits _before_ the over-issue pre-check / `IN_PROGRESS`
  status guard, even when the order state has already moved past what a naive
  re-check would accept.
- Existing `production-order.service.spec.ts`/`.controller.spec.ts` and
  `goods-receipt.repository.spec.ts` fixtures updated for the new required fields.
- Full backend suite: **66 test suites / 664 tests, all passing** (up from 63/638 after
  Sprint 8).

## 9. Live Verification Performed

Using the actual running API (`nest start`) and web (`next dev`) apps, logged in as the
seeded Owner account — per the brief's explicit "do not rely only on automated tests"
instruction:

1. **Seed-generated scenario** (`PROD-000001`, Plantain Chips): inspected the two
   seeded partial Material Issues (₦127,800 + ₦85,200 = ₦213,000 total WIP) and the
   completion (485 accepted / 15 rejected of 500 produced) — confirmed the completion
   journal split exactly `DR Finished Goods ₦206,610` (213,000 × 485/500) /
   `DR Production Loss ₦6,390` (213,000 × 15/500), summing to ₦213,000.
2. **Fresh, fully live scenario** (`PROD-000003`, Plantain Chips Sweet & Spicy 30g):
   issued material through the real UI (Plantain 20kg, Vegetable Oil 2L, Salt 0.2kg,
   Printed Nylon 40 rolls — a deliberate partial issue), confirmed the order
   auto-transitioned `PLANNED → IN_PROGRESS`, raw material stock decremented correctly,
   and the Accounting section showed `Material Cost: ₦17,040.00` /
   `JE-000018 · POSTED · ₦17,040.00` — manually verified as
   `20×350 + 2×2000 + 0.2×200 + 40×150 = 17,040`, an exact match. Completed production
   (40 produced / 5 rejected / 35 accepted, "Underweight") through the UI's own
   read-only computed-Accepted preview, then confirmed via the Journal Entry detail
   page that `JE-000019` posted exactly `CR WIP ₦17,040.00` / `DR Finished Goods
₦14,910.00` (17,040 × 35/40) / `DR Production Loss ₦2,130.00` (17,040 × 5/40).
3. **Idempotency replay — via direct API calls with a fixed key** (see §9 "Bugs Found
   and Fixed" below for what this test actually uncovered): a fresh test order's full
   Material Issue, retried with the identical request body and idempotency key, at
   first returned a `400` instead of the original success. After the fix, the retry
   returns `201` with the identical issue id and journal number, and exactly one issue
   exists for the order. The same test performed against Production Completion — first
   failing with `400 "Only production orders that are in progress can be completed"`
   on retry, then, after the fix, returning the identical run id and journal number on
   both calls.
4. **Closed accounting period — atomic rollback**: created an isolated "September 2026"
   accounting period and closed it immediately (rather than closing the live-testing
   period), then attempted a Material Issue dated inside it against a fresh order.
   Confirmed via both the API response (`400 "No open accounting period covers
2026-09-15"`) and a direct database query that the entire transaction rolled back:
   the order remained `PLANNED` (never transitioned to `IN_PROGRESS`), zero
   `ProductionMaterialIssue` rows and zero `InventoryTransaction` rows were created.
5. **Tenant isolation**: registered a second organisation ("Rival Snacks Ltd") live via
   the public registration endpoint, logged in as its owner, and confirmed a direct
   `GET` on Boby Bites' `PROD-000003` order returns `404`, and that org's own
   Production Orders/Journal Entries/Chart of Accounts lists are all empty.

## 10. Bugs Found and Fixed During This Sprint

- **Idempotent retry rejected instead of returning the original result.** Both
  `ProductionOrderService.issueMaterial()` and `.completeProduction()` ran their own
  business-rule pre-checks — an over-issue validation (`getIssuedTotals` compared
  against the requirement) for Material Issue, an `order.status !== IN_PROGRESS` guard
  for Completion — _before_ ever calling into the repository, whose own
  check-then-return idempotency logic was implemented correctly. A genuine retry
  arrives after the original call's own effects already landed: its own issued
  quantity is now counted toward the requirement (making a full-issue retry look like
  an over-issue), and the order has already flipped to `COMPLETED` (making a retry look
  ineligible). Both pre-checks therefore rejected the exact retry that should have
  idempotently succeeded, with a `400` instead of the original success response. No
  duplicate data was ever created — the repository-level guard held in both directions
  — but the retry did not behave idempotently, which is a real gap against the brief's
  explicit requirement ("a retry must never produce 2 stock deductions, 2 journal
  entries, or 2 production completions" implicitly requires the retry to _succeed_
  safely, not merely fail safely). Found live, during the mandatory idempotency-replay
  verification (§9.3), not by static review. Fixed by adding a `findByIdempotencyKey`
  lookup to each repository (`ProductionMaterialIssueRepository`,
  `ProductionRunRepository`) and calling it first in both service methods, before any
  business-rule pre-check — mirroring the exact short-circuit shape the repository's
  own transaction already used, just hoisted one layer up so the service's guards never
  run against a request that has already succeeded. Verified fixed live (§9.3) and
  covered by two new regression tests in `production-order.service.spec.ts`.
- **Seed script's parallel goods-receipt implementation missed the new costing
  formula.** `apps/api/prisma/seed.ts` never imports from `src/` (a standalone
  `ts-node` script outside `src/`'s `tsconfig.json` rootDir), so it re-implements each
  repository's write shape independently. After implementing `averageUnitCost` in the
  real `GoodsReceiptRepository.receive()`, every seeded raw material still carried a
  `0` cost — the seed script's own `seedGoodsReceipts()` had not been updated in
  parallel. All Production journal entries showed `DR 0 / CR 0` on the first seed run.
  Fixed by adding the identical weighted-average computation to
  `seedGoodsReceipts()`'s own `inventoryStock.upsert` call site.
- **Vegetable Oil had no legitimate cost basis.** Its only Purchase Order
  (`PO-000002`) was deliberately seeded as permanently `DRAFT`/never-received (a
  pre-existing, intentional fixture). Rather than giving the ADJUSTMENT-type raw
  material top-up a cost (which would contradict the documented decision that manual
  Adjustments never carry cost information), a new, legitimate PO/GRN pair
  (`PO-000012`/`GRN-000009`, Golden Oil Ltd, 200L @ ₦2,000/L) was added, preserving
  `PO-000002`'s original never-received scenario untouched.

## 11. Known Limitations

- No labour, machine, or overhead costing — material cost only.
- Valuation is a moving weighted average, not FIFO/specific-identification/standard
  costing; no per-lot cost tracking; no landed-cost allocation (freight, duty, handling
  are not blended in).
- The accepted/rejected cost split is proportional by produced quantity — it does not
  model a rejection that occurred early in the process and consumed less material than
  a completed unit; this system has no data to distinguish that case.
- `COGS` remains unposted — Sales Fulfilment consuming finished-goods stock still
  writes no accounting entry.
- Manual Stock Adjustments never update `averageUnitCost`, in either direction — a
  correction carries no monetary event.
- No approval workflow exists to move value out of `GRNI_PENDING_APPROVAL` (Sprint 8's
  concern, unchanged this sprint).

## 12. Deferred / Future Work

- Direct labour costing, machine-hour costing, electricity/overhead allocation,
  depreciation allocation, standard costing, and variance accounting.
- Sales Fulfilment → COGS accounting integration.
- A `GRNI_PENDING_APPROVAL` → `AP` approval/three-way-match workflow (Sprint 8's
  deferred item, unchanged).
- FIFO/specific-identification costing, landed-cost allocation, per-lot cost tracking.
- Full Accounts Payable, financial-statement closing (P&L, Balance Sheet), Cash Flow
  Statement, Bank Reconciliation, payroll, budgeting, multi-currency accounting.

## 13. Documentation Updated

`docs/domains/production.md` (new §11 "Accounting Integration (Sprint 9)", renumbered
Known Limitations to §12, updated API/Audit tables and schema excerpt),
`docs/domains/inventory.md` (new §11b "Costing Engine & Production Accounting
Integration (Sprint 9)", updated valuation Known Limitation and schema excerpt),
`docs/domains/accounting.md` (new §10 "Production Accounting (Sprint 9)", renumbered
API Reference/Known Limitations, updated header dependencies), `docs/domains/README.md`
(Inventory/Production/Accounting status rows), `docs/backlog.md` (Epic 5/6/17, Current
Sprint Status), `docs/roadmap.md` (Phase 2 Inventory/Production/Accounting rows),
`docs/changelog.md` (new dated entry), this completion report.

## 14. Constraint

Per this session's established convention, nothing in this sprint's work has been
committed or pushed — that remains the user's own explicit instruction to give.
