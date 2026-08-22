# Domain Documentation

This directory holds one document per business domain, describing its business purpose,
workflows, key entities, and how it integrates with other domains.

## Status

| Domain                              | Status                                                                                                                            |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| [Identity](identity.md)             | Designed (1A/1A.1); database & domain layer (1B.1) and authentication layer (1B.2) implemented — no RBAC/user-management APIs yet |
| Organisation                        | Folded into [Identity](identity.md) — see its "What is an Organisation?" business rule                                            |
| [Product Catalogue](catalogue.md)   | Foundation implemented — Sprint 4.1, extended with a Family/Variant hierarchy — Sprint 4.7                                        |
| [Supplier Management](suppliers.md) | Foundation implemented — Sprint 4.2                                                                                               |
| [Procurement](procurement.md)       | Purchase Order management implemented — Sprint 4.3                                                                                |
| [Inventory](inventory.md)           | Goods Receiving implemented — Sprint 4.4, refined 4.4.1, extended with locations & stock adjustments — Sprint 4.5                 |
| [Production](production.md)         | Manufacturing foundation implemented — Sprint 4.6 (BOM, Production Orders, Material Issue, Production Execution)                  |
| Sales, Distribution, Finance        | Not started                                                                                                                       |

As each domain is designed/built, add a `<domain>.md` here covering:

- **Business purpose** — why this domain exists, what problem it solves for Boby Bites (and future
  tenants).
- **Key concepts/entities** — the core objects the domain manages.
- **Workflows** — the primary user/system flows.
- **Configuration** — what is tenant-configurable vs. fixed.
- **Integration points** — which other domains it talks to, and how (interfaces/events).

[`identity.md`](identity.md) is the current reference example of this structure at full depth
(entity design, Prisma schema, API contracts, sequence diagrams).

Planned Version 1 domains: Identity, Product Catalogue, Supplier Management, Procurement,
Inventory, Production, Sales, Distribution, Finance.
