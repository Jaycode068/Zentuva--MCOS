# Stage 4E.4C — Final Inventory Adjustment Accounting Policy (Design Only)

No code was changed, no database was touched, and no new accounts or journals were
created in this stage. This finalizes the policy left open by
`docs/domains/accounting.md` §16.7 ("Known gap: inventory adjustments are not posted to
the General Ledger"), closing the open question that note deliberately left unresolved.

## 1. What was reviewed

- `InventoryStockRepository.adjustStock()` (post-Stage-4E.4B, now idempotent) and
  `InventoryService.adjustStock()` — the full current write path, including the
  Phase 2B `CUSTOMER_LOCATION` opening-balance guard.
- Stock ownership model: `StockOwnership` (`ORGANISATION`/`CUSTOMER`),
  `StockArrangement`, and how `recordOpeningStock`/`InventoryTransferRepository.create`
  set/propagate them.
- Inventory valuation: `InventoryStock.averageUnitCost` (moving weighted average,
  `Float`, `@default(0)`) and `InventoryValuationService.getValuation()`.
- The system-account resolver and journal-posting infrastructure:
  `journal-posting.ts` (`resolveSystemAccountId`, `resolveOpenPeriodId`,
  `postSystemJournalEntry`), `SYSTEM_ACCOUNT_KEYS` (`chart-of-account-keys.ts`), and
  `ChartOfAccountService`'s "system accounts are provisioned by seed data only" rule.
- Accounting-period enforcement (`resolveOpenPeriodId` → `NoOpenPeriodError`) and the
  ledger's immutability/correction policy (§4: never edit a posted entry; `VOID` is a
  bare status flip; a correction is a new entry, never an auto-reversal).
- Every existing precedent for _conditional_ value-bearing postings: Production
  Material Issue/Completion (§10), Sales Fulfilment (§11), Customer/Supplier Returns
  (§12) — specifically their zero-cost-skip rule, their `sourceType`/`sourceId`
  traceability convention, and their idempotency-before-journal ordering.
- The seed script's own `FinanceSeedTopUp`/opening-stock writes, confirmed to bypass
  `adjustStock()`/`recordOpeningStock()` entirely (raw `prisma.*.create()` calls) — so
  this policy, once implemented, has **zero retroactive effect** on existing seed data.

**New infrastructure this policy needs beyond what already exists: none for
mechanism, one new Chart-of-Accounts mapping for content.** Every atomicity,
idempotency, period-enforcement, and traceability primitive required already exists
and is reused as-is (Section 4).

## 2. Policy decision table

| Reason / case                             | Value-bearing?                            | Valuation basis                            | Posts a journal when                                                            |
| ----------------------------------------- | ----------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------- |
| `DAMAGE`, `SPOILAGE`, `LOSS`              | Yes                                       | current `averageUnitCost` at that location | cost > 0                                                                        |
| `FOUND_STOCK`                             | Yes                                       | current `averageUnitCost` at that location | cost > 0                                                                        |
| `PHYSICAL_COUNT` (either sign)            | Yes                                       | current `averageUnitCost` at that location | cost > 0                                                                        |
| `DATA_CORRECTION`                         | **Yes, by default** (not assumed neutral) | current `averageUnitCost` at that location | cost > 0                                                                        |
| `OTHER`                                   | Yes — **no reason is exempt by label**    | current `averageUnitCost` at that location | cost > 0                                                                        |
| Any reason, cost = 0                      | No                                        | —                                          | never (quantity-only; matches Production/Sales precedent exactly)               |
| Any reason, `StockOwnership.CUSTOMER`     | No                                        | —                                          | never (ownership already transferred; not the org's asset)                      |
| `recordOpeningStock` (first-ever balance) | No, categorically                         | —                                          | never — establishing a position is not a correction to one                      |
| Seed/bootstrap writes                     | N/A                                       | —                                          | never — these bypass the governed code path entirely, unaffected by this policy |

**The only exemptions are structural** (zero cost, customer ownership, first-time
opening-stock establishment) — **never** based on which `AdjustmentReason` label was
chosen. This is the direct answer to "a safe MVP rule that prevents bypassing
financial posting" for `OTHER`: there is no reason-based bypass in this design at all,
so `OTHER` cannot be used to dodge a posting that any other reason would have
triggered for the same quantity/cost.

### DATA_CORRECTION — why "yes by default," not "it depends"

There is no field today distinguishing "this corrects a quantity-only record" from
"this corrects a transaction that already affected the GL." Treating `DATA_CORRECTION`
as value-bearing by default, valued at the location's _current_ average cost, is the
safe direction to default in:

- If the thing being corrected never had real cost, the location's current average
  cost is already `0` in practice, and the existing zero-cost-skip rule applies with no
  special-casing — true quantity-only corrections still post nothing.
- If the thing being corrected _did_ carry real cost, defaulting to "neutral" would
  silently under-post a real change and reproduce exactly the §16.7 divergence this
  stage exists to close. Defaulting to "value-bearing" never creates a _wrong_ journal
  — at worst it posts a correctly-valued entry for a correction that turns out, on
  review, to have been purely administrative; that is far safer than the reverse.

No new costing logic, no new flag, no new field — this is the existing moving-average
figure, used the same way every other reason already uses it.

## 3. Accounting entries

**One new system-account mapping, not two.** Reusing the existing `INVENTORY`/
`FINISHED_GOODS_INVENTORY` accounts for the asset side (chosen dynamically by
`Product.type`, exactly mirroring how Goods Receipt always uses `INVENTORY` and
Production Completion always uses `FINISHED_GOODS_INVENTORY` — an adjustment is the
first domain event that needs this choice made _dynamically_, since it can touch any
product type). On the other side, **`PRODUCTION_LOSS` is deliberately not reused** —
it is scoped to a production run's rejected-output cost (a manufacturing variance,
feeding yield/waste reporting); folding unrelated warehouse shrinkage/theft/found-stock
into it would pollute that metric. One new key, `INVENTORY_ADJUSTMENT` (`EXPENSE`
type), nets both directions the same way a real small business books "Inventory
Shrinkage/Adjustment" — a debit-heavy period reads as a net expense, a credit-heavy
period reads as a net recovery, using the trial balance's existing sign-split
presentation (§6) with zero new classification logic.

