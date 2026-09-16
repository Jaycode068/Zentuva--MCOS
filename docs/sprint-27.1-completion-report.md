# Sprint 27.1 Completion Report — Notification Reliability, Preferences & Activity Consolidation

## 1. Summary

Sprint 27 built a working `WorkflowEvent → Notification` pipeline. Its own
processing-state model, however, was a single nullable timestamp
(`notificationProcessedAt`) with no explicit claim step — two concurrent
processing calls could both select the same unprocessed event and both attempt
to write its bookkeeping (data stayed correct only because the `Notification`
table's own unique constraint happened to catch the duplicate; the `WorkflowEvent`
update itself was not race-safe, and there was no bounded retry, no terminal
failure state, and no way to recover a stuck row).

Sprint 27.1 closes that gap and completes the product foundation around it: an
explicit, concurrency-safe processing state machine with bounded retry and
stale-lease recovery; a documented, tested recipient contract; a tenant-scoped
notification preference system; an operational admin surface for inspecting and
retrying failed processing; and a short architecture decision record formalizing
how `WorkflowEvent`, `WorkflowDecision`, `Notification`, `AuditLog`, and the
Activity Centre relate, so no future sprint introduces a fifth way to record
"something happened." None of Sprint 27's own architecture was redesigned —
`WorkflowModule` gained zero new imports, `WorkflowInstanceService` was not
touched, and the `WorkflowEvent`/`Notification` boundary remains exactly a data
boundary, never a service call.

## 2. Architecture

- **Workflow independence preserved.** `WorkflowInstanceService` is byte-for-
  byte unchanged this sprint. `NotificationEventProcessorService` still reads
  `WorkflowEvent`/`WorkflowInstance`/`WorkflowStepInstance` directly via Prisma
  and never imports `WorkflowInstanceService`/`WorkflowInstanceRepository`/
  `WorkflowDefinitionRepository` — verified by the extended
  `notifications-independence.spec.ts` (now also covering the new preference/
  category/constants files under the same structural guards).
- **Tenant isolation preserved.** Every new query/mutation (preferences, admin
  processing) takes `organisationId` from the caller's own JWT and scopes every
  Prisma call by it — live-verified: a rival-tenant login's preferences read
  back as fully independent defaults, and admin processing routes are
  implicitly tenant-scoped via the same pattern every other route uses.
- **Existing authorization reused, not replaced.** No new authorization
  primitive. Self-scoped preference routes use `JwtAuthGuard` alone, matching
  `AccountController`'s precedent; the two genuinely new administrative
  routes reuse the existing `PermissionsGuard`/`@RequirePermission` machinery
  with two new catalogue entries (§10).
- **Database-backed idempotency preserved.** The `Notification` unique
  constraint (`organisationId`+`sourceEventId`+`recipientUserId`+`channel`) is
  completely unchanged and remains the final guarantee; this sprint added a
  SECOND, independent layer in front of it (the claim step, §3) so the unique
  constraint is a backstop rather than the only thing preventing a duplicate
  insert attempt in the first place.

## 3. Processing Reliability

**States** (`NotificationProcessingStatus` enum, replacing the old nullable-
timestamp model): `PENDING` → `PROCESSING` (claimed) → `PROCESSED` (terminal,
success) or back to `PENDING` (retryable failure) or `FAILED` (terminal,
attempts exhausted).

**Concurrency**: the claim is a per-row conditional `updateMany` — this
codebase's own established idiom (`WorkflowInstanceRepository.decideStep`'s
pattern), not a new lock primitive, no Redis usage introduced. Two concurrent
claims on the same row: only one's `updateMany` affects it (`count === 1`); the
other sees `count === 0` and excludes that event from its batch. **Live-verified**:
5 simultaneous `POST /notifications/process-events` calls against one fresh
event produced exactly one successful claim and four no-ops, with zero
duplicate notifications in the resulting list.

**Retry**: `MAX_PROCESSING_ATTEMPTS = 3`, backoff `[0, 1min, 5min]`
(`notification-processing.constants.ts`). A retryable failure returns to
`PENDING` with `notificationNextRetryAt` scheduled; attempts exhausted →
terminal `FAILED`. Every failure is currently treated as retryable — no error
taxonomy exists to distinguish transient from permanent failures, a documented,
deliberately simple policy.

