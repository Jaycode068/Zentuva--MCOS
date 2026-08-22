# Customer Domain

- **Status:** Foundation implemented — Sprint 4.8 ("Customer, Territory, Outlet, Retail
  Network & Sales Foundation").
- **Sprint:** 4.8
- **Depends on:** [Identity](identity.md) (tenant boundary, `RolesGuard`),
  [Territories](territories.md) (optional).
- **See also:** [Retail Network](retail-network.md) (the keystone doc — read this first
  for the "why"), [Outlets](outlets.md), [Sales](sales.md),
  [Sprint 4.8 Completion Report](../sprint-4.8-completion-report.md).

## 1. Business Purpose

`Customer` is the commercial account — who the organisation bills and sells to. It exists
so a field sales agent can register any market participant — distributor, wholesaler,
retailer, supermarket, corporate account, restaurant, hotel, or anything else — in under
two minutes, with no prerequisite beyond a name, a type, and a phone number. See
[retail-network.md](retail-network.md) for the architectural principle this domain
exists to serve.

## 2. Key Concepts / Entities

### Customer

- **Responsibility:** the commercial account. Distinct from `Outlet` ([outlets.md](outlets.md))
  — the physical place of business — a customer may have zero, one, or many outlets.
- **Ownership:** owned by `apps/api/src/retail/customer/`.
- **Tenant scoping:** every `Customer` belongs to exactly one `Organisation`
  (`onDelete: Cascade`), same convention as every domain since Identity.
- **Lifecycle:** `ACTIVE`/`INACTIVE` only — never physically deleted.

**Fields:**

| Field                                                                 | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Customer Code (`customerCode`)                                        | Auto-generated (`CUS-000001`, ...), globally unique, immutable.                                                                                                                                                                                                                                                                                                                                                                                   |
| Customer Type (`customerType`)                                        | `DISTRIBUTOR`/`WHOLESALER`/`RETAILER`/`SUPERMARKET`/`CORPORATE`/`INSTITUTION`/`RESTAURANT`/`HOTEL`/`OTHER`. **Purely descriptive market intelligence — never a sales restriction.** No code path anywhere checks `customerType` to decide whether an order may be placed; a Distributor, Wholesaler, Retailer, and Supermarket are all equally free to buy direct. Not modelled as mutually-exclusive-forever — correctable any time via `PATCH`. |
| Customer Name (`customerName`)                                        | Required. The formal business name for a registered company, or simply a trader's/shop's name for an informal retailer ("Alhaji Musa Provision Store") — one free-text field deliberately, since the model must not assume every customer is a formal company.                                                                                                                                                                                    |
| Primary Phone (`phoneNumber`)                                         | Required — the one contact detail a field agent can always obtain, even from a market stall with no address or registration number.                                                                                                                                                                                                                                                                                                               |
| Contact Person, Alternate Phone, Email, Address, City, State, Country | All optional.                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Territory (`territoryId`)                                             | Optional, nullable, changeable any time. Never required to register a customer or place an order — see [territories.md](territories.md).                                                                                                                                                                                                                                                                                                          |
| Status (`status`)                                                     | `ACTIVE`/`INACTIVE`.                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Notes                                                                 | Optional free text.                                                                                                                                                                                                                                                                                                                                                                                                                               |

**Deliberately absent:** `distributorId`/`parentCustomerId` or any other column encoding
distribution structure directly on this row. That structure lives entirely in
`DistributionNetworkRelationship` — see [retail-network.md](retail-network.md) §2.

## 3. Progressive Onboarding

Only `customerType`, `customerName`, and `phoneNumber` are required by
`createCustomerSchema` (`packages/validation/src/retail.ts`) — every other field is
optional and addable later via `PATCH`. This three-field minimum is the exact enforcement
point for the "onboard a customer in roughly 1–2 minutes" requirement. The Field Sales
"New Customer" screen (`apps/web/src/app/(field)/field/customers/new/page.tsx`) shows
only these three fields above the fold; everything else — including Territory — sits
behind a collapsed "Add more details (optional)" disclosure. No distribution
relationship, no outlet mapping, no photograph, and no GPS coordinate is ever required to
register a customer.

## 4. Workflows

- **Onboard a Customer** — `POST /api/retail/customers` (Owner/Administrator only).
  Always starts `ACTIVE`.
- **Edit a Customer** — `PATCH /api/retail/customers/:id`. `customerCode` is never
  accepted (immutable).
- **Activate/Deactivate** — `POST /:id/activate`, `POST /:id/deactivate`.
- **Browse/Search** — `GET /api/retail/customers` (any authenticated user, Member
  included), filters: `?status=&customerType=&territoryId=&search=` (name/code/phone).
- **Field Sales**: Home → search bar → Customers list (card-based, search-first) →
  Customer detail (profile, Outlets, Recent Orders, Call/Add Outlet/New Order actions).
- **Admin**: `settings/retail` Customers tab — table on desktop, card list on mobile
  widths, filters for type/status.

## 5. RBAC

Reuses `RolesGuard` exactly as every other domain: `GET` is authentication-only (Member
read-only); every write requires `Owner` or `Administrator`.

**Known limitation, deliberate:** the brief's Field Sales UX assumes a "Sales Agent" can
register customers/outlets/orders from their phone. There is no dedicated Sales Agent
role in this codebase yet — introducing one would mean touching Identity's role
registration, the seed script's role block, and the User Management role picker, which is
out of scope for this sprint (the brief itself says: reuse `RolesGuard` as-is, no
permission engine). **Every Sprint 4.8 write endpoint requires `Owner` or
`Administrator`** — a "Sales Agent" today is a tenant-assigned Administrator account.
`Member` has read-only access everywhere, same as every other domain. See
[retail-network.md](retail-network.md) §7 for the documented future module-level access
architecture this decision is a placeholder for.

## 6. Tenant Isolation

Every repository method takes `organisationId` and includes it in the query; a
cross-tenant `id` 404s exactly like a nonexistent one. Verified live: registering a
second tenant and attempting to read another organisation's customer by id returns `404`,
never a data leak.

## 7. Audit Events

`customer.created`, `customer.updated`, `customer.activated`, `customer.deactivated`.

## 8. API Reference

| Endpoint                                    | Auth                | Notes                                         |
| ------------------------------------------- | ------------------- | --------------------------------------------- |
| `GET /api/retail/customers`                 | Any authenticated   | `?status=&customerType=&territoryId=&search=` |
| `GET /api/retail/customers/:id`             | Any authenticated   |                                               |
| `POST /api/retail/customers`                | Owner/Administrator | Only type/name/phone required                 |
| `PATCH /api/retail/customers/:id`           | Owner/Administrator | `customerCode`/`status` never accepted        |
| `POST /api/retail/customers/:id/activate`   | Owner/Administrator |                                               |
| `POST /api/retail/customers/:id/deactivate` | Owner/Administrator |                                               |

## 9. Known Limitations

- No dedicated Sales Agent role — see §5.
- No customer merge/deduplication tooling.
- No purchase-history-based segmentation (e.g. "customers who haven't ordered
  recently") — the relational structure supports building this later; no query exists
  yet.
- Codes are globally unique across the shared database, not per-tenant — same convention
  as every other auto-numbered entity in this codebase.
