# Stage 5A — WhatsApp D2C & Collection Point MVP Readiness Assessment

Read-only. No code, schema, or database changes; no tenant created; no messages
sent. All findings below are backed by direct code citations (verified by reading
the cited files, several independently re-confirmed by me after the research pass).

## 1. Executive readiness verdict

**Not yet ready for an unconditional launch — but close.** The core mechanism is
unusually solid for an MVP: real payment capture (OPay), real Meta WhatsApp HTTP
integration (not a stub), idempotent order creation, atomic stock-decrement
concurrency protection, and the most thoroughly tenant-isolation-tested module in
the codebase (Sprint 44's conversation configuration). The consumer journey the
brief describes is mechanically implemented end-to-end today, with most steps
proven by real-Postgres integration tests, not just mocks.

Two concrete issues block an unconditional "go": **one code defect** (proactive
"ready for pickup"/"collected" notifications will silently and permanently fail
for any order that takes longer than Meta's 24-hour session window to prepare —
a common, not edge-case, timing in a manufacturing business) and **one
configuration gap** (`WHATSAPP_APP_SECRET` is unset, so webhook signature
verification is currently disabled). Both are small to resolve — one bounded code
change plus Meta template approval lead time, one environment variable — not a
feature-development effort. Everything else found is a real but containable
operational risk (no stock reservation, no refund mechanism, single shared
WhatsApp number across tenants) that the MVP can launch with, provided it is
launched with eyes open and the stated mitigations.

**With the P0s closed and the P1s acknowledged, Boby Bites can launch a safe,
functional MVP without new feature development** — this is a configuration,
verification, and one scoped-fix exercise, not a build-more-features exercise.

## 2. Implemented capability inventory

| Capability                                                               | Classification                                                                                                                                          | Key evidence                                                                                                                                                                           |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WhatsApp inbound webhook (verify handshake, signature check, always-200) | Implemented (signature check has a documented bypass when secret unset — **currently active in this env**)                                              | `d2c/whatsapp/whatsapp-webhook.controller.ts` (`verify`, `receive`, `verifySignature`); `whatsapp-webhook.controller.spec.ts`                                                          |
| Webhook dedup (redelivered Meta webhooks)                                | Implemented                                                                                                                                             | `whatsapp-webhook-event.repository.ts:tryClaim`; real-Postgres `whatsapp-webhook-event-concurrency.integration.spec.ts`                                                                |
| Conversation routing (`ConversationService`)                             | Implemented, correctly org-scoped                                                                                                                       | `d2c/conversation/conversation.service.ts:handleInboundMessage/dispatch`; `conversation.service.spec.ts`                                                                               |
| Tenant-scoped conversation config (Sprint 44)                            | Implemented, most thoroughly tenant-isolation-tested module found                                                                                       | `d2c/conversation-config/d2c-conversation-config.service.ts`; two real-Postgres specs (§5)                                                                                             |
| Consumer identity/registration                                           | Implemented — explicit registration, not auto-on-first-contact                                                                                          | `d2c/consumer/consumer.service.ts:registerConsumer`; `consumer.repository.ts:findOrCreate`                                                                                             |
| WhatsApp phone → organisation mapping                                    | Partially implemented — no dedicated mapping table; single shared Meta number, ambiguous-phone fallback                                                 | `d2c/whatsapp/whatsapp-organisation-resolver.service.ts`                                                                                                                               |
| Product discovery/catalogue (consumer)                                   | Implemented, no pagination/search                                                                                                                       | `d2c/ordering/d2c-ordering.service.ts:getAvailableProducts/isOrderable`                                                                                                                |
| D2C ordering (creates a real `SalesOrder`)                               | Implemented, idempotent                                                                                                                                 | `d2c-ordering.service.ts:confirmOrder` → `sales/sales-order.service.ts:createForConsumer`; real-Postgres `d2c-ordering-concurrency.integration.spec.ts`                                |
| Order confirmation & status                                              | Implemented, synchronous, live reads (never stale cache)                                                                                                | `conversation.service.ts:handleAwaitingConfirm/showMyOrders`                                                                                                                           |
| Consumer account/profile                                                 | Partially implemented — read-only via WhatsApp; write (name/email/address) is admin-HTTP-only; location is the only consumer-self-service write         | `d2c/consumer/consumer.controller.ts` (doc comment: "INTERNAL/ADMIN ONLY"); `conversation.service.ts` `MY_ACCOUNT`/`UPDATE_LOCATION` branches                                          |
| Payment (OPay)                                                           | Implemented, real provider integration; **no refund mechanism anywhere**                                                                                | `d2c/payment/d2c-payment.service.ts`; `payments/infrastructure/opay-payment-provider.ts`                                                                                               |
| Sales/inventory integration at fulfilment                                | Implemented — D2C reuses the exact same stock-decrement + COGS/FG posting path as B2B, no parallel/separate logic                                       | `d2c/fulfillment/collection-point-fulfillment.service.ts:confirmCollection` → `sales/sales-fulfilment.service.ts:fulfil()`                                                             |
| Territory/location selection                                             | Implemented, manual selection only (never address/GPS-derived)                                                                                          | `conversation.service.ts:resolveBranchPoint`; `consumer.service.ts:updateConsumerLocation`                                                                                             |
| Collection Point creation/config                                         | Implemented — additive columns on `Outlet`, not a separate entity; no hardcoded tenant assumptions in code                                              | `retail/outlet/outlet.service.ts:enableCollectionPoint/disableCollectionPoint/updateCollectionPointConfig`                                                                             |
| Collection Point stock                                                   | Implemented — **always organisation-owned**, never customer-owned; populated by manual opening-stock or transfer, NOT the B2B ownership-transition path | `inventory.service.ts:recordOpeningStock` (`arrangement: D2C_COLLECTION_POINT`); `inventory-transfer.service.ts`                                                                       |
| Overselling prevention                                                   | Partially implemented — no reservation anywhere; only the final atomic decrement at collection is authoritative                                         | `collection-point-fulfillment.service.ts:markReadyForCollection` (non-authoritative pre-check) → `confirmCollection` → `inventory-stock-concurrency.util.ts:decrementStockIfAvailable` |
| Pickup confirmation / redemption                                         | Implemented, idempotent, audited, rollback-safe (a historical bug here was found and fixed)                                                             | `collection-point-fulfillment.service.ts:confirmCollection`; `apps/web/src/app/(field)/field/collection-point/`                                                                        |
| Failed-to-collect / cancellation                                         | Partially implemented — manual cancellation only, no auto-expiry, no refund, no consumer notification on cancel                                         | `collection-point-fulfillment.service.ts:cancel`                                                                                                                                       |
| Field personnel interface                                                | Implemented — real web UI + API, resource-ownership-scoped                                                                                              | `apps/web/src/app/(field)/field/collection-point/`; `collection-point-fulfillment.controller.ts`                                                                                       |
| Consumer notifications (proactive)                                       | **Implemented but defective for its one real use case** — free-form text, no 24h session-window handling, Meta error 131047 misclassified as retryable  | `d2c/messaging/whatsapp-consumer-notification.service.ts:notify` (independently verified, see §7)                                                                                      |
| Promotions/loyalty                                                       | Implemented and wired into payment confirmation (not cart/order time); `FREE_PRODUCT` fulfilment and point redemption are schema-complete but unbuilt   | `promotions/reward/promotion-evaluation.service.ts`; real-Postgres `promotions-concurrency.integration.spec.ts`                                                                        |
| Accounting touchpoints                                                   | Implemented — zero D2C-specific accounting code; reuses the one shared `postSystemJournalEntry` posting                                                 | `sales/sales-fulfilment.repository.ts` → `finance/accounting/journal-posting.ts`                                                                                                       |
| Permissions/RBAC                                                         | Implemented, consistent Owner/Administrator/Member pattern, correctly org-scoped                                                                        | `identity/authorization/permission-catalogue.ts` (`d2c.*`, `promotions.*` keys)                                                                                                        |

## 3. Consumer journey trace

Intended journey: scan/open link → initiate conversation → register/recognized →
browse → select products/quantity → choose location/collection point → order →
confirmation → collect → collection confirmed → stock/status updated → later
status check.

| Step                                       | Status                                                                             | Entry point / responsible code                                                                                                                | Notes                                                                                                                                                                 |
| ------------------------------------------ | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scan QR / open WhatsApp link               | **Requires external verification**                                                 | N/A — no `wa.me`/QR-generation code exists anywhere in the repo (confirmed by repo-wide search)                                               | This is expected to be a business/marketing deliverable outside the codebase, not a code gap.                                                                         |
| Initiate conversation                      | End-to-end implemented                                                             | `whatsapp-webhook.controller.ts:receive` → `whatsapp-inbound-adapter.service.ts:handleWebhookPayload` → `ConversationRepository.findOrCreate` | Race-safe via `@@unique([organisationId, channel, externalConversationId])`.                                                                                          |
| Register / recognized                      | End-to-end implemented                                                             | `conversation.service.ts:handleNew/handleRegistration` → `consumer.service.ts:registerConsumer`                                               | Explicit registration step, not automatic; idempotent via `findOrCreate`.                                                                                             |
| Browse products                            | End-to-end implemented                                                             | `d2c-ordering.service.ts:getAvailableProducts` → `conversation.service.ts:renderBrowsing`                                                     | No pagination/search — acceptable at a small-catalogue scale, a deliberate simplification.                                                                            |
| Select products/quantity                   | End-to-end implemented                                                             | `d2c-ordering.service.ts:addItemToCart/updateCartItem`                                                                                        | Cart lives in `ConsumerConversation.context` JSON, not a persisted table — fine for a single-session flow.                                                            |
| Choose location/collection point           | End-to-end implemented                                                             | `conversation.service.ts:resolveBranchPoint` (territory) → `collection-point-fulfillment.service.ts` (eligible-outlet resolution)             | Manual selection, server-revalidated.                                                                                                                                 |
| Place order                                | End-to-end implemented                                                             | `d2c-ordering.service.ts:confirmOrder` → `sales-order.service.ts:createForConsumer`                                                           | Real `SalesOrder`, idempotent, proven under real concurrency. Never touches inventory at this step — by design ("a Sales Order is a record of demand"), not a defect. |
| Receive confirmation                       | End-to-end implemented                                                             | `conversation.service.ts:handleAwaitingConfirm`                                                                                               | Synchronous, same request.                                                                                                                                            |
| Pay                                        | End-to-end implemented (requires external verification for production credentials) | `d2c-payment.service.ts:initiatePayment/handleProviderCallback`                                                                               | Real OPay integration; webhook-verified callback confirms the order. No COD path exists.                                                                              |
| Collection-point stock becomes "ready"     | Implemented but not integrated — **the notification step is defective**            | `collection-point-fulfillment.service.ts:markReadyForCollection` → `notifyReady`                                                              | The status transition and audit work; the WhatsApp notification telling the consumer can silently fail (§7, P0-1).                                                    |
| Collect products                           | End-to-end implemented                                                             | Field web UI → `confirmCollection`                                                                                                            | Idempotent, audited, rollback-safe.                                                                                                                                   |
| Collection confirmed, stock/status updated | End-to-end implemented                                                             | `confirmCollection` → `sales-fulfilment.service.ts:fulfil()`                                                                                  | Same code path as B2B fulfilment; posts the same COGS/FG journal entry.                                                                                               |
| Consumer views later order status          | End-to-end implemented                                                             | `conversation.service.ts:showMyOrders`                                                                                                        | Live read, never stale.                                                                                                                                               |

**The one step that is implemented-but-not-reliably-connected end-to-end is "ready
for collection" → consumer notification.** Every other step traces cleanly through
real code to a real, tested mechanism.

## 4. Collection Point operational trace

- **Independent per-tenant configuration**: yes — `CollectionPoint` is not a
  separate entity, it is three additive columns on `Outlet`
  (`collectionPointStatus`/`collectionPointResponsibleUserId`/
  `collectionPointOperatingHours`, `schema.prisma:2175-2242`), configured per
  tenant via `OutletService.enableCollectionPoint`/etc. No hardcoded outlet/
  territory names found in any `.service.ts`/`.controller.ts`/`.repository.ts`
  file under `d2c/` or `retail/outlet/` — "Boby Bites" appears only in seed data,
  test fixtures, and one UI placeholder string.
- **How stock becomes available**: manual `recordOpeningStock` (with
  `arrangement: D2C_COLLECTION_POINT`) or `InventoryTransfer` — **not** the B2B
  ownership-transition event, which is gated to `SalesOrder.outletId` (always
  null for D2C).
- **Ownership**: always `StockOwnership.ORGANISATION`. `CUSTOMER` ownership is
  reserved exclusively for the B2B wholesale path; Collection Point stock never
  becomes customer-owned.
- **Operational caveat found in documentation, flagged for verification, not
  assumed**: `docs/domains/inventory.md` §15.6 states that, as last documented,
  neither real seeded Collection Point outlet had actually been cut over to a
  dedicated `CUSTOMER_LOCATION` — both still draw from the shared Main Warehouse
  via a legacy fallback path. **This needs an operational check against Boby
  Bites' actual intended production setup before launch** — it is a data/config
  state question, not a code defect (the code correctly supports and prefers the
  dedicated-location path; it falls back gracefully when one doesn't exist).
- **Availability check vs. reservation**: checked, never reserved. A "UX-only
  fast-fail" read happens at `markReadyForCollection`
  (`SalesFulfilmentService.getAvailability()` — no lock, no hold record). The
  only authoritative, race-safe check is the final atomic conditional `UPDATE`
  inside `fulfil()` (`decrementStockIfAvailable`,
  `inventory-stock-concurrency.util.ts`), live-proven by
  `inventory-stock-concurrency.integration.spec.ts`.
- **Overselling prevention mechanism, precisely**: two orders can both pass the
  earlier non-authoritative check and both reach `READY_FOR_COLLECTION` against
  combined stock that doesn't exist. The **first** to call `confirmCollection`
  gets the stock (atomic decrement succeeds); the **second** gets a hard `400
Insufficient stock` and remains stuck at `READY_FOR_COLLECTION`, retryable,
  requiring manual intervention (restock, cancel, or reassign) — never a double
  deduction, never silent data corruption. This is a genuine, bounded
  operational risk, not a correctness defect. Per this stage's own guiding
  instruction, **a new reservation system is not recommended for MVP** — the
  atomic decrement already makes the failure mode safe (retryable, visible,
  never corrupting), and at realistic early-MVP order volumes this is a low-
  probability event manageable by monitoring the existing "Attention Required"
  dashboard (`STUCK_FULFILLMENT` flag, Sprint 39).
- **Who confirms pickup**: the outlet's assigned `collectionPointResponsibleUserId`,
  or anyone holding `sales.customer.manage`/owner-bypass — gated by
  `d2c.collection_point.fulfil`. A real web UI exists for this
  (`apps/web/src/app/(field)/field/collection-point/`).
- **Duplicate pickup prevention**: a conditional `updateMany` scoped to
  `{id, organisationId, status: READY_FOR_COLLECTION}` plus a deterministic
  `idempotencyKey` passed into the shared `fulfil()` call — two safety nets, not
  one.
- **Failed collection / no-show**: no automatic expiry exists. An order can sit
  at `READY_FOR_COLLECTION` indefinitely; the admin dashboard flags it after 24h
  but never acts automatically. Acceptable for MVP with active human monitoring;
  a real gap if the business expects "it just handles itself."
- **Cancellation**: manual only, blocked once `COLLECTED` (stock already moved,
  no compensating reversal implemented). No refund is issued — **this codebase
  has no payment-refund mechanism at all**, confirmed by inspection, not
  assumed. No consumer notification fires on cancellation either (a documented
  gap in the code's own comments, not a silent omission).
- **Field personnel interface**: yes, a real web UI (queue, order detail,
  confirm-collection action, "Attention Required" flagging) backed by a real,
  permission-gated API.

## 5. Tenant configuration and isolation assessment

**Strongest area found**: Sprint 44's conversation configuration. Every read is
scoped by `organisationId`; the fallback for anything a tenant hasn't configured
is always the hardcoded platform default, never another tenant's data (confirmed
by reading `D2CConversationConfigService.resolveEffectiveConfig` and its three
backing repositories). Proven live, not just by code inspection: two real-Postgres
integration specs exist specifically to prove tenant non-contamination —
`d2c-conversation-config-active-safety.integration.spec.ts` ("Final Architectural
Test" — `getAdminView`/`getPreview` for two real tenants never cross-contaminate)
and `d2c-conversation-config-concurrency.integration.spec.ts` (concurrent writes
for two tenants never interfere, even under a 10-write storm on one tenant while
reading the other).

**The one real, structural multi-tenancy weakness**: there is no WhatsApp
Business Account ID / phone-number-ID → organisation mapping anywhere in the
schema or code. `MetaWebhookValue.metadata.phone_number_id` is received but never
used for routing. Instead, `WhatsAppOrganisationResolverService` resolves tenancy
by looking up which organisation(s) already have a `Consumer` row for the sender's
phone number — explicitly documented in its own code comment as a consequence of
**this deployment sharing one Meta WhatsApp Business phone number across every
tenant**. Consequences, precisely:

- A phone number that has only ever messaged one tenant routes correctly.
- The _same_ phone number messaging two different tenants (legitimately
  possible — `Consumer.normalizedPhone` is unique only per-organisation) resolves
  ambiguously to whichever `Consumer` row was created most recently, with a
  logged warning — not a hard failure, but not a correct resolution either.
- A brand-new number with no `Consumer` anywhere routes to
  `WHATSAPP_DEFAULT_ORGANISATION_ID` if configured (it is, in this environment),
  otherwise the message is dropped and audited as `ORGANISATION_UNRESOLVED`.

**This is a non-issue for a single-tenant (Boby Bites only) launch** — with only
one real tenant, every inbound message resolves correctly every time. **It
becomes a real correctness problem the moment a second tenant goes live on D2C**,
which matters directly to this platform's stated goal of reusability without
tenant-specific code changes. This is the single most important finding for
Codex to understand before testing with a new tenant (§9).

Everything else checked was consistently organisation-scoped: every
`findFirst`/`findUnique` call reviewed across the D2C domain includes
`organisationId`; every `findUniqueOrThrow({ where: { id } })` call that omits it
is preceded, in the same method, by a conditional `updateMany` that already
proved tenant ownership. One soft spot was found for defense-in-depth (not
exploitable today): `promotion.repository.ts`'s `replaceConditionsAndBenefits`
omits `organisationId` from its own deletes/fetch, relying on its single caller
(`PromotionService.update`) having already validated ownership — every sibling
method in the same file includes the scope directly. Worth tightening, not
urgent.

No dedicated D2C tenant-isolation integration test exists (the general
`reporting-tenant-isolation.integration.spec.ts` doesn't cover this domain) — a
real test-coverage gap, not evidence of an actual leak, given the independent
`organisationId` scoping confirmed throughout.

## 6. External integration readiness

| Item                                       | Status                                                                                                                                                                                                                                             | Can be tested locally?                                                                                                             |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Meta WhatsApp Cloud API client             | Real, genuine `fetch()` HTTP client (`MetaWhatsAppProvider`), not a stub — a separate `local` provider mode exists for dev/test and is explicitly config-gated, not a disguised placeholder                                                        | No — requires real Meta credentials and a live phone number                                                                        |
| Webhook GET handshake (`hub.verify_token`) | Implemented correctly                                                                                                                                                                                                                              | Yes                                                                                                                                |
| Webhook POST signature verification        | Implemented correctly **when a secret is configured** — currently unconfigured in this environment, so verification is bypassed (self-documented fallback-to-accept)                                                                               | Yes, once `WHATSAPP_APP_SECRET` is set                                                                                             |
| Phone/business-account routing             | No dedicated routing table; resolved by Consumer lookup (§5)                                                                                                                                                                                       | Yes — the gap itself is testable; real multi-number routing is not applicable until Zentuva provisions per-tenant WhatsApp numbers |
| Interactive messages (buttons/lists)       | Inbound parsing exists; outbound always renders as numbered plain text, never real interactive payloads — a documented, deliberate MVP simplification                                                                                              | Yes                                                                                                                                |
| Message templates                          | Implemented, but only for two non-D2C notification types (`WORKFLOW_APPROVAL_REQUIRED`, `INTERVIEW_SCHEDULED`); **zero D2C templates exist**                                                                                                       | Partially — requires real Meta template approval to verify end-to-end                                                              |
| Outbound delivery tracking/retry           | Implemented, real-Postgres-proven for the DB-level claim/retry primitive                                                                                                                                                                           | Yes                                                                                                                                |
| Consumer opt-in / 24h session eligibility  | **Not implemented** — no session-window check anywhere in the D2C notification path                                                                                                                                                                | Yes — this is a code gap, testable without real Meta access by simulating the error response                                       |
| QR code / `wa.me` entry link               | Absent in code                                                                                                                                                                                                                                     | N/A — expected business/marketing deliverable                                                                                      |
| Payment provider (OPay)                    | Real integration, webhook-verified                                                                                                                                                                                                                 | Partially — requires OPay sandbox credentials for a full round trip                                                                |
| Production secrets/env config              | `WHATSAPP_APP_SECRET` absent; `WHATSAPP_BUSINESS_ACCOUNT_ID` present in config but never referenced anywhere (dead config); every other required WhatsApp var present and non-empty in this environment (names only confirmed, no values reported) | N/A                                                                                                                                |

**Do not assume proactive WhatsApp messaging is permitted merely because a
consumer has previously initiated a conversation** — this exact assumption is
the root cause of §7's top finding: the code sends proactive notifications as
free-form text under the (incorrect, for messages outside the 24h window)
premise that any consumer who has ever messaged in is reachable at any later
time.

## 7. Confirmed gaps and risks

Ranked by severity; full P0/P1/P2/P3 table in §8.

1. **Proactive consumer notifications will silently and permanently fail outside
   Meta's 24-hour session window.** Independently verified:
   `d2c/messaging/whatsapp-consumer-notification.service.ts:85` calls
   `provider.sendText(...)` — free-form text — for both `ConsumerNotificationKind`
   values that exist, `COLLECTION_READY` and `COLLECTION_CONFIRMED`
   (`d2c/messaging/consumer-notification.port.ts:24`, confirmed by grep against
   every call site in `collection-point-fulfillment.service.ts`). Meta's Cloud
   API rejects a free-form message to a user whose last inbound message was more
   than 24 hours ago (error code `131047`). I independently read
   `meta-whatsapp-provider.ts`'s `mapErrorResponse` (lines 206–243) and confirmed
   there is no case for `131047` — it falls through to the generic `else` branch,
   classified `RETRYABLE_FAILURE`/`WHATSAPP_UNKNOWN`. Since the 24h window only
   resets on a **new inbound** message from the consumer, this specific failure
   is not actually retryable — a naive automated retry will fail identically
   forever. The outbound-delivery retry infrastructure
   (`ConsumerWhatsAppDelivery.claimForRetry`, admin `ConsumerCommunicationService.retry`)
   is real and does give staff a visible, actionable failure to retry — but it
   will keep retrying the wrong thing unless a human realizes the true cause and
   calls the consumer directly instead.
2. **Webhook signature verification is currently disabled in this environment.**
   `WHATSAPP_APP_SECRET` is confirmed absent from `apps/api/.env` (checked by
   variable name only, no values read or reported).
   `whatsapp-webhook.controller.ts:verifySignature` returns `true` unconditionally
   when the secret is unset, by explicit design documented in its own comment —
   this is a correct, safe default for local/dev work, but means any caller who
   discovers the production webhook URL can currently POST unsigned, unverified
   payloads that will be processed as genuine Meta traffic.
3. **No stock reservation anywhere in the D2C/Collection-Point flow** — a
   documented, bounded operational risk (§4), not a data-corruption risk. The
   atomic final decrement prevents double-counting; the cost is a retryable,
   human-visible stuck order, not silent loss.
4. **No refund mechanism exists anywhere in the codebase.** A cancelled, already-
   paid order requires a manual, off-system OPay refund — confirmed by code
   inspection of `cancel()`'s own doc comment, not assumed.
5. **Single shared WhatsApp Business phone number across every tenant**, with
   ambiguous-phone-number fallback-to-most-recently-created `Consumer` (§5). Safe
   for a single-tenant launch; a real correctness gap the moment a second tenant
   is onboarded with D2C/WhatsApp active.
6. **Collection Point stock may not be on a dedicated location in production
   data** — an operational verification item, not a code defect (§4).
7. **Consumer self-service profile update is location-only**; name/email/address
   changes require an internal admin action, not a chat command.
8. D2C order placement is not recorded in the shared `AuditLog` mechanism (the
   `SalesOrder` row and its timestamps remain a durable record regardless — this
   is a consistency gap against other domains' audit coverage, not data loss).
9. No automatic expiry/cancellation for an order stuck at `READY_FOR_COLLECTION`
   — dashboard-flagged only, never auto-acted-on.
10. No dedicated D2C tenant-isolation integration test exists (general isolation
    is otherwise well-evidenced by consistent `organisationId` scoping, §5).
11. Minor defense-in-depth gap: `promotion.repository.ts:replaceConditionsAndBenefits`
    omits `organisationId` scoping at the repository layer, relying on its one
    caller having already checked ownership.

## 8. Prioritized P0/P1/P2/P3 backlog

### P0 — Launch blockers

**P0-1: Proactive Collection Point notifications fail outside the 24h WhatsApp
session window, with no fallback.**

- Evidence: `d2c/messaging/whatsapp-consumer-notification.service.ts:85`
  (`sendText`, free-form); `meta-whatsapp-provider.ts:206-243` (no `131047`
  handling, defaults to `RETRYABLE_FAILURE`); `consumer-notification.port.ts:24`
  (only `COLLECTION_READY`/`COLLECTION_CONFIRMED` exist, both affected).
- Affected journey: "receives confirmation... collects products → collection is
  confirmed" — the exact steps the brief's own intended journey names.
- Why it blocks MVP: this is not a rare edge case — any order that takes longer
  than a day to prepare, or any consumer who doesn't re-engage in chat between
  ordering and pickup, will silently never receive the one message the whole
  Collection Point flow exists to deliver. There is no SMS/push/email fallback
  anywhere in this codebase for D2C consumers.
- Smallest viable resolution: (a) request Meta approval for two WhatsApp message
  templates — "ready for collection" and "collection confirmed" — reusing the
  existing, already-correct `sendTemplate`/`resolveWhatsAppTemplate` mechanism
  already proven for the Workflow-approval notification type; (b) at the
  notification call site, check whether the consumer's last inbound message is
  within 24h and use `sendText` only in that case, falling back to the approved
  template otherwise; (c) add a `131047` case to `mapErrorResponse` classified
  `TERMINAL_FAILURE`, so a genuine session-window failure surfaces to staff
  immediately instead of looping as a false retryable.
- Complexity: small code change (a few hours); the real lead time is Meta's
  template-approval process, which should start now in parallel.
- Codex can verify independently: partially. Codex can verify the code path and
  error-classification logic without real Meta access (simulate the 131047
  response), but cannot verify real template delivery without approved templates
  and a live number.

**P0-2 (configuration, not code): Webhook signature verification is disabled.**

- Evidence: `WHATSAPP_APP_SECRET` absent from `apps/api/.env` (name-only check);
  `whatsapp-webhook.controller.ts:verifySignature` accept-on-unset behavior.
- Affected journey: every inbound message/webhook — a forged payload could
  inject fake consumer messages, fake order progression, or fake promotion
  evaluation attempts into whichever organisation the forged sender's phone
  resolves to.
- Why it blocks MVP: this is the production entry point for every consumer
  interaction; leaving it open is a straightforward, known, and trivially
  avoidable risk.
- Smallest viable resolution: obtain the Meta App Secret and set
  `WHATSAPP_APP_SECRET` in the production environment. Zero code change needed —
  the verification logic is already correct.
- Complexity: trivial (a deployment/config step).
- Codex can verify independently: yes — Codex can confirm the variable is set in
  whatever environment it tests against, and can send an unsigned payload to
  confirm it is now rejected.

### P1 — Required for MVP

**P1-1: Single shared WhatsApp number creates ambiguous cross-tenant routing.**
Not a blocker for a Boby-Bites-only launch; becomes one the moment a second real
tenant goes live with D2C. Resolution (per-tenant WhatsApp Business number
provisioning, routing by `phone_number_id`) is a real feature, not a quick fix —
flagged for a product decision (§11), not sized here as "small."

**P1-2: No refund mechanism.** A cancelled, paid order needs a documented manual
process (refund via the OPay dashboard directly) as the MVP's answer — this
should be an operational runbook item before launch, not necessarily new code.
Complexity to formalize as a runbook: trivial; as a coded feature: moderate
(deferred unless volume demands it).

**P1-3: Verify Boby Bites' real Collection Points are on dedicated inventory
locations, not the legacy shared-warehouse fallback**, before relying on
per-location stock visibility for consumer-facing availability. Pure
verification/configuration, not code.

**P1-4: No stock reservation; residual overselling-to-the-door risk.** Not
recommended to build a reservation system for MVP (per this stage's own
instruction and the bounded, retryable nature of the failure) — but operations
should be told explicitly: monitor the "Attention Required"/stuck-fulfilment
dashboard, keep conservative buffer stock at Collection Points relative to open
orders. This is a process mitigation, not a code item.

**P1-5: Consumer self-service profile editing is location-only.** Whether this
blocks launch depends on whether Boby Bites needs consumers to self-correct
name/email/address via chat, or whether staff can handle corrections manually at
MVP volumes — a product decision (§11), not a universal blocker.

### P2 — Post-launch improvements

- No automatic expiry for stuck `READY_FOR_COLLECTION` orders (dashboard-only
  today).
- D2C order placement not recorded in the shared `AuditLog` (the `SalesOrder`
  row itself remains a durable record).
- No dedicated D2C tenant-isolation integration test.
- `promotion.repository.ts` defense-in-depth org-scoping tightening.
- No consumer notification on order cancellation.
- Catalogue browsing has no search/pagination (fine at small catalogue sizes).
- Outbound WhatsApp messages render as numbered text, not real interactive
  buttons/lists.
- `WHATSAPP_BUSINESS_ACCOUNT_ID` is loaded into config but never referenced
  anywhere — dead configuration, harmless but worth removing or wiring up.

### P3 — Future roadmap

- `FREE_PRODUCT` promotion-benefit fulfilment (schema exists, nothing advances a
  `PENDING_FULFILLMENT` grant).
- Loyalty-point redemption (no `REDEEM`/`REVERSAL` ledger entries written
  anywhere).
- Referral-type promotions (no condition type exists for this).
- Territory-condition evaluation for promotions (hierarchy traversal not yet
  built).
- Per-tenant WhatsApp Business number provisioning (the real fix for P1-1).
- `wa.me`/QR-code generation tooling (a marketing/business deliverable, not
  engineering scope).

## 9. Codex UAT handoff checklist

**Critical workflows to test with the new tenant:**

1. Full consumer journey: first contact → registration → browse → cart → confirm
   → pay (OPay sandbox) → mark ready → collect → status check in "My Orders."
2. A second order from the same already-registered consumer (confirms
   `findOrCreate` idempotency doesn't duplicate the Consumer).
3. Two concurrent orders competing for the same limited stock at one Collection
   Point — confirm exactly one succeeds at `confirmCollection` and the other
   fails safely, retryably, without double-deducting stock.
4. A webhook redelivery of the same Meta message ID — confirm it is not
   reprocessed (no duplicate order/response).
5. Order cancellation before collection — confirm stock is untouched (it was
   never deducted) and the underlying `SalesOrder` is correctly cancelled.
6. Admin configuration of the new tenant's conversation capabilities/messages via
   `D2CConversationConfigService` — confirm it never shows or is affected by
   Boby Bites' configuration.

**Tenant-isolation scenarios specifically worth exercising:**

- Confirm the new tenant's `resolveEffectiveConfig` never returns a Boby-Bites
  message/label, and vice versa (mirrors the existing
  `d2c-conversation-config-active-safety.integration.spec.ts` proof, but against
  real, not synthetic, tenants).
- **Deliberately test the shared-WhatsApp-number limitation (§5/P1-1) rather than
  being surprised by it**: if Codex's test phone number has never messaged any
  tenant before, it will route via `WHATSAPP_DEFAULT_ORGANISATION_ID` — confirm
  what that variable is currently set to in the test environment before
  assuming a brand-new number will land in the new tenant. If it's possible for
  the same test phone number to message both Boby Bites and the new tenant
  during testing, expect the ambiguous-routing behavior described in §5 — this
  is a known, documented implementation limitation, not a defect to report as a
  new bug.
- Attempt a cross-tenant lookup for an order ID or consumer ID belonging to the
  other tenant through every D2C-facing endpoint — should uniformly 404/403.

**Required test fixtures/configuration:**

- A newly created organisation with its own Chart of Accounts, at least one
  `OPEN` `AccountingPeriod` covering the test dates (D2C fulfilment posts a real
  journal entry and will fail closed otherwise — the same system this platform's
  Stage 4E work just hardened).
- At least one `ACTIVE`, `FINISHED_PRODUCT`-type product with a non-null
  `sellingPrice`.
- A `Territory` and an `Outlet` with `collectionPointStatus: ENABLED`, with real
  stock recorded via `recordOpeningStock` (ideally on a dedicated
  `CUSTOMER_LOCATION`, to also validate the preferred — not legacy-fallback —
  path).
- A `collectionPointResponsibleUserId` assigned, with that user holding
  `d2c.collection_point.fulfil`.

**Positive and negative cases worth including:**

- Positive: the full journey above, end to end.
- Negative: ordering a product with `status !== ACTIVE` or `sellingPrice: null`
  (should be excluded from browsing and rejected if attempted anyway); an
  idempotency-key retry with a _different_ cart producing a rejection, not a
  silent merge; a `confirmCollection` attempt by a user who is neither the
  responsible user nor an admin (should be denied); a duplicate pickup
  confirmation (should be a no-op returning the already-`COLLECTED` state, not
  an error or a double deduction).

**Expected stock and financial invariants:**

- `InventoryStock.quantityOnHand` at the Collection Point decreases by exactly
  the collected quantity, exactly once, regardless of retries or concurrent
  attempts.
- A posted `JournalEntry` exists for the fulfilment with `DR COGS / CR Finished
Goods Inventory` for the same value the stock moved by (or no journal at all
  if the item's cost was genuinely zero — not a bug, a documented edge case).
- `ConsumerRewardGrant`/`LoyaltyLedgerEntry` rows, if a promotion qualifies,
  appear exactly once per consumer per promotion, never duplicated under
  concurrent qualification attempts.

**WhatsApp scenarios requiring real external infrastructure** (cannot be fully
verified without a live Meta Business number and approved templates):

- Any message sent more than 24 hours after the consumer's last inbound message
  (this is exactly P0-1 — expect it to currently fail if tested against real
  Meta infrastructure; do not mistake this for a test-environment artifact, it
  is a real, confirmed code gap).
- Real interactive button/list rendering (the system deliberately sends numbered
  plain text instead today — this is intentional, not a defect).
- Delivery-status webhooks (`sent`/`delivered`/`read`) from a real Meta number.

**Known implementation limitations not to mistake for defects:**

- D2C orders never touch inventory at placement time, only at collection — this
  is deliberate ("a Sales Order is a record of demand"), not a missing stock
  check.
- No stock reservation exists anywhere — a documented, accepted MVP trade-off
  (§4/§8), not an oversight to re-report.
- The three pre-existing, unrelated integration-test failures noted in prior
  stages (`reporting-tenant-isolation.integration.spec.ts`,
  `d2c-conversation-config-active-safety.integration.spec.ts`,
  `d2c-conversation-config-concurrency.integration.spec.ts`, all failing with
  "requires at least 2 seeded organisations" in an environment with only one
  real seeded org) are environment artifacts of the current single-tenant test
  database, not D2C-domain defects — Codex's own new-tenant creation should
  actually give that environment the second organisation these tests need,
  which may make them pass without any code change.

## 10. Recommended minimal MVP launch scope

Launch with:

- Registration → browse → order → OPay payment → Collection Point pickup → status
  check, exactly as implemented today.
- Manual, staff-monitored handling for: refunds (via OPay dashboard directly),
  stuck/overselling-collision orders (via the existing dashboard), and
  cancellation notifications (call the consumer directly — the system won't).
- A single Collection Point to start, ideally cut over to a dedicated
  `CUSTOMER_LOCATION` (verify this operationally, §4/P1-3) rather than the
  legacy shared-warehouse fallback, to keep availability visibility accurate.

Do **not** launch before:

- P0-1 is resolved (template-based fallback for ready/collected notifications) —
  this is the one change that actually blocks a trustworthy consumer experience.
- P0-2 is resolved (set `WHATSAPP_APP_SECRET` in production) — this is a
  deployment step, not a development task, and should not be allowed to slip.

Defer everything in P2/P3 without reservation — none of it is required for a
safe, functional, commercially usable first launch.

## 11. Outstanding questions requiring product decisions

1. Is Boby Bites expected to operate with more than one real Collection Point at
   launch, and are those locations already cut over to dedicated
   `CUSTOMER_LOCATION`s, or still on the legacy shared-warehouse fallback
   (§4/P1-3)? This needs an operational answer, not a code answer.
2. How urgent is onboarding a second real tenant onto D2C/WhatsApp? If it's
   expected within weeks of Boby Bites' launch, P1-1 (shared WhatsApp number)
   should be resourced now rather than treated as purely post-launch.
3. Is a manual, off-system refund process (via the OPay dashboard) acceptable
   for MVP, or does the business require in-app refund visibility to consumers
   from day one?
4. Does Boby Bites' consumer base need to self-correct their name/email/address
   via chat, or is staff-assisted correction acceptable at MVP volumes (P1-5)?
5. What volume of concurrent orders per Collection Point is actually expected at
   launch? This determines whether the no-reservation risk (P1-4) is
   theoretical or likely to actually surface in week one.
6. Should `FREE_PRODUCT` promotions and loyalty-point redemption be part of the
   MVP commercial offer, or deferred (P3) — this is a business decision about
   what's advertised to consumers at launch, not a technical one.
