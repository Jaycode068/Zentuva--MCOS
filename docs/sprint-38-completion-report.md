# Sprint 38 Completion Report — Field Operations & Collection Point Mobile Experience

## 1. Objective

Turn the D2C backend capability already built across Sprints 32–37.1 into a
practical, mobile-first field-operations workflow — an operations/UX sprint,
not a new D2C business-domain implementation. Give Collection Point
representatives a usable mobile screen to see, prepare, and collect assigned
orders, and give Sales Representatives a territory-scoped view of D2C
activity to monitor and escalate. No parallel CollectionPoint/order/
inventory/Field-Employee/Territory system; no frontend-only authorization;
every mutation remains server-authorized through the existing Sprint 37
services.

## 2. Existing Architecture Audited

Before writing any code, read end-to-end:

- **Existing Field module** (`apps/web/src/app/(field)/field/`): routes for
  customers/outlets/orders/deliveries/collection-point. Discovered its own
  strong convention — Field pages have no backend-calling code of their
  own; `field/api.ts` re-exports from the shared `settings/*/api.ts`
  modules (one API client per backend domain, reused by both Admin and
  Field surfaces). Mirrored for the one genuinely Field-only API this
  sprint needed (`field/d2c/api.ts`), since no `/settings/d2c/field-overview`
  admin screen exists or was wanted (brief §21: keep Admin minimal).
- **Sales Rep territory/ownership scoping**: `SalesOrderController.list`
  is the ONE existing example of real per-user scoping (`OWN_TEAM`/
  `OWN_RECORDS` via `EffectiveAccessResolver`/`ScopeEvaluator`), gated by
  `salesAgentId` — a B2B concept that does not apply to D2C orders (which
  have `consumerId`, never `salesAgentId`). `CustomerController`/
  `OutletController` list endpoints, by contrast, apply NO server-side
  scoping at all beyond the permission check.
- **Employee ↔ Territory ↔ User relationship**: read the full `Employee`,
  `User`, and `Territory` Prisma models directly. **Confirmed: no
  `territoryId` on `Employee`, no territory relation on `User`, and no
  join/assignment table anywhere linking a person to a `Territory`.**
  `Territory` is purely a tagging attribute of `Customer`/`Outlet`/
  `Consumer`. The only existing per-person "ownership" field in this
  domain is `Outlet.collectionPointResponsibleUserId` (Sprint 36/37) — a
  plain id, not a territory concept.
- **Permission catalogue**: `sales.order.view`/`sales.customer.view`/
  `d2c.consumer.view`/`d2c.consumer.manage`/`d2c.collection_point.view`/
  `d2c.collection_point.fulfil` — all already exist. No genuine
  authorization gap was found that would justify a new permission pair.
- **`AccessScope` enforcement**: confirmed (again) that `ASSIGNED_TERRITORY`
  is recorded at grant time but never enforced anywhere in this codebase —
  the one working per-person restriction (Collection Point ownership) is a
  bespoke resource-ownership check inside `CollectionPointFulfillmentService`,
  not `AccessScope` at all. This sprint's own territory scoping follows the
  identical bespoke-check pattern, for the same reason: no generic
  mechanism exists to delegate to.
- **Notification infrastructure**: re-confirmed `Notification` targets only
  a `User` (never a `Consumer`), and the Conversation Layer has no
  proactive/outbound capability — unchanged since Sprint 37's own audit.
- **DTO/response conventions**: every Field-facing GET list endpoint
  returns `{ items: [...] }` via a bottom-of-file mapper function; single-
  resource `GET :id` returns the mapped object directly. Followed exactly.
- **`CollectionPointFulfillmentRepository`/`.service.ts`/`.controller.ts`**
  (Sprint 37): read in full to confirm the exact current shape of
  `RELATIONS_INCLUDE`, `CollectionPointFulfillmentResult`, and every
  existing authorization check (`assertAuthorized`/
  `assertActorAuthorizedForOutlet`) before extending any of them.
- **Sprint 37.1's atomic inventory primitives**
  (`inventory-stock-concurrency.util.ts`): confirmed the new Collection
  Point inventory view reads via the EXISTING
  `InventoryStockRepository.findManyByProductsAndLocation` — the same
  primitive `SalesFulfilmentService.getAvailability` already uses — never
  a new stock-reading mechanism, and never a write.

