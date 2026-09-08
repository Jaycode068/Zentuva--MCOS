# Asset Register & Asset Management Domain

- **Status:** Foundation implemented — Sprint 20 ("Asset Register & Asset
  Management Foundation"). A genuinely new, first-class top-level domain —
  **not** a Product, **not** an `InventoryStock` row, **not** a Purchase
  Order — representing the durable physical resources the business owns,
  leases, or controls (machines, vehicles, equipment, tools). Explicitly the
  **foundation** the future Maintenance Management domain would build on:
  Sprint 20 itself implemented no preventive/corrective maintenance, work
  orders, downtime, spare-parts consumption, technician management, or
  maintenance costing — only clean, documented integration points (§11).
  **That domain has since been built** — see
  [Maintenance Management](maintenance.md) (Sprint 21). Every
  `IN_SERVICE ⇄ UNDER_MAINTENANCE` transition Maintenance needs is driven
  through this domain's own `AssetService` lifecycle methods, never a raw
  update; meter-based preventive triggers and work-order-completion meter
  readings both reuse `AssetMeter`/`AssetMeterReading` (§13) directly,
  never a second meter system.
- **Sprint:** 20
- **Depends on:** [Identity](identity.md) (tenant boundary, `RolesGuard`,
  `AuditService`, `UserService.listByOrganisation()` for the custodian
  picker), the shared `FileStorage` port (cover photo + document uploads,
  the exact `Product`/`OutletPhoto` template), Procurement
  (`PurchaseOrderRepository`, read-only), Suppliers (`SupplierRepository`,
  read-only) — both already-exported, already-small modules (ADR-002), and
  a narrow, documented, read-only direct-Prisma reach into Finance's
  `CapitalProject` table (§3).
- **Explicitly does not depend on:** [Accounting](accounting.md),
  [Finance](finance.md) (no NestJS module import — see §3),
  [Inventory](inventory.md), [Sales](sales.md), [Production](production.md),
  [Distribution](distribution.md) — proven executably by
  `asset-independence.spec.ts` (`apps/api/src/assets/`), not just documented
  here.
- **See also:** [Procurement](procurement.md), [Accounting](accounting.md),
  [Investment / Capital Projects](investment-projects.md),
  [Maintenance Management](maintenance.md),
  [Sprint 20 Completion Report](../sprint-20-completion-report.md).

## 1. Business Purpose

Every prior domain in Zentuva answers a transactional question — what was
ordered, produced, sold, shipped. None of them answer the one question
management actually asks about the physical things the business owns day to
day: _"what do we have, where is it, who's responsible for it, what did it
cost, what condition is it in, and what has happened to it?"_ An Asset is a
durable resource with its own lifecycle, even when it was acquired through
Procurement or a Capital Project — the frying machine, the delivery van, the
office generator keep existing, keep being used, and keep changing hands
and condition long after the purchase order that brought them in has been
paid and closed.

```
Asset Category (tenant-defined, hierarchical)
        │
        ▼
     Asset ──parentAssetId──▶ (self-referencing hierarchy, cycle-guarded)
        │
        ├── Location (AssetLocation, hierarchical — Site → Area)
        ├── Custodian (plain User reference, no new HR infrastructure)
        ├── Acquisition (optional Supplier / Purchase Order / Capital
        │                 Project references — read-only, never duplicated)
        ├── Warranty (Active / Expired / No Warranty — classification only)
        ├── Movement History (AssetMovement — immutable, insert-only)
        ├── Meter (AssetMeter + AssetMeterReading — cumulative, foundation only)
        ├── Documents (AssetDocument — invoices, manuals, certificates, photos)
        └── (future) Maintenance Management — see §11
```

## 2. Critical Architectural Principle — Registration Is Not Accounting

Creating, updating, transitioning, transferring, or recording a meter
reading against an `Asset` **never** calls `postSystemJournalEntry` and
**never** writes to any Finance, Inventory, Sales, Production, or
Distribution table — proven structurally by `asset-independence.spec.ts`,
not just documented here. Registering an asset records that the business
owns/controls a durable resource; it does not, by itself, represent a
financial event. The actual purchase already flows through the _existing_
Procurement → Goods Receipt → Supplier Invoice → Payment chain and its own
existing accounting postings (or, for a capital-project-funded asset,
through the _existing_ Investment/Capital Project chain) — this domain only
optionally _references_ those chains' own records, read-only, never
duplicating or re-deriving their figures.

"Total Acquisition Value" on the Asset Overview dashboard is explicitly the
**sum of recorded acquisition costs** across assets — never labeled or
treated as an accounting balance, and never reconciled against the General
Ledger. It is a planning/inventory-of-things figure, the same restraint
Sprint 18's Capital Project "Planned Cost" and Sprint 16's Budget CAPEX
lines already established for non-GL-tied totals.

## 3. Capital Project Reference — a Narrow, Documented Direct-Prisma Reach

`Asset.capitalProjectId` carries a real Prisma `@relation(onDelete:
SetNull)` to `CapitalProject` — a pure database-level construct, entirely
independent of NestJS module wiring. `FinanceModule` exports nothing at all
(no `exports:` array), so importing it just to validate/read one optional
reference would either require adding an export to an unrelated module for
a single read, or pulling in Finance's entire provider graph for a lean new
domain — both rejected. Instead, `AssetRepository.findCapitalProjectRef()`
reads the `capitalProject` table directly via
`this.prisma.capitalProject.findFirst({ where: { id, organisationId },
select: { id, projectCode, name } })` — read-only, never a write — the same
narrow, documented exception Sprint 13's `InventoryValuationService`
already established for `InventoryStock` and Sprint 11's
`SupplierReturnRepository` already established for `GoodsReceiptItem`.
`asset-independence.spec.ts` asserts `capitalProject.findFirst(` is present
but no `capitalProject.(create|update|delete)(` ever appears anywhere in
this domain, and that `AssetsModule` never imports `FinanceModule`.

## 4. Asset Category — Tenant-Scoped, Hierarchical, Never Hard-Coded

`AssetCategory` is ordinary tenant master data — no fixed enum, no seeded
"system" categories a user cannot rename or add to. Self-referencing
`parentCategoryId` supports a shallow taxonomy (e.g. "Production Machinery"
→ "Packaging Equipment"), guarded against self-reference and circular
hierarchies by a shared `assertNoHierarchyCycle` helper (§7).
Deactivate-never-delete (`AssetCategoryStatus`), the same convention
`CostCentre`/`InventoryLocation` already use for master data.

## 5. Asset Identity — Server Code vs. User Tag

`assetCode` is always server-generated (`AST-000001`, `AST-000002`, ...),
unique and immutable per organisation — the exact `generateProjectCode`/
`formatProjectCode` linear-probe-inside-`$transaction` template Sprint 18's
`CapitalProjectRepository` already established, concurrency-safe.
`assetTag` is a separate, optional, user-defined field (e.g.
`BB-PROD-001`) for whatever physical labeling scheme the business already
uses — `@@unique([organisationId, assetTag])`, where Postgres's
multiple-`NULL`s-allowed semantics make the constraint a no-op until a tag
is actually set (the same `ChartOfAccount.systemKey` precedent).

## 6. Lifecycle vs. Condition — Two Deliberately Separate Fields

A single field cannot represent both "where is this asset in its
operational lifecycle" and "what physical shape is it in" — an asset can be
`ACTIVE` and in `POOR` condition, or `UNDER_MAINTENANCE` and still `GOOD`.
Zentuva keeps them strictly separate:

- **`AssetStatus`** (a real, validated state machine): `DRAFT → ACTIVE →
IN_SERVICE`, `IN_SERVICE ⇄ UNDER_MAINTENANCE`, `IN_SERVICE ⇄
OUT_OF_SERVICE`, and `ACTIVE`/`IN_SERVICE`/`UNDER_MAINTENANCE`/
  `OUT_OF_SERVICE → DISPOSED`/`RETIRED` (both terminal).
- **`AssetCondition`** (`NEW`/`GOOD`/`FAIR`/`POOR`/`CRITICAL`) — a free,
  directly-settable field, not part of the transition graph, defaulting to
  `NEW` at registration and updatable on any write.

```
DRAFT ──activate──▶ ACTIVE ──commission──▶ IN_SERVICE ⇄ UNDER_MAINTENANCE
                                                │  ⇄ OUT_OF_SERVICE
                                                │
                          ACTIVE / IN_SERVICE / UNDER_MAINTENANCE / OUT_OF_SERVICE
                                                │
                                    dispose ──▶ DISPOSED (terminal)
                                    retire  ──▶ RETIRED  (terminal)
```

**`DISPOSED`/`RETIRED` are hard-terminal** — a deliberate deviation from
this codebase's established Sprint 17-19 soft-idempotent-transition
convention. Every other Finance/Investment lifecycle treats a repeat call
into the current status as a no-op success (idempotent replay); here, any
further transition attempt on an already-`DISPOSED`/`RETIRED` asset —
including a second `dispose()`/`retire()` call — throws `BadRequestException`.
This is intentional: an asset that has left the fleet cannot be silently
"disposed again" or reactivated by a stale retry, and the distinction is
covered by a dedicated negative test. Every non-terminal transition keeps
the established soft idempotency: calling `commission()` on an
already-`IN_SERVICE` asset returns it unchanged, no error, no duplicate
audit event.

## 7. Hierarchy — Self-Referencing, Cycle-Guarded

`Asset.parentAssetId` supports composite/component structures (e.g. a
"Production Line A" parent with "Frying Machine"/"Conveyor"/"Packaging
Machine" children). A shared `assertNoHierarchyCycle` helper
(`apps/api/src/assets/hierarchy-guard.ts`) rejects self-parenting and walks
the candidate parent's own ancestor chain to reject any circular reference
— enforced at the service layer (Prisma/Postgres cannot express "no cycles"
declaratively). The identical helper is reused, unmodified, for
`AssetCategory.parentCategoryId` and `AssetLocation.parentLocationId` — an
intra-domain shared helper, not a cross-domain abstraction, since the exact
same algorithm is needed three times within this one new domain.

## 8. Location — a New, Purpose-Built Model, Not a Reuse of `InventoryLocation`

Direct schema inspection confirmed `InventoryLocation` is narrowly
stock-holding-specific — every one of its relations (Goods Receipt,
Inventory Stock/Transaction, Production Order, Sales Fulfilment, Dispatch,
Customer/Supplier Return) is a stock-movement table, with no hierarchy
field and no site/area distinction. Widening an 8-relation table three
other domains already depend on, just so Assets could borrow it, was
rejected in favor of a new, purpose-built `AssetLocation` — the same "each
domain owns its own small place/org-unit concept" pattern `CostCentre`
(Finance) and `Territory`/`Outlet` (Retail) already establish. Self-referencing
`parentLocationId` supports a Site → Area hierarchy (e.g. "Ibadan Factory"
→ "Production Hall"), cycle-guarded by the same helper as §7.

## 9. Custody — Distinct From Location, No New HR Infrastructure

`Asset.custodianId` is a plain `String?` column with **no Prisma relation**
to `User` — confirmed via direct code inspection to be a genuinely
universal codebase convention (60+ occurrences: `CapitalProject.ownerId`,
`GoodsReceipt.receivedById`, `Budget.approvedById`, and more), never a real
foreign key. Resolved at the service layer via the already-exported
`UserService.listByOrganisation()` — a new `GET /assets/custodians`
endpoint wraps it, giving the frontend a genuine name-based picker rather
than requiring a raw ID. No new Employee/HR model was introduced — none
exists anywhere in this codebase, and this domain does not need one.

## 10. Movement — Immutable History, One Action Covers Both Dimensions

`AssetMovement` is insert-only (no update or delete anywhere in this
domain). A single `POST /assets/:id/transfer` endpoint accepts an optional
new location and/or new custodian; inside one transaction it reads the
asset's _current_ location/custodian as "previous," updates the `Asset`
row to the new values, and inserts one `AssetMovement` row capturing both
previous and new state for both dimensions — even when only one actually
changed, simpler than modeling two separate movement "types." Rejected for
`DISPOSED`/`RETIRED` assets (hard-terminal, §6). Idempotency-checked first,
inside the same transaction, the Sprint 9/10 lesson applied here as
everywhere else in this codebase.

## 11. Integration Points for the Maintenance Domain

Sprint 20 deliberately implemented **none** of the following, but left
each one a clean, obvious extension point on top of what already existed
— **all now realized by Sprint 21, see [Maintenance Management](maintenance.md):**

- **Preventive/corrective maintenance scheduling** — `AssetStatus` already
  has `UNDER_MAINTENANCE`; a future Maintenance domain would drive that
  transition, not redefine it.
- **Work orders** — would reference `Asset.id` directly; no polymorphic
  indirection needed.
- **Downtime tracking** — would read `AssetMovement`/status-transition
  history as its starting timeline.
- **Spare-parts consumption** — a future integration with Inventory,
  entirely outside this domain's own boundary (§2).
- **Technician/vendor assignment** — would follow the exact `custodianId`
  plain-reference convention (§9), not a new HR model.
- **Maintenance costing/depreciation** — Sprint 20 captures
  `acquisitionCost`/`usefulLifeMonths`/`salvageValue` as raw inputs only
  (§12) — no depreciation schedule, no fake depreciation values are ever
  computed or displayed.
- **Meter-driven maintenance triggers** (e.g. "service every 500 hours") —
  `AssetMeter`/`AssetMeterReading` (§13) already capture the cumulative
  reading history a future rule engine would read from.
- **Warranty claims management** — §14 captures only Active/Expired/None
  classification; a claims workflow is explicit future work.
- **Document/photo attachments for maintenance records** — `AssetDocument`
  (§15) already supports arbitrary document types; a maintenance record
  would simply add its own.
- **Audit trail for maintenance events** — `ASSET_AUDIT_ACTIONS` already
  follows the `<entity>.<event>` convention every other domain's audit
  actions use; a future `MAINTENANCE_AUDIT_ACTIONS` would sit alongside it,
  not replace it.
- **RBAC for maintenance-specific roles** (e.g. "Technician") — deferred
  along with every other domain's own RBAC model in this codebase (no new
  roles exist anywhere yet); Asset's own permission checks are designed so
  a future role can be added without restructuring.
- **Cost-centre/GL posting for maintenance spend** — explicitly out of
  scope; would flow through the existing accounting boundary (§2), never a
  new posting mechanism invented inside Assets.

## 12. Acquisition & Valuation — Foundation Only, No Depreciation Engine

`acquisitionType` (`PURCHASE`/`CAPITAL_PROJECT`/`TRANSFER`/`DONATION`/
`LEASE`/`OTHER`), `acquisitionDate`, `acquisitionCost`, `currency`, and
optional read-only references to `supplierId`/`purchaseOrderId`/
`capitalProjectId` (§3) are captured as plain facts — never duplicating
those referenced entities' own data (no line-item copy, no re-derived
total). `usefulLifeMonths`/`salvageValue` are captured as raw planning
inputs a future depreciation engine could consume — **no depreciation
schedule is computed, stored, or displayed anywhere in Sprint 20**. No new
`SYSTEM_ACCOUNT_KEYS` were added — this domain posts nothing (§2).

