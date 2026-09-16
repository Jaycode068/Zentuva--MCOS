# Notifications & Activity Centre Domain

Sprint 27 — Notifications & Activity Centre Foundation. Builds the first reusable
in-app notification system on top of Sprint 26.1's `WorkflowEvent` table, without
touching Workflow's own code (other than exporting two already-existing services and
adding processing-state columns to `WorkflowEvent` itself).

## 1. Domain Purpose

Answers "what requires MY attention right now" (a `Notification`, recipient-scoped)
and, separately, "what happened" (an `ActivityRecord`, organisation-scoped) — two
related but deliberately distinct questions, never conflated (§10).

Sprint 27 delivers exactly one delivery channel: `IN_APP`. Email, SMS, push,
WhatsApp, webhooks, digests, scheduled reminders, and automatic escalation are all
explicitly out of scope — the data model and processing architecture are built so
adding a channel later means adding a `NotificationChannel` enum value and a new
delivery path, never redesigning how events become notifications.

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
  `sourceId` into a URL itself.
- `type`: `NotificationType` enum, `WORKFLOW_APPROVAL_REQUIRED` /
  `WORKFLOW_STEP_APPROVED` / `WORKFLOW_APPROVED` / `WORKFLOW_STEP_REJECTED` /
  `WORKFLOW_RETURNED` / `WORKFLOW_RESUBMITTED` / `WORKFLOW_CANCELLED` /
  `WORKFLOW_EXPIRED` — one value per `WorkflowEvent` type that this sprint's
  recipient rules actually produce a notification for (§3.1 "Excluded event types").
- `status`: `UNREAD` → `READ` only. No separate delivery-status machine — there is
  nothing to "deliver" for an `IN_APP`-only channel beyond the row existing.
- `channel`: `NotificationChannel` enum, `IN_APP` only today — the enum exists
  specifically so `EMAIL`/`SMS`/`PUSH`/`WEBHOOK` can be added as new values later
  with no migration for existing rows.

**Unique constraint** (the idempotency invariant, §5):
`@@unique([organisationId, sourceEventId, recipientUserId, channel])`.

### `WorkflowEvent` additions (Sprint 26.1's table, extended)

```
notificationProcessedAt, notificationAttempts, notificationLastAttemptAt,
notificationLastError
```

Processing-state columns added directly to the existing event table — see §4
"Option B, not a new outbox table."

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
  `PurchaseOrderWorkflowHandler`) ever calls it (workflow.md §4, §8) — verified by
  inspection before writing this sprint's recipient resolver. A notification type
  for an event that can never fire would violate the brief's own "do not create
  notification types for unsupported events."

If a future sprint wires up `markCompleted` for a real integration, adding
`WORKFLOW_COMPLETED` is a small, additive change to `NotificationRecipientResolver`
and `NotificationMessageBuilder` — no schema redesign.

## 4. Event-Consumption Architecture

```
WorkflowInstanceService (unchanged)
        │  writes, inside its own transaction
        ▼
WorkflowEvent  (organisation-scoped, durable, workflow.md §7)
        │  read directly via Prisma — NEVER via WorkflowInstanceService
        ▼
NotificationEventProcessorService.processPendingEvents(organisationId)
        │  per event, in one transaction:
        ├─ NotificationRecipientResolver.resolve(...)   → who
        ├─ NotificationMessageBuilder.build(...)         → what
        └─ Notification.createMany({ skipDuplicates })   → durable rows
        │  + WorkflowEvent.notificationProcessedAt = now()
        ▼
Notification  (recipient-scoped, durable)
```

