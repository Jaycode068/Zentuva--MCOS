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
- [x] Asset Register — foundation shipped Sprint 20 ("Asset Register &
      Asset Management Foundation"), opening Epic 14 (Asset & Maintenance
      Management). A genuinely new top-level domain — not a Product, not
      an `InventoryStock` row, not a Purchase Order — for the durable
      physical resources the business owns: tenant-scoped hierarchical
      Asset Categories; a central `Asset` entity (server-generated
      `assetCode`, separate optional user-defined `assetTag`); lifecycle
      kept strictly separate from physical condition; a self-referencing,
      cycle-guarded asset hierarchy; a new, purpose-built `AssetLocation`
      (Inventory's own `InventoryLocation` confirmed unsuitable for
      reuse); custody via the established plain-id convention, no new HR
      model; immutable movement history; optional read-only links to
      Supplier/Purchase Order/Capital Project; a meter/reading foundation
      (manual entry, no IoT); warranty Active/Expired/None classification,
      no claims workflow; documents/photos via both established
      file-attachment patterns. **Zero accounting integration, by
      construction** — proven by `asset-independence.spec.ts`. Explicitly
      the foundation a future Maintenance Management sprint will build on
      — no preventive/corrective maintenance, work orders, downtime,
      spare-parts consumption, or maintenance costing was implemented, only
      documented integration points — see
      [`docs/domains/assets.md`](domains/assets.md)
