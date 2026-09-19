# Sprint 28 Completion Report — Email Notification Delivery Foundation

## 1. Summary

Sprint 27/27.1 built a reliable, tenant-scoped in-app notification pipeline as a
pure downstream consumer of Sprint 26.1's durable `WorkflowEvent` log. Sprint 28
adds email as a SECOND downstream channel, consuming the already-created
`Notification` row itself — never `WorkflowEvent`, never `WorkflowInstanceService`,
both of which are byte-for-byte unchanged by this sprint. A provider-independent
adapter (a safe local provider for every automated test, and a real ZeptoMail SMTP
adapter behind the identical interface) was built and verified end-to-end against
the real database, including two real send attempts through ZeptoMail's actual
SMTP endpoint — the first correctly rejected and diagnosed as an unverified-
sender-domain issue, the second (using a sending domain already verified on the
account) accepted by the provider, confirming the diagnosis and the SMTP pathway
works correctly end-to-end. A genuine bug (a scan-ordering starvation issue) was
also found and fixed live during this sprint's own verification — not just
designed on paper.

## 2. Architecture

```text
Workflow transition
        ↓
WorkflowEvent                              (Sprint 26.1, unchanged)
        ↓
NotificationEventProcessorService → Notification   (Sprint 27, unchanged)
        ↓
EmailEligibilityService → EmailDeliveryCreationService → EmailDelivery  (NEW)
        ↓
EmailDeliveryProcessorService → EmailProvider → provider result        (NEW)
```

Full rationale in [docs/architecture/email-delivery.md](architecture/email-delivery.md).
Key points:

- **Workflow independence**: `WorkflowInstanceService`/`WorkflowInstanceRepository`
  have zero changes this sprint. Every Sprint 28 file reads `Notification`
  (and, transitively, `Organisation`/`User`) directly via Prisma or existing
  services — never Workflow's own service layer. Structurally verified: `notifications-independence.spec.ts` was extended to cover every new file, and continues to pass.
- **Tenant isolation**: every `EmailDelivery` query/mutation is scoped by
  `organisationId` from the caller's token, matching every other table in this
  codebase — live-verified (§13).
- **Existing authorization reused**: zero new authorization primitives. Two new
  permission-catalogue entries (`notification.email.view`/`.manage`), auto-granted
  to Administrator through the existing catalogue-seed loop — no manual seed code.
- **Database-backed idempotency**: `@@unique([organisationId, notificationId,
channel])` on `EmailDelivery`, the exact same idempotency shape `Notification`
  itself already uses — live-verified via direct SQL (`GROUP BY notificationId
HAVING COUNT(*) > 1` → zero rows, throughout).

## 3. Data Model

New enum `EmailDeliveryStatus` (`PENDING`/`PROCESSING`/`SENT`/`FAILED`). New
`NotificationChannel.EMAIL` value (added in its own preceding migration — Postgres
requires a new enum value committed before it can be referenced as a column
default in the same transaction). New `EmailDelivery` model — full field-by-field
rationale in notifications.md §15.1; summary:

- Recipient/sender snapshot: `recipientEmail`, `recipientDisplayName`,
  `fromEmail`, `fromName` — all frozen at creation, never re-read live on retry.
- `templateKey` (= `Notification.type`), `category` (denormalized), `subject`,
  `textBody`, `htmlBody`.
- Processing bookkeeping: `status`, `attempts`, `firstAttemptedAt`,
  `lastAttemptedAt`, `sentAt`, `nextRetryAt`, `leaseAt`.
- Provider bookkeeping: `providerName`, `providerMessageId`,
  `lastErrorCategory`, `lastError` (bounded 100/2000 chars, never a raw
  exception, never credentials).

`NotificationPreference` gained `emailEnabled Boolean @default(false)` (opposite
default of the existing `inAppEnabled Boolean @default(true)`) — same row, same
unique key, not a second table.

