# Sprint 20 Completion Report — Asset Register & Asset Management Foundation

## 1. Objective

Sprint 20 introduces **Asset** as a genuinely new, first-class top-level
domain — not a Product, not an `InventoryStock` row, not a Purchase Order —
answering the question no prior domain answers: _"what physical resources
does the business have, where are they, who's responsible for them, what
did they cost, what condition are they in, and what has happened to
them?"_ Explicitly the **foundation** a future Maintenance Management
domain will build on: no preventive/corrective maintenance, work orders,
downtime, spare-parts consumption, technician management, or maintenance
costing was implemented — only clean, documented integration points (see
`docs/domains/assets.md` §11).

## 2. Architecture Decisions

See `docs/domains/assets.md` for the full record (17 sections). Highlights:

- **Capital Project reference via a narrow, documented direct-Prisma
  reach** — `AssetRepository.findCapitalProjectRef()` reads the
  `capitalProject` table directly (read-only), rather than importing
  `FinanceModule` (which exports nothing) or widening its dependency
  graph.
- **A new, purpose-built `AssetLocation`, not a reuse of
  `InventoryLocation`** — confirmed via direct schema inspection that
  `InventoryLocation` is narrowly stock-holding-specific (every relation is
  a stock-movement table), unsuitable for general "physical place"
  modeling.
- **Lifecycle and Condition kept strictly separate fields** — `AssetStatus`
  (a real, validated state machine) never conflated with `AssetCondition`
  (a free, directly-settable field).
- **`DISPOSED`/`RETIRED` are hard-terminal**, a deliberate, documented
  deviation from this codebase's established soft-idempotent-transition
  convention — justified by the brief's own explicit "disposing an already
  disposed asset" negative-test requirement.
- **Custody via the established "plain id, no relation" convention** —
  `custodianId` follows the same pattern as `CapitalProject.ownerId`/
  `GoodsReceipt.receivedById`, resolved via the already-exported
  `UserService.listByOrganisation()`.
- **Documents/photos reuse both established file-attachment patterns** —
  Pattern A (`Product.imageUrl`/`imageKey`) for the cover photo, Pattern B
  (`OutletPhoto` shape) for the general multi-document case — both against
  the same `FileStorage` port, no new mechanism.
- **A shared `hierarchy-guard.ts` cycle-detection helper**, reused across
  `AssetCategory`/`AssetLocation`/`Asset`'s own self-referencing parent
  fields — an intra-domain helper, not a cross-domain abstraction.
- **Zero accounting integration, by construction** — proven structurally by
  `asset-independence.spec.ts`, and confirmed live (§9) with byte-identical
  before/after row counts.

## 3. Database Changes (one additive migration)

New enums: `AssetCategoryStatus`, `AssetLocationStatus`, `AssetStatus`,
`AssetCondition`, `AssetAcquisitionType`, `AssetDocumentType`,
`AssetMeterType`. New models: `AssetCategory`, `AssetLocation`, `Asset`,
`AssetDocument`, `AssetMovement`, `AssetMeter`, `AssetMeterReading` (full
field lists in `docs/domains/assets.md`). Back-relations added to
`Organisation`, `CapitalProject`, `PurchaseOrder`, `Supplier`. No changes
to any existing model's own fields. No new `SYSTEM_ACCOUNT_KEYS` — this
domain posts nothing.

## 4. API

`@Controller('assets/categories')` — `GET/POST /`, `PATCH /:id`.
`@Controller('assets/locations')` — `GET/POST /`, `PATCH /:id`.
`@Controller('assets')` — `GET/POST /`, `GET/PATCH /:id`, `POST
/:id/{activate,commission,start-maintenance,resume-service,
take-out-of-service,return-to-service,dispose,retire}`, `POST
/:id/transfer`, `GET /:id/movements`, `GET /:id/children`, `GET /:id/tree`,
`POST/DELETE /:id/image`, `GET/POST /:id/documents`, `DELETE
/:id/documents/:documentId`, `GET/POST /:id/meters`, `GET/POST
/:id/meters/:meterId/readings`, `GET /:id/audit`, `GET /custodians`.

## 5. Backend Implementation

`apps/api/src/assets/`: `hierarchy-guard.ts`, `asset-category.repository.ts`/
`.service.ts`/`.controller.ts`, `asset-location.repository.ts`/`.service.ts`/
`.controller.ts`, `asset.repository.ts`/`.service.ts`/`.controller.ts`,
`asset-document.repository.ts`/`.service.ts`, `asset-meter.repository.ts`/
`.service.ts`, `asset-audit-actions.ts`, `asset-independence.spec.ts`,
`assets.module.ts` (imports `IdentityModule`, `AuthModule`,
`FileStorageModule`, `PurchaseOrderModule`, `SupplierModule` — never
`FinanceModule`/`InventoryModule`). Registered once in `app.module.ts`, the
established one-umbrella-module-per-top-level-directory convention.
`packages/validation/src/assets.ts` (new Zod schemas, exported via
`packages/validation/src/index.ts`).