## 13. Meter / Reading — a Lightweight Foundation, Not IoT

`AssetMeter` (`meterType`: `HOURS`/`KILOMETERS`/`CYCLES`/`UNITS`/`OTHER`,
`unit`, `currentReading`) supports more than one _different_ meter type per
asset (e.g. a vehicle with both `KILOMETERS` and `HOURS`) but never two of
the same type (`@@unique([assetId, meterType])`). `AssetMeterReading` is
the immutable log. Recording a reading rejects a value lower than the
meter's own current reading — meters are cumulative — inside the same
transaction that also updates `AssetMeter.currentReading`/
`lastReadingDate`. No live device integration, no telemetry ingestion —
readings are entered manually, a deliberate foundation-only scope.

## 14. Warranty — Classification Only, No Claims Management

`warrantyStartDate`/`warrantyEndDate`/`warrantyProvider`/
`warrantyReference`/`warrantyNotes` are plain fields. Warranty status is a
simple three-way classification computed from `warrantyEndDate` alone: **No
Warranty** (no end date set), **Active** (end date on or after today), or
**Expired** (end date before today) — no claims workflow, no
provider-integration, no automated renewal.

## 15. Documents & Photos — the Existing File Architecture, Reused Twice

Two established patterns, never a new one invented, both against the
shared `FileStorage` port (`FILE_STORAGE` DI token,
`apps/api/src/identity/organisation/ports/file-storage.port.ts`):

