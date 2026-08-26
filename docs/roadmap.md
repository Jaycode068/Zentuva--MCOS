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
      Orders and Product–Supplier relationships arrive with Procurement) — see
      [`docs/domains/suppliers.md`](domains/suppliers.md)
- [x] Procurement — Purchase Order management shipped Sprint 4.3 (create/edit/cancel,
      automatic totals); status lifecycle now also reaches `PARTIALLY_RECEIVED`/
      `RECEIVED`, set by Inventory's receiving workflow (Sprint 4.4.1); approval
      workflow and invoicing remain — see
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
      that same figure; warehouse transfers, reservation, and a full WMS remain — see
      [`docs/domains/inventory.md`](domains/inventory.md)
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
      posting; Returns/COGS-reversal/inventory reservation remain — see
      [`docs/domains/customers.md`](domains/customers.md),
      [`docs/domains/sales.md`](domains/sales.md)
- [x] Distribution — reframed as the Retail Intelligence Network, foundation shipped
      Sprint 4.8 (`Outlet`, `Territory` hierarchy, `DistributionNetworkRelationship` kept
      structurally separate from commercial transactions so direct sales never require a
      distributor mapping); Sprint 5 added `Dispatch`/`Delivery` (the physical release of
      already-fulfilled goods and confirmation of what arrived, chained off Sales
      Fulfilment, inventory deducted exactly once and never again at either stage);
      fleet/route planning and a full Returns/Claims workflow remain — see
      [`docs/domains/outlets.md`](domains/outlets.md),
      [`docs/domains/territories.md`](domains/territories.md),
      [`docs/domains/retail-network.md`](domains/retail-network.md),
      [`docs/domains/distribution.md`](domains/distribution.md)
- [x] Finance — foundation shipped Sprint 6 (Invoices raised against a `FULFILLED`
      Sales Order with permanently-snapshotted commercial terms; Payments with
      partial-settlement support via a `PaymentAllocation` join table designed for
      future multi-invoice allocation without a rewrite; a lightweight, flat-amount
      Credit Note; Accounts Receivable computed on read, never independently stored)
      — see [`docs/domains/finance.md`](domains/finance.md)
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
      been seeded and reserved since Sprint 7); not a complete accounting system —
      financial-statement closing (P&L, Balance Sheet), Cash Flow Statement, Bank
      Reconciliation, a full Accounts Payable module, labour/machine/overhead costing,
      and Sales Returns/COGS-reversal remain — see
      [`docs/domains/accounting.md`](domains/accounting.md)

## Phase 3 — Extended Experiences

- [ ] Retail Portal (mobile)
- [ ] Sales Rep mobile workflows
- [ ] Business Intelligence dashboards

## Future

- HR, CRM Automation, Consumer Portal, Loyalty, Promotions, AI Services, Analytics, Marketplace.