`Organisation.settings` (the existing Sprint 3.4 JSON bucket) gained an
`emailDelivery: { enabled, senderName, senderEmail }` sub-object — deliberately
NOT the pre-existing, dormant `preferences.emailNotifications` flag (verified by
inspection: that flag has zero backend enforcement anywhere in this codebase;
repurposing it risked silently changing behaviour for any organisation that had
already touched it).

**Migrations** (3, applied and verified via `prisma migrate status` — "Database
schema is up to date"):

1. `20260918060247_sprint28_notification_channel_email` — adds the `EMAIL` enum
   value alone (its own migration, per the Postgres transaction constraint above).
2. `20260918060248_sprint28_email_notification_delivery_foundation` — the
   `EmailDelivery` table, `EmailDeliveryStatus` enum, `NotificationPreference.
emailEnabled`.
3. `20260918063200_sprint28_email_delivery_sender_snapshot` — adds
   `fromEmail`/`fromName` (added after realizing the initial design left the
   organisation's configured sender identity unused by the actual send path —
   caught and fixed before any data existed in the table, safe to apply as a
   plain `NOT NULL` add).

## 4. Email Eligibility and Preferences

`EmailEligibilityService.evaluate(organisationId, notification)` — the single
place that decides "should this already-created notification also become an
email." Checks, in order: notification type in the 6-of-8 email-eligible set
(notifications.md §15.2) → organisation `emailDelivery.enabled` → per-category
`emailEnabled` preference → recipient user exists, `status === 'ACTIVE'`, has a
non-empty `email` → a resolvable sender (organisation override, else environment
`MAIL_FROM_EMAIL`/`MAIL_FROM_NAME`). All six live-verified, individually, via
dedicated eligibility unit tests AND live scenarios (§13).

`EmailDeliveryCreationService.createPendingDeliveries` scans notifications with
no `EmailDelivery` row yet, evaluates each, and idempotently creates rows for
eligible ones (`EmailDeliveryRepository.create` returns `null` on a P2002
conflict rather than throwing). Deliberately a SEPARATE service from
`EmailDeliveryProcessorService` (creation vs. sending) — the brief's own explicit
"keep responsibilities clearly separated" instruction.

## 5. Templates and Rendering

No separate per-category template catalogue — `EmailTemplateRenderer` reuses the
ALREADY-BUILT `Notification.title`/`body`/`actionUrl` (built once, by
`NotificationMessageBuilder`, Sprint 27) rather than re-deriving "what does this
event mean in words" a second time. Adds: HTML-escaping (`escapeHtml`, a 5-
character escape covering `& < > " '`) for the HTML variant only (the plain-text
variant embeds the same content verbatim, matching `Notification.body`'s own
documented "plain text only, safe to interpolate" contract), an absolute link
built from the new `WEB_PUBLIC_URL` config value, and a minimal branded HTML
wrapper. Tests cover: subject correctness, plain-text body content, HTML content,
escaping of a malicious `<script>` payload embedded in a user-authored reject/
return comment, the bare-URL fallback when `actionUrl` is absent, and escaping of
special characters in the organisation name.

## 6. Provider Adapter

`EmailProvider` port + `EMAIL_PROVIDER` DI token
(`apps/api/src/notifications/ports/email-provider.port.ts`) — mirrors the
established `FileStorage` port (Sprint 3.4) exactly. `email-provider.module.ts`
selects the concrete implementation once, at boot, via `EMAIL_PROVIDER_MODE`.

- **`LocalEmailProvider`** — default, in-memory, deterministic. Plus-addressing
  failure simulation (`+failretryable@`/`+failterminal@`) needs zero extra
  configuration surface or test-only injected hooks.