## 3. Implementation

**Backend — the one genuine gap found and closed**: `Employee.territoryId`
(nullable FK to `Territory`, `onDelete: SetNull`) — a new migration
(`20261002090000_sprint38_employee_territory`), the exact
`Customer.territoryId`/`Outlet.territoryId` shape, never a new generic
Territory-assignment entity. A dedicated `assignTerritory` method
(`EmployeeRepository`/`EmployeeService`/`POST /hr/employees/:id/territory`)
mirrors the existing `assignDepartment`/`assignPosition`/`assignManager`/
`assignWorkSchedule` shape exactly, including its own audit action
(`hr.employee.territory_assigned`). Existence validation is a direct,
read-only, `organisationId`-scoped Prisma query inside `EmployeeRepository`
— not an injected `TerritoryRepository` — because `HrModule` deliberately
imports no other domain's module (`hr-independence.spec.ts`'s own
structural guard), and this sprint's fix was designed to preserve that
boundary rather than punch a hole in it.

**Backend — the new read-only overview layer**: `FieldD2COverviewService`/
`Controller` (`apps/api/src/d2c/field-overview/`), composing EXISTING
repositories — `SalesOrderRepository` (extended with `source`/
`consumerTerritoryId` filter params on its existing `findManyByOrganisation`),
`CollectionPointFulfillmentRepository` (extended with a new batch
`findManyBySalesOrderIds` lookup, and exported from its module for the
first time), `OutletRepository` (whose `territoryId` filter already
existed, unused until now). No new table, no new domain service with
business logic.

**Backend — Collection Point representative enrichment**: `CollectionPoint
FulfillmentRepository`'s `RELATIONS_INCLUDE` widened to also fetch
`SalesOrder.payments` (status/paymentDate) and `Consumer.territoryId`/
`.territory.name` — both already-existing relations, no schema change.
`CollectionPointFulfillmentResult`/`toResult()` extended with
`paymentStatus`/`paidAt`/`consumer.territoryName`. A new
`getInventoryViewForOutlet` method on the same service, using the exact
same `assertActorAuthorizedForOutlet` ownership check `getQueueForOutlet`
already uses, and a new `GET outlet/:outletId/inventory` route on the
existing controller.

**Frontend**: the existing `/field/collection-point` screen gained a Today
dashboard, an Attention Required section, and a compact inventory view
(all computed/rendered from data the two existing+one-new GET endpoints
already return); a new order detail page (`/field/collection-point/[id]`)
with a confirmation dialog before Confirm Collection; a new Sales Rep
overview page (`/field/d2c`) and its own thin API client
(`field/d2c/api.ts`); a conditional "D2C Activity" banner link added to the
existing Field home page, alongside the existing Sprint 37 "Collection
Point" banner.

## 4. APIs

New:

```
POST   /hr/employees/:id/territory                                    (existing EmployeeController, new route)
GET    /d2c/field-overview/orders                                      (new FieldD2COverviewController)
GET    /d2c/field-overview/collection-points                           (new FieldD2COverviewController)
GET    /d2c/collection-point-fulfillments/outlet/:outletId/inventory   (existing CollectionPointFulfillmentController, new route)
```

Extended (response shape only, no breaking change): `GET /d2c/collection-
point-fulfillments/:id` and the `outlet/:outletId` queue endpoint now also
return `paymentStatus`, `paidAt`, and `consumer.territoryName`.

