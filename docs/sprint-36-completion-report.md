# Sprint 36 Completion Report — Existing Outlet -> Collection Point Enablement

## 1. Implementation Summary

Enabled existing Zentuva `Outlet`s to optionally operate as D2C Collection
Points — a CAPABILITY of the existing Outlet, never a parallel business or
location entity. Three additive columns were added directly to `Outlet`
(`collectionPointStatus`, `collectionPointResponsibleUserId`,
`collectionPointOperatingHours`), with dedicated service methods
(`enableCollectionPoint`/`disableCollectionPoint`/
`updateCollectionPointConfig`), three new controller routes reusing the
Outlet domain's existing `sales.customer.view`/`.manage` permissions, a
Collection Point section added to the existing Outlet admin edit dialog,
a read-only indicator added to the existing Field outlet detail page, one
deterministic seeded test fixture, and comprehensive automated + live
verification. No order fulfilment, inventory deduction, consumer
selection, or settlement logic was built — that is explicitly Sprint 37's
scope. Full architectural detail lives in `docs/domains/d2c.md` §53–67;
this report focuses on what was built, tested, and live-verified.

## 2. Architecture Audit

Read end-to-end before any code was written — Outlet, Distribution
Network, Territory, Employee/Sales/Field, Inventory, Sales Order, Access
Control, Audit, and Notifications. Findings, each resolved by reuse:

- **Outlet** (Sprint 4.8): `OutletStatus` is a two-value enum;
  `activate()`/`deactivate()` use dedicated named methods over a private
  `setStatus()` helper, never a generic status mutation; `update()` is a
  conditional `updateMany` scoped to `{id, organisationId}`. All three
  conventions were reused exactly for Collection Point.
- **Permissions**: `OutletController` has no permission key of its own —
  it reuses `sales.customer.view`/`.manage`. Collection Point routes
  reuse the identical pair; zero new catalogue entries were added.
- **Distribution Network**: `DistributionNetworkRelationship` links
  `Customer` to `Customer`, never touches `Outlet`, and `SalesOrder` has
  no FK to it — confirmed no outlet-level network role needed handling.
- **Territory**: `Outlet.territoryId` already exists and was reused
  as-is — no second territory relationship was introduced.
