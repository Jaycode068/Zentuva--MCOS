# Notifications & Activity Centre Domain

Sprint 27 — Notifications & Activity Centre Foundation. Builds the first reusable
in-app notification system on top of Sprint 26.1's `WorkflowEvent` table, without
touching Workflow's own code (other than exporting two already-existing services and
adding processing-state columns to `WorkflowEvent` itself). **Sprint 27.1 —
Notification Reliability, Preferences & Activity Consolidation** hardens that
foundation: an explicit, concurrency-safe processing state machine with bounded
retry and stale-lease recovery, a documented recipient contract, a tenant-scoped
preference system, and an operational admin surface for inspecting/retrying failed
processing — all without redesigning anything Sprint 27 got right. **Sprint 28 —
Email Notification Delivery Foundation** adds email as a second, genuinely
downstream channel: `EmailDelivery` (§15) is produced from an already-created
`Notification` (never from `WorkflowEvent` directly), with its own
provider-independent adapter (§17), its own reliability state machine (§16), and
its own preference gate (§15.3) — see
[docs/architecture/email-delivery.md](../architecture/email-delivery.md) for the
full architecture decision record.

## 1. Domain Purpose

Answers "what requires MY attention right now" (a `Notification`, recipient-scoped)
and, separately, "what happened" (an `ActivityRecord`, organisation-scoped) — two
related but deliberately distinct questions, never conflated (§10). See
[docs/architecture/notification-activity-boundaries.md](../architecture/notification-activity-boundaries.md)
for the full architectural decision record on how these relate to `WorkflowEvent`
and `AuditLog` too.

Delivers two channels as of Sprint 28: `IN_APP` (Sprint 27) and `EMAIL` (Sprint 28,
transactional only — never marketing, see email-delivery.md §7). SMS, push,
WhatsApp, webhooks, digests, scheduled reminders, and automatic escalation are all
explicitly out of scope — the data model and processing architecture are built so
adding a further channel means adding a `NotificationChannel` enum value and a new
delivery path (a new `*Delivery` table + provider adapter, following `EmailDelivery`
as the template), never redesigning how events become notifications or deliveries.

## 2. Four Distinct Concepts — Do Not Confuse Them

| Concept                | What it answers                                                                                  | Scope         | Table                                         | Mutable?                           |
| ---------------------- | ------------------------------------------------------------------------------------------------ | ------------- | --------------------------------------------- | ---------------------------------- |
| `WorkflowEvent`        | "What state transition just happened, in Workflow's own terms?"                                  | Organisation  | `workflow_events`                             | Processing-state columns only (§4) |
| `Notification`         | "What requires THIS user's attention?"                                                           | One recipient | `notifications`                               | `status`/`readAt` only             |
| `AuditLog`             | "What administrative/security-relevant action happened, generically, across the whole platform?" | Organisation  | `audit_logs`                                  | Never                              |
| `ActivityRecord` (§10) | "What happened, in human terms, for anyone with visibility?"                                     | Organisation  | _(none — composed live from `WorkflowEvent`)_ | N/A, read-only view                |

A `Notification` is produced FROM a `WorkflowEvent` (§4) but is not the same row, has
different columns, a different audience, and a different lifecycle. Reading an
`ActivityRecord` never marks any `Notification` read; marking a `Notification` read
never touches `WorkflowEvent` or `AuditLog`; dismissing/reading a `Notification` never
deletes anything — nothing in this domain deletes rows.

## 3. Data Model

### `Notification`

```
id, organisationId, recipientUserId, type, channel, title, body, status, readAt,
sourceEventId, sourceType, sourceId, actionUrl, metadata, createdAt, updatedAt
```

- `recipientUserId` is a plain scoped string, not a formal Prisma relation — matching
  this codebase's existing convention for actor/recipient user references
  (`WorkflowInstance.requestedById`, `WorkflowDecision.actorUserId`, none of which
  have a reverse relation on `User` either).
- `sourceEventId`/`sourceType`/`sourceId` together let a consumer navigate and
  trace back to the originating event without a join — `sourceType`/`sourceId`
  deliberately duplicate what's already derivable from `sourceEventId` because a
  future non-Workflow notification source might not have a `WorkflowEvent` row to
  join to at all.
