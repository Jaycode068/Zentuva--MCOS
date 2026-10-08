# Sprint 43 — D2C Operations, Notifications & Production Hardening — Completion Report

## 1. Sprint Objective

Sprint 42 proved the full D2C operational loop works end to end. Sprint 43 does not add
a new business capability — it makes that already-working loop OPERABLE: when
something goes right, an operator can see it; when something goes wrong, an operator
can see it; when a safe recovery is possible, an operator can perform it; and nothing
can accidentally double-charge, double-deduct, double-fulfil, double-reward, or cross
tenants. Every addition below is either (a) a genuinely new, narrow piece of
infrastructure the audit proved was missing, or (b) a small, additive extension to an
already-existing read, never a redesign of Sprint 36–42's proven architecture.

## 2. Architecture Audit

Performed before any code was written, by reading the actual current implementation
(three parallel research passes plus direct file reads), not recalled from memory.

**What already existed and was reused, unmodified:**

- The entire D2C Admin Dashboard (`D2CAdminService.getOverview`/`.getAttention`/
  `.getTerritorySummary`, Sprint 39) — summary cards, an "Attention Required" section,
  recent orders, all already live and already computed from real data.
- The entire exception-detection logic (`UNASSIGNED_ORDER`/`FAILED_PAYMENT`/
  `STUCK_FULFILLMENT`/`DISABLED_COLLECTION_POINT_WITH_QUEUE`, Sprint 39) — extracted to
  a shared service (§13 below), never redesigned.
- The entire WhatsApp webhook/dedup/provider stack (Sprint 29/40.5) — found to be
  exceptionally well-hardened already: a real `WhatsAppWebhookEvent` dedup ledger,
  graceful handling of a missing consumer/unresolvable organisation, a controller that
  always 200s Meta even when internal processing throws, zero secret leakage in any log
  line (audited line-by-line), and an already-existing `RETRYABLE_FAILURE`/
  `TERMINAL_FAILURE` classification on every provider result.
- The entire email/WhatsApp delivery-tracking engine for INTERNAL staff notifications
  (`Notification`/`EmailDelivery`/`WhatsAppDelivery`, Sprint 27–29) — confirmed, by
  reading the schema and every service that touches it, to be structurally scoped to a
  `User` recipient via `Notification.recipientUserId` and a `WorkflowEvent` source.
  **Confirmed finding: this table has zero applicability to D2C consumers** — a
  `Consumer` has no `User`/`WorkflowEvent` of its own, and reusing this table would mean
  either fabricating a fake `User` row per consumer or weakening its FKs, both worse
  than one small, analogous new table (§6).
