# Supplier Management Domain

- **Status:** Foundation implemented — Sprint 4.2 ("Supplier Management").
- **Sprint:** 4.2
- **Depends on:** [Identity](identity.md) (tenant boundary, authentication, `RolesGuard`),
  [ADR-002 — Modular Monolith](../adr/ADR-002-modular-monolith.md),
  [ADR-003 — Multi-Tenancy](../adr/ADR-003-multi-tenancy.md)
- **See also:** [Sprint 4.2 Completion Report](../sprint-4.2-completion-report.md) for what
  was implemented and why.

## 1. Business Purpose

Supplier Management is the master data source for every vendor an Organisation buys goods
or services from. It answers one question — **"Who do we buy from?"** — and nothing more:
no Purchase Orders, Goods Receiving, Invoices, Vendor Payments, Procurement Workflows,
Contracts, Price Lists, or Product–Supplier relationships live here. This is deliberately
**not** Procurement (`docs/backlog.md` Epic 4) — it is the foundation Procurement, Inventory,
Finance, and Asset Register are all expected to reference once they're built, the same way
the Product Catalogue (Sprint 4.1) is the foundation for everything that references a
product.

Per the Sprint 4.2 brief, future Procurement (Sprint 4.3+) is expected to reference
`Supplier.id` rather than accepting a free-text supplier name on a Purchase Order.

## 2. Key Concepts / Entities

### Supplier

- **Responsibility:** a single vendor an Organisation purchases raw materials, packaging,
  logistics, maintenance, utilities, or other services/goods from.
- **Ownership:** owned by the Supplier Management domain (`apps/api/src/suppliers/`).
  Referenced by id from other domains once they exist; no other domain writes to the
  `suppliers` table directly (ADR-002 domain-ownership rule).
- **Identifiers:** `id` (internal cuid PK), `supplierCode` (see "Supplier Code" below).
- **Tenant scoping:** every `Supplier` belongs to exactly one `Organisation`
  (`organisationId`, `onDelete: Cascade`) — same tenant-isolation convention as every other
  domain (identity.md §7): every repository method that reads or writes a specific supplier
  takes `organisationId` and includes it in the query.
- **Lifecycle:** `ACTIVE` ⇄ `INACTIVE`, never physically deleted (see "Status" below).

**Fields:**

| Field                              | Notes                                                                                                                                               |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Supplier Code (`supplierCode`)     | Auto-generated (`SUP-000001`, `SUP-000002`, ...), globally unique, immutable — never accepted on create or update input. See "Supplier Code" below. |
| Supplier Name (`supplierName`)     | Required.                                                                                                                                           |
| Display Name (`displayName`)       | Optional PO-facing name, distinct from `supplierName` — same pattern as `Product.displayName`/`Organisation.displayName`.                           |
| Contact Person (`contactPerson`)   | Optional free text.                                                                                                                                 |
| Email (`email`)                    | Optional, validated as an email address when present.                                                                                               |
| Phone (`phoneNumber`)              | Optional free text (no format validation — international formats vary too much to constrain here).                                                  |
| Website (`website`)                | Optional, validated as a URL when present.                                                                                                          |
| Country / State / City / Address   | All optional free text.                                                                                                                             |
| Tax ID (`taxIdentificationNumber`) | Optional free text.                                                                                                                                 |
| Category (`supplierCategory`)      | Enum: Raw Material, Packaging, Logistics, Maintenance, Utility, Service, Other. Lets future Procurement filter suppliers by what they supply.       |
| Status (`status`)                  | Enum: Active, Inactive. See below.                                                                                                                  |
| Notes (`notes`)                    | Optional free text.                                                                                                                                 |
| Created/Updated By                 | `createdById`/`updatedById` — plain nullable string columns, no FK relation, same convention as `AuditLog.actorUserId`/`Product.createdById`.       |
| Created/Updated At                 | Standard `createdAt`/`updatedAt` timestamps, automatically maintained.                                                                              |

### Supplier Code

Format: `SUP-000001`, `SUP-000002`, ... (fixed `SUP` prefix + 6-digit zero-padded
sequence). Generated by `SupplierService`'s private code generator — a collision-avoidance
loop identical in shape to `ProductService.generateUniqueCode` (Sprint 4.1), globally
unique (checked via `SupplierRepository.existsByCode` with no `organisationId` filter, same
as `Product.code`). Requirements enforced: unique, immutable, never editable, always
generated automatically — `supplierCode` is absent from both `createSupplierSchema` and
`updateSupplierSchema` so it can never be supplied on input.

### Status

