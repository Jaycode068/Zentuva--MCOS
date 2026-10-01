# Sprint 37 Completion Report — Collection Point Fulfillment & Inventory Reconciliation

## 1. Implementation Summary

Connected a paid D2C `SalesOrder` to the Collection Point capability
Sprint 36 added to `Outlet`, carrying it through a real operational
workflow to an actual inventory deduction: Paid → Eligible Collection
Point → Assigned → Preparing → Ready for Collection → Collected →
Fulfilled → Inventory Reconciled. One new, deliberately subordinate
model (`CollectionPointFulfillment`) tracks the D2C-specific operational
sub-state between `SalesOrder.CONFIRMED` and `SalesOrder.FULFILLED`; the
actual inventory deduction is performed entirely by the pre-existing,
unmodified `SalesFulfilmentService.fulfil()` (Sprint 4.9) — never a new
stock mutation path. No parallel order entity was created.
`Outlet.inventoryLocationId` bridges Collection Point to the existing
Inventory domain, exactly as Sprint 36 had already flagged as the open
question for this sprint to answer. Full architectural detail lives in
`docs/domains/d2c.md` §68–83; this report focuses on what was built,
tested, and live-verified — including two genuine bugs found and fixed
during live verification, and one pre-existing, now-confirmed inventory
concurrency defect that was found but deliberately NOT fixed this
sprint (see §12 and §14).

## 2. Architecture Audit

Read end-to-end before any code was written — D2C Ordering, D2C
Payment, Sales, Sales Fulfilment, Inventory, Outlet, Identity/Access
Control, and Notifications/Conversation. Findings, each resolved by
reuse or explicit documentation:

- **`SalesOrderStatus`** cannot represent the D2C operational
  sub-workflow (ASSIGNED/PREPARING/READY_FOR_COLLECTION/COLLECTED are
  genuinely new information) — justifying exactly one new, subordinate
  model, per the brief's own conditional allowance (§4).
- **`InventoryLocation` had zero relationship to `Outlet`** in either
  direction; `SalesFulfilment.locationId` already treats a plain
  `(organisationId, productId, locationId)` triple as the unit of truth
  for B2B — the bridge added mirrors that shape exactly (§3).
- **`InventoryStock.quantityReserved`** exists in the schema but is
  never written anywhere — no real reservation mechanism exists today;
  confirmed before deciding not to build one this sprint either.
- **`SalesFulfilmentRepository.create()`'s stock-decrement** is a
  read-then-upsert-with-a-precomputed-value pattern inside a
  `$transaction` at default READ COMMITTED, with no explicit row lock —
  flagged in this audit as a theoretical pre-existing risk, and
  subsequently **empirically confirmed** by this sprint's own live
  concurrency testing (§12, §14).
- **`AccessScope.ASSIGNED_RECORDS`/`ASSIGNED_TERRITORY`/`ASSIGNED_ASSETS`**
  remain "recorded, not enforced" everywhere in this codebase — no
  existing mechanism performs the per-record ownership check this
  sprint's authorization model needed, so a new, narrow one was added
  (§7).
- **The Notification system is structurally User-only** (a `Consumer`
  cannot receive one); **the Conversation Layer has no proactive/outbound
  capability** (only inbound-triggered responses). Both confirmed
  unbuildable within this sprint's boundary — no consumer-facing
  "your order is ready" notification was built (§13).

## 3. The Inventory Bridge

`Outlet.inventoryLocationId String?` — nullable (most outlets are never
a Collection Point), NOT unique (multiple outlets may share one
warehouse, matching how several B2B customers already share a
`SalesFulfilment.locationId`), `onDelete: Restrict`. An outlet configured
this way draws from the exact same `InventoryStock` row any B2B
fulfilment at that location already draws from — no second stock ledger,
no reservation, no transfer logic.

## 4. Fulfillment State Model

One new model, `CollectionPointFulfillment` (`salesOrderId` unique FK —
always subordinate to `SalesOrder`, never a second order record),
`CollectionPointFulfillmentStatus`: `ASSIGNED → PREPARING →
READY_FOR_COLLECTION → COLLECTED`. Every transition uses the same
conditional-`updateMany`-as-concurrency-guard pattern this codebase
already uses everywhere else (`OutletRepository.update()`,
`SalesOrderRepository.updateStatus()`): scope the `WHERE` to `{id,
organisationId, status: {in: fromStatuses}}`, check the affected row
count, re-fetch on success.

## 5. Order Assignment Model

- **Automatic** (primary path): `D2CPaymentService.handleProviderCallback()`'s
  success branch calls `autoAssign()`, wrapped in try/catch that only
  logs — an assignment failure must never crash the webhook endpoint
  OPay retries against.