- **`SmtpEmailProvider`** — real `nodemailer` SMTP, ZeptoMail-compatible (nothing
  ZeptoMail-proprietary is used — `ZEPTOMAIL_API_KEY` is deliberately unread,
  reserved for a possible future REST API adapter). Maps SMTP/`nodemailer` errors
  to `RETRYABLE_FAILURE`/`TERMINAL_FAILURE` (full mapping table in email-
  delivery.md §4). Throws `SmtpConfigurationError` at CONSTRUCTION time (app boot)
  if `EMAIL_PROVIDER_MODE=smtp` and any required field is missing — never a
  silent fallback to the local provider while claiming success.

## 7. Processing Reliability

Own constants file (`email-delivery-processing.constants.ts`), deliberately
separate from the in-app processor's — `MAX_EMAIL_ATTEMPTS = 3`, backoff
`[0, 2min, 10min]` (longer than the in-app processor's `[0, 1min, 5min]`, since
SMTP transient failures typically need more time to clear), `EMAIL_PROCESSING_
LEASE_MS = 10 minutes` (longer than the in-app processor's 5, since a real SMTP
round-trip is slower). Claiming via the same per-row conditional `updateMany`
idiom every other processor in this codebase already uses — no new lock
primitive, no Redis. All live-verified — see §13.