`ACTIVE` (default) ⇄ `INACTIVE`. Unlike Product's three-state Draft/Active/Archived
lifecycle, Supplier has only two states and no directional lifecycle — a supplier can be
deactivated and reactivated freely. **Suppliers are never physically deleted** (brief: "Do
not implement delete. Suppliers should instead become INACTIVE"), and there is no `DELETE`
endpoint on `SupplierController` at all. Unlike Product's dedicated `activate`/`archive`
endpoints, a Supplier's status is just another field on `PATCH /api/suppliers/:id` — the
brief lists "Status" directly as a Create/Edit dialog field rather than a separate action.
Inactive suppliers are intended to be excluded from future Purchase Orders once Procurement
is built (Sprint 4.3+, out of scope here — no enforcement of this exists yet since Purchase
Orders don't exist).

## 3. Workflows

- **Create** — `POST /api/suppliers` (Owner/Administrator only). Auto-generates
  `supplierCode`; `status` defaults to `ACTIVE` (the Prisma column default) unless the
  caller explicitly sets `INACTIVE`. Audited as `supplier.created`.
- **Edit** — `PATCH /api/suppliers/:id` (Owner/Administrator only). Partial update of any
  field except `supplierCode`. If the request changes `status`, the audit event is
  `supplier.activated`/`supplier.deactivated` instead of the generic `supplier.updated`
  (same "status event wins" convention as `UserController.resolveUpdateAuditAction`).
- **Browse** — `GET /api/suppliers` (any authenticated user, Member included — read-only).
  Accepts optional `?search=`, `?status=`, `?category=` query params; the frontend applies
  all three filters client-side over the already-fetched list (no pagination, matching the
  Product Catalogue's "small dataset, fetch in full" convention).
- **View one** — `GET /api/suppliers/:id` (any authenticated user).

## 4. Authorization

Reuses `RolesGuard` exactly as every other domain does (identity.md §6, Sprint 2.1):

| Role          | Access                           |
| ------------- | -------------------------------- |
| Owner         | Full access (create/edit/status) |
| Administrator | Full access (create/edit/status) |
| Member        | Read-only (`GET` endpoints only) |

No permission-key engine — same minimal role-name check every other write surface in this
codebase uses, per the brief's explicit "Reuse the existing RolesGuard. Do not build a
permission engine."

## 5. Configuration

- **Category** is a hardcoded enum (Prisma `SupplierCategory`) — not tenant-configurable in
  this sprint, same approach as Product's `ProductCategory`/`ProductType`.
- Every other field is free text with no format enforcement beyond `email`/`website`
  validation — an organisation can enter any contact/location detail it needs.

## 6. Integration Points

No other domain consumes `Supplier` yet. `Supplier.id` is the intended integration point
for Procurement (Sprint 4.3+ — Purchase Orders reference a supplier instead of a free-text
name), and later Inventory/Finance/Asset Register as they're built. `AuditService` is reused
exactly as every other domain's write surface already does (`docs/domains/identity.md` §8).

## 7. API Reference

| Endpoint                   | Auth                                           | Input                                                                                                                                                                            | Output                                                              |
| -------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `GET /api/suppliers`       | Any authenticated user                         | Optional `?search=`, `?status=`, `?category=`                                                                                                                                    | `200 { items: Supplier[] }`                                         |
| `GET /api/suppliers/:id`   | Any authenticated user                         | —                                                                                                                                                                                | `200` — a single `Supplier`                                         |
| `POST /api/suppliers`      | Owner or Administrator only (`403` for Member) | `{ supplierName, supplierCategory, displayName?, contactPerson?, email?, phoneNumber?, website?, country?, state?, city?, address?, taxIdentificationNumber?, notes?, status? }` | `201` — the created `Supplier` (`status: ACTIVE` unless overridden) |
| `PATCH /api/suppliers/:id` | Owner or Administrator only                    | Partial of the same fields as create (no `supplierCode`)                                                                                                                         | `200` — the updated `Supplier`                                      |

Every write is scoped to the caller's own `organisationId` (from their JWT) — a
cross-tenant `id` 404s exactly like a nonexistent one, never leaking whether the supplier
exists in another tenant. There is no `DELETE` endpoint (see "Status" above).

## 8. Audit Events

| Action                 | When                                                 |
| ---------------------- | ---------------------------------------------------- |
| `supplier.created`     | `POST /api/suppliers`                                |
| `supplier.updated`     | `PATCH /api/suppliers/:id` (no `status` change)      |
| `supplier.activated`   | `PATCH /api/suppliers/:id` with `status: "ACTIVE"`   |
| `supplier.deactivated` | `PATCH /api/suppliers/:id` with `status: "INACTIVE"` |

## 9. Prisma Schema (excerpt)

```prisma
enum SupplierCategory {
  RAW_MATERIAL
  PACKAGING
  LOGISTICS
  MAINTENANCE
  UTILITY
  SERVICE
  OTHER
}

enum SupplierStatus {
  ACTIVE
  INACTIVE
}

model Supplier {
  id                       String           @id @default(cuid())
  organisationId           String
  supplierCode             String           @unique
  supplierName             String
  displayName              String?
  contactPerson            String?
  email                    String?
  phoneNumber              String?
  website                  String?
  country                  String?
  state                    String?
  city                     String?
  address                  String?
  taxIdentificationNumber  String?
  supplierCategory         SupplierCategory
  status                   SupplierStatus   @default(ACTIVE)
  notes                    String?
  createdById              String?
  updatedById              String?
  createdAt                DateTime         @default(now())
  updatedAt                DateTime         @updatedAt

  organisation Organisation @relation(fields: [organisationId], references: [id], onDelete: Cascade)

  @@index([organisationId])
  @@index([organisationId, status])
  @@index([organisationId, supplierCategory])
  @@map("suppliers")
}
```

See migration `20260802163405_add_supplier_management` for the exact SQL.

## 10. Known Limitations (Sprint 4.2)

- No Purchase Orders, Goods Receiving, Invoices, Vendor Payments, Procurement Workflows,
  Contracts, or Price Lists — all explicitly out of scope per the brief, reserved for
  Procurement (Sprint 4.3+).
- No Product–Supplier relationships yet — those are introduced when Procurement and
  sourcing are implemented.
- Category is a fixed enum, not tenant-configurable.
- "Inactive suppliers cannot receive future Purchase Orders" is a stated business rule, not
  an enforced one — there's nothing to enforce it against yet, since Purchase Orders don't
  exist.
