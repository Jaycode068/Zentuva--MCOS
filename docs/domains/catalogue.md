# Product Catalogue Domain

- **Status:** Foundation implemented — Sprint 4.1 ("Product Catalogue Foundation"),
  extended Sprint 4.7 ("Product Family, Variant & SKU Architecture Refinement") with a
  `ProductFamily → ProductVariant → Product(SKU)` grouping hierarchy.
- **Sprint:** 4.1, 4.7
- **Depends on:** [Identity](identity.md) (tenant boundary, authentication, `RolesGuard`),
  [ADR-002 — Modular Monolith](../adr/ADR-002-modular-monolith.md),
  [ADR-003 — Multi-Tenancy](../adr/ADR-003-multi-tenancy.md)
- **See also:** [Sprint 4.1 Completion Report](../sprint-4.1-completion-report.md),
  [Sprint 4.7 Completion Report](../sprint-4.7-completion-report.md) for what was
  implemented and why.

## 1. Business Purpose

The Product Catalogue is the master source of truth for everything an Organisation
manufactures or sells. Every manufacturing/commerce module built since (Procurement,
Inventory, Production) references `Product.id` from this catalogue rather than
duplicating product data — this is the first of the "Core Manufacturing & Commerce
Domains" (`docs/roadmap.md` Phase 2), and the first non-Identity domain module in the
codebase.

Sprint 4.1 deliberately built only the flat catalogue itself. That flat model doesn't
represent how a real manufacturer organises its products, though: one commercial product
("Plantain Chips") typically has several distinct recipes/formulations ("Sweet & Spicy,"
"Classic Salted"), each sold in several independently-stocked pack sizes (30g/500g/1kg).
Sprint 4.7 adds exactly that grouping — `Organisation → ProductFamily → ProductVariant →
Product(SKU)` — as a pure organisation/navigation/reporting layer **on top of** the
existing `Product`, never replacing it: the SKU (`Product`) remains the only entity every
other domain (BOM, Production Order, Material Issue, Production Run, Inventory,
Purchase Order, Goods Receipt) ever transacts against. See §2's `ProductFamily`/
`ProductVariant` write-ups and §6 "Integration Points" for the exact boundary.

