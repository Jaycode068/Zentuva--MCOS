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
  Purchase Order confirmation itself still creates no accounting entry. Supplier
  Performance, Purchase Approval Workflow, and Invoices remain.

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
  protection before this sprint). Warehouse Transfers, Reservation/Allocation, a
  running inventory Valuation ledger (FIFO/weighted-average/COGS), Low Stock alerting,
  and a full Warehouse Management System remain — see
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
  `InventoryTransaction` `RECEIPT` rows. Deliberately not a full MRP or Quality
  Management System — no scheduling, no multi-level BOMs, no costing/labour/machine
  allocation, no batch/lot/expiry tracking, no automatic procurement from a shortfall —
  see [`docs/domains/production.md`](domains/production.md).

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
  (Epic 16, below) rather than folding them into Sales. Returns, inventory reservation,
  delivery/route tracking, and a pricing engine remain — see
  [`docs/domains/customers.md`](domains/customers.md) and
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
  Invoices, Vendor Payments, Procurement Workflows, Contracts, Price Lists, and
  Product–Supplier relationships — those belong to Epic 4 (Procurement) once it's built on
  top of this foundation.
- **Status:** Foundation implemented — Sprint 4.2 ("Supplier Management"), reusing the
  Sprint 4.1 Product Catalogue's architecture (auto-generated immutable code, the same
  Owner/Administrator-write, Member-read-only authorization) — see
  [`docs/domains/suppliers.md`](domains/suppliers.md).

### Epic 16 — Finance

- **Objective:** record the financial consequence of what Sales, Inventory, and
  Distribution have already recorded — what a customer was billed, what they've paid,
  what they still owe. Explicitly **not** a General Ledger / accounting system.
- **Includes:** Invoices, Payments (with partial-payment support), Credit Notes,
  Accounts Receivable, Payment Terms, a minimal tax foundation. Deliberately excludes
  Chart of Accounts, Journal Entries, General Ledger, Trial Balance, Profit & Loss,
  Balance Sheet, Cash Flow Statement, Bank Reconciliation, payroll, fixed assets, a full
  tax engine, sophisticated pricing, credit scoring, and payment-gateway integration —
  all future sprints.
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
  three financial events to post to it automatically.

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
  `credit-note.issued` events, and (Sprint 8) automatic posting for Inventory's Goods
  Receipt event. Deliberately excludes Chart of Accounts → financial-statement closing
  (P&L, Balance Sheet, Cash Flow Statement), Bank Reconciliation, a full Accounts
  Payable module (supplier invoice matching, payment runs, AP ageing, an approval
  workflow to reclassify `GRNI — Pending Approval` balances into `AP`), payroll,
  fixed-asset accounting, a full tax engine, budgeting, year-end closing, and
  accounting integration for Production or Sales Fulfilment — all future sprints.
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
  [`docs/domains/accounting.md`](domains/accounting.md) §9.

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
