# Sprint 29 Completion Report — WhatsApp Notification Delivery Foundation

## 1. Summary

Sprint 28 added email as a second, genuinely downstream notification delivery
channel. Sprint 29 adds WhatsApp as a THIRD — deliberately built as a
structural SIBLING of `EmailDelivery`, not a chain on top of it: both read the
same already-created `Notification` row (Sprint 27) independently, neither
imports the other, and neither imports `WorkflowEvent`/`WorkflowInstanceService`
directly, both of which remain byte-for-byte unchanged by this sprint. A
provider-independent adapter (a safe local provider for every automated test,
and a real WhatsApp Business Platform Meta Cloud API adapter behind the
identical interface, built on Node's built-in `fetch` with zero new
dependency) was built and verified end-to-end against the real database,
including firing six concurrent requests at one freshly-submitted notification
and confirming exactly one delivery was created despite the race. No real
WhatsApp Business Platform credentials were available in this environment, so
the real-provider send itself is honestly reported as not attempted, never
simulated or fabricated.

## 2. Architecture

```text
Workflow transition
        ↓
WorkflowEvent                              (Sprint 26.1, unchanged)
        ↓
NotificationEventProcessorService → Notification   (Sprint 27, unchanged)
        ↓
        ├── EmailEligibilityService → EmailDeliveryCreationService → EmailDelivery       (Sprint 28, unchanged)
        │       ↓
        │   EmailDeliveryProcessorService → EmailProvider → provider result
        │
        └── WhatsAppEligibilityService → WhatsAppDeliveryCreationService → WhatsAppDelivery  (NEW)
                ↓
            WhatsAppDeliveryProcessorService → WhatsAppProvider → provider result
```

Full rationale in
[docs/architecture/whatsapp-delivery.md](architecture/whatsapp-delivery.md).
Key points:

- **Workflow independence**: `WorkflowInstanceService`/`WorkflowInstanceRepository`/
  `WorkflowDefinitionRepository` have zero changes this sprint. Every Sprint 29
  file reads `Notification` (and, transitively, `Organisation`/`User`) directly
  via Prisma or existing services — never Workflow's own service layer, never
  `EmailDelivery`'s own internals. Structurally verified:
  `notifications-independence.spec.ts` was extended to cover every new file,
  including an assertion that `NotificationsModule`'s own `imports` array is an
  exact, closed set (now including `WhatsAppProviderModule`).
- **Tenant isolation**: every `WhatsAppDelivery` query/mutation is scoped by
  `organisationId` from the caller's token, matching every other table in this
  codebase — live-verified (§13).
- **Existing authorization reused**: zero new authorization primitives. Two new
  permission-catalogue entries (`notification.whatsapp.view`/`.manage`),
  auto-granted to Administrator through the existing catalogue-seed loop — no
  manual seed code, catalogue count 136 → 138.
- **Database-backed idempotency**: `@@unique([organisationId, notificationId,
channel])` on `WhatsAppDelivery`, the exact same idempotency shape
  `Notification`/`EmailDelivery` already use — live-verified via 6 concurrent
  requests racing on the same notification, exactly one delivery created.

## 3. Data Model

New enum `WhatsAppDeliveryStatus` (`PENDING`/`PROCESSING`/`SENT`/`FAILED`). New
`NotificationChannel.WHATSAPP` value (added in its own preceding migration,
same Postgres enum-value-commit constraint encountered in Sprint 28). New
`WhatsAppDelivery` model — full field-by-field rationale in notifications.md
§20.1; summary:

- Recipient snapshot: `recipientPhoneSnapshot` (post-normalization E.164),
  `recipientDisplayNameSnapshot` — frozen at creation, never re-read live on
  retry.
- `templateName`, `templateLanguage`, `templateParameterSnapshot` (Json) — the
  resolved, pre-approved template and its exact rendered parameters.
- `category` (denormalized for admin filtering).
- Processing bookkeeping: `status`, `attempts`, `processingStartedAt`
  (doubles as first-claim marker AND stale-lease timestamp), `processedAt`
  (terminal `SENT` only), `nextRetryAt`.
- Provider bookkeeping: `providerName`, `providerMessageId`, `lastErrorCode`,
  `lastErrorMessage` (bounded, never a raw provider response body, never an
  access token).

