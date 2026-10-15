# Stage 4E.1 — Financial Reconciliation Root-Cause Investigation

Strictly read-only investigation into three findings surfaced during Stage 4E
(Finance and Accounting Validation) of the Zentuva post-incident recovery effort. No
code was changed and no database was mutated during this investigation — the one
`$queryRaw` call used was a pure read-only reflection (`SELECT $1::timestamp`) that
touched no table.

## 1. Inventory-to-GL discrepancy (₦1,611,200) — fully traced

**The reconciliation widget's exact definition** (`src/finance/reports/
reconciliation.service.ts`): `glInventoryBalance = INVENTORY_system_account_balance +
FINISHED_GOODS_INVENTORY_system_account_balance`. **WIP is deliberately excluded** —
its own code comment cites `docs/domains/accounting.md §16.3`: "it represents
in-progress production value with no corresponding `InventoryStock` row." This
exclusion contributes ₦0 to the gap in this baseline, since WIP's net balance is
exactly ₦0 (fully cleared).

**Which accounts are actually "system accounts"** (verified from the live chart of
accounts): account 1300 "Inventory" → systemKey `INVENTORY`; account 1330 "Finished
Goods" → systemKey `FINISHED_GOODS_INVENTORY`. **Account 1310 "Raw Materials" has
`systemKey = NULL`** — not a system account at all, structurally invisible to this
reconciliation on either side. Its lone ₦5,000,000 debit comes from one unrelated
`SUPPLIER_INVOICE` "Path B" fixture (`CF-SINV-0001`) with no Goods Receipt link and no
physical stock counterpart — correctly excluded, not a contributing cause.

**The real, fully quantified cause — transaction-level:**

| Component                 | Subledger-side | GL-side                        | Gap            |
| ------------------------- | -------------- | ------------------------------ | -------------- |
| Raw materials + packaging | ₦2,033,800     | ₦1,146,800 (GL 1300 net)       | ₦887,000       |
| Finished goods            | ₦347,190       | −₦377,010 (GL 1330 net credit) | ₦724,200       |
| **Total**                 |                |                                | **₦1,611,200** |

Both sub-gaps trace to 8 seed-only `ADJUSTMENT`-type inventory transactions
(`referenceType` ∈ `ProductionSeedTopUp`, `SalesSeedTopUp`, `FinanceSeedTopUp`,
`ManualAdjustment`) that add physical quantity directly to `InventoryStock` with no
corresponding journal entry. Finished-goods component valued at current cost:
`FinanceSeedTopUp` (+1000 @ ₦426) + `SalesSeedTopUp` (+700 @ ₦426) + `SalesSeedTopUp`
(+250 @ ₦0) = ₦724,200 — exact match. Raw-material/packaging component ≈ ₦889,000,
within ~0.3% of target (residual explained by moving-weighted-average cost drift
between top-up time and today's snapshot cost).

Account 1330's own GL activity is fully and correctly explained by real postings alone
— debit side (₦291,810) equals the sum of the two real production completions'
accepted-value; credit side (₦668,820) equals the sum of the five real Sales
Fulfilment COGS entries. Every individual posting examined is correct; the gap is not
a posting error.

**Confirmed to affect real tenants, not just synthetic data:** `InventoryService.
adjustStock()` — behind the "Adjust Stock" UI button — has no journal-posting call
anywhere in its body. Any tenant using general-purpose stock adjustment will create
this same class of divergence. See `docs/domains/accounting.md §16.7` for the recorded
open policy decision.

## 2. Payables-to-GL discrepancy (₦1,430,000) — classified with evidence

`goods-receipt.repository.ts` contains zero references to `SupplierInvoice` — a goods
receipt never creates one; it posts directly to the journal (`DR Inventory / CR AP`)
and nothing else. Summing the AP-only portion of the 6 real goods receipts (excluding
the ₦15,000 routed to GRNI-pending-approval): ₦700,000 + ₦90,000 + ₦85,500 + ₦4,500 +
₦150,000 + ₦400,000 = **₦1,430,000 — exact match**.

**Decisive evidence**, from `src/finance/supplier-invoice-matching.ts`'s own header:
_"Path A... Goods Receipt already posted DR Inventory / CR AP... for the payable
portion at receiving time. A matching invoice line needs no new journal — it only
reconciles against... that existing liability."_ AP is recognized once, at
goods-receipt time, never twice. No double-counting risk.

**Classification:** (A) intended distinction — true, and dominant (sound accrual
accounting: recognize the liability when it arises, not when paperwork arrives). (C)
missing reconciliation/visibility — also true: `AccountsPayableService` is
deliberately SupplierInvoice-based only (explicit in its own header comment), with no
equivalent of Inventory's reconciliation widget to surface un-invoiced goods-receipt
accruals. (B), (D), (E) not supported by the evidence — no mislabeling, no posting
error, and the gap would occur for any real tenant with un-invoiced receipts, not only
synthetic data.

## 3. Accounting-period boundary — investigated to the edge of safe read-only testing

Host timezone is WAT (UTC+1, no DST). The stored "October 2026" period in development
is shifted exactly −1 hour from its intended UTC-midnight boundary on both
`startDate`/`endDate`; July/August are not shifted. A pure in-memory reproduction of
`computeCurrentMonthPeriodBounds` confirmed no bug in that function's own `Date.UTC()`
computation. A safe, read-only `$queryRaw` reflection test (no table write) showed
`Date.UTC()`-constructed and ISO-string-constructed equivalent dates both serialize
correctly today — ruling out a currently-reproducible, general Prisma/driver
timezone-serialization bug. This investigation could not, within the read-only
constraint, determine whether `prisma.accountingPeriod.create()`'s field-level
serialization path differs from the tested raw-parameter path — see Stage 4E.2 for the
definitive, disposable-fixture-based resolution of this open question.

## 4. The two trial-balance totals (₦102,702,768.16 vs ₦92,907,061.84)

Mathematically consistent, verified exactly: the difference (₦9,795,706.32) equals
precisely `Σ min(debit, credit)` across all 20 active accounts — the "churn" that nets
away within accounts carrying activity on both sides. Not a discrepancy — two
correct, different views (gross activity vs. net trial balance) of the same ledger.

## 5. Recommendations (ranked), evidence, and scope

See the full ranked recommendations delivered in this stage's chat completion report
for file/function-level evidence, financial impact, fixture-vs-general-logic
classification, minimal proposed fixes, regression-test requirements, and migration/
risk notes for each of the three findings. No fix was implemented in this
investigation stage.
