# Email Delivery Architecture

Sprint 28 — Email Notification Delivery Foundation. A focused architecture decision
record for how email fits into the existing Notifications/Workflow boundary
(see [docs/architecture/notification-activity-boundaries.md](notification-activity-boundaries.md)
for the Sprint 27.1 record this one extends) — why the pipeline is shaped the way it
is, and what it deliberately does not promise.

## 1. Notification intent versus delivery attempt

Two different questions, two different tables, never conflated:

- **`Notification`** (Sprint 27) answers "does this user have something to act on or
  be aware of, in-app." It is the intent — created once, read/unread, never deleted.
- **`EmailDelivery`** (Sprint 28) answers "did/will Zentuva also email this person
  about it, and what happened when it tried." It is one delivery ATTEMPT (or a
  retried sequence of attempts against the same logical send) for one existing
  `Notification`. It is never itself the notification — a suppressed or failed email
  never means the underlying `Notification` didn't happen; the in-app row is always
  the source of record for "was this person told."

This mirrors the exact relationship `Notification` itself has with `WorkflowEvent`
(the notification-activity-boundaries.md decision) one level further downstream:

```text
WorkflowEvent  (did the thing happen — Workflow's own record)
      │
Notification   (does this ONE user need to know, in-app — Sprint 27)
      │
EmailDelivery  (did we ALSO try to email them about it — Sprint 28)
```

Nothing in this chain re-decides what an earlier link already decided.
`EmailDeliveryCreationService` never re-evaluates whether the underlying workflow
event was legitimate; it only asks "is this already-created `Notification` eligible
for email."

## 2. Why email is a pure downstream consumer, never inline

`WorkflowInstanceService` (Sprint 26/26.1) is untouched by this sprint — not one
line changed. The dependency chain is strictly one-directional:

```text
Workflow transition
        ↓
WorkflowEvent (durable, transactional)
        ↓
NotificationEventProcessorService → Notification (Sprint 27, unchanged)
        ↓
EmailEligibilityService → EmailDeliveryCreationService → EmailDelivery (Sprint 28)
        ↓
EmailDeliveryProcessorService → EmailProvider → provider result
```

`EmailDeliveryCreationService`/`EmailDeliveryProcessorService` read the
`Notification` table directly via Prisma — never `NotificationEventProcessorService`,
never `WorkflowInstanceService`/`WorkflowInstanceRepository`. Verified structurally
by `notifications-independence.spec.ts`'s extended guards (Sprint 27's own
convention, now covering every Sprint 28 file too).

**Why this matters in practice**: an SMTP round-trip can take seconds, can hang, can
fail in ways a database transaction cannot meaningfully wrap. If email creation or
sending were embedded inside the workflow transition's own transaction (or even
inside `NotificationEventProcessorService`'s), a slow or failing mail server would
directly threaten the availability of the actual business operation (approving a
Purchase Order) it has nothing to do with. Keeping email strictly downstream and
its own separately-triggered pipeline means a provider outage degrades email only —
Workflow and in-app notifications are provably unaffected (live-verified,
notifications.md §19 item 13: a real SMTP rejection during this sprint's live test
left the underlying `WorkflowInstance` and `Notification` rows completely
untouched).

## 3. Delivery state machine — why `SENT`, not `DELIVERED`

```text
PENDING → PROCESSING (claimed) → SENT      (terminal, success)
                                → FAILED    (terminal, attempts exhausted or
                                              provider said "don't retry")
        ← PENDING                          (retryable failure, attempts remain,
                                              nextRetryAt scheduled)
```

`SENT` means **the provider accepted the message for relay** — a successful SMTP
`DATA` phase completion, nothing more. It is deliberately NOT named `DELIVERED`:
neither `LocalEmailProvider` (in-memory, no real transport) nor `SmtpEmailProvider`
(a standard SMTP client, no delivery-status-notification/webhook integration) can
prove a message actually reached an inbox, survived spam filtering, or was read.
Claiming `DELIVERED` would be a promise this codebase cannot back up. A future
provider with real delivery webhooks (bounce/complaint/open events) would need an
explicit, additional status — not a redefinition of `SENT`.

## 4. Failure model — retryable vs. terminal

`EmailProvider.send()` returns one of three outcomes, decided entirely by the
provider adapter (`LocalEmailProvider`/`SmtpEmailProvider`), never guessed by the
processor:

- **`ACCEPTED`** → `SENT`.
- **`RETRYABLE_FAILURE`** → back to `PENDING` with `nextRetryAt` scheduled via
  backoff (`[0, 2min, 10min]`), UNLESS attempts are exhausted (`MAX_EMAIL_ATTEMPTS
= 3`), in which case it becomes terminal `FAILED` anyway — a retryable outcome
  does not mean infinite retries.
- **`TERMINAL_FAILURE`** → `FAILED` immediately, regardless of attempt count (an
  auth failure or a `5xx` SMTP rejection will not resolve itself by trying again
  sooner).

`SmtpEmailProvider`'s classifier (`mapError`): authentication failures and `5xx`
SMTP response codes are terminal; connection-level failures and `4xx` response
codes are retryable; anything unrecognized defaults to retryable (safer to retry an
unknown failure mode up to the attempt limit than to give up on the first attempt).

## 5. At-least-once delivery — an honest limitation, not exactly-once

The provider call happens OUTSIDE any database transaction — an SMTP round-trip
cannot meaningfully participate in a Postgres transaction. This creates a real,
narrow window: if the provider accepts a message and this process crashes before
the `markSent` write commits, the row stays `PROCESSING` with a lease; the next
sweep's stale-lease recovery reclaims it and sends it AGAIN.

This codebase does not claim exactly-once delivery, and does not pretend otherwise.
Mitigations that exist:

- `EmailDelivery.id` is passed to every provider call as `correlationId`
  (`X-Zentuva-Correlation-Id` header on the real SMTP adapter) specifically so a
  human reconciling the provider's own send log against this table CAN spot a
  duplicate after the fact.
- `providerMessageId` is recorded whenever the provider returns one.
- Neither adapter implemented this sprint gives this codebase real provider-side
  idempotency (ZeptoMail's SMTP endpoint, used here, does not offer a
  client-supplied idempotency key the way some REST email APIs do — a future
  ZeptoMail REST API adapter, if built, is the natural place to add that).

At-least-once, with the duplicate risk documented and bounded to a narrow crash
window, is the acceptable trade-off for this foundation — matching the brief's own
explicit allowance ("at-least-once delivery with duplicate-risk documentation is
acceptable").

## 6. Provider-independent adapter

`EmailProvider` (interface) + `EMAIL_PROVIDER` (DI token) —
`apps/api/src/notifications/ports/email-provider.port.ts` — mirrors the
`FileStorage` port established in Sprint 3.4 exactly. `EmailDeliveryProcessorService`
depends only on the interface; `email-provider.module.ts`'s factory decides which
concrete class to construct, once, at boot, from `EMAIL_PROVIDER_MODE`. Nothing
about the processor, the eligibility service, the creation service, or the
templates changes if a third provider (e.g. a different SMTP relay, or a REST-API-
based one) is added later — only a new class implementing `EmailProvider` and one
line in the factory.

## 7. Why transactional only — no marketing platform

This sprint deliberately implements nothing that would make Zentuva a marketing
email tool: no campaigns, no mailing lists, no bulk sends, no subscriber
segmentation, no open/click tracking, no HTML drag-and-drop editor. Every email
this pipeline can ever send traces back to exactly one `Notification`, which traces
back to exactly one `WorkflowEvent` — there is no code path that creates an
`EmailDelivery` without a real, already-authorized underlying event. The "one
email always corresponds to one real thing that happened" invariant is what keeps
this a transactional notification channel, not a general-purpose send capability.

## 8. Future SMS/push extensibility

`NotificationChannel` already has room for `SMS`/`PUSH`/`WEBHOOK` as future enum
values (the same reason it held only `IN_APP` alone through Sprint 27, then gained
`EMAIL` this sprint with zero migration pain for existing rows). A future channel
would follow the exact `EmailDelivery` template: its own `*Delivery` table with the
same `[organisationId, notificationId, channel]` uniqueness shape, its own
eligibility service reusing `NotificationPreference` (adding one more boolean
column, e.g. `smsEnabled`, following `emailEnabled`'s own precedent), its own
provider port/adapter pair, and its own processor with its own — possibly
different — retry policy. None of `EmailEligibilityService`/
`EmailDeliveryCreationService`/`EmailDeliveryProcessorService`/`EmailProvider`
would need to change to add it.