**Ambiguous provider outcomes** (the brief's own explicit concern): the provider
call happens outside any database transaction. A crash between provider
acceptance and the `markSent` write committing would leave the row `PROCESSING`
with a lease; the next sweep's stale-lease reclaim would send it again. This is
honest at-least-once delivery, documented, not claimed as exactly-once —
`EmailDelivery.id` is passed to every provider call as a correlation id
specifically so a duplicate could be spotted after the fact in the provider's own
log, even though neither adapter implemented this sprint gives real provider-side
idempotency.

## 8. Delivery Creation and Dispatch

Creation timing: on-demand, triggered by the SAME `POST /notifications/process-
events` endpoint the in-app pipeline already uses (no queue/cron infrastructure
exists anywhere in this codebase — matching Sprint 27/27.1's own established,
documented choice) — in-app processing runs first, then email creation, then email
sending, all in one request/response cycle, so every one of the 5 existing
frontend call sites gets prompt email delivery with zero frontend changes. A
SEPARATE `POST /notifications/process-email` endpoint also exists for a
targeted "just check email" trigger (used by the new admin page's own "Check for
new" button).

**A real bug found and fixed live this sprint**: `findPendingForEmailEvaluation`
initially scanned oldest-first, matching every other sweep in this domain. Since
an ineligible notification never gets an `EmailDelivery` row, it stays in the
"pending evaluation" set forever and is re-scanned every sweep — with oldest-first
ordering, a backlog of old ineligible notifications permanently occupied the
entire scan window, silently starving genuinely eligible NEW notifications from
ever being reached. Reproduced live (a freshly submitted, fully-eligible
notification was never emailed behind ~50 old ineligible ones from earlier
testing), root-caused, fixed (newest-first ordering), and re-verified live —
full account in notifications.md §15.6.

## 9. Operational Administration

`GET /notifications/admin/email-deliveries` (paginated, filterable by status),
`GET /notifications/admin/email-deliveries/:id`, `POST /notifications/admin/
email-deliveries/:id/retry` — gated by two new permissions
(`notification.email.view`/`.manage`), a DIFFERENT trust level from the existing
`notification.processing.*` permissions (Sprint 27.1) since this surface exposes
actual recipient email addresses. Both auto-granted to Administrator through the
existing catalogue-seed loop — zero manual seed code, catalogue count 134 → 136.

## 10. API and UI

**New/changed API routes** (all on the existing `NotificationsController`, no
new controller):

```text
PATCH  /notifications/preferences/:category   (extended: now accepts inAppEnabled and/or emailEnabled)
POST   /notifications/process-email
GET    /notifications/admin/email-deliveries
GET    /notifications/admin/email-deliveries/:id
POST   /notifications/admin/email-deliveries/:id/retry
```

**Changed**: `POST /notifications/process-events` now also chains the email
pipeline afterward (in-app result unaffected either way — an email-pipeline
error is caught and never masks the in-app result already computed).

**Organisation config**: `GET/PATCH /settings/workspace` extended with an
`emailDelivery` field — reuses the existing route and `identity.organisation.
manage` permission, no new endpoint.

**Frontend**:

- `/notifications/preferences` — extended with separate In-app/Email checkbox
  columns per category (clearly distinct, never merged).
- `/notifications/admin/email` (new) — the Admin: Email Deliveries page, mirroring
  the existing Admin: Processing page's shape (status filters, retry action, "Check
  for new").
- `notification-tabs.tsx` — extended with the new tab; fixed a latent
  active-tab-highlighting bug the new sibling tab would have exposed
  (`/notifications/admin` vs. `/notifications/admin/email` — an `exactOnly` flag
  per tab now prevents a parent tab from being highlighted alongside a more
  specific sibling).
- Organisation Settings → Preferences tab — new "Transactional Email" card
  (enable toggle, sender name/email fields, save action).

Verified at desktop width and 375px mobile width (§13).

## 11. Authorization and Tenant Isolation

Self-scoped preference routes: `JwtAuthGuard` alone (matching `AccountController`'s
precedent — no meaningful permission exists for "read/write your own
preferences" beyond "is an authenticated active user"). Admin email-delivery
routes: `PermissionsGuard` + the two new permissions. Live-verified: non-admin
403 on both list and retry; rival-tenant admin sees `total: 0` and a direct
request for a real cross-tenant delivery ID returns `404` (no existence leak);
cross-user notification mutation (Grace attempting to mark Ibrahim's own
notification read) returns `404`.

## 12. Tests

- **194 suites / 1675 tests overall, all passing** (up from 188/1629 at the start
  of this sprint).
- **Notifications domain: 13 suites / 116 tests** (up from 7/66) — 6 new suites,
  50 new tests, covering: `LocalEmailProvider` (accept/retryable/terminal
  classification, message recording), `SmtpEmailProvider` (config validation,
  error mapping for auth/connection/4xx/5xx/unknown failures, no-secrets-in-
  errors), `EmailTemplateRenderer` (subject/text/HTML/escaping/fallback-URL),
  `EmailEligibilityService` (all 9 branches: type-excluded, org-disabled,
  preference-disabled, suspended, missing-email, user-not-found, sender-
  resolution-precedence, no-sender-configured, org-not-found),
  `EmailDeliveryCreationService` (eligible creates a row, ineligible skips
  rendering entirely, duplicate-create no-ops, independent per-notification
  processing), `EmailDeliveryProcessorService` (send/retryable/terminal/max-
  attempts/multi-delivery-batch/zero-claimed/manual-retry/not-found).
- Two pre-existing tests updated for the (backward-compatible) shape changes:
  `NotificationPreferenceService`'s patch-object `update()` signature, and
  `organisation.service.spec.ts`'s settings-merge assertion (now also expects
  the new `emailDelivery` default).
- Typecheck: clean (`tsc --noEmit`, both apps).
- Lint: 27 pre-existing warnings (API), 0 new; web clean.
- Build: both apps build successfully.

## 13. Live Verification

Performed against the real local PostgreSQL database and real authenticated
tokens (Boby Bites tenant). Full scenario-by-scenario account in
notifications.md §19; summary of what was actually run, not just designed:

1. Enabled org transactional email + a user's per-category email preference —
   confirmed both persisted correctly.
2. Real PO submission end-to-end → one `EmailDelivery` row created and `SENT`
   via the local provider, correct recipient/subject/body/providerMessageId.
3. Replayed processing repeatedly → zero duplicates (API + direct SQL check).
4. 5 concurrent `process-events` requests → exactly one claim succeeded, zero
   duplicates.
5. Simulated retryable failure → correct backoff scheduling, verified across
   two real retry cycles.
6. Forced the 3rd attempt → terminal `FAILED` at exactly `MAX_EMAIL_ATTEMPTS`.
7. Manual retry (combined with a reverted recipient email) → attempts preserved,
   NOT reset; retry still targeted the OLD snapshotted address (proving
   recipient-snapshot immutability); correctly went straight back to terminal
   `FAILED`.
8. Simulated terminal failure → `FAILED` on attempt 1, no wasted retries.
9. Manufactured stale `PROCESSING` lease → reclaimed by the next ordinary sweep.
10. Deactivated then reactivated a user → zero deliveries while inactive, no
    unexpected retroactive duplicate on reactivation.
11. Cross-tenant admin isolation → `total: 0`, `404` on direct ID access.
12. Non-admin/cross-user authorization → `403`/`404` as appropriate.
13. Confirmed the underlying `WorkflowInstance` and `Notification` rows were
    completely unaffected by every email failure/success above.
14. **Found and fixed live**: the scan-ordering starvation bug (§8).
15. Frontend: preferences page, Admin: Email Deliveries page, organisation
    settings sender-config card — all verified at desktop and 375px.
16. Seed re-run twice after all schema changes — idempotent, zero errors.
17. **Real ZeptoMail SMTP** — see §13.1.

### 13.1 Real SMTP verification (distinct from the local-provider tests above)

Performed twice. Constant across both: provider mode `smtp` (temporarily;
reverted to `local` after each — see §16); SMTP configuration detected — host,
port, secure mode (`false`), username, password, mail-from name, mail-from
email all present, no value ever printed (confirmed indirectly via successful
`SmtpEmailProvider` construction, which throws at boot if any required field
is missing); test tenant Boby Bites; category `WORKFLOW_APPROVAL_REQUIRED` via
a real Purchase Order submission through the actual pipeline (no bypass
endpoint exists); test recipient `ajayijohnson68@gmail.com`, set via a direct,
one-off database update to an existing seeded user's `email` column for the
test's duration only (this codebase has no application-level path to change a
user's own email at all — deliberately immutable everywhere in Identity — so
this was a controlled, reverted test fixture, never reachable through any real
user action); no secret value printed, logged, or returned at any point.

**Attempt 1** — environment default `MAIL_FROM_EMAIL=no-reply@zentuva.com`:

- Delivery record id: `cmu70c09z000nt1iask0s7jdh`.
- Provider result: REJECTED — SMTP response code `553` during `DATA`, AFTER
  successful connection and `AUTH LOGIN` (ruling out a credentials problem).
  Correctly classified `TERMINAL_FAILURE`.
- Final status: `FAILED` (confirmed across the original send and one manual
  retry, identical rejection both times).
- Diagnosis: a `553` at `DATA` after successful auth is most consistent with
  the sending domain not being verified/authorized on this ZeptoMail account —
  an account-configuration matter, not a codebase defect.

**Attempt 2** — at the user's explicit direction, switched `MAIL_FROM_EMAIL` to
`no-reply@mindcraftlearn.online` (`MAIL_FROM_NAME=Mindcraft Learn`), the
already-verified sending domain of the real, currently-active production
project this ZeptoMail account belongs to:

- Delivery record id: `cmu73txmy000nvttl92v3lj66`.
- Provider result: **ACCEPTED** —
  `providerMessageId: <ab0c37c7-bf67-da95-5ebb-026b5d823e76@mindcraftlearn.online>`.
- Final status: `SENT` at `2026-09-18T15:19:47.178Z`.
- Confirms attempt 1's diagnosis: transport, credentials, and this codebase's
  SMTP integration were correct throughout — only the specific sending domain
  was unverified in attempt 1.

**Inbox receipt**: not independently confirmed either way (this session has no
access to the recipient's Gmail inbox) — attempt 2's result is reported
exactly as "provider accepted, inbox receipt not independently confirmed,"
never as confirmed delivery.

**Secrets exposure**: none, at any point across either attempt.

**Required honest disclosure, verbatim per the brief's format**: _Real email
accepted by SMTP provider (ZeptoMail), but inbox receipt not independently
confirmed._ The first attempt's failure was itself a real, correctly-classified,
safely-reported result — its diagnosis was confirmed correct by the successful
second attempt, not discarded or hidden.

## 14. Documentation

- [`docs/domains/notifications.md`](domains/notifications.md) — extended with
  §15 (Email Delivery), §16 (Processing Reliability), §17 (Provider
  Abstraction), §18 (Configuration Reference), §19 (Live Verification, including
  the full real-SMTP disclosure), plus updates to the intro and Known
  Limitations section.
- [`docs/architecture/email-delivery.md`](architecture/email-delivery.md) — new
  architecture decision record.
- `docs/sprint-28-completion-report.md` — this document.
- `README.md`, `docs/roadmap.md`, `docs/backlog.md`, `docs/changelog.md` — all
  updated with Sprint 28 summaries.
- `docs/domains/README.md` — Notifications row extended; stale permission-
  catalogue count (132, never updated since Sprint 26) corrected to 136 with
  the full per-sprint breakdown.
- `apps/api/.env.example` — new email-delivery variables documented (placeholder/
  commented values only, never the real credentials).

## 15. Deferred Scope

Explicitly, deliberately not built this sprint (matching the brief's own "no
marketing platform" and "SMS/push not this sprint" instructions):

- Email campaigns, mailing lists, bulk sends, subscriber segmentation, open/
  click tracking, an HTML drag-and-drop editor, marketing automation.
- SMS and push delivery channels (the `NotificationChannel` enum has room; no
  further channel is implemented).
- A dedicated test-send endpoint (the brief allowed but did not require one;
  the real pipeline itself was used for live verification instead, per the
  brief's own stated preference).
- A background worker/queue for email processing — on-demand triggering only,
  matching Sprint 27/27.1's own established, documented choice.
- Delivery-status webhooks (bounce/complaint/open tracking) — `SENT` means
  "accepted by the provider," never "confirmed delivered," by design (email-
  delivery.md §3).
- A ZeptoMail REST API adapter — `ZEPTOMAIL_API_KEY` is reserved for this,
  unread by the SMTP adapter shipped this sprint.
- Per-user email preference categories finer than the existing 2 (unchanged
  from Sprint 27.1).
- Tenant-level SMTP credential storage — sender identity (name/email) is
  tenant-configurable; the actual SMTP transport credentials remain
  environment-only, as the brief explicitly required ("do not create an
  insecure tenant-level credential model").

## 16. Known Limitations

- **Scan-window scale ceiling**: `findPendingForEmailEvaluation` is still bounded
  by `limit` (default 50) even after the newest-first fix (§8) — an
  organisation generating more than 50 new notifications between sweeps could,
  in principle, still leave some unevaluated until the next sweep catches up.
  Acceptable at this sprint's target scale; the newest-first fix specifically
  ensures this never turns into permanent starvation.
- **At-least-once, not exactly-once delivery** — a narrow crash window between
  provider acceptance and the `SENT` write committing could cause a duplicate
  real-world send on the next stale-lease reclaim. Documented, not solved (no
  provider-side idempotency key support in either adapter this sprint).
- **Resolved during this sprint**: the initial `553` SMTP rejection (attempt 1,
  §13.1) was an account/sender-verification issue external to this codebase,
  not a defect — confirmed by a successful second attempt once a sending
  domain already verified on the ZeptoMail account was used. No longer an
  open limitation.
- **No delivery-status webhooks** — `SENT` never becomes `DELIVERED`/`BOUNCED`
  even if the provider account has that capability; would require a new
  inbound webhook endpoint, explicitly out of scope this sprint.

## 17. Git Status

- **No commit made.**
- **No push made.**
- Current branch: `main`.
- Working tree: modified/untracked files exist as listed above (23 modified,
  17 added — see the file list gathered via `git status --short` during this
  report's preparation); nothing staged, nothing committed, matching the
  brief's explicit "do not commit or push anything" instruction throughout.
