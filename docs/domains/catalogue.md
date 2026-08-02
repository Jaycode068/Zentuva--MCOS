# Product Catalogue Domain

- **Status:** Foundation implemented — Sprint 4.1 ("Product Catalogue Foundation").
- **Sprint:** 4.1
- **Depends on:** [Identity](identity.md) (tenant boundary, authentication, `RolesGuard`),
  [ADR-002 — Modular Monolith](../adr/ADR-002-modular-monolith.md),
  [ADR-003 — Multi-Tenancy](../adr/ADR-003-multi-tenancy.md)
- **See also:** [Sprint 4.1 Completion Report](../sprint-4.1-completion-report.md) for what
  was implemented and why.

## 1. Business Purpose

The Product Catalogue is the master source of truth for everything an Organisation
manufactures or sells. Every future manufacturing/commerce module (Inventory, Production,
Sales, Distribution, Finance) is expected to reference a `Product.id` from this catalogue
rather than duplicating product data — this is the first of the "Core Manufacturing &
Commerce Domains" (`docs/roadmap.md` Phase 2), and the first non-Identity domain module in
the codebase.

Per the Sprint 4.1 brief, this sprint deliberately builds **only** the catalogue itself:
no Inventory, Pricing, Procurement, Sales, variants, batch/expiry tracking, or barcode
generation. Those are explicitly out of scope until their own domains are built on top of
this foundation.

## 2. Key Concepts / Entities

### Product

- **Responsibility:** a single product an Organisation manufactures, sells, or consumes as
  a raw material or packaging input.
- **Ownership:** owned by the Product Catalogue domain (`apps/api/src/catalogue/`).
  Referenced by id from other domains once they exist; no other domain writes to the
  `products` table directly (ADR-002 domain-ownership rule).
- **Identifiers:** `id` (internal cuid PK), `code` (see "Product Code" below), `slug`
  (derived from `name` at creation, deduped within the organisation on collision — not yet
  used in any route, reserved for a future customer-facing catalogue page).
- **Tenant scoping:** every `Product` belongs to exactly one `Organisation`
  (`organisationId`, `onDelete: Cascade`) — same tenant-isolation convention as every
  Identity aggregate (identity.md §7): every repository method that reads or writes a
  specific product takes `organisationId` and includes it in the query.
- **Lifecycle:** `DRAFT` → `ACTIVE` → `ARCHIVED`, never physically deleted (see "Status"
  below).

**Fields:**

| Field                                 | Notes                                                                                                                                                                                                                                                              |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Product Code (`code`)                 | Auto-generated (`PRD-000001`, `PRD-000002`, ...), globally unique, immutable — never accepted on create or update input. See "Product Code" below.                                                                                                                 |
| Product Name (`name`)                 | Required.                                                                                                                                                                                                                                                          |
| Display Name (`displayName`)          | Optional customer-facing name, distinct from `name` — same pattern as `Organisation.displayName` (Sprint 2.1).                                                                                                                                                     |
| Slug (`slug`)                         | Derived from `name` at creation, unique per organisation (`@@unique([organisationId, slug])`), fixed afterward.                                                                                                                                                    |
| Category (`category`)                 | Enum, hardcoded per the brief: Snacks, Beverage, Water, Confectionery, Raw Materials, Packaging, Others. Not a Categories table — a full taxonomy is future scope.                                                                                                 |
| Product Type (`type`)                 | Enum: Finished Product, Raw Material, Packaging Material.                                                                                                                                                                                                          |
| Short/Long Description                | Both optional free text.                                                                                                                                                                                                                                           |
| Unit of Measure (`unit`)              | Free-text column (brief: "Store as text") — the frontend offers a fixed dropdown (Piece, Pack, Carton, Bottle, Sachet, Kilogram, Gram, Litre) as suggestions, but nothing server-side enforces that list, same convention as `Organisation.currency`/`dateFormat`. |
| Product Image (`imageUrl`/`imageKey`) | One image, same `FileStorage` port + absolute-URL pattern as `Organisation.logoUrl` (Sprint 3.4) and `User.avatarUrl` (Sprint 3.5). `imageKey` is the opaque storage key needed to delete the old file on replace/remove.                                          |
| Status (`status`)                     | Enum: Draft, Active, Archived. See below.                                                                                                                                                                                                                          |
| Created/Updated By                    | `createdById`/`updatedById` — plain nullable string columns, no FK relation, same convention as `AuditLog.actorUserId` (metadata about who acted, not a relationship the aggregate depends on).                                                                    |
| Created/Updated At                    | Standard `createdAt`/`updatedAt` timestamps, automatically maintained.                                                                                                                                                                                             |

