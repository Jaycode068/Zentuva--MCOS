# Domain Documentation

This directory holds one document per business domain, describing its business purpose,
workflows, key entities, and how it integrates with other domains.

No domain has been implemented yet — this foundation deliberately excludes business modules. As
each domain is built (starting with Identity/Organisation), add a `<domain>.md` here covering:

- **Business purpose** — why this domain exists, what problem it solves for Boby Bites (and future
  tenants).
- **Key concepts/entities** — the core objects the domain manages.
- **Workflows** — the primary user/system flows.
- **Configuration** — what is tenant-configurable vs. fixed.
- **Integration points** — which other domains it talks to, and how (interfaces/events).

Planned Version 1 domains: Identity, Organisation, Product Catalogue, Procurement, Inventory,
Production, Sales, Distribution, Finance.
