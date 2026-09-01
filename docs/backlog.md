# Zentuva Product Backlog

## 1. Purpose

This backlog is the single source of truth for Zentuva's long-term product roadmap. It
differs from a [sprint completion report](sprint-1B.2-completion-report.md) in scope and
lifespan: a sprint report is a point-in-time record of what one sprint delivered and
doesn't change after the fact; this backlog is a living document that tracks where the
product is going, at the level of Epics rather than individual tasks. It represents
Zentuva's roadmap, not a commitment — priorities will evolve as Boby Bites' needs become
clearer and as future tenants are onboarded, per
[Handbook Principle 1 (MVP First)](handbook/engineering-handbook.md#5-product-principles).

## 2. Product Vision

Zentuva is a configurable, multi-tenant SaaS platform for manufacturers and distributors,
built to digitise the complete manufacturing-to-consumer value chain — from raw materials
and production, through procurement and inventory, to sales, distribution, and eventually
direct consumer engagement — as one connected, modular system rather than a collection of
disconnected tools. The first tenant is **Boby Bites**, the pilot implementation that
validates the platform; every feature is designed so it can be reused by future tenants
without code changes, per
[Handbook Principle 2](handbook/engineering-handbook.md#5-product-principles).

## 3. Guiding Principles

- **MVP First** — build only what today's business requires.
- **Build Once, Configure Many** — features are designed for every tenant, not hardcoded
  for Boby Bites.
- **Multi-Tenant by Design** — every domain respects tenant isolation from day one, not as
  an afterthought.
- **Simplicity Before Complexity** — the simpler solution wins unless there's a compelling
  reason otherwise.
- **Data Drives Decisions** — every transaction is designed to feed future intelligence,
  not just record state.
- **Distribution is a Strategic Asset** — the path from factory to consumer is a first-class
  part of the product, not a bolt-on.
- **Consumer Participation Matters** — the value chain extends to the end consumer, even
  though that's future scope.
- **Documentation is Part of Development** — a feature isn't done until its documentation
  is updated.

See the [Engineering Handbook](handbook/engineering-handbook.md#5-product-principles) for
the complete, authoritative set of product principles this backlog draws from.

## 4. Product Roadmap

The roadmap is organised into Epics. Each Epic is a coherent slice of the product — large
enough to represent a meaningful capability, small enough to stay MVP-first. Epics are
delivered roughly in order, but later Epics may be reordered as priorities evolve.

### Epic 0 — Engineering Foundation

- **Objective:** establish the monorepo, tooling, and local development experience every
  other Epic builds on.
- **Description:** Turborepo + pnpm workspace, NestJS/Next.js scaffolding, shared
  packages, Docker-based infra, CI-quality tooling (lint/type-check/test/build), and the
  initial `docs/` structure.
- **Status:** Completed — Sprint 0.

### Epic 1 — Identity & Access Management

- **Objective:** give every future domain a tenant boundary, authenticated users, and an
  authorization model to build on.
- **Description:** Organisation/User/Role/Permission data model, JWT-based authentication
  (login, refresh rotation, logout, password reset, invitation acceptance, account
  locking), audit logging, self-service tenant registration (`POST /api/auth/register`
  atomically provisions a new organisation, its default roles, and an Owner user in one
  transaction), and full self-service account management (`/api/account/*`: profile,
  change password, active sessions) including a forced first-login password change for
  admin-created accounts. Full RBAC evaluation (the `Permission`/`RolePermission` engine)
  is not yet built — role checks are currently a minimal role-name guard, shipped in
  Sprint 2.1.
- **Status:** Completed — Sprints 1A, 1A.1, 1B.1, 1B.2. Extended in Sprint 3.2 with
  self-service tenant registration and a sign-in UI, and in Sprint 3.3 with account
  self-service (profile, password change, password reset completion, session management).

### Epic 2 — Organisation Management

- **Objective:** let an organisation manage itself — its profile, its people, and who can
  do what.
- **Includes:** Organisation Profile, Tenant Settings, Branding, User Management,
  Invitations, Roles, Permissions, Audit, the Workspace application shell.
- **Status:** In progress — Organisation Profile (view/update) shipped in Sprint 2.1; User
  Management (list/view/create/update/activate/deactivate) shipped in Sprint 2.2; the full
  Workspace Configuration Center — a multi-tab General/Branding/Regional/Business/
  Preferences settings experience, including logo upload and per-tenant primary/accent
  colour + light/dark/system theme applied live across the app — shipped in Sprint 3.4,
  superseding the single-page Organisation Settings from 2.1. Sprint 3.5 added the
  permanent Workspace application shell (sidebar + top bar + `/workspace` landing page)
  every authenticated page now renders through, and made the `/account/profile` photo
  upload real (previously a Sprint 3.3 placeholder). Invitations, Roles, Permissions, and
  the Security tab (currently a "Coming Soon" placeholder for Password Policy/Sessions/
  MFA/SSO/API Keys) remain.

### Epic 3 — Product Catalogue

- **Objective:** model what an organisation manufactures and sells.
- **Includes:** Categories, Products, Product Families & Variants, Packaging, Pricing,
  Units, Product Images.
- **Status:** In progress — the Product Catalogue foundation (master product records:
  identity, classification, commercial fields, one image, Draft/Active/Archived
  lifecycle) shipped in Sprint 4.1, reusing the Sprint 3.4 `FileStorage` upload
  architecture and the same Owner/Administrator-write, Member-read-only authorization as
  every other domain. Sprint 4.3 added a fourth Product Type — Consumable — alongside
  Raw Material/Packaging Material, so Procurement has a complete set of purchasable
  input types (`docs/domains/procurement.md` §2 "Relationships"). Sprint 4.7 added a
  `ProductFamily → ProductVariant` grouping hierarchy on top of the existing flat
  catalogue (e.g. "Plantain Chips" family → "Sweet & Spicy" variant → individual 30g/
  500g/1kg SKUs), purely as an organisational/reporting layer — every SKU (`Product`)
  remains the actual entity BOM/Production/Inventory/Procurement transact against, never
  the Family or Variant. A dedicated pack-size entity, an attribute/option engine,
  Packaging (as a distinct concept from the Packaging category), Pricing, and a
  tenant-configurable Categories taxonomy all remain — see
  [`docs/domains/catalogue.md`](domains/catalogue.md).

### Epic 4 — Procurement

- **Objective:** manage sourcing raw materials and goods from suppliers.
- **Includes:** Purchase Orders, Goods Received, Supplier Performance. Supplier master
  data itself now lives in its own domain — see Epic 15.
- **Status:** In progress — Purchase Order management (create/edit/cancel, automatic
  line/subtotal/total calculation) shipped in Sprint 4.3, referencing `Supplier.id`
  (Epic 15, Sprint 4.2) instead of a free-text supplier name. Its status lifecycle now
  also reaches `PARTIALLY_RECEIVED`/`RECEIVED`, set exclusively by Epic 5's receiving
  workflow (Sprint 4.4.1) — see [`docs/domains/procurement.md`](domains/procurement.md).
  Sprint 8 wired that same receiving workflow to Epic 17's accounting layer (see below);
  Purchase Order confirmation itself still creates no accounting entry. Sprint 12 added
  a read-only Financial Summary to the PO dialog, sourced from Epic 16's new Accounts
  Payable read model (invoiced/recognized/paid/outstanding) — Procurement itself gained
  no write path. Supplier Performance and Purchase Approval Workflow remain; Supplier
  Invoices are Epic 16's own `SupplierInvoice` (Sprint 12), not a Procurement entity.

### Epic 5 — Inventory

- **Objective:** track stock across its lifecycle and locations.
- **Includes:** Raw Materials, Finished Goods, Stock Movement, Warehouses, Transfers,
  Stock Adjustment.
- **Status:** In progress — Goods Receiving shipped in Sprint 4.4 and substantially
  refined in Sprint 4.4.1 ("Goods Receiving, Inspection & Supplier Discrepancy
  Refinement") to match real manufacturing receiving workflows: every delivery now
  distinguishes Ordered/Delivered/Accepted/Rejected/Outstanding/Excess quantities,
  inventory increases only by the _accepted_ portion (never delivered), a Purchase Order
  may receive multiple times (short deliveries, rejections followed by supplier
  replacements, even deliveries after the order is already fully `RECEIVED`), and each
  Goods Receipt carries a lightweight supplier-discrepancy resolution state
  (`NONE`/`PENDING_SUPPLIER`/`REPLACEMENT_EXPECTED`/`REPLACEMENT_RECEIVED`/
  `CREDIT_EXPECTED`/`RESOLVED`) — deliberately not a full Quality Management or Supplier
  Claims system. Sprint 4.5 ("Inventory Control & Stock Management") added a minimal
  `InventoryLocation` model (every stock balance is now Organisation+Product+Location,
  not just Organisation+Product; every organisation gets a lazily-created default
  location) and a controlled `ADJUSTMENT` transaction type for manual corrections
  (Physical Count/Damage/Spoilage/Loss/Found Stock/Data Correction/Other reasons, a
  signed quantity delta, hard negative-stock prevention) — the immutable
  `InventoryTransaction` ledger now carries `RECEIPT` and `ADJUSTMENT` rows side by side,
  the same source of truth every future stock movement (Production issue/output, Sales
  issue) is expected to write into. Sprint 8 ("Procurement, Inventory & Accounting
  Integration") wired Goods Receipt to the General Ledger — `DR Inventory / CR
Accounts Payable`, with any quantity accepted beyond a Purchase Order's own ordered
  amount posting instead to a `GRNI — Pending Approval` account rather than inflating
  `AP` — and closed a real idempotency gap (`GoodsReceipt` had no double-submission
  protection before this sprint). Sprint 9 ("Manufacturing Accounting Integration")
  added the first persisted inventory costing figure, `InventoryStock.averageUnitCost`
  — a moving weighted average updated by Goods Receipt and Production Completion,
  read by Production's Material Issue — still not a full FIFO/standard-costing engine.
  Sprint 10 ("Sales Fulfilment & COGS Accounting Integration") made Sales Fulfilment
  the second reader of that same figure, valuing the finished-goods stock a customer
  order consumes. Sprint 11 ("Returns, Claims & Reversals Foundation") added the
  reverse-flow half: `SupplierReturn` (excess-first allocation between `AP` and
  `GRNI — Pending Approval`, valued at the original receipt price) and Replacement
  Goods (an ordinary `GoodsReceipt` against the same PO, provably unable to create a
  duplicate payable) both live here; a new `RETURN` `InventoryTransactionType`
  distinguishes both directions of a return from a manual `ADJUSTMENT`. Warehouse
  Transfers, Reservation/Allocation, Low Stock alerting, a physical quarantine/hold
  model for returned goods, and a full Warehouse Management System remain — see
  [`docs/domains/inventory.md`](domains/inventory.md).

### Epic 6 — Production

- **Objective:** plan and record the manufacturing process itself.
- **Includes:** Recipes/BOM, Batch Production, Production Planning, Waste, Quality
  Control.
- **Status:** Foundation implemented — Sprint 4.6 ("Production Management & Bill of
  Materials Foundation"). A Bill of Materials (recipe) defines how much of each raw
  material/packaging/consumable a finished product needs; a Production Order pins a
  BOM's requirement snapshot at creation (immune to later BOM edits); Material Issue
  consumes raw materials out of Inventory via `InventoryTransaction` `ISSUE` rows,
  atomically, with over-issue and insufficient-stock rejected; Production Execution
  records Planned/Produced/Rejected/Accepted as distinct figures (Accepted always
  server-computed); completion receipts the accepted quantity into Inventory via
  `InventoryTransaction` `RECEIPT` rows. Sprint 9 ("Manufacturing Accounting
  Integration") wired Material Issue and Production Completion to the General
  Ledger — `DR WIP / CR Raw Material Inventory` on each issue,
  `CR WIP / DR Finished Goods Inventory / DR Production Loss` (split proportionally by
  accepted vs. rejected quantity) on completion — reusing the exact
  `postSystemJournalEntry` boundary Sprint 8 established for Goods Receipt, with no
  parallel accounting mechanism. Rejected output's cost is preserved in the ledger but
  never enters sellable inventory. Deliberately not a full MRP or Quality Management
  System — no scheduling, no multi-level BOMs, no labour/machine/overhead costing, no
  batch/lot/expiry tracking, no automatic procurement from a shortfall, no COGS at
  Sales Fulfilment — see [`docs/domains/production.md`](domains/production.md).

### Epic 7 — Sales

- **Objective:** manage the commercial transaction from order to payment.
- **Includes:** Customers, Orders, Invoicing, Payments, Returns.
- **Status:** In progress — Sprint 4.8 ("Customer, Territory, Outlet, Retail Network &
  Sales Foundation") shipped the `Customer` master record (progressive onboarding — only
  type/name/phone required, per-customer-type descriptive only, never a sales
  restriction) and the `SalesOrder`/`SalesOrderItem` foundation: server-authoritative
  totals, SKU-level targeting only (never a Sprint 4.7 Product Family/Variant directly),
  `DRAFT → CONFIRMED`/`CANCELLED` lifecycle, and a deliberate, structurally-enforced
  guarantee that creating or confirming an order never touches inventory. Sprint 4.9
  ("Sales Execution & Order Fulfilment Foundation") added **Fulfilment**: the one
  explicit, atomic, audited, idempotent operation that actually supplies goods and
  deducts `InventoryStock` (`DRAFT → CONFIRMED → PARTIALLY_FULFILLED → FULFILLED`,
  multiple fulfilment batches per order, over-fulfilment/negative-stock structurally
  impossible, cancellation blocked once fulfilment starts) — confirmation itself still
  never touches inventory. A mobile-first Field Sales workspace (`/field`) and a desktop
  Admin surface (`/settings/sales`) share this one backend, including the new Fulfilment
  UI. Sprint 6 ("Finance Foundation") shipped Invoicing/Payments as their own domain
  (Epic 16, below) rather than folding them into Sales. Sprint 10 ("Sales Fulfilment &
  COGS Accounting Integration") wired Fulfilment to the General Ledger — `DR Cost of
Goods Sold / CR Finished Goods Inventory`, one journal per fulfilment batch, valued
  at Inventory's own moving-weighted-average cost (Sprint 9's costing engine, reused
  not reinvented) — deliberately kept separate from Invoice's own `DR Accounts
Receivable / CR Sales Revenue` posting (Sprint 6/7): revenue and inventory cost are
  recognised at different business moments and neither event impersonates the other.
  Sprint 11 ("Returns, Claims & Reversals Foundation") added **Customer Returns**:
  `CustomerReturn`, a two-phase `REQUESTED → RECEIVED`/`CANCELLED` aggregate that
  always references a specific `SalesFulfilmentItem`, never edits the original order/
  fulfilment/invoice. `receive()` is the one atomic event — per-line disposition
  (resalable/damaged/quarantine/scrap, only resalable restocks inventory), a COGS-
  reversal journal (`DR Finished Goods Inventory / CR Cost of Goods Sold`, valued at
  the original fulfilment's own frozen cost), and Credit Note issuance (reusing
  Finance's existing engine, valued independently by a `quantityCredited` figure that
  is never assumed equal to the resalable quantity). Inventory reservation, delivery/
  route tracking, a pricing engine, and any WMS-grade quarantine/hold model for
  returned goods remain — see [`docs/domains/customers.md`](domains/customers.md) and
  [`docs/domains/sales.md`](domains/sales.md).

### Epic 8 — Distribution

- **Objective:** connect production to the people who move goods to market — reframed in
  Sprint 4.8 as the **Retail Intelligence Network**: a living digital map of the market
  around the manufacturer, captured progressively as the sales team discovers it in the
  field, never pre-modelled in advance.
- **Includes:** Sales Representatives, Distributors, Wholesalers, Retailers, Delivery
  Tracking, Route Planning.
- **Status:** In progress — Sprint 4.8 shipped `Outlet` (the physical place of business,
  distinct from the `Customer` commercial account, with foundational multi-photo
  capture), `Territory` (a self-referential, tenant-defined hierarchy of arbitrary depth
  — not fixed administrative boundaries), and `DistributionNetworkRelationship` (an
  optional, separate concept from commercial transactions — a customer never requires a
  network mapping to be registered or to place an order, and historical sales are never
  rewritten when a relationship is added or changed later). Sprint 5 ("Distribution &
  Delivery Operations Foundation") added `Dispatch`/`DispatchItem` (the physical release
  of already-fulfilled goods, chained off an existing `SalesFulfilment`) and
  `Delivery`/`DeliveryItem` (confirmation of what actually arrived, supporting partial/
  short delivery with free-text discrepancy notes — no reason-code enum, no Returns/
  Claims Management system yet). Inventory is deducted exactly once at Fulfilment;
  Dispatch and Delivery structurally cannot touch `InventoryStock`/`InventoryTransaction`
  again (proven by `distribution-inventory-independence.spec.ts`), and the distribution
  network remains purely informational at this stage too — an "Associated Distributor"
  display, never a gate. Sales Representative territory ownership, fleet/route tracking,
  and a full Returns/Claims workflow remain — see
  [`docs/domains/outlets.md`](domains/outlets.md),
  [`docs/domains/territories.md`](domains/territories.md),
  [`docs/domains/retail-network.md`](domains/retail-network.md) (the keystone
  architectural document for this Epic), and
  [`docs/domains/distribution.md`](domains/distribution.md).

### Epic 9 — CRM

- **Objective:** manage relationships with customers beyond the individual transaction.
- **Includes:** Customer Management, Promotions, Loyalty, Communication, Campaigns.
- **Status:** Not started.

### Epic 10 — Consumer Network

- **Objective:** extend the platform to the end consumer.
- **Includes:** QR Code Registration, Consumer Profiles, Rewards, Gamification,
  Referrals, Product Reviews, Nearby Retail Locator.
- **Status:** Not started.

### Epic 11 — Business Intelligence

- **Objective:** turn the data every prior Epic generates into decisions.
- **Includes:** Dashboards, KPIs, Retail Intelligence, Distribution Analytics, Consumer
  Behaviour, Executive Reports.
- **Status:** Not started.

### Epic 12 — AI Platform

- **Objective:** apply intelligence on top of a mature operational and data foundation.
- **Includes:** Sales Forecasting, Demand Prediction, Smart Inventory, Procurement
  Suggestions, Production Optimisation, AI Assistant.
- **Status:** Not started.

### Epic 13 — Public Website & Marketing

- **Objective:** communicate the Zentuva vision, establish trust, and create entry points
  for onboarding — the unauthenticated, public-facing side of the product.
- **Includes:** Landing page, product positioning and marketing copy, brand identity,
  demo/early-access capture, tenant registration and sign-in, future content (blog, docs
  site, careers).
- **Status:** In progress — landing page (`/`) shipped in Sprint 3.1; tenant registration
  (`/register`, `/register/success`) and sign-in (`/login`, `/login/forgot-password`)
  shipped in Sprint 3.2, including a rebalanced brand palette (purple for brand/heading
  elements, pink for interactive/CTA elements) applied across both the marketing site and
  the new auth pages. Demo/early-access form capture (the "Book a Demo" CTA) and any
  additional public pages remain.

### Epic 14 — Asset & Maintenance Management

- **Objective:** track the factory equipment, vehicles, and long-term business assets a
  manufacturing operation depends on, and keep them running.
- **Includes:** Asset Register (equipment, vehicles, and other long-term assets),
  Preventive Maintenance Scheduling, Equipment Servicing History.
- **Status:** Not started. Placeholder "Coming Soon" navigation entries (Asset Register,
  Maintenance) were added to the Workspace sidebar and dashboard in Sprint 3.5.1 so the
  navigation reflects this Epic ahead of its design — no domain design work has happened
  yet.

### Epic 15 — Supplier Management

- **Objective:** maintain the master record of every vendor an organisation buys goods or
  services from.
- **Includes:** Supplier master data (identity, classification, contact/location fields,
  Active/Inactive status). Deliberately excludes Purchase Orders, Goods Receiving,
  Procurement Workflows, Contracts, and Price Lists (those belong to Epic 4 once it's
  built on top of this foundation), and Supplier Invoices/Vendor Payments (those belong
  to Epic 16, Finance, as `SupplierInvoice`/`SupplierPayment` — Sprint 12).
- **Status:** Foundation implemented — Sprint 4.2 ("Supplier Management"), reusing the
  Sprint 4.1 Product Catalogue's architecture (auto-generated immutable code, the same
  Owner/Administrator-write, Member-read-only authorization) — see
  [`docs/domains/suppliers.md`](domains/suppliers.md). Sprint 12 added a read-only
  Supplier detail view surfacing Epic 16's Accounts Payable balance for that supplier.

### Epic 16 — Finance

- **Objective:** record the financial consequence of what Sales, Inventory, and
  Distribution have already recorded — what a customer was billed, what they've paid,
  what they still owe. Explicitly **not** a General Ledger / accounting system.
- **Includes:** Invoices, Payments (with partial-payment support), Credit Notes,
  Accounts Receivable, Payment Terms, a minimal tax foundation, and (Sprint 12)
  Accounts Payable — Supplier Invoices matched against Goods Receipt, Supplier
  Payments, Supplier Credit Notes, and (Sprint 13) a read-only Financial Statements &
  Management Reporting layer — Profit & Loss, Balance Sheet, AR/AP ageing, Inventory
  Valuation/Reconciliation, a Management Dashboard. Deliberately excludes Cash Flow
  Statement, payroll, fixed assets, a full tax engine, sophisticated pricing, credit
  scoring, payment-gateway integration, payment runs, an Expense Management module,
  budgeting, and multi-company consolidation — all future sprints. Chart
  of Accounts, Journal Entries, General Ledger, Trial Balance, Profit & Loss, Balance
  Sheet, (Sprint 14, Epic 18 below) Bank Reconciliation, and (Sprint 15, Epic 19
  below) Cashflow Forecasting are no longer excluded — **budgeting/budget-vs-actual
  remains excluded**, a deliberately separate future sprint from cashflow
  forecasting (see Epic 19's own objective for why the two are not the same thing).
- **Status:** Foundation implemented — Sprint 6 ("Finance Foundation"). Invoices are
  raised against a `FULFILLED` Sales Order, snapshotting commercial terms permanently;
  Payments support partial settlement via a `PaymentAllocation` join table designed for
  future multi-invoice allocation without a `Payment` rewrite; Credit Notes are a
  lightweight, flat-amount foundation (no line-item detail); Accounts Receivable is
  computed on read (`groupBy`/`aggregate`), never independently stored;
  `Invoice.status`'s `OVERDUE` transition is kept authoritative via a lazy sweep on
  every read (no scheduler infrastructure exists in this codebase). Finance is structurally unable to
  read Dispatch/Delivery data or write to any upstream domain's tables
  (`finance-independence.spec.ts`) — see [`docs/domains/finance.md`](domains/finance.md).
  Sprint 7 added the accounting layer described in Epic 17, below, and wired Finance's
  three financial events to post to it automatically. Sprint 12 ("Accounts Payable &
  Supplier Invoice Management") added the supplier-side mirror: `SupplierInvoice`
  reconciles what a supplier bills against what Sprint 8's Goods Receipt already
  recognised as payable (capped, never inflated — a discrepancy is surfaced, not
  hidden), `SupplierPayment`/`SupplierCreditNote` are direct structural mirrors of
  `Payment`/`CreditNote`, and a PO-less/GR-less bill posts against an explicit,
  user-chosen Chart of Accounts "Debit Account" rather than a guessed default — see
  [`docs/domains/finance.md`](domains/finance.md) §12. Sprint 13 ("Financial
  Statements & Management Reporting Foundation") added a read-only reporting layer —
  Profit & Loss, Balance Sheet, AR/AP ageing, Inventory Valuation, an
  Inventory-to-Ledger Reconciliation report, and a Management Dashboard — deriving
  every figure from data Sprints 6-12 already produce, with **zero schema changes**
  and no new writes anywhere in Finance — see
  [`docs/domains/finance.md`](domains/finance.md) §13. Sprint 14 ("Cash & Bank
  Management / Reconciliation Foundation") gave `Payment`/`SupplierPayment` an
  optional `cashAccountId` so a payment can identify the specific bank/cash account
  it moved through, fully backward-compatible with every payment recorded before
  this sprint — see [`docs/domains/finance.md`](domains/finance.md) §14 and Epic 18
  below for the new Cash & Bank Management domain itself. Sprint 15 ("Cashflow
  Management & Forecasting") added a forward-looking, never-persisted forecast
  layer built entirely on data Sprints 13-14 already expose (AR/AP outstanding
  balances, Cash Account Book Balances) — zero schema changes to any existing
  Finance model — see [`docs/domains/finance.md`](domains/finance.md) §15 and
  Epic 19 below for the new Cashflow Management domain itself.

### Epic 17 — Accounting

- **Objective:** establish the accounting engine underneath Finance and every future
  operational module — a Chart of Accounts, Accounting Periods, double-entry Journal
  Entries, and a General Ledger. Explicitly the accounting _engine_, not accounting
  _software_.
- **Includes:** tenant-defined Chart of Accounts (self-referential hierarchy, system
  accounts resolved by key, never hardcoded id), Accounting Periods (open/closed, only
  open periods receive postings), Journal Entries (server-authoritative double-entry
  validation, immutable once posted), General Ledger/Trial Balance/Account Activity
  reporting, automatic posting for Finance's `invoice.issued`/`payment.recorded`/
  `credit-note.issued` events, (Sprint 8) automatic posting for Inventory's Goods
  Receipt event, (Sprint 9) automatic posting for Production's Material Issue and
  Production Completion events, (Sprint 10) automatic posting for Sales's Fulfilment
  event, (Sprint 12) Supplier Invoice matching against Goods Receipt (capped
  recognition, discrepancy surfaced not hidden) plus a Path B posting for PO-less
  bills against an explicit Chart of Accounts entry, (Sprint 13) a read-only
  Financial Statements & Management Reporting layer (P&L, Balance Sheet, AR/AP
  ageing, Inventory Valuation/Reconciliation, Dashboard) derived from the existing
  ledger with zero schema changes, and (Sprint 14) two new elevated system accounts
  (`CASH_BANK_PARENT`, `OPENING_BALANCE_EQUITY`) backing Cash & Bank Management's
  opening-balance postings (Epic 18). Deliberately excludes Cash Flow Statement,
  payment runs, an approval workflow to reclassify `GRNI — Pending Approval`
  balances into `AP`, payroll, fixed-asset accounting, a full tax engine, budgeting,
  year-end closing / retained-earnings closing workflow, labour/machine/overhead
  costing, multi-company consolidation, and advanced BI/data-warehouse tooling —
  all future work. Sales Returns/COGS-reversal, Supplier Returns, Accounts
  Payable/supplier invoice matching, Profit & Loss/Balance Sheet reporting, and Bank
  Reconciliation are no longer future work — see Sprint 11/12/13/14 below.
- **Status:** Foundation implemented — Sprint 7 ("General Ledger & Accounting
  Foundation"). `InvoiceRepository.issue()`/`PaymentRepository.create()`/
  `CreditNoteRepository.issue()` each atomically post a double-entry `JournalEntry` via
  a plain, dependency-injection-free posting boundary
  (`accounting/journal-posting.ts`) designed so future Procurement/Production/
  Inventory integrations can reuse the same functions without depending on
  `FinanceModule`. Trial Balance always balances by double-entry construction; the
  General Ledger's running balance is computed deterministically in application code,
  never a SQL window function. Sprint 8 ("Procurement, Inventory & Accounting
  Integration") proved that reusability out: `GoodsReceiptRepository.receive()` now
  calls the same `postSystemJournalEntry` from inside its own transaction, adding one
  new system account (`GRNI_PENDING_APPROVAL`) so goods physically accepted beyond a
  Purchase Order's own commercially-agreed quantity post to a distinct clearing
  account rather than inflating `AP` — see
  [`docs/domains/accounting.md`](domains/accounting.md) §9. Sprint 9 ("Manufacturing
  Accounting Integration") extended the same boundary into manufacturing: two new
  system accounts (`WIP`, `PRODUCTION_LOSS`) plus elevating the pre-existing "Finished
  Goods" account to a system account (`FINISHED_GOODS_INVENTORY`); Production's
  Material Issue and Production Completion each post through
  `postSystemJournalEntry` from inside their own atomic transactions, valued using a
  new persisted costing figure (`InventoryStock.averageUnitCost`, a moving weighted
  average — see [`docs/domains/inventory.md`](domains/inventory.md) §11b) — no new
  accounting mechanism, no production-specific journal table — see
  [`docs/domains/accounting.md`](domains/accounting.md) §10. Sprint 10 ("Sales
  Fulfilment & COGS Accounting Integration") closed the last major gap in this chain:
  `SalesFulfilmentRepository.create()` now posts `DR Cost of Goods Sold / CR Finished
Goods Inventory` through the same `postSystemJournalEntry` boundary, valued at the
  same `averageUnitCost` Production already reads — no new system accounts needed
  (`COGS` had been seeded and reserved since Sprint 7), no new costing engine, and
  deliberately kept as a separate accounting event from Invoice's own `DR AR / CR Sales
Revenue` posting, since revenue and inventory cost are recognised at different
  business moments — see [`docs/domains/accounting.md`](domains/accounting.md) §11.
  Sprint 11 ("Returns, Claims & Reversals Foundation") wired the reverse flow through
  the same boundary: `CustomerReturn.receive()` posts a COGS-reversal journal (`DR
Finished Goods Inventory / CR Cost of Goods Sold`) plus an independently-valued
  Credit Note; `SupplierReturn.create()` posts an excess-first-allocated reversal
  (`DR AP` and/or `DR GRNI_PENDING_APPROVAL` / `CR Inventory`) that correctly draws
  down the excess/GRNI balance before touching the payable/AP balance — verified
  against this codebase's own excess-supply seed data. Zero new system accounts
  needed for either — see [`docs/domains/accounting.md`](domains/accounting.md) §12.
  Sprint 12 ("Accounts Payable & Supplier Invoice Management") closed the remaining
  gap this epic's own excluded-list used to name: `SupplierInvoiceRepository.post()`
  computes and freezes a per-line match result (`computeLineMatch`) capping AP
  recognition at what Goods Receipt already posted — mathematically incapable of
  inflating it — and groups any PO-less/GR-less "Debit Account" lines into one
  balanced journal per invoice, reusing a small, generic extension to the shared
  posting boundary (`PostingLineInput.accountId`) rather than a new mechanism. Zero
  new system accounts needed — see
  [`docs/domains/accounting.md`](domains/accounting.md) §13. Sprint 13 ("Financial
  Statements & Management Reporting Foundation") proved the accounting foundation
  built by Sprints 7-12 was already reporting-ready: `FinancialStatementService`
  derives a correct Profit & Loss and Balance Sheet purely from `ChartOfAccount.type`
  via normal-balance-sign summation (no new metadata), a computed, non-posted
  "Retained Earnings (Undistributed)" line makes the accounting equation hold by
  construction (no year-end-closing mechanism was built), and a new, narrow,
  read-only exception lets Finance read `InventoryStock` directly for an Inventory
  Valuation and an Inventory-to-Ledger Reconciliation report that surfaces — never
  auto-corrects — a discrepancy. **Zero database migrations.** See
  [`docs/domains/accounting.md`](domains/accounting.md) §16. Sprint 14 ("Cash &
  Bank Management / Reconciliation Foundation") added `CASH_BANK_PARENT`
  (elevating the already-seeded "1100 Cash & Bank" row) and
  `OPENING_BALANCE_EQUITY` (elevating "3100 Owner's Capital") — the same
  system-account-elevation backfill pattern Sprint 9 used for
  `FINISHED_GOODS_INVENTORY` — backing the new Cash & Bank Management domain's
  opening-balance postings. See [`docs/domains/accounting.md`](domains/accounting.md)
  §17 and Epic 18 below.

### Epic 18 — Cash & Bank Management

- **Objective:** connect the General Ledger to the organisation's real-world cash
  and bank accounts — what cash/bank accounts exist, what the accounting system
  says the balance should be, what the actual bank statement says, and what
  remains unreconciled. Explicitly a foundation for future loan/debt/investment
  management and capital-planning intelligence — cashflow forecasting (originally
  scoped here as future work) was built the very next sprint, as Epic 19 below,
  reusing this epic's `CashAccount` Book Balance unmodified.
- **Includes:** a `CashAccount` master (each linked to its own dedicated,
  system-provisioned Chart of Accounts row, never the generic `CASH`/`BANK` system
  accounts), an optional opening balance posted atomically at account creation,
  `CashTransaction` for cash movements outside the existing Payment/Supplier
  Payment flows, CSV bank-statement import (client-side column mapping,
  server-side re-validation and two-layer deduplication), and a
  `BankReconciliation` workflow (bulk unambiguous auto-match, manual match, a hard
  zero-unmatched completion rule, immutable once completed) distinguishing Book
  Balance from Reconciled Balance from Unreconciled Difference. Deliberately
  excludes loan management, debt management, investment management, capital
  planning, AI financial recommendations, bank API/Open Banking integration,
  payment-gateway integration, payroll, expense management, budgeting, advanced
  treasury management, a multi-currency treasury engine, and complex
  bank-matching AI — all explicit future work, though the architecture (the
  `CashAccount`/Chart-of-Accounts link, and the `accountId`-based posting
  extension it reuses from Sprint 12) was deliberately shaped so those can be
  added later without rebuilding this foundation.
- **Status:** Foundation implemented — Sprint 14 ("Cash & Bank Management /
  Reconciliation Foundation"). `CashAccountRepository.create()` atomically
  provisions a dedicated child Chart of Accounts row (under the org's `CASH`/
  `BANK`/`CASH_BANK_PARENT` system account, chosen by `accountType`) and, if an
  opening balance is supplied, posts `DR <that row> / CR OPENING_BALANCE_EQUITY`
  through the same `postSystemJournalEntry` boundary every other domain uses — no
  new posting mechanism. `Payment`/`SupplierPayment` gained an optional
  `cashAccountId` that, when set, targets that specific account's own CoA row
  instead of the generic `CASH`/`BANK` system account; omitting it preserves
  pre-Sprint-14 behaviour exactly. `BankReconciliation`/`ReconciliationMatch` never
  post anything — a `ReconciliationMatch` references a `JournalEntryLine.id`
  directly (the GL's own record, never a polymorphic guess at which table
  produced it), and `complete()` is blocked while any bank or book transaction
  remains unmatched, never silently forcing the books to equal the bank. Zero
  schema changes touched any existing table's meaning — only additive columns/
  models and two elevated system accounts (Epic 17 above). See
  [`docs/domains/cash-management.md`](domains/cash-management.md) and
  [`docs/domains/finance.md`](domains/finance.md) §14.

### Epic 19 — Cashflow Management

- **Objective:** answer the forward-looking question none of Epics 16-18
  answer — how much cash are we likely to have next month, and when might we
  run short? Explicitly **not** budgeting: budgeting asks "what do we plan to
  earn/spend," cashflow forecasting asks "when will money actually move,"
  given what is already known (outstanding invoices, known commitments).
  Explicitly not loan/debt/investment/capital management, though the
  source-type model is deliberately extensible toward one later.
- **Includes:** a forecast (Opening Cash + Inflows − Outflows = Closing Cash,
  weekly/monthly buckets, configurable 30/60/90/180/365-day horizons) that is
  **never persisted** — recomputed live on every request from outstanding
  AR/AP (reusing Sprint 13's own aging queries unmodified) and Cash Account
  Book Balances (Sprint 14); management-entered `CashflowForecastItem`s
  (one-time or recurring known commitments, distinguished from AR/AP so a real
  transaction can never be double-counted); Base/Conservative/Optimistic
  `CashflowScenario`s (configurable delay+multiplier knobs, never a
  predictive model); a `CashflowForecastAdjustment` letting an authorized user
  override a single forecast item's expected date/amount without ever writing
  to the underlying Invoice/SupplierInvoice; a configurable minimum cash
  reserve with shortfall detection worded as a planning signal, never a claim
  of insolvency; a per-cash-account forecast that never implies money can move
  between accounts. Deliberately excludes budgeting, budget-vs-actual, loan/
  debt/investment/capital management, AI/ML forecasting, credit scoring,
  expense management, payroll, bank API/Open Banking/payment-gateway
  integration, treasury management, and advanced financial modelling — all
  explicit future work.
- **Status:** Foundation implemented — Sprint 15 ("Cashflow Management &
  Forecasting"). The forecast engine posts nothing, ever, and touches no
  existing Finance table — proven executably by
  `cashflow-independence.spec.ts`, not just documented here. Four new models
  (`CashflowForecastItem`, `CashflowScenario`, `CashflowForecastAdjustment`,
  `CashflowSettings`) hold only raw inputs, never a computed result; zero
  schema changes to any pre-existing model; zero new `SYSTEM_ACCOUNT_KEYS`.
  See [`docs/domains/cashflow.md`](domains/cashflow.md) and
  [`docs/domains/finance.md`](domains/finance.md) §15.

### Epic 20 — Budgeting & Financial Planning

- **Objective:** answer what none of Epics 16-19 answer — what did we plan to
  earn/spend, and how does reality compare? Explicitly not a second accounting
  system: actuals are always read live from the General Ledger, never
  duplicated into budget tables. Explicitly a foundation for a future
  loan/debt/investment/capital management epic — built as Epic 21, below.
- **Includes:** a `Budget` (fiscal-year-scoped, its own version _and_ its own
  scenario via `version`/`revisesBudgetId`/`scenarioName` — no separate
  `BudgetVersion`/`BudgetScenario` tables) with `BudgetLine`s distinguishing
  Revenue/Operating Expense (a required Chart of Accounts reference) from
  CAPEX (optional — no Fixed Asset account exists yet); a `DRAFT → APPROVED →
ACTIVE → CLOSED` lifecycle (plus an automatic `SUPERSEDED` on revision-
  activation); Cost Centres (a lightweight, standalone budget-line tag, never
  linked to the Chart of Accounts); Budget vs Actual (one scoped Ledger query
  per budget, the same normal-balance-sign convention Epic 16's own reporting
  layer established); Budget vs Cashflow Forecast (genuinely reuses Epic 19's
  own forecast engine, never a duplicated one). Deliberately excludes
  investment management, capital planning, AI/ML financial planning, credit
  scoring, expense management, payroll, tax management, procurement-
  commitment budgeting, and purchase-requisition budgeting — all explicit
  future work, though the architecture (planned CAPEX + Budget vs Forecast)
  was deliberately shaped so a future capital-decision layer can read from it
  without any schema change.
- **Status:** Foundation implemented — Sprint 16 ("Budgeting & Financial
  Planning Foundation"). Zero `postSystemJournalEntry` calls anywhere in the
  module — proven executably by `budgeting-independence.spec.ts`, not just
  documented here. Three new models (`Budget`, `BudgetLine`, `CostCentre`)
  hold only planned inputs, never a computed result; zero schema changes to
  any pre-existing model; zero new `SYSTEM_ACCOUNT_KEYS`. See
  [`docs/domains/budgeting.md`](domains/budgeting.md) and
  [`docs/domains/finance.md`](domains/finance.md) §16.

### Epic 21 — Capital & Debt Management

- **Objective:** answer what none of Epics 16-20 answer — what capital do we
  need, how should we finance it, and can we afford the repayment? Not just a
  CRUD loan-management module: a `CapitalRequirement` → `DebtFacility` →
  `DebtDrawdown`/`DebtRepayment` chain that posts through the same General
  Ledger boundary every other Finance epic uses, feeds the existing Cashflow
  Forecast as financing outflows, and prepares — without building — the data
  architecture a future capital-decision engine will need.
- **Includes:** `CapitalRequirement` (the business case for financing,
  `DRAFT → PROPOSED → APPROVED → FUNDED → COMPLETED`, optionally referencing
  a `Budget`/`BudgetLine` read-only for a live Budget Coverage %); a
  lightweight `Lender` master; `DebtFacility` (`PROPOSED → APPROVED → ACTIVE
→ PARTIALLY_REPAID → PAID_OFF`, plus `CANCELLED`/`DEFAULTED`) with a
  user-chosen non-system liability/interest-expense account pair (Epic 17's
  own "Path B" pattern, reused a third time — no single global loan
  liability account); a server-generated `DebtRepaymentSchedule`
  (Amortising/Interest-Only/Bullet, explicit grace-period behaviour, never
  recomputed per drawdown); `DebtDrawdown`/`DebtRepayment` distinguishing
  principal/interest/fees always separately, posting `DR Cash / CR Loan
Payable` and `DR Loan Payable [+ DR Interest Expense] [+ DR Fee Expense] /
CR Cash` respectively; a debt balance always computed live, never stored;
  server-side rejection of over-repayment; automatic `PAID_OFF` on full early
  repayment; a `PROPOSED` facility doubling as its own financing-scenario
  preview (structurally invisible to the live forecast/GL until an actual
  drawdown activates it); outstanding schedule installments feeding the
  existing Cashflow Forecast as `CONFIRMED` financing outflows — no Budget-
  side code change needed for debt service to appear in Budget vs Forecast.
  Deliberately excludes investment/equity/bond/fixed-asset management, a
  loan-application workflow, credit scoring, automatic loan approval, bank/
  payment-gateway integrations, a collections system, automatic penalty
  interest, tax treatment of financing, and a full NPV/IRR/DCF engine — all
  explicit future work for the Capital Decision Analysis engine this epic's
  own architecture prepares for but does not build.
- **Status:** Foundation implemented — Sprint 17 ("Capital & Debt Management
  Foundation"). Zero new `SYSTEM_ACCOUNT_KEYS`; six new models (`Lender`,
  `CapitalRequirement`, `DebtFacility`, `DebtDrawdown`,
  `DebtRepaymentSchedule`, `DebtRepayment`) hold planned/transactional data
  only, debt balance itself never stored; structural independence from
  Sales/Inventory/Procurement/Production proven by `debt-independence.spec.ts`.
  See [`docs/domains/debt-management.md`](domains/debt-management.md) and
  [`docs/domains/finance.md`](domains/finance.md) §17.

### Epic 22 — Investment / Capital Project Management

- **Objective:** give management a structured way to define, plan, approve,
  fund, track, and evaluate capital projects and investments — a management
  layer over Epics 16-21 and Procurement/AP, never a second accounting,
  budgeting, cashflow, debt, or procurement engine. Explicitly not the
  financial-decision engine — no NPV/IRR/ROI/payback/scenario comparison,
  which is a future epic's job — this epic captures clean planning
  assumptions and derives real financial performance from already-existing
  transactions.
- **Includes:** a `CapitalProject` (`DRAFT → PROPOSED → UNDER_REVIEW →
APPROVED → ACTIVE → COMPLETED`, plus `ON_HOLD`/`CANCELLED`) whose Planned
  Cost is always the server-computed sum of its own `CapitalProjectCostLine`
  rows, never a stored or client-supplied total; Committed/Actual Cost
  derived live from an optionally-linked Purchase Order (one new nullable
  FK on this epic's own table — zero schema/module changes to Procurement)
  and the existing Accounts Payable recognition already built for the
  Purchase Order's own Financial Summary block; `CapitalProjectFunding`
  (Cash/Debt/Other) referencing an existing `DebtFacility`/`CashAccount`
  directly — the repayment schedule stays owned entirely by Epic 21, never
  duplicated — with Fully/Under/Overfunded status always computed live; an
  optional, bidirectionally-independent link to a `CapitalRequirement`
  and/or `Budget`/`BudgetLine` (read-only Budget Allocation %, never
  mutating the budget); an `ACTIVE` project's planned cost lines (with no
  linked PO) feeding the existing Cashflow Forecast as `ESTIMATED`
  outflows, excluded once a real PO is linked to avoid double-counting with
  the existing Supplier Payable source; investment assumptions (expected
  revenue/cost impact, capacity change, useful life) captured as raw
  planning inputs for a future decision-engine epic. Deliberately excludes
  NPV/IRR/ROI/payback/scenario-comparison calculations, financing-
  allocation optimisation, and any Gantt/task-management functionality —
  all explicit future work.
- **Status:** Foundation implemented — Sprint 18 ("Investment / Capital
  Project Management Foundation"). Zero new `SYSTEM_ACCOUNT_KEYS`; three new
  models (`CapitalProject`, `CapitalProjectCostLine`,
  `CapitalProjectFunding`) hold planning/funding data only; zero
  `postSystemJournalEntry` calls anywhere in the module — proven
  executably by `investment-independence.spec.ts`. See
  [`docs/domains/investment-projects.md`](domains/investment-projects.md)
  and [`docs/domains/finance.md`](domains/finance.md) §18.

## 5. Current Sprint Status

**Completed:**

- ✓ Sprint 0 — Engineering Foundation
- ✓ Sprint 1A — Identity Domain Design
- ✓ Sprint 1A.1 — Identity Domain Design Refinements
- ✓ Sprint 1B.1 — Identity Domain Implementation (Database & Domain Layer)
- ✓ Sprint 1B.2 — Identity Domain Implementation (Authentication Layer)
- ✓ Sprint 2.1 — Organisation Management (Organisation Profile)
- ✓ Sprint 2.2 — Organisation Management (User Management)
- ✓ Sprint 3.1 — Public Marketing Website (Landing Page)
- ✓ Sprint 3.2 — Tenant Registration & Organisation Onboarding
- ✓ Sprint 3.3 — Account Management & Authentication Experience
- ✓ Sprint 3.4 — Workspace Configuration & Organisation Branding
- ✓ Sprint 3.5 — Workspace Dashboard & Global Navigation
- ✓ Sprint 4.1 — Product Catalogue Foundation
- ✓ Sprint 3.5.1 — Workspace Navigation Refinement (Coming Soon Modules)
- ✓ Sprint 4.2 — Supplier Management
- ✓ Sprint 4.3 — Procurement (Purchase Orders)
- ✓ Sprint 4.4 — Inventory Management (Goods Receiving)
- ✓ Sprint 4.4.1 — Goods Receiving, Inspection & Supplier Discrepancy Refinement
- ✓ Sprint 4.5 — Inventory Control & Stock Management
- ✓ Sprint 4.6 — Production Management & Bill of Materials Foundation
- ✓ Sprint 4.7 — Product Family, Variant & SKU Architecture Refinement
- ✓ Sprint 4.8 — Customer, Territory, Outlet, Retail Network & Sales Foundation
- ✓ Sprint 4.9 — Sales Execution & Order Fulfilment Foundation
- ✓ Sprint 5 — Distribution & Delivery Operations Foundation
- ✓ Sprint 6 — Finance Foundation
- ✓ Sprint 7 — General Ledger & Accounting Foundation
- ✓ Sprint 8 — Procurement, Inventory & Accounting Integration
- ✓ Sprint 9 — Manufacturing Accounting Integration
- ✓ Sprint 10 — Sales Fulfilment & COGS Accounting Integration
- ✓ Sprint 11 — Returns, Claims & Reversals Foundation
- ✓ Sprint 12 — Accounts Payable & Supplier Invoice Management
- ✓ Sprint 13 — Financial Statements & Management Reporting Foundation
- ✓ Sprint 14 — Cash & Bank Management / Reconciliation Foundation
- ✓ Sprint 15 — Cashflow Management & Forecasting
- ✓ Sprint 16 — Budgeting & Financial Planning Foundation
- ✓ Sprint 17 — Capital & Debt Management Foundation
- ✓ Sprint 18 — Investment / Capital Project Management Foundation

**Current focus:** Next sprint not yet scoped.

## 6. Future Ideas (Not Prioritised Yet)

These are intentionally outside the MVP — recorded so they aren't lost, not because
they're scheduled:

- Mobile applications
- Marketplace
- Offline-first support
- IoT integration
- Manufacturing hardware integration
- AI agents
- Multi-language support
- Public APIs
- Partner ecosystem

## 7. Backlog Maintenance

This backlog is a living document. Epics and priorities may be reordered as the business
grows and as real usage from Boby Bites (and future tenants) clarifies what matters most.
Completed work stays recorded here for historical reference rather than being deleted —
this document should always show where Zentuva has been, not just where it's going. Every
sprint that changes scope, completes an Epic, or reprioritises the roadmap should update
this document as part of that sprint's work, per
[Handbook Principle 7](handbook/engineering-handbook.md#5-product-principles).
