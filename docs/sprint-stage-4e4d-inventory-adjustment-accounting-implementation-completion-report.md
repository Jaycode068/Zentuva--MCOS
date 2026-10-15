# Stage 4E.4D — Inventory Adjustment Accounting Implementation (Completion Report)

Implementation stage. Code changes only — no development database migration, no
development data mutation, no staging/commit/push. Development database migration
remains pending separate approval, exactly as instructed.

## 1. Exact implementation summary

`InventoryStockRepository.adjustStock()` now posts a value-bearing journal entry
atomically with the stock mutation and `InventoryTransaction`, inside the SAME
`$transaction`, using the existing `postSystemJournalEntry` infrastructure — closing
the gap `docs/domains/accounting.md` §16.7 documented and the Stage 4E.4C/4E.4C.1
design/readiness stages approved. The journal is skipped — never posted as a ₦0
entry — for three structural, reason-independent cases: zero cost, `CUSTOMER`-owned
stock, and `recordOpeningStock`'s own first-time establishment path (untouched,
separate method). `InventoryValuationService.getValuation()` now excludes
`CUSTOMER`-owned stock from the company valuation total, matching that field's own
documented intent, while every operational/outlet/distribution read path (which uses
`InventoryStockRepository.findManyByOrganisation`/`findByProductAndLocation`
directly) is untouched and still shows customer-owned stock in full.

## 2. Accounting entries and account mapping

One new system account: `INVENTORY_ADJUSTMENT` (`EXPENSE`, code `6900` —
`6700`/`6800` were already taken by the existing "Bank Charges"/"Interest Expense"
accounts, discovered only when seeding test and corrected there). Deliberately not
`PRODUCTION_LOSS` (scoped to production-run scrap, not general shrinkage/gain).

```
Positive adjustment (gain):   DR Inventory / Finished Goods Inventory  = |qty| × averageUnitCost
                               CR Inventory Adjustment                 = same amount
Negative adjustment (loss):   DR Inventory Adjustment                 = |qty| × averageUnitCost
                               CR Inventory / Finished Goods Inventory = same amount
```

`INVENTORY` vs `FINISHED_GOODS_INVENTORY` is chosen dynamically by
`stock.product.type === FINISHED_PRODUCT` — the first call site that needs this
choice made per-call rather than fixed per-domain (Goods Receipt always uses
`INVENTORY`; Production Completion always uses `FINISHED_GOODS_INVENTORY`).
Amounts use the existing 2-decimal `roundCurrency` convention; cost is read from the
`stock` row already fetched inside the transaction, after
`applyStockAdjustmentIfNonNegative` has already locked it — `averageUnitCost` is never
written by this method, so that lock already serialises the read against any
concurrent cost-changing writer, with no separate pre-mutation read needed.

Every `AdjustmentReason` is value-bearing by the same rule — `DATA_CORRECTION`/`OTHER`
included, with no label-based exemption anywhere in the code.

## 3. Transaction and idempotency guarantees

The posting call sits inside `adjustStock()`'s existing `$transaction`, after
`tx.inventoryTransaction.create()`, using the same `tx` — a missing account
(`MissingSystemAccountError`) or closed/missing period (`NoOpenPeriodError`) rolls
back the stock mutation and the ledger row together, verified live (Section 7).
Exactly-once is achieved by composing two already-existing unique constraints, with
no new idempotency mechanism: the journal is keyed `sourceType: 'INVENTORY_ADJUSTMENT'`,
`sourceId: transaction.id` — the canonical row `InventoryTransaction.
@@unique([organisationId, idempotencyKey])` already guarantees exists at most once —
and `JournalEntry.@@unique([organisationId, sourceType, sourceId])` then guarantees at
most one journal per that row. Posting only ever runs on the fresh-creation path; a
resolved retry (`resolveExistingAdjustment`) never re-attempts it — it reads back the
original call's own `JournalEntry` by that same key and returns its id, so a retry
reports the SAME `journalEntryId`, never a second one, never a fabricated one for a
no-journal case. Negative-stock protection is unaffected — that guard still fires
before `InventoryTransaction.create()`, before this logic is ever reached.

## 4. Customer-owned valuation correction

`InventoryValuationService.getValuation()` now filters `ownership:
StockOwnership.ORGANISATION`. Verified every caller (`DashboardService`,
`ReconciliationService`, `ExecutiveDashboardService`, `InventoryPositionReportService`)
uses this for a financial dollar total, never an operational quantity — none needed
customer-owned stock included. Live-verified via the new integration tests: a
customer-owned, real-cost outlet position stays fully visible through
`InventoryStockRepository.findByProductAndLocation` (operational read) while reporting
`0` through `InventoryValuationService.getValuation()` for that location (financial
read) — the two previously disagreed with the field's own documented intent; now they
agree. `ReconciliationService`'s `INVENTORY`/`FINISHED_GOODS_INVENTORY` GL check needed
no change — confirmed consistent live: a customer-owned adjustment moves stock but
posts no journal and leaves those two accounts' balances untouched (new integration
test, Section 7). Sales Fulfilment/COGS/ownership-transfer logic is untouched —
confirmed no diff on `sales-fulfilment.repository.ts`.

