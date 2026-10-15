# Stage 4E.4C.1 — Final Accounting Implementation Readiness Check

Read-only. No code changed, no database touched, nothing staged or committed. This
re-verifies Stage 4E.4C's proposed policy against the actual current code before
authorizing implementation — and in doing so, **finds one incorrect assumption in the
4E.4C design doc**, corrected in Section 3 below.

## 1. Journal atomicity

**The exact API**: `postSystemJournalEntry(tx: Prisma.TransactionClient, input)` —
[journal-posting.ts:163](apps/api/src/finance/accounting/journal-posting.ts:163). It
takes a `Prisma.TransactionClient` directly (not its own `PrismaService`), so it runs
_inside whatever transaction the caller already opened_ — the same way
`SalesFulfilmentRepository.create()`, `ProductionRunRepository.complete()`, and
`GoodsReceiptRepository.receive()` already call it from inside their own
`$transaction`.

**Confirmed**: stock mutation, `InventoryTransaction` creation, journal creation, and
idempotency handling can commit or roll back together, because all four already live
inside `adjustStock()`'s single `this.prisma.$transaction(async (tx) => {...})` block
([inventory-stock.repository.ts:239-279](apps/api/src/inventory/inventory-stock.repository.ts:239)).
Adding a `postSystemJournalEntry(tx, ...)` call after the existing
`tx.inventoryTransaction.create()` (line 262) keeps it in the same `tx`, the same
callback, the same commit/rollback unit — no new transaction boundary.

**Proposed call sequence** (inside the existing `$transaction` callback, only on the
real-creation path, never the resolved-retry path):

```
1. applyStockAdjustmentIfNonNegative(tx, stockRef, quantity)   — unchanged, line 246
2. (on failure) throw NegativeStockError                        — unchanged, line 252
3. stock = tx.inventoryStock.findUniqueOrThrow(...)              — unchanged, line 257
4. transaction = tx.inventoryTransaction.create({..., idempotencyKey})  — unchanged, line 262
5. NEW: if stock.ownership === 'ORGANISATION'
         and referenceType !== 'OpeningStock'
         and value = roundCurrency(|quantity| × stock.averageUnitCost) > 0:
       postSystemJournalEntry(tx, {
         sourceType: 'INVENTORY_ADJUSTMENT',
         sourceId: transaction.id,
         lines: [ ... per Section 3 of the 4E.4C policy ... ],
       })
6. return { stock, transaction, wasCreated: true, journalEntryId }
```

**How concurrent retries avoid a duplicate journal** — composition of two
_already-existing_ unique constraints, no new one:

- `InventoryTransaction.@@unique([organisationId, idempotencyKey])` (Stage 4E.4B)
  guarantees step 4 commits **at most once** per key — a true concurrent race resolves
  via the existing `P2002`-catch-and-recover path (outside this transaction, on a fresh
  connection, as verified in Stage 4E.4B.1) and never re-enters steps 4-6 at all.
- `JournalEntry.@@unique([organisationId, sourceType, sourceId])`
  ([schema.prisma:3422](apps/api/prisma/schema.prisma:3422)) — already confirmed in the
  schema, already what `postSystemJournalEntry` checks via `findUnique` before
  inserting — guarantees step 5 commits at most once per `transaction.id`, as a
  belt-and-suspenders backstop _in case_ step 5 were ever reached twice for the same
  canonical row (it structurally can't be, since step 4's own uniqueness already
  prevents two different calls from producing the same `transaction.id`).

Net effect: the resolved-retry path (`resolveExistingAdjustment`) never calls
`postSystemJournalEntry` at all — it has nothing new to post, since the original
creating call already posted (or correctly skipped) the journal inside its own, already-
committed transaction. Zero duplicate-journal surface area.

## 2. Financial account classification

Read `financial-statement.service.ts` in full, not just its doc comments.