### Product Code

Format: `PRD-000001`, `PRD-000002`, ... (fixed `PRD` prefix + 6-digit zero-padded
sequence). Generated by `ProductService.generateUniqueCode` — a collision-avoidance loop
identical in shape to `OrganisationService.generateUniqueOrganisationCode` (Sprint 3.2),
except the sequence is **global** (checked via `ProductRepository.existsByCode` with no
`organisationId` filter), not derived from the product name the way `Organisation`'s
name-derived prefix is. Requirements enforced: unique, immutable, never editable, always
generated automatically — `code` is absent from both `createProductSchema` and
`updateProductSchema` so it can never be supplied on input.

### Status

`DRAFT` (default on creation) → `ACTIVE` → `ARCHIVED`, with `ARCHIVED` → `ACTIVE` also
valid (a way to "un-archive" a product). Products are **never physically deleted** — the
brief is explicit about this, and `Archived` is the terminal "removed from active use"
state, not a delete. Enforced by `ProductService.activate`/`archive`, which reject an
already-`ACTIVE`→activate or already-`ARCHIVED`→archive call with a `400
BadRequestException` rather than silently no-opping — this is the "valid status
transitions" the brief's Validation section requires.

## 3. Workflows

- **Create** — `POST /api/products` (Owner/Administrator only). Auto-generates `code` and
  `slug`, always starts `DRAFT`. Audited as `product.created`.
- **Edit** — `PATCH /api/products/:id` (Owner/Administrator only). Partial update of
  name/displayName/category/type/unit/descriptions; `code` and `status` are never
  touched by this endpoint. Audited as `product.updated`.
- **Activate / Archive** — `POST /api/products/:id/activate` / `.../archive`
  (Owner/Administrator only). Audited as `product.activated` / `product.archived`.
- **Image upload/removal** — `POST`/`DELETE /api/products/:id/image`
  (Owner/Administrator only), multipart upload via the shared `FileStorage` port. Audited
  as `product.image.uploaded` / `product.image.removed`.
- **Browse** — `GET /api/products` (any authenticated user, Member included — read-only).
  Frontend does simple client-side search by name/code (no pagination, per the brief); the
  endpoint also accepts an optional `?search=` query param for the same filter
  server-side.
- **View one** — `GET /api/products/:id` (any authenticated user).

## 4. Authorization

Reuses `RolesGuard` exactly as every other domain does (identity.md §6, Sprint 2.1):

| Role          | Access                                           |
| ------------- | ------------------------------------------------ |
| Owner         | Full access (create/edit/activate/archive/image) |
| Administrator | Full access (create/edit/activate/archive/image) |
| Member        | Read-only (`GET` endpoints only)                 |

No permission-key engine — same minimal role-name check every other write surface in this
codebase uses, per the brief's explicit "No permission engine" instruction.

## 5. Configuration

- **Category** and **Product Type** are hardcoded enums (Prisma `ProductCategory`/
  `ProductType`) — not tenant-configurable in this sprint. A full taxonomy (tenant-defined
  categories) is future scope once a real need for it emerges.
- **Unit of Measure** is free text with UI-suggested common values, not a closed list — an
  organisation can enter any unit string it needs.

## 6. Integration Points

No other domain exists yet to integrate with. The `Product.id` is the intended integration
point for every future domain built on top of this one (Inventory tracks stock levels per
`Product`, Sales references `Product` on order lines, Production consumes/produces
`Product`s, etc.) — per the brief's "master source of truth" framing. `AuditService` is
reused exactly as every Identity-domain write surface already does (`docs/domains/
identity.md` §8).

