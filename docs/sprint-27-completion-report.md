# Sprint 27 Completion Report — Notifications & Activity Centre Foundation

## 1. Executive Summary

Sprint 27 builds the first reusable in-app notification system, as a pure
downstream consumer of Sprint 26.1's `WorkflowEvent` table. The central claim
this sprint had to prove — and did, both by static structural guard and by live
replay — is that Notifications can consume Workflow's event stream **without
understanding or embedding workflow business logic**: `NotificationEventProcessorService`
reads `WorkflowEvent`/`WorkflowInstance`/`WorkflowStepInstance` directly via
Prisma and never imports `WorkflowInstanceService`; the only Workflow code reused
is two already-existing, pure, read-only services
(`WorkflowEligibilityService`, `WorkflowDefinitionService`) newly exported from
`WorkflowModule` — the sprint's only change to any pre-existing Workflow file.

It is ready for future channels because the architecture never assumed `IN_APP`
is the only destination: `NotificationChannel` is an enum specifically so
`EMAIL`/`SMS`/`PUSH`/`WEBHOOK` can be added as values later with no migration,
and the processing trigger (an on-demand HTTP call, documented explicitly as a
stand-in for a future scheduled job) requires zero change to
`processPendingEvents`'s own logic when a real queue/cron eventually exists.

## 2. Architecture

```
WorkflowInstanceService (UNCHANGED — zero new imports, zero new awareness)
        │ writes, in its own transaction (Sprint 26.1, unchanged)
        ▼
WorkflowEvent  ← 4 new processing-state columns added directly to this table
        │ read directly via Prisma (never via WorkflowInstanceService)
        ▼
NotificationEventProcessorService.processPendingEvents(organisationId)
        │  per event, in ONE transaction:
        ├─ NotificationRecipientResolver   (who — reuses WorkflowEligibilityService)
        ├─ NotificationMessageBuilder      (what — reuses WorkflowSubjectHandler.describe())
        └─ Notification.createMany({ skipDuplicates: true }) + WorkflowEvent.notificationProcessedAt
        ▼
Notification  (recipient-scoped, durable, IN_APP only)
```

- **Producer**: `WorkflowInstanceService`, entirely unchanged this sprint.
- **Consumer**: `NotificationEventProcessorService` — the data boundary is the
  `WorkflowEvent` table itself, not a service call.
- **Recipient resolver**: `NotificationRecipientResolver` — one branch per event
  type (§4 below), every "who's eligible" question delegated to
  `WorkflowEligibilityService.listEligibleApprovers`, never reimplemented.
- **Persistence**: a new `Notification` table, idempotent by a database-level
  unique constraint.
- **Activity boundary**: `ActivityService` composes an organisation-wide feed
  live from `WorkflowEvent` — no new table, explicitly NOT the same audience or
  lifecycle as `Notification` (docs/domains/notifications.md §2).
- **Processing/retry model**: on-demand (frontend poll + post-mutation calls),
  per-event-atomic, retryable, observable (attempt count + last error stored on
  `WorkflowEvent` itself) — see §5.

## 3. Data Model

**New table**: `Notification` — `id`, `organisationId`, `recipientUserId`,
`type` (`NotificationType` enum, 8 values), `channel` (`NotificationChannel`
enum, `IN_APP` only), `title`, `body`, `status` (`NotificationStatus` enum,
`UNREAD`/`READ`), `readAt`, `sourceEventId` (FK → `WorkflowEvent`, `SET NULL`),
`sourceType`, `sourceId`, `actionUrl`, `metadata` (JSON), `createdAt`,
`updatedAt`.

**Indexes/constraints**: `@@unique([organisationId, sourceEventId,
recipientUserId, channel])` (the idempotency invariant, §5);
`@@index([organisationId, recipientUserId, status])`;
`@@index([organisationId, recipientUserId, createdAt])`.

**`WorkflowEvent` additions** (4 new nullable columns, no other change to that
table): `notificationProcessedAt`, `notificationAttempts` (default 0),
`notificationLastAttemptAt`, `notificationLastError`. New index:
`@@index([organisationId, notificationProcessedAt])` — the processor's own
primary query.

**`Organisation`**: one new back-relation, `notifications Notification[]`,
matching the existing convention for every other tenant-scoped table.

No changes to `User`, `WorkflowInstance`, `WorkflowStepInstance`,
`WorkflowDecision`, or any non-Workflow table. Migration:
`20260916073751_sprint27_notifications_foundation`.

## 4. Supported Event Mappings