No duplicate endpoints — the brief's own suggested `POST
/field/d2c/orders/:id/prepare`/`ready`/`collect` were explicitly NOT built;
the existing Sprint 37 `POST :id/start-preparing`/`ready-for-collection`/
`confirm-collection` routes already satisfy the requirement and are reused
directly by both the Collection Point rep's queue AND its new detail page.

## 5. Field UX

Mobile-first (375px verified, no horizontal scroll), following the brief's
own operational principle ("what do I need to do next," not "here is a lot
of data"): large touch targets (44px+ buttons), a sticky action bar on the
order detail page (reusing the existing `FieldStickyActionBar` component),
a confirmation dialog before the one irreversible action, clear loading/
empty states (unchanged from Sprint 37's own conventions, extended to the
new pages), and a plain error message on any backend rejection — never a
faked success. No charts, no analytics, no configuration screens.

## 6. Collection Point Representative Experience

`/field/collection-point`: Today dashboard (Preparing/Ready for
Collection/Collected-today counts), Attention Required (orders awaiting
preparation, orders waiting over a documented 30-minute UI-only threshold,
inventory shortages — all computed client-side from already-authorized
data), a compact inventory view (available/required/shortfall per
product), and the existing status-grouped queue, each card now linking to
`/field/collection-point/[id]` for the full order detail — consumer name/
phone/territory, items, payment status, order status, every relevant
timestamp, and exactly the one action valid for the order's current state.

## 7. Sales Representative Experience

`/field/d2c`: a territory-scoped read-only overview — D2C orders (code,
consumer, territory, Collection Point assignment and status) and Collection
Points (status, territory, operating hours, orders awaiting/ready counts)
within the rep's own `Employee.territoryId`, plus an Attention section
(orders without a Collection Point assigned, a disabled Collection Point
still holding queued orders). No mutation lives here — a Sales Rep monitors
and would intervene by contacting the Collection Point rep or an admin, not
by operating the queue themselves.

## 8. Authorization / Scoping

- **Collection Point ownership** (Sprint 37, unchanged): still enforced by
  `assertAuthorized`/`assertActorAuthorizedForOutlet` — reused as-is for
  the new inventory-view endpoint.
- **Field D2C territory scope** (new): a bespoke server-side check inside
  `FieldD2COverviewService` — admin (`isOwnerBypass`/
  `sales.customer.manage`) sees every territory; anyone else sees only
  their own `Employee.territoryId`'s data; no territory or no `Employee`
  record at all → empty result, deny-by-default, never falls back to
  unrestricted.
- Live-verified: see §12.

## 9. Inventory Integration

No new inventory mutation anywhere in this sprint — the Collection Point
inventory view is READ-ONLY, using the exact Sprint 37.1-hardened
`InventoryStockRepository.findManyByProductsAndLocation` primitive. A
structural guard in `collection-point-fulfillment-independence.spec.ts` was
updated to explicitly confirm no write method is ever called through the
newly-injected `InventoryStockRepository` dependency. The actual inventory
DEDUCTION remains exclusively `SalesFulfilmentService.fulfil()`, called
only from `confirmCollection()`, untouched by this sprint.

## 10. Audit / Notification Integration

`hr.employee.territory_assigned` added to the existing `HR_AUDIT_ACTIONS`
map, recorded via the existing `AuditService.record()` — the same
convention every other Employee `assignX` action already uses. Every
Collection Point operational mutation already had Sprint 37 audit coverage;
confirmed, not duplicated. Notifications: audited, not built — the
Notification system remains User-only and the Conversation Layer has no
proactive capability (unchanged); the Field UI's existing 15/30-second
polling remains the mechanism for surfacing new activity.

## 11. Tests

New: `field-d2c-overview.service.spec.ts` (11 tests — admin bypass via both
`isOwnerBypass` and `sales.customer.manage`, territory-scoped filter
applied server-side, deny-by-default for no-territory and no-Employee-record
callers, order/Collection-Point merge logic), `field-d2c-overview
.controller.spec.ts` (2 tests). Extended: `collection-point-fulfillment
.service.spec.ts` (+16 — `getInventoryViewForOutlet`'s SUFFICIENT/SHORT/
multi-order-summing/no-stock-row/no-location/empty-queue/status-filter/
authorization cases; `getById`'s new `paymentStatus`/`paidAt`/
`territoryName` mapping across RECORDED/non-RECORDED/no-payment cases),
`collection-point-fulfillment.controller.spec.ts` (+2),
`collection-point-fulfillment-independence.spec.ts` (updated to allow the
new read-only `InventoryStockRepository` dependency while still forbidding
any write call through it), `employee.service.spec.ts` (+4,
`assignTerritory` assign/clear/invalid-territory/cross-tenant cases). No
dedicated `EmployeeRepository`/`EmployeeController` spec files exist in
this codebase for the `assignX` family generally (a pre-existing gap, not
introduced here) — covered instead by the service-level tests plus live
verification.

## 12. Live Verification

All against the real dev PostgreSQL database and a real running application
(API + web), nothing claimed without actually being exercised:

- **Scenario 1 (Collection Point representative, full flow)**: ✅ A fresh
  D2C order (real consumer conversation → OPay webhook → auto-assignment)
  was driven through Start Preparing → Mark Ready → Confirm Collection as
  the assigned Member-role rep; real inventory decreased 23 → 21 for a
  2-unit order; the order detail page correctly showed `paymentStatus:
RECORDED`, the real `paidAt` timestamp, and `territoryName: Bodija`.
- **Scenario 2 (Sales Representative)**: ✅ A field rep assigned to
  "Bodija" territory (`Employee.territoryId` set via the new endpoint) saw
  exactly 13 real D2C orders and 2 real Collection Points, all correctly
  scoped — verified both via direct API calls and a real mobile-viewport
  (375px) browser session showing the dashboard, attention section, order
  list, and Collection Point list rendering correctly with real data.
- **Scenario 3 (Security)**: ✅ All of the following were tested directly
  and failed/succeeded as expected: an unrelated (non-owner) Member-role
  user received `403` on both the fulfilment-detail and new inventory-view
  endpoints, and succeeded on both once made the outlet's
  `collectionPointResponsibleUserId`; a genuinely separate organisation
  (created live via `/auth/register`) received empty results from both
  `field-overview` endpoints and `404` (not `403`, matching this
  codebase's existing cross-tenant concealment convention) when directly
  requesting Org A's real fulfilment-detail and inventory-view resource
  ids; an admin querying the SAME `field-overview/collection-points`
  endpoint correctly saw a third Collection Point (in "Mokola" territory)
  that the Bodija-scoped rep correctly could NOT see — proving real
  server-side filtering, not a coincidental absence of other-territory
  data.
- **Scenario 4 (Concurrent operation)**: ✅ Two genuinely concurrent
  `confirm-collection` HTTP requests (one as the assigned Member rep, one
  as the admin) against the same `READY_FOR_COLLECTION` order both
  returned `201` with identical final state (one won the race, the other
  received the idempotent result); real stock decremented by exactly the
  order's own quantity (one decrement, not two) — Sprint 37.1's atomic
  protection confirmed fully intact through this sprint's changes.
- **Scenario 5 (Inventory)**: ✅ Confirmed directly via the real
  PostgreSQL `InventoryStock` row before/after each operation (§ above);
  the Sprint 37.1 real-PostgreSQL integration suite (`pnpm run