- **Manual** (admin fallback, `POST /d2c/collection-point-fulfillments/assign`):
  for "no eligible outlet existed at payment time" or "assign a specific
  outlet" — re-validates eligibility server-side even when a specific
  `outletId` is supplied, never trusting the caller's choice.

`CollectionPointFulfillment.salesOrderId` is unique at the database
level — an order can be assigned at most once.

## 6. Inventory Mutation Boundary

The only place inventory is deducted is the pre-existing, unmodified
`SalesFulfilmentService.fulfil()`. `confirmCollection()` calls it with
`outlet.inventoryLocationId` as the fulfilment location and a
deterministic `idempotencyKey: collection-point-fulfillment:${cpf.id}` —
a second, independent safety net beyond the status guard, specifically
against a retried `fulfil()` call. No new stock table, mutation path, or
COGS/journal logic was written.

## 7. Authorization

Two new permissions, `d2c.collection_point.view`/`.fulfil`
(`SCOPABLE`), granted broadly at seed time (Administrator automatically,
Member explicitly) as a coarse gate — matching Sprint 36's own finding
that any active member can be a Collection Point's responsible
representative with no special role. The real restriction is a
resource-ownership check layered on top (new to this codebase): the
caller must hold `sales.customer.manage` (admin oversight) or be the
specific outlet's `collectionPointResponsibleUserId`.

## 8. Audit Trail

New action strings on `COLLECTION_POINT_FULFILLMENT_AUDIT_ACTIONS`,
recorded via the existing `AuditService.record()`: assignment (auto and
manual), every status transition, and `assignment_failed` for a paid
order that finds no eligible Collection Point. Live-verified: a
disabled-outlet order correctly produced exactly one `assignment_failed`
row with `reason: 'no eligible Collection Point in territory'`.

## 9. Idempotency & Concurrency

Every transition uses the conditional-`updateMany` guard (§4).
Live-verified against the real Postgres database (not mocks):

- 8 genuinely concurrent `confirmCollection` calls on the same record —
  all 8 returned success, stock decremented exactly once, `SalesOrder`
  reached `FULFILLED` exactly once.
- A duplicate `confirmCollection` call after success — idempotent no-op,
  no further stock change.
- Insufficient-stock rejection at `markReadyForCollection` — order
  correctly left at `PREPARING`, stock untouched.
- A disabled Collection Point correctly blocked new auto-assignment
  without disturbing already-assigned, in-flight work.

## 10. B2B Boundary — Preserved

Unchanged from Sprint 36: nothing in this sprint's code reads or writes
`outletType`, credit terms, `DistributionNetworkRelationship` rows, or
B2B pricing. `sales-fulfilment.service.spec.ts` (Sprint 4.9, unmodified)
and the existing B2B live-fulfilment path both continue to pass
unmodified.

## 11. Automated Tests

New: `collection-point-fulfillment.repository.spec.ts`,
`collection-point-fulfillment.service.spec.ts` (including the
`confirmCollection`/`fulfil()` rollback-on-failure test added after
§12's first finding, and 5 mocked genuinely-concurrent `confirmCollection`
calls resulting in exactly one `fulfil()` call),
`collection-point-fulfillment.controller.spec.ts`,
`collection-point-fulfillment-independence.spec.ts` (structural guards,
including the corrected `AuthModule` import assertion from §12's second
finding). Extended: `outlet.service.spec.ts`, `outlet.controller.spec.ts`,
`sales-order.service.spec.ts` (new `inventoryLocationId` field),
`d2c-payment.service.spec.ts`, `conversation.service.spec.ts`
(constructor arity), `d2c-payment-independence.spec.ts` (module import
set). No test file was created for logic that doesn't exist — this
sprint extends existing domain test files plus one new domain's own
spec suite, matching the codebase's "extend, don't parallel" convention.

## 12. Two Genuine Bugs Found and Fixed by Live Verification

**Bug 1 — `confirmCollection()` flipped status to `COLLECTED` before
calling `fulfil()`.** Live verification caught this immediately: the
dev environment's accounting periods didn't cover "today," so `fulfil()`
threw `NoOpenPeriodError` — but the status had already committed as the
terminal `COLLECTED` state. Every retry then hit the idempotency
short-circuit and silently reported success forever, while the
`SalesOrder` was never actually fulfilled and stock was never deducted.
Reproduced and preserved live as `SO-000024` (status `COLLECTED`,
`SalesOrder.status` still `CONFIRMED`, `quantityFulfilled: 0`) in the dev
database as an artifact of the bug being found. **Fixed**: `fulfil()` is
now called inside a try/catch between the status flip and the audit
record; on failure, the status flip is explicitly reverted to
`READY_FOR_COLLECTION` (clearing `collectedAt`/`collectedById`) before
re-throwing, leaving the operation retryable. The original 5-way
concurrency guarantee is unaffected — the same conditional `updateMany`
still ensures only one concurrent caller ever reaches `fulfil()` at all.
Re-verified live end to end (`SO-000025`): stock deducted exactly once
(27 → 24 for a 3-unit order), `SalesOrder.status` correctly reached
`FULFILLED`. A dedicated regression test was added.

