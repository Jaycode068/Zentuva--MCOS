# ADR-001: Use PostgreSQL as the primary database

- **Status:** Accepted
- **Date:** 2026-07-28

## Context

Zentuva needs a primary transactional datastore for manufacturing and commerce data: purchase
orders, production batches, inventory movements, sales orders, and eventually financial records.
This data is inherently relational (orders reference products reference suppliers reference
tenants) and requires strong consistency guarantees.

## Decision

Use **PostgreSQL** as the single primary database, accessed through **Prisma ORM**.

## Rationale

- Strong relational integrity (foreign keys, transactions) fits manufacturing/commerce data
  better than a document store.
- Mature JSON support (`jsonb`) covers semi-structured needs (e.g. flexible configuration,
  future AI-derived metadata) without requiring a second database.
- Wide hosting availability, including African/DigitalOcean-friendly managed offerings.
- Prisma has first-class PostgreSQL support and generates type-safe clients that fit the
  TypeScript-everywhere stack.

## Consequences

- All domain modules share one PostgreSQL instance in the MVP (see
  [ADR-003](ADR-003-multi-tenancy.md) for how tenancy is modeled within it).
- Schema migrations are managed centrally via Prisma Migrate in `apps/api/prisma/schema.prisma`.