**Recovery**: a `PROCESSING` row whose lease (`notificationLeaseAt`) is older
than `PROCESSING_LEASE_MS` (5 minutes) is treated as abandoned and reclaimed by
the same claim query on the very next ordinary processing sweep — no separate
recovery job. **Live-verified**: a manually-manufactured stale `PROCESSING` row
(10-minute-old lease) was reclaimed and successfully processed by the next
`process-events` call.

**Manual retry**: `POST /notifications/admin/processing/:eventId/retry` —
tenant-scoped, eligible from `FAILED` or stuck `PROCESSING`, bypasses backoff
(`nextRetryAt = now()`), does NOT reset `notificationAttempts` (full history
preserved). **Live-verified**: a manufactured `FAILED` event (3 attempts) was
retried, reached `PROCESSED` on the next sweep with `attempts: 4`, error
cleared, no duplicate notification created.

**Failure visibility**: `GET /notifications/admin/processing` answers every
question the brief required (which event, event type, first/last attempt time,
attempt count, error category, next retry time, retryability) — `notification.
processing.view`-gated, tenant-scoped, paginated.

## 4. Recipient Semantics

A documented event → recipient-category → exclusion table (notifications.md
§6) covers all 9 mapped event types. Duplicate recipient paths are deduplicated
in-memory before message construction (the database constraint remains the real
safety net regardless).

User-status-change behavior is explicit and tested/live-verified:

- Suspension/role-removal BEFORE processing → excluded (eligibility is
  resolved live at processing time, never cached from submission).
- Suspension/role-removal AFTER a notification was already created → the
  existing `Notification` row is untouched; only future events stop resolving
  them.
- Reactivation → immediately eligible again, no special cleanup needed
  (nothing was ever deleted). Live-verified: a suspended user's 13 existing
  notifications were unaffected by suspension and fully accessible again
  immediately upon reactivation.

## 5. Notification Lifecycle

Read/unread, mark-one-read, mark-all-read, and unread count were already
complete from Sprint 27 and are unchanged in shape; re-verified live end-to-end
against the new processing pipeline underneath (4 → 3 → 0 unread across a
mark-read then mark-all-read, with an idempotent repeat mark-read producing no
further change). Pagination and read-state filtering unchanged. No retention/
archival policy exists or was added — notifications are retained indefinitely;
`createdAt` (already indexed) is the field a future policy would filter on.

## 6. Preferences

Two categories (`WORKFLOW_APPROVALS`, `WORKFLOW_STATUS_CHANGES`) — a coarse
grouping of the 8 existing notification types, matching the only real
distinction ("needs your action" vs. "FYI status change") that exists today.
Scoped by `@@unique([organisationId, userId, category])`. Default: enabled
(absent row = `true`). Suppression affects notification **creation only** —
`NotificationEventProcessorService` filters resolved recipients through
`NotificationPreferenceService.filterEnabledRecipients` after recipient
resolution, before message construction; the underlying `WorkflowEvent`/audit
trail is always written in full regardless, and the event still reaches
`PROCESSED` normally (a preference is not a failure). Live-verified: disabling
`WORKFLOW_APPROVALS` for one user left her unread count unchanged for a fresh
approval-required event while other eligible recipients were still notified,
and the `WorkflowEvent` history for that instance remained complete.

Preferences are explicitly not an authorization mechanism — they only affect
proactive notification, never access.

## 7. Activity Boundaries

A new architecture decision record
([`docs/architecture/notification-activity-boundaries.md`](architecture/notification-activity-boundaries.md))
formalizes: `WorkflowEvent` is the authoritative "did this happen" record;
`WorkflowDecision` is the human-facing per-instance timeline (written in the
same transaction as its sibling event, not independently derived);
`Notification` is a recipient-scoped derivative answering "does THIS user have
something to act on," never a second source of truth for whether something
happened; `AuditLog` is the pre-existing, generic, platform-wide administrative
log; the Activity Centre is a read-only VIEW composed live from `WorkflowEvent`,
not a fifth table. No duplicate record-keeping was introduced or found needed
this sprint — Activity Centre continues to compose live, unchanged from Sprint
27's own design.

## 8. API and UI

**New routes**: `GET/PATCH /notifications/preferences[/:category]`, `POST
/notifications/preferences/reset`, `GET /notifications/admin/processing`, `POST
/notifications/admin/processing/:eventId/retry`. Full table in
notifications.md §7.