- **Employee/Sales/Field**: no "responsible person" field exists on
  `Outlet`/`Customer` today. Two competing conventions exist elsewhere —
  a plain unenforced id (`SalesOrder.salesAgentId`, `WorkOrder
.assignedToId`) versus a real FK to `Employee` (HR's `Department
.departmentHeadEmployeeId`). The plain-id-to-`User` convention was
  chosen, since Collection Point is a Sales/Retail record, not an HR
  org-chart one.
- **Inventory**: `InventoryStock`/`InventoryTransaction` are keyed by
  `(organisationId, productId, locationId)` against a real
  `InventoryLocation` model — but it has no relationship to `Outlet` in
  either direction. Documented, not bridged (§8 below).
- **Sales Order**: Sprint 34's D2C ordering and Sprint 35's OPay payment
  are both complete and untouched.
- **Access Control / Audit**: `AccessScope`/`EffectiveAccessResolver`/
  `AuditService.record()` all reused unchanged; no new mechanism.
- **Notifications**: audited; no Collection Point notification was
  built.

## 3. Collection Point Model

**`new CollectionPoint entity = NO`.** Pattern A (additive fields
directly on `Outlet`) was used — the actual configuration surface (three
columns) is not substantial enough to justify a separate one-to-one
model (Pattern B), per the brief's own guiding principle. The model:

```prisma
enum CollectionPointStatus { ENABLED  DISABLED }

model Outlet {
  // ...existing fields, byte-for-byte unchanged...
  collectionPointStatus            CollectionPointStatus @default(DISABLED)
  collectionPointResponsibleUserId String?  // plain id -> User, no FK relation
  collectionPointOperatingHours    String?  // free text
}
```

Territory and contact information are REUSED from the existing
`Outlet.territoryId`/`.contactPersonName`/`.phoneNumber` fields — no
duplicate fields were added for either.

## 4. Configuration

Actual configuration introduced, and nothing beyond it:

| Field                              | Type                                     | Notes                              |
| ---------------------------------- | ---------------------------------------- | ---------------------------------- |
| `collectionPointStatus`            | `ENABLED`/`DISABLED`, default `DISABLED` | Mirrors `OutletStatus`'s own shape |
| `collectionPointResponsibleUserId` | optional plain id -> `User`              | Validated tenant-scoped + `ACTIVE` |
| `collectionPointOperatingHours`    | optional free text                       | e.g. "Mon-Sat 9am-6pm"             |

**Deliberately deferred** (no concrete Sprint 37 requirement exists to
design against yet, per the brief's own explicit allowance): capacity
(orders/units/storage — undecided which, so not guessed at) and eligible
products (would require either a new join table or a reused SKU
reference — deferred until a real requirement justifies the choice).
Collection contact fields were deliberately NOT added — the outlet's own
`contactPersonName`/`phoneNumber` are reused directly.

## 5. Authorization

Zero new permission catalogue entries. Every Collection Point route
reuses the exact permissions the pre-existing Outlet routes already
require:

| Route                                     | Permission              |
| ----------------------------------------- | ----------------------- |
| `GET /api/retail/outlets/representatives` | `sales.customer.view`   |
| `POST /:id/collection-point/enable`       | `sales.customer.manage` |
| `POST /:id/collection-point/disable`      | `sales.customer.manage` |
| `PATCH /:id/collection-point`             | `sales.customer.manage` |

Live-verified: unauthenticated → `401`; the seeded Member role (which
already lacks `sales.customer.view`/`.manage` on the pre-existing plain
`GET /api/retail/outlets`, confirmed identical) → `403` on every new
route too, exactly the same pre-existing behavior, not a Sprint 36
change.

## 6. Tenant Isolation

Live-verified with a genuinely second organisation (created via a real
`POST /auth/register`):

- Tenant B enabling/viewing Tenant A's outlet → `404 Outlet not found`
  (never revealing existence).
- Tenant A attempting to assign Tenant B's user as the responsible
  representative → `400 Responsible representative must be a user in
this organisation`.

## 7. Audit

Three new actions added to the existing `OUTLET_AUDIT_ACTIONS` map,
recorded via the existing `AuditService.record()`:
`outlet.collection_point_enabled`, `.collection_point_disabled`,
`.collection_point_configuration_updated` (with before/after metadata
for the latter). Live-verified: an enable→configure→disable sequence on
one outlet produced exactly three rows with correct actor/timestamp/
metadata; 5 truly concurrent enable requests against the same outlet
produced exactly ONE `outlet.collection_point_enabled` row (the four
rejected requests never reach the audit call).

## 8. Inventory Boundary

**Audited, documented, deliberately NOT bridged this sprint.**
`InventoryStock`/`InventoryTransaction` are keyed by `(organisationId,
productId, locationId)` against a real `InventoryLocation` model
(Sprint 4.5) — `SalesFulfilment.locationId` already deducts against
exactly this triple for B2B orders. `InventoryLocation` has no
relationship to `Outlet` today in either direction (confirmed by
inspecting both models and every file under `apps/api/src/inventory/`
and `apps/api/src/retail/`). The smallest bridge for Sprint 37 — an
optional `Outlet.inventoryLocationId -> InventoryLocation` FK, mirroring
`Outlet.territoryId`'s own shape — is documented in `docs/domains/d2c.md`
§59 but was NOT implemented: no schema field, no query, no deduction/
reservation/transfer/COGS/settlement logic exists anywhere in this
sprint's diff.

## 9. B2B Boundary

Confirmed unchanged by inspection of every Collection Point mutation's
own update payload: `enableCollectionPoint`/`disableCollectionPoint`/
`updateCollectionPointConfig` write only `collectionPoint*`-prefixed
fields plus `updatedById` — never `outletType`, `status`, `customerId`,
or any field touching credit terms or distributor relationships.
`DistributionNetworkRelationship` rows are untouched (Collection Point
capability lives entirely on `Outlet`, which that model never
references). Existing `OutletService.create()`/`.activate()`/
`.deactivate()` are byte-for-byte unmodified and were re-verified live
and via a dedicated regression test block asserting Collection Point
status is never touched by, and never gates, either action.

## 10. Automated Tests

|                               | Suites | Tests | Passed | Failed | Regressions |
| ----------------------------- | ------ | ----- | ------ | ------ | ----------- |
| Previous baseline (Sprint 35) | 227    | 2017  | —      | —      | —           |
| New total                     | 227    | 2040  | 2040   | 0      | 0           |

23 new tests added inside the existing `outlet.service.spec.ts` (18) and
`outlet.controller.spec.ts` (5) — no new spec files were created,
matching this sprint's "extend the existing Outlet domain, never a
parallel one" architecture. `sales-order.service.spec.ts`'s `Outlet`
fixture was extended with the three new fields (compile-time only, no
behavioural change).

## 11. Quality Checks

| Check                                   | Result                                 |
| --------------------------------------- | -------------------------------------- |
| `prisma validate`                       | Pass                                   |
| `prisma migrate status`                 | Pass — 54 migrations, up to date       |
| `pnpm exec tsc --noEmit` (API)          | Pass                                   |
| `pnpm exec eslint src --quiet` (API)    | Pass                                   |
| `pnpm exec nest build` (API)            | Pass                                   |
| `pnpm exec tsc --noEmit` (web)          | Pass                                   |
| `pnpm exec eslint` (web, changed files) | Pass                                   |
| `pnpm run build` (web)                  | Pass                                   |
| `pnpm exec jest` (API)                  | Pass — 227/227 suites, 2040/2040 tests |

## 12. Live Verification

All verified against the real dev database and a running dev server
(API + web), including a genuinely second organisation. Nothing below is
claimed without having actually been exercised.

- **Enable**: ✅ Verified via API and in a real browser (admin dialog).
  Configuration persists, an audit event is created, the outlet remains
  `ACTIVE`, and existing B2B fields are unchanged.
- **Configure**: ✅ Verified — responsible representative and operating
  hours set, page/dialog reloaded via a fresh full navigation (not just
  in-memory state), configuration confirmed still present.
- **Disable**: ✅ Verified — capability flips to `DISABLED`, configuration
  (responsible rep, operating hours) remains intact and visible on
  re-open, outlet itself remains fully intact, repeated disable safely
  rejected with `400`.
- **Existing B2B behavior**: ✅ Verified intact throughout — outlet
  name/type/customer/territory/status unchanged across every Collection
  Point mutation; a non-Collection-Point outlet's field detail page shows
  no Collection Point indicator at all.
- **Tenant isolation**: ✅ Verified — cross-tenant outlet access rejected
  `404`; cross-tenant employee/user assignment rejected `400`.
- **Authorization**: ✅ Verified — unauthenticated `401`; the seeded
  Member role `403` on every Collection Point route (confirmed as
  pre-existing Outlet-domain behavior, not a new restriction).
- **Concurrency/idempotency**: ✅ Verified — 5 truly concurrent `enable`
  HTTP requests against the same outlet: exactly one `201`, four `400
Collection Point is already enabled`, final DB state deterministically
  `ENABLED`, exactly one audit row. 5 concurrent configuration-update
  requests: all 5 succeeded, final persisted state deterministically one
  of the five supplied values, no torn/mixed state.

**Not tested live** (deferred, matching the brief's explicit Sprint 37
boundary): anything involving an actual paid `SalesOrder`, inventory, or
a real field-worker order queue, since none of that exists yet.

## 13. Documentation

- `docs/domains/d2c.md` — new §53–67 ("Sprint 36 — Existing Outlet ->
  Collection Point Enablement"): architectural decision, audit findings,
  responsible representative, configuration, authorization, eligibility,
  inventory boundary, B2B/consumer-payment boundaries, audit trail,
  disabling behavior, discovery foundation, admin/field UI, scope,
  testing.
- `docs/sprint-36-completion-report.md` — this document.
- `docs/roadmap.md` — Sprint 36 entry added.
- `docs/backlog.md` — deferred-scope list updated.
- `docs/changelog.md` — `[Sprint 36 Existing Outlet -> Collection Point
Enablement]` entry added.
- `README.md` — running narrative extended.

## 14. Scope Verification

Explicitly confirmed NOT implemented this sprint, by inspection of the
final diff: consumer Collection Point selection, order assignment,
order preparation, "ready for collection"/"collected" states, inventory
deduction, inventory reservation, inventory transfer, Collection Point
settlement, accounting settlement, a field-worker paid-order queue,
collection notifications, loyalty, rewards, and payout. All are
explicitly Sprint 37 or later.

## 15. Git State

- **Branch**: `main`
- **HEAD**: `535f729` (Sprint 35: OPay D2C Payment Integration) —
  unchanged by this sprint.
- **Commit**: **NOT MADE.**
- **Push**: **NOT MADE.**
- **Working tree**: all Sprint 36 changes (schema, migration, Outlet
  service/controller/repository extensions, validation schema, seed
  data, admin + field UI, tests, and this documentation) remain
  uncommitted on disk, per this sprint's explicit instruction.