**Value-decreasing** (`DAMAGE`/`SPOILAGE`/`LOSS`, or a negative `PHYSICAL_COUNT`/
`DATA_CORRECTION`/`OTHER`):

```
DR Inventory Adjustment (Expense)                 = |quantity| × averageUnitCost
CR Inventory / Finished Goods Inventory           = same amount
```

**Value-increasing** (`FOUND_STOCK`, or a positive `PHYSICAL_COUNT`/`DATA_CORRECTION`/
`OTHER`):

```
DR Inventory / Finished Goods Inventory           = quantity × averageUnitCost
CR Inventory Adjustment (Expense, contra)         = same amount
```

**Decimal precision/rounding**: unchanged convention — `Float` throughout (this
codebase has never used `Decimal`), `roundCurrency(v) => Math.round(v*100)/100` applied
to the computed line amount, matching every other domain's local helper exactly
(`sales-fulfilment.repository.ts`, `goods-receipt.repository.ts`, `journal-posting.ts`
itself). No new precision rule.

**Provisioning mechanism for the new key** (no tenant-specific code hardcoded here, by
instruction): add `INVENTORY_ADJUSTMENT: 'INVENTORY_ADJUSTMENT'` to
`SYSTEM_ACCOUNT_KEYS`, then add one `ChartOfAccount` row per existing tenant with
`isSystemAccount: true, systemKey: 'INVENTORY_ADJUSTMENT', type: 'EXPENSE'` — the exact
same one-time, per-tenant seed addition every prior system-account key
(`WIP`/`FINISHED_GOODS_INVENTORY`/`PRODUCTION_LOSS`/`CASH_BANK_PARENT`/
`OPENING_BALANCE_EQUITY`) already required, since `ChartOfAccountService` confirms "system
accounts are created only by seed data / future provisioning" — there is no generic
runtime auto-provisioning mechanism today, for any system account, and this policy does
not introduce one (a real, pre-existing gap, noted but out of scope to solve here — see
Section 7). A sensible code sits in the `6000`s Expense range near `PRODUCTION_LOSS`'s
`6600`, but the exact number is an implementation/bookkeeping choice, not fixed by this
design.

## 4. Integrity requirements — how each is met, and by reusing what

