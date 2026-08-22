# Retail Network Domain

- **Status:** Foundation implemented — Sprint 4.8 ("Customer, Territory, Outlet, Retail
  Network & Sales Foundation").
- **Sprint:** 4.8
- **Depends on:** [Identity](identity.md) (tenant boundary, `RolesGuard`), [Customers](customers.md).
- **See also:** [Sprint 4.8 Completion Report](../sprint-4.8-completion-report.md),
  [Customers](customers.md), [Outlets](outlets.md), [Territories](territories.md),
  [Sales](sales.md) — this document is the keystone that explains how all four fit
  together and why.

## 1. The Core Principle

> **CAPTURE THE MARKET FIRST. STRUCTURE THE NETWORK PROGRESSIVELY. DO NOT FORCE THE
> MARKET INTO A DISTRIBUTION STRUCTURE THAT DOES NOT YET EXIST.**

Zentuva is being built as "the Operating System for African Manufacturing." Alongside
the manufacturing ERP (Catalogue → Procurement → Inventory → Production, Sprints
4.1–4.7), the platform's strategic differentiator is a **Retail Intelligence Network**: a
living digital map of the market around a manufacturer — retailers, distributors,
wholesalers, territories — built up progressively as a sales team actually discovers it
in the field, not pre-modelled in advance.

At launch, Boby Bites may want to sell to _everyone_: distributors, wholesalers,
supermarkets, small shops, kiosks, corporate customers, restaurants, hotels. A customer
must never be required to have a distributor, a mapped territory, or any distribution
relationship before it can be registered, onboarded, or place an order. This is not a
convenience — it is the sprint's central, non-negotiable architectural rule.

## 2. Two Separate Concepts, Deliberately Kept Apart

|                       | Commercial Transaction                                                                           | Distribution Network Relationship                                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Entity                | `SalesOrder` ([sales.md](sales.md))                                                              | `DistributionNetworkRelationship`                                                                                                    |
| Answers               | "What did this customer order, and when?"                                                        | "How does product move through the market after it leaves the manufacturer?"                                                         |
| Required to exist?    | No — any `Customer` can have one with zero network mapping                                       | No — a customer can go its entire lifetime with zero relationships                                                                   |
| Ever gates the other? | **Never.** No code path checks "does this customer have a distributor" before allowing an order. | **Never.** Adding, changing, or deactivating a relationship never rewrites, re-parents, or recalculates any historical `SalesOrder`. |

**Example, straight from the brief:** Boby Bites registers Retailer A and sells to it
directly — no distributor exists yet. Six months later, Distributor X becomes active and
starts supplying Retailer A; the two get connected with a `DistributionNetworkRelationship`.
The historical direct sales already recorded remain exactly as they were: **Boby Bites →
Retailer A**, never rewritten as **Boby Bites → Distributor X → Retailer A**.

### Why this is enforced structurally, not just by convention

`SalesModule` (`apps/api/src/sales/sales.module.ts`) **does not import**
`NetworkRelationshipModule` — and its docblock says exactly why. `SalesOrderService`
never injects `NetworkRelationshipRepository`. This means the code that _could_ check
"does this customer have a distributor" is not even reachable from the Sales domain — the
guarantee isn't just "nobody happened to write that check," it's "the dependency graph
makes that check impossible to write without a deliberate, visible new import." A
dedicated test file, `apps/api/src/sales/direct-sales-independence.spec.ts`, asserts this
both behaviourally (a customer of every `CustomerType`, with zero network relationships,
can place and confirm an order) and structurally (a source-check on `sales.module.ts`
itself, confirming the import never appears).

## 3. `DistributionNetworkRelationship`

`sourceCustomer --[relationshipType]--> targetCustomer` — a directed edge between two
`Customer` rows, describing how goods move through the market _after_ leaving the
manufacturer. `relationshipType` is one of `DISTRIBUTES_TO` / `WHOLESALES_TO` /
`SUPPLIES` / `OTHER`.

- **Always optional.** A `Customer` can exist, be edited, be sold to, indefinitely, with
  zero relationships in either direction.
- **`effectiveFrom`/`effectiveTo`, `status` (`ACTIVE`/`INACTIVE`)** preserve history rather
  than editing it away. Deactivating a relationship stamps `effectiveTo` (if unset) and
  flips `status` to `INACTIVE` — it is never deleted, so a lapsed relationship remains
  queryable.
- **Deliberately no `@@unique` constraint** on `(sourceCustomerId, targetCustomerId,
relationshipType)`. A real distribution relationship can lapse and be re-established
  later; a database uniqueness constraint would make that historical pattern impossible
  to represent. Instead, `NetworkRelationshipService.create` rejects a duplicate _active_
  triple (`findActiveDuplicate`), which is the only case that would actually be
  ambiguous.
- **Endpoints are immutable after creation.** `PATCH` only ever accepts
  `effectiveFrom`/`effectiveTo`/`notes` — never `sourceCustomerId`/`targetCustomerId`/
  `relationshipType`. Changing an endpoint would silently rewrite the network's history;
  the correct action is to deactivate the old relationship and create a new one.
- **Same-organisation enforcement** happens implicitly: both `sourceCustomerId` and
  `targetCustomerId` are resolved via `CustomerRepository.findById(organisationId, id)` —
  a cross-tenant id simply returns `null` and the request is rejected with `400`, the
  same tenant-isolation mechanism every other domain in this codebase uses.
- **A customer cannot supply itself** — `sourceCustomerId !== targetCustomerId` is
  checked before anything else.

## 4. API

`@Controller('retail/network-relationships')` — `GET` (list, optional
`?status=&customerId=&relationshipType=`; `customerId` matches either endpoint), `GET
/:id`, `POST` (Owner/Administrator), `PATCH /:id` (Owner/Administrator), `POST
/:id/deactivate` (Owner/Administrator). No `DELETE` — same "deactivate, never remove"
convention every other domain in this codebase follows.

## 5. Admin Network View

`apps/web/src/app/(app)/settings/retail/page.tsx`'s Network tab is a deliberately simple
relationship list — `Source Customer → relationshipType → Target Customer`, with a
status filter and a Deactivate action per row. Per the brief's own scope ("a simple
relationship list/tree is sufficient... do not build a sophisticated graph
visualisation"), this establishes the data model and basic visibility only. Field Sales
does not expose network-relationship management at all — creating/editing relationships
is an Admin-only capability (see [customers.md](customers.md) §RBAC for the reasoning).

## 6. Future Retail Intelligence Capabilities (Not Built This Sprint)

The relational structure this sprint establishes — `Territory` hierarchy, `Customer`
optionally tied to a `Territory`, `Outlet` tied to exactly one `Customer` and optionally
a `Territory`, `DistributionNetworkRelationship` linking customers, `SalesOrder`
optionally tied to an `Outlet` — is deliberately shaped so a _future_ reporting layer
could answer questions like:

- How many retailers have been discovered, and where?
- Which distributors/wholesalers operate in which territory?
- Which outlets have been visited, and what do they look like (via `OutletPhoto`)?
- Which retailers buy directly vs. through a mapped distributor?
- Which areas have weak distribution coverage?
- Which customers haven't purchased recently?

**None of this analytics/reporting engine exists yet.** This sprint builds only the
foundational data model and field workflows — no dashboards, no aggregation queries, no
map visualisation. See each domain's own "Known Limitations" section for the complete
list of what's deliberately deferred.

## 7. Future Module-Level Access Architecture (Design Only, No Code)

The final module-level access architecture has not been implemented. Sprint 4.8 reuses
the existing `RolesGuard` exactly as every other domain does — see
[customers.md](customers.md) §"RBAC" for the concrete, current rules and the reasoning
for not introducing a new "Sales Agent" role this sprint. The intended future shape,
documented here so it isn't lost and so today's domain model isn't contaminated by its
absence:

```
Authentication
  -> Organisation
    -> User
      -> Role / Capabilities
        -> Module Access
          -> Action Permissions
```

Eventually: a **Sales Agent** role scoped to the Field Sales workspace; a **Production
User** role scoped to Production; **Inventory User** to Inventory; **Procurement User**
to Procurement; **Finance User** to a future Finance module; **Manager** to future
Reports/Analytics; **MD/Executive** to a future Executive Dashboard. None of this exists
in code today — every write in every Sprint 4.8 domain is gated by the same
`@Roles('Owner', 'Administrator')` check every other domain uses, and every `GET` is
authentication-only.

## 8. Mobile-First Field Sales Architecture

See [sales.md](sales.md) §"Field Sales vs. Admin" for the full explanation of why the
Field Sales surface (`apps/web/src/app/(field)/`) is a completely separate route group
from the desktop Admin shell, rather than a responsive variant of it.
