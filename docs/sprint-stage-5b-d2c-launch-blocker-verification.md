# Stage 5B — D2C Launch-Blocker Verification and Minimal Resolution Plan

Read-only. No code, schema, or database changes; the one database read performed
(checking Boby Bites' real Collection Point configuration) was a plain `SELECT`,
reported in §6. No fixes implemented — this is verification and planning only.

## 1. WhatsApp webhook security

**Exact behavior, verified by reading the code directly**
(`d2c/whatsapp/whatsapp-webhook.controller.ts:107-133`,
`verifySignature`): when `WHATSAPP_APP_SECRET` is unset, the method logs a
warning and `return`s `true` **unconditionally** — every unsigned or incorrectly-
signed `POST /whatsapp/webhook` payload is accepted and processed. There is no
`NODE_ENV` check anywhere in this controller or in `verifySignature` — I checked
`src/config/env.validation.ts:128` (`WHATSAPP_APP_SECRET: z.string().min(1).optional()`)
and `configuration.ts:91` and confirmed the variable is **unconditionally
optional**, with no environment-conditional requirement. **This means the bypass
is identical in development and in production** — nothing in the code restricts
it to local/dev use; it is purely a function of whether the secret happens to be
configured in whatever environment is running.

Independently confirmed in this environment: `WHATSAPP_APP_SECRET` is absent from
`apps/api/.env` (checked by variable name only; no value read or reported here).

**When the secret IS configured**, verification is implemented correctly: real
HMAC-SHA256 over the raw body, `timingSafeEqual` comparison (avoids a timing
side-channel), and a length check before `timingSafeEqual` to avoid a throw on
mismatched lengths.

**Existing precedent for a safe fix, already in this codebase**: the Meta
provider's own boot-time config loader,
`notifications/infrastructure/meta-whatsapp-provider.ts:loadMetaWhatsAppConfig`
(lines 33-47), already fails loudly at application startup —
throwing `WhatsAppConfigurationError` — if `WHATSAPP_PROVIDER_MODE=meta` but
`WHATSAPP_API_BASE_URL`/`WHATSAPP_ACCESS_TOKEN`/`WHATSAPP_PHONE_NUMBER_ID` are
missing. This is exactly the right shape to extend, not a new pattern to invent.

**Recommendation**: extend that same boot-time check to also require
`WHATSAPP_APP_SECRET` whenever `WHATSAPP_PROVIDER_MODE=meta` — gated on the
provider mode (which already distinguishes "really talking to Meta" from "local
dev stub"), not on `NODE_ENV` (which can legitimately be `production` while still
running the local stub in a staging environment, and the docs note
`WHATSAPP_PROVIDER_MODE=meta` was deliberately used for real-traffic testing even
outside strict production). This fails the app at boot with a clear message in
any real-Meta configuration, while leaving local-provider development completely
unaffected — zero behavior change for anyone not talking to the real Meta API.
No change to `verifySignature`'s own logic is needed once this gate exists,
though the warning log it emits today is also a reasonable detection signal to
alert on in the interim.

## 2. WhatsApp notifications

**Trace, with exact citations**: `collection-point-fulfillment.service.ts:285-287`
(`markReadyForCollection`) and the symmetric call in `confirmCollection` both
invoke `notifyReady`/`notifyCollected`, which call
`d2c/messaging/whatsapp-consumer-notification.service.ts:85`
(`WhatsAppConsumerNotificationService.notify` → `provider.sendText(...)`) — this
is confirmed, by independently reading the file, to be the **only** call for
both of the two `ConsumerNotificationKind` values that exist
(`d2c/messaging/consumer-notification.port.ts:24`:
`'COLLECTION_READY' | 'COLLECTION_CONFIRMED'`).

- **24-hour session window tracking**: **none exists**. I searched the D2C
  notification and messaging code and found no last-inbound-message timestamp
  check, no session-window calculation, and no template fallback anywhere in
  this path.
- **Approved template messaging — does it exist anywhere in the platform?**
  Yes, but not here. `notifications/whatsapp-template.ts:resolveWhatsAppTemplate`
  implements real Meta template sends for exactly two notification types:
  `WORKFLOW_APPROVAL_REQUIRED` → `zentuva_approval_required` and
  `INTERVIEW_SCHEDULED` → `zentuva_interview_scheduled`, both unrelated to D2C.
  `MetaWhatsAppProvider.sendTemplate` (the underlying HTTP call) is real and
  already correctly builds Meta's `type: 'template'` request body — the
  mechanism to reuse exists; it is simply never invoked for
  `COLLECTION_READY`/`COLLECTION_CONFIRMED`.
- **How Meta API errors and delivery failures are recorded**: the
  `ConsumerWhatsAppDelivery` model (`schema.prisma:8497-8554`) persists
  `status` (`PENDING`/`PROCESSING`/`SENT`/`FAILED`), `attempts`,
  `lastErrorCode`, `lastErrorMessage`, `firstAttemptedAt`/`lastAttemptedAt`/
  `sentAt`. This is real, structured, queryable failure data — not a silent
  swallow.
- **The specific error-classification gap, independently re-verified**: I read
  `meta-whatsapp-provider.ts:mapErrorResponse` (lines 206-243) directly. It has
  explicit cases for invalid-token (190), invalid-recipient (131026/131030),
  invalid-template (132000/132001/132005/132007), and rate-limiting
  (80007/429). **There is no case for Meta's error 131047** ("re-engagement
  message" — sent outside the 24h window) — it falls into the generic `else`
  branch, classified `RETRYABLE_FAILURE`/`WHATSAPP_UNKNOWN`. Because the 24h
  window only resets on a _new inbound_ message from the consumer, this specific
  failure is not actually transient — it will fail identically on every retry
  until the consumer messages in again, which a "ready for pickup" notification
  obviously cannot wait for.
- **Are failed notifications retried?** Yes, but only on demand, never
  automatically — `ConsumerWhatsAppDelivery`'s own schema comment states "retry
  here is always operator-initiated, never an automatic background sweep."
  `ConsumerCommunicationService.retry()` (`d2c/messaging/consumer-communication.service.ts`)
  is the mechanism: it is structurally incapable of recreating an order,
  rerunning payment, re-deducting stock, or double-granting a reward (it has no
  dependency on any of those services), and resends the exact snapshotted
  message to the exact snapshotted phone number, claimed atomically via
  `claimForRetry` so two concurrent retry clicks can't double-send. A staff
  member retrying a `WHATSAPP_UNKNOWN`-classified failure caused by the session
  window will simply reproduce the same failure — the mechanism is safe, but
  not self-correcting for this specific cause.
- **Can consumers independently check order status?** Yes, and it is a real,
  live read, not dependent on any notification having succeeded —
  `conversation.service.ts:showMyOrders` queries `D2COrderingService.listConsumerOrders()`
  fresh on every request, per its own doc comment: "never a persisted/cached
  WhatsApp-only status." A consumer who never received a "ready" notification
  can still ask "my orders" and see the correct current state, provided they
  can still message in (see below for the circularity this creates).
- **Can staff identify and recover failed notifications?** Yes —
  `ConsumerCommunicationService.listForConsumer`/`listForOrder`/`listForConversation`,
  gated by `d2c.communication.view`/`.manage`, give a real admin-facing view of
  every delivery attempt, its status, and its error. The gap is diagnostic, not
  structural: today, a session-window failure and a genuinely transient failure
  look identical in this view (`WHATSAPP_UNKNOWN`), so staff have no signal to
  distinguish "retry this" from "this will never succeed by retrying — call the
  consumer instead."

**A real circularity worth naming explicitly**: if a consumer's order takes
longer than 24h to prepare and they haven't messaged the business again in that
window, the one notification meant to tell them to come check their status is
exactly the one that fails to reach them — and they have no reason to proactively
re-open the chat to ask, since from their side nothing happened. "The consumer
can always check status themselves" is true but does not resolve this, because
nothing prompts them to.

**Recommended minimum reliable launch behavior**:

1. Add a `131047` case to `mapErrorResponse`, classified `TERMINAL_FAILURE` (not
   retryable) with a distinct error code — this alone turns an invisible
   automated-retry dead end into a staff-visible, correctly-labeled failure
   requiring a different recovery action (e.g., a phone call), using
   infrastructure that already exists.
2. Request Meta approval for two D2C-specific templates — "ready for collection"
   and "collection confirmed" — and extend `whatsapp-consumer-notification.service.ts`'s
   `notify()` to check the consumer's last-inbound timestamp (already available
   via `ConsumerConversation`/`Consumer` data) and send via the approved
   template when outside the window, falling back to the existing free-form
   `sendText` only when inside it. This reuses the already-correct
   `sendTemplate` plumbing; it does not require a new delivery mechanism.
