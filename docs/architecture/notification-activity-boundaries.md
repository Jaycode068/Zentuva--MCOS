# Notification & Activity Boundaries

Sprint 27.1 §Workstream E "Activity Centre Consolidation." A short, focused
architecture decision record explaining how `WorkflowEvent`, `Notification`,
`AuditLog`, and the Activity Centre relate — written because Sprint 27 introduced
a fourth record-keeping concept (`Notification`) into a codebase that already had
three (`WorkflowEvent`, `WorkflowDecision`/timeline, `AuditLog`), and the four are
easy to conflate if not stated explicitly.

## The four records

### 1. `WorkflowEvent` — Workflow's own durable state-transition log

**What it is**: one row per logical state transition in the Workflow domain
(`SUBMITTED`, `APPROVAL_REQUIRED`, `STEP_APPROVED`, `APPROVED`, `REJECTED`,
`RETURNED`, `RESUBMITTED`, `CANCELLED`, `EXPIRED`, `COMPLETED`), written
transactionally alongside the mutation that produced it (docs/domains/workflow.md
§12).

**What it is NOT**: a user-facing notification, or a human-readable audit
message. It carries machine fields (`eventType`, `workflowStepInstanceId`,
`correlationId`, `idempotencyKey`) and a JSON `summary`, not prose.

**Authoritative for**: "did this exact state transition happen, and when,
exactly once." This is the SOURCE every other record in this document is derived
from — nothing downstream re-derives or re-decides what happened; they all read
`WorkflowEvent` (or, for the timeline, `WorkflowDecision`, itself written in the
same transaction as the equivalent event) as ground truth.

### 2. `WorkflowDecision` / the workflow instance timeline

**What it is**: the human-facing decision history already built in Sprint 26 —
`GET /workflows/instances/:id/history` — showing who approved/rejected/returned/
cancelled a specific `WorkflowInstance`, with comments.

**Authoritative for**: "what happened to THIS ONE workflow instance, in order,
with the actual decision comments." Scoped to a single instance; not a
cross-instance feed.

**Relationship to `WorkflowEvent`**: `WorkflowDecision` rows and their sibling
`WorkflowEvent` rows are written in the SAME transaction
(`WorkflowInstanceRepository.decideStep`) — they are two views of the same
underlying fact, not independently-derived duplicates. Neither is generated FROM
the other after the fact.

### 3. `Notification` — one recipient's "this needs your attention"

**What it is**: Sprint 27's own table. Produced FROM a `WorkflowEvent` (§4 of
notifications.md) by `NotificationEventProcessorService`, but a genuinely
different row: recipient-scoped (one row per eligible recipient, not one per
event), has a read/unread lifecycle `WorkflowEvent` doesn't have, and can be
suppressed by a user's own preference (Sprint 27.1 §6.2) without touching the
source event at all.

**Authoritative for**: "does THIS user currently have something to act on or be
aware of." Never authoritative for "did the underlying thing actually happen" —
that's always `WorkflowEvent`/`WorkflowDecision`. A missing or suppressed
`Notification` never means the underlying workflow transition didn't happen; it
only means this one user wasn't (or chose not to be) told about it proactively.

### 4. `AuditLog` — generic, platform-wide administrative/security log

**What it is**: the pre-existing (Sprint 1B.1-era), generic, cross-domain audit
table — `action`, `entityType`, `entityId`, `metadata`, insert-only, never
updated or deleted. Every domain in this codebase writes to it for its own
administrative actions (role changes, user creation, workflow definition edits,
etc.) via `AuditService`.

**Authoritative for**: "what administrative/security-relevant action did an actor
take, generically, across the whole platform" — the broadest-scoped, least
domain-specific of the four. Not workflow-instance-specific, not recipient-
specific, not composed into a feed for end users at all today (there is no `GET
/audit-log` UI anywhere in this codebase).

### 5. Activity Centre — a read-only, composed VIEW, not a fifth record type

**What it is**: `ActivityService.list` (`GET /notifications/activity`) — composes
an organisation-wide, human-readable feed LIVE from `WorkflowEvent` rows (actor
name + subject reference resolved at read time), for anyone with
`workflow.audit.view`.

**Deliberately not a table.** Sprint 27's own brief, reaffirmed this sprint:
"if existing audit/event infrastructure can support a useful activity feed,
compose from it rather than duplicate." `WorkflowEvent` already has every field
an activity feed needs (`actorUserId`, `subjectType`/`subjectId`, `eventType`,
`occurredAt`); building a second, redundant `ActivityRecord` table would mean
keeping two copies of the same fact in sync forever, for zero benefit over a
`SELECT`.

## Decision table

| Question you're asking                                                               | Read from                                            |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| "Did X happen, exactly, and when?"                                                   | `WorkflowEvent`                                      |
| "What's the full decision history of THIS workflow instance, with comments?"         | `WorkflowDecision` / `GET .../history`               |
| "Does user Y have something to act on right now?"                                    | `Notification` (recipient-scoped)                    |
| "What administrative action did an actor take, platform-wide?"                       | `AuditLog`                                           |
| "What happened across the organisation, in human terms, for anyone with visibility?" | Activity Centre (composed live from `WorkflowEvent`) |

## Why this matters for future work

A future domain (or a future Notifications channel) should never introduce a
FIFTH way to record "something happened." If a new feature needs "what happened,"
the question to ask first is: does this fit one of the four existing purposes
above? In every case so far, it has. `Notification` itself is the one legitimately
new concept Sprint 27 introduced — and even it is explicitly downstream of
`WorkflowEvent`, never a second source of truth for whether something happened.

**A concrete rule that follows from this**: nothing in the Notifications domain
ever decides "did this happen" independently — it only decides "who should be
told, and how" about something `WorkflowEvent` already recorded as having
happened. If a future channel (email, SMS) is added, it consumes the same
`WorkflowEvent`→recipient pipeline this document describes; it does not get its
own parallel "did this happen" log.
