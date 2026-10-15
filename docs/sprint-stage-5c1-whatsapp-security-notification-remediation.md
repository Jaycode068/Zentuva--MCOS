# Stage 5C.1 — WhatsApp Security and Notification Reliability (Implementation)

Narrowly scoped implementation of the two confirmed P0s from Stage 5B. No payment,
refund, stock-reservation, Collection-Point-stock, or multi-number-routing work was
done — all explicitly out of scope. No migration, no development data mutation, no
staging/commit/push. Codex's own working files (`scripts/`, `docs/assessment-evidence/`,
`docs/project-understanding-integration-uat-notes.md`,
`docs/stage-c1-independent-integration-baseline.md`) were identified during the
preflight and not touched.

## 1. Exact defects corrected

1. **Webhook signature bypass had no production/development distinction.**
   `WhatsAppWebhookController.verifySignature` returned `true` unconditionally
   whenever `WHATSAPP_APP_SECRET` was unset, with no `NODE_ENV` or mode check of any
   kind — identical behavior in a real Meta-connected deployment and in local
   development. Fixed: a new boot-time gate
   (`assertWebhookSignatureConfigured`) now fails the application at startup if
   `WHATSAPP_PROVIDER_MODE=meta` and no secret is configured, and `verifySignature`
   itself independently re-checks the mode before ever bypassing, rather than
   trusting that the boot-time check ran.
2. **Meta's 24-hour messaging-window error (131047) was misclassified as a generic,
   indefinitely retryable failure.** `mapErrorResponse` had no case for it, so it fell
   into the `WHATSAPP_UNKNOWN`/`RETRYABLE_FAILURE` default — a code whose actual
   failure mode (the window only reopens on a new inbound message, never on elapsed
   time) made every automated or operator retry fail identically forever. Fixed: a
   dedicated `WHATSAPP_MESSAGING_WINDOW_EXPIRED` / `TERMINAL_FAILURE` case.
3. **`COLLECTION_READY`/`COLLECTION_CONFIRMED` notifications always sent free-form
   text, with no awareness of the messaging window at all** — the exact condition
   that produces defect 2 in production. Fixed: `WhatsAppConsumerNotificationService`
   now checks the consumer's last-inbound-message time before every send attempt
   (including every retry, re-evaluated fresh); within the window, behavior is
   unchanged (`sendText`); outside it, it sends an approved template if one is
   configured, and otherwise fails closed with a distinct, operator-visible
   `WHATSAPP_TEMPLATE_NOT_CONFIGURED` error — it never falls back to the free-form
   send that caused defect 2.

## 2. Files changed

**Webhook security**

- `apps/api/src/notifications/infrastructure/meta-whatsapp-provider.ts` — new
  `assertWebhookSignatureConfigured` export (reuses `WhatsAppConfigurationError`);
  new `131047` → `WHATSAPP_MESSAGING_WINDOW_EXPIRED` case in `mapErrorResponse`.
- `apps/api/src/d2c/whatsapp/whatsapp-webhook.controller.ts` — constructor now calls
  `assertWebhookSignatureConfigured`; `verifySignature`'s no-secret branch now checks
  provider mode and rejects (rather than accepts) when it reads `meta`.
- `apps/api/src/notifications/infrastructure/meta-whatsapp-provider.spec.ts`,
  `apps/api/src/d2c/whatsapp/whatsapp-webhook.controller.spec.ts` — new tests (§7).

**Notification reliability**

- `apps/api/src/d2c/messaging/whatsapp-messaging-window.ts` (new) — pure
  `isWithinMessagingWindow` helper.
- `apps/api/src/d2c/messaging/d2c-whatsapp-template.ts` (new) — D2C-specific template
  resolver, returns `null` (fail closed) when nothing is configured.
- `apps/api/src/d2c/messaging/whatsapp-consumer-notification.service.ts` —
  `attemptSend` now re-derives the window/template decision on every call (initial
  send and every retry alike); new `ConfigService` constructor dependency.
- `apps/api/src/d2c/consumer/consumer.repository.ts`,
  `apps/api/src/d2c/consumer/consumer.service.ts` — new
  `findLastInboundMessageAt`/`getLastInboundMessageAt` (read-only, zero schema
  change — see §3).
- `apps/api/src/d2c/messaging/whatsapp-messaging-window.spec.ts`,
  `apps/api/src/d2c/messaging/d2c-whatsapp-template.spec.ts`,
  `apps/api/src/d2c/messaging/whatsapp-consumer-notification.service.spec.ts`,
  `apps/api/src/d2c/consumer/consumer.repository.spec.ts` — new tests (§7).