**A deliberate simplification versus a literal `EmailDelivery` mirror**: an
early draft included `firstAttemptedAt`/`lastAttemptedAt`/`leaseAt`/`sentAt`
alongside the brief's own suggested `processingStartedAt`/`processedAt`,
producing four redundant near-duplicate timestamp columns. Self-corrected
before any data existed in the table — full rationale in whatsapp-delivery.md
§9.

`NotificationPreference` gained `whatsappEnabled Boolean @default(false)`
(same default as `emailEnabled`, opposite of `inAppEnabled`'s default `true`)
— same row, same unique key, not a third table.

`Organisation.settings` gained a `whatsapp: { enabled }` sub-object —
deliberately SMALLER than `emailDelivery`'s (name/senderEmail) shape, since
there is no tenant-configurable "from" concept for WhatsApp; the Business
phone number is environment/platform configuration only, never exposed in the
Zentuva UI.

**Migrations** (3, applied and verified via `prisma migrate status` —
"Database schema is up to date!"):

1. `20260919221404_sprint29_notification_channel_whatsapp_enum` — adds the
   `WHATSAPP` enum value alone (its own migration, per the Postgres
   transaction constraint).
2. `20260919221405_sprint29_notification_channel_whatsapp` — the
   `WhatsAppDelivery` table, `WhatsAppDeliveryStatus` enum,
   `NotificationPreference.whatsappEnabled`.
3. `20260919223324_sprint29_whatsapp_delivery_field_simplification` — drops
   the three redundant timestamp columns from the initial draft (safe; the
   table was still empty at that point).

## 4. WhatsApp Eligibility and Preferences

`WhatsAppEligibilityService.evaluate(organisationId, notification)` — the
single place that decides "should this already-created notification also
become a WhatsApp message." Checks, in order (brief's own 7-step order; "a
duplicate delivery does not already exist" is the 8th check, enforced by
`WhatsAppDeliveryCreationService`'s DB-constraint-backed `create()`, not
here — same division of responsibility as email): recipient user exists →
`status === 'ACTIVE'` → organisation exists → phone number normalizes
successfully → per-category `whatsappEnabled` preference → a supported
template resolves for this notification type → organisation
`whatsapp.enabled`. All live-verified individually, via dedicated eligibility
unit tests AND live scenarios (§13).

`WhatsAppDeliveryCreationService.createPendingDeliveries` scans notifications
with no `WhatsAppDelivery` row yet, newest-first (applying Sprint 28's own
scan-ordering lesson proactively from the start, never reproducing that
starvation bug), evaluates each, and idempotently creates rows for eligible
ones (`WhatsAppDeliveryRepository.create` returns `null` on a P2002 conflict
rather than throwing).

## 5. Phone Number Normalization

`phone-number-normalizer.ts` — the ONE place `User.phoneNumber` (a free-form
optional string, unchanged since Sprint 3.3) becomes an E.164 representation.
Nigeria-specific local-format rule (`08012345678` → `+2348012345678`,
`2348012345678` → `+2348012345678`), already-international numbers
(`+`-prefixed) accepted regardless of organisation country, and a hard refusal
to guess for any other country's local format — "fail safely rather than
send to an ambiguous number." 11 unit tests covering every branch, plus
live-verified twice against the real pipeline (§13, correctly normalizing
`08012345678`/`08023456789` for two different test users).

## 6. Template Model

`whatsapp-template.ts`'s `resolveWhatsAppTemplate` — the ONE place a
`NotificationType` resolves to a template name; no caller may pass one in
directly. Deliberately narrow: only `WORKFLOW_APPROVAL_REQUIRED` has a
template (`zentuva_approval_required`, configurable name/language), matching
the brief's explicit "start with `APPROVAL_REQUIRED` only" scope limit.
`templateParameterSnapshot` is a named, human-readable JSON record
(`recipientName`, `documentType`, `documentNumber`, `approvalUrl`) —
deliberately omits a monetary "amount" parameter (no existing field carries
one; adding it would require a new cross-domain Procurement read, out of
scope). A separate `APPROVAL_TEMPLATE_PARAMETER_ORDER` constant maps this
named record into Meta's positional `{{1}}`–`{{4}}` placeholders — explicitly
documented as an UNVERIFIED assumption, since no real WhatsApp Business
account with an approved template was available this sprint to confirm
against (whatsapp-delivery.md §8).

## 7. Provider Adapter