**Chosen architecture: Option B, "event consumer with processing state,"
implemented as processing-state columns added directly to the existing
`WorkflowEvent` table** — not a separate outbox table, not Option A (transactional
creation inside `WorkflowInstanceService` itself, which would couple Workflow to
Notifications and violate "do not make Workflow controllers directly create
user-facing notifications"), not a full outbox/saga system (out of scope: "do not
introduce unnecessary infrastructure solely for this sprint"). `WorkflowEvent`
already IS the durable, transactionally-written record Sprint 26.1 built for
exactly this consumption purpose (workflow.md §7: "the durable, queryable record
that consumer will read from") — adding four nullable columns to it is a smaller,
more honest design than standing up a second table that would duplicate most of
its columns.

**The boundary is the TABLE, not a service call.** `NotificationEventProcessorService`
reads `WorkflowEvent`/`WorkflowInstance`/`WorkflowStepInstance` directly via the
globally-registered `PrismaService` — it never imports or calls
`WorkflowInstanceService`, `WorkflowInstanceRepository`, or
`WorkflowDefinitionRepository`. It DOES import (via `WorkflowModule`'s now-exported
providers) `WorkflowEligibilityService` and `WorkflowDefinitionService` — both
pure, read-only, side-effect-free — because recipient resolution must ask the exact
same "is this user eligible" question Workflow itself asks (§6); reimplementing
that logic locally would be the actual violation of "don't embed workflow business
logic elsewhere." This is verified executably by
`notifications-independence.spec.ts` (mirroring `workflow-independence.spec.ts`'s
own precedent), which asserts:

- No Notifications file _imports_ `WorkflowInstanceService`/
  `WorkflowInstanceRepository`/`WorkflowDefinitionRepository`.
- No Notifications file writes to any `workflow_*` table other than
  `WorkflowEvent`'s own processing-state columns.
- `NotificationsModule` imports only `IdentityModule`/`AuthModule`/`WorkflowModule`.
- `WorkflowModule` never imports `NotificationsModule` — the dependency is strictly
  one-directional, the same pattern as `WorkflowModule → PurchaseOrderModule`
  (workflow.md §7) just pointed the other way (a downstream consumer importing the
  producer, read-only).

### 4.1 Processing trigger — no queue/cron infrastructure exists yet

Inspected before writing any code: **no BullMQ, no `@nestjs/schedule`, no
Redis-backed job system, no domain-event dispatcher, no outbox worker exists
anywhere in this codebase.** Per the brief's own explicit allowance ("implement a
safe service-level processing mechanism and document how it will later be
scheduled"), `processPendingEvents` is exposed via `POST
/notifications/process-events` and triggered from the frontend:

1. **The notification bell polls it** every 20 seconds (`NotificationBell.tsx`,
   `POLL_INTERVAL_MS`), alongside refreshing the unread count and recent list —
   this is the fallback that also covers notifications produced by OTHER users'
   actions in the same organisation.
2. **Workflow-mutating pages call it directly** right after a mutation succeeds
   (`approve`/`reject`/`return`/`cancel`/`resubmit` in `my-approvals/page.tsx` and
   `instances/[id]/page.tsx`; the Procurement submit/resubmit-for-approval buttons)
   — fire-and-forget, errors swallowed (`.catch(() => undefined)`), so a
   notification-processing hiccup can never surface as if the workflow action
   itself failed (§9's atomicity guarantee, and the sprint's explicit invariant
   "notification failure must not corrupt or roll back an already-valid workflow
   transition").

**Future swap to a real scheduled job requires zero change to
`NotificationEventProcessorService.processPendingEvents` itself** — only what
calls it changes (a cron tick instead of an HTTP request), because the method's
own contract (tenant-scoped, idempotent, safe to call repeatedly, safe to call
concurrently) already IS what a scheduled job needs.

`POST /notifications/process-events` requires only `JwtAuthGuard` (any
authenticated, active user may trigger "catch up on pending processing for MY
organisation") — this creates no privilege escalation because the caller never
chooses recipients or content; both are derived entirely server-side from the same
eligibility rules Workflow itself enforces (§12).

## 5. Idempotency & Concurrency

**The database-level unique index is the actual guarantee — not an
application-level pre-check.** `NotificationEventProcessorService` never queries
"does this notification already exist" before inserting; it always attempts
`Notification.createMany({ data: rows, skipDuplicates: true })` against
`@@unique([organisationId, sourceEventId, recipientUserId, channel])`, and lets
Postgres silently skip any row that would violate it.

Guarantees this produces:

- **Processing the same event twice** → the second `createMany` call's rows all
  collide with the unique index (`skipDuplicates: true` makes them silent no-ops,
  `WorkflowEvent.notificationProcessedAt` is already set so it's never re-selected
  anyway) → exactly one notification per recipient/channel, always.
- **Two concurrent consumers processing the same event** → both attempt the same
  `createMany`; Postgres's own unique-index enforcement means only one set of rows
  actually lands, regardless of timing — no `SELECT-then-INSERT` race window
  exists because there is no `SELECT` in the critical path at all.
- **Retry after a transaction failure** → the whole event's transaction (recipient
  notification rows + `notificationProcessedAt` stamp) rolled back together, so a
  retry starts clean and re-attempts the identical insert, safely deduplicated by
  the same index if any partial state had somehow escaped.
- **A notification cannot be duplicated because the consumer restarted** — there is
  no per-consumer state (no "which consumer is processing what"); every
  invocation independently re-queries `WHERE notificationProcessedAt IS NULL` and
  the unique index is the only thing that matters for correctness, not which
  process happened to run.

**Per-event atomicity** (`NotificationEventProcessorService.processOne`): every
recipient's `Notification` row AND the source event's own
`notificationProcessedAt` stamp commit inside one `$transaction`, or neither does.
An event is never marked processed if notification creation failed for a
non-duplicate reason (a real DB error) — the brief's own invariant, verified by
`notification-event-processor.service.spec.ts`'s "does NOT mark the event
processed when notification creation fails" test. One event's failure — the
attempt count and last-error are recorded on that `WorkflowEvent` row
(`notificationAttempts`, `notificationLastAttemptAt`, `notificationLastError`,
cleared back to `null` on the attempt that finally succeeds) — never blocks
processing of another event in the same batch (the processor's loop continues; a
`processPendingEvents` call's own return value — `{ processed, failed,
notificationsCreated }` — makes any failures visible to whatever called it, never
silently swallowed).

## 6. Recipient Resolution

`NotificationRecipientResolver.resolve(event, instance, stepInstances)` — one
branch per `WorkflowEvent.eventType`, always returning a plain `string[]` of
`User.id`s, never "every organisation user." Every branch that needs "who is
eligible to act on step N" delegates to
`WorkflowEligibilityService.listEligibleApprovers` (unchanged from Sprint 26) —
the SAME self-approval check, explicit-assignee check, active-user check, and
permission/scope check (via `EffectiveAccessResolver`/`ScopeEvaluator`) that gates
whether a real `POST /workflows/instances/:id/approve` call would actually
succeed. A user who could not actually approve a step is never notified that they
can.

## 7. Event → Notification Mapping

| Workflow event               | Notification type                | Recipients                                                            | Navigation target |
| ---------------------------- | -------------------------------- | --------------------------------------------------------------------- | ----------------- |
| `SUBMITTED`                  | _(none — see §3.1)_              | —                                                                     | —                 |
| `APPROVAL_REQUIRED`          | `WORKFLOW_APPROVAL_REQUIRED`     | Users eligible for the newly-active step (`listEligibleApprovers`)    | Instance detail   |
| `STEP_APPROVED` (mid-chain)  | `WORKFLOW_STEP_APPROVED`         | The requester                                                         | Instance detail   |
| `STEP_APPROVED` (final step) | _(none — `APPROVED` covers it)_  | —                                                                     | —                 |
| `APPROVED`                   | `WORKFLOW_APPROVED`              | The requester                                                         | Instance detail   |
| `REJECTED`                   | `WORKFLOW_STEP_REJECTED`         | The requester                                                         | Instance detail   |
| `RETURNED`                   | `WORKFLOW_RETURNED`              | The requester                                                         | Instance detail   |
| `RESUBMITTED`                | `WORKFLOW_RESUBMITTED`           | Whoever RETURNED the previous instance                                | Instance detail   |
| `CANCELLED`                  | `WORKFLOW_CANCELLED`             | The requester (skipped if the requester cancelled their own instance) | Instance detail   |
| `EXPIRED`                    | `WORKFLOW_EXPIRED`               | The requester + eligible approvers of the still-active step           | Instance detail   |
| `COMPLETED`                  | _(none — see §3.1, unreachable)_ | —                                                                     | —                 |

A deliberate de-duplication: `STEP_APPROVED` on the LAST step produces zero
recipients (not a duplicate `WORKFLOW_STEP_APPROVED` alongside the separate
`WORKFLOW_APPROVED`) — `NotificationRecipientResolver` checks whether a step with
`sequence + 1` exists among the instance's snapshot before returning the
requester as a recipient. Verified live (§15): approving the final step of a
2-step definition produced exactly one requester-facing notification
(`WORKFLOW_APPROVED`), not two.

## 8. Message Construction

`NotificationMessageBuilder.build(event, instance, step)` — the ONLY place
notification text is written; `NotificationEventProcessorService` never inlines a
title/body itself. Deterministic (verified by a dedicated test: the same
event/instance/step produces the same message on every call), safe against
missing optional metadata (no step name, no resolvable subject reference —
falls back to `#{last 8 chars of subjectId}`), produces plain text only (never
HTML of its own construction — the frontend renders `title`/`body` as ordinary
text nodes, never `dangerouslySetInnerHTML`, so even a user-authored comment
containing `<script>` tags is inert). `humanizeSubjectType`/`describeSubject`
(`subject-label.util.ts`) are shared with `ActivityService` (§10) so the two
surfaces never drift on how a subject reads — `PURCHASE_ORDER` → `Purchase Order`
generically (string transform, not a per-domain lookup table), and the subject's
human-readable code (e.g. `PO-000018`) via the same `WorkflowSubjectHandler.
describe()` the admin UI already uses.

Comments from `reject`/`return` (mandatory server-side since Sprint 26.1) are read
from `WorkflowEvent.summary.comment` and included verbatim in the message body —
e.g. `Your Purchase Order PO-000018 was returned for correction: "Please
double-check the unit price with the supplier"` (verified live, §15).

## 9. Notification Lifecycle

`UNREAD` (default on create) → `READ` (via `POST /notifications/:id/read`, or
`POST /notifications/mark-all-read`) → `UNREAD` again (via `POST
/notifications/:id/unread`) — a simple two-state toggle, not a one-way
transition; unlike a `WorkflowInstance`, "read" is not historically load-bearing
the way an approval decision is, so allowing it to be reversed costs nothing and
matches ordinary notification-inbox UX expectations.

Every transition is idempotent at the repository level
(`NotificationRepository.markRead`/`markUnread` use a conditional `updateMany`
requiring the CURRENT status, matching this codebase's established concurrency
idiom — Workflow's own `decideStep`/`setInstanceStatus`) — marking an
already-`READ` notification read again is a harmless no-op (`count === 0`), never
a second `readAt` write, never an error.

## 10. Activity Centre

Composed **live** from `WorkflowEvent` rows — no new table
(`ActivityService.list`, `apps/api/src/notifications/activity.service.ts`).
Organisation-wide (unlike `Notification`, which is always recipient-scoped), so it
answers "what happened" for anyone with visibility, not "what's waiting on me."
`WorkflowEvent`'s activity-relevant columns (`eventType`/`actorUserId`/
`subjectType`/`subjectId`/`summary`/`occurredAt`) are write-once by application
code (only the `notification*` processing columns are ever updated after
creation) — satisfying "activity records should be immutable where they represent
historical facts" without a second table needing its own immutability discipline.

Each `ActivityRecord` resolves the actor's display name (`UserService.getById`)
and a human-readable subject reference (`describeSubject`, shared with §8) at read
time, and composes a plain-English `summary` string (e.g. `"Purchase Order
PO-000018: step_approved (by Grace Effiong)"`). `GET /notifications/activity`
supports `subjectType`/`subjectId` filtering for a per-record activity feed (e.g.
a future "Activity" tab on the Purchase Order detail page — not built this sprint)
alongside the unfiltered organisation-wide feed.

**Gated by the existing `workflow.audit.view` permission** (already gates `GET
/workflows/instances/:id/history`) — not `JwtAuthGuard` alone like every other
route on `NotificationsController` — because, unlike a user's own notifications,
this exposes OTHER users' actions organisation-wide. No new permission-catalogue
entry (§12).

## 11. API Reference

All routes `@Controller('notifications')`, `@UseGuards(JwtAuthGuard)` at the
controller level (self-scoped by default); `activity` additionally requires
`workflow.audit.view` (§10).

| Method | Path                            | Auth                  | Behavior                                                                                                                                   |
| ------ | ------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET`  | `/notifications`                | Self                  | Paginated (`page`/`pageSize` via the shared `paginationSchema`), filterable by `status`/`type`, newest-first, recipient- and tenant-scoped |
| `GET`  | `/notifications/activity`       | `workflow.audit.view` | Organisation-wide activity feed composed from `WorkflowEvent`, paginated, optional `subjectType`/`subjectId` filter                        |
| `GET`  | `/notifications/unread-count`   | Self                  | `{ count }` for the caller's own org+recipient                                                                                             |
| `GET`  | `/notifications/:id`            | Self                  | 404 (not 403) for another user's or tenant's notification — never leaks existence                                                          |
| `POST` | `/notifications/process-events` | Self                  | Triggers `processPendingEvents` for the caller's own organisation (§4.1)                                                                   |
| `POST` | `/notifications/mark-all-read`  | Self                  | Only the caller's own unread rows; returns the count actually flipped                                                                      |
| `POST` | `/notifications/:id/read`       | Self                  | Idempotent; 404 if not the caller's own                                                                                                    |
| `POST` | `/notifications/:id/unread`     | Self                  | Idempotent; 404 if not the caller's own                                                                                                    |

Route declaration order matters in NestJS (`activity`/`unread-count`/
`process-events`/`mark-all-read` are all declared before the `:id` wildcard route)
— verified live, not just by inspection.

## 12. Authorization & Tenant Isolation

**No new authorization primitives.** `NotificationsController` uses
`JwtAuthGuard` alone for every self-scoped route — matching `AccountController`'s
existing precedent for "my own data" endpoints (there is no meaningful permission
to gate "read your own notifications" behind beyond "is an authenticated, active
user"). **No new permission-catalogue entries were added this sprint** — `GET
/notifications/activity` reuses the existing `workflow.audit.view` entry.

Every notification query/mutation is scoped by BOTH `organisationId` AND
`recipientUserId` server-side, taken from the caller's own JWT (`TokenPayload.
organisationId`/`.sub`), never a client-supplied user id — `NotificationRepository`
has no method that accepts an id without also requiring both scoping fields.
Verified live: a cross-tenant user's `GET /notifications` returns `{ items: [],
total: 0 }` and a direct `GET /notifications/:id` for another tenant's known
notification id returns `404 Not Found` (§15).

## 13. Frontend Notification Centre

- **`NotificationBell`** (`apps/web/src/components/workspace/NotificationBell.tsx`)
  — mounted once in `Topbar`, so it appears on every authenticated page at every
  viewport width (`Topbar` already renders responsively; no separate mobile
  variant needed). Shows an unread-count badge (`9+` cap), a dropdown of the 5
  most recent notifications (unread ones dot-marked), "Mark all read," and "View
  all notifications" → `/notifications`. Clicking an item marks it read and
  navigates to its `actionUrl`.
- **`/notifications`** (`apps/web/src/app/(app)/notifications/page.tsx`) — the
  full, paginated, filterable (unread-only toggle) list. Loading/error/empty
  states match the established `ApiError`/retry pattern used throughout
  `/settings/workflows/*`. Each item shows title, body, type badge (hidden below
  `sm:` to avoid crowding — verified live at 375px), timestamp, and a mark
  read/unread toggle.
- Mobile (375px): verified live — bell badge renders correctly in the header,
  the dropdown opens as a well-positioned 320px panel that fits the viewport with
  no horizontal overflow, and the full `/notifications` page's cards stack
  cleanly with the type badge hidden to avoid title-crowding (a real, applied fix
  during this sprint's own mobile verification pass — see §16).

## 14. Testing

6 new spec files, 51 new tests, all passing:

- `notification-event-processor.service.spec.ts` (10) — idempotent creation,
  tenant scoping, recipient deduplication, zero-recipient handling, the
  atomicity/no-mark-processed-on-failure guarantee, one-event-failure-doesn't-
  block-another, and the missing-instance defensive path.
- `notification-recipient-resolver.spec.ts` (12) — one test per event-type branch
  in §7's table, plus "never notifies every organisation user" and "unmapped
  event type → zero recipients, not an error."
- `notification-message-builder.spec.ts` (8) — every message template, missing-
  step-name/missing-comment safety, the plain-text-only guarantee (a comment
  containing `<script>` tags passes through as inert text, never becomes real
  markup), and determinism.
- `notification.service.spec.ts` (7) — every method's recipient/tenant scoping
  delegation, ownership-check-before-mutation, `NotFoundException` for another
  user's notification.
- `activity.service.spec.ts` (6) — composition from `WorkflowEvent`, tenant
  scoping, actor-name/subject-reference resolution, the immutability guarantee
  (asserts the service's Prisma client is only ever called with `findMany`/
  `count`, never a write method).
- `notifications-independence.spec.ts` (8) — the structural guards described in
  §4.

## 15. Live Verification

Real tokens, real Postgres, both dev servers hot-reloaded to pick up the new
module. All performed in one continuous session:

1. Created and submitted a fresh Purchase Order (PO-000018) as the requester
   (Ibrahim) — confirmed `SUBMITTED` + `APPROVAL_REQUIRED` `WorkflowEvent` rows,
   sharing one `correlationId`.
2. Triggered processing as the eligible approver (Grace) — `{"processed":20,
"notificationsCreated":24}` (this run ALSO retroactively processed 19 backlog
   events from earlier Sprint 26/26.1 live testing, a live demonstration that
   the processor correctly catches up on a real backlog, not just fresh events).
3. Confirmed Grace's unread count and notification list, including the correct
   `WORKFLOW_APPROVAL_REQUIRED` message with the step name.
4. Marked one notification read — unread count dropped 6 → 5, confirmed via both
   the API and the browser UI (badge `8` → `7` → gone after "mark all read").
5. **Replayed processing** (`process-events` called a second time) — `{"processed":
0, "notificationsCreated":0}`; unread count and total both unchanged — zero
   duplicates.
6. Returned PO-000018 (Grace, with a required comment) — confirmed the requester
   (Ibrahim) received a `WORKFLOW_RETURNED` notification including the comment
   verbatim.
7. Resubmitted (Ibrahim) — confirmed Grace received both `WORKFLOW_RESUBMITTED`
   (she was the returner) and a fresh `WORKFLOW_APPROVAL_REQUIRED` for the new
   instance's step 1.
8. Approved both steps (Grace, then Admin as the final/explicitly-assigned
   approver) — confirmed the requester received exactly `WORKFLOW_STEP_APPROVED`
   ("moving to the next step") after step 1 and exactly `WORKFLOW_APPROVED` after
   step 2 — never a duplicate for the final step (§7).
9. **Suspended-user check**: set Grace's `User.status` to `INACTIVE`, submitted a
   second fresh Purchase Order (PO-000019) — confirmed `GET .../eligible-approvers`
   (the same call the recipient resolver makes) no longer listed Grace, and that
   she could no longer even log in (a stronger structural proof than checking her
   notification inbox directly, which self-scoped routes don't allow an admin to
   inspect on another user's behalf, by design — §12). Restored her to `ACTIVE`
   afterward; confirmed she could log in again.
10. **Cross-tenant check**: logged in as the pre-existing rival-tenant fixture
    (`owner@testtenant.local`) — `GET /notifications` returned `{ items: [],
total: 0 }`; a direct `GET /notifications/:id` for Boby Bites' own known
    notification id returned `404 Not Found`.
11. **Mobile (375px)**: verified the header bell, badge, dropdown (opens as a
    well-fitted 320px panel, no overflow), the full `/notifications` page, and
    mark-read/mark-all-read interactions — found and fixed a real crowding issue
    (the type `Badge` next to a long title had no room to wrap cleanly) by hiding
    the redundant badge below the `sm:` breakpoint (§16).
12. **Workflow/notification decoupling**: every workflow mutation above (submit,
    return, resubmit, approve×2) returned its own correct final status in its OWN
    HTTP response, before `process-events` was ever called as a separate,
    subsequent step — live evidence, alongside the dedicated atomicity unit tests
    (§14), that a notification-processing failure could never have blocked or
    corrupted any of these already-valid workflow transitions.

Cleanup: cancelled the one leftover non-terminal test instance (PO-000019's
workflow, from the suspended-user check) — final sweep confirmed 0 non-terminal
instances remain across 18 total.

## 16. Known Limitations & Deferred Capabilities

- **No real background worker.** `POST /notifications/process-events` is
  triggered by the frontend (poll + post-mutation calls), not a cron/queue
  (§4.1) — a deliberate, documented MVP choice, not an oversight. A user who
  never opens the app (and whose organisation has nobody else triggering
  processing) will have their notifications sit unprocessed until someone does.
- **`listEligibleApprovers` is an O(n) organisation-user scan** (unchanged
  limitation, inherited from Sprint 26's `WorkflowEligibilityService` — see
  workflow.md §6) — recipient resolution for `APPROVAL_REQUIRED`/`EXPIRED`
  inherits this same scale ceiling.
- **`ScopeEvaluator`'s own honest scope-checking gap** (workflow.md §6: a scope
  grant is verified, not that the specific record falls within it) applies
  identically to recipient resolution here, since it reuses the same eligibility
  call.
- **No notification preferences, no per-user opt-out, no digesting/batching** —
  every eligible recipient gets exactly one notification per event, always.
- **No admin visibility into another user's notification inbox** — by design
  (§12), but it means diagnosing "why didn't user X get notified" requires
  reasoning about the eligibility rules and `WorkflowEvent`/processing-state
  columns directly, not just querying `Notification` for that user.
- **Mobile UI fix applied, not merely verified**: the type badge on
  `/notifications` list items is hidden below the `sm:` breakpoint — found during
  this sprint's own 375px live pass (§15.11), fixed in the same session.
- **`WORKFLOW_COMPLETED` has no notification type** (§3.1) — deliberately, since
  no code path emits a `COMPLETED` `WorkflowEvent` today. Revisit if a future
  domain integration actually calls `markCompleted`.
