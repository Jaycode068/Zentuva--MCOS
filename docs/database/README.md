# Database Documentation

Documents the Prisma schema (`apps/api/prisma/schema.prisma`) and every model, grouped by domain.

## Current state

No business models exist yet — this foundation deliberately excludes business modules.

The schema currently declares:

- `postgresql` datasource + `prisma-client-js` generator.
- `HealthCheck` (maps to `_health_check`) — a **technical-only** model, not a business entity.
  Prisma requires at least one model to generate a client; this one exists solely so
  `PrismaService` can connect and `GET /api/health` can verify DB connectivity. Remove it once the
  first real domain model (e.g. from the Identity domain) is added.

## Conventions for when models are added

- Every tenant-scoped model must include a `tenantId` field (see
  [ADR-003](../adr/ADR-003-multi-tenancy.md)).
- Document each new model here: its purpose, fields, relations, and indexes.
- Record schema migrations in [`docs/changelog.md`](../changelog.md) when they are user-facing or
  significant.
