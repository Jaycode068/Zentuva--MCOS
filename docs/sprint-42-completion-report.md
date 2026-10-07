# Sprint 42 — D2C Collection Point Fulfilment & Order Completion — Completion Report

## 1. Sprint Objective

Close the operational loop for a paid D2C consumer order: Consumer → WhatsApp → D2C
Order → Payment Confirmed → Collection Point Assigned → Collection Point sees the order
→ Preparing → Ready for Collection → Consumer notified → Consumer collects → Collected →
Order completed. Explicit mandate: a Collection Point is a capability on an existing
Outlet, never a new entity; reuse Sprint 36/37/38/39's own Collection Point work rather
than redesigning it; the only genuinely new work should be whatever the audit proves is
actually missing.

## 2. Architecture Audit

Before any code was written, every domain the brief named was audited by reading the
actual, current source — not recalled from memory:

- **Sales** — `SalesOrder`/`SalesFulfilmentService.fulfil()` (Sprint 4.9, hardened
  Sprint 37.1) unchanged and already the one authoritative inventory-deducting write
  path. `SalesOrder` remains the one authoritative order record throughout.
- **Payment** — `Payment.status` (Sprint 35) already distinguishes `RECORDED` from
  `FAILED`/`VOIDED`/`CLOSED`; nothing reversal-specific existed yet at the fulfilment
  layer — a genuine, small gap (§7 below).
- **Outlet/Distribution** — `Outlet.collectionPointStatus`/`.collectionPointResponsibleUserId`/
  `.collectionPointOperatingHours`/`.inventoryLocationId` (Sprint 36) already model a
  Collection Point as a capability on an existing Outlet, exactly as this brief requires
  — no schema change needed anywhere in this sprint.
- **Inventory** — `InventoryStockRepository`, the Sprint 37.1 atomic stock-decrement
  primitive, and `SalesFulfilmentService.getAvailability()` all already exist and are
  reused unchanged; no parallel stock ledger was created or considered.
- **Field Operations** — `/field/collection-point` (web app) and
  `CollectionPointFulfillmentController`'s full route surface (assign, start-preparing,
  mark-ready, confirm-collection, reassign, queue, inventory view, my-outlets) already
  existed, built across Sprints 36–39 and confirmed field-by-field by reading the actual
  controller/service/repository files, not assumed. Zero changes were required to either
  file this sprint.
- **Notifications** — `WHATSAPP_PROVIDER`/`WhatsAppProvider` (Sprint 29, real Meta
  provider added 40.5) exists and is reusable, but exhaustive grep across
  `d2c/fulfillment/` and `d2c/whatsapp/` confirmed **zero** consumer-facing notifications
  existed anywhere in the fulfilment lifecycle — the one confirmed, unambiguous gap this
  sprint had to fill.
- **D2C** — `CollectionPointFulfillmentService`/`.repository`/`.module`/`.controller`
  (Sprints 36–39) already implement the full lifecycle
  (ASSIGNED→PREPARING→READY_FOR_COLLECTION→COLLECTED), admin reassignment, tenant/
  permission checks, and audit logging. `D2COrderingService.listConsumerOrders`
  (Sprint 41) did not yet surface fulfilment status or Collection Point name — a small,
  additive gap (§4 below), not a redesign.
- **Accounting/Finance** — audited explicitly per the brief's own instruction (§15
  below): no new financial event is expected at Collection Point hand-off; the existing
  Sprint 10 Sales Fulfilment accounting posting (triggered inside the unchanged
  `fulfil()` call) already covers it.

