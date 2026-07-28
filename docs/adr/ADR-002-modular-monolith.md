# ADR-002: Use a Modular Monolith architecture

- **Status:** Accepted
- **Date:** 2026-07-28

## Context

Zentuva will eventually span many business domains (Identity, Organisation, Product Catalogue,
Procurement, Inventory, Production, Sales, Distribution, Finance, and future domains like CRM,
Loyalty, and Marketplace). A microservices architecture is a common choice for systems at this
scope, but it brings significant operational overhead (service discovery, distributed
transactions, network reliability, multiple deployments) that is not justified at MVP stage with
a single pilot tenant.

## Decision

Build Zentuva as a **Modular Monolith**: a single deployable NestJS application (`apps/api`)
composed of independently organised domain modules with enforced internal boundaries, and a
single deployable Next.js frontend (`apps/web`).

## Rationale

- Faster development — no cross-service network calls or deployment coordination during MVP.
- Easier maintenance and testing — one codebase, one process, one set of logs to reason about.
- Lower operational complexity — one deployable backend, one database connection pool.
- Domain Ownership (Handbook Principle 3) is enforced at the module boundary in code, not by a
  network boundary, so it still gives most of the architectural benefit of microservices with
  much less operational cost.
- Keeps the door open to extracting a domain into its own service later if it needs independent
  scaling, without a rewrite — module boundaries are designed as if they could become service
  boundaries.

## Consequences

- Domain modules must not import each other's internal services/repositories directly; they
  communicate through well-defined interfaces or domain events.
- All domain modules currently share one PostgreSQL database (see
  [ADR-001](ADR-001-postgresql.md)) and one deployment unit.
- Microservice extraction is explicitly deferred and not part of the MVP (Handbook Principle 9).