| Workflow event               | Notification type                          | Recipients                                            | Navigation target |
| ---------------------------- | ------------------------------------------ | ----------------------------------------------------- | ----------------- |
| `SUBMITTED`                  | _(none)_                                   | —                                                     | —                 |
| `APPROVAL_REQUIRED`          | `WORKFLOW_APPROVAL_REQUIRED`               | Users eligible for the newly-active step              | Instance detail   |
| `STEP_APPROVED` (mid-chain)  | `WORKFLOW_STEP_APPROVED`                   | The requester                                         | Instance detail   |
| `STEP_APPROVED` (final step) | _(none — `APPROVED` covers it)_            | —                                                     | —                 |
| `APPROVED`                   | `WORKFLOW_APPROVED`                        | The requester                                         | Instance detail   |
| `REJECTED`                   | `WORKFLOW_STEP_REJECTED`                   | The requester                                         | Instance detail   |
| `RETURNED`                   | `WORKFLOW_RETURNED`                        | The requester                                         | Instance detail   |
| `RESUBMITTED`                | `WORKFLOW_RESUBMITTED`                     | Whoever RETURNED the previous instance                | Instance detail   |
| `CANCELLED`                  | `WORKFLOW_CANCELLED`                       | The requester (skipped if self-cancelled)             | Instance detail   |
| `EXPIRED`                    | `WORKFLOW_EXPIRED`                         | The requester + eligible approvers of the active step | Instance detail   |
| `COMPLETED`                  | _(none — unreachable, no caller anywhere)_ | —                                                     | —                 |

`SUBMITTED` and `COMPLETED` are real, emitted `WorkflowEvent` types with
deliberately zero notification mapping — `SUBMITTED` because `APPROVAL_REQUIRED`
already covers the same moment for the same audience in the same request;
`COMPLETED` because `WorkflowInstanceService.markCompleted` has no caller
anywhere in this codebase (no controller route, no subject handler) — see
notifications.md §3.1 for the full reasoning.

## 5. Idempotency and Concurrency

The **database-level unique index is the guarantee**, not an application-level
pre-check: `NotificationEventProcessorService` always attempts
`Notification.createMany({ data, skipDuplicates: true })` against
`@@unique([organisationId, sourceEventId, recipientUserId, channel])` — a
duplicate insert is silently skipped by Postgres, never checked for in advance.
This means:

- Reprocessing an already-processed event → the event is never re-selected
  (`notificationProcessedAt` already set), and even if it somehow were, the
  insert would silently no-op.
- Two concurrent processors racing the same event → both attempt the identical
  insert; the unique index admits exactly one set of rows regardless of timing —
  no `SELECT`-then-`INSERT` race window exists.
- Per-event atomicity: every recipient's `Notification` row AND the event's own
  `notificationProcessedAt` stamp commit in one `$transaction`, or neither does
  — an event is never marked processed if notification creation failed for a
  real (non-duplicate) reason.
- One event's failure never blocks another's processing in the same batch — the
  processor's loop continues, and `processPendingEvents`'s own return value
  (`{ processed, failed, notificationsCreated }`) surfaces failures rather than
  swallowing them.

Live-verified, not just unit-tested: calling `POST /notifications/process-events`
a second time immediately after the first produced `{"processed":0,"failed":0,
"notificationsCreated":0}`, with the recipient's unread count and total
notification count both unchanged.

## 6. Authorization and Tenant Isolation

Zero new authorization primitives, zero new permission-catalogue entries (still
132). `NotificationsController`'s self-scoped routes use `JwtAuthGuard` alone —
matching `AccountController`'s existing "my own data" precedent — with every
query additionally scoped server-side to the caller's own `organisationId` +
`recipientUserId` from the JWT, never a client-supplied id. `GET
/notifications/activity` (organisation-wide, not self-scoped) reuses the
existing `workflow.audit.view` permission rather than adding a new one.

Recipient resolution reuses `WorkflowEligibilityService.listEligibleApprovers`
unchanged — the same self-approval check, explicit-assignee check, active-user
check, and permission/scope check (`EffectiveAccessResolver`/`ScopeEvaluator`)
that gates a real approval. Live-verified: setting an approver's `User.status`
to `INACTIVE` removed her from `GET .../eligible-approvers` (the same call the
resolver makes) and prevented her from logging in at all — a stronger proof than
inspecting her notification inbox directly, which no other user (including an
admin) can do by design.

Cross-tenant isolation live-verified: a rival-tenant user's `GET /notifications`
returned `{ items: [], total: 0 }`; a direct `GET /notifications/:id` for
another tenant's known notification id returned `404 Not Found` (never a `403`,
never leaking existence).

## 7. API

All under `@Controller('notifications')`, `@UseGuards(JwtAuthGuard)` at the
controller level:

| Method | Path                            | Auth                  | Notes                                                                                           |
| ------ | ------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------- |
| `GET`  | `/notifications`                | Self                  | Paginated (`page`/`pageSize`, shared `paginationSchema`), `status`/`type` filters, newest-first |
| `GET`  | `/notifications/activity`       | `workflow.audit.view` | Organisation-wide, composed from `WorkflowEvent`, optional `subjectType`/`subjectId` filter     |
| `GET`  | `/notifications/unread-count`   | Self                  | `{ count }`                                                                                     |
| `GET`  | `/notifications/:id`            | Self                  | 404 for another user's/tenant's notification                                                    |
| `POST` | `/notifications/process-events` | Self                  | Triggers processing for the caller's org (§5, §4.1 of notifications.md)                         |
| `POST` | `/notifications/mark-all-read`  | Self                  | Returns count flipped; safe to repeat                                                           |
| `POST` | `/notifications/:id/read`       | Self                  | Idempotent                                                                                      |
| `POST` | `/notifications/:id/unread`     | Self                  | Idempotent                                                                                      |

Route declaration order (`activity`/`unread-count`/`process-events`/
`mark-all-read` before the `:id` wildcard) verified correct live, not just by
inspection.

## 8. Frontend

- `NotificationBell` (new) — mounted in `Topbar`, visible on every authenticated
  page at every width. Unread badge (`9+` cap), dropdown of the 5 most recent
  notifications, mark-read-on-click-and-navigate, "Mark all read," "View all
  notifications." Polls every 20s (also the sprint's chosen processing trigger,
  notifications.md §4.1).
- `/notifications` (new) — full paginated list, unread-only filter, per-item
  mark read/unread, "Mark all read," "Check for new" (manual process-events
  trigger), loading/error/empty states matching the established
  `ApiError`/retry pattern.
- Existing workflow-mutating pages (`my-approvals/page.tsx`,
  `instances/[id]/page.tsx`, Procurement's submit/resubmit-for-approval) each
  gained one fire-and-forget `processNotificationEvents().catch(() => undefined)`
  call in their mutation `onSuccess` handlers, so a notification appears
  promptly after the action that caused it rather than waiting for the next
  poll tick.
- **Mobile (375px)**: verified live via the browser preview. Header bell and
  badge render correctly; the dropdown opens as a well-fitted 320px panel with
  no horizontal overflow; the full `/notifications` page's cards stack cleanly.
  One real issue was found and fixed in the same session: the notification-type
  `Badge` next to a long title had no room and crowded the layout — fixed by
  hiding it below the `sm:` breakpoint (the title text already conveys the same
  information in most cases). A `computer{action:"left_click"}` tool timeout was
  investigated and determined to be a harness artifact, not an app defect —
  confirmed by triggering the identical click via direct DOM interaction, which
  opened the dropdown correctly and was then verified via screenshot.

## 9. Tests

| Suite                                          | Tests                                    |
| ---------------------------------------------- | ---------------------------------------- |
| `notification-event-processor.service.spec.ts` | 10                                       |
| `notification-recipient-resolver.spec.ts`      | 12                                       |
| `notification-message-builder.spec.ts`         | 8                                        |
| `notification.service.spec.ts`                 | 7                                        |
| `activity.service.spec.ts`                     | 6                                        |
| `notifications-independence.spec.ts`           | 8                                        |
| **New total**                                  | **51**                                   |
| **Whole API suite**                            | **187 suites / 1604 tests, all passing** |

Event-processing tests: idempotent creation, zero-recipient handling, recipient
deduplication, the atomicity/no-mark-processed-on-failure guarantee, one
event's failure not blocking another's, the missing-instance defensive path.
Idempotency/concurrency tests: DB-level `skipDuplicates` reliance (never a
manual pre-check), plus live replay (§5). Tenant-isolation tests: every
recipient-resolver/message-builder/service test asserts organisation- and
recipient-scoping; live cross-tenant verification in §6. Live verification
scenarios: 11 numbered scenarios covering the brief's full required list (submit
→ event → notify → read → replay-no-duplicate → return → resubmit → approve×2
→ suspended-user exclusion → cross-tenant isolation → mobile), documented in
full in notifications.md §15.

## 10. Quality Checks

- `pnpm --filter api exec tsc --noEmit` — clean.
- `pnpm --filter web exec tsc --noEmit` — clean.
- `pnpm --filter api lint` — 27 pre-existing warnings (unchanged baseline,
  `finance/budgeting/*.spec.ts`), 0 new, 0 errors.
- `pnpm --filter web lint` — clean.
- `pnpm --filter api test` — 187 suites / 1604 tests passing.
- `npx prisma validate` — schema valid.
- `npx prisma migrate status` — "Database schema is up to date!" (40
  migrations, including this sprint's
  `20260916073751_sprint27_notifications_foundation`).
