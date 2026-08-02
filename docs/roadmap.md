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

- [x] Product Catalogue — foundation shipped Sprint 4.1 (master product records; variants,
      pricing, and inventory/production integration remain) — see
      [`docs/domains/catalogue.md`](domains/catalogue.md)
- [x] Supplier Management — foundation shipped Sprint 4.2 (master vendor records; Purchase
      Orders and Product–Supplier relationships arrive with Procurement) — see
      [`docs/domains/suppliers.md`](domains/suppliers.md)
- [x] Procurement — Purchase Order management shipped Sprint 4.3 (create/edit/cancel,
      automatic totals, Draft/Pending/Cancelled lifecycle; Goods Receiving, approval
      workflow, and invoicing remain) — see
      [`docs/domains/procurement.md`](domains/procurement.md)
- [ ] Inventory
- [ ] Production
- [ ] Sales
- [ ] Distribution
- [ ] Finance

## Phase 3 — Extended Experiences

- [ ] Retail Portal (mobile)
- [ ] Sales Rep mobile workflows
- [ ] Business Intelligence dashboards

## Future

- HR, CRM Automation, Consumer Portal, Loyalty, Promotions, AI Services, Analytics, Marketplace.