## 5. Schema and migration changes

**None required.** `InventoryTransaction.idempotencyKey`, `JournalEntry.sourceType`/
`sourceId`, and `InventoryStock.ownership` already existed before this stage.
`journalEntryId` is a new field on `AdjustStockResult`/`StockAdjustmentResult`
(TypeScript interfaces only) and the API response — not a new database column. No
`prisma migrate`/`prisma generate` ran against any database this stage.

## 6. Account provisioning strategy

`INVENTORY_ADJUSTMENT` added to `SYSTEM_ACCOUNT_KEYS`
([chart-of-account-keys.ts](apps/api/src/finance/accounting/chart-of-account-keys.ts)).
Provisioned for the existing tenant via a standalone, idempotency-gated backfill
function (`seedInventoryAdjustmentAccount`, mirroring `seedGrniPendingApprovalAccount`/
`seedProductionAccountingAccounts` exactly) and for future tenants via the same
`BOBY_BITES_CHART_OF_ACCOUNTS` list `seedChartOfAccounts` already uses for a fresh
org's first-ever seed — both in [seed.ts](apps/api/prisma/seed.ts). This matches the
only provisioning mechanism this codebase has today for any system account —
confirmed in Stage 4E.4C.1 that no generic runtime auto-provisioning exists; this is a
pre-existing gap, not solved here, not worsened. **No UI was added** — account
configuration remains seed/future-provisioning only, per the brief's "avoid
unnecessary configuration UI."

Applied **only to the isolated TEST database**, via the existing guarded
`node scripts/seed-test-db.js` (identity-verified before writing). Confirmed present
afterward (`systemKey: 'INVENTORY_ADJUSTMENT'`, code `6900`). **Not applied to
development** — the account does not exist there; see Section 8.

## 7. Test results