- `actionUrl` is precomputed and stored (e.g.
  `/settings/workflows/instances/{id}`) — the frontend never parses `sourceType`/
  `sourceId` into a URL itself, and the instance id embedded in it is always the
  server's own resolution of `event.workflowInstanceId`, never anything client-
  supplied — a stale or now-unauthorized link simply 403/404s when followed,
  exactly like navigating there any other way (§12 "Notification navigation
  safety").
- `type`: `NotificationType` enum, `WORKFLOW_APPROVAL_REQUIRED` /
  `WORKFLOW_STEP_APPROVED` / `WORKFLOW_APPROVED` / `WORKFLOW_STEP_REJECTED` /
  `WORKFLOW_RETURNED` / `WORKFLOW_RESUBMITTED` / `WORKFLOW_CANCELLED` /
  `WORKFLOW_EXPIRED` — one value per `WorkflowEvent` type that recipient rules
  actually produce a notification for (§3.1 "Excluded event types").
- `status`: `UNREAD` → `READ` only. No separate delivery-status machine — there is
  nothing to "deliver" for an `IN_APP`-only channel beyond the row existing.
- `channel`: `NotificationChannel` enum, `IN_APP` only today — the enum exists
  specifically so `EMAIL`/`SMS`/`PUSH`/`WEBHOOK` can be added as new values later
  with no migration for existing rows.

**Unique constraint** (the idempotency invariant, §5):
`@@unique([organisationId, sourceEventId, recipientUserId, channel])`.

### `WorkflowEvent` processing-state columns (Sprint 27, extended Sprint 27.1)

```
notificationProcessingStatus  (NotificationProcessingStatus: PENDING/PROCESSING/PROCESSED/FAILED)
notificationProcessedAt       (convenience timestamp — "when did this finish")
notificationAttempts          (lifetime attempt count, never reset)
notificationFirstAttemptAt    (set once, never overwritten)
notificationLastAttemptAt
notificationLastError         (bounded to 2000 chars, never a raw stack trace)
notificationLastErrorCategory (coarse classification, e.g. "PRISMA_P2028")
notificationLeaseAt           (claim timestamp — non-null only while PROCESSING)
notificationNextRetryAt       (backoff scheduling for a retryable failure)
```

Processing-state columns added directly to the existing event table (Option B, §4)
rather than a separate outbox table. Sprint 27 shipped a simpler 2-state version
(`notificationProcessedAt` null/non-null); Sprint 27.1 promoted this to the
explicit `NotificationProcessingStatus` state machine (§4.2) and added the lease/
retry-scheduling columns needed for concurrency-safe claiming and bounded retry.
**Migration note**: `20260916104048_sprint27_1_notification_reliability_preferences`
backfills every pre-existing row with `notificationProcessedAt IS NOT NULL` to
`PROCESSED`; any row that was attempted but never finished under the old model is
left `PENDING` with an immediately-due retry (honest, since the old model cannot
prove it actually succeeded, and reprocessing is idempotent regardless).

### `NotificationPreference` (new, Sprint 27.1 §6)

```
id, organisationId, userId, category, inAppEnabled, createdAt, updatedAt
```

`@@unique([organisationId, userId, category])` — one row per user per category,
per organisation. Absence of a row means enabled (§6's explicit default); this
table only ever stores an override.

### 3.1 Excluded event types

`WorkflowEvent.eventType` has ten real, emitted values (workflow.md §7):
`SUBMITTED`, `APPROVAL_REQUIRED`, `STEP_APPROVED`, `APPROVED`, `REJECTED`,
`RETURNED`, `RESUBMITTED`, `CANCELLED`, `EXPIRED`, `COMPLETED`. Two of these
deliberately produce **zero** notifications under this sprint's recipient rules,
and have no corresponding `NotificationType`:

- **`SUBMITTED`** — redundant. `APPROVAL_REQUIRED` for step 1 fires in the exact
  same request (`WorkflowInstanceService.submit`/`resubmit`) and already notifies
  every eligible first-step approver; a second "a request was submitted" copy to
  the same audience at the same instant would be noise, not signal.
- **`COMPLETED`** — unreachable. `WorkflowInstanceService.markCompleted` exists but
  no controller route and no `WorkflowSubjectHandler` (including
  `PurchaseOrderWorkflowHandler`) ever calls it (workflow.md §4, §8) — re-verified
  by inspection this sprint. A notification type for an event that can never fire
  would violate the brief's own "do not create notification types for unsupported
  events."

If a future sprint wires up `markCompleted` for a real integration, adding
`WORKFLOW_COMPLETED` is a small, additive change to `NotificationRecipientResolver`
and `NotificationMessageBuilder` — no schema redesign.

## 4. Event-Consumption Architecture

```
WorkflowInstanceService (unchanged)
        │  writes, inside its own transaction
        ▼
WorkflowEvent  (organisation-scoped, durable, workflow.md §7)
        │  claimed via a conditional updateMany — NEVER a plain SELECT-then-act
        ▼
NotificationEventProcessorService.claimBatch → per claimed event:
        ├─ NotificationRecipientResolver.resolve(...)        → who
        ├─ NotificationPreferenceService.filterEnabledRecipients(...)  → who, after opt-out
        ├─ NotificationMessageBuilder.build(...)              → what
        └─ Notification.createMany({ skipDuplicates })        → durable rows
        │  + WorkflowEvent → PROCESSED (success) or PENDING-with-backoff /
        │    FAILED (retryable / terminal failure) — §4.2
        ▼
Notification  (recipient-scoped, durable)
```

**Chosen architecture: Option B, "event consumer with processing state."** Not a
separate outbox table, not Option A (transactional creation inside
`WorkflowInstanceService` itself, which would couple Workflow to Notifications),
not a full outbox/saga system. `WorkflowEvent` already IS the durable,
transactionally-written record Sprint 26.1 built for exactly this consumption
purpose.

**The boundary is the TABLE, not a service call.** `NotificationEventProcessorService`
reads `WorkflowEvent`/`WorkflowInstance`/`WorkflowStepInstance` directly via the
globally-registered `PrismaService` — it never imports or calls
`WorkflowInstanceService`, `WorkflowInstanceRepository`, or
`WorkflowDefinitionRepository`. It DOES import (via `WorkflowModule`'s exported
providers) `WorkflowEligibilityService` and `WorkflowDefinitionService` — both
pure, read-only, side-effect-free. Verified executably by
`notifications-independence.spec.ts`:

- No Notifications file _imports_ `WorkflowInstanceService`/
  `WorkflowInstanceRepository`/`WorkflowDefinitionRepository`.
- No Notifications file writes to any `workflow_*` table other than
  `WorkflowEvent`'s own processing-state columns.
- `NotificationsModule` imports only `IdentityModule`/`AuthModule`/`WorkflowModule`.
- `WorkflowModule` never imports `NotificationsModule`.

### 4.1 Processing trigger — no queue/cron infrastructure exists yet

Inspected before writing any code, both sprints: **no BullMQ, no `@nestjs/schedule`,
no Redis-backed job system, no domain-event dispatcher, no outbox worker exists
anywhere in this codebase.** `processPendingEvents` is exposed via `POST
/notifications/process-events` and triggered from the frontend:

1. **The notification bell polls it** every 20 seconds, alongside refreshing the
   unread count and recent list.
2. **Workflow-mutating pages call it directly** right after a mutation succeeds —
   fire-and-forget, errors swallowed, so a notification-processing hiccup can never
   surface as if the workflow action itself failed.

Sprint 27.1 explicitly kept this trigger model — Workstream A's brief allows "a
small internal abstraction ... if clearly justified," and the claim-based state
machine below is designed so that swapping the trigger for a real scheduled job
later requires zero change to `processPendingEvents`/`claimBatch` themselves, only
to what calls them. See §16 "Known limitations."

### 4.2 Processing States & Concurrency Protection (Sprint 27.1 §Workstream A)

`WorkflowEvent.notificationProcessingStatus` (`NotificationProcessingStatus` enum):

| State        | Meaning                                                          | Entered from                                                      | Exits to                                                                            |
| ------------ | ---------------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `PENDING`    | Eligible to be claimed (due now, or a fresh event)               | Default on creation; a retryable failure; manual retry            | `PROCESSING` (claimed)                                                              |
| `PROCESSING` | Claimed by a processor; `notificationLeaseAt` set                | `PENDING` → claim; stale `PROCESSING` → reclaim                   | `PROCESSED` (success); `PENDING` (retryable failure); `FAILED` (attempts exhausted) |
| `PROCESSED`  | Terminal, success. `notificationProcessedAt` set.                | `PROCESSING` → success                                            | Never (immutable)                                                                   |
| `FAILED`     | Terminal, attempts exhausted. Requires the admin retry endpoint. | `PROCESSING` → failure with `attempts >= MAX_PROCESSING_ATTEMPTS` | `PENDING` (admin retry only)                                                        |

**The claim IS the concurrency guarantee** (`NotificationEventProcessorService.
claimBatch`) — a per-row conditional `updateMany`, this codebase's established
idiom (`WorkflowInstanceRepository.decideStep`'s own pattern), never a plain
`SELECT` followed by unconditional work:

```ts
await this.prisma.workflowEvent.updateMany({
  where: {
    id: candidate.id,
    OR: [
      { notificationProcessingStatus: 'PENDING' },
      { notificationProcessingStatus: 'PROCESSING', notificationLeaseAt: { lt: staleCutoff } },
    ],
  },
  data: { notificationProcessingStatus: 'PROCESSING', notificationLeaseAt: now, ... },
});
```

Two concurrent `processPendingEvents` calls racing the same candidate: only one's
`updateMany` affects a row (`count === 1`); the other sees `count === 0` and simply
excludes that event from its own claimed batch. There is no window where both
process the same event — **live-verified**, not just unit-tested (§15): five
concurrent `POST /notifications/process-events` calls against a single fresh
event produced exactly one successful claim (`processed: 2, notificationsCreated:
3`) and four no-ops (`processed: 0`).

**Stale-lease recovery**: a `PROCESSING` row whose `notificationLeaseAt` is older
than `PROCESSING_LEASE_MS` (5 minutes,
`notification-processing.constants.ts`) is treated as an abandoned claim — the
process that claimed it crashed or hung — and becomes reclaimable by the next
sweep's candidate query, using the exact same conditional `updateMany`. No
separate recovery job exists; recovery happens for free as part of every ordinary
`processPendingEvents` call, since the claim query's `WHERE` already includes
stale `PROCESSING` rows alongside due `PENDING` ones. **Live-verified** (§15): a
row manually set to `PROCESSING` with a 10-minute-old lease was reclaimed and
successfully processed by the very next `process-events` call, with
`notificationFirstAttemptAt` preserved from the original (abandoned) claim.

### 4.3 Retry Policy (`notification-processing.constants.ts`)

```ts
MAX_PROCESSING_ATTEMPTS = 3;
RETRY_BACKOFF_MS = [0, 60_000, 5 * 60_000]; // immediate, 1 min, 5 min
PROCESSING_LEASE_MS = 5 * 60 * 1000; // 5 minutes
```

Every processing failure is currently treated as retryable — there is no error
taxonomy in this system that distinguishes "worth retrying" from "will always fail
the same way" (a deliberately simple, documented policy, not an oversight: the
brief explicitly allows "the retry policy may be simple for this sprint"). On
failure, `recordFailure` computes `attempts = event.notificationAttempts + 1`:

- `attempts < MAX_PROCESSING_ATTEMPTS` → back to `PENDING`, with
  `notificationNextRetryAt = now() + RETRY_BACKOFF_MS[attempts]` (backoff, not
  immediate — attempt 2 waits 1 minute, attempt 3 waits 5 minutes).
- `attempts >= MAX_PROCESSING_ATTEMPTS` → terminal `FAILED`,
  `notificationNextRetryAt = null` (no automatic path back to `PENDING` — requires
  `POST /notifications/admin/processing/:eventId/retry`, §7 below).

**Manual retry always overrides the delay** — `retryEvent` sets
`notificationNextRetryAt = now()` directly, bypassing whatever backoff would
otherwise apply, and is eligible from either `FAILED` or a stuck `PROCESSING`
(brief: "events manually selected for retry by an authorised administrator," not
only exhausted-attempt events). It does **not** reset `notificationAttempts` — the
full lifetime attempt history is preserved for audit; a manually-retried event can
still exhaust attempts again and return to `FAILED`. **Live-verified** (§15): a
manufactured `FAILED` event (3 attempts) was retried by an administrator, picked
up by the next sweep, and reached `PROCESSED` with `attempts: 4` — history
preserved, no duplicate notification created (the same `createMany({
skipDuplicates: true })` path every attempt uses).

**One event's failure never blocks another's** in the same
`processPendingEvents` batch — the loop continues, and the return value (`{
processed, failed, notificationsCreated }`) surfaces failures to the caller,
never silently swallowed.

## 5. Idempotency & Concurrency

**The database-level unique index remains the actual guarantee — not an
application-level pre-check**, unchanged from Sprint 27 and re-verified against
the new claim-based processor: `Notification.createMany({ data: rows,
skipDuplicates: true })` against `@@unique([organisationId, sourceEventId,
recipientUserId, channel])`, letting Postgres silently skip any row that would
violate it.

- **Processing the same event twice** → impossible in the normal case (a
  `PROCESSED` row is never re-claimed by the candidate query); even if it
  somehow were re-attempted, the insert is a silent no-op.
- **Two concurrent consumers** → the claim step (§4.2) ensures only one ever gets
  to the insert for a given event in the first place; the unique index is the
  second, independent layer of protection on top.
- **Retry after a transaction failure** → the whole event's transaction
  (recipient rows + terminal state) rolled back together (§4.4), so a retry
  starts clean.
- **Replaying a historical event** (e.g. via manual retry, or the processor
  catching up on an old backlog) → live-verified in both Sprint 27 and 27.1: a
  fresh `processPendingEvents` call against 20+ backlog events created exactly
  the expected notifications, no duplicates, even though some of those events
  were originally created before Notifications existed.

## 4.4 Failure Visibility (Sprint 27.1 §Workstream A.5)

Every `WorkflowEvent` row directly answers the brief's required questions via
`GET /notifications/admin/processing` (§7):

| Question                                     | Column(s)                                                                                                                                                                                             |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Which source event failed, what type?        | `id`, `eventType`                                                                                                                                                                                     |
| When was it first/last attempted?            | `notificationFirstAttemptAt`, `notificationLastAttemptAt`                                                                                                                                             |
| How many attempts?                           | `notificationAttempts`                                                                                                                                                                                |
| Latest failure category?                     | `notificationLastErrorCategory` (e.g. `PRISMA_P2028`)                                                                                                                                                 |
| When can it be retried?                      | `notificationNextRetryAt` (`null` once `FAILED`, meaning "only via manual retry")                                                                                                                     |
| Was any notification created before failure? | Cross-reference `GET /notifications/activity` or `Notification.sourceEventId` — a partial-failure batch is impossible by construction (§4.2's atomic transaction), so this is always "all or nothing" |
| What tenant?                                 | `organisationId` (implicit — every admin query is scoped to the caller's own)                                                                                                                         |
| Can it be safely retried?                    | `status IN (FAILED, PROCESSING)` — surfaced directly as the "Retry now" action only appearing for those statuses in the admin UI                                                                      |

`notificationLastError` is bounded to 2000 characters and is always
`Error.message`, never a raw stack trace; `notificationLastErrorCategory` is a
coarse classification (`PRISMA_<code>` or `Error.name`), safe to show an
administrator without leaking implementation internals to anyone else — the whole
endpoint is gated by `notification.processing.view` (§12).

## 6. Recipient Resolution & Contract (Sprint 27.1 §Workstream B)

`NotificationRecipientResolver.resolve(event, instance, stepInstances)` — one
branch per `WorkflowEvent.eventType`, always returning a plain `string[]` of
`User.id`s, never "every organisation user." Every branch that needs "who is
eligible to act on step N" delegates to `WorkflowEligibilityService.
listEligibleApprovers` (unchanged since Sprint 26) — the SAME self-approval check,
explicit-assignee check, active-user check, and permission/scope check that gates
whether a real `POST /workflows/instances/:id/approve` call would actually
succeed.

### Recipient contract

| Event                        | Recipient category                                                   | Exclusions                                                                                                                    |
| ---------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `APPROVAL_REQUIRED`          | Current eligible approvers of the newly-active step                  | Suspended/inactive/role-removed users (via `listEligibleApprovers` live at processing time — not resolved once at submission) |
| `STEP_APPROVED` (mid-chain)  | Requester                                                            | —                                                                                                                             |
| `STEP_APPROVED` (final step) | _None_ — the separate `APPROVED` event covers it                     |                                                                                                                               |
| `APPROVED`                   | Requester                                                            | —                                                                                                                             |
| `REJECTED`                   | Requester                                                            | —                                                                                                                             |
| `RETURNED`                   | Requester                                                            | —                                                                                                                             |
| `RESUBMITTED`                | Previous approver — specifically whoever RETURNED the prior instance | —                                                                                                                             |
| `CANCELLED`                  | Requester                                                            | The requester themself, if they were also the one who cancelled it                                                            |
| `EXPIRED`                    | Requester + current eligible approvers of the still-active step      | Same exclusions as `APPROVAL_REQUIRED`                                                                                        |

**Duplicate recipient prevention**: a user who qualifies through more than one
path for the SAME event (e.g. an approver who is also, somehow, resolved twice)
is deduplicated in-memory (`[...new Set(recipients)]`) before message
construction — an efficiency measure, not the actual safety net; the database
unique constraint (§5) remains the final protection either way.

### 6.1 User status changes — behavior, not just aspiration

| Scenario                                                      | Behavior                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User suspended AFTER a notification was created               | The `Notification` row is untouched — no deletion, no retroactive hiding. **Live-verified**: suspending a user with 13 existing notifications left the count at 13.                                                                                                          |
| User suspended BEFORE the triggering event is processed       | Excluded from resolution — `listEligibleApprovers` is called fresh at PROCESSING time, never cached from submission time. **Live-verified**: a suspended user was absent from both `GET .../eligible-approvers` and the resolver's own output for a freshly-submitted event. |
| User loses the relevant role before processing                | Same as suspension — resolved live, so a role removed between submission and processing excludes them.                                                                                                                                                                       |
| User loses the relevant role AFTER a notification was created | The existing `Notification` row is untouched (same as suspension); FUTURE events simply won't resolve them again.                                                                                                                                                            |
| User reactivated                                              | Immediately eligible again on the next event — no special "unsuspend" cleanup needed; nothing was ever deleted. **Live-verified**: reactivating a suspended user restored login and full access to their pre-existing 13 notifications.                                      |
| User's organisation membership/assignment changes             | Not modeled in this codebase (a `User` belongs to exactly one `Organisation`, permanently) — not applicable.                                                                                                                                                                 |

No historical `Notification` is ever deleted due to a later status change — there
is no retention/deletion policy in this sprint (§9 "Retention").

## 6.2 Preferences (Sprint 27.1 §Workstream D)

### Categories

Two categories — a coarse grouping of the 8 `NotificationType` values, matching
the only real distinction that exists today (`notification-category.ts`):

- `WORKFLOW_APPROVALS` — `WORKFLOW_APPROVAL_REQUIRED` only: "something needs YOUR
  action right now."
- `WORKFLOW_STATUS_CHANGES` — the other 7 types: "something you already know
  about changed status."

No speculative third category (e.g. "System") — nothing in this domain produces
one yet.

### Scope & defaults

`@@unique([organisationId, userId, category])` — a user's preference in one
organisation never affects another (though in practice a `User` row already
belongs to exactly one organisation in this codebase's data model; the
`organisationId` column is kept anyway for defense-in-depth and query-scoping
consistency with every other tenant-scoped table). **Live-verified**: a rival-
tenant user's preferences read back as fully independent defaults, with no
visibility into Boby Bites' Grace having previously overridden hers.

**Default: enabled.** Absence of a row means `true` — `NotificationPreferenceService.
getForUser` always returns one entry per category regardless of what's stored,
filling in the default for anything absent.

### Suppression semantics

Preferences affect **notification creation only** — never `WorkflowEvent`,
`WorkflowDecision`, or the Activity Centre, all of which remain complete and
unaffected. `NotificationEventProcessorService.processOne` filters the resolved
recipient list through `NotificationPreferenceService.filterEnabledRecipients`
AFTER recipient resolution but BEFORE message construction/insertion — a
recipient with the category disabled simply receives no `Notification` row for
that event, while the event itself still reaches `PROCESSED` normally (a
preference is not a failure). **Live-verified**: with `WORKFLOW_APPROVALS`
disabled, a fresh approval-required event was processed successfully
(`notificationsCreated` counted only the OTHER eligible recipients) while the
disabled user's unread count stayed unchanged and the underlying `WorkflowEvent`/
audit trail (`SUBMITTED` + `APPROVAL_REQUIRED`) remained fully intact.

Preferences are explicitly **not** an authorization mechanism — disabling a
category never changes what a user is allowed to see or do, only whether they get
proactively notified about it.

### API/UI

`GET/PATCH /notifications/preferences[/:category]`, `POST
/notifications/preferences/reset` — self-scoped (`JwtAuthGuard` alone, same as
every other "my own data" route). A `/notifications/preferences` page (tab within
the existing Notifications area, §8) with a checkbox per category; verified live
at 375px.

## 7. API Reference

All routes `@Controller('notifications')`, `@UseGuards(JwtAuthGuard)` at the
controller level; `activity` and the `admin/processing/*` routes are the
exceptions, each requiring a specific permission.

| Method  | Path                                             | Auth                             | Behavior                                                                             |
| ------- | ------------------------------------------------ | -------------------------------- | ------------------------------------------------------------------------------------ |
| `GET`   | `/notifications`                                 | Self                             | Paginated, filterable by `status`/`type`, newest-first, recipient- and tenant-scoped |
| `GET`   | `/notifications/activity`                        | `workflow.audit.view`            | Organisation-wide activity feed composed from `WorkflowEvent`                        |
| `GET`   | `/notifications/unread-count`                    | Self                             | `{ count }`                                                                          |
| `GET`   | `/notifications/preferences`                     | Self                             | Always returns one entry per category, filling in defaults                           |
| `PATCH` | `/notifications/preferences/:category`           | Self                             | Upsert one category's `inAppEnabled`                                                 |
| `POST`  | `/notifications/preferences/reset`               | Self                             | Deletes all overrides; returns full defaults                                         |
| `GET`   | `/notifications/admin/processing`                | `notification.processing.view`   | Paginated, filterable by `status` — the failure-inspection surface (§4.4)            |
| `POST`  | `/notifications/admin/processing/:eventId/retry` | `notification.processing.manage` | Tenant-scoped, idempotent-safe manual retry (§4.3)                                   |
| `GET`   | `/notifications/:id`                             | Self                             | 404 (not 403) for another user's or tenant's notification                            |
| `POST`  | `/notifications/process-events`                  | Self                             | Triggers `processPendingEvents` for the caller's own organisation                    |
| `POST`  | `/notifications/mark-all-read`                   | Self                             | Only the caller's own unread rows                                                    |
| `POST`  | `/notifications/:id/read`                        | Self                             | Idempotent; 404 if not the caller's own                                              |
| `POST`  | `/notifications/:id/unread`                      | Self                             | Idempotent; 404 if not the caller's own                                              |

Route declaration order matters in NestJS — `preferences`/`admin/processing`/
`activity`/`unread-count`/`process-events`/`mark-all-read` are all declared before
the `:id` wildcard route, verified live.

## 8. Notification Lifecycle

`UNREAD` (default on create) → `READ` (via `POST /notifications/:id/read`, or
`POST /notifications/mark-all-read`) → `UNREAD` again (via `POST
/notifications/:id/unread`) — a simple two-state toggle. Every transition is
idempotent at the repository level (conditional `updateMany` requiring the
CURRENT status) — marking an already-`READ` notification read again is a
harmless no-op, never an error. **Live-verified** (§15): unread count moved
4 → 3 → 0 across a single mark-read then mark-all-read, and a repeated mark-read
on the same notification returned `{ ok: true }` without a second write.

**Retention**: no automatic deletion exists or is planned this sprint —
notifications are retained indefinitely. `createdAt` (already indexed alongside
`organisationId, recipientUserId`) is the field a future retention/archival
policy would filter on; no other schema change would be needed to add one later.

## 9. Activity Centre

Composed **live** from `WorkflowEvent` rows — no new table
(`ActivityService.list`). Organisation-wide, so it answers "what happened" for
anyone with visibility, not "what's waiting on me." `WorkflowEvent`'s
activity-relevant columns are write-once by application code — satisfying
"activity records should be immutable" without a second table needing its own
immutability discipline. See
[docs/architecture/notification-activity-boundaries.md](../architecture/notification-activity-boundaries.md)
for the full decision record on why this composition, rather than a duplicate
table, is correct.

`GET /notifications/activity` supports `subjectType`/`subjectId` filtering
alongside the unfiltered organisation-wide feed. Gated by the existing
`workflow.audit.view` permission — no new catalogue entry.

## 10. Authorization & Tenant Isolation

**No new authorization primitives**, in either sprint. `NotificationsController`
uses `JwtAuthGuard` alone for every self-scoped route, matching
`AccountController`'s "my own data" precedent. Two new permission-catalogue
entries were added this sprint (`notification.processing.view`/`.manage`,
§4.4/§7) — a genuinely new administrative capability with no existing entry to
reuse — auto-granted to the `Administrator` system role via the existing
catalogue-seed loop (no manual seed code needed; verified live by re-running
`prisma:seed` and querying the resulting `RolePermission` rows).

Every notification/preference query or mutation is scoped by BOTH
`organisationId` AND the caller's own id, taken from the JWT, never client-
supplied. Admin processing routes are scoped by `organisationId` alone (there is
no per-user "processing record owner" — a `WorkflowEvent` belongs to the
organisation). **Live-verified**, both sprints: cross-tenant `GET /notifications`
returns `{ items: [], total: 0 }`; a direct `GET /notifications/:id` for another
tenant's known id returns `404`; a non-administrator's `GET /notifications/
admin/processing` returns `403`.

**Notification navigation safety** (§Workstream E.2): `actionUrl` is always
server-computed from the event's own `workflowInstanceId` at message-construction
time, never accepted from a client. If the recipient later loses access to the
underlying instance (e.g. a permission change), following the link simply hits
that route's own existing authorization check — the notification itself never
grants access it wouldn't otherwise have.

## 11. Frontend Notification Centre

- **`NotificationBell`** — mounted once in `Topbar`, visible on every
  authenticated page at every width. Unread badge (`9+` cap), dropdown of the 5
  most recent notifications, "Mark all read," "View all notifications."
- **`/notifications`** — the full, paginated, filterable list, plus
  `NotificationTabs` (Notifications / Preferences / Admin: Processing — Sprint
  27.1, mirroring `WorkflowTabs`' own multi-route-tab convention).
- **`/notifications/preferences`** (new) — one checkbox per category, "Reset to
  defaults."
- **`/notifications/admin`** (new) — status-filtered processing records with a
  "Retry now" action on `FAILED`/`PROCESSING` rows. Rendered for every user (no
  client-side permission hook exists anywhere in this codebase); a
  non-administrator's API call 403s and the page shows a clear permission-denied
  message rather than silently failing — matching every other admin-only
  surface's existing convention.
- **Mobile (375px)**: verified live for all four pages this sprint. One real
  issue found and fixed: the Admin: Processing status-filter button row
  overflowed the viewport with no scroll affordance — fixed with
  `overflow-x-auto` (the exact convention already used elsewhere for wide
  content), re-verified with a visible scroll indicator.

## 12. Testing

7 spec files, 66 tests, all passing — Sprint 27's 45 tests across 6 files grew to
66 across 7 files (the processor's test suite roughly doubled given the new state
machine, plus a new `notification-preference.service.spec.ts`):

- `notification-event-processor.service.spec.ts` — successful processing, tenant
  scoping, preference filtering (including the "still reaches PROCESSED" case),
  recipient dedup, duplicate/concurrent-claim safety, retryable failure, terminal
  failure at `MAX_PROCESSING_ATTEMPTS`, one-failure-doesn't-block-another,
  stale-`PROCESSING` inclusion in the claim query, manual retry (including
  attempt-history preservation, rejecting an already-`PROCESSED` event, 404 for
  cross-tenant, retry-after-partial-creation-is-still-duplicate-safe),
  `listProcessingRecords` tenant/status scoping, missing-instance handling.
- `notification-preference.service.spec.ts` (new) — defaults, read/update
  scoping, unsupported-category rejection, reset behavior (never touches
  `Notification` rows), `filterEnabledRecipients` exclusion/inclusion/empty-input.
- `notification-recipient-resolver.spec.ts`, `notification-message-builder.spec.ts`,
  `notification.service.spec.ts`, `activity.service.spec.ts` — unchanged from
  Sprint 27, still passing against the new processor.
- `notifications-independence.spec.ts` — extended to cover the new preference/
  category/constants files under the same structural guards.

## 13. Live Verification

Real tokens, real Postgres, both dev servers hot-reloaded. Sprint 27.1's own
pass (in addition to re-confirming every Sprint 27 scenario still holds):

1. Fresh submit → `process-events` → notification created, correct message.
2. Replay `process-events` → zero new work, zero duplicates.
3. **5 concurrent `process-events` calls** against one fresh event → exactly one
   successful claim (`processed: 2`), four no-ops (`processed: 0`) — zero
   duplicate notifications confirmed via the notification list.
4. A manufactured `FAILED` event (deliberately set via a direct DB script, not a
   naturally-occurring failure — documented honestly) inspected via `GET
/notifications/admin/processing?status=FAILED` by an administrator; a
   non-administrator's identical request returned `403`.
5. Administrator retried it — `PENDING` with an immediate `nextRetryAt`; the next
   `process-events` call reached `PROCESSED` with `attempts: 4` (3 preserved + 1),
   error cleared.
6. A manufactured stale `PROCESSING` row (10-minute-old lease, exceeding the
   5-minute `PROCESSING_LEASE_MS`) was reclaimed and processed by the very next
   ordinary `process-events` call — no separate recovery action needed.
7. Suspended a user mid-session — confirmed exclusion from
   `eligible-approvers` for a live instance.
8. Confirmed the suspended user's 13 pre-existing notifications were untouched
   (`Notification.count` unchanged), then confirmed she regained full access to
   all 13 immediately upon reactivation.
9. Marked one notification read — unread count 4 → 3; re-marking the same one
   read again returned success with no further change.
10. Marked all read — unread count → 0.
11. (9-10 also re-verified in the browser UI, both via the bell dropdown and the
    full `/notifications` page.)
12. Disabled `WORKFLOW_APPROVALS` for a user, submitted a fresh event — her
    unread count stayed unchanged while OTHER eligible recipients still got
    notified, and the underlying `WorkflowEvent`/audit trail remained fully
    intact regardless. Reset her preferences back to defaults afterward.
13. (Same test as 12 — the suppression contract's creation-only semantics.)
14. Cross-tenant: rival-tenant login saw `{ items: [], total: 0 }` and got `404`
    attempting to read a known Boby Bites notification id directly.
15. Cross-user: rival-tenant login attempting to mark a Boby Bites notification
    read returned `404` (never revealing its existence).
16. Non-administrator's `GET/POST .../admin/processing*` returned `403`;
    administrator's succeeded.
17. Desktop-width UI verified for all four notification pages.
18. 375px UI verified for all four pages — found and fixed the admin
    status-filter overflow issue (§11).
19. Re-ran `prisma:seed` after the migration and after all live testing — clean,
    idempotent, and confirmed the two new permissions were auto-granted to
    Administrator.
20. Completed a full two-step approval chain (submit → approve × 2 → `APPROVED`)
    end-to-end, confirming existing Workflow behavior is fully intact under the
    new processor.

Cleanup: cancelled every leftover non-terminal test workflow instance created
during this session; final sweep confirmed 0 non-terminal instances and 0
`FAILED`/`PROCESSING` processing records remain.

## 14. Known Limitations & Deferred Capabilities

- **No real background worker** — processing is triggered on demand (§4.1), not
  a cron/queue. A user who never opens the app, in an organisation where nobody
  else triggers processing either, will have their notifications sit `PENDING`
  until someone does. The claim-based state machine (§4.2) is specifically
  designed so a future scheduled job needs zero change to the processing logic
  itself.
- **No error taxonomy** — every processing failure is treated as retryable up to
  `MAX_PROCESSING_ATTEMPTS` (§4.3); there is no "this will never succeed, fail
  immediately" classification. A simple, documented, honest choice, not an
  oversight.
- **`listEligibleApprovers` remains an O(n) organisation-user scan** (unchanged
  from Sprint 26/27) — recipient resolution for `APPROVAL_REQUIRED`/`EXPIRED`
  inherits this scale ceiling.
- **`ScopeEvaluator`'s own honest scope-checking gap** (workflow.md §6) applies
  identically here, since recipient resolution reuses the same eligibility call.
- **No admin visibility into another user's notification inbox** (only into the
  processing PIPELINE, via `admin/processing`) — diagnosing "why didn't user X
  get notified" for a successfully-`PROCESSED` event still requires reasoning
  about eligibility/preferences directly, not a per-user notification audit view.
- **No digesting/batching/escalation/scheduled reminders** — every eligible,
  preference-enabled recipient gets exactly one notification per event, always,
  the instant processing runs.
- **`WORKFLOW_COMPLETED` has no notification type** (§3.1) — no code path emits
  a `COMPLETED` `WorkflowEvent` today.
- **Preferences have only two categories** — deliberately coarse; a future
  per-type preference system is a documented, additive extension, not a
  redesign.

## 15. Email Delivery (Sprint 28)

Full architecture rationale lives in
[docs/architecture/email-delivery.md](../architecture/email-delivery.md); this
section covers the domain-doc essentials.

### 15.1 `EmailDelivery` — a delivery ATTEMPT, not a second notification intent

One row per (notification, channel) — enforced by
`@@unique([organisationId, notificationId, channel])`, `channel` always `EMAIL`
on this table. Produced by `EmailDeliveryCreationService`, sent by
`EmailDeliveryProcessorService` — two independent services, matching the brief's
"keep responsibilities clearly separated" rule; neither imports the other's
internals, and NEITHER imports `NotificationEventProcessorService` or anything
Workflow-specific.

Fields worth calling out:

- `recipientEmail`/`recipientDisplayName`/`fromEmail`/`fromName` — all
  SNAPSHOTTED at creation from the live `User`/`Organisation` state at that
  instant, never re-read live on retry (§15.4).
- `templateKey` = the `Notification.type` this delivery was rendered for — no
  separate template catalogue exists; see §17.
- `category` — denormalized from the notification for admin filtering.
- `status` — `EmailDeliveryStatus`: `PENDING → PROCESSING → SENT | FAILED`
  (back to `PENDING` on a retryable failure with attempts remaining). `SENT`
  means "the provider accepted it for relay," never "confirmed delivered to an
  inbox" — see email-delivery.md §3 for why that distinction matters.
- `providerName`/`providerMessageId` — which adapter (`local`|`smtp`) handled
  this attempt, and its own message id when one was returned.
- `lastErrorCategory`/`lastError` — bounded (100/2000 chars), never a raw
  provider exception, never credentials.

### 15.2 Email-eligible categories

Only 6 of the 8 `NotificationType` values are ever email-eligible
(`EmailEligibilityService`'s `EMAIL_ELIGIBLE_TYPES` set):

| Notification type            | Email-eligible? | Why                                                                                           |
| ---------------------------- | :-------------: | --------------------------------------------------------------------------------------------- |
| `WORKFLOW_APPROVAL_REQUIRED` |       ✅        | The primary "you need to act" case                                                            |
| `WORKFLOW_APPROVED`          |       ✅        | Final outcome, requester needs to know                                                        |
| `WORKFLOW_STEP_REJECTED`     |       ✅        | Terminal outcome, requester needs to know                                                     |
| `WORKFLOW_RETURNED`          |       ✅        | Requester needs to act (edit + resubmit)                                                      |
| `WORKFLOW_RESUBMITTED`       |       ✅        | Prior approver/returner needs to know                                                         |
| `WORKFLOW_EXPIRED`           |       ✅        | Terminal outcome, nobody decided in time                                                      |
| `WORKFLOW_STEP_APPROVED`     |       ❌        | Mid-chain FYI, almost always followed immediately by another email-eligible event for someone |
| `WORKFLOW_CANCELLED`         |       ❌        | Self-initiated/administrative; the actor already knows                                        |

### 15.3 Preference contract — "Category → Channel → Enabled"

`NotificationPreference` gained an `emailEnabled` column alongside the existing
`inAppEnabled` (Sprint 27.1) — same row, same `(organisationId, userId,
category)` key, not a second table. **Deliberately asymmetric default**:
`inAppEnabled` defaults `true` (absent row = enabled), `emailEnabled` defaults
`false` (absent row = disabled) — "email is disabled unless explicitly
enabled." A delivery is only ever created when BOTH the organisation-level gate
(§15.5) AND this per-user, per-category preference are true — an AND, not an
OR.

Suppression semantics, matching Sprint 27.1's own precedent exactly: a disabled
preference only prevents `EmailDelivery` row CREATION. It never touches
`WorkflowEvent`, `Notification`, audit, or the Activity Centre — all of those
stay complete regardless of anyone's email preference. Auditability is never
gated by delivery preference.

### 15.4 Recipient address snapshot & user-status-change behaviour

`recipientEmail` is frozen at `EmailDelivery` creation time. Documented,
live-verified behaviour:

| Scenario                                              | Behaviour                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User changes their email AFTER a delivery was created | The existing delivery (and any of its retries) keeps targeting the OLD, snapshotted address — a retry is "send THIS email again," never "recompute the recipient." Live-verified (§19).                                                                                                       |
| User suspended BEFORE the notification is processed   | Never resolved as a recipient at all (`EmailEligibilityService` checks live `User.status`) — excluded upstream, same as the in-app resolver. Live-verified.                                                                                                                                   |
| User suspended AFTER a delivery was already created   | The existing delivery is untouched (not deleted, not blocked from sending if already `SENT`) — suspension only affects FUTURE eligibility evaluation.                                                                                                                                         |
| User reactivated                                      | Immediately eligible again for any notification not yet evaluated; does NOT retroactively create a delivery for a notification already evaluated-and-found-ineligible while they were suspended (that notification simply re-enters the "pending evaluation" set — see §15.6's ordering fix). |
| Historical delivery after any of the above            | Always remains visible in the admin UI — never deleted, no retention policy exists yet (matches `Notification`'s own "retained indefinitely" stance).                                                                                                                                         |

### 15.5 Organisation configuration

`Organisation.settings.emailDelivery: { enabled, senderName, senderEmail }` —
the SAME deep-merged JSON bucket `WorkspaceSettings` already used for
theme/preferences (Sprint 3.4 convention), read/written through the EXISTING
`GET/PATCH /settings/workspace` route and `identity.organisation.manage`
permission — no new controller, no new permission for configuration itself.
Defaults `{ enabled: false, senderName: null, senderEmail: null }` — "no
organisation gets email without explicitly turning it on."

**Deliberately distinct from `preferences.emailNotifications`** (a Sprint
3.4-era toggle that predates Notifications entirely). Verified by inspection
before this sprint: nothing in this codebase reads `preferences.
emailNotifications` — it is a dormant, generic UI toggle with zero backend
enforcement. Repurposing it for Sprint 28's very different, specific meaning
risked silently changing behaviour for any organisation that had already
touched it; `emailDelivery` is new and unambiguous instead.

Sender resolution order (`EmailEligibilityService.evaluate`): organisation
`senderEmail`/`senderName` if both set, else the environment's
`MAIL_FROM_EMAIL`/`MAIL_FROM_NAME`. If NEITHER resolves, the notification is
ineligible (`"No sender email/name configured"`) — never sent from a blank or
fabricated address.

### 15.6 Delivery creation — scan ordering (a bug found and fixed live this sprint)

`EmailDeliveryCreationService.createPendingDeliveries` scans `Notification`
rows with no `EmailDelivery` row yet
(`{ emailDeliveries: { none: {} } }`), bounded by `limit` (default 50).

**Found live during this sprint's own verification**: the first implementation
ordered this scan oldest-first (`createdAt: 'asc'`), matching every other
sweep in this domain. Since an INELIGIBLE notification never gets an
`EmailDelivery` row (there's nothing to create), it stays in the "pending
evaluation" set forever and is RE-SCANNED on every sweep. With oldest-first
ordering, a backlog of old ineligible notifications permanently occupied the
entire `limit` window, starving genuinely eligible NEW notifications from ever
being reached — reproduced live (a freshly submitted, fully-eligible
notification silently never got emailed behind ~50 old ineligible ones from
earlier testing).

**Fixed**: the scan is now newest-first (`createdAt: 'desc'`). A live system's
actionable backlog is always reachable regardless of how large the
permanently-ineligible tail grows underneath it; those old rows simply never
matter again rather than actively blocking anything. Re-verified live
post-fix: the previously-starved notification was immediately picked up and
sent on the very next sweep.

## 16. Email Processing Reliability

Deliberately a SEPARATE state machine and constants file from the in-app
processor (`email-delivery-processing.constants.ts`, not `notification-
processing.constants.ts`) — per the brief's own "do not reuse the in-app
retry policy blindly if email provider behaviour differs" instruction.

- **States**: `PENDING → PROCESSING (claimed) → SENT | FAILED` (or back to
  `PENDING` with a scheduled `nextRetryAt` on a retryable failure).
- **Claiming**: a per-row conditional `updateMany`
  (`EmailDeliveryRepository.claimBatch`) — the same idiom every other
  processor in this codebase uses, no new lock primitive, no Redis.
- **Retry policy**: `MAX_EMAIL_ATTEMPTS = 3`, backoff `[0, 2min, 10min]` —
  longer than the in-app processor's `[0, 1min, 5min]` since SMTP transient
  failures (rate limits, greylisting) typically need more time to clear than
  an in-process DB hiccup. Every failure is currently treated as retryable
  UNLESS the provider explicitly classifies it terminal (§17) or attempts are
  exhausted — a real distinction the in-app processor doesn't have, since
  provider outcomes carry more signal than a generic exception.
- **Stale-lease recovery**: `EMAIL_PROCESSING_LEASE_MS = 10 minutes` (longer
  than the in-app processor's 5, since a real SMTP round-trip is slower than
  a handful of DB queries) — a `PROCESSING` row whose lease is older is
  reclaimed by the very next ordinary sweep, no separate recovery job.
- **Manual retry**: `POST /notifications/admin/email-deliveries/:id/retry` —
  eligible from `FAILED` or a stuck `PROCESSING` row, bypasses backoff, does
  NOT reset `attempts` (full history preserved).
- **Ambiguous provider outcomes** (§8.3 of the brief): the provider call
  happens OUTSIDE any database transaction (an SMTP round-trip cannot be part
  of one). A crash between the provider accepting a message and this process
  persisting `SENT` would cause the next sweep's stale-lease reclaim to send
  it AGAIN — honest at-least-once delivery, never claimed as exactly-once.
  `providerMessageId` + the `EmailDelivery.id` (passed as the provider
  message's `correlationId`) exist specifically so a human can spot a
  duplicate in the provider's own dashboard after the fact; neither adapter
  implemented this sprint gives this codebase real provider-side idempotency.

All of the above — successful send, retryable failure with backoff,
terminal failure (immediate, regardless of attempt count), max-attempts →
`FAILED`, stale-`PROCESSING` reclaim, and manual retry preserving attempt
history — were live-verified this sprint (§19), including one case that
proved THREE things in a single sequence: manual retry preserves attempt
history, the recipient-address snapshot survives a live email change, and
attempts-exhausted correctly short-circuits to terminal `FAILED` even on a
manually-triggered retry.

## 17. Provider Abstraction

`apps/api/src/notifications/ports/email-provider.port.ts` — mirrors the
established `FileStorage` port pattern (Sprint 3.4) exactly: an `EmailProvider`
interface + `EMAIL_PROVIDER` DI token, selected once at boot by
`email-provider.module.ts` based on `EMAIL_PROVIDER_MODE` (`local` | `smtp`,
default `local`). Nothing downstream of the token knows or cares which
concrete adapter it's talking to.

- **`LocalEmailProvider`** (`infrastructure/local-email-provider.ts`) — the
  default. Never sends real email; records every message in memory for
  assertions; deterministic. Failure simulation via plus-addressing on the
  recipient (no extra config surface): `...+failretryable@...` →
  `RETRYABLE_FAILURE`, `...+failterminal@...` → `TERMINAL_FAILURE`, anything
  else → `ACCEPTED`.
- **`SmtpEmailProvider`** (`infrastructure/smtp-email-provider.ts`) — real
  `nodemailer`-based SMTP, compatible with any standards-conforming relay
  (ZeptoMail's SMTP endpoint specifically, but nothing ZeptoMail-proprietary
  is used). Maps SMTP/`nodemailer` errors: `EAUTH` → terminal, connection
  errors (`ECONNECTION`/`ECONNREFUSED`/`ETIMEDOUT`/`ESOCKET`/`EDNS`) →
  retryable, SMTP response code ≥500 → terminal, ≥400 → retryable,
  `EENVELOPE`/`EMESSAGE` → terminal, anything unrecognized → retryable
  (default-safe). Never logs or returns `SMTP_PASS`/`ZEPTOMAIL_API_KEY`;
  every error surfaced is a short, hand-built string (category + SMTP
  response code + command name only), never the raw exception.
- **Fail loud, never silently downgrade**: `EMAIL_PROVIDER_MODE=smtp` with any
  required SMTP field missing/empty throws `SmtpConfigurationError` at
  CONSTRUCTION time (app boot), listing which non-secret field names are
  missing — never falls back to the local provider while reporting success.
- **`ZEPTOMAIL_API_KEY` is deliberately unread** by the SMTP adapter —
  reserved for a possible future ZeptoMail REST API adapter; the SMTP
  transport authenticates with `SMTP_USER`/`SMTP_PASS` only. Documented in
  `env.validation.ts`'s own comment so this isn't mistaken for an oversight.

## 18. Configuration Reference

All new environment variables (`apps/api/.env.example`, `env.validation.ts`) —
every SMTP field is `.optional()` so an existing environment boots unchanged:

| Variable              | Required when                                                    | Notes                                                                                                                                         |
| --------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `EMAIL_PROVIDER_MODE` | Never (defaults `local`)                                         | `local` \| `smtp`                                                                                                                             |
| `WEB_PUBLIC_URL`      | Never (defaults to localhost)                                    | Frontend origin, used to build absolute links in email bodies                                                                                 |
| `SMTP_HOST`           | `EMAIL_PROVIDER_MODE=smtp`                                       |                                                                                                                                               |
| `SMTP_PORT`           | `EMAIL_PROVIDER_MODE=smtp`                                       |                                                                                                                                               |
| `SMTP_SECURE`         | `EMAIL_PROVIDER_MODE=smtp`                                       | Literal `"true"`/`"false"` string, not `z.coerce.boolean()` (which would treat any non-empty string, including the text `"false"`, as `true`) |
| `SMTP_USER`           | `EMAIL_PROVIDER_MODE=smtp`                                       |                                                                                                                                               |
| `SMTP_PASS`           | `EMAIL_PROVIDER_MODE=smtp`                                       | Never logged, never returned by any API response                                                                                              |
| `ZEPTOMAIL_API_KEY`   | Never                                                            | Reserved, unread by the SMTP adapter (§17)                                                                                                    |
| `MAIL_FROM_NAME`      | `EMAIL_PROVIDER_MODE=smtp` (or as the org-level sender fallback) |                                                                                                                                               |
| `MAIL_FROM_EMAIL`     | Same as above                                                    |                                                                                                                                               |

## 19. Live Verification (Sprint 28)

Performed against the real local PostgreSQL database and real authenticated
tokens (Boby Bites tenant: Ibrahim as requester, Grace as approver, Admin for
org configuration and operational admin routes; the pre-existing rival-tenant
fixture for cross-tenant checks):

1. Enabled organisation transactional email (`PATCH /settings/workspace`) and
   Grace's per-category email preference — confirmed both persisted with the
   correct asymmetric defaults.
2. Submitted a real Purchase Order end-to-end → confirmed one `EmailDelivery`
   row created and `SENT` via the local provider, with the correct recipient,
   subject, rendered body, and deterministic `providerMessageId`.
3. Replayed processing repeatedly — confirmed zero duplicate delivery rows
   (verified both via the API and a direct SQL `GROUP BY notificationId
HAVING COUNT(*) > 1` returning zero rows).
4. Fired 5 concurrent `process-events` requests immediately after a fresh
   submission — exactly one call created the in-app notification (the other 4
   correctly no-opped on the claim), zero duplicate `EmailDelivery` rows
   resulted.
5. Simulated a retryable failure (`+failretryable@`) — confirmed `PENDING`
   with a scheduled `nextRetryAt` (+2 min), then a later automatic retry
   correctly failed again with backoff `+10 min` (attempt 2→3).
6. Fast-forwarded `nextRetryAt` to force the 3rd attempt — confirmed terminal
   `FAILED` at exactly `MAX_EMAIL_ATTEMPTS = 3`.
7. **Manual retry** on that `FAILED` row, AFTER separately reverting the
   recipient's live email back to normal — confirmed in one sequence: (a)
   `attempts` preserved at 3 going into the retry, not reset; (b) the retry
   still targeted the OLD, snapshotted `+failretryable@` address, proving
   recipient-snapshot immutability under a live email change; (c) the retry
   correctly went straight to terminal `FAILED` again (attempts now 4 ≥ max),
   never silently succeeding.
8. Simulated a terminal failure (`+failterminal@`) — confirmed `FAILED`
   immediately on the FIRST attempt (`attempts: 1`), never waiting for 3
   tries, proving terminal outcomes short-circuit the retry loop.
9. Manufactured a stale `PROCESSING` row (lease backdated 20 minutes) —
   confirmed the next ordinary sweep reclaimed it (`attempts` incremented,
   `lastAttemptedAt` updated) with zero duplicate delivery rows.
10. Deactivated Grace (`status: INACTIVE`), submitted a fresh PO — confirmed
    zero `EmailDelivery` rows created for her (excluded upstream at
    recipient-resolution time, same as the in-app resolver); reactivated her
    and confirmed no unexpected duplicate delivery was created retroactively.
11. Cross-tenant: the rival-tenant fixture's admin email-deliveries list
    returned `total: 0`, and a direct request for a real Boby Bites delivery
    ID returned `404` (no existence leak).
12. Authorization: a non-administrator (Ibrahim) received `403` on both
    `GET /notifications/admin/email-deliveries` and the retry endpoint;
    Grace attempting to mark IBRAHIM's own notification read received `404`
    (cross-user isolation, no existence leak).
13. Confirmed the underlying `WorkflowInstance` (`IN_PROGRESS`, correct step
    active) and in-app `Notification` rows were completely unaffected by
    every one of the above email failures/successes — email is a pure,
    non-blocking downstream concern, proven live, not just by construction.
14. **Found and fixed live** the scan-ordering starvation bug (§15.6).
15. **Real ZeptoMail SMTP** — see §20 below; this used the actual environment
    SMTP configuration, not the local provider, and is reported separately
    per the brief's own required distinction between automated/local-provider
    tests and the real-provider live test.
16. Frontend: the notification preferences page (In-app/Email columns), the
    new Admin: Email Deliveries page (all 4 status filters, retry action,
    provider message id display), and the organisation settings
    "Transactional Email" card (enable toggle + sender name/email fields) were
    all verified rendering and functioning correctly at both desktop width
    and 375px mobile width.
17. Cleanup: reverted the test recipient's email back to normal, reverted
    `EMAIL_PROVIDER_MODE` back to `local` (the safe default) and restarted
    the API in that mode, cancelled every leftover non-terminal test workflow
    instance. Final sweep: 0 non-terminal workflow instances, 0
    `PROCESSING` email deliveries; 3 `FAILED` deliveries were deliberately
    left in place as inspectable, documented examples (the two local-provider
    simulated failures and the one real SMTP rejection below) rather than
    deleted — consistent with this domain's "nothing deletes rows" convention.

### 19.1 Real ZeptoMail SMTP verification (distinct from the automated/local-provider tests above)

Performed twice, on two different `MAIL_FROM_EMAIL` values — the second attempt
followed the user's own guidance that the ZeptoMail account is an already-active
production account for a different project, with `mindcraftlearn.online` as its
verified sending domain.

**Constant across both attempts**: provider mode `smtp` (temporarily; reverted
to `local` after each test); SMTP configuration detected (values never printed)
— host, port, secure mode (`false`), username, password, mail-from name,
mail-from email all present, confirmed indirectly via `SmtpEmailProvider`
constructing successfully (it throws `SmtpConfigurationError` at boot if any
required field is missing) and logging only
`"SMTP email provider configured (host configured: yes, port configured: yes, secure: false)."`;
test tenant Boby Bites; test category `WORKFLOW_APPROVAL_REQUIRED` from a real
Purchase Order submission through the actual pipeline (no bypass/test-only
endpoint exists); test recipient `ajayijohnson68@gmail.com`, set via a
temporary, direct database update to an existing seeded user's `email` column
for the duration of each test only (this codebase's Identity domain makes
`email` immutable through every application-level endpoint, by design — this
was a controlled, reverted test fixture, never reachable by any real user
action), reverted immediately after each test; no secret value was ever
printed, logged, returned in an API response, or written into any file,
screenshot, or report at any point.

**Attempt 1** — `MAIL_FROM_EMAIL=no-reply@zentuva.com` (`MAIL_FROM_NAME=Zentuva`):

- Delivery record id: `cmu70c09z000nt1iask0s7jdh`.
- Provider result: REJECTED — SMTP response code `553` during the `DATA` phase
  (i.e., AFTER a successful connection and successful `AUTH LOGIN`, ruling out
  a credentials problem). Classified `TERMINAL_FAILURE`.
- Final status: `FAILED` (confirmed across the original send and one
  deliberate manual retry — identical `553` rejection both times).
- Diagnosis at the time: a `553` at `DATA`, after successful auth, is most
  consistent with the sending domain/address not being verified/authorized for
  outbound sending on this ZeptoMail account — an account-configuration
  matter, not a defect in this codebase's SMTP integration.

**Attempt 2** — `MAIL_FROM_EMAIL=no-reply@mindcraftlearn.online`
(`MAIL_FROM_NAME=Mindcraft Learn`), at the user's explicit direction, using the
real production ZeptoMail account's own already-verified sending domain:

- Delivery record id: `cmu73txmy000nvttl92v3lj66`.
- Provider result: **ACCEPTED** — `providerMessageId:
<ab0c37c7-bf67-da95-5ebb-026b5d823e76@mindcraftlearn.online>`.
- Final persisted status: `SENT`, `sentAt: 2026-09-18T15:19:47.178Z`.
- This confirms attempt 1's diagnosis was correct: the SMTP transport,
  credentials, and this codebase's provider integration were never the
  problem — only the specific sending domain was unverified on the account.

**Inbox receipt**: NOT independently confirmed either way — this session has
no access to the recipient's Gmail inbox. Attempt 2's result is accurately
reported as _"real email accepted by SMTP provider, but inbox receipt not
independently confirmed,"_ never as confirmed delivery/receipt.

**Honest summary per the brief's required disclosure**: _Real email accepted
by the SMTP provider (ZeptoMail) on the second attempt, using a sending domain
already verified on the user's own production ZeptoMail account; inbox
receipt was not independently confirmed._ The first attempt's failure was a
real, informative result in its own right — correctly classified terminal,
safely surfaced with no secrets exposed, and correctly diagnosed before being
confirmed by the successful second attempt.