**Configuration**

- `apps/api/src/config/env.validation.ts`, `apps/api/src/config/configuration.ts` —
  four new, genuinely optional env vars for D2C template names/languages (no assumed
  default, unlike the two existing Sprint 29/30 templates — see §5); updated doc
  comments on `WHATSAPP_APP_SECRET` reflecting the new fail-closed behavior.

No `.env` file was modified and no secret value was read, logged, or reported
anywhere in this stage — only variable _names_ were ever inspected, exactly as the
hard boundary requires.

## 3. Webhook security behavior

**Gated on `WHATSAPP_PROVIDER_MODE`, never `NODE_ENV`** — the same existing signal
`loadMetaWhatsAppConfig` already uses to distinguish "this deployment really talks to
Meta" from "the safe local/dev provider," reused rather than inventing a second
production/non-production check. This is deliberate: `NODE_ENV=production` can
legitimately run with the local stub provider (e.g. a staging environment), and
`WHATSAPP_PROVIDER_MODE=meta` has already been used for real-traffic testing outside
strict production per this codebase's own history — provider mode is the actually
load-bearing signal for "can real Meta webhooks arrive here."

- **`WHATSAPP_PROVIDER_MODE=meta`, no `WHATSAPP_APP_SECRET`**: the application now
  fails to start, with a clear message naming the missing variable — never a request
  path that silently accepts unsigned traffic. Verified by a new constructor test.
- **`WHATSAPP_PROVIDER_MODE=meta`, secret configured**: starts normally; every POST is
  verified exactly as before (unchanged HMAC-SHA256 + `timingSafeEqual` logic — no
  change to the raw-body handling or the comparison itself).