| Requirement                                   | Mechanism                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stock + journal posting atomic                | `postSystemJournalEntry(tx, ...)` called _inside_ `adjustStock()`'s existing `$transaction`, using the same `tx` — identical shape to Material Issue/Production Completion/Sales Fulfilment. A missing account or closed period throws inside the transaction; the stock mutation and ledger row roll back with it.                                                                                                                                                                                                                                                                                                                                             |
| Exactly-once via the existing idempotency key | The journal is keyed `sourceType: 'INVENTORY_ADJUSTMENT'`, `sourceId: transaction.id` — the **canonical** `InventoryTransaction.id`, which Stage 4E.4B's `@@unique([organisationId, idempotencyKey])` already guarantees is created at most once per key. No new idempotency column anywhere; this composes two already-existing unique constraints (`InventoryTransaction`'s and `JournalEntry`'s own `(sourceType, sourceId)`).                                                                                                                                                                                                                               |
| No duplicate journals on retry                | Journal posting only ever runs on the `wasCreated: true` branch — the resolved-retry path (`resolveExistingAdjustment`) returns immediately without re-entering the transaction, so it is structurally impossible to attempt a second post for the same operation. `postSystemJournalEntry`'s own existing-row check is a belt-and-suspenders backstop, not the primary guarantee.                                                                                                                                                                                                                                                                              |
| Fail-closed on a missing system account       | `resolveSystemAccountId` already throws `MissingSystemAccountError` inside the transaction — reused as-is. **Deployment consequence, not a defect**: a tenant with no `INVENTORY_ADJUSTMENT` account configured will have every _value-bearing_ adjustment start failing the moment this policy ships, where today it silently succeeds with no journal. The account must be provisioned for every existing tenant in the same migration/release that activates posting (Section 6).                                                                                                                                                                            |
| Open-period enforcement                       | `resolveOpenPeriodId`, reused as-is, same transaction.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Correct ownership handling                    | `stock.ownership` is already read inside the transaction (the row is already fetched to apply the delta); `CUSTOMER`-owned stock skips posting categorically, per Section 2.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Accurate audit references                     | `sourceType: 'INVENTORY_ADJUSTMENT'` matches the existing `SCREAMING_SNAKE_CASE` convention (`GOODS_RECEIPT`, `PRODUCTION_RUN`, `SALES_FULFILMENT`, `SUPPLIER_RETURN`, ...); `sourceId` is the `InventoryTransaction.id` — a real, dereferenceable row, even with no dedicated `InventoryAdjustment` table, same "polymorphic reference, not a real FK" pattern already used everywhere. A new `INVENTORY_AUDIT_ACTIONS.ADJUSTMENT_JOURNAL_POSTED: 'inventory.adjustment.journal-entry-posted'` key, fired only when a journal was actually posted, mirrors the exact existing `SUPPLIER_RETURN_JOURNAL_POSTED`/`goods-receipt.journal-entry-posted` precedent. |
| Safe correction/reversal                      | No new reversal engine, matching §4's existing, explicit "do not build full reversal functionality unless simple and architecturally necessary" policy. A correction is a **new**, independently-keyed adjustment with the opposite sign — it posts its own normal entry, which is economically a mirror image of the original, with no special-cased "reversal" code path. A previously-posted adjustment journal is never edited or auto-reversed, exactly like every other `JournalEntry` in this codebase.                                                                                                                                                  |
| No silent GL/subledger divergence             | Every value-bearing case (non-zero-cost, organisation-owned, not an opening-stock establishment) **must** post, atomically, or the whole adjustment fails — never a quantity-only success with a skipped journal for a case the policy calls value-bearing. The three exemptions are deliberate and documented, not silent.                                                                                                                                                                                                                                                                                                                                     |

## 5. Operational simplicity

**No new UI, no new approval workflow, no new configuration screen.** The existing
Adjust Stock form needs zero new required inputs: valuation reuses the figure already
stored (`averageUnitCost`); the debit/credit accounts are resolved automatically by
`systemKey`, never user-chosen; all seven `AdjustmentReason` values keep their current
meaning and keep working exactly as before from the caller's point of view.
`idempotencyKey` stays optional, exactly as Stage 4E.4B left it — the atomicity
guarantee here does not depend on every caller supplying one.

**One small, additive API response change is the only thing that cannot reasonably be
avoided**: `StockAdjustmentResult` should carry a reference to the resulting journal
entry when one was posted (e.g. `journalEntryId: string | null`), the same way
`GoodsReceipt`/`SalesFulfilment`/`ProductionRun` responses already expose
`journalEntry`/`journalEntryId`. This is required for Finance traceability — "trace a
GL line back to its source" already works one direction (`JournalEntry.sourceId` →
the origin record); the other direction (origin record → its journal, for a human
checking "did my correction actually post?") does not exist for adjustments today
because no journal has ever existed to reference. This is a response-field addition on
an existing endpoint, not a new endpoint, screen, or workflow.

## 6. Implementation plan (smallest safe sequence, for a future stage — not this one)

1. **Schema**: none required by this policy's core mechanism — `InventoryTransaction`,
   `JournalEntry`, `ChartOfAccount` already carry everything needed. Optional, purely
   additive: nothing is strictly required even for the `journalEntryId` response field,
   since it can be resolved via `JournalEntry.findUnique({sourceType, sourceId})` at
   read time without a new column.