`WhatsAppProvider` port + `WHATSAPP_PROVIDER` DI token
(`apps/api/src/notifications/ports/whatsapp-provider.port.ts`) — mirrors the
established `FileStorage`/`EmailProvider` port pattern exactly.
`whatsapp-provider.module.ts` selects the concrete implementation once, at
boot, via `WHATSAPP_PROVIDER_MODE`.

- **`LocalWhatsAppProvider`** — default, in-memory, deterministic. Failure
  simulation via two reserved test PHONE NUMBERS (`+10000000001` →
  retryable, `+10000000002` → terminal), since phone numbers have no
  plus-addressing equivalent — needs zero extra configuration surface.
- **`MetaWhatsAppProvider`** — real WhatsApp Business Platform (Meta Cloud
  API) integration via `POST /{phone_number_id}/messages`, built on Node's
  built-in `fetch`, no new HTTP-client dependency, no Meta SDK. Maps Meta
  Graph API error codes to `RETRYABLE_FAILURE`/`TERMINAL_FAILURE` (full
  mapping table in whatsapp-delivery.md §4). Throws
  `WhatsAppConfigurationError` at CONSTRUCTION time (app boot) if
  `WHATSAPP_PROVIDER_MODE=meta` and any required field is missing — never a
  silent fallback to the local provider while claiming success. Never logs
  the access token; never logs a full recipient phone number (redacted to
  country-code + last 2 digits in every log line).

## 8. Processing Reliability

Own constants file (`whatsapp-delivery-processing.constants.ts`), deliberately
separate from both the in-app and the email processors — `MAX_WHATSAPP_ATTEMPTS
= 3`, backoff `[0, 2min, 10min]`, `WHATSAPP_PROCESSING_LEASE_MS = 10 minutes`
(borrows email's numbers as a reasonable starting point, in its own
independently-configurable file). Claiming via the same per-row conditional
`updateMany` idiom every other processor in this codebase already uses — no
new lock primitive, no Redis, no queue. All live-verified — see §13.

**Ambiguous provider outcomes**: the provider call happens outside any
database transaction. A crash between provider acceptance and the `markSent`
write committing would leave the row `PROCESSING` with a lease; the next
sweep's stale-lease reclaim would send it again. Honest at-least-once
delivery, documented, never claimed as exactly-once —
`WhatsAppDelivery.id` is passed to every provider call as a correlation id
specifically so a duplicate could be spotted after the fact.

## 9. Delivery Creation and Dispatch

Creation timing: on-demand, triggered by the SAME `POST /notifications/process-
events` endpoint the in-app and email pipelines already use (no queue/cron
infrastructure exists anywhere in this codebase) — in-app processing runs
first, then email (own try/catch), then WhatsApp (own try/catch), all in one
request/response cycle, so every existing frontend call site gets prompt
WhatsApp delivery with zero frontend changes to those call sites. A SEPARATE
`POST /notifications/process-whatsapp` endpoint also exists for a targeted
"just check WhatsApp" trigger (used by the new admin page's own "Check for
new" button) — independent try/catch means a WhatsApp-pipeline exception can
never mask or interrupt the in-app or email results already computed in the
same request.

## 10. Operational Administration

`GET /notifications/admin/whatsapp-deliveries` (paginated, filterable by
status), `POST /notifications/admin/whatsapp-deliveries/:id/retry` — gated by
two new permissions (`notification.whatsapp.view`/`.manage`), the same trust
level as the existing `notification.email.*` permissions since this surface
also exposes actual recipient phone numbers. Both auto-granted to
Administrator through the existing catalogue-seed loop — zero manual seed
code, catalogue count 136 → 138.

## 11. API and UI

**New/changed API routes** (all on the existing `NotificationsController`, no
new controller):

```text
PATCH  /notifications/preferences/:category   (extended: now also accepts whatsappEnabled)
POST   /notifications/process-whatsapp
GET    /notifications/admin/whatsapp-deliveries
POST   /notifications/admin/whatsapp-deliveries/:id/retry
```

**Changed**: `POST /notifications/process-events` now also chains the
WhatsApp pipeline afterward, independently of the email chain (an
email-pipeline error and a WhatsApp-pipeline error are each caught separately
and never mask each other or the in-app result).

**Organisation config**: `GET/PATCH /settings/workspace` extended with a
`whatsapp` field — reuses the existing route and `identity.organisation.
manage` permission, no new endpoint.

**Frontend**:

- `/notifications/preferences` — extended with a third WhatsApp checkbox
  column alongside the existing In-app/Email columns per category.
- `/notifications/admin/whatsapp` (new) — the Admin: WhatsApp Deliveries page,
  mirroring the existing Admin: Email Deliveries page's shape (status
  filters, retry action, "Check for new"; full, unredacted recipient phone
  number shown — the legitimate operational-visibility purpose this page
  exists for, distinct from the log-redaction rule in §7).
