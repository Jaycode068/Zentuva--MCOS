# Sprint 4.7 Completion Report — Product Family, Variant & SKU Architecture Refinement

**Date:** 2026-08-15
**Status:** Complete

## 1. Objective

Zentuva's Product Catalogue (Sprint 4.1) is flat: every pack size and every flavour of a
product is its own independent `Product` row with no notion of grouping. That's workable
for a small demo catalogue, but doesn't reflect how a real manufacturer like Boby Bites
actually organises its products — one commercial product ("Plantain Chips") has several
distinct recipes ("Sweet & Spicy," "Green & Spicy," "Classic Salted"), and each recipe is
sold in several independently-stocked, independently-manufactured pack sizes (30g/500g/
1kg). Sprint 4.7 adds that structure — `Organisation → ProductFamily → ProductVariant →
Product (SKU)` — _before_ Sales/Distribution/Costing/Finance are built on top of the
catalogue, so those future modules inherit a durable hierarchy instead of one that needs
retrofitting later.

This was explicitly scoped as an architectural refinement, not a new domain: no attribute
systems, no dynamic attribute builders, no complex option matrices, no product
configurators, no e-commerce-style variant selectors, no new microservices or
unnecessary abstractions. The brief's own non-negotiable constraint: a Bill of Materials
belongs to a specific SKU, never to a Family or Variant directly, and a Production Order
always targets the SKU — the hierarchy is a grouping/reporting layer, never itself a
transactional target.

## 2. Implementation Summary

### Schema — two new models, two new enums, one new nullable column

Migration `20260815201303_add_product_family_variant_hierarchy` — purely additive (two
new tables, two new enums, one nullable FK column + index on the existing `Product`
table, two new back-relation arrays on `Organisation`), no destructive change to any
existing table or constraint. Applied cleanly on the first `prisma migrate dev` attempt.

- **`ProductFamily`** — `code` (`FAM-000001`, auto-generated, globally unique,
  immutable), `name`, `description?`, `status` (`ProductFamilyStatus`:
  `ACTIVE`/`INACTIVE`), audit metadata. Owns zero or more `ProductVariant`s.
- **`ProductVariant`** — `productFamilyId` (required, immutable — no re-parenting this
  sprint), `code` (`VAR-000001`), `name`, `description?`, `status`
  (`ProductVariantStatus`), audit metadata. Owns zero or more `Product` SKUs.
- **`Product.productVariantId`** — nullable, `onDelete: SetNull` (deliberately the
  reverse of every other in-domain FK in this codebase, which use `Restrict` — the SKU is
  the permanent, transactionally-load-bearing row; the variant is an optional grouping
  label that must never block or cascade-delete it).
- Two separate 2-value status enums (`ProductFamilyStatus`, `ProductVariantStatus`) were
  used rather than one shared enum — this codebase has no precedent for sharing a status
  enum across unrelated models even when the values are structurally identical (e.g.
  `LocationStatus` stayed entity-specific despite matching this exact shape).

### Migration strategy — every pre-existing product stays untouched

`productVariantId` is nullable and every product created before this sprint — including
the seeded `PRD-000001` "Plantain Chips," which already carries a `COMPLETED` Sprint 4.6
production history (`BOM-000001`/`PROD-000001`) — is left with `productVariantId: null`
and is otherwise completely unmodified. This is the explicitly-sanctioned, safest
backward-compatible approach: `null` simply means "not yet grouped into the new
hierarchy," a normal and permanent state for raw materials, packaging, consumables, and
any finished product a tenant chooses not to group. Nothing about the migration
retroactively renames, re-codes, or re-attaches any existing row.

### The one architectural question this sprint had to answer — and how it stayed backward-compatible

