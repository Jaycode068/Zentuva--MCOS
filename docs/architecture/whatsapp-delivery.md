# WhatsApp Delivery Architecture

Sprint 29 — WhatsApp Notification Delivery Foundation. A focused architecture
decision record for how WhatsApp fits into the existing Notifications/Workflow
boundary (see
[docs/architecture/notification-activity-boundaries.md](notification-activity-boundaries.md)
for the Sprint 27.1 record, and
[docs/architecture/email-delivery.md](email-delivery.md) for the Sprint 28 record
this one is a structural sibling of, not a derivative) — why the pipeline is shaped
the way it is, and what it deliberately does not promise.

## 1. Notification intent versus delivery attempt

The same three-layer relationship `EmailDelivery` established one level further
downstream, now with a THIRD independent leaf:

```text
WorkflowEvent    (did the thing happen — Workflow's own record)
      │
Notification     (does this ONE user need to know, in-app — Sprint 27)
      │
      ├── EmailDelivery     (did we ALSO try to email them about it — Sprint 28)
      │
      └── WhatsAppDelivery  (did we ALSO try to WhatsApp them about it — Sprint 29)
```

`EmailDelivery` and `WhatsAppDelivery` are SIBLINGS, not a chain — neither reads,
writes, or imports the other. Both read the same `Notification` row independently.
A WhatsApp send failing has zero effect on whether the email send (or the in-app
`Notification` itself) succeeds, and vice versa; `NotificationsController`'s
`processEvents()` triggers both channels' creation+processing in the same request
but wrapped in independent `try`/`catch` blocks specifically so one channel's
exception can never mask or interrupt another's.

`WhatsAppDeliveryCreationService` never re-evaluates whether the underlying
workflow event was legitimate; it only asks "is this already-created `Notification`
eligible for a WhatsApp message."

## 2. Why WhatsApp is a pure downstream consumer, never inline

`WorkflowInstanceService` (Sprint 26/26.1) is untouched by this sprint — not one
line changed. The dependency chain is strictly one-directional:

```text
Workflow transition
        ↓
WorkflowEvent (durable, transactional)
        ↓
NotificationEventProcessorService → Notification (Sprint 27, unchanged)
        ↓
WhatsAppEligibilityService → WhatsAppDeliveryCreationService → WhatsAppDelivery (Sprint 29)
        ↓
WhatsAppDeliveryProcessorService → WhatsAppProvider → provider result
```

`WhatsAppDeliveryCreationService`/`WhatsAppDeliveryProcessorService` read the
`Notification` table directly via Prisma — never `NotificationEventProcessorService`,
never `WorkflowInstanceService`/`WorkflowInstanceRepository`/`WorkflowDefinitionRepository`.
Verified structurally by `notifications-independence.spec.ts`'s extended guards
(Sprint 27's own convention, now covering every Sprint 29 file too, and asserting
`NotificationsModule`'s own `imports` array is an exact, closed set including the
new `WhatsAppProviderModule`).