test:integration`) was re-run after this sprint's changes and still
  passes all 7 tests unchanged.
- **Mobile rendering**: ✅ Verified at a 375px viewport in dark mode — the
  Collection Point dashboard, Attention section, inventory view, order
  queue, order detail page (with sticky action bar), and the Sales Rep
  overview page (Attention/Orders/Collection Points sections) all rendered
  correctly with no horizontal scroll and no layout breakage; the existing
  Field bottom navigation and B2B Sales Home screen were confirmed
  unaffected.

## 13. Regression Results

```
Baseline:      232 suites / 2089 tests (Sprint 37.1)
Final:         234 suites / 2120 tests
New suites:    2  (field-d2c-overview.service.spec.ts, .controller.spec.ts)
New tests:     31
Failures:      0
Regressions:   0
```

Also: `pnpm run test:integration` — 7/7 passing, unchanged.
`pnpm exec tsc --noEmit` — clean (API and web). `pnpm exec eslint src` —
0 errors, 27 pre-existing warnings in unrelated `finance/budgeting` spec
files (confirmed untouched by this sprint). `pnpm exec prisma validate` —
valid. `pnpm exec prisma migrate status` — 56 migrations, up to date.
`pnpm run build` (web) — succeeds; `/field/collection-point`,
`/field/collection-point/[id]`, and `/field/d2c` all appear as compiled
routes in the build output.

## 14. Known Limitations

- **No `paymentStatus` in the Sales Rep's order list** — a deliberate scope
  trim: fetching it would require widening `SalesOrderRepository`'s shared,
  heavily-reused `RELATIONS_INCLUDE` with a `payments` join used by every
  B2B caller of that repository too, for a field only this one list view
  needs. The richer detail a Collection Point rep actually opens does
  carry real `paymentStatus`/`paidAt`.
- **The "waiting too long" threshold (30 minutes) is a documented UI-only
  constant** — not configurable, not enforced server-side, and not based
  on any existing business rule (none was found to exist anywhere in this
  codebase).
- **No in-app call/WhatsApp action for consumer contact** — the phone
  number is surfaced as plain text (operationally justified, per brief
  §16), since the existing Notification/WhatsApp infrastructure cannot yet
  push to a Consumer (Sprint 37's own unchanged audit finding).
- **No dedicated admin UI for assigning `Employee.territoryId`** —
  settable today via `POST /hr/employees/:id/territory` (exercised exactly
  this way for this sprint's own live verification), but no HR
  admin-screen Territory picker was built, given this sprint's explicit
  Field-operations (not D2C/HR-administration) scope.
- **Cross-tenant `Employee.territoryId` rejection was unit-tested but not
  separately live-verified** against a second real tenant (would require
  creating an Employee record there purely for this one check) — the
  underlying `organisationId`-scoped Prisma query is the same established
  pattern used throughout this codebase.

## 15. Deferred Work

Real WhatsApp API/webhook integration, consumer chatbot changes, a new
payment provider or OPay changes, loyalty/rewards, marketing campaigns,
consumer segmentation/analytics, Collection Point settlement/payout,
accounting settlement, a new inventory or order architecture, a new
CollectionPoint entity, a full inventory management UI, a full CRM, any
analytics dashboard, a generic `AccessScope.ASSIGNED_TERRITORY` enforcement
mechanism (this sprint added one bespoke, narrow check — not the generic
enum-driven mechanism), and an atomic fix for the three
increment-with-weighted-average-cost inventory paths flagged by Sprint 37.1
(Customer Return, Goods Receipt, Production Run) — all explicitly out of
scope, per the brief's own boundary.

## 16. Files Changed

**Backend — schema/migration**: `prisma/schema.prisma` (`Employee
.territoryId`, `Territory.employees`), `prisma/migrations/
20261002090000_sprint38_employee_territory/`.

**Backend — HR**: `employee.repository.ts`, `employee.service.ts`,
`employee.controller.ts`, `hr-audit-actions.ts`, `employee.service.spec.ts`.

**Backend — validation**: `packages/validation/src/hr.ts`
(`assignEmployeeTerritorySchema`).

**Backend — D2C Field Overview (new)**: `d2c/field-overview/
field-d2c-overview.types.ts`, `.service.ts`, `.controller.ts`, `.module.ts`,
`.service.spec.ts`, `.controller.spec.ts`.

**Backend — Collection Point Fulfillment (extended)**: `collection-point
-fulfillment.repository.ts`, `.service.ts`, `.controller.ts`, `.module.ts`,
`.types.ts`, `.service.spec.ts`, `.controller.spec.ts`,
`-independence.spec.ts`.

**Backend — Sales** (minor, enabling the new filters/includes):
`sales-order.repository.ts`, `sales-fulfilment.repository.ts` (widened
`consumer` select to include `territoryId`/`territory.name`, consistent
across both repositories), `sales-order.service.spec.ts` (fixture update).

**Backend — app wiring**: `app.module.ts` (`FieldD2COverviewModule`),
`prisma/seed.ts` (`d2c.consumer.view` granted to Member role).

**Frontend**: `field/collection-point/api.ts` (extended),
`field/collection-point/page.tsx` (dashboard/attention/inventory sections),
`field/collection-point/[id]/page.tsx` (new, order detail),
`field/d2c/api.ts` (new), `field/d2c/page.tsx` (new), `field/page.tsx`
(new conditional banner link).

**Documentation**: `docs/domains/d2c.md` (§84–93), `docs/domains/README.md`
(D2C row, single line), `docs/roadmap.md`, `docs/backlog.md`,
`docs/changelog.md`, `README.md`, `docs/sprint-38-completion-report.md`
(this document).

## 17. Git Status

- **Branch**: `main`
- **HEAD**: `fcc5761` (Sprint 37 + Sprint 37.1 combined commit) — unchanged
  by this sprint.
- **Working tree**: all Sprint 38 changes listed in §16 remain uncommitted
  on disk.
- **Commit**: **NOT CREATED.**
- **Push**: **NOT PERFORMED.**