`ProductRepository.findById`/`findManyByOrganisation` are consumed directly by
`BillOfMaterialService` (Production) for finished-product/component-type validation, and
must keep returning a plain `Product` shape. Rather than changing those methods' return
type (which would ripple into Production without Production actually needing hierarchy
data), two **new** methods were added instead — `findByIdWithHierarchy`/
`findManyByOrganisationWithHierarchy`, returning a new `ProductWithHierarchy` type — used
only by `ProductService.getById`/`list` (the Product Catalogue's own two read endpoints).
`findById`/`findManyByOrganisation` themselves were left byte-for-byte unchanged. This is
exactly the brief's own instruction in practice: a problem that touched existing
architecture was reasoned through before implementation, and the smaller, additive,
backward-compatible change was chosen over rewriting the shared repository contract.

### Backend modules — `ProductFamilyModule`, `ProductVariantModule`

Both new modules mirror the existing `ProductModule`'s repository/service/controller
shape exactly (auto-code generator, tenant-scoped repository methods, `RolesGuard`-gated
writes, inline audit calls). Dependency chain: `ProductModule → ProductVariantModule →
ProductFamilyModule` (confirmed acyclic), each exporting its own repository for the next
consumer to inject directly — the same pattern established for cross-domain repository
sharing in Sprint 4.6. `ProductVariantService.create`/`update` validates
`productFamilyId` via `ProductFamilyRepository.findById`, rejecting a missing or
cross-tenant family with `400 BadRequestException` — the same "second line of defense"
pattern `BillOfMaterialService.assertFinishedProduct` established for Production.

API convention: `ProductFamily`/`ProductVariant` status is folded into the same `PATCH`
body as every other field (`InventoryLocation`'s convention), not `Product`'s dedicated
`/activate`+`/archive` action-endpoint convention — because Family/Variant status only
gates "is this selectable in a picker" (a UI convenience), never a cross-domain business
rule the way `Product.status` gates purchasability/producibility.

### How BOM, Production, and Inventory interact with the new hierarchy — they don't

This was the sprint's central design constraint, and it holds exactly as specified: every
FK relationship into `Product` established by Procurement, Inventory, and Production
(`PurchaseOrderItem`, `GoodsReceiptItem`, `InventoryStock`, `InventoryTransaction`,
`BillOfMaterial`, `BillOfMaterialItem`, `ProductionOrder`, `ProductionOrderItem`,
`ProductionMaterialIssueItem`) still points directly at `Product.id`, unchanged. A BOM
for "Plantain Chips Sweet & Spicy 1kg" is a BOM against that one specific `Product` row,
exactly as it would be for a flat product with no family/variant at all — the hierarchy
is invisible to every one of those transactions. `InventoryStock` stays keyed to
`(Organisation, Product, Location)`; stock for two SKUs in the same variant is never
combined into one balance. Zero files in `apps/api/src/production/` or
`apps/api/src/inventory/` needed to change; the only cross-domain touch was one new
regression test in `bill-of-material.service.spec.ts` proving a `Product` with a
`productVariantId` validates identically to one without.

### Frontend — `apps/web/src/app/(app)/settings/products/`

- **`product-family-dialog.tsx`**/**`product-variant-dialog.tsx`** (new) — reusable
  Create/Edit dialogs, each reusing the update schema as the single resolver for both
  modes (the update schema's fields are a strict optional superset of the create
  schema's).
- **`page.tsx`** — gained a Flat/Hierarchy view toggle and "Add Family"/"Add Variant"
  entry points. The hierarchy view groups SKUs under their real Family → Variant tree —
  built from the actual fetched `listProductFamilies()`/`listProductVariants()` results
  (not fabricated from a product's own narrow nested `productVariant` field, a bug
  caught and fixed during implementation — see §3), so clicking a Family/Variant header
  always opens its true current state (status, description) in the edit dialog. The flat
  table gained a "Family / Variant" column.
- **`product-dialog.tsx`** — gained a cascading Family → Variant picker, rendered only
  when editing/creating a `FINISHED_PRODUCT` (a UI convention per the brief, not a
  server-side restriction — the API accepts `productVariantId` for any product type).
  Family selection is local component state; only the resolved `productVariantId` is
  submitted. Changing the family resets the variant selection.

### Seed data

`PLANTAIN_CHIPS_FAMILY` (`FAM-000001`) with 3 variants (`VAR-000001` Sweet & Spicy—Ripe,
`VAR-000002` Green & Spicy—Unripe, `VAR-000003` Classic Salted), each with 30g/500g/1kg
SKUs (9 products total, `FINISHED_PRODUCT`/`SNACKS`), plus one BOM (`BOM-000003`) and
Production Order (`PROD-000003`, `PLANNED`) against the Sweet & Spicy 30g SKU —
demonstrating the full Family → Variant → SKU → BOM → Production Order chain without
requiring a BOM on every SKU. Idempotent — verified via two consecutive seed runs.

## 3. Testing / Verification Performed

- **Full quality gate:** `prisma validate`/`prisma format` clean; migration applied
  cleanly with no confirmation prompt; `tsc --noEmit` clean on `apps/api`,
  `packages/validation`, and `apps/web`; `eslint` clean on every new/modified file;
  `pnpm --filter @zentuva/web run build` succeeded (`/settings/products` route grew to
  reflect the new dialogs/hierarchy view).
- **Backend unit tests — 296/296 passing, zero regressions** (267 going in + 29 new):
  new `product-family.service.spec.ts`/`.controller.spec.ts` (code generation/collision,
  create-always-`ACTIVE`, status-transition validation including no-op rejection,
  tenant-scoped reads, RBAC, audit calls); new
  `product-variant.service.spec.ts`/`.controller.spec.ts` (same shape, plus rejection of
  a missing/cross-tenant `productFamilyId`, confirmation that update never touches
  `productFamilyId`, `?productFamilyId=` list filtering); extended
  `product.service.spec.ts`/`.controller.spec.ts` (valid/invalid `productVariantId` on
  create, omitting it never touches `ProductVariantRepository`, `getById`/`list` use the
  hierarchy-enriched repository methods, write-endpoint responses stay flat); one new
  regression case in `bill-of-material.service.spec.ts` proving a variant-attached
  `Product` validates in `BillOfMaterialService.create` exactly like a flat one.
- **Live verification** against the running application (Owner role, dev servers
  restarted after catching a stale-process issue — see below): confirmed
  `GET /api/product-families` and `GET /api/products?search=...` both returned the
  expected shapes, including nested `productVariantId`/`productVariant` context, before
  moving to full browser-driven verification per the brief's own 12-step checklist
  (create Family, create Variant, create/verify multiple SKUs, verify independent
  inventory identities, verify BOM/Production Order still resolve to the correct SKU,
  confirm existing production functionality is unaffected, verify Owner/Administrator/
  Member permissions, verify tenant isolation, verify mobile layout, verify zero console
  errors) — full detail in the accompanying live-verification pass, task #14.
- **Database-level verification** of the seed data and migration: direct Prisma queries
  confirmed `PRD-000001.productVariantId === null` (untouched), the full 9-SKU hierarchy
  correctly attached to its variants/family, `BOM-000003`/`PROD-000003` correctly formed
  (yield 2000, 4 components, planned 1000), and `BOM-000001`/`PROD-000001` (Sprint 4.6)
  completely unaffected by this sprint (still `ACTIVE`/`COMPLETED` from prior testing).

## 4. Bugs Found and Fixed During This Sprint

- **Seed-data global code collision.** The originally-chosen seed codes (`PRD-000020`,
  `BOM-000002`, `PROD-000002`) silently collided with pre-existing rows belonging to a
  _different_ organisation already present in the shared dev database —
  `Product.code`/`BillOfMaterial.bomNumber`/`ProductionOrder.productionOrderNumber` are
  all globally unique, not per-organisation, so the seed script's `upsert where: {code},
update: {}` found and no-op'd against that other org's row instead of creating the
  intended Boby Bites SKU. Diagnosed by querying every product/BOM/order code across all
  organisations in the dev database. Fixed by switching to verified-free codes
  (`PRD-000030`/`BOM-000003`/`PROD-000003`) and documenting the discovery mechanism
  in-code for future sprints' awareness.
- **Fabricated Family/Variant objects in the hierarchy view (caught before reaching the
  user).** An early draft of `HierarchyView` reconstructed fake `ProductFamily`/
  `ProductVariant` objects from a product's own narrow nested `productVariant` field
  (hardcoding `status: 'ACTIVE'`, `description: null`), purely to have _something_ to
  pass to the edit dialogs — this would have silently shown wrong data (e.g. an actually-
  `INACTIVE` variant always appearing `ACTIVE` in its own edit dialog). Fixed by fetching
  the real `listProductFamilies()`/`listProductVariants()` lists on the page and building
  lookup maps from them, so every edit dialog always opens with the authoritative
  fetched row.
- **Stale dev server.** After wiring the two new modules into `AppModule`, live curl
  verification initially returned `404`s and a `Product` response missing the new
  hierarchy fields, despite clean `tsc`/`eslint` — the running `nest start --watch`
  process had gone stale and wasn't picking up the file changes. Fixed by restarting the
  dev server; subsequent verification passed.

## 5. Known Limitations

- No dedicated pack-size entity — pack size stays part of the SKU's own name/definition.
- No attribute/option engine, product configurator, or e-commerce-style variant selector
  — the hierarchy is a fixed three-level tree, not a generic key/value attribute system.
- No re-parenting a `ProductVariant` to a different `ProductFamily`, and no way to detach
  a `Product` from its `ProductVariant` once attached — both would need a new endpoint/
  schema field if a real need emerges.
- No cross-family/variant aggregation query (e.g. "total Plantain Chips produced across
  every SKU") — the relational structure makes this straightforward to build later, but
  no such query/endpoint exists yet; this sprint deliberately did not build a reporting
  engine.
- Family/Variant attachment is UI-guided (only surfaced in the product dialog for
  `FINISHED_PRODUCT` type), not database-enforced — the schema and API accept
  `productVariantId` for any product type.
- BOM/Production Order/Inventory Stock continue to target the SKU (`Product`) exclusively
  — this is the sprint's central, deliberate, non-negotiable architectural boundary, not
  a limitation intended to be lifted later.

## 6. Deferred / Future Work

Per the brief's own explicit engineering rule, this sprint did not expand into Sales,
Distribution, Finance, Costing, Advanced Reporting, or Warehouse Management. The
relationships this sprint establishes are specifically structured so a future reporting
capability could compute total-stock-by-family, production-by-variant, sales-by-family,
material-consumption-by-variant, or profitability-by-SKU/variant/family without a schema
change — none of that querying exists yet. A future sprint could also add a dedicated
pack-size/packaging-size entity if the current "encoded in the SKU name" approach proves
insufficient, or allow re-parenting a variant if a real business need for it emerges;
neither is implemented today, and neither was designed around as an eventual certainty.