**Why this matters in practice**: a WhatsApp Business Platform HTTP round-trip can
take seconds, can hang, can fail in ways a database transaction cannot meaningfully
wrap. If WhatsApp creation or sending were embedded inside the workflow transition's
own transaction (or even inside `NotificationEventProcessorService`'s), a slow or
failing WhatsApp API would directly threaten the availability of the actual business
operation (approving a Purchase Order) it has nothing to do with. Keeping WhatsApp
strictly downstream and its own separately-triggered pipeline means a provider
outage degrades WhatsApp only — Workflow, in-app notifications, and email are
provably unaffected. Live-verified this sprint: 19 deliveries simulating a
retryable failure and 1 simulating a terminal failure were driven through the real
pipeline end-to-end, and the underlying `WorkflowInstance`/`Notification` rows for
every one of them remained completely untouched throughout.

## 3. Delivery state machine — why `SENT`, not `DELIVERED`

```text
PENDING → PROCESSING (claimed) → SENT      (terminal, success)
                                → FAILED    (terminal, attempts exhausted or
                                              provider said "don't retry")
        ← PENDING                          (retryable failure, attempts remain,
                                              nextRetryAt scheduled)
```

`SENT` means **the provider accepted the message for delivery** — a successful
Meta Graph API response (or, for `LocalWhatsAppProvider`, a simulated acceptance),
nothing more. It is deliberately NOT named `DELIVERED`: neither `LocalWhatsAppProvider`
(in-memory, no real transport) nor `MetaWhatsAppProvider` (a plain REST call, no
delivery-status-webhook integration in this sprint's scope) can prove a message
actually reached the recipient's device, was displayed, or was read. Claiming
`DELIVERED` or `READ` would be a promise this codebase cannot back up — WhatsApp
Business Platform DOES offer delivery/read-receipt webhooks, but wiring them is
explicitly out of this sprint's scope (§8 "Deferred Scope").

Fields, mirroring `EmailDelivery`'s naming where it doesn't conflict, but adopting
the brief's own simplified `processingStartedAt`/`processedAt` naming instead of a
literal `EmailDelivery` field-for-field mirror (see §9 below for why):

`id, organisationId, notificationId, recipientUserId, recipientPhoneSnapshot,
recipientDisplayNameSnapshot, templateName, templateLanguage,
templateParameterSnapshot (Json), category, status, attempts,
processingStartedAt, processedAt, nextRetryAt, providerName, providerMessageId,
lastErrorCode, lastErrorMessage, createdAt, updatedAt, channel`.

`@@unique([organisationId, notificationId, channel])` — the identical idempotency
shape `Notification` and `EmailDelivery` already use, `channel` always `WHATSAPP`
on this table.

## 4. Failure model — retryable vs. terminal

`WhatsAppProvider.sendTemplate()` returns one of three outcomes, decided entirely
by the provider adapter (`LocalWhatsAppProvider`/`MetaWhatsAppProvider`), never
guessed by the processor:

- **`ACCEPTED`** → `SENT`.
- **`RETRYABLE_FAILURE`** → back to `PENDING` with `nextRetryAt` scheduled via
  backoff (`[0, 2min, 10min]`), UNLESS attempts are exhausted
  (`MAX_WHATSAPP_ATTEMPTS = 3`), in which case it becomes terminal `FAILED`
  anyway — a retryable outcome does not mean infinite retries.
- **`TERMINAL_FAILURE`** → `FAILED` immediately, regardless of attempt count (an
  invalid access token or an unapproved template will not resolve itself by
  trying again sooner).

`MetaWhatsAppProvider`'s classifier (`mapErrorResponse`): HTTP `401`/Meta error
code `190` (invalid/expired token) → terminal `WHATSAPP_AUTH`; codes `131026`/
`131030` (invalid recipient) → terminal `WHATSAPP_INVALID_RECIPIENT`; codes
`132000`/`132001`/`132005`/`132007` (template missing/mismatched/unapproved) →
terminal `WHATSAPP_INVALID_TEMPLATE`; code `80007` or HTTP `429` (rate limited) →
retryable `WHATSAPP_RATE_LIMITED`; HTTP `≥500` → retryable `WHATSAPP_SERVER_ERROR`;
anything unrecognized → retryable `WHATSAPP_UNKNOWN` (default-safe, same
convention as `SmtpEmailProvider`'s own `SMTP_UNKNOWN`, Sprint 28). A network-level
failure (DNS, connection refused, timeout) is always `RETRYABLE_FAILURE` —
`WHATSAPP_NETWORK` — never treated as a message-content or auth problem.

This sprint's retry POLICY (`whatsapp-delivery-processing.constants.ts`) borrows
email's numbers (`MAX_WHATSAPP_ATTEMPTS = 3`, backoff `[0, 2min, 10min]`,
`WHATSAPP_PROCESSING_LEASE_MS = 10 minutes`) as a reasonable starting point —
WhatsApp Business Platform failures (rate limiting, template/auth issues) are
closer in profile to email's SMTP failures than to an in-process DB hiccup — but
lives in its own independently-configurable file, never a shared import with
`email-delivery-processing.constants.ts` or `notification-processing.constants.ts`,
so any one channel's policy can change without affecting the others.

## 5. At-least-once delivery — an honest limitation, not exactly-once

The provider call happens OUTSIDE any database transaction — an HTTP round-trip to
the WhatsApp Business Platform cannot meaningfully participate in a Postgres
transaction. This creates a real, narrow window: if the provider accepts a message
and this process crashes before the `markSent` write commits, the row stays
`PROCESSING` with a lease; the next sweep's stale-lease recovery reclaims it and
sends it AGAIN.

This codebase does not claim exactly-once delivery, and does not pretend
otherwise. Mitigations that exist:

- `WhatsAppDelivery.id` is passed to every provider call as `correlationId`
  (`X-Zentuva-Correlation-Id` header on the real Meta adapter) specifically so a
  human reconciling the provider's own send log against this table CAN spot a
  duplicate after the fact.
- `providerMessageId` is recorded whenever the provider returns one.
- Neither adapter implemented this sprint gives this codebase real provider-side
  idempotency (the Meta Cloud API's `/messages` endpoint does not accept a
  client-supplied idempotency key).

At-least-once, with the duplicate risk documented and bounded to a narrow crash
window, is the same accepted trade-off Sprint 28 documented for email — live-
verified this sprint via 6 concurrent `process-events` requests racing on the same
freshly-submitted notification: exactly one created a `WhatsAppDelivery` row (the
other 5 correctly no-op'd on the DB-unique-constraint-backed `create()` call), and
8 consecutive replays of `process-whatsapp` against a fully-drained backlog each
returned `created: 0` — zero duplicate rows in either case.

## 6. Provider-independent adapter

`apps/api/src/notifications/ports/whatsapp-provider.port.ts` — mirrors the
established `FileStorage` (Sprint 3.4) / `EmailProvider` (Sprint 28) port pattern
exactly: a `WhatsAppProvider` interface (`sendTemplate`) + `WHATSAPP_PROVIDER` DI
token, selected once at boot by `infrastructure/whatsapp-provider.module.ts` based
on `WHATSAPP_PROVIDER_MODE` (`local` | `meta`, default `local`). Nothing downstream
of the token knows or cares which concrete adapter it's talking to.

- **`LocalWhatsAppProvider`** (`infrastructure/local-whatsapp-provider.ts`) — the
  default. Never contacts the real WhatsApp API; records every message in memory
  for assertions; deterministic. Failure simulation via reserved test PHONE
  NUMBERS (email's `+tag@domain` plus-addressing trick has no phone equivalent, so
  this defines two static constants instead — no extra configuration surface, no
  test-only method threaded through the processor):
  `LocalWhatsAppProvider.SIMULATE_RETRYABLE_FAILURE_NUMBER = '+10000000001'` →
  `RETRYABLE_FAILURE`, `SIMULATE_TERMINAL_FAILURE_NUMBER = '+10000000002'` →
  `TERMINAL_FAILURE`, anything else → `ACCEPTED`. "No developer should
  accidentally send a real WhatsApp message simply by running the API locally" —
  this is the only provider ever constructed unless `WHATSAPP_PROVIDER_MODE=meta`
  is set explicitly.
- **`MetaWhatsAppProvider`** (`infrastructure/meta-whatsapp-provider.ts`) — a real
  WhatsApp Business Platform (Meta Cloud API) integration via `POST
/{phone_number_id}/messages`, using Node's built-in `fetch` — no new HTTP-client
  dependency, no Meta SDK. Maps Meta Graph API responses per §4 above. Never logs
  `WHATSAPP_ACCESS_TOKEN`; every error surfaced is a short, hand-built string
  (category + Meta's own numeric error code, never the raw response body). Never
  logs a full recipient phone number — `redactPhone()` keeps only the country
  code and last 2 digits (`+234***89`) for any log line.
- **Fail loud, never silently downgrade**: `WHATSAPP_PROVIDER_MODE=meta` with any
  required field (`WHATSAPP_API_BASE_URL`/`WHATSAPP_ACCESS_TOKEN`/
  `WHATSAPP_PHONE_NUMBER_ID`) missing/empty throws `WhatsAppConfigurationError` at
  CONSTRUCTION time (app boot), listing which non-secret field NAMES are missing —
  never falls back to the local provider while reporting success (identical
  pattern to `SmtpConfigurationError`, Sprint 28).

## 7. Why transactional only — no chatbot, no broadcast, no commerce

This sprint deliberately implements nothing that would make WhatsApp a two-way
conversational surface or a marketing/broadcast tool: no chatbot, no two-way
conversation handling, no WhatsApp-initiated approval actions (a reply to a
WhatsApp message never approves anything — the message only LINKS into Zentuva;
the actual approval stays fully protected by the existing authentication,
`EffectiveAccessResolver`, workflow eligibility, concurrency protections, and
tenant isolation, exactly as if the user had navigated there directly), no
marketing/promotional campaigns, no bulk messaging, no WhatsApp groups, no
customer-service inbox, no SMS/voice, no commerce/payments, no media-heavy
workflows, no external CRM integration, no analytics beyond delivery status. Every
WhatsApp message this pipeline can ever send traces back to exactly one
`Notification`, which traces back to exactly one `WorkflowEvent` — there is no
code path that creates a `WhatsAppDelivery` without a real, already-authorized
underlying event, and only `WORKFLOW_APPROVAL_REQUIRED` has a template this sprint
(§9). The "one WhatsApp message always corresponds to one real thing that
happened, using a pre-approved template" invariant is what keeps this a
transactional notification channel, not a general-purpose send capability.

## 8. Template model

WhatsApp business-initiated messages must use a Meta-pre-approved template —
never arbitrary free-form text. `whatsapp-template.ts`'s `resolveWhatsAppTemplate`
is the ONE place a `NotificationType` resolves to a template name; no caller may
pass a template name in directly, and no client-supplied template name is ever
accepted from any API request. Deliberately narrow this sprint: only
`WORKFLOW_APPROVAL_REQUIRED` has a template (`zentuva_approval_required`,
configurable via `WHATSAPP_APPROVAL_TEMPLATE_NAME`/`_LANGUAGE`) — every other
`NotificationType` resolves to `null`, which `WhatsAppEligibilityService` treats
as "not WhatsApp-eligible," exactly like `EmailEligibilityService`'s own category
scoping.

`templateParameterSnapshot` is persisted as a named, human-readable JSON record
(`recipientName`, `documentType`, `documentNumber`, `approvalUrl`) — safe,
inspectable in the admin UI, no unsafe HTML/markup interpolation (a WhatsApp
template body is plain text), no secrets. **Deliberately omits a monetary
"amount" parameter**, even though a natural example message might show one — no
`Notification`/`WorkflowEvent` field carries a business amount, and adding one
would require a new cross-domain READ into Procurement, out of this sprint's
scope and unnecessary to prove the pipeline.

### Template placeholder order — an open item

Meta templates use POSITIONAL `{{1}}`/`{{2}}`/`{{3}}`/`{{4}}` body placeholders,
not named ones. `APPROVAL_TEMPLATE_PARAMETER_ORDER =
['recipientName', 'documentType', 'documentNumber', 'approvalUrl']` in
`whatsapp-template.ts` defines the order `MetaWhatsAppProvider` maps the named
snapshot into positional API parameters. **This exact order is an assumption, not
a verified fact** — no real WhatsApp Business account with an approved
`zentuva_approval_required` template was available this sprint to confirm
against. Before any real send, an operator must verify the actual approved
template's placeholder definitions in the Meta Business Manager and adjust this
constant (and/or the template name itself, which is also unverified) if they
differ.

## 9. Why the delivery record is simpler than `EmailDelivery`'s literal mirror

An early draft of `WhatsAppDelivery` mirrored `EmailDelivery` field-for-field
(`firstAttemptedAt`/`lastAttemptedAt`/`leaseAt`/`sentAt` alongside the brief's own
suggested `processingStartedAt`/`processedAt`), producing four redundant
near-duplicate timestamp columns. Simplified before this sprint's tests were
written: `processingStartedAt` does double duty as both the first-claim marker
AND the stale-lease timestamp (a `PROCESSING` row's lease age is
`now - processingStartedAt`, no separate `leaseAt` needed), and `processedAt` is
set only on terminal `SENT` (never on `FAILED` — a failed delivery was
"processed," in the sense of "attempted," but `processedAt`'s meaning here is
specifically "successfully completed," matching how the admin UI displays it).
"If the existing `EmailDelivery` state machine has a stronger established
convention, reuse the proven pattern rather than inventing an incompatible one" —
the STATES and transitions are identical to `EmailDelivery`; only the redundant
extra columns were dropped.

## 10. Future SMS/push extensibility

`NotificationChannel` already had room for `SMS`/`PUSH`/`WEBHOOK` as future enum
values before this sprint (the same reason it held only `IN_APP` alone through
Sprint 27, then gained `EMAIL` in Sprint 28, then `WHATSAPP` this sprint with zero
migration pain for existing rows each time). A future channel would follow the
exact `EmailDelivery`/`WhatsAppDelivery` template: its own `*Delivery` table with
the same `[organisationId, notificationId, channel]` uniqueness shape, its own
eligibility service reusing `NotificationPreference` (adding one more boolean
column, e.g. `smsEnabled`, following `emailEnabled`/`whatsappEnabled`'s own
precedent), its own provider port/adapter pair, and its own processor with its
own — possibly different — retry policy. None of
`WhatsAppEligibilityService`/`WhatsAppDeliveryCreationService`/
`WhatsAppDeliveryProcessorService`/`WhatsAppProvider` (or their Email
counterparts) would need to change to add it.