- `notification-tabs.tsx` — extended with the new tab.
- Organisation Settings → Preferences tab — new "WhatsApp" card (enable
  toggle only, no sender-identity fields, since `whatsapp.enabled` is the
  entire organisation-level config shape).

Verified at desktop width and 375px mobile width (§13).

## 12. Authorization and Tenant Isolation

Self-scoped preference routes: `JwtAuthGuard` alone, same as every other
preference/profile route. Admin WhatsApp-delivery routes: `PermissionsGuard`

- the two new permissions. Live-verified: Member-role user gets `403` with a
  clear "Missing required permission" message on both list and retry; a
  freshly-registered second organisation's admin sees `total: 0` on the list
  endpoint, and its retry attempt against a real cross-tenant delivery ID
  returns the SAME response (`409`, identical message) a genuinely nonexistent
  ID also produces — no existence leak, even though the HTTP status is `409`
  rather than `404` (see §13 item 10 for the full comparison performed).

## 13. Tests

- **200 suites / 1731 tests overall, all passing.**
- **Notifications domain: 19 suites / 172 tests** (up from 13/116 at the end
  of Sprint 28) — 6 new suites, 56 new tests, covering: `LocalWhatsAppProvider`
  (accept/retryable/terminal classification via reserved test numbers,
  message recording), `MetaWhatsAppProvider` (config validation at
  construction, Meta error-code mapping for auth/rate-limit/invalid-recipient/
  invalid-template/server-error/unknown failures, network-error handling,
  no-secrets-in-errors, phone redaction), `phone-number-normalizer`
  (Nigeria local format, already-international, non-Nigeria refusal, 11
  tests total), `WhatsAppEligibilityService` (every branch: eligible,
  missing-phone, invalid-phone, suspended, disabled-preference,
  disabled-org-channel, unsupported-category, missing-template, user-not-found,
  org-not-found), `WhatsAppDeliveryCreationService` (eligible creates a row,
  ineligible skips rendering, duplicate-create no-ops, independent
  per-notification processing), `WhatsAppDeliveryProcessorService`
  (send/retryable/terminal/max-attempts/multi-delivery-batch/zero-claimed/
  manual-retry/not-found/stale-lease-reclaim).
- Two pre-existing tests updated for the (backward-compatible) shape changes:
  `NotificationPreferenceService.spec.ts` fully rewritten for the 3-field
  preference shape (`inAppEnabled`/`emailEnabled`/`whatsappEnabled`), and
  `notifications-independence.spec.ts` extended with the new file list and
  the `WhatsAppProviderModule` entry in the expected module-imports set.
- Typecheck: clean (`tsc --noEmit`, both apps).
- Lint: 27 pre-existing warnings (API, none in any Sprint 29 file), 0 new;
  web clean.
- Build: both apps build successfully (`nest build`, `next build`).
- `npx prisma validate`: schema valid. `npx prisma migrate status`: database
  schema up to date.
- Seed re-run twice (`pnpm run prisma:seed`) after all schema changes —
  idempotent, identical counts both times, zero errors.

## 14. Live Verification

Performed against the real local PostgreSQL database and real authenticated
tokens (Boby Bites tenant: Owner for organisation configuration, Admin and
Grace as eligible-approver WhatsApp preference holders, Member for
authorization negative tests; a freshly-registered second organisation for
cross-tenant checks). Full scenario-by-scenario account in notifications.md
§24; summary of what was actually run, not just designed:

1. Enabled organisation WhatsApp + per-user WhatsApp preferences — confirmed
   persisted with correct asymmetric defaults, in both the API and the
   frontend (desktop + 375px).
2. Real Purchase Order submissions end-to-end through the actual
   Workflow → Notification → WhatsAppDelivery pipeline → `WhatsAppDelivery`
   rows created and `SENT` via the local provider, with correctly normalized
   phone numbers and correctly rendered template parameters.
