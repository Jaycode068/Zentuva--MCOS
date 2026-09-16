# Notifications & Activity Centre Domain

Sprint 27 — Notifications & Activity Centre Foundation. Builds the first reusable
in-app notification system on top of Sprint 26.1's `WorkflowEvent` table, without
touching Workflow's own code (other than exporting two already-existing services and
adding processing-state columns to `WorkflowEvent` itself). **Sprint 27.1 —
Notification Reliability, Preferences & Activity Consolidation** hardens that
foundation: an explicit, concurrency-safe processing state machine with bounded
retry and stale-lease recovery, a documented recipient contract, a tenant-scoped
preference system, and an operational admin surface for inspecting/retrying failed
processing — all without redesigning anything Sprint 27 got right.

## 1. Domain Purpose

Answers "what requires MY attention right now" (a `Notification`, recipient-scoped)
and, separately, "what happened" (an `ActivityRecord`, organisation-scoped) — two
related but deliberately distinct questions, never conflated (§10). See
[docs/architecture/notification-activity-boundaries.md](../architecture/notification-activity-boundaries.md)
for the full architectural decision record on how these relate to `WorkflowEvent`
and `AuditLog` too.

Delivers exactly one delivery channel: `IN_APP`. Email, SMS, push, WhatsApp,
webhooks, digests, scheduled reminders, and automatic escalation are all explicitly
out of scope — the data model and processing architecture are built so adding a
channel later means adding a `NotificationChannel` enum value and a new delivery
path, never redesigning how events become notifications.

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
