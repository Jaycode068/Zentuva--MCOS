# Territory Domain

- **Status:** Foundation implemented — Sprint 4.8 ("Customer, Territory, Outlet, Retail
  Network & Sales Foundation").
- **Sprint:** 4.8
- **Depends on:** [Identity](identity.md) (tenant boundary, `RolesGuard`).
- **See also:** [Customers](customers.md), [Outlets](outlets.md),
  [Retail Network](retail-network.md), [Sprint 4.8 Completion Report](../sprint-4.8-completion-report.md).

## 1. Business Purpose

A manufacturer needs to define operational territories the way _its own_ sales and
distribution organisation actually works — not the way a country's administrative map
happens to be drawn. Boby Bites might define `Oyo State → Ibadan → Ibadan North →
Bodija`; a different tenant might define `Lagos → Mainland → Yaba → Alagomeji`, with
completely different level names and depth. `Territory` is a **self-referential,
tenant-defined hierarchy of arbitrary depth**, not a fixed administrative-boundary table.

## 2. Key Concepts / Entities

### Territory

- **Ownership:** owned by `apps/api/src/retail/territory/` — the base of the retail
  domain's dependency chain (`Territory ← Customer ← Outlet`).
- **Tenant scoping:** every `Territory` belongs to exactly one `Organisation`.

**Fields:**

| Field                            | Notes                                                                                                                                                                                         |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Territory Code (`territoryCode`) | Auto-generated (`TER-000001`, ...), globally unique, immutable.                                                                                                                               |
| Name                             | Required, e.g. "Ibadan North".                                                                                                                                                                |
| Type (`type`)                    | **Free text**, e.g. "State"/"City"/"LGA"/"Area" — deliberately not an enum, same convention as `Product.unit`: a tenant defines its own level names, this codebase never assumes a fixed set. |
| Parent (`parentTerritoryId`)     | Nullable, self-referential. `null` = a top-level (root) territory.                                                                                                                            |
| Status (`status`)                | `ACTIVE`/`INACTIVE`.                                                                                                                                                                          |
| Description                      | Optional free text.                                                                                                                                                                           |

### Hierarchy and cycle prevention

A self-referential foreign key cannot declaratively express "no cycles" — the database
happily allows A→B→C→A. `TerritoryService.assertNoCycle` walks `parentTerritoryId`
upward from the _proposed_ new parent (capped at 50 hops as a safety valve, not a real
depth limit) and rejects the update if it ever reaches the territory being edited —
i.e. rejects re-parenting a territory to one of its own descendants, and rejects a
territory becoming its own parent. This runs only on `PATCH` (re-parenting); `POST`
simply validates the supplied `parentTerritoryId`, if any, exists and belongs to the
caller's own organisation.

Re-parenting is deliberately allowed on `PATCH` (unlike, say, `ProductVariant`'s
immutable family) — restructuring a territory tree as an organisation's own understanding
of its sales geography evolves is a legitimate, expected operation.

## 3. Territory Assignment

`Customer.territoryId` and `Outlet.territoryId` are both optional, nullable, and
changeable at any time. Territory is **never** required to register a customer, add an
outlet, or place an order — see [customers.md](customers.md) §"Progressive Onboarding"
and [retail-network.md](retail-network.md) §1. The eventual goal (not built this sprint)
is sales-agent territory ownership/coverage; today, territory assignment is purely
descriptive.

## 4. Workflows

- **Create a Territory** — `POST /api/retail/territories` (Owner/Administrator only).
  Always starts `ACTIVE`. Optional `parentTerritoryId`.
- **Edit / Re-parent** — `PATCH /api/retail/territories/:id`. Cycle-guarded as above.
- **Activate/Deactivate** — `POST /:id/activate`, `POST /:id/deactivate`.
- **Browse** — `GET /api/retail/territories?status=&parentTerritoryId=&search=` (any
  authenticated user). **No `/tree` endpoint** — the list returns every territory flat,
  with each row's own `parentTerritoryId`; both the Admin hierarchy view and the Field
  picker assemble the tree client-side. A tenant has tens of territories, not thousands
  — a recursive-CTE endpoint would be unjustified complexity with no precedent elsewhere
  in this codebase.
- **Admin**: `settings/retail` Territories tab renders an indented tree (client-computed
  depth via walking `parentTerritoryId`) with inline Activate/Deactivate actions and a
  status filter. **No map, no polygons, no GIS** — the hierarchy and data model are the
  foundation; a future sprint may add map visualisation, geofencing, or route
  optimisation on top of this same relational structure.

## 5. RBAC / Tenant Isolation / Audit

Same conventions as [customers.md](customers.md). Audit events: `territory.created`,
`territory.updated`, `territory.activated`, `territory.deactivated`.

## 6. API Reference

| Endpoint                                      | Auth                | Notes                                 |
| --------------------------------------------- | ------------------- | ------------------------------------- |
| `GET /api/retail/territories`                 | Any authenticated   | `?status=&parentTerritoryId=&search=` |
| `GET /api/retail/territories/:id`             | Any authenticated   |                                       |
| `POST /api/retail/territories`                | Owner/Administrator |                                       |
| `PATCH /api/retail/territories/:id`           | Owner/Administrator | Cycle-guarded re-parenting            |
| `POST /api/retail/territories/:id/activate`   | Owner/Administrator |                                       |
| `POST /api/retail/territories/:id/deactivate` | Owner/Administrator |                                       |

## 7. Known Limitations

- No GIS, polygons, geofencing, route planning, or map visualisation of any kind.
- No `/tree` endpoint — hierarchy assembly is client-side over the flat list.
- No territory-level sales-agent ownership/coverage assignment yet — territory
  assignment on `Customer`/`Outlet` is descriptive only.
- No bulk import of an administrative boundary dataset — territories are created one at
  a time (or seeded).
