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
- [ ] RBAC evaluation + permission guards
- [ ] Role/organisation/user-management API surface
- [ ] Tenant resolution middleware (Prisma Client Extension, identity.md §7)

## Phase 2 — Core Manufacturing & Commerce Domains

- [ ] Product Catalogue
- [ ] Procurement
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