3. Replayed processing 8 consecutive times against a drained backlog → zero
   duplicates every time.
4. 6 concurrent `process-events` requests → exactly one created the
   `WhatsAppDelivery` row (total count increased by exactly 1), the other 5
   correctly no-op'd.
5. Simulated retryable failure (19 real deliveries) → correct backoff
   scheduling (+2min, then +10min), terminal `FAILED` at exactly
   `MAX_WHATSAPP_ATTEMPTS = 3`.
6. Simulated terminal failure → `FAILED` on attempt 1, no wasted retries.
7. Manufactured stale `PROCESSING` lease (15 min backdated) → reclaimed by
   the next ordinary sweep.
8. Manual retry on a `FAILED` row → attempts preserved (not reset),
   recipient-snapshot/`createdAt` immutability confirmed across the retry.
9. Suspended a user with 20 existing delivery rows → zero new deliveries
   created for a fresh notification addressed to them; reactivated → their
   20 pre-existing rows remained exactly 20, untouched throughout.
10. Cross-tenant admin isolation → `total: 0`; retry on a real cross-tenant
    ID returned the SAME response as a genuinely nonexistent ID (no
    existence leak).
11. Non-admin authorization → `403` with a clear permission-name message on
    both list and retry.
12. Confirmed the underlying `WorkflowInstance` and `Notification` rows were
    completely unaffected by every WhatsApp failure/success above.
13. Frontend: preferences page's new WhatsApp column, the new Admin: WhatsApp
    Deliveries page, and the organisation settings "WhatsApp" card — all
    verified rendering, toggling, and persisting correctly at desktop and
    375px.
14. Seed re-run twice — idempotent, zero errors (§13 above).
15. **Real WhatsApp Business Platform** — see §14.1; not attempted, no
    credentials configured.

A note on scale: the very first `process-whatsapp` call in this session
created and sent 26 deliveries, not 1 — enabling WhatsApp for a user with an
existing history of `WORKFLOW_APPROVAL_REQUIRED` notifications makes ALL of
that user's still-in-scan-window historical notifications newly eligible on
the very next sweep, exactly as designed (eligibility is evaluated fresh at
processing time, never frozen at notification-creation time). This is the
same behaviour `EmailDelivery` already has — its own backlog had already been
drained during Sprint 28's own testing, which is why enabling email produced
only 1 new delivery this sprint. Not a WhatsApp-specific quirk, not a bug.

### 14.1 Real WhatsApp Provider Test

**Not attempted.** No `WHATSAPP_ACCESS_TOKEN`/`WHATSAPP_PHONE_NUMBER_ID`/
`WHATSAPP_BUSINESS_ACCOUNT_ID` are configured in this environment — confirmed
present: **NO** (all three unset, checked via a safe presence-only inspection,
no values printed or inspected) — and no approved WhatsApp Business template
exists to test against. Per the brief's own explicit requirement, this test
is performed ONLY when credentials AND an approved template are both actually
available. Fields, per the brief's mandated disclosure format:

- **Credentials configured**: NO.
- **Approved template available**: NO (cannot be verified without an
  account).
- **Test attempted**: NO.
- **Provider accepted**: N/A — not applicable, no send was attempted.
- **Recipient received**: N/A — never claimed, and never will be without
  independent verification, per the brief's explicit "never claim recipient
  receipt if you cannot verify it" instruction.

