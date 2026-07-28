# Zentuva

**Zentuva** is a cloud-native **Manufacturing & Commerce Operating System (MCOS)** built for African
businesses. It connects every participant in the manufacturing and commerce value chain —
suppliers, factories, sales teams, distributors, retailers, and eventually consumers — into a
single intelligent platform.

The first tenant is **Boby Bites**, the pilot implementation that validates the platform. Every
feature is built configurably so it can be reused by future tenants without code changes.

> This repository currently contains the **engineering foundation only**. No business modules
> (identity, catalogue, procurement, inventory, production, sales, distribution, finance) have
> been implemented yet. See [docs/roadmap.md](docs/roadmap.md).

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
docs/           Handbook, domain docs, ADRs, API/database docs, changelog, roadmap
```

## Getting Started

See [docs/handbook/getting-started.md](docs/handbook/getting-started.md).

## Documentation

- [Engineering Handbook](docs/handbook/engineering-handbook.md)
- [Architecture Overview](docs/handbook/architecture-overview.md)
- [Development Workflow](docs/handbook/development-workflow.md)
- [Folder Structure](docs/handbook/folder-structure.md)
- [Architecture Decision Records](docs/adr/)
- [Changelog](docs/changelog.md)
- [Roadmap](docs/roadmap.md)

## License

Proprietary — all rights reserved.