`getProfitAndLoss()`'s `operatingExpenseLines = toLines(rows, AccountType.EXPENSE,
'debit')` ([financial-statement.service.ts:122](apps/api/src/finance/reports/financial-statement.service.ts:122))
is a **dynamic filter by `AccountType`** — it iterates every `ChartOfAccount` row the
organisation has (via `getAccountBalances`), with no hardcoded list of specific
`systemKey`s anywhere. A new `EXPENSE`-type `INVENTORY_ADJUSTMENT` account is
automatically included the moment it exists and has posted lines — **no code change to
`FinancialStatementService` is needed**.

**Sign behavior, verified against the actual formula** (`toLines`,
[financial-statement.service.ts:225-238](apps/api/src/finance/reports/financial-statement.service.ts:225)):
for an `EXPENSE` account, `amount = row.netBalance` (debit-normal, no sign flip), and
`netBalance = totalDebit − totalCredit`.

- Net-debit period (losses > gains) → `netBalance > 0` → a **positive** expense line →
  reduces `netProfit`. Correct.
- Net-credit period (gains > losses) → `netBalance < 0` → a **negative** expense line
  within `operatingExpenseLines` → `operatingExpenses = sumLines(...)` is pulled down
  by that negative value → `netProfit = grossProfit − operatingExpenses` goes **up**.
  Correct — a net inventory gain correctly increases profit, with no special "contra-
  expense" flag anywhere; it falls out of plain signed summation.

**Confirmed: a single `EXPENSE`-classified account correctly supports both debit losses
and credit gains with no incorrect presentation.**

**Explicit reporting lists checked exhaustively** (every file under `finance/reports/`
and `ledger.service.ts` that references a specific `systemKey`):
`ReconciliationService` (`INVENTORY`, `FINISHED_GOODS_INVENTORY` only — the
_asset_-side GL-vs-subledger check) and `PayablesReconciliationService` (`AP` only).
Neither lists `INVENTORY_ADJUSTMENT`, and **neither should** — `INVENTORY_ADJUSTMENT`
is an expense-recognition account, not part of the inventory _asset_ balance those two
checks compare. `DashboardService`/`AccountsReceivableService`/
`AccountsPayableService` reference no inventory-specific keys at all.

**Confirmed: no explicit reporting account list needs to be updated.** The new account
flows into the P&L automatically and is correctly, structurally excluded from the one
list that exists.

## 3. Ownership and valuation — correction to Stage 4E.4C's design doc

4E.4C stated: _"every `CUSTOMER`-owned row currently carries `averageUnitCost = 0` by
construction, via every existing write path."_ **This is wrong.** Re-reading
`SalesFulfilmentRepository.create()` in full (not just the parts reviewed before)
surfaces a path that was missed.

**`InventoryValuationService.getValuation()` does include customer-owned
balances** — re-confirmed: its query has no `ownership` filter at all
([inventory-valuation.service.ts:58-66](apps/api/src/finance/reports/inventory-valuation.service.ts:58)),
summing `quantityOnHand × averageUnitCost` across every row regardless of ownership.

**Nonzero-cost `CUSTOMER`-owned balances CAN be created through a supported
workflow.** Phase 2C's D2C Collection Point ownership-transition event
([sales-fulfilment.repository.ts:337-360](apps/api/src/sales/sales-fulfilment.repository.ts:337))
calls `incrementStockWithCostIfCompatible(tx, destRef, item.quantity, cost.unitCost,
StockOwnership.CUSTOMER, StockArrangement.WHOLESALE)` using **the same real `unitCost`
the warehouse-side COGS journal is posted with** — not zero. This fires whenever a
`B2B` `SalesOrder` tied to an outlet with an already-provisioned `CUSTOMER_LOCATION`
(`Outlet.inventoryLocationId` → a dedicated location, via
`InventoryLocationRepository.findByOutletId`) is fulfilled — a real, documented,
not-rare business flow (Collection Point fulfilment), not a hypothetical edge case.
Even though that location's _opening_ balance is always recorded at cost `0`
(`recordOpeningStock`'s own unconditional rule), the moving-weighted-average formula
blends in the real incoming cost on the very first such fulfilment, making the
blended average nonzero from that point forward. This gap is not documented anywhere
today — not in `inventory-valuation.service.spec.ts`, not in the Phase 2C completion
report.

**Is adjustment posting financially inconsistent as a result?** Only for this one
subset, and only in one direction — not newly introduced, pre-existing:

- The 4E.4C policy's ownership exemption (never post a journal for a `CUSTOMER`-owned
  adjustment, since the organisation does not carry that stock as its own asset) is
  still the **correct GL-side call**, independent of this finding — it should not
  change.
- But `InventoryValuationService`'s subledger total **already** (today, before any of
  this policy exists) counts that same costed customer-owned stock, with **no GL
  counterpart at all** (no journal has ever existed for anything). Once the 4E.4C
  policy ships, `ORGANISATION`-owned adjustments start closing their part of the §16.7
  gap; `CUSTOMER`-owned adjustments correctly continue posting nothing — but the
  subledger they're measured against continues to over-count that stock, so this one
  pre-existing gap is not newly created by this policy and is not closed by it either.

**Smallest safe correction (design only, not implemented in this stage)**: add
`ownership: StockOwnership.ORGANISATION` to the `where` clause in
`InventoryValuationService.getValuation()`
([inventory-valuation.service.ts:58](apps/api/src/finance/reports/inventory-valuation.service.ts:58)) —
a one-line, additive filter, no schema change, no migration. This makes the subledger
match its own documented intent exactly, and makes it symmetric with the adjustment
policy's ownership exemption: customer-owned stock is excluded from _both_ the subledger
total and journal posting, closing the one remaining inconsistency cleanly. This fix is
independent of the adjustment-posting work — it corrects a pre-existing Phase 2C gap —
but achieving 4E.4C's own stated goal ("no silent GL/subledger divergence for
financially valued adjustments") is not fully true until both ship. Recommend doing
both in the same implementation stage, as two separate, small changes, not one change
pretending to be the other.

## 4. Costing and correction behavior

**Pre-adjustment cost, captured atomically**: `adjustStock()` never writes
`averageUnitCost` under any code path (confirmed again — only
`applyStockAdjustmentIfNonNegative`/`quantityOnHand` is touched); the cost is read from
the `stock` object already fetched at line 257, _after_ the row has already been
locked by the write at line 246. Because nothing in this transaction changes the cost,
and the row lock already serializes against any concurrent cost-changing writer (Goods
Receipt, Production Completion, another fulfilment), reading it from that
already-fetched object is correct — no separate, earlier read is needed or safer. This
should be stated as an explicit implementation note: capture cost from the `stock`
object already in scope at line 257, not a new query.

**Zero cost**: skip the journal entirely (never post a `₦0` entry), matching
Production/Sales Fulfilment's existing precedent exactly — the stock movement and
`InventoryTransaction` still happen unconditionally, only the journal is conditional.

**Sign changes**: not a distinct case to handle — the ledger is insert-only and each
`adjustStock()` call is independent; there is no stored "previous sign" to compare
against. Every call's own sign (positive/negative `quantity`) independently selects the
debit/credit side per the Section 3 posting rule in 4E.4C. A correction that flips a
prior position's direction is simply a new call with the opposite sign — same code
path, no branch for "this reverses an earlier one."

**Rounding**: unchanged, `roundCurrency(v) => Math.round(v*100)/100`, same as every
other domain's local helper and `postSystemJournalEntry`'s own internal rounding.

**Negative-stock prevention**: unaffected and unaffecting — `NegativeStockError`
(line 252) throws _before_ `tx.inventoryTransaction.create()` (line 262), which is
_before_ where journal posting would be inserted (step 5 above). A rejected adjustment
never reaches costing or posting at all; nothing new to guard here.

**Corrections and reversals**: no new reversal mechanism, matching
`docs/domains/accounting.md` §4's existing, explicit policy (once `POSTED`, never
edited; `VOID` is a bare status flip with no auto-reversing entry; a true correction is
a new entry the user creates). A correcting adjustment is simply a new, independently-
keyed `adjustStock()` call with the opposite sign, producing its own normal
(mirror-image) posting — no special-cased "reversal" code.

**`DATA_CORRECTION` cannot silently bypass financial recognition**: confirmed by
design, not by a special case — there is no code anywhere today that treats
`DATA_CORRECTION` (or any other `AdjustmentReason`) differently, and the proposed rule
makes every reason value-bearing by default, gated only on the three _structural_
exemptions (zero cost, customer ownership, opening-stock establishment) — never on
which enum value was chosen. There is no reason-based skip anywhere in the design for
`DATA_CORRECTION` or any other value to exploit.

## 5. Account provisioning

Re-confirmed: `ChartOfAccountService`'s own doc comment
([chart-of-account.service.ts:16-19](apps/api/src/finance/accounting/chart-of-account.service.ts:16))
states system accounts are "created only by seed data / future provisioning — no
endpoint here ever sets `isSystemAccount`/`systemKey`." Checked for any generic
runtime auto-provisioning mechanism (a "give every new organisation a full default
Chart of Accounts" routine) — **none exists**. The only two app-layer `ChartOfAccount`
creators are the generic user-facing CRUD (`chart-of-account.repository.ts`, which
`ChartOfAccountService` explicitly never uses for system accounts) and
`cash-account.repository.ts` (a narrow, unrelated child-account-under-`CASH_BANK_PARENT`
case). Every prior system-account key (`WIP`, `FINISHED_GOODS_INVENTORY`,
`PRODUCTION_LOSS`, `CASH_BANK_PARENT`, `OPENING_BALANCE_EQUITY`) was introduced the
same way: add the key to `SYSTEM_ACCOUNT_KEYS`, add one `ChartOfAccount` seed row per
_existing_ tenant. **This is the only mechanism this codebase has today**, for any
system account, not a limitation specific to this policy — flagged (not solved) in
4E.4C as a genuine, pre-existing gap for onboarding future tenants.

**Migration/deployment ordering, confirmed**: the seed addition (provisioning
`INVENTORY_ADJUSTMENT` for Boby Bites, the one existing tenant) must land _before or
atomically with_ the code change that starts calling `postSystemJournalEntry` for
adjustments — `resolveSystemAccountId` throws `MissingSystemAccountError` inside the
transaction (fail-closed), so deploying the posting code first would make every
value-bearing adjustment start failing where it previously silently succeeded.

## 6. Readiness verdict

**Confirmed safe decisions** (re-verified against current code, not just the prior
design doc):

- The exact atomicity mechanism (Section 1) — real, already in place, needs no new
  primitive.
- The single-`EXPENSE`-account P&L presentation (Section 2) — verified correct by
  reading the actual sign-handling formula, not assumed.
- No existing reporting list needs updating (Section 2).
- The zero-cost skip, sign-handling, rounding, negative-stock, and no-auto-reversal
  behaviors (Section 4) — all reuse existing, already-tested mechanisms correctly.
- `DATA_CORRECTION`/`OTHER` cannot bypass posting — there is no reason-based exemption
  anywhere in the design.
- The provisioning mechanism and deployment ordering (Section 5) — understood and
  achievable with the existing per-tenant seed pattern.

**Blocking design defect found — must be resolved before (or in the same stage as)
implementation**: 4E.4C's claim that customer-owned stock is always zero-cost was
incorrect (Section 3). The adjustment policy's ownership exemption itself is still
correct and does not need to change, but `InventoryValuationService.getValuation()`
must also be corrected (exclude `ownership: CUSTOMER`) for the stated "no silent
GL/subledger divergence" goal to actually hold for this subset. This is a small,
independent, additive fix — not a reason to abandon the policy, but it should ship
alongside it, not be silently dropped.

**Exact implementation files** (for the next, implementation-authorizing stage):

- `apps/api/src/inventory/inventory-stock.repository.ts` — `adjustStock()` (add the
  posting step), `AdjustStockResult` (add `journalEntryId`).
- `apps/api/src/inventory/inventory.service.ts` — `adjustStock()` /
  `StockAdjustmentResult` (propagate `journalEntryId`).
- `apps/api/src/inventory/inventory.controller.ts` — `toAdjustmentResponse` (surface
  `journalEntryId`); gate the new `INVENTORY_AUDIT_ACTIONS.ADJUSTMENT_JOURNAL_POSTED`
  audit event on "a journal was actually posted."
- `apps/api/src/inventory/inventory-audit-actions.ts` — add the new audit action key.
- `apps/api/src/finance/accounting/chart-of-account-keys.ts` — add
  `INVENTORY_ADJUSTMENT`.
- `apps/api/prisma/seed.ts` — one new `ChartOfAccount` row for Boby Bites.
- `apps/api/src/finance/reports/inventory-valuation.service.ts` — add the ownership
  filter (Section 3's correction).
- `docs/domains/accounting.md` §16.7 — update once implemented, to record the closed
  gap and the one remaining documented exemption (customer-owned stock).

**Required schema changes**: none. Every field needed already exists
(`InventoryTransaction.idempotencyKey`, `JournalEntry.sourceType`/`sourceId`,
`InventoryStock.ownership`). The `journalEntryId` response field is resolved at read
time from `JournalEntry.findUnique({sourceType, sourceId})`, not a new column.

**Minimum unit tests** (one per Section 2 policy-table row from 4E.4C, plus the
corrected ownership case): value-bearing positive/negative posting with correct
debit/credit sides; zero-cost skip; `CUSTOMER`-owned skip (with a nonzero-cost fixture,
given Section 3's finding — not just a zero-cost one); opening-stock skip; missing-
account failure rolls back the stock mutation too; closed-period failure rolls back the
stock mutation too; retry posts no second journal; conflicting-key rejection still
works unchanged; `InventoryValuationService` excludes `CUSTOMER`-owned rows after the
Section 3 fix.

**Minimum real-PostgreSQL integration tests**: extend
`inventory-adjustment-idempotency.integration.spec.ts`'s existing disposable fixtures
with a disposable `ChartOfAccount`/`AccountingPeriod` to prove, against real Postgres:
(a) a mid-transaction failure after the stock mutation but before/during journal
posting rolls back the stock change too (same "Test F" pattern already proven in
`inventory-stock-concurrency.integration.spec.ts`); (b) two genuinely concurrent
retries still produce exactly one journal, not just one `InventoryTransaction`; (c) a
costed `CUSTOMER`-owned adjustment (reusing this file's existing Customer-owned-stock
test, but seeded with a nonzero cost this time) posts no journal while the quantity
still moves.

**Safest implementation and migration sequence**:

1. Seed the new `ChartOfAccount` row (`INVENTORY_ADJUSTMENT`) for the existing tenant —
   additive, no risk, can land independently and first.
2. Add the `InventoryValuationService` ownership filter — additive, independent,
   one-line, can land independently and first or alongside step 1.
3. Implement the repository/service/controller posting logic, gated correctly on
   ownership + referenceType + nonzero value, inside the existing transaction.
4. Unit tests, then real-Postgres integration tests, then type-check/lint — exactly the
   verification sequence every prior stage in this engagement has followed.
5. No schema migration is required by this sequence; if the `journalEntryId` field is
   later promoted to a stored column instead of a read-time lookup, that would be its
   own small, separately-reviewed additive migration — not assumed here.

No code was changed, no database was touched, no journal was created, and the backup
and safety copy were not accessed in this stage.

---

Stage 4E.4C.1 is complete. Stopping here for approval, per instruction.