**Bug 2 — `CollectionPointFulfillmentModule` was missing `AuthModule`.**
Unit tests all passed (they mock the guard's dependencies directly), but
booting the real Nest application failed immediately:
`JwtAuthGuard` needs `TOKEN_SERVICE`, provided by `AuthModule`, not
`IdentityModule` — the exact pattern `OutletModule`/`SalesModule` already
import both for. Fixed by adding `AuthModule`; the structural
independence spec's exact-import-`Set` assertion was updated to match.

Both bugs were found only because the application was actually booted
and driven end to end against a real database — neither was reachable
by unit tests alone, which is the entire justification for this
sprint's mandatory live-verification phase.

## 13. Live Verification

All verified against the real dev database and a real running API (not
mocks). Nothing below is claimed without having actually been exercised.

- **Scenario A (full happy path)**: ✅ Verified twice — a real consumer
  conversation (registration → territory/location selection → product
  selection → cart → checkout → confirm) created `SO-000025`; a
  simulated OPay webhook (real HMAC-signed payload) marked it paid;
  auto-assignment correctly selected the eligible Bodija outlet;
  Preparing → Ready → Collected correctly deducted stock (27 → 24) and
  transitioned `SalesOrder.status` to `FULFILLED`. The first run
  (`SO-000024`) surfaced Bug 1 (§12) instead of completing cleanly — its
  failure IS part of what live verification is for.
- **Scenario B (insufficient inventory)**: ✅ Verified — an order for 500
  units against 24 available was correctly rejected at
  `markReadyForCollection` with `400 Insufficient stock...`, order left
  at `PREPARING`, stock untouched.
- **Scenario C (disabled Collection Point blocks new work)**: ✅
  Verified — disabling mid-territory correctly produced an
  `assignment_failed` audit row for a new paid order (never silently
  dropped) and correctly rejected an admin's attempt to manually assign
  it to the disabled outlet; re-enabling and manually assigning
  succeeded.
- **Scenario D (tenant isolation)**: Enforced by the same
  `organisationId`-scoping mechanism already live-verified in Sprint 36
  and structurally verified here by
  `collection-point-fulfillment-independence.spec.ts` — not
  independently live-tested against a second real organisation this
  sprint (see Known Limitations, §14).
- **Scenario E (browser persistence)**: Not completed — hit local
  dev-server session flakiness (stale HMR chunks, a suspended browser
  tab network stack) unrelated to Sprint 37's own code; the underlying
  API paths the Field UI depends on were independently, directly
  verified instead (arguably a stronger guarantee than a UI click-through
  would have given). The admin Outlet dialog's new inventory-location
  picker was verified via `tsc`/`eslint`/a full production build only,
  not an interactive browser session.
- **Scenario F (duplicate action, no duplicate mutation)**: ✅ Verified —
  a repeated `confirmCollection` call after success returned the same
  result with zero additional stock change.
- **Scenario G (genuine concurrency, same record)**: ✅ Verified — 8
  truly concurrent `confirmCollection` HTTP calls on one record all
  returned success; stock decremented exactly once; order fulfilled
  exactly once.
- **Scenario G (genuine concurrency, competing orders)**: ⚠️ Tested, and
  it surfaced a real, pre-existing, now-confirmed defect — see §14. Two
  different orders (15 units each, 23 in stock) both reported success
  and both were marked fully fulfilled, but only one decrement actually
  landed (a lost update in shared, pre-existing infrastructure, not this
  sprint's own new code). Reported here in full rather than claimed as a
  pass it did not earn.

## 14. Known Limitations

- **A confirmed, pre-existing inventory concurrency defect** in
  `SalesFulfilmentRepository.create()` (Sprint 4.9): its stock decrement
  is a read-then-upsert-with-a-precomputed-value pattern with no row
  lock. Under real concurrent fulfilment of two different orders
  competing for the same limited stock, this produces a lost update —
  live-verified (§13). Not fixed this sprint: it is pre-existing shared
  infrastructure used by every B2B and D2C fulfilment path, the brief
  explicitly required reusing rather than re-architecting the existing
  inventory mechanism, and a correct fix has a blast radius across every
  consumer of `.create()` — it deserves dedicated, carefully-tested work
  of its own. Flagged separately as a follow-up task rather than
  patched under time pressure inside this report.
- **Accounting-period gap in this dev environment** (not a Sprint 37
  defect): the seeded `AccountingPeriod` rows didn't cover the date live
  verification was run on; a "September 2026" period was created via
  the existing, ordinary admin endpoint to exercise the real
  `fulfil()`/journal-posting path. This is routine monthly bookkeeping
  gap in dev/seed data — but it is exactly the failure mode that exposed
  Bug 1 (§12).
- **Minor response staleness**: `confirmCollection()`'s own HTTP response
  can show the pre-fulfilment `SalesOrder` status for one beat (the very
  next `GET`, and the Field UI's own 15-second poll, show the correct
  post-fulfilment status). Not fixed — no caller currently depends on
  that specific field from the mutation response.
- **Consumer notification** — audited and confirmed unbuildable within
  this sprint's boundaries (Notification system is User-only;
  Conversation Layer has no proactive capability). Not extended.
- **Tenant isolation** — mechanism reused unchanged from Sprint 36, but
  not independently live-tested against a second organisation this
  sprint (§13, Scenario D).
- **Interactive browser walkthrough of the Field Collection Point
  screen** was not completed this sprint due to local dev-server session
  flakiness (§13, Scenario E); the APIs it depends on were verified
  directly instead.

## 15. Quality Checks

| Check                                   | Result                                                                                                         |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `prisma validate`                       | Pass                                                                                                           |
| `prisma migrate status`                 | Pass — 55 migrations, up to date                                                                               |
| `pnpm exec tsc --noEmit` (API)          | Pass                                                                                                           |
| `pnpm exec eslint src` (API)            | Pass — 0 errors (27 pre-existing warnings, unrelated `finance/budgeting` spec files, untouched by this sprint) |
| `pnpm exec jest` (API)                  | Pass — 231/231 suites, 2084/2084 tests                                                                         |
| `pnpm exec tsc --noEmit` (web)          | Pass                                                                                                           |
| `pnpm exec eslint` (web, changed files) | Pass                                                                                                           |
| `pnpm run build` (web)                  | Pass                                                                                                           |

Regression baseline comparison (explicit, as required): Sprint 36 ended
at 227 suites / 2040 tests. This sprint adds 4 new suites and 44 net new
tests, ending at **231 suites / 2084 tests, 0 regressions** — every
Sprint 36 test still passes unmodified in behavior (only fixture shape
extended for the new `inventoryLocationId` field).

## 16. Documentation

- `docs/domains/d2c.md` — new §68–83 ("Sprint 37 — Collection Point
  Fulfillment & Inventory Reconciliation"): the inventory bridge,
  eligibility, assignment model, fulfillment state model, inventory
  mutation boundary, both bugs found and fixed, audit trail,
  authorization, idempotency/concurrency, the confirmed pre-existing
  inventory defect, B2B boundary, known limitations, scope, testing.
- `docs/sprint-37-completion-report.md` — this document.
- `docs/roadmap.md`, `docs/backlog.md`, `docs/changelog.md`, `README.md`
  — Sprint 37 entries added.
- `docs/domains/README.md` — D2C row updated (single-line change only,
  matching this repository's established discipline).

## 17. Scope Verification

Explicitly confirmed NOT implemented this sprint, by inspection of the
final diff: loyalty/rewards/campaigns/marketing, settlement/payout, new
geography or territory concepts, new payment or notification systems,
WhatsApp integration, nearest-location/GPS-based Collection Point
selection, a consumer-facing Collection Point picker UI, and a fix for
the pre-existing inventory concurrency defect (§14, tracked separately
as follow-up work). No `ConsumerOrder`/`CollectionOrder`/
`CollectionPointOrder`/`D2CFulfillmentOrder` entity was created at any
point.

## 18. Follow-Up Work Flagged (Not Part of This Sprint)

A dedicated follow-up task was created for the confirmed
`SalesFulfilmentRepository.create()` lost-update defect (§14) — scoping,
designing, and implementing an atomic conditional stock decrement
(following this codebase's own established `updateMany`-guard pattern),
including a genuine concurrency test suite, as its own piece of work
rather than a rushed patch bundled into this report.

## 19. Git State

- **Branch**: `main`
- **HEAD**: `23ac1ce` (Sprint 36: Existing Outlet -> Collection Point
  Enablement) — unchanged by this sprint.
- **Commit**: **NOT MADE.**
- **Push**: **NOT MADE.**
- **Working tree**: all Sprint 37 changes (schema, migration,
  `CollectionPointFulfillment` model/repository/service/controller/module,
  validation schemas, Outlet inventory-location bridge, seed data, admin
  - field UI, tests, and this documentation) remain uncommitted on disk,
    per this sprint's explicit instruction.