## 6. Frontend Implementation

`apps/web/src/app/(app)/settings/assets/`: `api.ts`, `labels.ts`,
`page.tsx` (Overview dashboard), `register/page.tsx` + `asset-dialog.tsx`
(list + create), `register/[id]/page.tsx` (the 9-section detail page —
Overview, Identification, Acquisition, Warranty, Hierarchy, Meter, Movement
History, Documents, Audit History), `categories/page.tsx` +
`category-dialog.tsx`, `locations/page.tsx` + `location-dialog.tsx`.
`apps/web/src/components/app/asset-tabs.tsx` (4 tabs: Overview, Assets,
Categories, Locations — deliberately lean, no separate Transfers/Reports
tab per the brief's own "do not create unnecessary tabs" instruction).

## 7. Integrations

- **Procurement** — `PurchaseOrderRepository.findById()`, read-only,
  optional `Asset.purchaseOrderId` reference.
- **Suppliers** — `SupplierRepository.findById()`, read-only, optional
  `Asset.supplierId` reference.
- **Finance / Investment (Capital Projects)** — a narrow, documented,
  read-only direct-Prisma reach into `CapitalProject` (§2), optional
  `Asset.capitalProjectId` reference — no `FinanceModule` import.
- **Identity** — `UserService.listByOrganisation()` for the custodian
  picker; `AuditService` for the audit trail.
- **File Storage** — the shared `FileStorage` port, both established
  attachment patterns reused unchanged.
- **Accounting / Inventory / Sales / Production / Distribution** — zero.
  `asset-independence.spec.ts` proves `postSystemJournalEntry` is never
  called and no forbidden table is ever written anywhere in this domain.

## 8. Tests

`hierarchy-guard.spec.ts` (6 tests — self-parent rejection, circular-chain
rejection at various depths, valid non-circular parent acceptance).
`asset.repository.spec.ts` (5 tests — code generation, idempotent create
replay, transfer atomicity). `asset-meter.repository.spec.ts` (4 tests —
reject-lower-reading validation, accept-higher-reading, idempotent replay).
`asset.service.spec.ts` (19 tests — every lifecycle transition guard
including the hard-terminal-vs-soft-idempotent split, reference validation
for category/parent/location/custodian/supplier/PO/capital-project,
transfer guards). `asset-category.service.spec.ts` /
`asset-location.service.spec.ts` (3 tests each — cross-tenant parent
rejection, hierarchy guard integration). `asset-independence.spec.ts` (6
tests — zero `postSystemJournalEntry` calls, zero writes to any
Finance/Inventory/Sales/Production/Distribution table, `capitalProject`
touched read-only only, `AssetsModule` never imports
`FinanceModule`/`InventoryModule`, only this domain's own repositories
write its own tables). **46 new tests, all passing.** Full backend suite:
**143 suites / 1197 tests, all green** (up from 136/1151 before this
sprint).

## 9. Live Verification Performed

Live against the real dev servers/database (Boby Bites seed data),
pivoting to direct `curl`-based API verification for parts of this pass
after recurring browser-session JWT expiry (a known dev-environment
quirk, not an application bug — documented previously in this session):

1. Confirmed the seeded Air Compressor (`AST-000...`, category "Utility
   Equipment," linked Supplier + Purchase Order + warranty + a 2-reading
   `AssetMeter`) renders correctly with a server-generated `assetCode`.
2. Confirmed the "Production Line A" hierarchy: `GET /assets/:id/children`
   returns exactly its 3 seeded children (Frying Machine, Conveyor,
   Packaging Machine), each with `parentAssetId` correctly pointing back
   to the parent.
3. **Transfer**: moved the Air Compressor from Utility Area to Maintenance
   Area — confirmed the asset's current `locationId` changed, an
   `AssetMovement` row was created capturing both previous and new
   location, the movement history is immutable and append-only, an audit
   event was recorded, and a replayed transfer with the same
   idempotency key returned the original result with no duplicate row.
4. **Meter reading**: confirmed recording a reading below the current
   value (4,320 → an attempted 4,000) is rejected with `400 Bad Request`;
   confirmed recording a valid higher reading succeeds and updates
   `AssetMeter.currentReading`.
5. **Warranty classification**: confirmed the Air Compressor's active
   warranty (end date in the future) renders as **Active**; confirmed by
   direct code inspection (`register/[id]/page.tsx`) that the
   Active/Expired/No-Warranty classification is a simple, unambiguous
   three-way date comparison, correctly exercised for both the Active case
   (Compressor) and the No-Warranty case (16 other seeded assets with no
   `warrantyEndDate`).
6. **RBAC**: confirmed a Member is denied (`403`) writing to
   `POST /assets/categories`, and correctly allowed (`200`) to read
   `GET /assets`.
7. **Tenant isolation**: registered a genuine second organisation ("Rival
   Foods Ltd"). Confirmed `GET /assets/:id` for a Boby Bites asset ID
   returns `404 Not Found` under the Rival org's token; confirmed `GET
/assets` for Rival returns `0` items, never leaking Boby Bites' 17
   seeded assets; confirmed `POST /assets` from Rival referencing Boby
   Bites' own `categoryId` correctly returns `400 Bad Request` ("Asset
   category not found"); confirmed the identical rejection for a
   cross-tenant `purchaseOrderId` and a cross-tenant `capitalProjectId`
   reference.
8. **Zero accounting/inventory side effects**: queried the database
   directly after all of the above create/transfer/meter-reading/RBAC/
   tenant-isolation testing. `JournalEntry` count: 48, with **0** rows
   whose `sourceType` mentions `ASSET`. `InventoryStock`: 8.
   `InventoryTransaction`: 41, with **0** rows referencing an Asset entity.
   `CashAccount`: 3. `CapitalProject`: 1. `Budget`: 3. `DebtFacility`: 1 —
   every one of these figures matches exactly what Sprint 19 left behind;
   nothing in this domain's own live testing touched any of them.
9. **Mobile responsiveness**: confirmed at 375×812 and 430×932 —
   `document.documentElement.scrollWidth === document.documentElement.
clientWidth` at both widths (no horizontal page overflow); the filter row
   on the Assets register page correctly adapts from a single stacked
   column (375px) to a two-column layout (430px); wide tables scroll
   within their own containers.

## 10. Bugs Found/Fixed

Two type errors caught by the TypeScript compiler during implementation
(not runtime bugs): `Prisma.AssetCategoryUpdateInput`/
`AssetLocationUpdateInput` (the "checked" Prisma types) don't accept raw
scalar FK fields like `parentCategoryId`/`parentLocationId` directly —
fixed by switching both repositories to the `Unchecked` update-input
variants, matching the pattern `asset.repository.ts` itself already uses
for `Asset`. One test-expectation correction during development: the
service's cross-tenant-parent rejection was changed from
`NotFoundException` to `BadRequestException` for internal consistency with
`asset.service.ts`'s own `validateReferences()` method, which already used
`BadRequestException` for every other "referenced entity not found" case.

## 11. Known Limitations

See `docs/domains/assets.md` §17 — no maintenance management of any kind
(§11 there lists the full set of future integration points), no
depreciation engine, no IoT/telemetry meter ingestion, no warranty claims
workflow, no Fixed Asset/PP&E ledger integration, no barcode/QR/RFID
scanning, no configurable-permission RBAC model.

## 12. Deferred / Future Work

The next domain this foundation exists for: **Maintenance Management**
(preventive/corrective maintenance scheduling, work orders, downtime
tracking, spare-parts consumption against Inventory, technician
assignment, maintenance costing) — every integration point it will need is
documented explicitly in `docs/domains/assets.md` §11, none built here.

## 13. Documentation Updated

New: `docs/domains/assets.md`, `docs/sprint-20-completion-report.md` (this
file). Updated: root `README.md`, `docs/backlog.md`, `docs/roadmap.md`,
`docs/changelog.md`, `docs/domains/README.md`, `docs/domains/procurement.md`,
`docs/domains/accounting.md`, `docs/domains/investment-projects.md`.

## 14. Final Quality Gate

`pnpm prisma validate` ✅ · backend lint ✅ (zero warnings) · backend
type-check ✅ · backend tests: **143 suites / 1197 tests, all passing** ·
backend build ✅ · frontend type-check ✅ · frontend lint ✅ (zero
warnings) · frontend build ✅ (`/settings/assets`,
`/settings/assets/register`, `/settings/assets/register/[id]`,
`/settings/assets/categories`, `/settings/assets/locations` all compile
and generate correctly) · seed script run twice, fully idempotent
(identical fixture counts both runs, confirmed via direct database query
after each run — 11 categories, 7 locations, 17 assets) · live browser +
API verification (§9) with a direct before/after database row-count
comparison confirming zero accounting/inventory side effects.

## 15. Constraint

Per this sprint's own explicit instruction ("DO NOT commit or push
anything"), and consistent with this session's established convention,
this work has **not** been committed or pushed — the user must explicitly
instruct "commit and push" before any git operation occurs.