**Conclusion**: the entire Collection Point operational lifecycle, mobile Field UI, and
admin visibility already existed and needed zero redesign. The three genuine gaps found
were: (1) no consumer-facing WhatsApp notification on Ready/Collected, (2) "My Orders"
not yet surfacing fulfilment status/Collection Point name, (3) no payment-still-valid
re-check at the fulfilment transition points (the brief's own explicit §22 ask). No
`WhatsAppCollectionPoint`/`ConsumerPickupLocation`/`D2CStore`/parallel status system/
parallel inventory ledger was created or considered.

## 3. Existing Architecture Reused

- `CollectionPointFulfillmentService`/`.repository`/`.controller`/`.module` (Sprint
  36–39) — the entire assignment/lifecycle/reassignment/queue/inventory-view engine,
  unchanged in its pre-existing methods.
- `SalesFulfilmentService.fulfil()` (Sprint 4.9/37.1) — THE inventory-deducting write
  path, called exactly once per winning `confirmCollection` transition, unchanged.
- `AuditService` (existing audit infrastructure) — every material fulfilment action was
  already audited; this sprint added zero new audit action codes (notifications are a
  best-effort side effect of an already-audited transition, not a separate auditable
  event).
- `WHATSAPP_PROVIDER`/`WhatsAppProvider` (Sprint 29/40.5) — the one real outbound
  WhatsApp sending mechanism, reused by the new notification port, never duplicated.
- `/field/collection-point` and `/settings/d2c` (web app, Sprints 36–39) — the mobile
  Field UI and admin D2C view. **Zero frontend files were changed this sprint** — both
  already showed everything the brief required, confirmed by live use (§17–§19).
- `d2c.collection_point.view`/`d2c.collection_point.fulfil` (Sprint 37 permissions) —
  reused unchanged for every transition and for reassignment; no new permission was
  created.
- `D2COrderingService`/`ConversationService` "My Orders" (Sprint 41) — extended, not
  replaced.

## 4. Collection Point Model

Unchanged from Sprint 36: a Collection Point is purely a capability flag
(`collectionPointStatus: ENABLED`) plus configuration fields
(`collectionPointResponsibleUserId`, `collectionPointOperatingHours`,
`inventoryLocationId`) on the existing `Outlet` entity. No new table, no new entity, no
schema migration was needed or written this sprint.

## 5. Assignment Logic

Unchanged `autoAssign`/`assignManually` (Sprint 37/39): deterministic matching on the
consumer's `territoryId` against `ACTIVE`, `collectionPointStatus: ENABLED` outlets with
a configured `inventoryLocationId`, tie-broken by oldest `createdAt` — never
route-optimized, never silently arbitrary. When no eligible outlet exists, a controlled
exception is recorded (`ASSIGNMENT_FAILED_NO_ELIGIBLE_OUTLET` audit entry against the
`SalesOrder`) rather than failing the payment webhook or assigning nothing silently — an
admin can later use `assignManually` once a Collection Point becomes available.

## 6. Fulfilment Lifecycle

One authoritative state, `CollectionPointFulfillmentStatus`
(`ASSIGNED → PREPARING → READY_FOR_COLLECTION → COLLECTED`), unchanged since Sprint 37.
Every transition is a conditional `updateMany` scoped to `{id, organisationId, status:
{in: fromStatuses}}` (`CollectionPointFulfillmentRepository.updateStatus`); zero matched
rows is always treated as a real, already-resolved outcome (duplicate request or
out-of-order attempt), never silently retried. This sprint added exactly one new guard
re-checked at every transition entry point — `assertPaymentStillValid` (§7) — and two new
best-effort side effects at the end of the two consumer-facing transitions —
`notifyReady`/`notifyCollected` (§8).

## 7. Inventory Behaviour

Unchanged. `markReadyForCollection` runs the same non-authoritative
`SalesFulfilmentService.getAvailability()` pre-check that existed since Sprint 37 (a
UX-only fast-fail). `confirmCollection` is the ONLY point inventory is actually
deducted: the status flip to `COLLECTED` happens first via the same atomic
conditional-`updateMany`; only the request that genuinely wins that flip proceeds to
call `SalesFulfilmentService.fulfil()` — with a deterministic idempotency key
(`collection-point-fulfillment:${cpf.id}`) as a second, independent safety net — so a
retried or duplicate confirmation can never double-deduct stock, and a request that
loses the race never calls `fulfil()` at all. If `fulfil()` throws after the status flip
already committed (e.g. no open accounting period, or a genuine stock shortfall), the
status is rolled back to `READY_FOR_COLLECTION` so the operation remains genuinely
retryable rather than stranding a `COLLECTED`-but-never-fulfilled record — this specific
rollback already existed from Sprint 37's own live verification and was re-confirmed,
unchanged, this sprint. No parallel stock ledger was created; `SalesFulfilmentService`
remains the one inventory-deducting mechanism in the codebase.

## 8. Notification Behaviour

New this sprint: `ConsumerNotificationPort`/`CONSUMER_NOTIFICATION_PORT`
(`apps/api/src/d2c/messaging/consumer-notification.port.ts`) — a narrow interface
mirroring `WhatsAppProvider`/`PaymentProvider`'s own port pattern, so
`CollectionPointFulfillmentService` never imports anything WhatsApp-specific (enforced
executably by `collection-point-fulfillment-independence.spec.ts`). Its one concrete
implementation, `WhatsAppConsumerNotificationService`
(`apps/api/src/d2c/messaging/whatsapp-consumer-notification.service.ts`), resolves the
consumer's own `normalizedPhone` and sends via the EXISTING `WHATSAPP_PROVIDER` token —
no new sending mechanism. It never throws past its own boundary: an unknown consumer, an
unreachable provider, or a Meta rejection is logged and swallowed, matching the
established "best-effort, never block the business transition" convention
(`D2CPaymentService`'s auto-assignment call, Sprint 37).

`notifyReady` and `notifyCollected` are called from `markReadyForCollection`/
`confirmCollection` respectively, AFTER the winning transition's own audit record is
written — never on the idempotent-replay path, since a duplicate/out-of-order request
exits earlier via `updateStatus`'s own zero-rows-matched branch and never reaches the
notification call. Message content uses real data only: the real `Outlet.name`/
`.address`/`.collectionPointOperatingHours`, the real `SalesOrder.orderCode`, and the
real `Organisation.displayName`/`.name` — never a hardcoded tenant name (the same bug
class `ConversationService.welcomeMessage` was already fixed for in Sprint 33).

## 9. Collection Verification

Unchanged Sprint 37/39 design: collection is confirmed by an authorized Collection Point
operator (the assigned rep or an admin) calling `confirmCollection` against the order's
own id — verified against the order number the consumer presents in person. No
consumer-facing OTP/QR was built or required by the brief.

## 10. Reassignment

Unchanged `reassign()` (Sprint 39): admin-only (`sales.customer.manage` or owner
bypass, no rep self-service path), reachable only from `ASSIGNED`/`PREPARING` (never
`READY_FOR_COLLECTION`/`COLLECTED`), validated against the same `isEligible()` check as
manual assignment, and audited (`REASSIGNED`). Proven safe under real concurrent
reassignment this sprint (§14 Scenario D) — no changes were needed to the method itself.

## 11. Permissions

Zero new permissions were created. Every route continues to use the existing
`d2c.collection_point.view`/`d2c.collection_point.fulfil` pair (Sprint 37); the new
`assertPaymentStillValid` guard and the new notification calls run inside already
permission-gated methods and require no separate check. Verified by grep: the
permission catalogue file has no diff this sprint.

## 12. Tenant Isolation

Unchanged. Every repository call continues to be scoped by `organisationId`; the new
`assertPaymentStillValid` guard and notification calls read only data already fetched
within the same tenant-scoped query (`cpf.salesOrder.payments`,
`cpf.salesOrder.consumerId`). No cross-tenant read or write was introduced.

## 13. Idempotency

- `startPreparing`/`markReadyForCollection`/`confirmCollection`/`reassign` called twice
  in a row: the second call's conditional `updateMany` matches zero rows and is handled
  as an already-resolved state, not retried or corrupted (pre-existing Sprint 37
  guarantee, re-verified by the full regression pass, §21).
- `confirmCollection` called twice: the second call's early `current.status ===
COLLECTED` branch returns the existing result without ever calling `fulfil()` again —
  proven both by the pre-existing mocked unit test ("5 concurrent confirmCollection
  calls → exactly one `fulfil()` call") and live (§18).
- Retried WhatsApp notification: `notifyReady`/`notifyCollected` are only ever reached
  from the winning-transition code path, which by construction runs exactly once per
  real transition — a retried HTTP request against an already-`READY_FOR_COLLECTION`/
  `COLLECTED` row takes the idempotent-replay branch and never reaches the notification
  call again (verified by a dedicated unit test, §16).

## 14. Concurrency

Four real-PostgreSQL scenarios, new this sprint
(`collection-point-fulfillment-concurrency.integration.spec.ts`), all passing:

- **Scenario A** — 5 genuinely concurrent `updateStatus` calls attempting
  `ASSIGNED → PREPARING` on the same row: exactly 1 winner, final state `PREPARING`.
- **Scenario B/C** — 5 genuinely concurrent `updateStatus` calls attempting
  `PREPARING → READY_FOR_COLLECTION`: exactly 1 winner, final state
  `READY_FOR_COLLECTION`.
- **Scenario C** — 5 genuinely concurrent `updateStatus` calls attempting
  `READY_FOR_COLLECTION → COLLECTED`, each with a distinct `collectedById`: exactly 1
  winner, and the final row's `collectedById` is exactly the winner's — never
  overwritten by a losing racer.
- **Scenario D** — 2 genuinely concurrent `reassignOutlet` calls to two DIFFERENT target
  outlets: Postgres row-level locking serializes them; the row's final state is always
  exactly one real, intended target outlet, never a torn or corrupted write.

Deliberately scoped to the repository's own atomic transition primitive rather than the
full service (which would additionally need Payment/InventoryStock/AccountingPeriod
fixtures) — justified in the test file's own doc comment by citing two other existing,
independent guarantees: Sprint 37.1's own proven stock-decrement atomicity test, and the
service-level mocked test proving `fulfil()` is called at most once per winning
transition. Combined, these three tests fully cover brief §29's four named scenarios.

## 15. Accounting & Settlement Findings

Audited explicitly, per the brief's own instruction to determine this before inventing
anything. **Finding: no new financial event is required.** The financial event of
record — the Sales Fulfilment accounting posting established in Sprint 10 — is already
triggered inside `SalesFulfilmentService.fulfil()`, which `confirmCollection` calls
unchanged. Collection Point assignment, preparation, and the Ready-for-Collection
transition are purely operational state and correctly post nothing. No settlement
mechanism between a Collection Point outlet and the organisation was requested by the
brief and none was built — explicitly deferred (§23).

## 16. Automated Tests

- `collection-point-fulfillment.service.spec.ts` — 6 new tests added (63 total in the
  file, all passing): notification sent on Ready, notification sent on Collected,
  payment guard rejects a `VOIDED` payment, payment guard rejects a `FAILED` payment, a
  `null` payment is correctly left unaffected by the guard, and a duplicate/idempotent
  confirmation never triggers a second notification. All 57 pre-existing tests in the
  file continue to pass unchanged.
- `whatsapp-consumer-notification.service.spec.ts` — 4 new tests: a successful send, an
  unknown consumer is logged and swallowed, a provider rejection is logged and
  swallowed, a thrown provider error is caught and swallowed.
- `d2c-ordering.service.spec.ts` — 2 new tests covering `fulfilmentStatus`/
  `collectionPointName` surfacing in both `listConsumerOrders` and `getConsumerOrder`.
- `collection-point-fulfillment-independence.spec.ts` — extended to assert
  `D2CMessagingModule` is imported, and to explicitly ban any import from `d2c/whatsapp/`
  or of the `WHATSAPP_PROVIDER`/`MetaWhatsAppProvider` tokens directly — proving the
  service genuinely never knows about WhatsApp specifics.
- `d2c-ordering-independence.spec.ts` — extended for the new
  `CollectionPointFulfillmentModule` import.
- `conversation.service.spec.ts` — updated for the widened `D2COrderingService`
  constructor; "My Orders" output now asserted to include the fulfilment status and
  Collection Point name lines.
- `collection-point-fulfillment-concurrency.integration.spec.ts` — new, 4 real-Postgres
  scenarios (§14).

## 17. Live WhatsApp Test

Performed against real Meta WhatsApp traffic (allow-listed test recipient, real
Business app in Meta's development mode), continuing directly from an order placed via
the same real conversation flow Sprint 41 live-verified:

1. A real new order (`SO-000035`) was created via real simulated WhatsApp webhook
   traffic through the unchanged Order Snacks flow.
2. A real OPay sandbox payment was completed by constructing and POSTing a correctly
   HMAC-SHA512-signed OPay success callback using the real `OPAY_SECRET_KEY` already in
   `.env` — simulating OPay's own server-to-server callback exactly as OPay's servers
   would send it, since the sandbox Cashier UI itself required real OPay wallet login
   credentials not available in this session.
3. The EXISTING, unmodified auto-assignment logic correctly assigned the order to
   "Bodija Supermart — Bodija Branch" by territory match — zero assignment code was
   touched this sprint.
4. The real, pre-existing mobile `/field/collection-point` UI (real rep login, no new
   frontend code) was used to drive **Start Preparing → Mark Ready for Collection →
   Confirm Collection**, including the real confirmation dialog.
5. A real WhatsApp message was delivered on Mark Ready for Collection with the real
   Collection Point name/address/hours; the real WhatsApp "Order collected!" message was
   delivered on Confirm Collection with a genuine Meta WAMID — both confirmed via the
   `MetaWhatsAppProvider`'s own "WhatsApp accepted message `wamid...`" log line, not just
   a database write.
6. The real WhatsApp "My Orders" flow was exercised afterward and correctly showed the
   live, current fulfilment status ("Ready for Collection" then "Collected") and the
   Collection Point name, exactly matching the brief's own example format — not a
   stale/cached value.

A transient, Meta-side `403`/code `131005` ("problem with the access token or
permissions") occurred mid-test shortly after a token refresh and self-resolved within
about two minutes — confirmed via a direct, bypass-the-app `curl` call against Meta's
Graph API reproducing the identical transient failure then succeeding on retry with the
same token, isolating it as a Meta propagation delay rather than an application defect.
A malformed, doubled `WHATSAPP_TOKEN` (a manual `.env` paste that appended rather than
replaced the previous value) also recurred mid-session and was diagnosed precisely by
byte-offset analysis and corrected.

## 18. Live Inventory Verification

Before: "Plantain Chips Classic Salted 500g" stock at the Bodija Branch inventory
location was 18 units. After `confirmCollection` won its status-flip race and called
`SalesFulfilmentService.fulfil()` exactly once, stock was confirmed at 16 units — a
decrement of exactly 2, matching the order's quantity, confirmed by direct database
query immediately before and after. No double-deduction occurred; a repeated/duplicate
confirmation attempt against the already-`COLLECTED` row made no further inventory
change, confirmed by re-querying stock after the duplicate attempt.

## 19. Live Order Verification

`SO-000035` remained the one authoritative `SalesOrder` throughout — no parallel order
or fulfilment record was ever created. The existing, unmodified admin order-detail page
(`/settings/d2c`, zero new admin code) was confirmed to already show every field the
brief required: Consumer (name, phone, territory), Order (code, date, total), Items,
Payment History (the recorded OPay payment), and a Collection Point section (assigned
Outlet, status, "Assigned"/"Ready since"/"Collected" timestamps) — all live and
correctly reflecting the real state reached during this test, with zero new admin UI
work.

## 20. Build, Typecheck & Lint

- `pnpm run build` — clean, no errors.
- `pnpm exec tsc --noEmit` — clean, no errors.
- `pnpm exec eslint src/d2c src/workflow/handlers` — clean, no warnings or errors.

## 21. Regression Results

Full regression pass, run after all live-verification `.env` toggling was reverted to
the safe local default:

- `pnpm exec jest` — **251 suites / 2273 tests passed**, 0 failed.
- `pnpm run test:integration` — **4 suites / 18 tests passed**, 0 failed (includes this
  sprint's 4 new concurrency scenarios alongside the pre-existing Sprint 37.1/40/41
  integration suites, all unaffected).

## 22. Known Limitations

- Consumer notifications are best-effort text messages only; there is no delivery
  receipt tracking or retry queue beyond what `WhatsAppProvider`/Meta itself provides.
- Collection verification relies on the operator checking the order number the consumer
  presents in person — no OTP/QR/digital proof-of-identity mechanism exists, matching
  the brief's own explicit scope exclusion.
- The "Exceptions" bucket of the conceptual New/Preparing/Ready/Collected/Exceptions
  queue is represented by the pre-existing `ASSIGNMENT_FAILED_NO_ELIGIBLE_OUTLET` audit
  trail on unassigned `SalesOrder`s (Sprint 37), not a dedicated first-class queue
  status column — unchanged and sufficient for the admin to find and manually assign
  these orders via the existing `assignManually` path.

## 23. Deferred Work

Explicitly out of scope per the brief and not built: a consumer mobile app, route
optimization/GPS/delivery logistics/home delivery, broadcast marketing messaging,
CRM/analytics, an AI chatbot, WhatsApp interactive buttons, a new payment provider, a new
loyalty/promotion architecture, a parallel inventory ledger, complex returns handling,
warehouse management, multi-stage logistics, and any Collection-Point/outlet financial
settlement mechanism (§15).

## 24. Files Changed

**New:**

- `apps/api/src/d2c/messaging/consumer-notification.port.ts`
- `apps/api/src/d2c/messaging/whatsapp-consumer-notification.service.ts`
- `apps/api/src/d2c/messaging/whatsapp-consumer-notification.service.spec.ts`
- `apps/api/src/d2c/messaging/d2c-messaging.module.ts`
- `apps/api/src/d2c/fulfillment/collection-point-fulfillment-concurrency.integration.spec.ts`
- `docs/sprint-42-completion-report.md` (this file)

**Modified:**

- `apps/api/src/d2c/fulfillment/collection-point-fulfillment.service.ts` — payment-still-valid
  guard; `notifyReady`/`notifyCollected`.
- `apps/api/src/d2c/fulfillment/collection-point-fulfillment.module.ts` — imports
  `D2CMessagingModule`.
- `apps/api/src/d2c/fulfillment/collection-point-fulfillment-independence.spec.ts` —
  extended guard.
- `apps/api/src/d2c/fulfillment/collection-point-fulfillment.service.spec.ts` — 6 new
  tests, widened constructor mocks.
- `apps/api/src/d2c/ordering/d2c-ordering.service.ts` — `listConsumerOrders`/
  `getConsumerOrder` surface fulfilment status/Collection Point name.
- `apps/api/src/d2c/ordering/d2c-ordering.types.ts` — `D2COrderResult.fulfilmentStatus`/
  `.collectionPointName`.
- `apps/api/src/d2c/ordering/d2c-ordering.module.ts` — imports
  `CollectionPointFulfillmentModule`.
- `apps/api/src/d2c/ordering/d2c-ordering-independence.spec.ts` — extended guard.
- `apps/api/src/d2c/ordering/d2c-ordering.service.spec.ts` — 2 new tests, widened
  constructor mock.
- `apps/api/src/d2c/conversation/conversation.service.ts` — "My Orders" shows
  fulfilment status/Collection Point name.
- `apps/api/src/d2c/conversation/conversation.service.spec.ts` — updated constructor
  call sites and "My Orders" assertions.

**Unchanged (confirmed, not modified):** every file under `apps/web/src/app/(app)/field/`
and `apps/web/src/app/(app)/settings/d2c/`, the Collection Point controller/repository,
the permission catalogue, and every inventory-domain file.

## 25. Confirmation: No Parallel System Was Created

No `WhatsAppCollectionPoint`, `ConsumerPickupLocation`, `D2CStore`, `D2COutlet`, parallel
fulfilment status system, parallel inventory ledger, or new WhatsApp sending mechanism
was created. `SalesOrder` remains the one authoritative order record;
`CollectionPointFulfillmentStatus` remains the one authoritative fulfilment state;
`SalesFulfilmentService.fulfil()` remains the one inventory-deducting write path; the
existing `WHATSAPP_PROVIDER` token remains the one outbound WhatsApp sending mechanism.
The only new code this sprint is the narrow `ConsumerNotificationPort` abstraction (an
interface, not a system) and two small, additive read-surfacing changes to "My Orders."