## 7. API Reference

| Endpoint                          | Auth                                           | Input                                                                               | Output                                          |
| --------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------- |
| `GET /api/products`               | Any authenticated user                         | Optional `?search=`                                                                 | `200 { items: Product[] }`                      |
| `GET /api/products/:id`           | Any authenticated user                         | —                                                                                   | `200` — a single `Product`                      |
| `POST /api/products`              | Owner or Administrator only (`403` for Member) | `{ name, displayName?, category, type, unit, shortDescription?, longDescription? }` | `201` — the created `Product` (`status: DRAFT`) |
| `PATCH /api/products/:id`         | Owner or Administrator only                    | Partial of the same fields as create (no `code`/`status`)                           | `200` — the updated `Product`                   |
| `POST /api/products/:id/activate` | Owner or Administrator only                    | —                                                                                   | `200` — `400` if already `ACTIVE`               |
| `POST /api/products/:id/archive`  | Owner or Administrator only                    | —                                                                                   | `200` — `400` if already `ARCHIVED`             |
| `POST /api/products/:id/image`    | Owner or Administrator only                    | Multipart `file` (PNG/JPEG/SVG, ≤2 MB)                                              | `200` — same shape as `GET`, `imageUrl` updated |
| `DELETE /api/products/:id/image`  | Owner or Administrator only                    | —                                                                                   | `200` — same shape as `GET`, `imageUrl` cleared |

Every write is scoped to the caller's own `organisationId` (from their JWT) — a
cross-tenant `id` 404s exactly like a nonexistent one, never leaking whether the product
exists in another tenant.

## 8. Audit Events

| Action                   | When                              |
| ------------------------ | --------------------------------- |
| `product.created`        | `POST /api/products`              |
| `product.updated`        | `PATCH /api/products/:id`         |
| `product.activated`      | `POST /api/products/:id/activate` |
| `product.archived`       | `POST /api/products/:id/archive`  |
| `product.image.uploaded` | `POST /api/products/:id/image`    |
| `product.image.removed`  | `DELETE /api/products/:id/image`  |

## 9. Prisma Schema (excerpt)

```prisma
enum ProductCategory {
  SNACKS
  BEVERAGE
  WATER
  CONFECTIONERY
  RAW_MATERIALS
  PACKAGING
  OTHERS
}

enum ProductType {
  FINISHED_PRODUCT
  RAW_MATERIAL
  PACKAGING_MATERIAL
}

enum ProductStatus {
  DRAFT
  ACTIVE
  ARCHIVED
}

model Product {
  id             String          @id @default(cuid())
  organisationId String
  code           String          @unique
  name           String
  displayName    String?
  slug           String
  category       ProductCategory
  type           ProductType
  shortDescription String?
  longDescription  String?
  unit           String
  imageUrl       String?
  imageKey       String?
  status         ProductStatus   @default(DRAFT)
  createdById    String?
  updatedById    String?
  createdAt      DateTime        @default(now())
  updatedAt      DateTime        @updatedAt

  organisation Organisation @relation(fields: [organisationId], references: [id], onDelete: Cascade)

  @@unique([organisationId, slug])
  @@index([organisationId])
  @@index([organisationId, status])
  @@map("products")
}
```

See migration `20260801184041_add_product_catalogue` for the exact SQL.

## 10. Known Limitations (Sprint 4.1)

- No variants, batch numbers, expiry dates, barcode/QR generation, taxes, multi-image
  galleries, or bulk import/export — all explicitly out of scope per the brief.
- No Inventory, Pricing, Procurement, or Sales integration yet — `Product.id` exists as
  the integration point, but nothing consumes it yet.
- Category/Product Type are fixed enums, not tenant-configurable.
- The frontend's "Product Image" upload is only available once a product exists (edit
  mode) — the create dialog cannot attach an image in the same request, since
  `POST /api/products/:id/image` needs an id that doesn't exist until the create `POST`
  round-trips. A user creates the product first, then uploads its image via Edit.