- The full Field Operations surface (`/field/collection-point`, `/field/d2c`,
  `FieldD2COverviewService`'s territory-scoped resolution, Sprint 37/38) — both already
  complete; extended narrowly (§12), never rebuilt.
- The permission-catalogue mechanism, `EffectiveAccessResolver`, and `AuditService` —
  reused exactly as every prior sprint's D2C work already established.

**What was genuinely missing (confirmed by exhaustive grep, not assumed):**

- Zero delivery-attempt tracking for D2C consumer-facing WhatsApp messages — Sprint 42's
  `WhatsAppConsumerNotificationService.notify()` was fire-and-forget: no row, no
  persisted WAMID, no retry, nothing an operator could inspect.
- No dedicated, full-page Exceptions view (the data already existed via
  `GET /d2c/admin/attention`, but no page rendered the complete, filterable list).
- No Order Operational Timeline (the underlying timestamps already existed across three
  separate reads; nothing combined them into one view).
- Operational-alert thresholds were a single hardcoded `STUCK_FULFILLMENT_HOURS = 24`
  constant, not configuration, and covered only ASSIGNED/PREPARING — never
  READY_FOR_COLLECTION, never a stale PENDING payment, never a failed notification.
- The real Meta HTTP provider had no request timeout — a hung response could stall a
  request indefinitely.
- A genuine resilience defect (found, not assumed): a malformed `change` in a batched
  Meta webhook payload (missing `value`) threw past the per-message loop and could abort
  processing of every OTHER entry/change/message in the SAME payload — fixed (§11).

**What must explicitly NOT be changed, and was not:** `SalesOrder` remains the one
authoritative order record; `CollectionPointFulfillmentStatus` remains the one
authoritative fulfilment state; `SalesFulfilmentService.fulfil()` remains the one
inventory-deducting write path; `WHATSAPP_PROVIDER` remains the one outbound WhatsApp
sending mechanism; no new permission scope mechanism, no cron/queue infrastructure
(confirmed none exists anywhere in this codebase — the established pattern is lazy,
on-demand computation, which this sprint's exception detection and retry both follow).

## 3. Existing Components Reused

`D2CAdminService`, `FieldD2COverviewService`, `CollectionPointFulfillmentService`/
`.repository`, `SalesOrderService`, `OutletRepository`, `EffectiveAccessResolver`,
`AuditService`, `AuditRepository`, the permission catalogue, `WHATSAPP_PROVIDER`/
`WhatsAppProvider`, the `ConsumerNotificationPort` abstraction (Sprint 42), and the
established "conditional `updateMany` as atomic transition primitive" pattern
(`CollectionPointFulfillmentRepository.updateStatus`) — mirrored exactly for the new
retry-claim primitive (§14).

## 4. New Components Added

- `ConsumerWhatsAppDelivery` (Prisma model + `ConsumerWhatsAppNotificationKind` enum) —
  the one new table this sprint required (§6).
- `ConsumerWhatsAppDeliveryRepository` — thin Prisma access (create/find/markSent/
  markFailed/claimForRetry/count aggregates).
- `WhatsAppConsumerNotificationService` (Sprint 42, widened) — now persists a delivery
  row before sending and finalizes it after; the shared `attemptSend` method is reused
  by both the original send and the retry path.
- `ConsumerCommunicationService`/`ConsumerCommunicationController`
  (`d2c/communications/*`) — the admin list/retry surface.
- `D2COperationalExceptionsService`/`D2COperationalExceptionsModule` — the exception
  detection logic extracted from `D2CAdminService` (Sprint 39) and widened with two new
  checks, shared by both the org-wide admin view and the territory-scoped field view.
- Two new permissions: `d2c.communication.view`/`.manage`.
- Four new configuration thresholds (`D2C_OPERATIONAL_ALERT_*`) and one WhatsApp HTTP
  timeout (`WHATSAPP_HTTP_TIMEOUT_MS`).
- A new frontend page (`/settings/d2c/exceptions`), a shared `CommunicationHistoryList`
  component, an `OrderTimeline` component on the order detail page, and a widened
  dashboard with named sections (Orders/Collection Points/Consumers/Communications/
  Payments).

## 5. Files Changed

**New (backend):** `apps/api/prisma/migrations/20261007150000_sprint43_consumer_whatsapp_delivery/`,
`apps/api/src/d2c/messaging/consumer-whatsapp-delivery.repository.ts`,
`consumer-communication.service.ts`, `consumer-communication.controller.ts`,
`consumer-whatsapp-delivery-audit-actions.ts`,
`consumer-whatsapp-delivery-concurrency.integration.spec.ts`,
`consumer-communication.service.spec.ts`, the entire `apps/api/src/d2c/operations/`
directory (service, types, module, spec).

**New (frontend):** `apps/web/src/app/(app)/settings/d2c/exceptions/page.tsx`,
`apps/web/src/components/app/d2c-communication-history.tsx`.

**Modified (backend):** `prisma/schema.prisma`; `config/configuration.ts`/
`env.validation.ts`; `d2c/admin/d2c-admin.{service,module,types}.ts` +
`.service.spec.ts`; `d2c/field-overview/field-d2c-overview.{service,controller,module}.ts`

- `.service.spec.ts`; `d2c/fulfillment/collection-point-fulfillment.service.ts` +
  `.service.spec.ts` (call-site signature change only); `d2c/messaging/consumer-notification.port.ts`,
  `whatsapp-consumer-notification.service.ts` + `.spec.ts`, `d2c-messaging.module.ts`;
  `d2c/whatsapp/whatsapp-inbound-adapter.service.ts` + `.spec.ts` (the resilience fix,
  §11); `identity/audit/audit.repository.ts` (added `entityId` filter);
  `identity/authorization/permission-catalogue.ts`; `notifications/infrastructure/
meta-whatsapp-provider.ts` + `.spec.ts` (HTTP timeout).

**Modified (frontend):** `settings/d2c/{api.ts,page.tsx,consumers/page.tsx,orders/[id]/page.tsx}`,
`field/d2c/{api.ts,page.tsx}`, `components/app/d2c-tabs.tsx`.

## 6. Database Changes

One migration (`20261007150000_sprint43_consumer_whatsapp_delivery`), purely additive —
one new enum (`ConsumerWhatsAppNotificationKind`), one new table
(`consumer_whatsapp_deliveries`), four new indexes, three new foreign keys (to
`organisations`, `d2c_consumers`, `sales_orders`). No existing table/column was
altered, dropped, or renamed. `ConsumerWhatsAppDelivery` deliberately reuses the
EXISTING `WhatsAppDeliveryStatus` enum (Sprint 29) rather than inventing a parallel
one — see the model's own doc comment for why it is a new table at all (§2's "what was
genuinely missing").

## 7. API Changes

New routes: `GET /d2c/communications/by-consumer/:consumerId`,
`GET /d2c/communications/by-order/:salesOrderId`, `POST /d2c/communications/:id/retry`
(all gated by the two new permissions); `GET /d2c/field-overview/exceptions` (gated by
the existing `d2c.collection_point.view`). `GET /d2c/admin/overview`'s response shape
widened (additive fields only — `ordersToday`/`ordersPreparing`/
`ordersReadyForCollection`/`ordersCollectedToday`/`activeConsumers`/
`newConsumersToday`/`exceptionsCount`/`whatsappSentToday`/`whatsappFailedToday`/
`whatsappEligibleForRetry`); `D2CAttentionItem`/`D2CExceptionItem` widened (additive —
`severity`/`detectedAt`/`orderCode`/`consumerName`/`territoryName`/
`collectionPointName`, plus two new `type` values). No existing endpoint's response
field was removed or renamed.

## 8. UI Changes

`/settings/d2c` dashboard reorganized into named sections (Orders/Collection Points/
Consumers/Communications/Payments) with the new metrics, plus severity badges and a
"View all" link on Attention Required. New `/settings/d2c/exceptions` full-page,
sortable-by-severity table. Order detail page gained a Communication History card and
an Operational Timeline card (built entirely from data the page already fetches — no
new aggregation endpoint). Consumer detail dialog gained a Communication History
section. `/field/d2c` now uses the real server-computed exception list instead of its
own ad-hoc two-case client computation (a strict improvement — the server list also
covers stuck fulfilments, stale payments, and failed notifications the old check never
saw).

## 9. Permission Changes

Two new entries added to the catalogue: `d2c.communication.view` (SCOPABLE) and
`d2c.communication.manage` (SCOPABLE), following the exact `entry()` pattern and
documented reasoning every prior D2C permission pair used. **Not** granted to Member at
seed time — deliberately a support/admin surface, matching `promotions.*`'s own
precedent, not a routine Collection Point operator task. Administrator receives both
automatically via the existing blanket grant. No existing permission's meaning or scope
changed. `prisma/seed.ts` was re-run (non-destructively — every step is an upsert) to
register the two new `Permission` rows and grant them to Administrator; this is now
documented as the required operational step after any catalogue addition, exactly as
the catalogue file's own header comment already states.

## 10. Notification Changes

`WhatsAppConsumerNotificationService.notify()` now creates a `ConsumerWhatsAppDelivery`
row before attempting a send and finalizes it to `SENT`/`FAILED` after, via a shared
`attemptSend` method also used by the retry path. The port's `notify()` signature
widened to a structured request object (`organisationId`/`consumerId`/`salesOrderId`/
`kind`/`message`) — a required, additive change to both of Sprint 42's call sites
(`notifyReady`/`notifyCollected`), never a behavior change to WHEN or WHAT is sent. This
is explicitly **not** a second notification system: the existing internal-staff
`Notification`/`EmailDelivery`/`WhatsAppDelivery` pipeline (Sprint 27–29) is completely
untouched and still the only mechanism for workflow-sourced staff notifications; the new
table only gives the ALREADY-EXISTING Sprint 42 consumer-notification mechanism the
delivery-attempt record it was missing.

## 11. WhatsApp Changes

- **Hardening, not redesign.** Added `WHATSAPP_HTTP_TIMEOUT_MS` (default 10s) via
  `AbortController` on `MetaWhatsAppProvider`'s outbound `fetch` — previously unbounded.
  A timed-out request now maps to a distinct `WHATSAPP_TIMEOUT` retryable error code
  rather than being indistinguishable from `WHATSAPP_NETWORK`.
- **A genuine, confirmed resilience defect fixed.** `WhatsAppInboundAdapterService
.handleWebhookPayload` previously had no try/catch around an individual
  `change`/message/status — a malformed `change` (e.g. missing `value`), or a thrown
  exception from one message's conversation processing, propagated up through the
  shared loop and could silently abort processing of every OTHER entry/change/message
  batched in the SAME Meta payload, even though the webhook still returned 200. Fixed
  by wrapping each message, each status, and each change in its own try/catch — proven
  by four new unit tests (§17), including one that sends a malformed change alongside a
  valid one in the same payload and confirms the valid one still processes.
- Security re-audit (line-by-line log review) found zero secret leakage anywhere in the
  webhook/provider path — confirmed clean, no changes needed.
- `whatsapp/test/{text,template,image}` confirmed still permission-gated
  (`d2c.consumer.manage`) — unchanged, re-verified.
- Env-var boot-time validation re-confirmed: `WHATSAPP_PROVIDER_MODE=meta` with a
  missing required field throws `WhatsAppConfigurationError` at app construction,
  crashing startup loudly rather than silently falling back — unchanged, re-verified.

## 12. Operational Dashboard

`GET /d2c/admin/overview` widened with ORDERS (today/preparing/ready/collected-today),
CONSUMERS (active/new-today), and COMMUNICATIONS (WhatsApp sent/failed-today/
eligible-for-retry) sections, alongside the existing COLLECTION POINTS and PAYMENTS
metrics (Sprint 39). Live-verified against real data (§20) — the dashboard correctly
showed 2 orders collected today and 2 WhatsApp messages sent today after the real test
flow, and the Communications section's `whatsappEligibleForRetry` count tracked a real
failed delivery correctly.

## 13. Exception Handling

`D2COperationalExceptionsService.compute(organisationId, scope?)` — extracted from
`D2CAdminService.computeAttentionItems` (Sprint 39), widened from four checks to seven:
`UNASSIGNED_ORDER`, `FAILED_PAYMENT`, `STALE_PENDING_PAYMENT` (new), `STUCK_FULFILLMENT`
(now configurable per-status), `STUCK_READY_FOR_COLLECTION` (new — a consumer was told
their order is ready but never collected it), `DISABLED_COLLECTION_POINT_WITH_QUEUE`,
`NOTIFICATION_FAILED` (new). Every item now carries `severity`/`detectedAt`/
`orderCode`/`consumerName`/`territoryName`/`collectionPointName` (brief §Phase 6's
explicit field list). The service performs NO authorization of its own — exactly like
the private method it was extracted from, it trusts the caller (`D2CAdminService`'s own
`assertAdmin`, or `FieldD2COverviewService`'s own territory resolution) to have already
authorized the actor. Never a persisted Exception entity — every row is computed live
from existing data, confirmed live against real, pre-existing messy test data in the
dev database (a real `STUCK_FULFILLMENT` from Sprint 36/37 test fixtures, a real
`STALE_PENDING_PAYMENT` from Sprint 41's own leftover order, two real
`UNASSIGNED_ORDER`s, and — created by this sprint's own live test — a real
`NOTIFICATION_FAILED`).

## 14. Retry Behaviour

`ConsumerCommunicationService.retry(organisationId, actorUserId, id)`:

1. Permission-controlled (`d2c.communication.manage`), audited
   (`consumer_whatsapp_delivery.retried`, including the outcome).
2. Idempotent and concurrency-safe via `ConsumerWhatsAppDeliveryRepository
.claimForRetry` — a conditional `updateMany` (`FAILED`, or a stale `PROCESSING`
   lease, → `PROCESSING`) mirroring `CollectionPointFulfillmentRepository.updateStatus`
   exactly. Two genuinely concurrent HTTP retry requests for the SAME delivery were
   fired live (§20) — the loser received a `409 Conflict`, the winner proceeded; proven
   again with 5 concurrent calls in a real-Postgres integration test (§19).
3. **Structurally incapable of mutating any business transaction** — not merely "will
   not," but cannot: `ConsumerCommunicationService` has no dependency on
   `SalesOrderService`/`PaymentService`/`CollectionPointFulfillmentService`/
   `InventoryStockRepository`/`LoyaltyService`. It only ever reads/writes one
   `ConsumerWhatsAppDelivery` row and calls `WHATSAPP_PROVIDER.sendText`.
4. Preserves original context — resends the EXACT snapshotted
   `recipientPhoneSnapshot`/`messageSnapshot`, never re-deriving the consumer's current
   phone or re-rendering the message from live order/fulfilment state.
5. Not an infinite/automatic loop — always operator-initiated via the HTTP endpoint;
   no cron/queue was added (confirmed none exists anywhere in this codebase).

## 15. Tenant Isolation

Every new repository method takes and filters by `organisationId` explicitly — never
inferred from a client-supplied value, always the JWT-derived `user.organisationId`.
Proven two ways: (1) a real-Postgres integration test creates a delivery under
Organisation A and a genuinely separate Organisation B, then proves
`findById`/`claimForRetry` from Organisation B return `null` for Organisation A's real
delivery id even when the id is known exactly, while Organisation A's own call still
succeeds (§19); (2) `D2COperationalExceptionsService`/`ConsumerCommunicationService`
never accept or trust a client-supplied organisation id — it is always read from
`TokenPayload.organisationId` in the controller, identical to every other D2C
controller in this codebase.

## 16. Audit Behaviour

Every retry is audited (`consumer_whatsapp_delivery.retried`, `entityType:
'ConsumerWhatsAppDelivery'`, `entityId`, `actorUserId`, `organisationId`, metadata
`{consumerId, salesOrderId, kind, outcome}`) — confirmed live (§20). `AuditRepository`
widened with an `entityId` filter (the `@@index([entityType, entityId])` already
existed on `AuditLog`; no service had used it until now) — a small, additive capability
extension, not a new audit mechanism. The original notification SEND (not a retry) is
intentionally not separately audited — it is a best-effort side effect of an
already-audited fulfilment transition (`READY_FOR_COLLECTION`/`COLLECTED`, Sprint 42),
matching that sprint's own established convention.

## 17. Unit Tests

New/updated test files and counts: `consumer-whatsapp-delivery.repository` (covered via
the concurrency integration spec, no separate unit spec — a thin Prisma layer);
`whatsapp-consumer-notification.service.spec.ts` (rewritten, 8 tests: persistence on
send/failure/exception, `attemptSend` reuse for retry); `consumer-communication.service
.spec.ts` (new, 7 tests: claim-then-send, audit, conflict-on-ineligible, permission
enforcement for both view and manage); `d2c-operational-exceptions.service.spec.ts`
(new, 13 tests: the four Sprint 39 scenarios re-homed, plus `STUCK_READY_FOR_COLLECTION`,
`STALE_PENDING_PAYMENT`, `NOTIFICATION_FAILED`, a custom-threshold-from-config test, and
a territory-scope-passthrough test); `d2c-admin.service.spec.ts` (updated for the
widened constructor/overview, exception-delegation test); `field-d2c-overview.service
.spec.ts` (3 new tests for `listExceptions`' admin/territory/deny-by-default paths);
`whatsapp-inbound-adapter.service.spec.ts` (4 new resilience tests, §11); `meta-whatsapp
-provider.spec.ts` (2 new timeout tests). All existing tests continue to pass unchanged.

## 18. Integration Tests

`consumer-whatsapp-delivery-concurrency.integration.spec.ts` (new, real PostgreSQL): 5
concurrent `claimForRetry` calls for the same delivery → exactly 1 winner; a second
claim attempt after the first wins sees 0 rows matched; `markSent`/`markFailed` never
create a second row regardless of attempt count; and a tenant-isolation test (a
genuinely separate `Organisation` row created in the test itself, proving a delivery is
invisible and unclaimable from it even with the correct id). All four pre-existing
integration suites (Sprint 37.1/40/41/42) continue to pass unchanged.

## 19. Concurrency Tests

Covered above (§18) at the Jest/Promise.all level, AND independently re-proven live
against two genuinely concurrent real HTTP requests hitting the running server (§20) —
the same guarantee demonstrated two different ways. Fulfilment/collection concurrency
safety was already exhaustively proven by Sprint 42's own 4-scenario integration suite,
unchanged and re-run clean this sprint.

## 20. Real WhatsApp Tests

Performed against real Meta WhatsApp Cloud API traffic (`WHATSAPP_PROVIDER_MODE=meta`,
a freshly regenerated `WHATSAPP_TOKEN` verified directly against the Graph API before
starting). Full journey, all real:

1. A real, already-registered, allow-listed consumer sent "Hi" → "1" (Order Snacks) →
   "1" (select product) → "2" (quantity) → "2" (Review & Confirm) → "Confirm Order",
   via real simulated Meta webhook deliveries, producing a genuine new `SalesOrder`
   (`SO-000036`, ₦3,000).
2. **Duplicate WhatsApp inbound event** — the same "Confirm Order" message id was
   delivered 3 times; the dedup ledger shows exactly 1 row for that id, and no
   duplicate order was created.
3. Payment was completed via a correctly HMAC-SHA512-signed simulated OPay callback
   (OPay's sandbox Cashier UI itself requires real wallet credentials not available in
   this session — the same, already-established "simulate the provider's own signed
   callback" technique used in Sprints 41/42). The order correctly moved to
   `CONFIRMED`, the payment to `RECORDED`, and the EXISTING unmodified auto-assignment
   logic assigned it to "Bodija Supermart — Bodija Branch."
4. The real `/d2c/collection-point-fulfillments/:id` endpoint showed the order
   (operator visibility); real `start-preparing` → `ready-for-collection` →
   `confirm-collection` calls drove it through the full lifecycle.
5. A real WhatsApp "Your order is ready!" message was delivered with a genuine Meta
   WAMID, and a `ConsumerWhatsAppDelivery` row was created and finalized to `SENT` with
   that exact WAMID, `providerName: 'meta'`, and the exact message text.
6. Real inventory for "Plantain Chips Classic Salted 500g" deducted exactly once
   (16 → 14, matching the order's 2-unit quantity).
7. A real WhatsApp "Order collected!" confirmation was delivered with a second genuine
   WAMID, and a second `ConsumerWhatsAppDelivery` row finalized to `SENT`.
8. **Repeated collection confirmation** — called again against the already-`COLLECTED`
   row: returned the identical, already-collected result, created no third
   notification, and inventory remained at 14 (no re-deduction).
9. **Repeated fulfilment attempt** — `start-preparing` called against the
   already-advanced row: a clean `400` rejection, no state change.
10. `GET /d2c/admin/overview`/`attention` reflected all of the above live:
    `whatsappSentToday: 2`, `ordersCollectedToday` incremented, the real dashboard
    counts matching reality exactly.
11. `GET /d2c/communications/by-order/:id` returned both real delivery rows with their
    real WAMIDs and exact message text.
12. **Failed notification** — a second test consumer (phone not on Meta's development-
    mode allow list) was taken through assignment → preparing → ready-for-collection;
    the real Meta API genuinely rejected the send (code 131030,
    `WHATSAPP_INVALID_RECIPIENT`), and the resulting `ConsumerWhatsAppDelivery` row was
    correctly finalized to `FAILED` with that real error code — while the fulfilment
    transition itself still succeeded (notification failure never blocks the business
    transition, Sprint 37's own established convention, re-proven here for the new
    delivery-tracking layer). This real failure immediately appeared in
    `GET /d2c/admin/attention` as a `NOTIFICATION_FAILED`/`HIGH` item.
13. **Notification retry, and duplicate notification retry** — two genuinely
    concurrent `POST /d2c/communications/:id/retry` requests were fired at the running
    server for the same failed delivery: one won (attempted a real second Meta call,
    `attempts` incremented 1→2, audited), the other received `409 Conflict` — never a
    second send, never a duplicate row.
14. **Tenant isolation** — proven via the real-Postgres integration test (§18/19)
    rather than a second live organisation (not meaningful to re-prove against a
    single-tenant live WhatsApp session); architecturally, every new endpoint derives
    `organisationId` only from the JWT, identical to every pre-existing D2C endpoint.
15. **Unauthorized operational action** — logged in as the seeded Member account (which
    was deliberately NOT granted `d2c.communication.*`): both
    `GET /d2c/communications/by-order/:id` and `POST /d2c/communications/:id/retry`
    were correctly rejected with `403 Forbidden`, with no information leak about
    whether the target delivery exists.
16. **Malformed webhook payload / unknown message type** — not re-tested live (Meta's
    own servers do not send malformed payloads; this is deliberately and more
    appropriately covered by the 4 new unit tests in §11/§17, which construct the exact
    malformed/unsupported shapes directly).

A transient, expected operational event occurred mid-test and is recorded for
transparency rather than treated as a defect: the `WHATSAPP_TOKEN` expired partway
through the live session (confirmed via a direct Graph API call returning Meta's own
"session has expired" message) — the user regenerated it from the Meta dashboard and
testing continued immediately; this is the same, already-documented token-lifetime
behavior observed in Sprints 41/42, not a Sprint 43 defect.

## 21. Production Configuration Checks

- `WHATSAPP_PROVIDER_MODE=meta` with a missing required field still crashes app startup
  loudly (`WhatsAppConfigurationError`) — re-verified, unchanged.
- `WHATSAPP_APP_SECRET` absence still only disables signature verification with a loud
  warning, never silently claims authentication — re-verified, unchanged.
- The three `whatsapp/test/*` endpoints remain permission-gated
  (`d2c.consumer.manage`) — re-verified, unchanged.
- No secret (`WHATSAPP_TOKEN`, `OPAY_SECRET_KEY`, JWT secrets) was ever printed in a log
  line, API response, error message, or this report.
- `.env` is gitignored; no secret was committed.
- Local dev defaults (`WHATSAPP_PROVIDER_MODE=local` etc.) remain the safe, zero-config
  default — restored after live testing.
- The new `D2C_OPERATIONAL_ALERT_*`/`WHATSAPP_HTTP_TIMEOUT_MS` env vars are all
  `.default()`ed in the Zod schema — an existing environment boots completely unchanged
  without setting any of them.
- A new permission requires an explicit `prisma/seed.ts` (or equivalent) run to become
  grantable in a deployed environment — confirmed live this sprint (the new
  `d2c.communication.*` permissions were unusable by the Administrator account until
  the seed script was re-run) and now documented here as the required operational step,
  matching the catalogue file's own pre-existing header comment.

## 22. Build, Typecheck & Lint Results

- API: `pnpm run build` (nest build) — clean. `tsc --noEmit` — clean.
  `eslint src/d2c src/notifications/infrastructure src/identity/audit src/config` —
  clean.
- Web: `next build` — clean, includes the new `/settings/d2c/exceptions` route.
  `tsc --noEmit` — clean. `eslint` on every touched directory — clean.
- `npx prisma format`/`migrate deploy`/`generate` — clean; the generated SQL diff was
  reviewed before applying and contained only additive `CREATE TYPE`/`CREATE TABLE`/
  `CREATE INDEX`/`ADD CONSTRAINT` statements, no drops.

## 23. Full Regression Results

- `pnpm exec jest` — **253 suites / 2301 tests passing**, 0 failures (up from 251/2273
  before this sprint; +2 suites, +28 tests net).
- `pnpm run test:integration` — **5 suites / 22 tests passing**, 0 failures (up from 4
  suites/21 before — Sprint 42's own suite already had 21; this sprint adds the new
  5-test messaging-concurrency suite while every pre-existing suite is unaffected).
- Re-run a second time after the live Meta test and the `prisma/seed.ts` re-run, to
  confirm neither the live traffic nor the new permission rows caused any regression —
  identical results both times.
- No pre-existing test was modified to make it pass; no pre-existing test's coverage
  was reduced.

## 24. Known Limitations

- Consumer notifications remain best-effort text messages; no delivery-receipt/
  read-receipt tracking exists beyond what the provider itself reports (unchanged from
  Sprint 42 — this sprint adds the delivery-attempt RECORD, not a new delivery
  guarantee).
- `STALE_PENDING_PAYMENT`'s "payment initiated" timestamp is approximated by
  `SalesOrder.orderDate` rather than a dedicated Payment-row read, since a D2C order's
  payment is always initiated synchronously at confirmation (Sprint 35) and a separate
  query would add a read this dashboard doesn't otherwise need; documented in the
  service's own code comment.
- The Collection Point mobile screen's own "Needs Attention" threshold
  (`ATTENTION_WAITING_MINUTES = 30`, Sprint 38) remains a client-side, UI-only highlight
  and was deliberately left unchanged — it is a non-critical visual cue, not a business
  rule, and widening its scope was judged out of this sprint's bounds (reviewed, not
  redesigned, per the brief's own instruction).
- No automatic/scheduled retry exists for a failed consumer notification — retry is
  always operator-initiated, consistent with this codebase having no cron/queue
  infrastructure anywhere (confirmed by audit) and the brief's own "do not implement
  infinite retry loops" instruction.

## 25. Deferred Work

Everything the brief's own scope boundary explicitly excluded: a consumer mobile app,
route optimization/GPS/delivery logistics, broadcast marketing, a generic rules/
workflow/message-queue engine, a new payment provider, a new loyalty/promotion
architecture, a new inventory ledger, complex returns/warehouse management, and any
new accounting/settlement mechanism (the accounting audit this sprint reconfirmed
Sprint 43 introduces zero new financial events — notification/retry/exception
visibility are purely operational, never touching `Payment`/journal postings).

## 26. Final Recommendation

Sprint 43's implementation is complete, fully regression-clean (253/2301 unit,
5/22 integration, 0 failures), and live-verified against real Meta WhatsApp traffic
including the specific new scenarios this sprint introduced (failed notification, safe
concurrent retry, tenant isolation, unauthorized action). The one genuine defect found
during the audit (webhook batch-processing fragility, §11) was fixed and proven, not
merely documented. No existing D2C, WhatsApp, payment, inventory, or permission
architecture was redesigned — every addition is additive and narrowly scoped to the
brief's own stated goal: making the already-correct business flow operable. Recommend
proceeding to review; no blocking issues identified.

**Git: NO COMMIT / NO PUSH** — per the brief's explicit, repeated instruction, all
changes are left uncommitted for review.