**New pages**: `/notifications/preferences` (checkbox per category, "Reset to
defaults"), `/notifications/admin` (status-filtered processing records with a
"Retry now" action), both reachable via a new `NotificationTabs` component
mirroring `WorkflowTabs`' own multi-route-tab convention.

**Responsive verification**: all four notification pages (list, preferences,
admin, and the header bell) verified at both desktop and 375px. One real issue
found and fixed in the same session: the admin page's status-filter button row
overflowed the 375px viewport with no scroll affordance — fixed with
`overflow-x-auto`, re-verified with a visible scroll indicator, matching the
convention already used elsewhere in this codebase for wide content.

## 9. Database

**New migrations**:
`20260916104048_sprint27_1_notification_reliability_preferences` (the
`NotificationProcessingStatus`/`NotificationCategory` enums, the `WorkflowEvent`
processing-state columns, the new `NotificationPreference` table, plus a
hand-added backfill statement setting `notificationProcessingStatus = 'PROCESSED'`
for every pre-existing row with a non-null `notificationProcessedAt`) and
`20260916211732_sprint27_1_first_attempt_timestamp` (one additional column,
`notificationFirstAttemptAt`, added as a clean follow-up migration rather than
amending the first one after it had already been applied locally).

**Schema changes**:

- `WorkflowEvent`: +`notificationProcessingStatus`, +`notificationLeaseAt`, +`notificationNextRetryAt`, +`notificationLastErrorCategory`, +`notificationFirstAttemptAt`. `notificationProcessedAt`/
  `notificationAttempts`/`notificationLastAttemptAt`/`notificationLastError`
  unchanged. New index `[organisationId, notificationProcessingStatus,
notificationNextRetryAt]` (replacing the old `[organisationId,
notificationProcessedAt]` index — the new composite covers every claim-query
  predicate).
- New `NotificationPreference` model + `NotificationCategory` enum,
  `@@unique([organisationId, userId, category])`, index `[organisationId,
userId]`.
- New `NotificationProcessingStatus` enum (`PENDING`/`PROCESSING`/`PROCESSED`/
  `FAILED`).
- `Organisation`: +`notificationPreferences` back-relation.
- No changes to `Notification`'s own columns or its unique constraint.

Verified: `prisma validate` clean; `prisma migrate status` — 42 migrations,
"Database schema is up to date!"; `prisma:seed` re-run cleanly after both
migrations, idempotent, and confirmed the two new permissions were auto-granted
to the Administrator role.

## 10. Authorization

