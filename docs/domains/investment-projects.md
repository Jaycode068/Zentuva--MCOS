# Investment / Capital Project Management Domain

- **Status:** Foundation implemented — Sprint 18 ("Investment / Capital
  Project Management Foundation"). A management and planning layer over
  Sprints 13-17 (Accounting, Cash, Cashflow, Budgeting, Debt) and
  Procurement/AP — never a second accounting, budgeting, cashflow, debt,
  procurement, or inventory engine. **Not** the financial-decision engine
  (no NPV/IRR/ROI/payback/scenario comparison) — that was §11's own
  handoff to Sprint 19, now built; see
  [Financial Decision & Scenario Analysis](financial-decision-analysis.md).
  A `DecisionAnalysis` may optionally link to a `CapitalProject` here,
  read-only, inheriting its live Planned Cost/Budget Allocation.
- **Sprint:** 18
- **Depends on:** [Accounting](accounting.md) (read-only, via Procurement's
  own `PurchaseOrderRepository` and Finance's own
  `SupplierInvoiceRepository.getApByPurchaseOrder()`),
  [Budgeting](budgeting.md) (`Budget`/`BudgetLine`, read-only references),
  [Debt Management](debt-management.md) (`DebtFacility`, read-only
  reference — the repayment schedule stays owned entirely there),
  [Cash Management](cash-management.md) (`CashAccount`, read-only
  reference), [Cashflow](cashflow.md) (`CashflowForecastService.
getForecast()`, extended in place with one new source), Procurement
  (`PurchaseOrderRepository`, read-only — the one deliberate cross-domain
  exception, already imported into `FinanceModule` since Sprint 12),
  [Identity](identity.md) (tenant boundary, `RolesGuard`, `AuditService`).
- **Explicitly does not depend on:** [Sales](sales.md),
  [Production](production.md), [Inventory](inventory.md),
  [Distribution](distribution.md) — proven executably by
  `investment-independence.spec.ts` (`apps/api/src/finance/investment/`),
  not just documented here.
- **See also:** [Finance](finance.md) §18, [Accounting](accounting.md) §29,
  [Cashflow](cashflow.md) §14, [Budgeting](budgeting.md) §14,
  [Debt Management](debt-management.md) §14,
  [Sprint 18 Completion Report](../sprint-18-completion-report.md).

## 1. Business Purpose

A capital project represents a significant investment decision being
planned or executed — a machine purchase, a factory expansion, a vehicle
fleet addition. `CapitalRequirement` (Sprint 17) records _why_ money is
needed; `DebtFacility` (Sprint 17) records _how_ debt financing works.
Neither represents the project itself: its own cost plan, funding mix,
timeline, and financial performance. Sprint 18 closes that gap by
**composing** the capabilities already built, never rebuilding any of them.

```
Capital Requirement (why)          Debt Facility (how debt works)
         │                                    │
         └──────────────► Capital Project ◄───┘
                     (the investment itself)
                                │
              Cost Plan · Funding · Budget Allocation
                                │
                Committed/Actual Cost (derived, live)
                                │
                Cashflow Forecast (planned outflows)
                                │
        (future) Sprint 19 — ROI / NPV / IRR / Payback
```

## 2. Critical Architectural Principle — Planning Is Not Accounting

Creating, updating, or transitioning a `CapitalProject`/
`CapitalProjectCostLine`/`CapitalProjectFunding` row **never** calls
`postSystemJournalEntry` — proven structurally by
`investment-independence.spec.ts`. Real capital expenditure continues to
flow through the _existing_ Procurement→Goods Receipt→Supplier
Invoice→Payment chain and its own existing accounting postings; this
domain only reads that chain's results.

## 3. `CapitalProject` — the Investment Itself

`CapitalProject` records identity, category, dates, status, and — when
relevant — optional references to a `CostCentre`, a `CapitalRequirement`, and
a `Budget`/`BudgetLine`. A project need not originate from a Capital
Requirement (brief's own explicit instruction — the link is optional in both
directions). `projectCode` is auto-generated (`CAP-000001`, ...), unique per
organisation, immutable — the same collision-avoidance pattern
`DebtFacility.facilityCode`/`CapitalRequirement` already use.

**Planned Cost is never a stored, separately-entered field.** It is always
`Σ CapitalProjectCostLine.plannedAmount`, computed on every read — the
brief's own explicit "never trust a client-supplied total" instruction. The
worked example's "Estimated Cost: ₦60M" is the _displayed_ sum, not a stored
column.

## 4. Lifecycle

```
DRAFT ──submit──▶ PROPOSED ──start-review──▶ UNDER_REVIEW ──approve──▶ APPROVED ──activate──▶ ACTIVE ──complete──▶ COMPLETED
                                                   │reject                                        │
                                                   ▼                                    hold ──▶ ON_HOLD ──resume──▶ (back to ACTIVE)
                                                 DRAFT                                             │
                                                                                              cancel (from ON_HOLD)
DRAFT/PROPOSED/UNDER_REVIEW/APPROVED/ON_HOLD ──cancel──▶ CANCELLED
```

`reject()` (`UNDER_REVIEW → DRAFT`) sends the project back for revision
rather than a dead end — an explicit design decision, since the brief lists
`UNDER_REVIEW` as reachable from "approved/rejected" without specifying the
rejection target. **`cancel()` is never reachable directly from `ACTIVE`** —
the same "never cancel something already in motion without an explicit
pause first" discipline `DebtFacility` established in Sprint 17; an active
project must be placed `ON_HOLD` first. `actualStartDate`/
`actualCompletionDate` are set **automatically** by `activate()`/
`complete()` — never manually entered, the established "automatic status
transitions, never manual flips" convention since Sprint 17.

**Editability.** Header fields and cost lines are freely editable only
while `DRAFT` — the Sprint 16 `Budget`-line precedent (DRAFT-only edit, then
read-only until a defined transition). **Funding remains editable through
`PROPOSED`/`UNDER_REVIEW`/`APPROVED`/`ACTIVE`** (not `COMPLETED`/
`CANCELLED`) — deliberately looser than cost lines, since financing is often
arranged _after_ a plan is approved, not only while still a draft.

## 5. Idempotency — Soft, Status-Based, for Transitions; Key-Based for Real Writes

`CapitalProject.create()` and `CapitalProjectFunding` creation both
idempotency-check-first inside their own transaction (the standard Sprint
9/10 lesson — genuine new-row creation). Pure **status transitions**
(`submit`/`approve`/`reject`/`activate`/`hold`/`resume`/`complete`/
`cancel`) use a different, simpler mechanism: calling `approve()` when the
project is _already_ `APPROVED` returns the current row unchanged, with no
new audit event and no error. This is a stronger, simpler guarantee than
key-matching for an operation whose only side effect is the status flip
itself, and it directly satisfies "a valid retry returns the original
result" without a proliferation of per-transition key columns.

## 6. Committed / Actual Cost — One New Read-Only Cross-Domain Reference

`CapitalProjectCostLine.purchaseOrderId String?` is a **nullable FK on
Investment's own new table**, pointing outward at Procurement's existing
`PurchaseOrder`. **Zero schema or module changes to Procurement itself.**

- **Committed Cost** = `Σ PurchaseOrder.total` for every linked,
  non-`CANCELLED` PO (via the already-injected `PurchaseOrderRepository.
findById()`).
- **Actual Cost** = `Σ getApByPurchaseOrder(...).aggregate._sum.
recognizedAmount` per linked PO — an already-exported Sprint 12 method
  (built for the Purchase Order dialog's own "Financial Summary" block),
  reused completely unmodified.
- **Remaining Cost** = `plannedCost − committedCost` — budget headroom not
  yet obligated via any PO. (Documented explicitly: this is _not_
  `plannedCost − actualCost`, which would answer a different question —
  "how much of what's been ordered hasn't been paid yet" — a figure this
  sprint does not separately expose.)

Cost lines with no linked PO (training, contingency, and similar) show ₦0
committed/actual until a supporting PO/invoice exists — a documented
limitation, the same posture Sprint 16 already took for CAPEX lines with no
linked Chart of Accounts row.

## 7. Funding — Reference, Never Duplicate, Debt/Cash

`CapitalProjectFunding {fundingType: CASH|DEBT|OTHER, amount,
debtFacilityId?, cashAccountId?}`. `debtFacilityId` (required when `DEBT`)
is a plain read-only reference to a Sprint 17 `DebtFacility` — the project
displays that facility's own live balance/monthly-debt-service via the
_existing_ `GET /finance/debt/facilities/:id` response, never a duplicated
repayment schedule. `cashAccountId` is optional even for `CASH` type.

**Funding status is always calculated, never entered:**
`totalFunding = Σ CapitalProjectFunding.amount`; `fundingGap = max(0,
plannedCost − totalFunding)`; `fundingStatus` is `FULLY_FUNDED` /
`UNDERFUNDED` / `OVERFUNDED` accordingly. An underfunded project is
explicitly allowed to exist — the brief's own instruction; management may
legitimately still be arranging financing.

## 8. Budget Integration — Independent of Capital Requirement

`CapitalProject.budgetId`/`.budgetLineId` are **separate, optional,
read-only** references — not derived from `capitalRequirementId`, even when
both are set, since a project may reference a more specific line than its
parent requirement did. `GET :id/budget-allocation` computes
`budgetedAmount`/`plannedCost`/`allocationPercent` live, the same formula
shape as Sprint 17's `CapitalRequirementService.getBudgetCoverage()`
(reimplemented locally, not shared — a ~5-line formula, matching this
codebase's own convention of not prematurely abstracting small formulas
across domains) — **never mutates the budget**.

## 9. Cashflow Integration — One New Outflow Source, Not a Second Engine

`CashflowForecastSourceType` gains one additive value, `CAPITAL_PROJECT`.
`CapitalProjectRepository.findPlannedCostLinesForForecast()` returns cost
lines only for **`ACTIVE`** projects (not `PROPOSED`/`APPROVED`/`ON_HOLD` —
execution must have actually begun, mirroring `DebtFacility`'s own
`ACTIVE`-only forecast-visibility bar) **and only where `purchaseOrderId IS
NULL`** — once a cost line has a real linked PO, the _existing_
`SUPPLIER_PAYABLE` AP forecast source already represents that future cash
movement more accurately; including both would double-count (the exact
non-duplication discipline Sprint 15 already established for AR/AP). Each
becomes one `OUTFLOW` line at the cost line's own `plannedMonth`, confidence
`ESTIMATED` — a planning assumption, not a confirmed obligation.

No separate milestone/schedule model was built: a cost line's own
`plannedMonth` doubles as its planned cash-outflow timing, the exact Sprint
16 `BudgetLine.periodMonth` precedent.

## 10. Investment Metrics — Foundation Only

A project may carry planning assumptions: `expectedAnnualRevenueImpact`,
`expectedAnnualOperatingCostImpact`, `expectedAnnualSavings`,
`usefulLifeYears`, `currentCapacityUnitsPerDay`/
`expectedCapacityUnitsPerDay`, `expectedCommissioningDate`. These are **raw
inputs for a future Sprint 19 decision engine** — never a calculated
ROI/NPV/IRR/payback here. The Assumptions section of the project detail
page states this explicitly.

## 11. Sprint 19 Handoff

Sprint 19 ("Financial Decision & Scenario Analysis") can read, directly,
without any schema change to this domain:

- `CapitalProject`'s own planning assumptions (§10) — expected revenue/cost
  impact, useful life, capacity change, commissioning date.
- `CapitalProjectCostLine`'s own planned/committed/actual figures (§6) —
  the investment cost side of any calculation.
- `CapitalProjectFunding`'s own funding mix (§7) — cash vs. debt, and via
  the linked `DebtFacility`, its real interest rate/repayment schedule for
  a financing-cost calculation.
- The Budget Allocation (§8) and Cashflow Forecast integration (§9) — for
  budget-impact and cashflow-impact inputs.

Sprint 19 would combine these with the organisation's own Financial
Statements, current cash, AR/AP, and the Cashflow Forecast to compute ROI,
NPV, IRR, payback period, break-even, scenario comparison, sensitivity
analysis, and financing-alternative comparison — none of which Sprint 18
calculates.

## 12. Known Limitations / Non-Goals

- **No investment-decision engine** — no NPV, IRR, ROI, payback, sensitivity
  analysis, or scenario comparison. See §11.
- **No financing-allocation optimisation** (e.g. an automatic "70% debt /
  30% cash" recommendation) — funding sources are entered directly by the
  user.
- **No Purchase Order picker in the cost-line create form** — the backend
  fully supports `CapitalProjectCostLine.purchaseOrderId` (linking via the
  API), but the Sprint 18 UI does not yet expose that picker; a small
  follow-up, not a foundation gap, since the underlying capability and
  read-aggregation both exist and are tested.
- **Costs paid outside the Procurement→Supplier Invoice chain** (a training
  session invoiced directly, a cash withdrawal) show no Actual Cost until a
  supporting PO/invoice exists — a documented consequence of deriving
  Actual Cost only from that one, already-existing chain, not an attempt to
  build a second, parallel expense-recording mechanism.
- **No Gantt chart, task breakdown, or full project-management
  functionality** — this is a financial/management OS, not a project-
  management tool. Timeline shows only planned vs. actual start/completion.
- **No configurable-permission RBAC model** — the same deferred decision as
  every prior sprint.