**Unit** — `inventory-stock.repository.spec.ts` (26/26, +13 new: positive/negative
posting with correct debit/credit sides, raw-material vs finished-goods account
selection, zero-cost skip, customer-owned skip at real cost, `DATA_CORRECTION`/`OTHER`
value-bearing, 2-decimal rounding, missing-account rollback, closed-period rollback,
retry returns the same `journalEntryId`, a no-journal retry still returns `null` not a
fabricated id). `inventory.service.spec.ts`/`inventory.controller.spec.ts` extended
with `journalEntryId` propagation and the two new error translations
(`MissingSystemAccountError`/`NoOpenPeriodError` → `BadRequestException`, mirroring
`receiveGoods`'s own existing convention) and the new
`ADJUSTMENT_JOURNAL_POSTED` audit-event gating. Full `src/inventory/` + `src/finance/`
unit suite: **90 suites / 748 tests, all passing**. Full `src/distribution/` +
`src/sales/` + `src/production/` (cross-domain independence guards): **19 suites / 246
tests, all passing**. Full default suite (`pnpm test` equivalent): **273 suites / 2630
tests, all passing**.

**Real PostgreSQL integration** — extended
`inventory-adjustment-idempotency.integration.spec.ts` with 7 new tests, all against
the guarded isolated test database with disposable, independently-cleaned-up
fixtures: atomic stock+transaction+journal commit; rollback on a missing system
account (a dedicated disposable tenant with an open period but no accounts, isolating
this from the period check); two genuinely concurrent identical requests producing
exactly one transaction and one journal; GL (`FINISHED_GOODS_INVENTORY`) and
`InventoryValuationService` moving by the identical amount for organisation-owned
stock; customer-owned stock operationally visible but excluded from company
valuation; a customer-owned adjustment leaving the organisation's GL untouched;
tenant isolation (a second disposable tenant with its own Chart of Accounts/period,
confirming each organisation's journal only ever references its own accounts). All 19
tests in the file pass (12 pre-existing + 7 new).

Full `test:integration` run: 13/16 suites pass, including every inventory/finance
suite. **3 pre-existing, unrelated failures** —
`reporting-tenant-isolation.integration.spec.ts`,
`d2c-conversation-config-active-safety.integration.spec.ts`,
`d2c-conversation-config-concurrency.integration.spec.ts` — all three throw "requires
at least 2 seeded organisations"/"at least one other seeded organisation" because the
isolated test database currently has exactly one real seeded tenant (Boby Bites) and
none of these three files create their own second one (unlike every file this stage
touched or extended, which build and clean up their own disposable tenants).
Confirmed **zero diff** on all three files — not modified by this or any prior stage
in this session — and the failure is structural (a missing environmental
precondition), not caused by this stage's account/seed/code changes. Not fixed here
("no unrelated refactoring").

**Type-check**: clean (`npx tsc --noEmit`, zero errors). **Lint**: clean on every file
touched (zero new errors or warnings; pre-existing unrelated warnings elsewhere
untouched).

## 8. Development API compatibility status

**No Prisma Client regeneration occurred** — no schema change was needed, so Stage
4E.4B's client-vs-schema risk class does not recur this stage.

**A real, narrower risk does exist, and is disclosed rather than silently left for
someone else to discover**: `nest start --watch` is running against dev and picked up
these code changes automatically (confirmed — the dev API process restarted mid-stage,
still healthy, `200` on `/api/health`). Since dev's database schema was already fully
migrated before this stage began (Stage 4E.4B.1), there is no schema incompatibility.
However, dev's Chart of Accounts does **not** yet have the `INVENTORY_ADJUSTMENT`
account (confirmed by direct, read-only query — `chartOfAccounts` count unchanged at
34). **7 of dev's 8 `InventoryStock` rows carry a real, non-zero `averageUnitCost`**
(₦90–₦2,000, all `ORGANISATION`-owned). From this point forward, any **new** manual
adjustment request against dev for one of those 7 (any `AdjustmentReason`, either
sign) will fail closed with `MissingSystemAccountError` → `400 Bad Request`, where
before this stage it silently succeeded with no journal. This is the **mandated,
correct** behavior this stage's own brief requires ("Missing account configuration...
causes the entire value-bearing adjustment to roll back") — not a defect, and not a
risk to any existing data (the rollback is atomic; nothing partially applies). It
resolves the moment account provisioning + the (still-pending, separately-approved)
development migration/account-seed ships. The one dev row at zero cost, and every
existing read/report/other-domain endpoint, are completely unaffected. No live
adjustment was attempted against dev to verify this — it is stated analytically from
the account/cost data and the code path, to avoid any dev data risk.

## 9. Files changed (this stage only)

- `apps/api/src/finance/accounting/chart-of-account-keys.ts` — new
  `INVENTORY_ADJUSTMENT` key.
- `apps/api/src/finance/reports/inventory-valuation.service.ts` — ownership filter.
- `apps/api/src/inventory/inventory-audit-actions.ts` — new
  `ADJUSTMENT_JOURNAL_POSTED` action.
- `apps/api/src/inventory/inventory-stock.repository.ts` — the posting logic,
  `AdjustStockResult.journalEntryId`, `resolveExistingAdjustment`'s journal lookup.
- `apps/api/src/inventory/inventory.service.ts` — `journalEntryId` propagation, two
  new error translations.
- `apps/api/src/inventory/inventory.controller.ts` — `journalEntryId` in the response,
  the new audit event.
- `apps/api/prisma/seed.ts` — the new account's CoA-list entry and backfill function.
- `apps/api/src/inventory/inventory-stock.repository.spec.ts` — extended fake
  (`chartOfAccount`/`accountingPeriod`/`journalEntry`, `ownership`/`product` on the
  stock fixture) + 13 new tests.
- `apps/api/src/inventory/inventory.service.spec.ts` — 3 new tests.
- `apps/api/src/inventory/inventory.controller.spec.ts` — 2 new tests.
- `apps/api/src/inventory/inventory-adjustment-idempotency.integration.spec.ts` — 7
  new tests, new disposable fixtures.

Database writes this stage: the `INVENTORY_ADJUSTMENT` account seeded into the
**isolated test database only** (via the guarded script). Development database:
zero writes — counts re-verified identical to the pre-stage baseline (org 1,
`InventoryTransaction` 35, `InventoryStock` 8, `JournalEntry` 35,
`JournalEntryLine` 73, `AccountingPeriod` 3, `ChartOfAccount` 34).

## 10. Outstanding deployment steps and risks

1. **Pending, separately-approved step**: provision `INVENTORY_ADJUSTMENT` on the
   development database's Chart of Accounts (same backfill function, run via
   `pnpm db:seed` or an equivalent guarded dev-targeted step) — needed before any
   value-bearing manual adjustment on dev will succeed again.
2. **No schema migration is pending from this stage** — none was needed.
3. Dev's "Adjust Stock" UI/API will fail-closed for 7 of 8 existing products until
   step 1 ships (Section 8) — worth a heads-up to anyone using dev interactively in
   the meantime.
4. The pre-existing "requires 2 seeded organisations" gap in 3 unrelated integration
   suites (Section 7) remains unresolved — out of this stage's scope, flagged for
   separate attention.
5. The single-account design (`INVENTORY_ADJUSTMENT` netting both directions) is the
   shipped choice per 4E.4C's approved recommendation; a future split into separate
   gain/loss accounts remains a backward-compatible option if ever requested.
6. No retroactive journal was created or proposed for the 7 existing dev rows'
   historical adjustments, or for any seed-time top-up — per the explicit hard
   boundary, and because seed-time writes bypass this code path entirely (confirmed in
   Stage 4E.4C).

Backup checksum re-verified `OK` at the end of this stage; the safety copy was not
touched (timestamp unchanged).

---

Stage 4E.4D implementation and isolated verification are complete. Stopping here —
awaiting approval before any development database migration or account provisioning
is applied.