- `pnpm --filter api run prisma:seed` — re-ran after all live testing; completed
  cleanly, no errors, all existing idempotency guards still short-circuit
  correctly. No notification-specific seed fixtures were added (§12 "Deferred
  items" explains why).

## 11. Documentation

- `docs/domains/notifications.md` (new) — the full domain doc: data model,
  architecture, idempotency, recipient resolution, event mapping table, message
  construction, lifecycle, Activity Centre, API reference, authorization,
  frontend, tests, live verification, known limitations.
- `docs/sprint-27-completion-report.md` (this file).
- `docs/domains/workflow.md` — §17 rewritten: Notifications is now the real
  consumer the event boundary was built for; documents the one change made to
  any Workflow file (`WorkflowModule`'s new `exports` array) and the processing-
  state columns added to `WorkflowEvent`.
- `docs/architecture/authorization-coverage.md` — new addendum bullet: catalogue
  stayed at 132, zero new entries, full rationale for why `JwtAuthGuard` alone
  is correct for self-scoped routes.
- `docs/domains/README.md` — new status row for Notifications & Activity
  Centre Foundation.
- `README.md`, `docs/roadmap.md`, `docs/backlog.md`, `docs/changelog.md` —
  updated with this sprint's summary, consistent with every prior sprint's
  pattern.

## 12. Deferred Items

Explicitly out of scope, matching the brief: email, SMS, push, WhatsApp,
webhooks, notification preferences, notification-template administration, a
localisation framework, digest notifications, scheduled reminders, automatic
escalation, delegation/substitute approvers, a second live domain integration,
a real background worker (queue/cron) — processing is triggered on demand
(notifications.md §4.1), an admin view into another user's notification inbox,
and notification-specific seed fixtures (notifications derive entirely from
live `WorkflowEvent` processing; seeding synthetic `Notification` rows not tied
to a real event would have violated the brief's own "do not create fake
notifications that do not correspond to valid source events" rule — the
existing `PURCHASE_ORDER_APPROVAL` seed definition plus this sprint's own live
verification already exercises the full pipeline against real data).

## 13. Files Changed

**Added (18):**

```
apps/api/prisma/migrations/20260916073751_sprint27_notifications_foundation/migration.sql
apps/api/src/notifications/activity.service.spec.ts
apps/api/src/notifications/activity.service.ts
apps/api/src/notifications/notification-event-processor.service.spec.ts
apps/api/src/notifications/notification-event-processor.service.ts
apps/api/src/notifications/notification-message-builder.spec.ts
apps/api/src/notifications/notification-message-builder.ts
apps/api/src/notifications/notification-recipient-resolver.spec.ts
apps/api/src/notifications/notification-recipient-resolver.ts
apps/api/src/notifications/notification.repository.ts
apps/api/src/notifications/notification.service.spec.ts
apps/api/src/notifications/notification.service.ts
apps/api/src/notifications/notifications-independence.spec.ts
apps/api/src/notifications/notifications.controller.ts
apps/api/src/notifications/notifications.module.ts
apps/api/src/notifications/subject-label.util.ts
apps/web/src/app/(app)/notifications/api.ts
apps/web/src/app/(app)/notifications/page.tsx
apps/web/src/components/workspace/NotificationBell.tsx
docs/domains/notifications.md
docs/sprint-27-completion-report.md
```

(21 counting the two doc files alongside the 19 source files.)

**Modified (15):**

```
README.md
apps/api/prisma/schema.prisma
apps/api/src/app.module.ts
apps/api/src/workflow/workflow.module.ts
apps/web/src/app/(app)/settings/procurement/page.tsx
apps/web/src/app/(app)/settings/workflows/instances/[id]/page.tsx
apps/web/src/app/(app)/settings/workflows/my-approvals/page.tsx
apps/web/src/components/workspace/Topbar.tsx
apps/web/src/components/workspace/icons.tsx
docs/architecture/authorization-coverage.md
docs/backlog.md
docs/changelog.md
docs/domains/README.md
docs/domains/workflow.md
docs/roadmap.md
```

**Deleted:** none.

**Not touched (deliberately)**: every Sprint 26/26.1 Workflow file except
`workflow.module.ts` (one additive `exports` array, no logic change) and the
`WorkflowEvent` Prisma model (four new nullable columns, no existing column
touched) — `workflow-instance.service.ts`, `workflow-instance.repository.ts`,
`workflow-instance.controller.ts`, `workflow-eligibility.service.ts`,
`workflow-definition.*`, `workflow-subject-handler.ts`,
`handlers/purchase-order-workflow.handler.ts`, and `permission-catalogue.ts` are
all byte-for-byte unchanged.

## 14. Git Status

- No commit was made.
- No push was made.
- Branch: `main` (HEAD still at `b0553e9`, the Sprint 26.1 commit).
- Working tree: 15 modified files, 21 added files (19 source + 2 docs), all
  uncommitted, as instructed.