Two new permission-catalogue entries — `notification.processing.view` and
`notification.processing.manage` — a genuinely new administrative capability
(inspecting/retrying the notification pipeline's own internal state) with no
existing entry to reuse, distinct from `workflow.audit.view` (a workflow
instance's own decision history). Both auto-granted to the `Administrator`
system role through the existing catalogue-seed loop (`prisma.rolePermission.
createMany({ ..., skipDuplicates: true })` over the full catalogue array) — zero
manual seed code needed, verified by re-running `prisma:seed` and querying the
resulting grants directly. No changes to any existing permission or route
guard.

## 11. Tests

| Suite                                                                                | Sprint 27.1 test count |
| ------------------------------------------------------------------------------------ | ---------------------- |
| `notification-event-processor.service.spec.ts` (rewritten for the new state machine) | 19                     |
| `notification-recipient-resolver.spec.ts` (unchanged)                                | 11                     |
| `notification-message-builder.spec.ts` (unchanged)                                   | 8                      |
| `notification.service.spec.ts` (unchanged)                                           | 7                      |
| `activity.service.spec.ts` (unchanged)                                               | 6                      |
| `notifications-independence.spec.ts` (extended with new files)                       | 5                      |
| `notification-preference.service.spec.ts` (new)                                      | 10                     |
| **Notifications total**                                                              | **66 / 7 suites**      |
| **Whole API suite**                                                                  | **1625 / 188 suites**  |

(Sprint 27 shipped with 45 notification tests across 6 suites; the processor
spec was substantially rewritten this sprint to cover the new state machine,
concurrency, retry, and recovery behavior, and a new preference spec was
added — net +21 notification tests, +1 file, both confirmed by the counts
above.)

New/expanded categories this sprint: concurrent-claim safety, retryable vs.
terminal failure, max-attempts enforcement, stale-`PROCESSING` inclusion in the
claim query, manual retry (attempt-history preservation, rejecting an
already-`PROCESSED` event, cross-tenant 404, retry-after-partial-creation
duplicate safety), `listProcessingRecords` tenant/status scoping, preference
defaults/read/update/reset/rejection-of-unsupported-category, and
`filterEnabledRecipients` inclusion/exclusion/empty-input behavior.

## 12. Live Verification

All 20 of the brief's required scenarios were actually run, in one continuous
session, against the real local Postgres database with real authenticated
tokens (full detail in notifications.md §13):

1. Workflow event → expected notification. 2. Replay → zero duplicates.
2. **5 concurrent processing calls → exactly one success, zero duplicates.**
3. Manufactured `FAILED` event inspected by an administrator; a
   non-administrator's identical request 403'd. 5. Retry succeeded safely,
   attempt history preserved. 6. A manufactured stale `PROCESSING` row was
   recovered by the next ordinary sweep. 7. Suspended user excluded from a
   fresh event's eligible approvers. 8. Her 13 pre-existing notifications were
   confirmed untouched by suspension, then fully accessible again on
   reactivation. 9. Mark one read (4→3 unread). 10. Mark all read (→0). 11. Unread count correctly tracked both transitions. 12–13. Preference
   disable suppressed creation for one user while the event still processed
   fully and correctly for others and the audit trail stayed intact; reset
   restored defaults. 14. Cross-tenant `GET /notifications` → empty; direct
   `GET /notifications/:id` for another tenant's id → 404. 15. Cross-user
   mark-read attempt → 404. 16. Admin processing routes 403 for
   non-administrators, succeed for administrators. 17–18. Desktop and 375px UI
   verified for all four notification pages (list, preferences, admin, bell) —
   one real mobile overflow bug found and fixed. 19. `prisma:seed` re-run
   clean and idempotent after both migrations. 20. A full two-step approval
   chain (submit → approve × 2 → `APPROVED`) completed correctly end-to-end,
   confirming Workflow's own behavior is fully intact under the new processor.

Cleanup: every leftover non-terminal test workflow instance created during this
session was cancelled; a final sweep confirmed 0 non-terminal instances and 0
`FAILED`/`PROCESSING` processing records remain in the database.

## 13. Documentation

- `docs/domains/notifications.md` — substantially rewritten: processing states/
  retry/recovery/failure-visibility, the recipient contract table and
  user-status-change table, the preferences section, updated API reference,
  updated frontend/testing/live-verification/limitations sections.
- `docs/architecture/notification-activity-boundaries.md` (new) — the
  requested architecture decision record.
- `docs/sprint-27.1-completion-report.md` (this file).
- `README.md`, `docs/roadmap.md`, `docs/backlog.md`, `docs/changelog.md` —
  updated with this sprint's summary, consistent with every prior sprint's
  pattern.
- No engineering-handbook change — the conditional-`updateMany`-as-claim
  pattern is already this codebase's established idiom (documented on
  `WorkflowInstanceRepository` since Sprint 26.1), not a new durable principle;
  this sprint is its first reuse outside Workflow, which the domain doc itself
  now records.

## 14. Deferred Scope

Matching the brief's own explicit exclusions: email/SMS/push/WhatsApp
notifications, webhooks, a real background queue/worker (processing remains
on-demand — frontend poll + post-mutation calls, unchanged trigger model from
Sprint 27, chosen deliberately per §3.5's "unless a very small internal
abstraction is required" allowance, which the claim-based state machine itself
satisfies), notification escalation rules, scheduled reminders, digest
notifications, mobile native push infrastructure. Also deferred, honestly
documented rather than silently dropped: an error taxonomy distinguishing
retryable from terminal failures (every failure is currently retried up to the
attempt limit); admin visibility into another user's notification INBOX
(only into the processing pipeline); more than two preference categories; a
second Workflow domain integration (still none found with Purchase Order's
clean draft/submission boundary, per Sprint 26.1's own prior audit).

## 15. Git Status

- No commit was made.
- No push was made.
- Branch: `main` (HEAD still at `4ee82eb`, the Sprint 27 commit).
- Working tree: 16 modified files, 13 added files, all uncommitted, as
  instructed.