If real WhatsApp Business Platform credentials become available (the way real
ZeptoMail SMTP credentials were provided for Sprint 28's real-provider test),
this test can be performed following the identical pattern: set
`WHATSAPP_PROVIDER_MODE=meta` temporarily, one controlled send to a
designated test number through the real pipeline (never a bypass/test-only
endpoint), verify provider acceptance and `providerMessageId` persistence,
then revert to `local` and clean up exactly as this sprint's local-provider
testing was cleaned up (§14 item 14 of notifications.md §24).

## 15. Documentation

- [`docs/domains/notifications.md`](domains/notifications.md) — extended with
  §20 (WhatsApp Delivery), §21 (Processing Reliability), §22 (Provider
  Abstraction), §23 (Configuration Reference), §24 (Live Verification,
  including the real-provider-test disclosure), plus updates to the intro
  section (now explicitly listing In-App/Email/WhatsApp as the three
  channels).
- [`docs/architecture/whatsapp-delivery.md`](architecture/whatsapp-delivery.md)
  — new architecture decision record.
- `docs/sprint-29-completion-report.md` — this document.
- `README.md`, `docs/roadmap.md`, `docs/backlog.md`, `docs/changelog.md` — all
  updated with Sprint 29 summaries.
- `docs/domains/README.md` — Notifications row extended; permission-catalogue
  count corrected 136 → 138.
- `apps/api/.env.example` — new WhatsApp variables documented (safe
  placeholders/commented values only, never real credentials).

## 16. Deferred Scope

Explicitly, deliberately not built this sprint (matching the brief's own
extensive "do not build" list):

- A WhatsApp chatbot, two-way conversations, WhatsApp-initiated approval
  actions, conversational AI.
- Marketing/promotional broadcasts, bulk messaging, WhatsApp groups, a
  customer-service inbox, WhatsApp status publishing.
- SMS and voice calls (the `NotificationChannel` enum has room for SMS; no
  further channel is implemented).
- WhatsApp commerce, payment collection through WhatsApp, media-heavy
  WhatsApp workflows, automated WhatsApp conversations.
- An external customer-messaging CRM integration, WhatsApp analytics beyond
  delivery status, arbitrary free-form outbound messaging.
- Notification categories beyond `WORKFLOW_APPROVAL_REQUIRED` — the brief's
  own explicit "do not expand scope merely because WhatsApp could
  theoretically deliver every notification type" instruction.
- A background worker/queue for WhatsApp processing — on-demand triggering
  only, matching every other channel's established, documented choice.
- Delivery-status/read-receipt webhooks — `SENT` means "accepted by the
  provider," never "confirmed delivered/read," by design
  (whatsapp-delivery.md §3), even though WhatsApp Business Platform does
  offer such webhooks.
- Verification of the real approved template's actual placeholder order
  against a live Meta Business account — `APPROVAL_TEMPLATE_PARAMETER_ORDER`
  remains an explicitly documented, unverified assumption (§6).
- Tenant-level WhatsApp credential storage — the organisation-level toggle is
  tenant-configurable; the actual Business Platform credentials remain
  environment-only, matching email's own "no insecure tenant-level
  credential model" precedent.

## 17. Known Limitations

- **Scan-window scale ceiling**: `findPendingForWhatsAppEvaluation` is bounded
  by `limit` (default 50), same as email's own scan. The newest-first
  ordering (applied proactively from the start this sprint, never
  reproducing Sprint 28's starvation bug) ensures this never turns into
  permanent starvation, but an organisation generating more than 50 new
  notifications between sweeps could, in principle, still leave some
  unevaluated until the next sweep catches up.
- **At-least-once, not exactly-once delivery** — a narrow crash window
  between provider acceptance and the `SENT` write committing could cause a
  duplicate real-world send on the next stale-lease reclaim. Documented, not
  solved (no provider-side idempotency key support in the Meta Cloud API's
  `/messages` endpoint).
- **Unverified template placeholder order** — `APPROVAL_TEMPLATE_PARAMETER_ORDER`
  is an assumption pending confirmation against a real approved
  `zentuva_approval_required` template in a live WhatsApp Business account
  (§6, §16). Not a defect in this codebase's logic, but a genuine open item
  before any real send should be attempted.
- **Real-provider test not attempted** — no WhatsApp Business Platform
  credentials were available in this environment (§14.1). The Meta adapter
  is implemented, unit-tested (config validation, error-code mapping), and
  structurally ready, but has never made a real HTTP call to Meta's API.
- **No delivery-status/read-receipt webhooks** — `SENT` never becomes
  `DELIVERED`/`READ` even though the provider account may have that
  capability; would require a new inbound webhook endpoint, explicitly out
  of scope this sprint.

## 18. Git Status

- **No commit made.**
- **No push made.**
- Current branch: `main`.
- HEAD: `331804b782b7a46c1fbc67d01baa13a629372c37` — "Sprint 28: Email
  Notification Delivery Foundation" (unchanged by this sprint's work; nothing
  has been committed on top of it).
- Working tree: 27 modified files, 22 new/untracked paths (including this
  report; `.claude/` was already untracked before this sprint began and is
  unrelated to it) — nothing staged, nothing committed, matching the brief's
  explicit "DO NOT commit. DO NOT push." instruction throughout.
