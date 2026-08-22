# Outlet Domain

- **Status:** Foundation implemented — Sprint 4.8 ("Customer, Territory, Outlet, Retail
  Network & Sales Foundation").
- **Sprint:** 4.8
- **Depends on:** [Identity](identity.md) (tenant boundary, `RolesGuard`),
  [Customers](customers.md) (an outlet always belongs to exactly one customer),
  [Territories](territories.md) (optional).
- **See also:** [Retail Network](retail-network.md), [Sales](sales.md),
  [Sprint 4.8 Completion Report](../sprint-4.8-completion-report.md).

## 1. Business Purpose — Customer ≠ Outlet

A `Customer` is the commercial account/relationship; an `Outlet` is a physical place
where that business operates. Example: Customer "Bodija Supermart Ltd" may have outlets
"Bodija Supermart — Bodija Branch," "— Challenge Branch," "— Ring Road Branch." A
customer may have zero outlets (a corporate account with no storefront, or one just
onboarded), one, or many. Creating a customer never requires creating an outlet.

## 2. Key Concepts / Entities

### Outlet

- **Ownership:** owned by `apps/api/src/retail/outlet/`.
- **Tenant scoping:** every `Outlet` belongs to exactly one `Organisation`.
- **Relationship to Customer:** `customerId` is required at creation and **immutable
  after creation** (service-enforced) — moving an outlet to a different customer would
  rewrite which account every past `SalesOrder` attributed the outlet to.

**Fields:**

| Field                                                      | Notes                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Outlet Code (`outletCode`)                                 | Auto-generated (`OUT-000001`, ...), globally unique, immutable.                                                                                                                                                                                                                                                                                           |
| Outlet Type (`outletType`)                                 | `SUPERMARKET`/`HYPERMARKET`/`WHOLESALE_STORE`/`RETAIL_SHOP`/`KIOSK`/`MARKET_STALL`/`DISTRIBUTOR_WAREHOUSE`/`WHOLESALER_WAREHOUSE`/`CONVENIENCE_STORE`/`RESTAURANT`/`HOTEL`/`CORPORATE`/`INSTITUTION`/`OTHER`. Deliberately extensible — no business logic anywhere is keyed on a specific value, so adding a new type later is a pure additive migration. |
| Name, Contact Person, Phone, Address, City, State, Country | All optional except Name.                                                                                                                                                                                                                                                                                                                                 |
| Territory (`territoryId`)                                  | Optional — see [territories.md](territories.md).                                                                                                                                                                                                                                                                                                          |
| Coordinates (`latitude`/`longitude`)                       | Optional, both-or-neither. Captured once via the browser's one-shot geolocation (`apps/web/src/lib/geolocation.ts`'s `captureCoordinates`) if the agent grants permission — **never required at onboarding, and there is no continuous location tracking anywhere in this codebase** (`getCurrentPosition`, never `watchPosition`).                       |
| Status (`status`)                                          | `ACTIVE`/`INACTIVE`.                                                                                                                                                                                                                                                                                                                                      |

### OutletPhoto

The first multi-file-per-entity model in this codebase. Every prior single-image case
(`Product.imageUrl`, `Organisation.logoUrl`, `User.avatarUrl`) is one string column on the
owning row — that shape cannot express "front, signage, interior, shelf display" for one
outlet.

**Design decision:** the existing `FileStorage` port
(`apps/api/src/identity/organisation/ports/file-storage.port.ts`) is **left completely
unmodified** — it is deliberately one-file-in/one-file-out, matching every existing
adapter and keeping the future S3 swap path intact. `OutletService.addPhotos` calls the
existing `upload()` once per file and writes one new `OutletPhoto` row per result; there
is no batch upload primitive added to the port itself.

- `photoType` (optional): `FRONT`/`SIGNAGE`/`INTERIOR`/`SHELF_DISPLAY`/`OTHER` — a
  descriptive label only, purely for organising the Admin/Field UI. **No image analysis
  of any kind happens anywhere** — this sprint's scope is capture + store + associate
  only, per the brief's explicit "do not build AI image recognition."