- **Pattern A** (single-file scalar pair): `Asset.imageUrl`/`imageKey` — the
  cover photo, via the exact `Product.setImage()`/`removeImage()` +
  `POST/DELETE :id/image` `FileInterceptor` template, surfaced in the
  frontend via the shared `ImageUploadCard` component.
- **Pattern B** (dedicated one-row-per-file child table): `AssetDocument`
  (`documentType`: `PHOTO`/`INVOICE`/`WARRANTY_DOCUMENT`/`MANUAL`/
  `CERTIFICATE`/`REGISTRATION`/`OTHER`) — the exact `OutletPhoto` shape, for
  the general multi-file case (invoices, manuals, certificates, extra
  photos).

## 16. RBAC / Tenant Isolation / Idempotency / Audit

Identical binary convention to every other domain in this codebase: any
authenticated organisation member can read; `RolesGuard`+`Roles('Owner',
'Administrator')` gates every write (create/update/every lifecycle
transition/transfer/meter reading/document add-remove/category+location
CRUD) — confirmed via an exhaustive grep of every `@Roles(...)` call site
across 49 controllers returning exactly this one signature, no exceptions
anywhere; zero new roles were introduced. Every query is scoped by
`organisationId` from the JWT, inherited automatically like every other
endpoint in this codebase. `Asset.create()`/`AssetMovement`
creation/`AssetMeterReading` creation are idempotency-check-first inside
their own transaction (the Sprint 9/10 lesson); `AssetCategory`/
`AssetLocation` (lightweight master data) instead rely on catching a
Prisma unique-constraint violation, the `CostCentreRepository.create()`
precedent. `ASSET_AUDIT_ACTIONS` follows the `<entity>.<event>` convention
every other domain's audit actions use.

## 17. Known Limitations / Non-Goals

- **No maintenance management of any kind** — see §11 for the full,
  explicit list of what a future Maintenance domain would add.
- **No depreciation engine** — `usefulLifeMonths`/`salvageValue` are raw
  inputs only; no depreciation schedule is ever computed or displayed.
- **No IoT/telemetry meter ingestion** — meter readings are entered
  manually.
- **No warranty claims workflow** — classification (Active/Expired/None)
  only.
- **No Fixed Asset / PP&E ledger integration** — registering an asset never
  posts a Journal Entry (§2); a future Fixed-Asset accounting module would
  be a deliberate, separate integration decision, not an automatic
  consequence of this foundation existing.
- **No barcode/QR/RFID scanning** — `assetTag` is a plain text field a
  business can print its own labels against; no scanning UI is built.
- **No configurable-permission RBAC model** — the same deferred decision as
  every prior sprint in this codebase.