- **`WHATSAPP_PROVIDER_MODE=local` (this deployment's current setting), no secret**:
  starts normally, matching every pre-existing local/dev test and this deployment's
  actual running configuration — confirmed unaffected by re-checking `.env` (provider
  mode is `local`) and by the dev API staying healthy (`200` on `/api/health`) after
  the change was picked up by the running `nest --watch` process.
- **Defensive belt-and-suspenders**: `verifySignature` itself re-checks provider mode
  independently at request time rather than trusting that the constructor's check
  ran — proven by a test that constructs the controller in `local` mode (passes) and
  then flips the mocked config to `meta` before the next request, confirming the
  method still rejects rather than blindly trusting its own earlier construction.
- **Invalid signatures continue to be rejected, valid ones continue to work,
  unchanged** — confirmed by the existing, unmodified tests for both cases still
  passing.
- **Raw request body handling is untouched** — no change to `req.rawBody` or how it's
  passed into the HMAC computation.

## 4. Notification and template behavior

**Decision, re-derived fresh on every attempt (including retries)**: for
`COLLECTION_READY`/`COLLECTION_CONFIRMED` only — `CONVERSATION_REPLY` is always a
reply to an inbound message and is unconditionally inside the window by
construction, so it is never checked.

```
consumer's last inbound message (ConsumerConversation.updatedAt — see below)
  within 24h  → sendText, exactly as before (no behavior change)
  outside 24h → an approved template is configured?
                  yes → sendTemplate(name, language, bodyParameters: [renderedText])
                  no  → fail closed: markFailed('WHATSAPP_TEMPLATE_NOT_CONFIGURED'),
                        no provider call is attempted at all
```

**Why retry re-evaluates fresh, not just the initial attempt**: `attemptSend` is
shared by the first send and by `ConsumerCommunicationService.retry()`. A retry can
happen hours after the original failure — by then the window may have closed further
(an original in-window attempt should not be blindly repeated once stale) or reopened
(the consumer messaged back in since). Re-deriving the decision from `delivery.kind`
and the consumer's _current_ last-inbound time on every call makes both directions
correct automatically, with no special-casing for "is this a retry."

**Where "last inbound message" comes from — zero schema change**: there is no
dedicated timestamp column anywhere for this. Rather than add one,
`ConsumerRepository.findLastInboundMessageAt` reads `ConsumerConversation.updatedAt`
— verified, by reading every call site in the codebase, to be written _exclusively_
inside `ConversationService`'s `dispatch()` tree, itself reachable only from
`handleInboundMessage`. No other code path (the admin transcript viewer, the webhook
adapter's own lookups) ever writes to a `ConsumerConversation` row. This makes
`updatedAt` a faithful, already-existing proxy for "the last time this consumer's
inbound message was processed" — confirmed safe to reuse without a migration.

**Template parameter shape — an assumption, not a verified fact, stated as such in
code**: the one body parameter passed to `sendTemplate` is the already-rendered,
human-readable notification text. This mirrors the exact framing
`APPROVAL_TEMPLATE_PARAMETER_ORDER`'s own doc comment already uses for an identical
situation (no real approved account to verify against this stage) — the real
template's eventual parameter structure must be confirmed against Meta's actual
approval before this is trusted in production.

**Never marks "delivered" from an accepted send request** — unchanged from before this
stage: `markSent` has always meant "Meta's API accepted the call," never "the
consumer received it." This stage's doc comments make that explicit at the call site,
but the stored `WhatsAppDeliveryStatus.SENT` value and its meaning are unchanged.

**Order/collection state is never touched by a notification failure** — confirmed by
inspection, not changed: `CollectionPointFulfillmentService.notifyReady`/
`notifyCollected` are called strictly after the status transition and its audit
record already committed; `WhatsAppConsumerNotificationService.notify()`'s own
try/catch still swallows every failure (now including the new
`WHATSAPP_TEMPLATE_NOT_CONFIGURED` case) and never throws back into the fulfilment
flow.

**Failures remain visible through the existing operational surface, not a new one** —
`WHATSAPP_MESSAGING_WINDOW_EXPIRED` and `WHATSAPP_TEMPLATE_NOT_CONFIGURED` are stored
in the same `ConsumerWhatsAppDelivery.lastErrorCode`/`lastErrorMessage` fields every
other failure already uses, visible via the existing, unmodified
`ConsumerCommunicationService.listForConsumer`/`listForOrder`/`listForConversation`
admin views — no new table, no new endpoint.

**Never silently sends an unapproved or missing template** — the fail-closed branch
is the one new terminal outcome this stage adds; it is reached whenever a template is
needed but not configured, and it never calls the provider at all in that case.

## 5. Required Meta configuration and approvals

- **Immediately actionable, no external dependency**: set `WHATSAPP_APP_SECRET` in
  any environment that runs `WHATSAPP_PROVIDER_MODE=meta`. The application will now
  refuse to start without it in that mode, so this cannot be forgotten silently.
- **Requires real Meta template approval, external lead time**: `WHATSAPP_D2C_
COLLECTION_READY_TEMPLATE_NAME`/`_LANGUAGE` and `WHATSAPP_D2C_COLLECTION_
CONFIRMED_TEMPLATE_NAME`/`_LANGUAGE` are genuinely optional with **no assumed
  default** (unlike the two existing Sprint 29/30 templates, which default to a
  presumed name) — there is nothing plausible to default to, since no D2C template
  has been submitted for approval yet. Until two templates are approved and their
  real names configured, every `COLLECTION_READY`/`COLLECTION_CONFIRMED`
  notification sent outside the 24h window will fail closed with
  `WHATSAPP_TEMPLATE_NOT_CONFIGURED` — this is the correct, intended behavior for
  that gap, not a regression; it replaces a silent delivery failure with a visible,
  diagnosable one.
- **No live WhatsApp messages were sent at any point in this stage** — every test
  uses a mocked `WhatsAppProvider`; `fetch` itself is mocked in
  `meta-whatsapp-provider.spec.ts`.

## 6. Tenant-isolation safeguards

No change to how tenancy is resolved for inbound webhooks (the single-shared-number
limitation is explicitly out of scope for this stage, per instruction — documented
below, not touched). The new code added this stage was checked specifically for
cross-tenant leakage:

- `assertWebhookSignatureConfigured` reads global, deployment-wide config
  (`WHATSAPP_PROVIDER_MODE`/`WHATSAPP_APP_SECRET`) — there is no per-organisation
  secret or template to leak between tenants in the first place, since this
  deployment shares one Meta WhatsApp Business number and one app secret across
  every organisation by design.
- `resolveD2CWhatsAppTemplate` resolves purely from global config by notification
  `kind`, never by `organisationId` — consistent with the existing shared-number
  model; there is no tenant-specific template name to mix up across organisations.
- `ConsumerRepository.findLastInboundMessageAt` takes `organisationId` and filters by
  it directly in the Prisma query — verified by a new, dedicated test that a
  conversation belonging to a different organisation is never returned.
- `whatsapp-independence.spec.ts` and `d2c-independence.spec.ts` (the existing
  structural guards) both still pass unmodified against the new code, confirming no
  forbidden cross-domain import or direct table write was introduced.

**Documented deployment restriction (Stage 5B's finding, unchanged, not
implemented)**: this deployment shares exactly one Meta WhatsApp Business phone
number across every tenant. Until per-tenant WhatsApp Business number provisioning
exists (explicitly out of scope — "Do not implement multi-number routing in this
stage"), operate with **at most one organisation actively using D2C/WhatsApp at a
time** in any environment where real consumer traffic is expected. This is the same
restriction Stage 5B already identified; this stage neither worsens nor resolves it.

## 7. Test results

**New unit tests**: 4 new test files
(`whatsapp-messaging-window.spec.ts` — 6 tests,
`d2c-whatsapp-template.spec.ts` — 7 tests) plus extensions to 4 existing files
(`whatsapp-consumer-notification.service.spec.ts` +6, `whatsapp-webhook.controller.spec.ts`
+4, `meta-whatsapp-provider.spec.ts` +1, `consumer.repository.spec.ts` +4) covering
every category this stage's brief listed: missing production webhook secret (boot
throws); valid and invalid signatures (unchanged, re-confirmed); messaging within the
session window (unchanged `sendText` path); messaging outside the window, with and
without a configured template; Meta error 131047 classification; missing/unapproved
template configuration (fails closed, provider never called); retry classification
(a retry re-evaluates the window fresh, independent of the original attempt's
outcome); notification failure without changing order state (confirmed by inspection
of the unmodified try/catch boundary — no new test needed since no code path changed
there); tenant isolation (`findLastInboundMessageAt` cross-org test).

**Duplicate webhook delivery**: already covered by the existing, unmodified
`whatsapp-webhook-event-concurrency.integration.spec.ts` — re-run as a regression
check (3/3 passing), no new test added since no code in that path changed.

**Full results**:

- `src/d2c/` + `src/notifications/` unit suite: **50 suites / 560 tests, all
  passing**.
- Full default suite (`pnpm test` equivalent): **275 suites / 2658 tests, all
  passing** (up from Stage 5A's 273/2630 baseline by exactly the 2 new suites and 28
  new tests this stage added — zero regressions).
- Type-check: clean, zero errors.
- Lint: clean on every file touched, zero new errors or warnings.
- Real-PostgreSQL integration: the two directly relevant suites
  (`whatsapp-webhook-event-concurrency.integration.spec.ts`,
  `consumer-whatsapp-delivery-concurrency.integration.spec.ts`) pass (7/7). Full
  integration run: **13/16 suites pass**, the same **3 pre-existing, unrelated
  failures** already documented in Stages 5A/5B
  (`reporting-tenant-isolation.integration.spec.ts`,
  `d2c-conversation-config-active-safety.integration.spec.ts`,
  `d2c-conversation-config-concurrency.integration.spec.ts` — all requiring a second
  seeded organisation the current test database doesn't have), identical counts to
  before this stage (16 failed / 91 passed / 107 total) — confirmed not a new
  regression.

## 8. Deployment dependencies

1. **`WHATSAPP_APP_SECRET` must be set before any deployment switches
   `WHATSAPP_PROVIDER_MODE` to `meta`** — the application will not start otherwise.
   This is a configuration action with no code dependency.
2. **Two WhatsApp message templates need to be submitted for Meta approval** —
   "ready for collection" and "collection confirmed" — before notifications sent
   outside the 24h window can succeed in production. Until approved and configured,
   the application correctly and visibly fails closed rather than attempting a
   doomed free-form send.
3. No other external dependency was introduced — no new provider, no new API
   surface, no schema change.

## 9. Remaining risks

- Until the two D2C templates are approved, every `COLLECTION_READY`/
  `COLLECTION_CONFIRMED` notification outside the 24h window will fail closed and
  require manual operator follow-up (visible via the existing admin delivery view) —
  this is the intended, safe interim behavior, not a residual defect, but it means
  the underlying consumer-experience gap Stage 5B identified is not fully closed
  until those templates exist. Operational awareness of this is itself a dependency.
- The single-shared-WhatsApp-number limitation remains exactly as documented in
  Stage 5B — unresolved and explicitly out of this stage's scope.
- `ConsumerConversation.updatedAt` as a proxy for "last inbound message" is correct
  today because no other code path writes to that table — this is a structural
  invariant worth re-verifying if the Conversation Layer is ever extended with a new
  admin-initiated write path to that model.
- No live Meta credentials or template approval were available to verify the actual
  wire-format of a real template send — the `bodyParameters: [text]` shape is a
  documented assumption, consistent with how this codebase already handles the
  identical situation elsewhere, but not yet verified end-to-end against a real
  account.

Backup checksum re-verified `OK` at the end of this stage; development database
counts were read-only inspected (never mutated) and the safety copy was not touched.

---

Stage 5C.1 implementation and verification are complete. Stopping here for review.
