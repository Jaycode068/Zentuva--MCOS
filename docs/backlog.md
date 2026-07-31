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
  locking), and audit logging. RBAC evaluation and user/role-management APIs are not yet
  built.
- **Status:** Completed — Sprints 1A, 1A.1, 1B.1, 1B.2.

### Epic 2 — Organisation Management

- **Objective:** let an organisation manage itself — its profile, its people, and who can
  do what.
- **Includes:** Organisation Profile, Tenant Settings, Branding, User Management,
  Invitations, Roles, Permissions, Audit.
- **Status:** In progress — Organisation Profile (view/update) shipped in Sprint 2.1.
  User Management, Invitations, Roles, Permissions, and Branding (logo upload) remain.

### Epic 3 — Product Catalogue

- **Objective:** model what an organisation manufactures and sells.
- **Includes:** Categories, Products, Variants, Packaging, Pricing, Units, Product Images.
- **Status:** Not started.

### Epic 4 — Procurement

- **Objective:** manage sourcing raw materials and goods from suppliers.
- **Includes:** Suppliers, Purchase Orders, Goods Received, Supplier Performance.
- **Status:** Not started.

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

## 5. Current Sprint Status

**Completed:**

- ✓ Sprint 0 — Engineering Foundation
- ✓ Sprint 1A — Identity Domain Design
- ✓ Sprint 1A.1 — Identity Domain Design Refinements
- ✓ Sprint 1B.1 — Identity Domain Implementation (Database & Domain Layer)
- ✓ Sprint 1B.2 — Identity Domain Implementation (Authentication Layer)
- ✓ Sprint 2.1 — Organisation Management (Organisation Profile)

**Current focus:** Epic 2 — Organisation Management, continued (User & Invitation
Management next, per Sprint 2.2).

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
