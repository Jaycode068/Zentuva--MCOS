# Sprint 39 — D2C Sales Administration & Operations Dashboard — Completion Report

## 1. Objective

Build an internal admin/operations dashboard over the whole D2C chain
(Consumer → Conversation → SalesOrder → Payment → CollectionPoint →
FieldOps → Inventory → Collection), giving the business side visibility
and narrowly-scoped control that today only exists scattered across raw
API access and the Sprint 32 Consumer verification screen. Explicitly an
aggregation/administration layer over EXISTING Sprint 32–38 architecture —
no new order/payment/inventory system, no new CollectionPoint entity, no
parallel Exception entity.

## 2. Audit Findings (Pre-Build)

The brief's own first instruction — "do not assume `/settings/d2c` is
empty" — was correct to insist on. Audit confirmed:

- `apps/web/src/app/(app)/settings/d2c/consumers/` and `.../conversation/`
  already existed (Sprint 32/33) — extended, never duplicated. The
  existing `consumers/page.tsx` doc comment had itself flagged "NOT the
  eventual Sprint 39 dashboard," confirming this was the intended
  extension point for Consumer history, not a reason to build a second
  Consumer screen.
- `ConsumerController.list`/`SalesOrderController.list` had **no
  pagination** at all (`{items: [...]}`, no `total`/`page`) — a genuine
  gap for an admin list view at scale.
- `SalesOrderRepository`'s `source`/`consumerTerritoryId` filters existed
  at the repository level (Sprint 38) but were **never exposed over
  HTTP** — `SalesOrderController.list` only accepted
  `status`/`customerId`/`outletId`/`search`.
- `PaymentRepository.ListPaymentsParams` had no `consumerId`/
  `salesOrderId` filter, despite both columns existing since Sprint 35 — a
  genuine gap for a Consumer/Order payment-history view.
- `CollectionPointFulfillmentService` had no admin-wide (org-wide,
  non-outlet-scoped) list method — only per-outlet (`getQueueForOutlet`)
  or per-rep (`getMyOutlets`) reads existed.