2. **Account configuration**: add `INVENTORY_ADJUSTMENT` to `SYSTEM_ACCOUNT_KEYS`; add
   one `ChartOfAccount` seed row per existing tenant (`isSystemAccount: true`,
   `systemKey: 'INVENTORY_ADJUSTMENT'`, `type: 'EXPENSE'`) — **must land before or
   atomically with** the code change that starts calling `postSystemJournalEntry` for
   adjustments, or every value-bearing adjustment will immediately start failing
   fail-closed for every tenant missing the account.
3. **Repository/service change**: inside `InventoryStockRepository.adjustStock()`'s
   existing `$transaction`, after the stock mutation and `InventoryTransaction.create()`
   succeed and only on the `wasCreated: true` path: if `stock.ownership === 'ORGANISATION'`
   and the referenceType is not `'OpeningStock'` and the computed value is `> 0`, call
   `postSystemJournalEntry(tx, {...})` with the debit/credit sides from Section 3, then
   attach the result to `AdjustStockResult`. No change to `recordOpeningStock` (stays
   categorically exempt) or to the negative-stock/P2002 paths (they already roll back
   before reaching this point).
4. **Journal posting**: no new posting primitive — direct reuse of
   `postSystemJournalEntry`, `SYSTEM_ACCOUNT_KEYS`, `resolveOpenPeriodId`.
5. **Unit tests**: one case per row of the Section 2 table (value-bearing by sign,
   zero-cost skip, customer-owned skip, opening-stock skip, missing-account failure
   rolls back stock too, closed-period failure rolls back stock too, retry posts no
   second journal, conflicting-key rejection still works unchanged).
6. **Real-PostgreSQL integration tests**: extend
   `inventory-adjustment-idempotency.integration.spec.ts`'s fixtures (which already
   build disposable products/locations) with a disposable `ChartOfAccount`/
   `AccountingPeriod` to prove, against real Postgres: a posted adjustment's stock
   mutation and journal are genuinely atomic (kill one, the other never commits — same
   "mid-transaction failure rolls back" proof pattern already used in
   `inventory-stock-concurrency.integration.spec.ts` Test F), and a true concurrent
   retry still produces exactly one journal, not just one `InventoryTransaction`.
7. **Migration and deployment safety**: the account-provisioning seed addition (step 2)
   is the only "migration-shaped" change, and it is purely additive (a new
   `ChartOfAccount` row, never touching existing rows) — apply it to a tenant's Chart of
   Accounts before enabling the code path, using the exact same guarded workflow Stage
   4E.4B.1 just used for the idempotency column. **No retroactive balancing journal for
   the existing synthetic discrepancy is proposed or needed** — this policy governs
   future adjustments only; `ReconciliationService`'s existing difference figure for
   past, unposted adjustments remains a reporting fact for accounting to review
   manually, exactly as §16.3 already documents.

## 7. Unresolved decisions requiring approval

1. **The single-account design** (`INVENTORY_ADJUSTMENT`, netting both directions) vs.
   a two-account alternative (separate `INVENTORY_SHRINKAGE`/`INVENTORY_GAIN`) for
   businesses that want gain and loss visible as separate P&L lines rather than one net
   figure. Recommendation: start with one account (smaller footprint, consistent with
   "do not create a large accounting redesign"); splitting later is a backward-compatible
   addition, not a breaking change, if a tenant ever asks for it.
2. **The `journalEntryId` response-field addition** (Section 5) — confirm this is
   acceptable as the one necessary API surface change, or confirm it can wait until
   implementation and be added then without a separate approval round.
3. **A pre-existing, adjacent finding, not part of this policy and not fixed here**:
   `InventoryValuationService.getValuation()` currently sums `quantityOnHand ×
averageUnitCost` across **every** `InventoryStock` row regardless of `ownership` —
   it does not exclude `CUSTOMER`-owned stock from the subledger total, contradicting
   that field's own schema-comment intent ("excluded from the organisation's own
   inventory valuation"). In practice this has no effect today (every `CUSTOMER`-owned
   row currently carries `averageUnitCost = 0` by construction, via every existing
   write path), but it is a latent gap worth a dedicated, separately-scoped review —
   flagged here only because this stage's ownership-based exemption (Section 2) depends
   on correctly understanding what the subledger total is actually supposed to mean.

## 8. Hard boundaries respected

No code changed, no database mutated, no new `ChartOfAccount`/`JournalEntry` rows
created, no reset/reseed, no accounting-period change, no unrelated refactoring, nothing
staged/committed/pushed. The safety copy and verified backup were not touched — this
stage did not open any database connection at all beyond the read-only exploration
already covered by normal source reading.

---

Stage 4E.4C is complete — design only, nothing implemented. Stopping here for approval,
per instruction.