- [x] Maintenance Management — foundation shipped Sprint 21 ("Maintenance
      Management Foundation"), completing Epic 14's foundation scope on
      top of Sprint 20's Asset Register. Reusable Maintenance Plans
      (targeting a specific asset or an asset category, never both) with
      an inline checklist template; date-/meter-based Schedules whose
      `generate()` is idempotent by construction — it advances its own
      due marker to the next occurrence inside the same transaction that
      creates a work order, so a repeat call structurally finds nothing
      due, proven live (two consecutive calls, one work order); meter
      readings reuse Sprint 20's own `AssetMeter` infrastructure directly,
      never a second meter system; Maintenance Requests (report → approve/
      reject → convert to a Work Order); the Work Order lifecycle (`OPEN →
ASSIGNED → IN_PROGRESS ⇄ ON_HOLD → COMPLETED`/`CANCELLED`, both
      hard-terminal) with a mobile-first technician workflow (checklist
      tasks, camera-capture photos, one large primary action per status);
      completion is one atomic transaction validating every mandatory
      task, auto-closing open downtime, and recording a meter reading via
      a transaction-joinable function extracted from Sprint 20's own
      meter repository; a dedicated `AssetDowntime` table with duration
      always derived from timestamps, never stored; operational parts-
      usage and cost records referencing the existing Product/Supplier
      masters, with `totalCost` always server-computed. **Zero accounting
      or inventory-mutation side effects, by construction** — proven by
      `maintenance-independence.spec.ts` and confirmed live with
      byte-identical before/after `JournalEntry`/`InventoryStock` row
      counts. Every `IN_SERVICE ⇄ UNDER_MAINTENANCE` transition is driven
      through Asset's own lifecycle service, never a raw update. No
      predictive maintenance, IoT, spare-parts inventory deduction, or
      accounting posting was implemented — only the correct source data
      for a future Maintenance Intelligence layer — see
      [`docs/domains/maintenance.md`](domains/maintenance.md)
- [x] Maintenance Ecosystem Integration — shipped Sprint 22, connecting
      Sprint 21's zero-integration Maintenance domain to the rest of the
      ecosystem through narrow, documented boundaries: real Inventory
      part-issuing (one deliberate, structurally-proven exception to the
      domain's own no-cross-domain-writes rule), a Procurement linking
      boundary, Budget cost-vs-budget comparison, a read-side Production
      downtime feed, and a Maintenance Analytics service/page. Frontend:
      the Analytics page, the Asset Register detail page's extended
      Maintenance section, and a new mobile-first Field Technician surface
      (`/technician`, its own shell, separate from Field Sales) built on
      the existing `assignedToId`
      convention — no new RBAC role. Zero accounting postings; full live
      cross-surface verification (Work Order ⇄ Asset ⇄ Analytics). See
      [`docs/domains/maintenance-integration.md`](domains/maintenance-integration.md)

## Phase 3 — Extended Experiences

- [x] HR Employee Lifecycle Foundation — shipped Sprint 23. Department/
      Position (organisational units and job titles, explicitly never
      application permission roles), Employee (the central HR record,
      deliberately separate from `User` — not every employee has a login
      account, not every user is an employee), EmployeeDocument (metadata
      only), EmployeeOnboarding/EmployeeOnboardingTask (a default 7-task
      checklist, not a workflow engine). A real `employmentStatus`
      lifecycle validated server-side by the exact
      `AssetService.transition()` generic guard; a shared cycle-detection
      utility guards Department/Position/Employee-manager hierarchies
      alike. Reuses Identity's `UserService`/`AuditService`/guards
      unchanged — no fine-grained permission key introduced this sprint
      (built in Sprint 25). Zero accounting/inventory/procurement/production/
      sales/distribution/asset/maintenance integration, by construction,
      proven by `hr-independence.spec.ts`. Explicitly not payroll,
      attendance, recruitment, performance, or workflow — see
      [`docs/domains/hr.md`](domains/hr.md)
- [x] HR Attendance, Training & People Operations — shipped Sprint 24.
      Extends the Sprint 23 foundation with `WorkSchedule` (expected
      hours), `AttendanceRecord`/`AttendanceCorrectionRequest`
      (server-authoritative sign-in/out, one row per employee per
      organisation-local day derived from `Organisation.timeZone`,
      privacy-conscious optional location capture that is never
      fabricated, lazily-derived `INCOMPLETE`/training-`OVERDUE`
      statuses instead of a cron job, a dedicated correction-request/
      review entity applied atomically), `Policy`/`PolicyVersion`/
      `PolicyAcknowledgement` (versioned catalogue, publishing
      auto-archives the prior version, published versions immutable),
      and `TrainingCourse`/`EmployeeTraining` (a lightweight catalogue,
      explicitly not an LMS) — plus a new dedicated self-service mobile
      surface at `/attendance`, separate from Field Sales/Field
      Maintenance by the same reasoning that already separated those
      two. No fine-grained permission key introduced this sprint (built
      in Sprint 25); zero accounting/inventory/procurement/production/
      sales/distribution/asset/maintenance integration, by construction,
      proven by `hr-independence.spec.ts`. Explicitly still not payroll,
      leave management, recruitment, performance, an LMS, or a
      workflow/notification engine — see
      [`docs/domains/hr.md`](domains/hr.md)
- [x] Access Control + Organisational Structure — shipped Sprint 25.
      Finally wires up the `Role`/`Permission`/`RolePermission`/
      `UserRole` tables Identity seeded in Sprint 1B.1 but that no guard
      had ever read: an 88-entry `module.resource.action` permission
      catalogue; an `AccessScope` model where an absent/`NONE` scope is
      never interpreted as unrestricted access; tenant-configurable
      roles (system roles Owner/Administrator/Member protected, full
      custom-role CRUD/duplicate/archive-restore); `EffectiveAccessResolver`
      (union-of-active-roles, `Owner` bypass, live `User.status` gating
      so revocation takes effect on the very next request against an
      already-issued token); `PermissionsGuard`/`CommonAccessGuard`
      migrated onto 21 of the codebase's highest-risk mutation endpoints
      (journal posting, invoice issue/cancel, payment create/cancel, PO
      create/cancel, goods receipt, production material issue/complete,
      maintenance work-order complete, employee separation) with an
      exhaustive, honest list of every domain still on the old role-name
      check or no check at all; an organisation-wide Common Employee
      Access self-service policy layered on top of role grants; a
      desktop-first `/settings/access` admin UI. Not Workflow,
      Notifications, or a policy-as-code engine — see
      [`docs/domains/access-control.md`](domains/access-control.md)
- [x] Authorization Coverage & Scope Enforcement — shipped Sprint 25.1.
      A hardening pass, not a redesign: a full endpoint inventory (534
      routes across 83 controllers, every one explicitly classified);
      the legacy `RolesGuard`/`@Roles` mechanism eliminated entirely
      (261 → 0 routes remaining); `PermissionsGuard`/`@RequirePermission`
      now protects 509/534 routes (up from 21 at Sprint 25 launch),
      including every previously-unguarded sensitive `GET` (financial
      statements, trial balance, invoices, payments, purchase orders,
      inventory, production, maintenance work orders, employee records,
      and more); 33 new permission-catalogue entries (88 → 121) closing
      genuine gaps rather than inventing broad new ones; real `OWN_TEAM`/
      `OWN_RECORDS` scope enforcement added for Sales orders and HR
      Attendance (extending Sprint 25's HR employee-list pattern);
      `ASSIGNED_TERRITORY`/`ASSIGNED_ASSETS` honestly left unenforced —
      no server-side data proves them yet — never silently granted;
      four real bugs found and fixed via live verification (an
      orphaned-permission gap, a permission mis-mapping, an
      over-broad `.manage`-only permission blocking a least-privilege
      role's reads, and a 400-vs-404 tenant-isolation convention bug).
      See [`docs/architecture/authorization-coverage.md`](architecture/authorization-coverage.md)
      and [`docs/sprint-25.1-completion-report.md`](sprint-25.1-completion-report.md)
- [x] Workflow & Approval Foundation — shipped Sprint 26. A reusable,
      tenant-configurable sequential approval engine
      (`WorkflowDefinition`/`WorkflowStep`/`WorkflowInstance`/
      `WorkflowStepInstance`/`WorkflowDecision`), kept architecturally
      separate from Access Control: Access Control answers "is this
      user allowed at all," Workflow answers "is an approval required
      right now, and whose turn is it." Eligibility resolved entirely
      through Sprint 25's `EffectiveAccessResolver`/`ScopeEvaluator` —
      zero new authorization primitives, no role-name/position/
      department string comparisons anywhere in the engine. One domain
      integration — Purchase Order — reusing `PurchaseOrderStatus`'s
      pre-existing, previously-unreachable `PENDING`/`APPROVED` states
      and `approvedById` column with zero schema changes to that
      domain; a `WorkflowSubjectHandler` registry keeps the
      integration one-directional. Concurrency-safe (conditional
      `updateMany` transitions, live-verified: concurrent approval/
      submission attempts produce exactly one success and one `409`).
      A desktop-first `/settings/workflows` admin UI (Overview/
      Definitions/Instances/My Approvals — the last one backend-
      filtered). Not Notifications, not parallel/branching approval,
      not escalation/SLA/delegation — see
      [`docs/domains/workflow.md`](domains/workflow.md)
- [x] Workflow Hardening, Lifecycle Completion & Domain Readiness —
      shipped Sprint 26.1. Completes the Sprint 26 engine ahead of
      Notifications: a dedicated `resubmit()` operation for a `RETURNED`
      instance (a new, linked `WorkflowInstance` restarting from step 1,
      never a rewind — its full decision history stays immutable and
      untouched); a fixed domain-integration-atomicity bug found during
      this sprint's own audit (a workflow could previously be marked
      `APPROVED` even when the underlying Purchase Order update failed —
      the domain callback now runs first, with a safe retry path for a
      transient failure); mandatory reject/return comments; an explicit
      `EXPIRED` transition plus a read-time-only `isOverdue` computation
      (`dueAt` in the past, never a background job — automatic
      escalation stays explicitly out of scope); a database-level
      partial unique index closing a genuine concurrent-submission race
      the audit found in Sprint 26's own check-then-act logic; and a
      durable, idempotent `WorkflowEvent` table — transactionally
      written alongside every state transition — that a future
      Notifications sprint can consume without touching the engine's
      internals. 19 new tests (74 workflow tests total, 1559 overall).
      No second domain integration and no automatic escalation — see
      [`docs/domains/workflow.md`](domains/workflow.md) and
      [`docs/sprint-26.1-completion-report.md`](sprint-26.1-completion-report.md)
- [x] Notifications & Activity Centre Foundation — shipped Sprint 27. The
      first in-app notification system, built as a pure downstream
      consumer of Sprint 26.1's `WorkflowEvent` table — a data boundary,
      not a service call, verified by `notifications-independence.spec.ts`.
      Zero new authorization primitives and zero new permission-catalogue
      entries; every self-scoped route uses `JwtAuthGuard` alone, scoped
      server-side to the caller's own organisation and recipient id.
      Idempotent by a database-level unique constraint
      (`organisationId`+`sourceEventId`+`recipientUserId`+`channel`), not
      an application-level check — live-verified by replaying the
      processor and confirming zero duplicate notifications. Recipient
      resolution reuses `WorkflowEligibilityService.listEligibleApprovers`
      unchanged, so a suspended or ineligible user structurally cannot be
      notified (live-verified against a suspended approver). A companion
      Activity Centre composes an organisation-wide feed live from the
      same `WorkflowEvent` rows, no duplicate table. No queue/cron
      infrastructure exists yet, so processing is triggered on demand (a
      frontend poll plus a call after every workflow-mutating action) —
      a documented, deliberate MVP choice. A notification bell in the
      global header plus a full `/notifications` page, mobile-verified at
      375px. 51 new tests (125 workflow+notifications tests, 1604
      overall). No email/SMS/push, no digests, no escalation — see
      [`docs/domains/notifications.md`](domains/notifications.md) and
      [`docs/sprint-27-completion-report.md`](sprint-27-completion-report.md)
- [x] Notification Reliability, Preferences & Activity Consolidation —
      shipped Sprint 27.1. Hardens the Sprint 27 notification foundation
      without redesigning it: an explicit `PENDING`/`PROCESSING`/
      `PROCESSED`/`FAILED` state machine on `WorkflowEvent` replaces the
      old nullable-timestamp model, claimed via a per-row conditional
      `updateMany` (this codebase's own established concurrency idiom) —
      live-verified by firing 5 simultaneous processing requests at one
      event and confirming exactly one succeeded, zero duplicates. A
      bounded retry policy (3 attempts, `[0, 1min, 5min]` backoff,
      terminal `FAILED` after that) plus stale-`PROCESSING`-lease
      recovery, both live-verified against manufactured failure/stuck
      scenarios. A documented recipient contract table plus explicit
      user-status-change behavior (suspension/role-removal/reactivation
      — none of it deletes an existing notification). A new tenant-
      scoped `NotificationPreference` model (2 categories, default
      enabled, suppression affects notification CREATION only — never
      `WorkflowEvent`/audit/Activity Centre). A new operational admin
      surface (`notification.processing.view`/`.manage`, auto-granted to
      Administrator, zero manual seed code) to inspect and retry failed
      processing. A new architecture decision record
      ([`docs/architecture/notification-activity-boundaries.md`](../architecture/notification-activity-boundaries.md))
      formalizing how `WorkflowEvent`/`WorkflowDecision`/`Notification`/
      `AuditLog`/Activity Centre relate — no duplicate record-keeping
      introduced. 66 notification tests (up from 45), 188 suites / 1625
      total, all passing — see
      [`docs/domains/notifications.md`](domains/notifications.md) and
      [`docs/sprint-27.1-completion-report.md`](sprint-27.1-completion-report.md)
- [x] Email Notification Delivery Foundation — shipped Sprint 28. A second,
      genuinely downstream delivery channel consuming already-created
      `Notification` rows — never `WorkflowEvent`/`WorkflowInstanceService`
      directly, `WorkflowInstanceService` byte-for-byte unchanged. New
      `EmailDelivery` model with its own concurrency-safe claim-based state
      machine (`PENDING`/`PROCESSING`/`SENT`/`FAILED`) and its own retry
      policy (3 attempts, `[0, 2min, 10min]` backoff — deliberately longer
      than the in-app processor's, since SMTP failures differ). A
      provider-independent adapter (`EmailProvider` port mirroring the
      Sprint 3.4 `FileStorage` pattern): `LocalEmailProvider` (default,
      never sends real email, deterministic plus-addressing failure
      simulation) and a real `SmtpEmailProvider` (`nodemailer`, ZeptoMail-
      compatible, maps SMTP errors to retryable/terminal, never logs
      credentials) selected once at boot by `EMAIL_PROVIDER_MODE` — real
      SMTP configuration missing fails loudly at startup, never a silent
      fallback. Recipient-address snapshotting (a later email change or
      suspension never retargets an already-created delivery). Asymmetric
      preference default (email OFF unless explicitly enabled, in-app stays
      ON) layered onto the existing `NotificationPreference` row. New
      organisation-level sender configuration reusing the existing
      `Organisation.settings` JSON bucket and `identity.organisation.manage`
      permission — no new config surface. A real starvation bug found and
      fixed live during this sprint's own verification (a backlog of
      permanently-ineligible old notifications was blocking new ones from
      ever being scanned for email). Live-verified end-to-end including
      concurrent processing, retryable/terminal failure simulation,
      stale-lease recovery, manual retry preserving attempt history,
      suspended-user exclusion, cross-tenant/cross-user isolation, and one
      real attempted send through ZeptoMail's SMTP endpoint (reached and
      authenticated successfully; safely rejected at message submission,
      reported honestly rather than claimed as delivered). Deliberately
      still not SMS, push, or any marketing-email capability — see
      [`docs/domains/notifications.md`](domains/notifications.md),
      [`docs/architecture/email-delivery.md`](../architecture/email-delivery.md),
      and [`docs/sprint-28-completion-report.md`](sprint-28-completion-report.md)
- [x] WhatsApp Notification Delivery Foundation — shipped Sprint 29. A THIRD
      downstream delivery channel, a structural sibling of `EmailDelivery`
      rather than a chain — both read the same already-created `Notification`
      row independently, neither imports the other, neither imports
      `WorkflowEvent`/`WorkflowInstanceService` directly. New `WhatsAppDelivery`
      model with the same concurrency-safe claim-based state machine
      (`PENDING`/`PROCESSING`/`SENT`/`FAILED`) and its own retry policy (3
      attempts, `[0, 2min, 10min]` backoff, in its own independently-
      configurable constants file). A provider-independent adapter
      (`WhatsAppProvider` port, same `FileStorage`/`EmailProvider` pattern):
      `LocalWhatsAppProvider` (default, never contacts the real API,
      deterministic failure simulation via two reserved test phone numbers)
      and a real `MetaWhatsAppProvider` (WhatsApp Business Platform Cloud API
      via Node's built-in `fetch`, zero new dependency, maps Meta error codes
      to retryable/terminal, never logs the access token or a full phone
      number) selected once at boot by `WHATSAPP_PROVIDER_MODE` — real
      configuration missing fails loudly at startup, never a silent fallback.
      Approved-template-only model (`zentuva_approval_required`, only
      `WORKFLOW_APPROVAL_REQUIRED` this sprint) — never arbitrary free-form
      messages, and a WhatsApp reply can never approve anything itself; the
      message only links back into Zentuva, where every existing
      authorization/concurrency protection applies unchanged. Nigeria-aware
      phone number normalization (`08012345678`/`2348012345678`/
      `+2348012345678` all correctly distinguished) that fails safely rather
      than guesses for any other country. Recipient-phone snapshotting (a
      later phone change or suspension never retargets an already-created
      delivery). Asymmetric preference default (WhatsApp OFF unless
      explicitly enabled, same as email) layered onto the existing
      `NotificationPreference` row; organisation-level channel toggle
      deliberately smaller than email's (`{ enabled }` only — no
      tenant-configurable sender identity, since the WhatsApp Business phone
      number is environment/platform configuration only). Live-verified
      end-to-end against the real database, including firing 6 concurrent
      requests at one freshly-submitted notification and confirming exactly
      one delivery was created, retryable/terminal failure simulation,
      stale-lease recovery, manual retry preserving attempt history and
      recipient-snapshot immutability, suspended-user exclusion, and
      cross-tenant/cross-user isolation. No real WhatsApp Business Platform
      credentials were available this sprint, so the real-provider send was
      honestly reported as not attempted rather than simulated. Deliberately
      still not a chatbot, two-way conversations, or marketing broadcasts —
      see [`docs/domains/notifications.md`](domains/notifications.md),
      [`docs/architecture/whatsapp-delivery.md`](../architecture/whatsapp-delivery.md),
      and [`docs/sprint-29-completion-report.md`](sprint-29-completion-report.md)
- [x] Recruitment & Candidate Interview Management Foundation — shipped
      Sprint 30. Closes the "how does a person become an Employee" gap in
      the HR lifecycle — built as a genuine HR extension (its own NestJS
      module purely to avoid bloating `HrModule`'s provider list, never a
      separate application). Hiring Request, optionally routed through the
      EXISTING Workflow engine for approval via the exact
      `WorkflowSubjectHandler` recipe Purchase Order established (never a
      second approval engine) — Candidate/Application/Interview are never
      `WorkflowInstance`s. Vacancy with HR-configurable, explicitly-ordered
      multi-stage interview processes and real Employee/User-identity
      panelists (never free-text roles) — a `WorkflowStep`/
      `WorkflowStepInstance`-style config/snapshot split so a later panel
      edit never retroactively alters who evaluated an already-scheduled
      candidate. A public, account-free careers page (rate-limited via
      `@nestjs/throttler`, new this sprint, scoped to one route only) with a
      small configurable question engine, never a form-builder platform.
      Independent 1–5 interviewer evaluations, immutable once submitted
      (DB-enforced one-per-evaluator), that one interviewer can never see
      another's before submitting their own. HR-authoritative stage and
      final hiring decisions — average score/recommendation counts are
      computed as evidence on every read, never persisted, never used to
      auto-decide anything. A documented, concurrency-safe hand-off into the
      EXISTING `EmployeeService.create()`/`EmployeeOnboardingService.start()`,
      completely unchanged — no duplicate onboarding model, no auto-created
      `User` account. Interview notifications reuse the identical
      Notification/Email/WhatsApp pipeline unchanged — the first producer
      that isn't `WorkflowEvent`-sourced, needing only one additive, scoped
      partial unique index for its own idempotency (an unscoped first
      attempt was caught failing against real live Workflow data before
      ever being committed). Four real issues found and fixed during the
      sprint's own implementation/live verification: an offer-acceptance
      race that would have created duplicate `Employee` rows (restructured
      before ever being tested); a suspended interviewer's still-valid
      JWT reaching the evaluation-submission code path (caught live, fixed
      with an explicit status re-check, re-verified); the mobile interviewer
      page crashing on a real device viewport because its self-scoped
      endpoint wasn't joining the candidate/vacancy it needed; and that same
      endpoint, once fixed, still leaking every other evaluator's raw score
      into its JSON response (never rendered, but network-inspectable) until
      the response was narrowed to only the fields the view needs.
      Live-verified
      end-to-end against the real database including a full 2-stage
      Cashier process, 5-way concurrent stage-decision and offer-accept
      races each producing exactly one valid transition, cross-tenant
      isolation across every surface, and one rejected-candidate path.
      Deliberately still not AI hiring decisions, automated CV
      ranking/parsing, or a job-board/ATS integration — see
      [`docs/domains/recruitment.md`](domains/recruitment.md) and
      [`docs/sprint-30-completion-report.md`](sprint-30-completion-report.md)
- [x] **Sprint 30.1 — Public Recruitment Experience & Candidate Application
      Flow.** Audit-first: Sprint 30's backend (tenant resolution, published-
      only visibility, security, dedup, custom questions) was already
      correct and untouched. Rebuilt the public `/careers/{org}` template as
      Server Components with real per-page `generateMetadata` and genuine
      HTTP 404s for unavailable vacancies/organisations, plus a shared
      tenant-agnostic component library (`CareersHero`, `VacancyCard`/
      `VacancyList`, `VacancyDetails`, `ApplicationForm`/
      `ApplicationSuccess`) on the existing `@zentuva/ui` kit — no raw HTML
      form elements, no new UI framework. Found and fixed one real defect
      via live browser testing: `loading.tsx` Suspense boundaries caused a
      404 page to stream as HTTP `200` before `notFound()` could run;
      removing them restored the correct status. Live-verified end-to-end as
      an external candidate — browse → vacancy → apply with custom
      questions → confirmation → appears correctly in HR with cover
      letter/answers intact → shortlisted into Sprint 30's unchanged
      interview pipeline — plus a vacancy-state toggle test (paused →
      hidden everywhere → republished → visible again). One new test suite
      closing the one coverage gap the audit found (the actual visibility
      `WHERE` clause was previously only mocked, never directly tested).
      214 suites / 1835 tests passing — see
      [`docs/sprint-30.1-completion-report.md`](sprint-30.1-completion-report.md)
- [x] **Sprint 30.2 — Hiring Request → HR Approval → Public Vacancy Flow
      Audit.** Audited whether "department requests → HR approves → HR
      creates & publishes vacancy → public careers page" was actually
      enforced, not just designed. Found and fixed a real defect:
      `VacancyService.create()` only checked a supplied `hiringRequestId`
      existed, never that it was `APPROVED` — a `DRAFT`/`SUBMITTED`/
      `REJECTED`/`CANCELLED` request could be silently converted into a
      vacancy. Also found no non-Administrator role could ever create a
      hiring request (the permission existed and was correctly enforced,
      but nothing granted it) — fixed by granting the existing `Head of
Finance` role `hr.recruitment.hiring_request.manage`/`.view` and
      assigning it to the existing Finance Officer demo user, no new
      permission/role/user. Live-verified the complete chain on Boby Bites:
      non-HR requester creates/submits → cannot self-approve or publish
      (`403`) → HR approves → vacancy created only from the approved
      request (rejected while unapproved) → published → appears at
      `/careers/boby-bites` → a real candidate applies. 215 suites / 1861
      tests passing — see
      [`docs/sprint-30.2-completion-report.md`](sprint-30.2-completion-report.md)
- [x] **Sprint 32 — Consumer Identity, Territory & Location Foundation.**
      The backend identity foundation for D2C: `Consumer` (never a `User`/
      `Employee`/`Customer`/`Outlet`) with a server-generated
      `CON-000001`-style code and a required, tenant-scoped normalized phone
      identity (`[organisationId, normalizedPhone]` unique, never global).
      Audit-first: reused the existing `Territory` hierarchy as the
      structured location (no second Location model — a leaf Territory
      like "Bodija" already carries its full ancestor chain) and the
      existing Sprint 29 `normalizePhoneNumber` utility (no second
      implementation). Registration is idempotent by phone, the exact
      `CandidateRepository.findOrCreate`/`P2002`-race-recovery recipe from
      Sprint 30 — live-verified with 5 genuinely concurrent HTTP requests
      producing exactly one `Consumer` row and one audit event. A small
      `ConsumerLocationRequest` model captures a controlled "can't find my
      location" signal as non-authoritative text only, never auto-creating
      a Territory. `NotificationPreference` was deliberately not reused (it
      is hard-wired to a real `User.id`) — the minimum foundation instead
      is one `marketingOptIn` boolean. `ConsumerService` is channel-neutral
      by construction and verified so (`d2c-independence.spec.ts`) — no
      WhatsApp import exists anywhere in the domain, ready for a future
      WhatsApp/simulator adapter to call directly. Internal/admin-only HTTP
      surface plus a lightweight `/settings/d2c/consumers` verification UI.
      218 suites / 1889 tests passing — see
      [`docs/sprint-32-completion-report.md`](sprint-32-completion-report.md)
- [x] **Sprint 33 — Consumer Conversation Experience Foundation.** The
      channel-neutral Conversation Layer between a future WhatsApp adapter
      and Sprint 32's D2C services: `WhatsApp → Channel Adapter →
Conversation Layer → D2C Services → Existing Domains`.
      `ConversationService.handleInboundMessage()` is the single,
      channel-neutral entry point — no real WhatsApp integration, no
      generic workflow engine, no second Consumer/Territory/phone-
      normalization system. A lightweight `ConsumerConversation` session
      (`NEW → REGISTRATION → LOCATION_SELECTION → MAIN_MENU`) drives
      registration and location capture entirely through Sprint 32's
      existing `ConsumerService`/`Territory` hierarchy. Found and fixed
      via live testing (not unit tests alone): the real seeded Territory
      hierarchy is four levels deep, so a naive root-level query showed a
      single useless option — fixed with a new, fully generic
      `resolveBranchPoint()` auto-descent helper (no hardcoded depth/names)
      that also re-validates every selection server-side, rejecting an
      unknown id or a location that doesn't belong to the selected
      territory. Also found live: the welcome message hardcoded one
      tenant's brand name — fixed by threading the real organisation name
      through every message, verified against a genuine second
      organisation. The conversation contract
      (`TEXT`/`BUTTON`/`LIST_SELECTION` in,
      `TEXT`/`BUTTONS`/`LIST` out) is deliberately channel-neutral;
      idempotency reuses the existing `findOrCreate`/`P2002`-recovery
      recipe (live-verified with 5 concurrent registration requests
      producing exactly one Consumer); the HTTP surface is
      internal/JWT-authenticated only, reusing Sprint 32's
      `d2c.consumer.*` permissions (no new permission); the main menu
      shows only what already works, deferring ordering (Sprint 34), My
      Points/Rewards (Sprint 40), My Collection (Sprint 37), and
      Promotions (Sprint 41). A small internal "Conversation Tester" UI
      was added for verification — not the future Sprint 42
      consumer-facing simulator. 221 suites / 1912 tests passing — see
      [`docs/sprint-33-completion-report.md`](sprint-33-completion-report.md)
- [x] **Sprint 34 — D2C Consumer Ordering.** Extends the existing Sales
      Order domain — never a parallel order system — so a registered
      Consumer can browse, cart, and confirm an order through the
      Conversation Layer: `Conversation Layer -> D2COrderingService (new)
-> SalesOrderService.createForConsumer (new entry point on the
EXISTING service) -> SalesOrder`. Audit found two real gaps: no
      pricing field existed anywhere in the Product Catalogue (added
      `Product.sellingPrice`, nullable/opt-in, exposed through the
      existing product endpoints — not a pricing engine), and
      `SalesOrder.customerId` was a required FK that couldn't represent a
      Consumer without converting it into a `Customer` — widened to
      nullable and paired with a new, mutually exclusive nullable
      `consumerId` (DB-level `CHECK` constraint), plus a new
      `SalesOrderSource` (`B2B`/`D2C`) so the existing Sales Order admin
      list/detail distinguishes the two channels with no new screen.
      Pricing is server-authoritative by construction (the conversation
      contract has no price field at all); idempotency reuses the exact
      find-then-create-then-recover-from-`P2002` recipe already proven for
      Consumer/Conversation creation, applied to a new
      `SalesOrder.idempotencyKey` minted once at order review —
      live-verified with 5 genuinely concurrent confirmations producing
      exactly one order. A real bug (an empty-catalogue tenant's next menu
      click misrouted as a product selection) was found live and fixed
      before completion. 223 suites / 1950 tests passing — see
      [`docs/sprint-34-completion-report.md`](sprint-34-completion-report.md)
- [x] **Sprint 35 — OPay D2C Payment Integration.** Closes the payment gap
      Sprint 34 left open, entirely as an extension of the existing
      Finance `Payment` model and Sales Order lifecycle — never a parallel
      payment system: `Conversation Layer -> D2CPaymentService (new) ->
PaymentService (existing, extended) + SalesOrderService.confirm
(existing, widened) -> Payment + SalesOrder DRAFT->CONFIRMED`, with
      OPay itself reached only through a new `PaymentProvider` port
      (mirroring the Sprint 28/29 `EmailProvider`/`WhatsAppProvider`
      pattern) so Finance never couples to OPay's wire format. A
      deterministic, globally-unique payment reference
      (`PAY-{orderCode}`) resolves both a repeated "Pay Now" click and a
      retried webhook to the same row by construction; amount/currency
      are always server-authoritative and converted through exactly one
      naira-to-kobo boundary inside the provider. The webhook verifies an
      HMAC-SHA512 signature (constant-time comparison) plus
      reference/amount/currency before ever touching financial state, and
      is idempotent via the same conditional-`updateMany` primitive prior
      sprints established — live-verified with 6 duplicate/concurrent
      deliveries of a real signed callback producing exactly one
      `SalesOrder` confirmation. Live-verified repeatedly against the real
      OPay sandbox: real `cashierUrl`s, a real Cashier UI showing the
      correct merchant/amount, idempotent checkout reuse, and (after
      OPay's own sandbox never delivered its documented automatic test
      callback despite two real attempts) the webhook handler's own
      correctness proven with a callback signed using the real production
      secret key — honestly reported as self-constructed, not claimed as
      OPay-originated. A real bug was found and fixed live: the return-URL
      page used Next.js 15's `use(params)` convention in a Next.js 14
      codebase, breaking on every load until fixed to the plain-object
      convention every other dynamic route already uses. 227 suites /
      2017 tests passing — see
      [`docs/sprint-35-completion-report.md`](sprint-35-completion-report.md)
- [x] **Sprint 36 — Existing Outlet -> Collection Point Enablement.**
      Enables an existing `Outlet` to optionally operate as a D2C
      Collection Point — a CAPABILITY of the existing Outlet, never a
      parallel entity: three additive columns
      (`collectionPointStatus`/`.ResponsibleUserId`/`.OperatingHours`)
      directly on `Outlet`, reusing its existing territory and contact
      fields rather than duplicating either. Dedicated
      `enableCollectionPoint`/`disableCollectionPoint`/
      `updateCollectionPointConfig` methods mirror the exact
      `activate`/`deactivate` shape already established for `Outlet`
      itself; every route reuses the Outlet domain's own existing
      `sales.customer.view`/`.manage` permissions — zero new permission
      catalogue entries. Eligibility requires the outlet to be `ACTIVE`
      with a territory assigned; disabling is reversible and never
      destroys the saved configuration. The audit found no existing
      "responsible representative" concept anywhere on `Outlet`/
      `Customer` — resolved with a plain id referencing an existing
      `User` (the `SalesOrder.salesAgentId` convention), never a new
      `CollectionPointAgent` entity. Live-verified with 5 truly
      concurrent enable requests producing exactly one success and a
      deterministic final state, cross-tenant outlet/employee rejection,
      and a real browser session confirming persistence across a full
      page reload. Explicitly does not implement order fulfilment,
      inventory deduction, or any consumer-facing selection flow —
      documents the inventory bridge Sprint 37 will need
      (`InventoryLocation` has no link to `Outlet` today) without
      building it. 227 suites / 2040 tests passing — see
      [`docs/sprint-36-completion-report.md`](sprint-36-completion-report.md)
- [x] **Sprint 37 — Collection Point Fulfillment & Inventory
      Reconciliation.** Connects a paid D2C `SalesOrder` to the Sprint 36
      Collection Point capability through a real operational workflow —
      Paid → Eligible Collection Point → Assigned → Preparing → Ready for
      Collection → Collected → Fulfilled → Inventory Reconciled. One new,
      deliberately subordinate model (`CollectionPointFulfillment`) tracks
      the D2C-specific sub-state; the actual inventory deduction is
      performed entirely by the pre-existing, unmodified
      `SalesFulfilmentService.fulfil()` — never a new stock mutation path.
      `Outlet.inventoryLocationId` bridges Collection Point to the
      existing Inventory domain, exactly as Sprint 36 had flagged. Two
      genuine bugs were found and fixed by live verification: (1)
      `confirmCollection()` flipped its own status to the terminal
      `COLLECTED` state BEFORE calling `fulfil()`, so a `fulfil()` failure
      permanently stranded the record while the order was never actually
      fulfilled — fixed with a compensating rollback that reverts to
      `READY_FOR_COLLECTION` on failure, keeping the operation retryable;
      (2) the new module was missing `AuthModule`, so the real application
      failed to boot despite every unit test passing. Live concurrency
      testing against the real database also empirically confirmed a
      pre-existing, previously-only-theoretical lost-update race in the
      shared `SalesFulfilmentRepository.create()` stock decrement (two
      orders racing for the same limited stock can both be marked
      fulfilled while stock is decremented only once) — honestly reported
      rather than hidden, and flagged as dedicated follow-up work rather
      than patched under time pressure, since it is pre-existing Sprint
      4.9 infrastructure shared by every B2B and D2C fulfilment path.
      231 suites / 2084 tests passing, 0 regressions — see
      [`docs/sprint-37-completion-report.md`](sprint-37-completion-report.md)
- [x] **Sprint 37.1 — Inventory Fulfillment Concurrency Integrity Hardening.**
      Fixed the lost-update race Sprint 37 found and reported: an
      audit of every `InventoryStock` mutation in the codebase found 5
      call sites (Sales Fulfilment, Supplier Return, Production Material
      Issue, Maintenance Part Usage, Inventory Adjustment) sharing the
      exact same read-then-write-a-precomputed-value defect; all 5 were
      converted to a single shared atomic primitive
      (`decrementStockIfAvailable`/`applyStockAdjustmentIfNonNegative`,
      a conditional `UPDATE ... WHERE quantityOnHand >= $x` — the
      database's own row lock is the concurrency guard now, not a value
      read moments earlier in application code) while each call site
      kept its own error class/message unchanged. Three OTHER call sites
      (Customer Return, Goods Receipt, Production Run) share the same
      underlying structure but recompute a moving-weighted-average cost
      on increment — a genuinely different shape needing its own
      single-statement fix — and were deliberately left unconverted,
      documented as a confirmed, open follow-up rather than rushed.
      Proven with a new real-PostgreSQL integration test suite (run via
      `pnpm run test:integration`, deliberately excluded from the
      default mocked suite) covering two/three-way contention, a
      ten-way stress test, and a multi-item transaction-rollback test —
      then the exact original 23-vs-15+15 live scenario was re-run
      end-to-end: one order now succeeds, the other is cleanly and
      retryably rejected, with zero lost updates. 232 suites / 2089
      tests passing, 0 regressions — see
      [`docs/sprint-37.1-completion-report.md`](sprint-37.1-completion-report.md)
- [x] **Sprint 38 — Field Operations & Collection Point Mobile Experience.**
      Turns the D2C backend built across Sprints 32–37.1 into a practical
      mobile field-operations workflow — an operations/UX sprint, not a new
      business domain: no new CollectionPoint/order/inventory entity, the
      existing Sprint 37 state machine and services reused exactly as built.
      The audit found one genuine gap: no server-side data linked a
      `User`/`Employee` to a `Territory` anywhere in this codebase, so a
      field Sales Representative's D2C visibility could not be scoped at
      all. Fixed with the minimal bridge `Employee.territoryId` (a plain
      nullable FK, the exact `Customer.territoryId`/`Outlet.territoryId`
      shape, never a new Territory-assignment system), validated via a
      direct read-only cross-table query rather than importing a Retail
      module into HR — preserving `hr-independence.spec.ts`'s own
      structural boundary. A new, purely read-only
      `FieldD2COverviewService` (`/api/d2c/field-overview/orders`/
      `collection-points`) composes EXISTING repositories to give a Sales
      Rep a territory-scoped view of D2C orders and Collection Points,
      reusing existing `d2c.consumer.view`/`d2c.collection_point.view`
      permissions — no new permission pair. The Collection Point
      representative's own screen gained a Today dashboard, an Attention
      Required section (computed client-side from already-authorized data,
      never a new server-side rule — including one explicitly documented,
      non-enforced 30-minute "waiting too long" UI constant), a Collection
      Point inventory view (reusing the exact `InventoryStockRepository`
      primitive B2B already uses), and an order detail page enriched with
      real payment status and consumer territory. Live-verified end to end
      on a real mobile viewport: a fresh consumer order flowed through
      payment → auto-assignment → Preparing → Ready → Confirm Collection →
      real inventory deduction; a field rep scoped to one territory
      correctly saw only that territory's orders/Collection Points while a
      second, genuinely separate organisation saw nothing; two genuinely
      concurrent collection confirmations produced exactly one stock
      decrement, proving Sprint 37.1's atomic protection remains fully
      intact. 234 suites / 2120 tests passing, 0 regressions — see
      [`docs/sprint-38-completion-report.md`](sprint-38-completion-report.md)
- [x] **Sprint 39 — D2C Sales Administration & Operations Dashboard.** A
      new internal admin surface over the whole D2C chain — a pure
      read-aggregation `D2CAdminModule`, no new table/repository/entity,
      composing the existing SalesOrder/Consumer/CollectionPointFulfillment/
      Outlet/Territory services exactly as built across Sprints 32–38. The
      audit confirmed `/settings/d2c` already had Consumer/Conversation
      sub-pages (Sprint 32/33) — both extended, never duplicated. Delivers:
      a Dashboard (summary cards + a live-derived Attention Required view —
      unassigned orders, failed payments, 24h-stuck fulfilments, disabled
      Collection Points still holding a queue — every item a plain
      filter/age-check over existing data, never a fabricated Exception
      entity), a paginated D2C Order list/detail, a paginated Consumer admin
      list, the existing Consumer detail extended with Order/Payment/
      Collection History, an org-wide Collection Point operational queue,
      and a Territory operational summary (explicitly not full Demand
      Intelligence — that's Sprint 41). The one new mutation this sprint —
      an audited, admin-only Collection Point reassignment, deliberately
      left unbuilt in Sprint 37 — is reachable only from `ASSIGNED`/
      `PREPARING`, never touches payment/inventory/totals/Consumer
      identity, and reuses the exact conditional-`updateMany` concurrency
      primitive used throughout this codebase. Live verification against
      real dev data found and fixed a genuine gap (the reassignment picker
      initially offered an outlet that would always fail eligibility
      server-side — a real `ENABLED` outlet missing its inventory-location
      configuration) and then confirmed the full reassignment path end to
      end with a real audit-log entry and an unchanged underlying
      `SalesOrder`. Admin-only authorization reuses the existing
      `sales.customer.manage`-or-owner-bypass signal throughout — no new
      permission. 236 suites / 2160 tests passing, 0 regressions; the
      Sprint 37.1 PostgreSQL integration suite re-run unchanged — see
      [`docs/sprint-39-completion-report.md`](sprint-39-completion-report.md)
- [x] **Sprint 40 — Configurable Promotions, Loyalty, Rewards & Consumer
      Incentives.** The reusable foundation the brief insisted on:
      promotions are DATA an admin configures (validity, eligibility,
      benefit value), never hard-coded business logic — the first-order
      incentive is simply the first configured promotion, not a permanent
      special case. A new top-level `promotions/` domain (`promotion/`/
      `loyalty/`/`reward/` sub-modules): `Promotion` → `PromotionCondition`
      /`PromotionBenefit` (a controlled set of four condition types —
      FIRST_QUALIFYING_ORDER, MINIMUM_ORDER_VALUE, PRODUCT_QUANTITY,
      TERRITORY — and two benefit types, never a generic rules engine) →
      `ConsumerRewardGrant` (snapshots its applied terms at grant time,
      the exact `InvoiceItem`/`WorkflowStepInstance` convention, so a
      later promotion change can never rewrite history) → for
      `BONUS_POINTS`, a `LoyaltyAccount`/`LoyaltyLedgerEntry` pair
      mirroring `InventoryStock.quantityOnHand`+`InventoryTransaction`
      exactly — a maintained balance, never the source of truth, backed
      by an append-only ledger. A promotion becomes immutable the instant
      it activates (mirroring HR's `PolicyVersion` precedent) — a new
      commercial term is always a new promotion row. The idempotency/
      once-per-consumer-limit mechanism is a single database unique
      constraint, proven under genuine concurrent Postgres transactions
      (not mocks) to produce exactly one grant and one points award, no
      duplicates, even under 5-way contention. Wired into the EXISTING
      `D2CPaymentService` payment-confirmation webhook, right alongside
      Collection Point auto-assignment — never a parallel order/payment
      system. Live-verified end to end: created and activated the brief's
      own "First Order October" example through the admin UI, confirmed
      it becomes uneditable the instant it activates, ran the real
      evaluation service against a real fresh consumer and order and
      confirmed exactly one grant/ledger entry/200-point balance, verified
      an administrative adjustment (reasoned, audited) and its rejection
      when it would take a balance negative, and confirmed the existing
      Sprint 39 D2C Admin Dashboard remains fully unaffected. 244 suites /
      2210 tests passing, 0 regressions; the Sprint 37.1 PostgreSQL
      integration suite re-run unchanged alongside a new Sprint 40
      concurrency suite — see
      [`docs/sprint-40-completion-report.md`](sprint-40-completion-report.md)
- [x] **Sprint 40.5 — Real Meta WhatsApp Cloud API Foundation.** Extended the
      existing Sprint 29 `MetaWhatsAppProvider`/`LocalWhatsAppProvider`
      (never duplicated) with real text/image sends and a generic
      ordered-parameter template path, built the first real WhatsApp
      webhook (`GET`/`POST /api/whatsapp/webhook`, signature/verify-token
      handshake, a new idempotency ledger keyed by Meta's own message id),
      and built the first real Channel Adapter bridging that webhook into
      the UNCHANGED, channel-neutral `ConversationService` from Sprint 33 —
      never a second chatbot. Live-verified against real Meta traffic: real
      text/template/image sends accepted with genuine message ids (via both
      the raw API and a new admin `/settings/d2c/whatsapp-test` screen),
      and a real inbound "Hi" → "2" (Register) → name reply flowed through
      the real webhook into a genuine new Consumer registration, exactly
      mirroring the pre-existing internal Conversation Tester's own state
      machine. Two real-world issues — an expired access token and a
      non-allow-listed test recipient (Meta development-mode restriction) —
      were found and resolved live, not simulated around. 250 suites / 2249
      tests passing, 0 regressions; the Sprint 37.1 and Sprint 40
      PostgreSQL integration suites re-run unchanged; one new table
      (`WhatsAppWebhookEvent`, a pure dedup ledger) — see
      [`docs/domains/whatsapp.md`](domains/whatsapp.md) and
      [`docs/sprint-40.5-completion-report.md`](sprint-40.5-completion-report.md)
- [x] **Sprint 41 — WhatsApp D2C Ordering & Commerce Conversation.** Connected the
      real WhatsApp channel to the D2C Order Snacks flow that has existed in
      `ConversationService` since Sprint 34 — the audit found it already complete and
      already reachable through Sprint 40.5's generic Channel Adapter, so this sprint
      is almost entirely small, targeted fixes: a genuine bug found via live testing
      (two option-bearing messages sent together made a numeric reply ambiguous — fixed
      with global option numbering across the whole outbound batch), product images
      surfaced into the D2C contract with a channel-neutral image-message/text-fallback
      path, and two new main-menu options ("My Orders"/"My Rewards") wiring the
      EXISTING, already-consumer-scoped `D2COrderingService`/`LoyaltyService` reads —
      never a second order-history or rewards-calculation system. Live-verified against
      real Meta traffic end to end: registration → real product browsing → a multi-item
      cart (the numbering fix proven against real webhook traffic) → a real
      `SalesOrder` → a real OPay checkout link genuinely delivered over WhatsApp →
      visible in the existing, unmodified D2C admin order list; a replayed duplicate
      webhook produced exactly one order. New real-PostgreSQL concurrency proof: 5
      concurrent order confirmations with the same idempotency key produce exactly one
      `SalesOrder`. 250 suites / 2260 tests passing, 0 regressions; all three
      PostgreSQL integration suites re-run clean; zero schema changes, zero new
      WhatsApp-specific order/product/payment entity — see
      [`docs/domains/d2c.md`](domains/d2c.md) §115–119 and
      [`docs/sprint-41-completion-report.md`](sprint-41-completion-report.md)
- [x] **Sprint 42 — D2C Collection Point Fulfilment & Order Completion.** Closed the
      operational loop between a paid D2C order and the Collection Point lifecycle
      (Sprints 36–39) — the audit found the entire lifecycle, mobile Field UI, and admin
      visibility already complete, so this sprint is almost entirely one new,
      channel-neutral `ConsumerNotificationPort` (reusing the existing
      `WHATSAPP_PROVIDER` token, never a second sending mechanism) wired into the
      existing Ready-for-Collection/Collected transitions, plus a payment-still-valid
      re-check at every transition and "My Orders" surfacing live fulfilment status.
      Live-verified end to end: a real order placed via real WhatsApp traffic, paid via
      a correctly-signed simulated OPay callback, auto-assigned to a real Collection
      Point, carried through Start Preparing → Mark Ready → Confirm Collection via the
      real, unmodified mobile Field UI, with real inventory confirmed to deduct exactly
      once and a real WhatsApp collection confirmation delivered with a genuine Meta
      WAMID. New real-PostgreSQL concurrency proof: 4 scenarios all resolve to exactly
      one winner. 251 suites / 2273 tests passing, 0 regressions; all four PostgreSQL
      integration suites re-run clean; zero schema changes, zero new entity — see
      [`docs/domains/d2c.md`](domains/d2c.md) §120–123 and
      [`docs/sprint-42-completion-report.md`](sprint-42-completion-report.md)
- [x] **Sprint 43 — D2C Operations, Notifications & Production Hardening.** Made the
      already-working D2C loop operable rather than adding a new capability: a new
      `ConsumerWhatsAppDelivery` delivery-attempt record (the audit confirmed the
      existing internal-staff `WhatsAppDelivery` table has zero applicability to a
      `Consumer`) plus a safe, idempotent, concurrency-proof retry
      (`d2c.communication.view`/`.manage`, two new permissions) that is structurally
      incapable of touching `SalesOrder`/`Payment`/inventory/loyalty. The Sprint 39
      exception-detection logic was extracted into a shared service and widened from
      four checks to seven (adds stale-pending-payment, stuck-ready-for-collection,
      and notification-failed), reused by both the admin dashboard and a new
      territory-scoped field view, with every threshold now configuration instead of a
      hardcoded constant. A genuine webhook-resilience defect found by this sprint's
      own audit — a malformed item in a batched Meta payload could abort processing of
      unrelated items in the same batch — was fixed and proven. Live-verified against
      real Meta WhatsApp traffic: the full order→payment→Collection Point→notification→
      collection loop re-run with real delivery records attached, a real notification
      failure (Meta code 131030) correctly recorded and surfaced as an exception, two
      genuinely concurrent retry requests resolving to exactly one winner, and the
      Member role correctly rejected with 403 from the new endpoints. 253 suites / 2301
      tests and 5 integration suites / 22 tests passing, 0 regressions; one new table,
      purely additive — see [`docs/domains/d2c.md`](domains/d2c.md) §124–127,
      [`docs/domains/whatsapp.md`](domains/whatsapp.md) §12, and
      [`docs/sprint-43-completion-report.md`](sprint-43-completion-report.md)
- [x] **Sprint 43.5 — D2C Two-Way Conversation Reliability.** Proved the other half of
      the conversational loop — WhatsApp User → Zentuva, not just the reverse. The
      audit found `ConversationService` (Sprint 33) already a remarkably complete,
      channel-neutral state machine: the full 6-option main menu, invalid-numeric
      handling, and a safe free-text fallback at every state already existed, needing
      no redesign. The genuine gaps closed: a small, explicit, deterministic alias
      table (no NLP) for natural commands like "orders"/"rewards"/"location"; global
      BACK/CANCEL/HOME commands reusing the existing reset mechanism (proven to never
      touch a `SalesOrder`); explicit "didn't understand" wording at two states that
      previously silently re-prompted; and — the most significant gap — zero delivery
      tracking for ordinary conversation replies, closed by widening Sprint 43's own
      `ConsumerWhatsAppDelivery` table (never a second communication-history
      mechanism) with a new `CONVERSATION_REPLY` kind. Live-verified against real Meta
      WhatsApp traffic: a complete real order→payment→Collection Point conversation
      (including the brief's own exact "maybe" example), every text alias and global
      command, a duplicate webhook replayed 3 times producing exactly one payment, a
      malformed payload and an unsupported message type both handled safely against
      the real running server, and a real Update Location flow that genuinely changed
      the consumer's territory in the database. New real-PostgreSQL concurrency proof
      for the webhook dedup primitive (previously only unit-mocked): 10 concurrent
      claims for the same WAMID resolve to exactly one winner. 253 suites / 2316 tests
      and 6 integration suites / 25 tests passing, 0 regressions; purely additive
      schema widening, zero new tables, zero new business logic in the WhatsApp
      adapter — see [`docs/domains/d2c.md`](domains/d2c.md) §128–131,
      [`docs/domains/whatsapp.md`](domains/whatsapp.md) §13, and
      [`docs/sprint-43.5-completion-report.md`](sprint-43.5-completion-report.md)
- [ ] Retail Portal (mobile)
- [ ] Business Intelligence dashboards

## Future

- HR, CRM Automation, Consumer Portal, Loyalty, Promotions, AI Services, Analytics, Marketplace.