- `AlreadyAssignedError`'s own doc comment in `collection-point
-fulfillment.types.ts` explicitly stated reassignment was "left optional
  and not built" (Sprint 37) — confirming it as a genuine, previously
  acknowledged gap, not a new feature invented for this sprint.
- The existing `EmployeeRepository.list` (HR) pagination convention
  (`page`/`pageSize` via `@zentuva/validation`'s shared `paginationSchema`,
  `{items, total, page, pageSize}`) was identified as the pattern to
  replicate — `settings/hr/employees/page.tsx`'s filter/table/pagination
  UI was used as the frontend reference implementation.

Full detail: `docs/domains/d2c.md` §94–102.

## 3. Architecture / Module Design

A new `D2CAdminModule` (`apps/api/src/d2c/admin/`) — pure read-aggregation,
no table, no repository, no entity of its own, the exact
`FieldD2COverviewModule` shape (Sprint 38). Imports `SalesModule`,
`ConsumerModule`, `CollectionPointFulfillmentModule`, `OutletModule`,
`TerritoryModule` and injects their exported services/repositories.
`D2CAdminService` is the single admin-only aggregation surface; the one
genuinely new mutation (Collection Point reassignment) was deliberately
placed INSIDE the existing `CollectionPointFulfillmentModule` instead
(cohesion with that module's existing state-machine mutations, not a
second place to find "how does a fulfilment's outlet change").

Every read is additive: four new repository methods
(`SalesOrderRepository.findManyPaginated`, `ConsumerRepository
.findManyPaginated`, `CollectionPointFulfillmentRepository
.findManyPaginated`, `.reassignOutlet`) exist ALONGSIDE the pre-existing
unpaginated methods, never replacing them — every pre-Sprint-39 caller
(`FieldD2COverviewService`, the Sprint 32 Consumer screen, etc.) is
byte-for-byte unaffected.

## 4. New Endpoints

| Method & Path                                                      | Purpose                                       | Permission                                  |
| ------------------------------------------------------------------ | --------------------------------------------- | ------------------------------------------- |
| `GET /d2c/admin/overview`                                          | Dashboard summary + attention + recent orders | `sales.order.view` + admin check            |
| `GET /d2c/admin/attention`                                         | Full itemized Attention/Exception list        | `sales.order.view` + admin check            |
| `GET /d2c/admin/territories`                                       | Per-territory operational summary             | `sales.order.view` + admin check            |
| `GET /d2c/admin/consumers`                                         | Paginated Consumer admin list                 | `d2c.consumer.view` + admin check           |
| `GET /d2c/admin/orders`                                            | Paginated D2C order list (source forced)      | `sales.order.view` + admin check            |
| `GET /d2c/collection-point-fulfillments`                           | Org-wide Collection Point queue               | `d2c.collection_point.view` + admin check   |
| `GET /d2c/collection-point-fulfillments/by-sales-order/:id`        | Order detail's collection status              | `d2c.collection_point.view`                 |
| `GET /d2c/collection-point-fulfillments/eligible-for-reassignment` | Reassignment picker's outlet list             | `d2c.collection_point.view` + admin check   |
| `POST /d2c/collection-point-fulfillments/:id/reassign`             | The one new mutation                          | `d2c.collection_point.fulfil` + admin check |
| `GET /finance/payments?consumerId=`/`?salesOrderId=`               | Payment history filters (additive)            | `finance.payment.view`                      |

No new permissions. Every admin-only route layers a
`@RequirePermission` decorator (confirms the right KIND of permission)
with an inner `assertAdmin` check inside the service (confirms org-wide
scope, not a scoped grant) — the same `sales.customer.manage`-or-
owner-bypass signal `CollectionPointFulfillmentService` already
established in Sprint 37/38.

## 5. Dashboard & Attention Required

`D2CAdminService.getOverview`/`.getAttention` compute, live, on every
request (never cached): total D2C orders, consumer count, active
Collection Points, pending/failed payment counts, unassigned-order count,
and 10 most recent orders. The Attention Required list derives four
categories entirely from existing data:

- **Unassigned order** — a `CONFIRMED` D2C order with no
  `CollectionPointFulfillment` row (batch-checked via the existing
  `findManyBySalesOrderIds`, never N+1).
- **Failed payment** — `payments: {some: {status: 'FAILED'}}`.
- **Stuck fulfilment** — `ASSIGNED`/`PREPARING` for over 24h (mirroring
  Sprint 38's own Field "Waiting" threshold, scaled org-wide).
- **Disabled Collection Point with a queue** — a queued fulfilment whose
  outlet's `collectionPointStatus` is `DISABLED`.

No fabricated Exception entity — every item is a plain derived read.

## 6. Consumer Administration

`GET /d2c/admin/consumers` — new pagination on top of the existing
`ConsumerRepository`; the existing unpaginated `/d2c/consumers` (Sprint 32) is untouched. The Consumer **detail** (Sprint 32's existing dialog,
extended not duplicated) gained Order History / Payment History /
Collection History sections, each a thin composition of an existing
admin endpoint filtered by `consumerId`. Editing remains exactly as
Sprint 32 built it: display name/marketing/address/location editable via
the existing `PATCH`/`PATCH .../location` endpoints; `consumerCode`/
`normalizedPhone` remain immutable (no new code path touches them).

## 7. D2C Order Administration

`GET /d2c/admin/orders` — `source: D2C` forced server-side; filters:
status, consumer, territory (via `Consumer.territoryId`), Collection
Point outlet (resolved via a `CollectionPointFulfillment.outletId` →
salesOrderId lookup, since `SalesOrder.outletId` itself is always `null`
for a D2C order), payment status (including a distinct `'NONE'` =
"never attempted" value), date range, and a search widened to match
`Consumer.fullName`/`.consumerCode` (the existing B2B-only `search` is
untouched). Order detail composes THREE existing reads (`GET /sales
/orders/:id`, `GET /finance/payments?salesOrderId=`, `GET /d2c
/collection-point-fulfillments/by-sales-order/:id`) — never a new
aggregate order entity. Payment info is read directly from the `Payment`
table, never inferred from order status.

## 8. Collection Point Operational Summary

`GET /d2c/collection-point-fulfillments` (admin-wide, no outlet
restriction) — filterable by status/outlet/territory/consumer/date/
search, admin-only via a new `listAll` service method. Reuses the
existing `toResult()` DTO mapper unchanged.

## 9. Territory Summary

`GET /d2c/admin/territories` — consumer/D2C-order/Collection-Point counts
per territory, explicitly scoped to operational visibility, not the full
Demand Intelligence Sprint 41 owns. Two bounded `groupBy` queries
(consumer counts, D2C-order counts via a consumer-id → territory-id map)
plus one outlet query, merged in memory — never N+1 per territory. A real
bug was caught here by a unit test before it ever reached live
verification: `Outlet.collectionPointStatus` defaults to `DISABLED` for
EVERY outlet, including ones never configured as a Collection Point at
all; an unguarded count would have miscounted every ordinary B2B outlet
with a territory as a "disabled Collection Point." Fixed by requiring
`collectionPointStatus === 'ENABLED' || collectionPointResponsibleUserId`
before counting.

## 10. Administrative Overrides — Audited

Per the brief's audit-first-per-override framework:

- **Resend a transactional notification** — audited, found inapplicable:
  no consumer-facing notification channel exists yet; nothing to resend.
- **Correct a permitted consumer preference** — audited, found already
  fully covered by the existing Sprint 32 `PATCH /d2c/consumers/:id`/
  `:id/location` endpoints; reused as-is via the extended Consumer
  dialog, zero new backend code.
- **Collection Point reassignment** — audited, found genuinely missing
  (§11), built narrowly.

Explicitly not done, per the brief's forbidden list: marking an unpaid
order paid, manipulating inventory, altering totals, fabricating
fulfilment, bypassing payment verification, changing immutable Consumer
identity, or mutating accounting records directly.

## 11. Collection Point Reassignment (the one new mutation)

`CollectionPointFulfillmentService.reassign()` — admin-only (no rep
self-service, unlike every other mutation in this service), reachable
only from `ASSIGNED`/`PREPARING` (never `READY_FOR_COLLECTION`/
`COLLECTED`), validates the target outlet's FULL eligibility
(`isEligible()` — active, enabled, configured inventory location, the
same check `assignManually` uses), a conditional `updateMany` scoped to
current status (the standard concurrency-guard primitive used throughout
this codebase), resets `status: ASSIGNED`/`preparingAt: null` at the new
outlet while deliberately preserving the original `assignedAt` (SLA
tracking survives a correction). Fully audited
(`collection_point_fulfillment.reassigned`). Never touches payment,
inventory, totals, or Consumer identity.

**Live-verification finding and fix**: the reassignment picker's first
implementation reused the existing `getMyOutlets()` (filtered only by
`collectionPointStatus`). Live-testing against real dev data surfaced an
outlet that was `ENABLED`+`ACTIVE` but had no `inventoryLocationId`
configured — selectable in the picker, then correctly rejected
server-side. Fixed with a new, narrower
`listEligibleOutletsForReassignment()` (full `isEligible()` filter) and
its own endpoint; `getMyOutlets()` itself (the Field app's own, already-
live picker) was deliberately left untouched to avoid changing an
unrelated, working screen.

## 12. Access Control / Authorization

No new permissions. Every admin surface reuses `sales.order.view`/
`d2c.consumer.view`/`d2c.collection_point.view`/`.fulfil` plus the
existing `sales.customer.manage`-or-owner-bypass admin signal. Verified
live (§18): unauthenticated → 401; a real Member-role account (holding no
`sales.customer.manage` grant) → 403 with the exact expected message.

## 13. Audit Coverage

The one new mutation (`reassign`) is fully audited
(`fromOutletId`/`toOutletId`/`salesOrderId`/actor). Every other new
surface is read-only — no audit event needed, matching convention (reads
are never audited elsewhere in this codebase either).

## 14. Tenant Isolation & Security

Every new/extended method routes through the SAME `(id, organisationId)`-
scoped `SalesOrderService`/`ConsumerService`/
`CollectionPointFulfillmentRepository` primitives already exhaustively
cross-tenant-tested in Sprints 32–38 — no new cross-tenant surface was
introduced. Live-verified: manipulated/non-existent ids against
`/sales/orders/:id` and `/d2c/consumers/:id` return 404 without leaking
existence; the same against the new `by-sales-order/:id` lookup correctly
returns `{item: null}` with 200 (the documented "not yet assigned" state,
not an error — never conflated with a real 404). True cross-TENANT
isolation (a second organisation's token) was not separately live-tested
this sprint — no second tenant's credentials were available in the dev
seed — see §20.

## 15. Pagination & N+1 Avoidance

Every new list method runs `findMany`+`count` in parallel
(`Promise.all`), scoped by the exact same `where` clause, matching the
`EmployeeRepository.list` convention. The admin Order list's payment/
collection-status enrichment deliberately uses batch reads
(`findManyBySalesOrderIds`, a `salesOrderIds: string[]` filter added to
`PaymentRepository`) rather than one query per row.

## 16. Frontend Implementation

`apps/web/src/app/(app)/settings/d2c/page.tsx` (dashboard), `orders/
page.tsx` + `orders/[id]/page.tsx`, `collection-points/page.tsx`,
`territories/page.tsx` — all new, following the `settings/hr/employees`
filter/table/pagination convention exactly. A shared `D2cTabs` component
(the `HrTabs` clone pattern). `consumers/page.tsx` extended with the
three History sections and a `?id=` deep link (wrapped in `<Suspense>`,
the established `useSearchParams` convention). One new Workspace nav
entry ("D2C Operations"). Responsive: verified at both desktop and 375px
mobile viewports.

## 17. Tests

New: `d2c-admin.service.spec.ts` (11), `d2c-admin.controller.spec.ts` (7).
Extended: `collection-point-fulfillment.service.spec.ts` (+11),
`.controller.spec.ts` (+4), `.repository.spec.ts` (+3), `sales-order
.service.spec.ts`/`consumer.service.spec.ts` (+1 each), `payment
.controller.spec.ts` (+1). Full detail and rationale for what was and
was NOT repository-unit-tested (complex filter-building list queries
follow this codebase's existing convention of being verified at the
service-mock layer or via live testing, matching how the pre-existing
`findManyByOrganisation` methods were never unit-tested either): `docs
/domains/d2c.md` §100.

## 18. Live Verification

Against the real dev database and a real running application (API + web,
desktop and mobile viewports), using a real injected session token:

1. **Dashboard** — real counts (13 orders, 26 consumers, 3 enabled
   Collection Points); correctly surfaced a genuinely stuck order left
   over from Sprint 37/38's own test data.
2. **Order detail** — consumer/items/payment/collection status all
   correct for a real order; Reassign action appeared only because the
   order's real status made it eligible.
3. **Administrative mutation** — found and fixed the eligible-outlet
   picker gap live, then verified the full reassignment path end to end:
   outlet changed, status reset, confirmed via a direct audit-log query
   and an unchanged underlying `SalesOrder`.
4. **Collection Points / Territories** — the org-wide queue reflected the
   reassignment immediately; territory summary numbers were internally
   consistent with the dashboard totals.
5. **Consumer detail** — the `?id=` deep link opened the correct
   consumer; all three History sections rendered the same real order.
6. **Security** — 401 unauthenticated, 403 for a real non-admin Member
   account, 404 for manipulated ids, `{item: null}`/200 for a
   never-assigned order (not conflated with a 404).
7. **Responsive** — the dashboard re-verified at 375px with the same live
   data, including the attention message reflecting the just-completed
   reassignment.

## 19. Regression Results

| Metric                                   | Sprint 38 baseline | Sprint 39                                       |
| ---------------------------------------- | ------------------ | ----------------------------------------------- |
| Test suites                              | 234                | 236                                             |
| Tests                                    | 2,120              | 2,160                                           |
| Regressions                              | —                  | 0                                               |
| Sprint 37.1 PostgreSQL integration suite | 7/7                | 7/7 unchanged                                   |
| `prisma validate`                        | —                  | valid                                           |
| `prisma migrate status`                  | —                  | up to date, 0 new migrations                    |
| `next build` (production)                | —                  | succeeds, 0 warnings                            |
| `tsc --noEmit` (API + web)               | —                  | 0 errors                                        |
| `eslint`                                 | —                  | 0 errors (pre-existing unrelated warnings only) |

## 20. Known Limitations

- True cross-tenant isolation for the new endpoints was not separately
  live-tested (no second tenant's credentials available in the dev seed)
  — covered instead by the inherited, already-exhaustively-tested
  `(id, organisationId)` scoping of every underlying service.
- The Territory summary's D2C-order count is computed via an in-memory
  consumer-id → territory-id map rather than a single SQL join (Prisma
  cannot `groupBy` across a relation) — correct and N+1-free for the
  current data scale, but would need revisiting at a much larger consumer
  count.
- `ListPaymentsParams.salesOrderIds` (the batch filter) was added for
  consistency with the `findManyBySalesOrderIds` precedent but has no
  current HTTP-exposed batch route — the admin Order list instead reads
  `paymentStatus` directly off `SalesOrder.payments` rather than a
  separate batch Payment query, since that was sufficient for this
  sprint's filters.

## 21. Files Changed

**Backend**: `apps/api/src/d2c/admin/` (new module — service, controller,
module, types, 2 spec files), `apps/api/src/d2c/fulfillment/
collection-point-fulfillment.{service,repository,controller,types,
audit-actions}.ts` (+ specs), `apps/api/src/sales/sales-order.{repository,
service,controller}.ts` (+ spec), `apps/api/src/d2c/consumer/consumer.
{repository,service,controller}.ts` (+ spec), `apps/api/src/finance/
payment.{repository,controller}.ts` (+ spec), `apps/api/src/app.module.ts`,
`packages/validation/src/d2c.ts`.

**Frontend**: `apps/web/src/app/(app)/settings/d2c/{page,api}.tsx`,
`orders/{page.tsx,[id]/page.tsx}`, `collection-points/page.tsx`,
`territories/page.tsx`, `consumers/page.tsx` (extended),
`apps/web/src/components/app/d2c-tabs.tsx` (new),
`apps/web/src/components/workspace/navigation-config.ts`.

**Docs**: `docs/domains/d2c.md` (§94–102), `docs/domains/README.md`,
`docs/roadmap.md`, `docs/backlog.md`, `docs/changelog.md`, `README.md`,
this file.

No commits or pushes were made — per explicit instruction.
