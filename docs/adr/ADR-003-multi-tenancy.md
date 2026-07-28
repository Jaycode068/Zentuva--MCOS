# ADR-003: Multi-tenancy uses a Shared Database

- **Status:** Accepted
- **Date:** 2026-07-28

## Context

Boby Bites is the first tenant, but Zentuva is explicitly designed as a multi-tenant SaaS
(Handbook Principle 2 — Configuration Over Customisation: "Boby Bites is the first tenant, not
the only tenant"). A tenancy model needs to be chosen before domain modules are built on top of
it, so every future model is tenant-aware from the start rather than retrofitted.

Common options: database-per-tenant, schema-per-tenant, or shared-database with a tenant
discriminator column.

## Decision

Use a **shared database, shared schema** model: every tenant-scoped table carries a `tenantId`
column, and application-level query scoping (not separate databases or schemas) enforces tenant
isolation.

## Rationale

- Lowest operational overhead at MVP stage — one database to provision, migrate, back up, and
  monitor, regardless of tenant count.
- Simplest to develop and test against locally (matches [ADR-001](ADR-001-postgresql.md) and
  [ADR-002](ADR-002-modular-monolith.md) — one Postgres instance, one deployable API).
- Cross-tenant analytics/intelligence (Handbook Principle 4 — every transaction generates
  intelligence) is far simpler when data lives in one schema.
- Migrating a specific large or sensitive tenant to a dedicated database later remains possible
  without a full architecture change, if that becomes necessary.

## Consequences

- Every tenant-scoped Prisma model must include a `tenantId` field once domain modules are built;
  this is not yet enforced because no domain models exist in this foundation.
- All queries in domain services must be scoped by tenant — there is no database-level isolation
  to fall back on, so this must be enforced in application code (e.g. a shared query-scoping
  helper) once the Identity/Organisation domain introduces tenants.
- The foundational `TenantContext` type (`packages/types/src/tenant.ts`) exists now so this
  contract is available to every future domain module, but no authentication, tenant resolution,
  or scoping logic has been implemented yet — that is explicitly out of scope for this foundation.
