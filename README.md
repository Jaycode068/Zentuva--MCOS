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
> that is never persisted and never posts a journal entry, and — most recently — a Budgeting &
> Financial Planning layer where a `Budget` holds only planned amounts and is compared live
> against the Ledger and the Cashflow Forecast, never a second accounting system. See
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
