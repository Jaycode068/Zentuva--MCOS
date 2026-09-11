# Zentuva

**Zentuva** is a cloud-native **Manufacturing & Commerce Operating System (MCOS)** built for African
businesses. It connects every participant in the manufacturing and commerce value chain —
suppliers, factories, sales teams, distributors, retailers, and eventually consumers — into a
single intelligent platform.

The first tenant is **Boby Bites**, the pilot implementation that validates the platform. Every
feature is built configurably so it can be reused by future tenants without code changes.

> This repository has grown well past the initial engineering foundation. Identity, Product
> Catalogue, Supplier Management, Procurement, Inventory, Production, Customers, Outlets,
> Territories, Retail Network, Sales, and Distribution all have implemented foundations, wired end
> -to-end to a real double-entry Accounting engine (Chart of Accounts, Journal Entries, General
> Ledger) and a Finance domain covering Invoices/Payments/Credit Notes/Accounts Receivable,
> Accounts Payable/Supplier Invoices, read-only Financial Statements & Management Reporting, Cash
> & Bank Management / Reconciliation, a forward-looking Cashflow Management & Forecasting layer
> that is never persisted and never posts a journal entry, a Budgeting & Financial Planning layer
> where a `Budget` holds only planned amounts and is compared live against the Ledger and the
> Cashflow Forecast, a Capital & Debt Management foundation where a `CapitalRequirement` →
> `DebtFacility` → `DebtDrawdown`/`DebtRepayment` chain posts through the same General Ledger
> boundary and feeds the existing Cashflow Forecast as financing outflows, and — most recently —
> an Investment / Capital Project Management foundation where a `CapitalProject` tracks a
> project's own cost plan, funding mix, and Committed/Actual spend (derived from Procurement/AP,
> never re-entered), never a second accounting system or a duplicated forecast engine, and — the
> capstone, closing sprint of the Finance MVP — a Financial Decision & Scenario Analysis layer
> that composes all of the above into ROI/NPV/IRR/Payback/Sensitivity/Funding Comparison and a
> Management Financial Decision Cockpit, computed live from stored assumptions and never a second
> accounting/forecast/amortisation engine; scenario analysis is 100% side-effect-free. The Finance
> MVP, as scoped, is now considered functionally complete. Then, an Asset Register &
> Asset Management foundation opened a new top-level domain — not a Product, not an
> `InventoryStock` row, not a Purchase Order — for the durable physical resources the business
> owns: tenant-scoped hierarchical Asset Categories, a central `Asset` entity with lifecycle kept
> strictly separate from physical condition, a self-referencing asset hierarchy, a purpose-built
> Asset Location, immutable movement history, and optional read-only links to Supplier/Purchase
> Order/Capital Project — zero accounting integration, by construction. Next, a
> Maintenance Management foundation was built on top of that Asset Register — requests, reusable
> plans, date-/meter-based preventive schedules (idempotent by construction — repeat generation
> never creates a duplicate work order), work orders with a mobile-first technician workflow,
> tasks, downtime, parts usage, and operational cost capture — every asset-status interaction
> (`IN_SERVICE ⇄ UNDER_MAINTENANCE`) driven through the Asset domain's own lifecycle service, and,
> again, zero accounting or inventory-mutation side effects, by construction. Most recently, a
> Maintenance Ecosystem Integration sprint connected that zero-integration foundation to the rest
> of the business — real Inventory part-issuing (one deliberate, structurally-proven exception to
> the domain's own no-cross-domain-writes rule), a Procurement linking boundary, Budget
> cost-vs-budget comparison, and a Maintenance Analytics page — plus the Asset Register detail
> page's extended Maintenance section and a new mobile-first Field Technician surface built on the
> existing `assignedToId` convention, with no new RBAC role and zero accounting postings. See
> [docs/domains/README.md](docs/domains/README.md) for the current status of every domain and
> [docs/roadmap.md](docs/roadmap.md) for the full build order.

## Repository Structure

A Turborepo monorepo. See [docs/handbook/folder-structure.md](docs/handbook/folder-structure.md)
for the full breakdown.

```
apps/
  web/          Next.js frontend (desktop + mobile experiences)
  api/          NestJS backend (modular monolith)
packages/
  ui/           Shared shadcn/ui-based React component library
  types/        Shared TypeScript types
  config/       Shared ESLint, TypeScript, and Tailwind configuration
  utils/        Shared framework-agnostic utilities
  validation/   Shared Zod validation schemas
docs/           Handbook, local dev guide, domain docs, ADRs, API/database docs, changelog, roadmap
```

## Getting Started

```bash
pnpm install
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
pnpm infra:up    # Postgres + Redis in Docker
pnpm db:generate && pnpm db:migrate
pnpm dev         # apps/web + apps/api on the host, with hot reload
```

Docker is used for infrastructure only (Postgres + Redis) — the apps themselves always run
directly on the host for fast hot reload. See
[docs/handbook/getting-started.md](docs/handbook/getting-started.md) for the quick-start, or the
[Local Development Guide](docs/development/local-development.md) for the full guide (migrations,
Prisma Studio, VS Code debugging, troubleshooting).

## Documentation

- [Engineering Handbook](docs/handbook/engineering-handbook.md)
- [Architecture Overview](docs/handbook/architecture-overview.md)
- [Development Workflow](docs/handbook/development-workflow.md)
- [Local Development Guide](docs/development/local-development.md)
- [Folder Structure](docs/handbook/folder-structure.md)
- [Architecture Decision Records](docs/adr/)
- [Changelog](docs/changelog.md)
- [Roadmap](docs/roadmap.md)
- [Domain Docs](docs/domains/) — start with [Identity](docs/domains/identity.md)
- [Sprint 0 Completion Report](docs/sprint-0-completion-report.md)
- [Sprint 1A Identity Design Report](docs/sprint-1A-identity-design-report.md)
- [Sprint 1B.1 Completion Report](docs/sprint-1B.1-completion-report.md)
- [Sprint 1B.2 Completion Report](docs/sprint-1B.2-completion-report.md)

## License

Proprietary — all rights reserved.