Still explicitly out of scope (Sprint 4.1's original list, reaffirmed by Sprint 4.7): a
dedicated pack-size/packaging entity, an attribute/option engine, Pricing, batch/expiry
tracking, barcode/QR generation, or bulk import/export. Those remain future work once
their own domains (or a genuine need) emerges — see §10.

## 2. Key Concepts / Entities

### Product

- **Responsibility:** a single product an Organisation manufactures, sells, or consumes as
  a raw material or packaging input — the actual stockable, manufacturable, transactional
  item (the "SKU").
- **Ownership:** owned by the Product Catalogue domain (`apps/api/src/catalogue/`).
  Referenced by id from every other domain; no other domain writes to the `products`
  table directly (ADR-002 domain-ownership rule).
- **Identifiers:** `id` (internal cuid PK), `code` (see "Product Code" below), `slug`
  (derived from `name` at creation, deduped within the organisation on collision — not yet
  used in any route, reserved for a future customer-facing catalogue page).
- **Tenant scoping:** every `Product` belongs to exactly one `Organisation`
  (`organisationId`, `onDelete: Cascade`) — same tenant-isolation convention as every
  Identity aggregate (identity.md §7): every repository method that reads or writes a
  specific product takes `organisationId` and includes it in the query.
- **Lifecycle:** `DRAFT` → `ACTIVE` → `ARCHIVED`, never physically deleted (see "Status"
  below).
- **Hierarchy (Sprint 4.7):** optionally belongs to one `ProductVariant`
  (`productVariantId`, nullable) — see "Product Family / Product Variant" below. Raw
  materials, packaging materials, consumables, and any finished product never attached to
  the hierarchy simply have `productVariantId: null`; this is a normal, permanent state,
  not a migration step every product must eventually complete.

**Fields:**

| Field                                 | Notes                                                                                                                                                                                                                                                              |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Product Code (`code`)                 | Auto-generated (`PRD-000001`, `PRD-000002`, ...), globally unique, immutable — never accepted on create or update input. See "Product Code" below.                                                                                                                 |
| Product Name (`name`)                 | Required.                                                                                                                                                                                                                                                          |
| Display Name (`displayName`)          | Optional customer-facing name, distinct from `name` — same pattern as `Organisation.displayName` (Sprint 2.1).                                                                                                                                                     |
| Slug (`slug`)                         | Derived from `name` at creation, unique per organisation (`@@unique([organisationId, slug])`), fixed afterward.                                                                                                                                                    |
| Category (`category`)                 | Enum, hardcoded per the brief: Snacks, Beverage, Water, Confectionery, Raw Materials, Packaging, Others. Not a Categories table — a full taxonomy is future scope.                                                                                                 |
| Product Type (`type`)                 | Enum: Finished Product, Raw Material, Packaging Material, Consumable (the fourth value added Sprint 4.3, `docs/domains/procurement.md` §2).                                                                                                                        |
| Short/Long Description                | Both optional free text.                                                                                                                                                                                                                                           |
| Unit of Measure (`unit`)              | Free-text column (brief: "Store as text") — the frontend offers a fixed dropdown (Piece, Pack, Carton, Bottle, Sachet, Kilogram, Gram, Litre) as suggestions, but nothing server-side enforces that list, same convention as `Organisation.currency`/`dateFormat`. |
| Product Image (`imageUrl`/`imageKey`) | One image, same `FileStorage` port + absolute-URL pattern as `Organisation.logoUrl` (Sprint 3.4) and `User.avatarUrl` (Sprint 3.5). `imageKey` is the opaque storage key needed to delete the old file on replace/remove.                                          |
| Status (`status`)                     | Enum: Draft, Active, Archived. See below.                                                                                                                                                                                                                          |
| Product Variant (`productVariantId`)  | Added Sprint 4.7. Optional FK to `ProductVariant` — see "Product Family / Product Variant" below. `onDelete: SetNull`.                                                                                                                                             |
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

### Product Family / Product Variant (Sprint 4.7)

The `Organisation → ProductFamily → ProductVariant → Product(SKU)` hierarchy — a pure
grouping/navigation/reporting layer, never itself a transactional target:

- **`ProductFamily`** — a logical commercial/manufacturing grouping (e.g. "Plantain
  Chips"). `id`, `organisationId`, `code` (auto-generated `FAM-000001`, globally unique,
  immutable — same generator shape as `Product.code`), `name`, `description?`, `status`
  (`ACTIVE`/`INACTIVE` — see "Family/Variant Status" below), audit metadata
  (`createdById`/`updatedById`/timestamps). Owns zero or more `ProductVariant`s.
- **`ProductVariant`** — a meaningful recipe/formulation/characteristic variation within
  a family (e.g. "Sweet & Spicy — Ripe Plantain," "Classic Salted"). `id`,
  `organisationId`, `productFamilyId` (required, immutable — no re-parenting to a
  different family this sprint), `code` (auto-generated `VAR-000001`, globally unique),
  `name`, `description?`, `status`, audit metadata. Owns zero or more `Product` SKUs via
  `Product.productVariantId`.
- **`Product` (SKU)** — unchanged in every respect except the one new optional FK
  (`productVariantId`). Different pack sizes of the same variant (30g/500g/1kg) are each
  their own `Product` row — there is no dedicated pack-size entity this sprint (brief §6:
  "for MVP, pack size can remain part of the SKU/product definition"); the size is simply
  encoded in the SKU's own `name`.

**Family/Variant Status** — deliberately `ACTIVE`/`INACTIVE` (2-state), not `Product`'s
heavier `DRAFT`/`ACTIVE`/`ARCHIVED` lifecycle, same shape as `InventoryLocation`'s
`LocationStatus` (Sprint 4.5). A family/variant's status only gates "is this selectable
when creating a new variant/SKU" — a UI convenience, never a cross-domain business rule
the way `Product.status` is (only `ACTIVE` products are purchasable/producible) — so
there's no meaningful "draft" phase and no dedicated activate/archive endpoints; `status`
is just a field on the same `PATCH` as everything else.

**Why the SKU stays the transactional entity, never the Family or Variant:** every FK
relationship into `Product` established by Procurement (Sprint 4.3), Inventory (Sprint
4.4/4.4.1/4.5), and Production (Sprint 4.6) — `PurchaseOrderItem`, `GoodsReceiptItem`,
`InventoryStock`, `InventoryTransaction`, `BillOfMaterial`, `BillOfMaterialItem`,
`ProductionOrder`, `ProductionOrderItem`, `ProductionMaterialIssueItem` — points directly
at `Product.id`, and **none of those relationships changed this sprint**. A BOM/
Production Order for "Plantain Chips Sweet & Spicy 1kg" is a BOM/Production Order
against that one specific `Product` row, exactly as it would be for any flat product with
no family/variant at all; the hierarchy is invisible to that transaction. This is a
deliberate, load-bearing design choice, not an oversight — see
`docs/sprint-4.7-completion-report.md` "Migration Strategy."

**Migration / backward compatibility:** `Product.productVariantId` is nullable.
Pre-existing products (everything seeded before Sprint 4.7, including the flagship
`PRD-000001` "Plantain Chips" with its own already-`COMPLETED` `BOM-000001`/
`PROD-000001` production history) are left completely untouched — `productVariantId`
stays `null` on every one of them. Nothing about the migration retroactively attaches,
renames, or re-codes any existing row; a product simply opts into the hierarchy the next
time it's created or edited.

## 3. Workflows

- **Create a Product** — `POST /api/products` (Owner/Administrator only). Auto-generates
  `code` and `slug`, always starts `DRAFT`. Optionally attaches to a `ProductVariant` via
  `productVariantId` (validated tenant-scoped — a cross-tenant or nonexistent id is
  rejected with `400`). Audited as `product.created`.
- **Edit a Product** — `PATCH /api/products/:id` (Owner/Administrator only). Partial
  update of name/displayName/category/type/unit/descriptions/`productVariantId`; `code`
  and `status` are never touched by this endpoint. Audited as `product.updated`.
- **Activate / Archive a Product** — `POST /api/products/:id/activate` / `.../archive`
  (Owner/Administrator only). Audited as `product.activated` / `product.archived`.
- **Image upload/removal** — `POST`/`DELETE /api/products/:id/image`
  (Owner/Administrator only), multipart upload via the shared `FileStorage` port. Audited
  as `product.image.uploaded` / `product.image.removed`.
- **Browse Products** — `GET /api/products` (any authenticated user, Member included —
  read-only). Returns each product's optional nested `productVariant`/`productFamily`
  context. Frontend does simple client-side search by name/code, with a "By Family" tree
  view alongside the flat table (Sprint 4.7).
- **View one Product** — `GET /api/products/:id` (any authenticated user).
- **Create/Edit a Product Family** — `POST /api/product-families` /
  `PATCH /api/product-families/:id` (Owner/Administrator only). Audited as
  `product-family.created` / `product-family.updated`.
- **Create/Edit a Product Variant** — `POST /api/product-variants` /
  `PATCH /api/product-variants/:id` (Owner/Administrator only). `productFamilyId` is
  required on create and validated tenant-scoped; never re-parented on update. Audited as
  `product-variant.created` / `product-variant.updated`.
- **Browse Families/Variants** — `GET /api/product-families`, `GET /api/product-variants`
  (optional `?productFamilyId=` filter) — any authenticated user.

## 4. Authorization

Reuses `RolesGuard` exactly as every other domain does (identity.md §6, Sprint 2.1):

| Role          | Access                                                      |
| ------------- | ----------------------------------------------------------- |
| Owner         | Full access (Products, Product Families, Product Variants)  |
| Administrator | Full access (Products, Product Families, Product Variants)  |
| Member        | Read-only (`GET` endpoints only, across all three entities) |

No permission-key engine — same minimal role-name check every other write surface in this
codebase uses, per the brief's explicit "No permission engine" instruction.

## 5. Configuration

- **Category** and **Product Type** are hardcoded enums (Prisma `ProductCategory`/
  `ProductType`) — not tenant-configurable in this sprint. A full taxonomy (tenant-defined
  categories) is future scope once a real need for it emerges.
- **Unit of Measure** is free text with UI-suggested common values, not a closed list — an
  organisation can enter any unit string it needs.
- **Product Family / Product Variant attachment (Sprint 4.7)** is entirely optional and
  UI-guided, not database-enforced: the frontend only shows the Family/Variant picker
  when creating/editing a `FINISHED_PRODUCT`-type product (brief §5 — "the hierarchy is
  primarily useful for manufactured products... raw materials/consumables/packaging
  should remain independent unless there is a genuine business reason"), but the schema
  and API accept `productVariantId` on any product type if a real need ever arises.

## 6. Integration Points

- **Procurement** ([procurement.md](procurement.md)) — every `PurchaseOrderItem`
  references `Product.id` directly, read via the exported `ProductRepository`. Untouched
  by the Sprint 4.7 hierarchy.
- **Inventory** ([inventory.md](inventory.md)) — every `InventoryStock`/
  `InventoryTransaction`/`GoodsReceiptItem` row keys off `Product.id` (never
  `ProductVariant`/`ProductFamily`) — SKU-level stock stays fully independent per pack
  size/variant, exactly as it was for any two unrelated flat products before this sprint.
  Untouched by the Sprint 4.7 hierarchy.
- **Production** ([production.md](production.md)) — `BillOfMaterial`, `ProductionOrder`,
  `ProductionOrderItem`, `ProductionMaterialIssueItem` all key off `Product.id` directly.
  A BOM belongs to one specific SKU; a Production Order targets one specific SKU. Untouched
  by the Sprint 4.7 hierarchy — see `production.md` §2 for the explicit confirmation.
- **`ProductModule` now imports `ProductVariantModule`** (which imports
  `ProductFamilyModule`) so `ProductService` can validate a product's `productVariantId`
  and expose hierarchy context on reads — a one-way dependency chain
  (`ProductModule → ProductVariantModule → ProductFamilyModule`), each module exporting
  its own repository for the next consumer, same "import the module, inject its exported
  repository" pattern as `ProcurementModule`/`InventoryModule`/`ProductionModule`
  importing `ProductModule` itself.
- **Future Sales/Distribution/Finance/Costing** — the hierarchy exists specifically so
  these future modules can report at the Family/Variant level (total units produced
  across all pack sizes, sales by variant, profitability by family) without a schema
  change, while still transacting at the SKU level. No such reporting exists yet — see
  §10.

## 7. API Reference

### Product

| Endpoint                          | Auth                                           | Input                                                                                                  | Output                                                                                                   |
| --------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `GET /api/products`               | Any authenticated user                         | Optional `?search=`                                                                                    | `200 { items: Product[] }` — each with nested `productVariant`/`productFamily` context                   |
| `GET /api/products/:id`           | Any authenticated user                         | —                                                                                                      | `200` — a single `Product`, same nested context                                                          |
| `POST /api/products`              | Owner or Administrator only (`403` for Member) | `{ name, displayName?, category, type, unit, shortDescription?, longDescription?, productVariantId? }` | `201` — the created `Product` (`status: DRAFT`); `400` for a cross-tenant/nonexistent `productVariantId` |
| `PATCH /api/products/:id`         | Owner or Administrator only                    | Partial of the same fields as create (no `code`/`status`)                                              | `200` — the updated `Product`                                                                            |
| `POST /api/products/:id/activate` | Owner or Administrator only                    | —                                                                                                      | `200` — `400` if already `ACTIVE`                                                                        |
| `POST /api/products/:id/archive`  | Owner or Administrator only                    | —                                                                                                      | `200` — `400` if already `ARCHIVED`                                                                      |
| `POST /api/products/:id/image`    | Owner or Administrator only                    | Multipart `file` (PNG/JPEG/SVG, ≤2 MB)                                                                 | `200` — same shape as `GET`, `imageUrl` updated                                                          |
| `DELETE /api/products/:id/image`  | Owner or Administrator only                    | —                                                                                                      | `200` — same shape as `GET`, `imageUrl` cleared                                                          |

### Product Family (Sprint 4.7)

| Endpoint                          | Auth                                           | Input                              | Output                                                         |
| --------------------------------- | ---------------------------------------------- | ---------------------------------- | -------------------------------------------------------------- |
| `GET /api/product-families`       | Any authenticated user                         | Optional `?search=`, `?status=`    | `200 { items: ProductFamily[] }`                               |
| `GET /api/product-families/:id`   | Any authenticated user                         | —                                  | `200` — a single family; `404` if not found                    |
| `POST /api/product-families`      | Owner or Administrator only (`403` for Member) | `{ name, description? }`           | `201` — the created family (`status: ACTIVE`)                  |
| `PATCH /api/product-families/:id` | Owner or Administrator only                    | `{ name?, description?, status? }` | `200` — the updated family; `400` on a no-op status transition |

### Product Variant (Sprint 4.7)

| Endpoint                          | Auth                                           | Input                                                | Output                                                                                  |
| --------------------------------- | ---------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `GET /api/product-variants`       | Any authenticated user                         | Optional `?productFamilyId=`, `?search=`, `?status=` | `200 { items: ProductVariant[] }`                                                       |
| `GET /api/product-variants/:id`   | Any authenticated user                         | —                                                    | `200` — a single variant; `404` if not found                                            |
| `POST /api/product-variants`      | Owner or Administrator only (`403` for Member) | `{ productFamilyId, name, description? }`            | `201` — the created variant (`status: ACTIVE`); `400` for a missing/cross-tenant family |
| `PATCH /api/product-variants/:id` | Owner or Administrator only                    | `{ name?, description?, status? }`                   | `200` — the updated variant; `400` on a no-op status transition                         |

Every write is scoped to the caller's own `organisationId` (from their JWT) — a
cross-tenant `id` 404s exactly like a nonexistent one, never leaking whether the row
exists in another tenant.

## 8. Audit Events

| Action                    | When                              |
| ------------------------- | --------------------------------- |
| `product.created`         | `POST /api/products`              |
| `product.updated`         | `PATCH /api/products/:id`         |
| `product.activated`       | `POST /api/products/:id/activate` |
| `product.archived`        | `POST /api/products/:id/archive`  |
| `product.image.uploaded`  | `POST /api/products/:id/image`    |
| `product.image.removed`   | `DELETE /api/products/:id/image`  |
| `product-family.created`  | `POST /api/product-families`      |
| `product-family.updated`  | `PATCH /api/product-families/:id` |
| `product-variant.created` | `POST /api/product-variants`      |
| `product-variant.updated` | `PATCH /api/product-variants/:id` |

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
  CONSUMABLE
}

enum ProductStatus {
  DRAFT
  ACTIVE
  ARCHIVED
}

model Product {
  id               String          @id @default(cuid())
  organisationId   String
  code             String          @unique
  name             String
  displayName      String?
  slug             String
  category         ProductCategory
  type             ProductType
  shortDescription String?
  longDescription  String?
  unit             String
  imageUrl         String?
  imageKey         String?
  status           ProductStatus   @default(DRAFT)
  createdById      String?
  updatedById      String?
  createdAt        DateTime        @default(now())
  updatedAt        DateTime        @updatedAt
  productVariantId String?

  organisation   Organisation     @relation(fields: [organisationId], references: [id], onDelete: Cascade)
  productVariant ProductVariant?  @relation(fields: [productVariantId], references: [id], onDelete: SetNull)
  // ... plus every back-relation array Procurement/Inventory/Production added
  // (purchaseOrderItems, goodsReceiptItems, inventoryStock, inventoryTransactions,
  // billOfMaterials, billOfMaterialItems, productionOrders, productionOrderItems,
  // productionMaterialIssueItems) — all unchanged by Sprint 4.7.

  @@unique([organisationId, slug])
  @@index([organisationId])
  @@index([organisationId, status])
  @@index([productVariantId])
  @@map("products")
}

enum ProductFamilyStatus {
  ACTIVE
  INACTIVE
}

model ProductFamily {
  id             String              @id @default(cuid())
  organisationId String
  code           String              @unique
  name           String
  description    String?
  status         ProductFamilyStatus @default(ACTIVE)
  createdById    String?
  updatedById    String?
  createdAt      DateTime            @default(now())
  updatedAt      DateTime            @updatedAt

  organisation Organisation     @relation(fields: [organisationId], references: [id], onDelete: Cascade)
  variants     ProductVariant[]

  @@index([organisationId])
  @@index([organisationId, status])
  @@map("product_families")
}

enum ProductVariantStatus {
  ACTIVE
  INACTIVE
}

model ProductVariant {
  id              String               @id @default(cuid())
  organisationId  String
  productFamilyId String
  code            String               @unique
  name            String
  description     String?
  status          ProductVariantStatus @default(ACTIVE)
  createdById     String?
  updatedById     String?
  createdAt       DateTime             @default(now())
  updatedAt       DateTime             @updatedAt

  organisation  Organisation  @relation(fields: [organisationId], references: [id], onDelete: Cascade)
  productFamily ProductFamily @relation(fields: [productFamilyId], references: [id], onDelete: Restrict)
  products      Product[]

  @@index([organisationId])
  @@index([organisationId, status])
  @@index([productFamilyId])
  @@map("product_variants")
}
```

See migration `20260801184041_add_product_catalogue` (Sprint 4.1) and
`20260815201303_add_product_family_variant_hierarchy` (Sprint 4.7 — purely additive: two
new tables, two new enums, one new nullable column, no destructive change to any existing
table) for the exact SQL.

## 10. Known Limitations

- No dedicated pack-size/packaging-size entity — a pack size (30g/500g/1kg) is just part
  of a SKU's own `name`, per brief §6's explicit MVP scoping.
- No attribute/option engine, product configurator, or e-commerce-style variant selector
  — the hierarchy is a fixed three-level tree (Family → Variant → SKU), not a generic
  key/value attribute system, per brief §3's explicit "do not over-engineer" instruction.
- No re-parenting a `ProductVariant` to a different `ProductFamily`, and no way to detach
  a `Product` from its `ProductVariant` once attached (`productVariantId` accepts a value,
  never `null`, on update) — both deliberately out of scope this sprint; would need a new
  endpoint/schema field if a real need emerges.
- No cross-family/variant aggregation query (e.g. "total Plantain Chips produced across
  every SKU") — the relational structure makes this straightforward to build later, but
  no such query/endpoint exists yet (brief §14: "do not build a complete reporting engine
  this sprint").
- No batch numbers, expiry dates, barcode/QR generation, taxes, multi-image galleries, or
  bulk import/export — all explicitly out of scope per the Sprint 4.1 brief, unaffected by
  Sprint 4.7.
- Category/Product Type are fixed enums, not tenant-configurable.
- The frontend's "Product Image" upload is only available once a product exists (edit
  mode) — the create dialog cannot attach an image in the same request, since
  `POST /api/products/:id/image` needs an id that doesn't exist until the create `POST`
  round-trips. A user creates the product first, then uploads its image via Edit.
- Family/Variant attachment is UI-guided (only shown for `FINISHED_PRODUCT` type in the
  create/edit dialog), not database-enforced — see §5.