3. Template approval has real external lead time with Meta — this should start
   now, in parallel with any other launch preparation, independent of code
   readiness.
4. Do **not** assume a submitted WhatsApp API call guarantees delivery — the
   `ConsumerWhatsAppDelivery.status` field already encodes this correctly
   (`SENT` means "Meta accepted the API call," not "the consumer has the
   message"); no change needed there, just don't treat `SENT` as "done."

## 3. Paid-order stock availability

**Exact sequence traced, with precise citations, from product selection to
collection**:

| Stage                                                           | Stock check?              | Citation                                                                                                                                                                                                                                                                      |
| --------------------------------------------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product selection / cart                                        | None                      | `d2c-ordering.service.ts:getAvailableProducts/isOrderable` — eligibility is product-status/price only, never stock; structurally confirmed by `d2c-ordering-independence.spec.ts`'s assertion that this module has no inventory import at all                                 |
| Order creation (`DRAFT` `SalesOrder`)                           | None                      | `sales-order.service.ts:createForConsumer` — no `InventoryStockRepository` dependency anywhere in the file (confirmed by its own doc comment and by inspection)                                                                                                               |
| Payment confirmation (`SalesOrder` → `CONFIRMED`)               | None                      | `d2c-payment.service.ts:handleProviderCallback` → `SalesOrderService.confirm()` — same file, same absence of any inventory dependency                                                                                                                                         |
| Collection Point auto-assignment                                | None                      | `collection-point-fulfillment.service.ts:autoAssign` (lines 81-125) — matches by territory/outlet eligibility only, never checks stock                                                                                                                                        |
| `startPreparing` (`ASSIGNED` → `PREPARING`)                     | None                      | `collection-point-fulfillment.service.ts:190-218` — only re-validates payment is still valid (`assertPaymentStillValid`), not stock                                                                                                                                           |
| `markReadyForCollection` (`PREPARING` → `READY_FOR_COLLECTION`) | **Non-authoritative**     | `collection-point-fulfillment.service.ts:244-256` — a plain read via `SalesFulfilmentService.getAvailability()`, no lock, explicitly documented as "a UX-only fast-fail"                                                                                                      |
| `confirmCollection` (`READY_FOR_COLLECTION` → `COLLECTED`)      | **Authoritative, atomic** | calls the unmodified `SalesFulfilmentService.fulfil()` → `decrementStockIfAvailable` (`inventory-stock-concurrency.util.ts`), a single conditional `UPDATE ... WHERE quantityOnHand >= $x` — the only point in the entire sequence where a real row lock enforces correctness |

**Direct answer to the core question — can a consumer successfully pay for
stock that subsequently becomes unavailable? Yes, confirmed.** A consumer can
pay, have their order auto-assigned, enter preparation, and even reach
`READY_FOR_COLLECTION` (if they're the one whose `markReadyForCollection` call
happens to run before stock runs out) entirely without any check catching a
shortfall that already existed at the moment of payment. The **only** two
points anything is checked are both staff-triggered, not consumer-facing: the
non-authoritative check surfaces a `400` to the staff member trying to mark an
order ready; the authoritative check surfaces a `400` to the staff member trying
to confirm collection for whichever order loses a genuine race. In both cases,
**the consumer who already paid is never automatically told anything is wrong**
— staff must notice the error and act. This is the same risk Stage 5A identified
(§4/P1-4), now traced precisely enough to size a fix.

**No corruption risk exists** — the atomic decrement at `confirmCollection`
guarantees exactly one of two competing orders can ever succeed; the loser is
left safely `READY_FOR_COLLECTION`, retryable, never double-deducted.

**Comparing the three options the brief asks for, per its own instruction not to
default to a new reservation subsystem without demonstrating necessity**:

- **Order-time reservation** (hold stock at order placement, before payment):
  rejected for MVP. Payment is not yet captured at order-placement time (the
  order stays `DRAFT`), so reserving stock this early would hold inventory
  against carts that are abandoned or whose payment fails — this genuinely
  requires new state (a hold record) and a new release/expiry mechanism to
  avoid starving real demand with abandoned holds. This is exactly the kind of
  new subsystem the brief says not to build without demonstrated necessity, and
  the existing atomic-decrement guarantee already makes the failure mode safe
  rather than corrupting — reservation would improve the _consumer experience_
  of a rare race, not fix a correctness defect.
- **Payment-time stock validation** (recommended minimal fix): move today's
  existing, unmodified `getAvailability()` check from `markReadyForCollection`
  time to immediately after `autoAssign` succeeds (i.e., right after payment
  confirms). This is additive, reuses code that already exists, and adds no new
  persistent state or subsystem. It does not close the millisecond-level
  concurrent-payment race (which remains exactly as safe as it is today, via
  the atomic decrement), but it does catch the much more common and more
  damaging case — stock that was _already_ gone well before this order was ever
  placed — within seconds of payment, while there is still time to notify the
  consumer, restock, or refund, rather than discovering it hours or days later
  when staff happen to try to prepare the order.
- **Operational stock allocation** (business process, zero code): keep the
  consumer-facing catalogue's advertised availability in sync with real stock
  at each Collection Point through manual diligence. Cheapest option, and worth
  doing regardless of what code ships, but it does not provide any systemic
  guarantee and depends entirely on staff discipline.

**Recommendation**: ship the payment-time validation (small, additive, reuses
existing code) as the P1 fix, paired with the operational practice as a
day-one habit regardless. Do not build a reservation system for this stage.

## 4. Refunds and recovery

**Existing payment statuses** (`schema.prisma:2935-2941`): `RECORDED`, `VOIDED`,
`PENDING`, `FAILED`, `CLOSED`. **There is no `REFUNDED` status.**

**What `Payment.void()` actually does, verified by reading
`finance/payment.repository.ts:347-386` directly**: it loops over the payment's
`allocations[]`, reversing each allocated `Invoice.amountPaid` by its share, then
flips `Payment.status` to `VOIDED`. **A D2C consumer payment is created via
`createPendingForConsumer`** (`payment.repository.ts:419-...`, input type
`CreatePendingConsumerPaymentData`, `payment.repository.ts:56-63`) **which has no
`invoiceId`/allocation field at all** — a D2C payment is never allocated to an
`Invoice`. Calling `void()` on a D2C payment would therefore iterate zero
allocations, and its only effect is flipping the status flag. **It does not post
any reversing GL journal entry** (none existed — D2C payments never post one in
the first place, confirmed in Stage 5A) **and it does not instruct OPay to
return the consumer's money.** Voiding a D2C payment is purely an internal
bookkeeping marker, not a refund by any definition.

**What a real refund would require**: a call to OPay's own refund API — no code
for this exists anywhere in the repository (confirmed by the absence of any
provider method matching "refund" in `payments/ports/payment-provider.port.ts`
or `payments/infrastructure/opay-payment-provider.ts`). This matches Stage 5A's
finding exactly: no refund mechanism exists in this codebase.

**What cancellation actually does and does not do**, verified by reading
`collection-point-fulfillment.service.ts:cancel` (lines 447-526) directly: it
flips the `CollectionPointFulfillment` status to `CANCELLED`, records
`cancelledAt`/`cancelledById`/a free-text `cancellationReason`, and calls
`SalesOrderService.cancel()` to flip the underlying `SalesOrder` to `CANCELLED`
— rolling the `CollectionPointFulfillment` status back if that call fails, so
the two never disagree. **It never touches the `Payment` row at all** — no
`PaymentService`/`PaymentRepository` reference anywhere in this method. After a
cancellation, the `Payment` stays `RECORDED` indefinitely, with nothing in the
data model linking "this payment's order was cancelled, money is owed back" —
staff must separately know to look.

**One genuinely useful existing safety mechanism, worth highlighting**:
`assertPaymentStillValid` (`collection-point-fulfillment.service.ts:872-877`) is
re-checked at every subsequent transition (`startPreparing`,
`markReadyForCollection`, `confirmCollection` all call it) and **blocks further
progress** if the order's latest payment is `FAILED`/`VOIDED`/`CLOSED`. This
means voiding a D2C payment, even though it triggers no real refund, **does
function as an effective kill-switch** — it reliably halts an order from
reaching collection once staff decide to act on it.

**Existing administrative/reconciliation tooling**: the generic
`PaymentController` (`finance/payment.controller.ts:GET /`, `GET /:id`) lists
payments filterable by `consumerId` (confirmed, `payment.repository.ts:164`) —
there is no D2C-specific reconciliation screen, but this generic list is a real,
existing tool sufficient to find "which payments need manual follow-up."

**Recommended minimum auditable MVP recovery process — entirely using existing
tools, no new code**:

1. Staff cancels the `CollectionPointFulfillment` (and, through it, the
   `SalesOrder`) via the existing `cancel()` action, recording a specific,
   real `cancellationReason` (e.g., "insufficient stock — refund required") —
   this is already a free-text, audited field.
2. Staff voids the associated `Payment` via the existing `PaymentController`
   void endpoint, purely as an internal "this is now a dead payment record,
   don't treat it as live revenue" marker — not a refund action, labeled as
   such internally.
3. Staff separately, manually, issues the actual refund through OPay's own
   merchant dashboard (outside Zentuva) and records that it was done (even a
   note in the cancellation reason or an external log is sufficient for MVP
   auditability).
4. This sequence is fully auditable today: `COLLECTION_POINT_FULFILLMENT_AUDIT_ACTIONS.CANCELLED`
   is recorded with the reason, `Payment.status` change is itself a durable
   record, and the generic Payment list lets anyone later verify which
   payments were voided-without-refund-tracking needs a look.

This is a process recommendation, not a code change — it requires zero new
functionality, only a documented runbook for staff.

## 5. Single-number tenant routing

**Verified: there is exactly one WhatsApp Business phone number in the entire
deployment** (`WHATSAPP_PHONE_NUMBER_ID` is a single, global environment
variable, not a per-organisation field anywhere in the schema). The scenario
the brief asks about — "two organisations enable D2C with the same WhatsApp
Business number" — is not a hypothetical edge case to construct; it is the
**current, permanent, structural state** of this deployment the moment any
second organisation's consumers start messaging in, because there is only ever
one number to share.

**Verified: no per-organisation "D2C enabled" flag exists anywhere** — I
searched the schema and the identity/permission code and found none. Any
organisation that exists can have consumers register and message in
immediately; there is no feature gate beyond ordinary permissions (which
control _who_ can configure things, not _whether_ the organisation is allowed
to use D2C at all).

**Exact behavior when ambiguity occurs**, re-confirmed from Stage 5A and
independently read again in `whatsapp-organisation-resolver.service.ts`: a
phone number with `Consumer` rows in more than one organisation resolves to
whichever `Consumer` was created **most recently**, with a logged warning — not
a hard failure, not a cross-tenant data leak (the resolver only ever picks one
specific organisation's own `Consumer`, it never merges or exposes data across
organisations), but a genuinely wrong routing decision for that message.

**Can the system enforce a safe single-active-tenant restriction today?** Not
automatically — there is no existing flag or check to enforce it. Two concrete
options, smallest first:

- **Zero-code, operational**: do not enable D2C (do not register real consumers
  against, or configure conversation capabilities for) more than one
  organisation at a time in any shared environment, until per-tenant WhatsApp
  number provisioning exists. This fully resolves the risk for Boby Bites' own
  launch with no engineering work, and is the right choice if Boby Bites is
  genuinely the only live tenant.
- **Small code addition, for defense-in-depth or for Codex's own new-tenant
  testing**: add an explicit guard in `WhatsAppOrganisationResolverService` that,
  instead of silently picking the most-recently-created match when more than
  one organisation has a `Consumer` for the same phone number, treats this as a
  hard, audited failure (drop the message, log/alert loudly) rather than a
  silent best-guess. This converts an invisible misrouting risk into a visible
  operational signal, without building per-number routing. This is a genuinely
  small, surgical change (a handful of lines in one existing method) — not a
  new subsystem.

**Separating Boby Bites' launch requirement from broader SaaS readiness, as
asked**: Boby Bites launching alone needs **nothing further here** — the
ambiguity literally cannot occur with one real tenant. The platform's stated
goal of being "reusable for other manufacturing and distribution businesses
without tenant-specific code changes" is a **different, larger question**
genuinely blocked by this limitation — per-tenant WhatsApp Business number
provisioning (so `metadata.phone_number_id`, already received on every webhook
payload and already unused today, can do real routing) is a real feature,
correctly scoped as future work (Stage 5A's P1-1/P3), not something to retrofit
into this stage.

## 6. Collection Point configuration

**Exact conditions for dedicated vs. shared-warehouse fallback**, verified by
reading `resolveFulfilmentLocation` (`collection-point-fulfillment.service.ts:844-863`)
directly: it first looks for a dedicated `InventoryLocation` tied to the outlet
(`InventoryLocationRepository.findByOutletId`) that is both `status: ACTIVE` and
`locationType: CUSTOMER_LOCATION`; only if none exists does it fall back to the
outlet's legacy, shared `inventoryLocationId`. The fallback usage is never
silent — `markReadyForCollection` records `usedLegacySharedLocation` in its own
audit metadata every time it happens (`collection-point-fulfillment.service.ts:278`).

**Current real state, checked read-only against the actual development
database** (one `SELECT`, no write): Boby Bites has exactly one
`collectionPointStatus: ENABLED` outlet today — "Bodija Supermart — Bodija
Branch" — and it has **no dedicated `CUSTOMER_LOCATION`** at all. Its
`inventoryLocationId` points directly at "Main Warehouse" (`locationType:
WAREHOUSE`, `isDefault: true`) — the same location used for goods receipt,
production output, and every other warehouse-scoped operation. This means
today, in the actual dev data, every D2C availability check and every
fulfilment for this Collection Point reads and decrements the **entire shared
warehouse pool**, not a quantity physically present at the Bodija outlet
counter — a real mismatch risk between "the system says it's available" and
"it's physically at this specific location for a consumer to collect right
now," even though the underlying stock-decrement arithmetic itself is correct
and safe.

**Also verified, same query**: `collectionPointResponsibleUserId` is `null` for
this outlet — no specific staff member is currently assigned as its
responsible operator, meaning only users holding the broader
`sales.customer.manage`/owner-bypass permission can act on it today, not a
dedicated Collection Point operator.

**Safest launch configuration**: before go-live, (1) establish a real,
dedicated `CUSTOMER_LOCATION` for each Collection Point actually in use (via the
existing `recordOpeningStock` path with `arrangement: D2C_COLLECTION_POINT`,
transferring real counted stock onto it), so availability reflects what is
physically at the counter rather than the whole warehouse, and (2) assign a
real `collectionPointResponsibleUserId` per Collection Point so a specific,
accountable staff member (not just any admin) operates it. Both are data/config
actions using existing, already-correct code paths — no code change is
required, and this report performed no write to make either of these true; they
remain open, verified-as-missing items for operations to action.

## 7. Codex UAT handoff

| Test                                                                       | Expected safe behavior                                                                                                                                                                                                              | Executable in isolation?                                                                                                 |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Prepaid order, then stock becomes insufficient before preparation          | Order pays and confirms successfully (no block); `markReadyForCollection` fails with a clear `400` naming the shortfall; stock is untouched; order remains retryable                                                                | Yes — fully local                                                                                                        |
| Two concurrent orders competing for the last units at one Collection Point | Exactly one `confirmCollection` succeeds; the other gets a clean `400 Insufficient stock`, remains `READY_FOR_COLLECTION`, no double-deduction                                                                                      | Yes — fully local, real Postgres                                                                                         |
| Order marked ready after >24h since the consumer's last message            | The "ready for collection" WhatsApp send should be expected to fail against real Meta infrastructure today (error 131047) — **this is a confirmed, known code gap (§2), not a test-environment artifact to report as new**          | Requires real Meta infrastructure to observe the actual rejection; the code path up to the send attempt is fully local   |
| A WhatsApp send fails                                                      | `ConsumerWhatsAppDelivery.status` flips to `FAILED` with `lastErrorCode`/`lastErrorMessage` populated; visible via the admin communication view; manually retryable                                                                 | Yes — simulate by having the local/test provider return a failure                                                        |
| Duplicate webhook delivery (same Meta message id twice)                    | Second delivery is rejected by `WhatsAppWebhookEventRepository.tryClaim`'s unique constraint; processed exactly once                                                                                                                | Yes — fully local, real Postgres (`whatsapp-webhook-event-concurrency.integration.spec.ts` already proves the primitive) |
| Collection Point pickup, then a duplicate confirmation attempt             | First succeeds and deducts stock once; the duplicate matches zero rows in the conditional status update and returns the already-`COLLECTED` result, never re-deducting                                                              | Yes — fully local, real Postgres                                                                                         |
| Customer-owned stock visibility vs. company valuation                      | Customer-owned stock remains visible via `InventoryStockRepository.findByProductAndLocation` (operational read) but is excluded from `InventoryValuationService.getValuation()`'s company-asset total (Stage 4E.4D's correction)    | Yes — fully local                                                                                                        |
| Cross-tenant conversation and order isolation                              | The new tenant's conversation config/orders/consumers never appear in Boby Bites' admin views and vice versa                                                                                                                        | Yes — fully local, mirrors the already-proven `d2c-conversation-config-active-safety.integration.spec.ts` pattern        |
| Missing or invalid webhook signature                                       | **Currently accepted, not rejected** (§1) — if `WHATSAPP_APP_SECRET` is unset in the test environment, expect this test to demonstrate the gap, not a false pass; set the secret first if the intent is to verify correct rejection | Yes — fully local, no real Meta needed to test the signature-check logic itself                                          |
| Payment success followed by fulfilment failure                             | Payment records `RECORDED`; `CollectionPointFulfillment` can still fail at `markReadyForCollection`/`confirmCollection`; the order remains correctly `CONFIRMED` with no stock moved yet — confirming §3's traced gap directly      | Yes — fully local                                                                                                        |

**Important heads-up specific to Codex's own new-tenant creation, not previously
flagged**: because tenancy is resolved by phone-number lookup against existing
`Consumer` rows, with `WHATSAPP_DEFAULT_ORGANISATION_ID` as the fallback for a
phone number that has never messaged anyone — **a brand-new test phone number
used against Codex's new tenant will route to whatever organisation
`WHATSAPP_DEFAULT_ORGANISATION_ID` currently points to**, which may well still
be Boby Bites, not the new tenant. Codex should verify this variable's intended
target before relying on "a never-before-used phone number" to reach the new
tenant, or should ensure the new tenant already has at least one `Consumer` row
for the test phone number created through an in-scope, already-permitted path
(e.g. the admin `ConsumerController`, not a raw database insert) before testing
inbound messages.

**Known implementation limitations not to mistake for defects** (carried
forward from Stage 5A, reaffirmed here with deeper verification): no stock
reservation exists anywhere (§3); no refund mechanism exists anywhere (§4); the
single shared WhatsApp number creates ambiguous routing with 2+ active tenants
(§5); Collection Point availability may reflect a whole shared warehouse rather
than a physically-dedicated location (§6) — all four are confirmed, understood,
and already covered by this report's recommendations, not new findings for
Codex to re-discover and re-report.

## 8. Recommended implementation order

1. **Set `WHATSAPP_APP_SECRET` in any environment that talks to real Meta
   infrastructure** (§1) — configuration only, zero code, do first.
2. **Add the `131047` → `TERMINAL_FAILURE` classification** to
   `mapErrorResponse` (§2) — smallest possible code change, immediately makes
   the real failure mode visible to staff instead of silently retry-looping.
3. **Start Meta template approval for "ready for collection"/"collection
   confirmed"** (§2) — has external lead time; start in parallel with
   everything else, don't wait on it to begin other work.
4. **Add the boot-time `WHATSAPP_APP_SECRET`-required-when-`meta`-mode check**
   (§1) — small, mirrors existing code exactly, closes the configuration gap
   permanently rather than relying on operators remembering.
5. **Move the stock-availability check to immediately after payment
   confirmation/auto-assignment** (§3) — small, additive, reuses existing
   `getAvailability()`.
6. **Wire the session-window-aware template fallback into `notify()`** (§2) —
   depends on step 3's template approval completing; this is the step that
   actually closes P0-1 end to end.
7. **Operational actions, no code**: establish dedicated `CUSTOMER_LOCATION`s
   and assign `collectionPointResponsibleUserId` for every real launch
   Collection Point (§6); document the manual cancel-void-refund runbook (§4);
   decide and, if needed, implement the single-active-tenant guard (§5).

Steps 1-5 are each individually small and independently shippable; step 6 is
gated on external template approval, not on anything else in this list.

## 9. Explicit product decisions requiring approval

1. **Is it acceptable to launch with manual-only refunds** (cancel + void +
   staff manually refunds via OPay's dashboard, §4), or does the business
   require an in-app refund path from day one?
2. **Should the small code guard in §5 (fail loud on cross-tenant phone
   ambiguity) be built now**, or is the operational commitment ("only one
   tenant active on D2C at a time") sufficient for Boby Bites' launch, with the
   guard deferred until a second tenant is actually being onboarded?
3. **Is Boby Bites' Collection Point operations team already prepared to cut
   over to a dedicated `CUSTOMER_LOCATION`** (§6), or should MVP launch
   proceed on the shared-warehouse fallback with the understood availability-
   accuracy risk, with cutover scheduled as a near-term follow-up?
4. **Should the payment-time stock check (§3, recommended fix) block
   assignment outright on a shortfall, or merely flag it for staff while still
   assigning the order?** This affects whether a consumer who pays into a
   shortfall gets an immediate, automatic "there may be a delay" message or
   whether staff discover and handle it entirely manually, slightly later.
5. **How many real Collection Points, and what order volume, is actually
   expected in week one?** This directly determines whether the no-reservation
   residual risk (§3) is a theoretical concern or one likely to surface
   immediately, and sizes how urgently step 5 of §8 needs to ship before
   go-live versus shortly after.