- `caption` (optional free text).
- `onDelete: Cascade` from `Outlet` — a true child of the aggregate with no independent
  meaning.
- Removing a photo (`DELETE /:id/photos/:photoId`) deletes the DB row and best-effort
  deletes the underlying stored file (`fileStorage.delete(key).catch(() => undefined)`) —
  same "never let a storage failure block the request" convention as every other
  file-replace path in this codebase.

## 3. Workflows

- **Add an Outlet** — `POST /api/retail/outlets` (Owner/Administrator only). Requires
  `customerId`, `outletType`, `name`; everything else optional.
- **Edit an Outlet** — `PATCH /api/retail/outlets/:id`. `customerId`/`outletCode` never
  accepted.
- **Activate/Deactivate** — `POST /:id/activate`, `POST /:id/deactivate`.
- **Add Photos** — `POST /api/retail/outlets/:id/photos` (multipart, field name `files`,
  up to 6 per request, each validated by the existing `assertValidImageFile`).
- **Remove a Photo** — `DELETE /api/retail/outlets/:id/photos/:photoId`. The sole
  `DELETE` in this sprint's API surface — a photo is disposable media with a real storage
  cost, not a business record, unlike every other entity here (deactivate-only).
- **Field Sales**: Add Outlet → Select Customer (preselected if arriving from a
  customer's own detail page) → Outlet Type → Name → Territory if known → optional
  "Capture Location" (denial-tolerant — the form still submits if location isn't
  captured) → optional photo(s), uploaded immediately after the outlet is created (an
  upload endpoint needs the outlet's id, which doesn't exist until the create round-trips
  — same reasoning as the Product Catalogue's own image-upload timing) → Save.
- **Admin**: `settings/retail` Outlets tab — table on desktop, cards on mobile widths;
  create/edit dialog includes a photo-management panel (`MultiImageUploadCard`) in edit
  mode.

## 4. RBAC / Tenant Isolation / Audit

Same conventions as [customers.md](customers.md) — `RolesGuard`, Owner/Administrator
write, Member read, tenant-scoped repository methods. Audit events:
`outlet.created`, `outlet.updated`, `outlet.activated`, `outlet.deactivated`,
`outlet.photo_added` (fired once per request with a `count` in its metadata, not once per
file), `outlet.photo_removed`.

## 5. API Reference

| Endpoint                                         | Auth                | Notes                                                   |
| ------------------------------------------------ | ------------------- | ------------------------------------------------------- |
| `GET /api/retail/outlets`                        | Any authenticated   | `?status=&outletType=&customerId=&territoryId=&search=` |
| `GET /api/retail/outlets/:id`                    | Any authenticated   | Includes `photos[]`                                     |
| `POST /api/retail/outlets`                       | Owner/Administrator |                                                         |
| `PATCH /api/retail/outlets/:id`                  | Owner/Administrator | `customerId` immutable                                  |
| `POST /api/retail/outlets/:id/activate`          | Owner/Administrator |                                                         |
| `POST /api/retail/outlets/:id/deactivate`        | Owner/Administrator |                                                         |
| `POST /api/retail/outlets/:id/photos`            | Owner/Administrator | Multipart, field `files`, ≤6                            |
| `DELETE /api/retail/outlets/:id/photos/:photoId` | Owner/Administrator | The one `DELETE` in this sprint                         |

## 6. Known Limitations

- No dedicated pack-size-style structured location model — an outlet's address fields
  are plain free text.
- No GIS, polygons, geofencing, or route optimisation — coordinates are a bare lat/lng
  pair, nothing more.
- No continuous location tracking of any kind.
- No AI/ML image analysis of outlet photographs — capture/store/associate only.
- No photo reordering or "primary photo" concept — photos are shown in upload order.
- Outlet photos are not seeded (binary fixtures aren't idempotent and would pollute the
  local uploads directory on every re-seed) — exercised live in verification instead.
