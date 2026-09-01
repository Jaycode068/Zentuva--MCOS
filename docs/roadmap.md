# Roadmap

This roadmap tracks the intended build order. It is not a commitment to dates — see
[Handbook Principle 1 (MVP First)](handbook/engineering-handbook.md#5-product-principles).

## Phase 0 — Engineering Foundation (this repository, current state)

- [x] Turborepo monorepo scaffold (`apps/web`, `apps/api`, `packages/*`)
- [x] Shared tooling: ESLint, Prettier, Husky, lint-staged, EditorConfig, path aliases
- [x] Shared TypeScript configuration
- [x] Docker + Docker Compose configuration
- [x] Health endpoint (`GET /api/health`)
- [x] Initial documentation (`docs/`)
- [ ] No authentication, users, products, or business modules — intentionally deferred

## Phase 1 — Identity & Organisation

- [x] Domain design (Sprint 1A) — see [`docs/domains/identity.md`](domains/identity.md)
- [x] Database & domain layer (Sprint 1B.1) — schema, migrations, seed data, repositories, service
      skeletons — see [`docs/sprint-1B.1-completion-report.md`](sprint-1B.1-completion-report.md)
- [x] Authentication layer (Sprint 1B.2) — JWT login/logout, refresh rotation, password reset,
      invitation acceptance, account locking — see
      [`docs/sprint-1B.2-completion-report.md`](sprint-1B.2-completion-report.md)
- [x] Organisation Profile API (Sprint 2.1) — `GET`/`PATCH /api/organisation/me`, minimal
      role-name authorization (Owner/Administrator write, Member read-only) — see
      [`docs/sprint-2.1-completion-report.md`](sprint-2.1-completion-report.md)
- [x] User Management API (Sprint 2.2) — list/view/create/update/activate/deactivate users,
      same role-name authorization pattern — see
      [`docs/sprint-2.2-completion-report.md`](sprint-2.2-completion-report.md)
- [ ] RBAC evaluation + permission guards (Sprints 2.1/2.2 added only a narrower role-name
      check, reused across both — not the full permission-key engine)
- [ ] Role/organisation/user-management API surface (Organisation Profile and User
      Management shipped in Sprints 2.1/2.2; Invitations and Role Management remain — see
      [`docs/backlog.md`](backlog.md) Epic 2)
- [ ] Tenant resolution middleware (Prisma Client Extension, identity.md §7)

## Phase 2 — Core Manufacturing & Commerce Domains

- [x] Product Catalogue — foundation shipped Sprint 4.1 (master product records); Sprint
      4.7 added a `ProductFamily → ProductVariant` grouping hierarchy on top of the flat
      catalogue, purely organisational — the SKU (`Product`) remains the sole
      transactional entity every other domain references; pricing, a dedicated pack-size
      entity, and family-level reporting remain — see
      [`docs/domains/catalogue.md`](domains/catalogue.md)
- [x] Supplier Management — foundation shipped Sprint 4.2 (master vendor records; Purchase
      Orders and Product–Supplier relationships arrive with Procurement); Sprint 12
      added a read-only Supplier detail view surfacing Finance's Accounts Payable
      balance for that supplier — see
      [`docs/domains/suppliers.md`](domains/suppliers.md)
- [x] Procurement — Purchase Order management shipped Sprint 4.3 (create/edit/cancel,
      automatic totals); status lifecycle now also reaches `PARTIALLY_RECEIVED`/
      `RECEIVED`, set by Inventory's receiving workflow (Sprint 4.4.1); Sprint 12
      added a read-only Financial Summary to the PO dialog (Finance's Accounts
      Payable rollup, shown alongside — never merged into — the existing Receiving
      Summary); approval workflow remains, and Supplier Invoices are Finance's own
      `SupplierInvoice` (Sprint 12), not a Procurement entity — see
      [`docs/domains/procurement.md`](domains/procurement.md)
- [x] Inventory — Goods Receiving shipped Sprint 4.4, refined Sprint 4.4.1 to
      distinguish Ordered/Delivered/Accepted/Rejected/Outstanding/Excess, receive
      multiple times against one order, and track a lightweight supplier-discrepancy
      resolution state; Sprint 4.5 added a minimal multi-location foundation (every
      balance is now Organisation+Product+Location) and controlled manual stock
      adjustments, into a live stock balance + immutable transaction ledger; Sprint 8
      wired Goods Receipt to the General Ledger and closed a real idempotency gap;
      Sprint 9 added the first persisted costing figure
      (`InventoryStock.averageUnitCost`, a moving weighted average, feeding
      Production's Material Issue); Sprint 10 made Sales Fulfilment a second reader of
      that same figure; Sprint 11 added `SupplierReturn` (excess-first AP/GRNI
      allocation) and Replacement Goods (reusing `receive()` unmodified, provably
      unable to double-pay), plus a new `RETURN` transaction type; warehouse
      transfers, reservation, a physical quarantine model, and a full WMS remain —
      see [`docs/domains/inventory.md`](domains/inventory.md)
- [x] Production — manufacturing foundation shipped Sprint 4.6 (Bill of Materials,
      Production Orders with an immutable requirement snapshot, Material Issue against
      Inventory's `InventoryTransaction` ledger, Production Execution with
      server-computed Accepted quantity, finished-goods receipt back into Inventory);
      Sprint 9 wired Material Issue and Production Completion to the General Ledger
      (`DR WIP / CR Raw Material Inventory`, then `CR WIP / DR Finished Goods
Inventory / DR Production Loss` split by accepted/rejected quantity), reusing
      Sprint 8's posting boundary; MRP/scheduling, labour/machine/overhead costing,
      multi-level BOMs, and batch/lot tracking remain — see
      [`docs/domains/production.md`](domains/production.md)
- [x] Sales — foundation shipped Sprint 4.8 (Customer master record with progressive
      onboarding; `SalesOrder`/`SalesOrderItem` targeting Sprint 4.7 SKUs only,
      server-authoritative totals, never touching inventory); Sprint 4.9 added
      Fulfilment — the one atomic, audited bridge into Inventory (`DRAFT → CONFIRMED →
PARTIALLY_FULFILLED → FULFILLED`, idempotent, multi-batch); Sprint 10 wired
      Fulfilment to the General Ledger (`DR Cost of Goods Sold / CR Finished Goods
Inventory`, one journal per batch, valued at Inventory's own moving-weighted-
      average cost), kept deliberately separate from Invoice's own AR/Revenue
      posting; Sprint 11 added `CustomerReturn` (request→receive, per-line
      disposition, COGS reversal, Credit Note issuance via Finance's existing engine)
      — inventory reservation and a pricing engine remain — see
      [`docs/domains/customers.md`](domains/customers.md),
      [`docs/domains/sales.md`](domains/sales.md)
- [x] Distribution — reframed as the Retail Intelligence Network, foundation shipped
      Sprint 4.8 (`Outlet`, `Territory` hierarchy, `DistributionNetworkRelationship` kept
      structurally separate from commercial transactions so direct sales never require a
      distributor mapping); Sprint 5 added `Dispatch`/`Delivery` (the physical release of
      already-fulfilled goods and confirmation of what arrived, chained off Sales
      Fulfilment, inventory deducted exactly once and never again at either stage);
      fleet/route planning remain (Customer/Supplier Returns are now built, but live
      in Sales/Inventory respectively — Sprint 11 — never in Distribution itself,
      matching this domain's existing "purely operational, never a business-event
      trigger" boundary) — see
      [`docs/domains/outlets.md`](domains/outlets.md),
      [`docs/domains/territories.md`](domains/territories.md),
      [`docs/domains/retail-network.md`](domains/retail-network.md),
      [`docs/domains/distribution.md`](domains/distribution.md)
- [x] Finance — foundation shipped Sprint 6 (Invoices raised against a `FULFILLED`
      Sales Order with permanently-snapshotted commercial terms; Payments with
      partial-settlement support via a `PaymentAllocation` join table designed for
      future multi-invoice allocation without a rewrite; a lightweight, flat-amount
      Credit Note; Accounts Receivable computed on read, never independently stored)
      — see [`docs/domains/finance.md`](domains/finance.md); Sprint 12 added the
      supplier-side mirror — Accounts Payable & Supplier Invoice Management, see
      finance.md §12; Sprint 13 added a read-only Financial Statements & Management
      Reporting layer — Profit & Loss, Balance Sheet, AR/AP ageing, Inventory
      Valuation/Reconciliation, a Management Dashboard — see finance.md §13; Sprint 14
      gave `Payment`/`SupplierPayment` an optional `cashAccountId` — see finance.md §14;
      Sprint 15 added a forward-looking Cashflow Management & Forecasting layer,
      never persisted, never posts — see finance.md §15; Sprint 16 added a
      Budgeting & Financial Planning layer, planned amounts only, actuals
      always read live from the Ledger — see finance.md §16
- [x] Accounting — foundation shipped Sprint 7 (tenant-defined Chart of Accounts,
      Accounting Periods, double-entry Journal Entries, General Ledger/Trial Balance/
      Account Activity; Finance's Invoice/Payment/Credit-Note events post
      automatically via a reusable, dependency-injection-free posting boundary);
      Sprint 8 proved that boundary's reusability by wiring Inventory's Goods Receipt
      to it (`DR Inventory / CR Accounts Payable`, with any accepted-beyond-ordered
      excess posting to a new `GRNI — Pending Approval` clearing account instead of
      inflating `AP`); Sprint 9 extended it into manufacturing (Production's Material
      Issue and Completion, two new system accounts — `WIP`, `PRODUCTION_LOSS` — plus
      elevating the existing Finished Goods account to a system account); Sprint 10
      closed the last major gap by wiring Sales's Fulfilment event (`DR Cost of Goods
Sold / CR Finished Goods Inventory`, no new system accounts needed — `COGS` had
      been seeded and reserved since Sprint 7); Sprint 11 wired the reverse flow —
      Customer Return (COGS reversal + independently-valued Credit Note) and Supplier
      Return (excess-first-allocated `AP`/`GRNI` reversal), zero new system accounts
      needed for either; Sprint 12 built a Supplier Invoice matching engine that caps
      AP recognition at exactly what Goods Receipt already posted (mathematically
      incapable of inflating it, a discrepancy is surfaced not hidden) plus a
      Path B posting for PO-less bills against an explicit, user-chosen Chart of
      Accounts entry — `SupplierPayment`/`SupplierCreditNote` mirror the customer-side
      engine exactly, zero new system accounts needed; Sprint 13 closed the
      financial-statement gap named above — Profit & Loss and Balance Sheet are
      derived from `ChartOfAccount.type` via normal-balance-sign summation (**zero
      schema changes**), a computed "Retained Earnings (Undistributed)" line makes
      the accounting equation hold without a year-end-closing mechanism, and AR/AP
      ageing plus an Inventory-to-Ledger Reconciliation (surfaces, never
      auto-corrects, a discrepancy) round out the reporting layer; Sprint 14 added
      two elevated system accounts (`CASH_BANK_PARENT`, `OPENING_BALANCE_EQUITY`)
      backing Cash & Bank Management's opening-balance postings (below); not a
      complete accounting system — a historical Cash Flow Statement (the
      indirect/direct-method report, distinct from Sprint 15's forward-looking
      forecast below), payment runs, an approval workflow to reclassify GRNI
      into AP, labour/machine/overhead costing, and multi-company
      consolidation remain; Sprint 15 added Cashflow Management (below) with
      **zero schema changes to any existing accounting model** and zero new
      system accounts; Sprint 16 added Budgeting (below), also with **zero
      schema changes to any existing accounting model** and zero new system
      accounts — see [`docs/domains/accounting.md`](domains/accounting.md)
- [x] Cash & Bank Management — foundation shipped Sprint 14 ("Cash & Bank
      Management / Reconciliation Foundation"). A `CashAccount` master, each linked
      to its own dedicated, system-provisioned Chart of Accounts row (never the
      generic `CASH`/`BANK` system accounts every `Payment`/`SupplierPayment`
      posted against before this sprint); an optional opening balance posted
      atomically at account creation; `CashTransaction` for cash movements outside
      the existing Payment/Supplier Payment flows; CSV bank-statement import
      (client-side column mapping, server-side re-validation and two-layer
      deduplication); and a `BankReconciliation` workflow — bulk unambiguous
      auto-match, manual match, a hard zero-unmatched completion rule, immutable
      once completed — distinguishing Book Balance from Reconciled Balance from
      Unreconciled Difference. Never a second accounting system: every posting goes
      through the same `postSystemJournalEntry` boundary every other domain uses,
      and `BankReconciliation` itself posts nothing at all. Explicitly a foundation
      for future loan/debt/investment management and capital-planning
      intelligence — cashflow forecasting (originally scoped here as future
      work) shipped the very next sprint, below — see
      [`docs/domains/cash-management.md`](domains/cash-management.md)
- [x] Cashflow Management & Forecasting — foundation shipped Sprint 15
      ("Cashflow Management & Forecasting"). Opening Cash + Inflows − Outflows =
      Closing Cash, **never persisted** — recomputed live on every request from
      outstanding AR/AP (reusing Sprint 13's aging queries unmodified) and Cash
      Account Book Balances (Sprint 14); management-entered known/recurring
      commitments kept structurally disjoint from real AR/AP so double-counting
      is impossible by construction, not by a de-dup check; Base/Conservative/
      Optimistic scenarios via configurable delay/multiplier knobs only, never a
      predictive model; a per-item forecast adjustment that overrides the
      projection without ever writing to the underlying Invoice/SupplierInvoice
      (proven both structurally and via live verification); a configurable
      minimum cash reserve with shortfall detection worded as a planning
      signal, never insolvency. Explicitly **not** budgeting, and explicitly not
      loan/debt/investment/capital management — though the source-type model is
      deliberately extensible toward one later — see
      [`docs/domains/cashflow.md`](domains/cashflow.md)
- [x] Budgeting & Financial Planning — foundation shipped Sprint 16
      ("Budgeting & Financial Planning Foundation"). A `Budget` row is its own
      version _and_ its own scenario — no separate `BudgetVersion`/
      `BudgetScenario` tables; `BudgetLine`s distinguish Revenue/Operating
      Expense (a required Chart of Accounts reference) from CAPEX (optional —
      no Fixed Asset account exists yet); Budget vs Actual reads the General
      Ledger live via the same normal-balance-sign convention Sprint 13
      established, never duplicating a balance; Budget vs Forecast genuinely
      reuses Sprint 15's own `CashflowForecastService`, never a second engine;
      Cost Centres are a lightweight budget-line tag, never linked to the
      Chart of Accounts. Explicitly a foundation for a future capital/debt
      management epic — shipped the very next sprint, below — see
      [`docs/domains/budgeting.md`](domains/budgeting.md)
- [x] Capital & Debt Management — foundation shipped Sprint 17 ("Capital &
      Debt Management Foundation"). A `CapitalRequirement` (the business case
      for financing, not yet an approved loan) → `DebtFacility` (`PROPOSED →
APPROVED → ACTIVE → PARTIALLY_REPAID → PAID_OFF`) → `DebtDrawdown`/
      `DebtRepayment` chain, posting through the same General Ledger boundary
      every other Finance domain uses — never a global loan liability account
      (the Sprint 12 "Path B" account pattern reused a third time); a
      server-generated repayment schedule (Amortising/Interest-Only/Bullet,
      explicit grace-period behaviour) computed once at facility creation; a
      debt balance always computed live, never stored; server-side rejection
      of over-repayment and automatic `PAID_OFF` on full early repayment; a
      `PROPOSED` facility doubles as its own financing-scenario preview,
      structurally invisible to the live forecast/GL until an actual
      drawdown activates it; outstanding schedule installments feed the
      existing Cashflow Forecast as financing outflows, which in turn flow
      into Budget vs Forecast automatically — no Budget-side code change
      needed. Explicitly not investment/equity/bond/fixed-asset management, a
      loan-application workflow, credit scoring, or a full NPV/IRR/DCF
      engine — see [`docs/domains/debt-management.md`](domains/debt-management.md)
- [x] Investment / Capital Project Management — foundation shipped Sprint 18
      ("Investment / Capital Project Management Foundation"). A
      `CapitalProject` (`DRAFT → PROPOSED → UNDER_REVIEW → APPROVED → ACTIVE
  → COMPLETED`, plus `ON_HOLD`/`CANCELLED`) whose Planned Cost is always
      the server-computed sum of its own cost lines, never a stored total;
      Committed/Actual Cost derived live from an optionally-linked Purchase
      Order (one new nullable FK, zero changes to Procurement itself) and
      the existing Accounts Payable recognition Sprint 12 already built;
      `CapitalProjectFunding` (Cash/Debt/Other) referencing an existing
      `DebtFacility`/`CashAccount` directly — the repayment schedule stays
      owned entirely by Sprint 17, never duplicated — with Fully/Under/
      Overfunded status always computed live; an optional, independent link
      to a Capital Requirement and/or Budget (read-only Budget Allocation
      %, never mutating the budget); an `ACTIVE` project's planned cost
      lines feed the existing Cashflow Forecast as outflows, excluded once
      a real Purchase Order is linked to avoid double-counting. Explicitly
      not the investment-decision engine — no NPV/IRR/ROI/payback/scenario
      comparison, prepared for but not built — see
      [`docs/domains/investment-projects.md`](domains/investment-projects.md)
- [x] Financial Decision & Scenario Analysis — foundation shipped Sprint 19
      ("Financial Decision, Scenario Analysis & Management Financial
      Cockpit"), **the capstone, closing sprint of the Finance MVP**. A
      `DecisionAnalysis` (`DRAFT → UNDER_REVIEW → {APPROVED | REJECTED}`)
      optionally links an existing Capital Project/Debt Facility, read-only;
      `DecisionScenario`s (Base/Optimistic/Pessimistic/Custom) hold raw
      assumptions only — ROI/NPV/IRR/Payback/Break-Even/Sensitivity/
      Recommendation are all computed live, never stored; an FCFE-style
      cashflow construction (financing effects included directly in the
      discounted stream — the only convention under which funding structure
      changes NPV); a robust bisection-based IRR returning "unavailable"
      rather than a misleading value; a rule-based, transparent,
      configurable recommendation (never an AI judgement); a Cashflow
      Impact preview that overlays the real Cashflow Forecast in memory
      only, never persisting a forecast row; a Budget Impact reusing the
      existing Budget Allocation formula unmodified; two small new
      cross-link sections on the existing Finance Overview page.
      **Scenario analysis is 100% side-effect-free** — zero Journal
      Entries, zero mutation of any real Cash/Debt/Budget/Capital Project
      record. The Finance MVP, as scoped, is now considered functionally
      complete — see
      [`docs/domains/financial-decision-analysis.md`](domains/financial-decision-analysis.md)

## Phase 3 — Extended Experiences

- [ ] Retail Portal (mobile)
- [ ] Sales Rep mobile workflows
- [ ] Business Intelligence dashboards

## Future

- HR, CRM Automation, Consumer Portal, Loyalty, Promotions, AI Services, Analytics, Marketplace.
