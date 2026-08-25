# Domain Documentation

This directory holds one document per business domain, describing its business purpose,
workflows, key entities, and how it integrates with other domains.

## Status

| Domain                              | Status                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Identity](identity.md)             | Designed (1A/1A.1); database & domain layer (1B.1) and authentication layer (1B.2) implemented — no RBAC/user-management APIs yet                                                                                                                                                                                                                                      |
| Organisation                        | Folded into [Identity](identity.md) — see its "What is an Organisation?" business rule                                                                                                                                                                                                                                                                                 |
| [Product Catalogue](catalogue.md)   | Foundation implemented — Sprint 4.1, extended with a Family/Variant hierarchy — Sprint 4.7                                                                                                                                                                                                                                                                             |
| [Supplier Management](suppliers.md) | Foundation implemented — Sprint 4.2                                                                                                                                                                                                                                                                                                                                    |
| [Procurement](procurement.md)       | Purchase Order management implemented — Sprint 4.3                                                                                                                                                                                                                                                                                                                     |
| [Inventory](inventory.md)           | Goods Receiving implemented — Sprint 4.4, refined 4.4.1, extended with locations & stock adjustments — Sprint 4.5; Goods Receipt now posts automatically to the General Ledger — Sprint 8                                                                                                                                                                              |
| [Production](production.md)         | Manufacturing foundation implemented — Sprint 4.6 (BOM, Production Orders, Material Issue, Production Execution)                                                                                                                                                                                                                                                       |
| [Customers](customers.md)           | Foundation implemented — Sprint 4.8                                                                                                                                                                                                                                                                                                                                    |
| [Outlets](outlets.md)               | Foundation implemented — Sprint 4.8                                                                                                                                                                                                                                                                                                                                    |
| [Territories](territories.md)       | Foundation implemented — Sprint 4.8                                                                                                                                                                                                                                                                                                                                    |
| [Retail Network](retail-network.md) | Foundation implemented — Sprint 4.8 (distribution network relationships, kept structurally separate from Sales)                                                                                                                                                                                                                                                        |
| [Sales](sales.md)                   | Foundation implemented — Sprint 4.8 (Sales Orders; a mobile-first Field Sales workspace + Admin surface share this backend); Fulfilment added — Sprint 4.9 (atomic, audited inventory deduction; DRAFT→CONFIRMED→PARTIALLY_FULFILLED→FULFILLED)                                                                                                                        |
| [Distribution](distribution.md)     | Foundation implemented — Sprint 5 (Dispatch + Delivery, chained off Sales Fulfilment; inventory deducted exactly once, never again at dispatch or delivery)                                                                                                                                                                                                            |
| [Finance](finance.md)               | Foundation implemented — Sprint 6 (Invoices, Payments with partial-payment support, Credit Notes, Accounts Receivable); Sprint 7 wired automatic General Ledger posting — see [Accounting](accounting.md)                                                                                                                                                              |
| [Accounting](accounting.md)         | Foundation implemented — Sprint 7 (Chart of Accounts, Accounting Periods, double-entry Journal Entries, General Ledger/Trial Balance/Account Activity); Sprint 8 wired Inventory's Goods Receipt (DR Inventory / CR Accounts Payable, with an accepted-vs-payable split into a GRNI Pending Approval account) — not a complete accounting system, see accounting.md §9 |

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
Inventory, Production, Customers, Outlets, Territories, Retail Network, Sales,
Distribution, Finance, Accounting.
