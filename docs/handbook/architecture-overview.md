# Architecture Overview

## Architecture style

Zentuva uses a **Modular Monolith**: a single deployable backend (`apps/api`) organised into
domain modules with strict internal boundaries, plus a single frontend (`apps/web`) that renders
role-based experiences. See [ADR-002](../adr/ADR-002-modular-monolith.md) for the rationale.

Microservices are explicitly **not** part of the MVP (Principle 9 — Build for Growth, Release for
Today).

## Multi-tenancy

Zentuva is designed as a configurable multi-tenant SaaS from day one, even though Boby Bites is
currently the only tenant. Tenancy uses a **shared database with a tenant discriminator** model.
See [ADR-003](../adr/ADR-003-multi-tenancy.md). The foundational `TenantContext` type lives in
[`packages/types/src/tenant.ts`](../../packages/types/src/tenant.ts); no tenant-scoping business
logic has been implemented yet.

## Repository layout

Turborepo monorepo managed with pnpm workspaces. See
[folder-structure.md](folder-structure.md) for the full tree.

## Technology stack

### Frontend (`apps/web`)

- Next.js (App Router)
- TypeScript
- Tailwind CSS + shadcn/ui (via `packages/ui`)
- TanStack Query for server state

### Backend (`apps/api`)

- NestJS (modular monolith)
- Prisma ORM
- PostgreSQL
- `@nestjs/terminus` for health checks
- Zod for runtime validation (via `packages/validation`)

### Cache & Queue

- Redis
- BullMQ (wired in as infrastructure; no queues/processors exist yet)

### Storage

- DigitalOcean Spaces (S3-compatible) — planned, not yet configured in this foundation.

### Deployment

- Docker + Docker Compose (`docker-compose.yml` for full-stack, `docker-compose.dev.yml` for
  infra-only local development)

## Shared packages

| Package               | Purpose                                                         |
| --------------------- | --------------------------------------------------------------- |
| `packages/ui`         | shadcn/ui-based React component library shared by all frontends |
| `packages/types`      | Shared TypeScript types (e.g. `ApiResponse`, `TenantContext`)   |
| `packages/config`     | Shared ESLint, TypeScript, and Tailwind configuration presets   |
| `packages/utils`      | Framework-agnostic utility functions (errors, strings, async)   |
| `packages/validation` | Shared Zod schemas (env validation, pagination)                 |

## AI-readiness

Per Principle 8, no AI capability is coupled into business modules. Future AI services will
integrate through a dedicated `packages/ai` (or `apps/ai`) boundary once business modules exist to
integrate with. Business logic must remain fully deterministic without AI.

## What is intentionally not built yet

This foundation deliberately excludes: authentication, user management, product catalogue, and
all business domain modules (Identity, Organisation, Procurement, Inventory, Production, Sales,
Distribution, Finance). See [roadmap.md](../roadmap.md).
