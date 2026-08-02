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
- **Includes:** Categories, Products, Variants, Packaging, Pricing, Units, Product Images.
- **Status:** In progress — the Product Catalogue foundation (master product records:
  identity, classification, commercial fields, one image, Draft/Active/Archived
  lifecycle) shipped in Sprint 4.1, reusing the Sprint 3.4 `FileStorage` upload
  architecture and the same Owner/Administrator-write, Member-read-only authorization as
  every other domain. Sprint 4.3 added a fourth Product Type — Consumable — alongside
  Raw Material/Packaging Material, so Procurement has a complete set of purchasable
  input types (`docs/domains/procurement.md` §2 "Relationships"). Variants, Packaging (as
  a distinct concept from the Packaging category), Pricing, a tenant-configurable
  Categories taxonomy, and inventory/production integration remain — see
  [`docs/domains/catalogue.md`](domains/catalogue.md).

### Epic 4 — Procurement

- **Objective:** manage sourcing raw materials and goods from suppliers.
- **Includes:** Purchase Orders, Goods Received, Supplier Performance. Supplier master
  data itself now lives in its own domain — see Epic 15.
- **Status:** In progress — Purchase Order management (create/edit/cancel, automatic
  line/subtotal/total calculation, Draft/Pending/Cancelled lifecycle) shipped in
  Sprint 4.3, referencing `Supplier.id` (Epic 15, Sprint 4.2) instead of a free-text
  supplier name, per that Epic's own stated purpose. Goods Receiving, Supplier
  Performance, Purchase Approval Workflow, and Invoices remain — see
  [`docs/domains/procurement.md`](domains/procurement.md).

### Epic 5 — Inventory

- **Objective:** track stock across its lifecycle and locations.
- **Includes:** Raw Materials, Finished Goods, Stock Movement, Warehouses, Transfers,
  Stock Adjustment.
- **Status:** Not started.

### Epic 6 — Production

- **Objective:** plan and record the manufacturing process itself.
- **Includes:** Recipes/BOM, Batch Production, Production Planning, Waste, Quality
  Control.
- **Status:** Not started.

### Epic 7 — Sales

- **Objective:** manage the commercial transaction from order to payment.
- **Includes:** Customers, Orders, Invoicing, Payments, Returns.
- **Status:** Not started.

### Epic 8 — Distribution

- **Objective:** connect production to the people who move goods to market.
- **Includes:** Sales Representatives, Distributors, Wholesalers, Retailers, Delivery
  Tracking, Route Planning.
- **Status:** Not started.

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

**Current focus:** Sprint 4.4 — not yet scoped.

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
