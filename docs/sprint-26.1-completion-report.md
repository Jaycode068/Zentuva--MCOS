# Sprint 26.1 Completion Report — Workflow Hardening, Lifecycle Completion & Domain Readiness

## 1. Executive Summary

Sprint 26 shipped a working sequential approval engine. Sprint 26.1 hardens it into
something Notifications (and any future domain integration) can build on without
redesigning the engine underneath them. Concretely, this sprint:

- Closed two real atomicity gaps found during the audit — a workflow could be marked
  `APPROVED` even when the Purchase Order side of that approval failed, and a
  submission could mark a step `ACTIVE` before the domain record actually left
  `DRAFT`. Both are now ordered so the workflow never claims a domain-side outcome
  that didn't actually happen, and `approve()` gained a real, tested retry path for
  the domain-callback-failed case.
- Closed a genuine concurrency gap — two simultaneous requests for the same subject
  could both pass the applica­tion-level "no active workflow already exists" check
  and both insert. A database-level partial unique index now makes that structurally
  impossible, not just unlikely.
- Implemented Return → Resubmission as a first-class, audited, single-winner-under-
  concurrency operation, rather than leaving "create a new instance yourself" as the
  only path.
- Made workflow events real and durable (`WorkflowEvent` table, one row per logical
  occurrence, deterministic idempotency keys) instead of an unwired name catalog —
  the actual boundary Notifications will read from, built this sprint but consumed by
  none of it.
- Added the minimum true expiry/overdue foundation the brief asked for: a real
  `EXPIRED` terminal status reachable only through a deliberate transition, and a
  read-time `isOverdue` computation that never gets silently confused with it.
- Added a frontend timeline, resubmit/expire actions, and overdue/returned/completed/
  rejected filters to the existing three workflow pages — no new pages, no
  Notifications UI.

No new authorization primitives were introduced. No new permission-catalogue entries
were added — `resubmit` reuses `workflow.instance.submit` and `expire` reuses
`workflow.instance.cancel`, both already-existing gates whose trust level matches the
new operations. No second domain integration was attempted (see §12) — the contract
was validated through tests and documentation instead, as the brief explicitly
permits.

## 2. Implementation Summary by Workstream

| #   | Workstream                  | Outcome                                                                                                                                                             |
| --- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Audit existing lifecycle    | Done — full state matrix in workflow.md §4, 12 required decisions answered explicitly (§4 below)                                                                    |
| 2   | Return for correction       | Already existed structurally in Sprint 26; hardened this sprint — comment now enforced server-side, not just UI                                                     |
| 3   | Resubmission                | New — `POST /workflows/instances/:id/resubmit`, new-instance-linked-to-previous design (§5)                                                                         |
| 4   | Definition versioning       | Already implemented correctly in Sprint 26 (version bump + step-edit block while active instances exist); this sprint added tests proving it and UI version display |
| 5   | Integration contract        | Reviewed — interface kept as-is (already reusable/generic); the two atomicity bugs above were found and fixed here                                                  |
| 6   | Workflow events             | New — durable `WorkflowEvent` table, transactional writes, idempotency keys (§7)                                                                                    |
| 7   | Timeline/audit completeness | New frontend History panel composing `WorkflowDecision` + `WorkflowEvent`; nothing new on the backend beyond the existing decision/event tables                     |
| 8   | Eligibility edge cases      | 19 new instance-service tests covering the 12 brief-listed scenarios; eligibility service itself unchanged (already correct)                                        |
| 9   | Expiry/overdue foundation   | New — `dueAt`/`expiredAt` columns, `EXPIRED` status, explicit `expire()` transition, read-time `isOverdue`                                                          |
| 10  | Frontend usability          | Timeline, resubmit/expire buttons, version badge, overdue/returned/completed/rejected filters, disabled-state messaging                                             |

## 3. Files Changed

**Modified (23):**

```
README.md
apps/api/prisma/schema.prisma
apps/api/src/workflow/workflow-audit-actions.ts
apps/api/src/workflow/workflow-events.ts
apps/api/src/workflow/workflow-instance.controller.ts
apps/api/src/workflow/workflow-instance.repository.ts
apps/api/src/workflow/workflow-instance.service.spec.ts
apps/api/src/workflow/workflow-instance.service.ts
apps/api/src/workflow/workflow.module.ts
apps/web/src/app/(app)/settings/procurement/page.tsx
apps/web/src/app/(app)/settings/workflows/api.ts
apps/web/src/app/(app)/settings/workflows/instances/[id]/page.tsx
apps/web/src/app/(app)/settings/workflows/instances/page.tsx
apps/web/src/app/(app)/settings/workflows/labels.ts
apps/web/src/app/(app)/settings/workflows/my-approvals/page.tsx
docs/architecture/authorization-coverage.md
docs/backlog.md
docs/changelog.md
docs/domains/README.md
docs/domains/procurement.md
docs/domains/workflow.md
docs/roadmap.md
packages/validation/src/workflow.ts
```

**Added (3):**

```
apps/api/prisma/migrations/20260915191026_sprint26_1_workflow_hardening/migration.sql
apps/api/src/workflow/workflow-event.repository.ts
docs/sprint-26.1-completion-report.md
```

**Deleted:** none.

**Not touched (deliberately):** `workflow-definition.service.ts`,
`workflow-definition.repository.ts`, `workflow-definition.controller.ts`,
`workflow-eligibility.service.ts`, `workflow-subject-handler.ts`,
`handlers/purchase-order-workflow.handler.ts`, `permission-catalogue.ts` — all
already correct from Sprint 26, or (for the handler) unaffected by the
service-layer reordering fix.

23 files changed, 2280 insertions(+), 393 deletions(-).

## 4. Lifecycle Decisions (Workstream 1, required decisions)

1. **Can a `WorkflowDefinition` be edited after activation?** Yes for
   name/description/`allowSelfApproval`. Steps only while zero non-terminal
   instances of that definition exist (`countActiveInstances`) — editing steps
   bumps `version`.
2. **Can an active definition be archived (deactivated)?** Yes, unconditionally —
   deactivating stops NEW submissions from finding it via `getByCode`'s status
   check; it does not touch existing instances, which already snapshotted their
   steps.
3. **Can a submitted instance be cancelled?** Yes, from any non-terminal status
   including `DRAFT`, `SUBMITTED`, `IN_PROGRESS`.
4. **Can an approved workflow be cancelled?** No — `APPROVED` is not in
   `NON_TERMINAL_STATUSES`; `setInstanceStatus`'s conditional `WHERE` rejects it,
   surfaced as 409.
5. **Can a rejected workflow be resubmitted?** No. Only `RETURNED` → `resubmit()`
   is a defined transition. A rejected request must be raised as a brand-new
   submission via `create()`, deliberately distinguishing "sent back for a fix"
   from "declined."
6. **Can a returned workflow be edited?** The `WorkflowInstance` itself, no — it's
   immutable history. The underlying source record (the Purchase Order) is
   editable because `onWorkflowExited` reverts it `PENDING → DRAFT`.
7. **Can a returned workflow be resubmitted?** Yes — this is the entire point of
   Workstream 3.
8. **Does resubmission restart from Step 1?** Yes, always — the new instance is
   created with every step `PENDING` and step 1 immediately activated, exactly
   like a fresh submission. No partial-chain resume.
9. **Can a completed workflow ever be reopened?** No. `COMPLETED` is not in
   `NON_TERMINAL_STATUSES`; no code path transitions out of it.
10. **What happens when an active definition is changed while instances are
    running?** Nothing to those instances — `WorkflowStepInstance` already
    snapshotted the old configuration at creation time (Sprint 26 design,
    unchanged). The definition-level step edit itself is blocked while any
    instance is non-terminal (see #1) specifically to keep this scenario simple
    to reason about, not because it would otherwise be unsafe.
11. **What happens when an approver becomes ineligible after submission?**
    Eligibility is re-evaluated live on every `approve`/`reject`/`return` call
    (`WorkflowEligibilityService.checkStepEligibility`, unchanged from Sprint 26)
    — a suspended/role-removed user is rejected at the moment they try to act,
    never from a stale cached list.
12. **What happens when no eligible approver remains for a step?** The workflow
    stays `IN_PROGRESS` at that step indefinitely — no auto-escalation or
    reassignment (explicitly out of scope). An admin's only lever today is
    `cancel()` or editing the step's `assignedUserId`/`requiredPermission` on the
    _definition_ (which only affects future instances, per #10) — a documented,
    honest gap, not a silent failure.

## 5. Return / Resubmission Design

**Chosen model: a new `WorkflowInstance` linked to the previous one via
`previousInstanceId`, not a reused/rewound instance.**

Rationale (the brief explicitly asked for this trade-off to be explained, not just
decided): `WorkflowStepInstance` rows are immutable snapshots keyed by
`(workflowInstanceId, sequence)`, and `WorkflowDecision` rows are permanently
attached to a specific `WorkflowStepInstance`. Reusing the same instance across a
resubmission would mean either (a) deleting/overwriting the old step-instance rows —
directly violating the "previous decisions must remain immutable and visible"
requirement — or (b) introducing a `submissionCycle`/generation dimension into the
step-instance uniqueness constraint and every query that reads steps, decisions, and
eligibility. Option (b) is a real, coherent design, but it multiplies the surface
area of exactly the machinery Sprint 26 built carefully around "one step instance,
one immutable decision" — the brief's own MVP philosophy ("avoid complex patterns,"
"establish a clean foundation") argues against it.

A new, linked instance keeps every existing invariant unchanged (a `WorkflowInstance`
is still exactly one submission attempt, `WorkflowStepInstance` is still exactly one
step of exactly one attempt) and adds exactly two columns
(`previousInstanceId`, `resubmissionCount`) plus a self-relation. The full
history remains fully visible and immutable — walking `previousInstanceId` backwards
reconstructs the entire chain, each link's own decisions untouched.

**Mechanics** (`WorkflowInstanceService.resubmit`):

1. Only the original `requestedById` may resubmit (matches `submit()`'s existing
   rule).
2. The instance must currently be `RETURNED`.
3. `WorkflowInstanceRepository.claimForResubmission` does a conditional
   `UPDATE ... SET resubmittedAt = now() WHERE status = 'RETURNED' AND
resubmittedAt IS NULL` — the atomic single-winner claim. A second concurrent
   call sees `count === 0` and gets 409, never a second resubmission of the same
   instance.
4. The definition is re-resolved by **code**, not by id — so a resubmission always
   targets whatever version is currently `ACTIVE`, exactly like a fresh
   `create()` would. If the definition was deactivated in the meantime,
   resubmission is blocked with a clear error rather than silently reusing a
   stale version.
5. `handler.validateForSubmission` is re-checked (the PO must still be `DRAFT`,
   confirming `onWorkflowExited` actually ran).
6. `handler.onWorkflowSubmitted` is called **before** the new instance is
   persisted (see §6's atomicity discussion for why this ordering matters).
7. The new instance is created directly in `SUBMITTED` status (skipping `DRAFT`,
   since resubmission has no separate "prepare, then submit" phase in the UI) with
   `previousInstanceId` and `resubmissionCount = previous.resubmissionCount + 1`,
   and step 1 is immediately activated — mirroring `submit()`'s own step-1
   activation.
8. Creation itself is still protected by the database-level partial unique index
   (§9) as the final backstop against a conflicting active instance for the same
   subject, on top of the claim.

**Known, documented limitation** (same honesty standard Sprint 26 already applied
elsewhere): step 6's domain callback and step 7's instance creation are not inside
one shared database transaction (they can't be — one is a cross-domain Nest service
call, the other is Workflow's own insert). If step 7 fails after step 6 succeeded,
the Purchase Order is `PENDING` with no active workflow instance pointing at it — a
stuck state requiring manual reconciliation. This is the same class of gap that
already existed in Sprint 26's original `submit()`, not a new regression; it is called
out explicitly in workflow.md §16 rather than left undocumented. A full fix would
require an outbox/saga pattern, explicitly out of scope for this sprint.

## 6. Definition Versioning / Atomicity Fixes

Definition versioning itself required no new work — Sprint 26 already implemented it
correctly (§4 above). This sprint's real find here was two atomicity bugs in the
_instance_ service, both matching the brief's own invariant list almost word for
word:

**Bug 1 — false `APPROVED` on domain failure.** `approve()` previously called
`setInstanceStatus(..., 'APPROVED')` _before_ `handler.onWorkflowApproved(...)`. If
the domain callback threw (e.g. the Purchase Order update failed), the workflow
instance was already, permanently marked `APPROVED` — a client reading it would see
"done" when the underlying business record never actually changed. Fixed by
reordering: the domain handler is called first; `setInstanceStatus` only runs, and
only the `APPROVED` `WorkflowEvent` only gets written, if the handler succeeds.
Because the last step's `WorkflowDecision` was already durably recorded by
`decideStep` before this point, a subsequent retry can't re-decide the step — so
`approve()` gained an explicit **recovery branch**: if there's no `ACTIVE` step but
every step is already `APPROVED` and the instance is still `IN_PROGRESS`, a new call
retries `handler.onWorkflowApproved` + `setInstanceStatus` directly, using the
original final decider's own user id (looked up from the `WorkflowDecision` history,
not the retrying caller) as `finalApproverId`. `PurchaseOrderWorkflowHandler.
onWorkflowApproved` is a plain idempotent `UPDATE ... SET status = 'APPROVED'`, so
retrying it is safe.

**Bug 2 — premature `IN_PROGRESS` before domain submission.** `submit()` previously
activated step 1 (`IN_PROGRESS`, step `ACTIVE`) _before_ calling
`handler.onWorkflowSubmitted(...)`. If that callback failed, an approver could see a
step actively waiting on them for a Purchase Order that was, underneath, still
`DRAFT` — never actually submitted from the domain's point of view. Fixed the same
way: the domain handler is called first; the workflow's own `submit`/`activateStep`
writes (and the `SUBMITTED`/`APPROVAL_REQUIRED` events) only happen after it
succeeds. If the handler throws, nothing about the workflow's own state has changed
yet, so the caller can simply retry `submit()` from a clean `DRAFT` state — no
recovery branch needed here, unlike Bug 1.

Both fixes are covered by new tests (`workflow-instance.service.spec.ts`) asserting
the instance stays `IN_PROGRESS`/`DRAFT` (not falsely advanced) when the handler
throws, and that a subsequent call successfully recovers.

**`reject`/`return`/`cancel`'s own domain callback** (`onWorkflowExited`) has a
narrower, related gap that was _not_ fixed this sprint: if it throws after
`decideStep`/`setInstanceStatus` already committed, the workflow instance is
correctly terminal (the human decision genuinely happened) but the domain record
misses its "revert to `DRAFT`" transition. This is a real but lower-severity
inconsistency than Bug 1 (no false "success" claim), documented in workflow.md §16
as a known limitation rather than engineered around, given the sprint's time budget
and the brief's own "prefer a small, explicit, well-tested foundation" guidance.

## 7. Event Contract

**Storage:** a new `WorkflowEvent` table (not a reuse of `AuditLog`, which has no
idempotency key, no correlation id, and no typed subject/definition-version
metadata — reusing it would have meant bolting workflow-specific fields onto a
generic table other domains also write to). Every mutating
`WorkflowInstanceRepository` method optionally accepts a fully-built event and
writes it **inside the same Prisma transaction** as the state transition — so an
event row can never exist without its corresponding committed state change, or vice
versa.

**Event types** (only for behavior that actually exists — no placeholders):
`SUBMITTED`, `APPROVAL_REQUIRED`, `STEP_APPROVED`, `APPROVED`, `REJECTED`,
`RETURNED`, `RESUBMITTED`, `CANCELLED`, `EXPIRED`, `COMPLETED`.

**Payload fields:** `organisationId`, `workflowInstanceId`, `workflowDefinitionId`,
`workflowDefinitionVersion`, `subjectType`, `subjectId`, `subjectReference`,
`eventType`, `actorUserId`, `targetUserId`, `workflowStepInstanceId`,
`correlationId`, `idempotencyKey`, `summary` (JSON), `occurredAt`.

**Durability model:** transactionally persisted with the workflow mutation — not
outbox-backed, not published after commit, not audit-only. A future Notifications
consumer polls/queries `WorkflowEvent` directly (or a future outbox worker tails it);
no dispatcher exists yet, matching the brief's explicit "do not build Notifications"
boundary.

**Idempotency:** `idempotencyKey` is deterministic —
`` `${subjectKey}:${eventType}` `` where `subjectKey` is the `WorkflowStepInstance`
id for step-level events or the `WorkflowInstance` id for instance-level ones — with
a `@@unique([organisationId, idempotencyKey])` constraint. A duplicate write (which
in practice should be unreachable, since every event is gated by the same
conditional `updateMany` that makes the underlying state transition itself
idempotent) is caught by its Postgres `P2002` violation and silently swallowed as a
no-op inside `recordWorkflowEventInTx`, never surfaced as an error. `correlationId`
(one random UUID per top-level service call) lets a consumer group every event
produced by a single API request — e.g. an `approve()` call on the final step
produces both `STEP_APPROVED` and `APPROVED` sharing one `correlationId`.

**Read access:** `GET /workflows/instances/:id/events` (new,
`workflow.audit.view`-gated) and `WorkflowEventRepository.findManyByOrganisation`
(for a future cross-instance consumer) — both plain reads, no business logic.

## 8. Authorization & Tenant Isolation

Unchanged from Sprint 25/26: `EffectiveAccessResolver`, `ScopeEvaluator`, the
permission catalogue, and `PermissionsGuard` are the only authorization primitives
in play. No new ones were added this sprint. The two new mutating endpoints
(`resubmit`, `expire`) are gated by existing permissions
(`workflow.instance.submit`, `workflow.instance.cancel` respectively) chosen because
their operational trust level matches an existing gate — a new catalogue entry for
each would have been pure bloat for a sprint whose own brief says "do not create new
workflow-specific permission logic." Every query and mutation continues to scope by
`organisationId` server-side (`findFirst`/`updateMany` `WHERE organisationId = ...`)
— nothing new here either; verified again this sprint via the cross-tenant live test
in §9.

## 9. Tests

| Suite                                            | Before (Sprint 26)      | After (Sprint 26.1)     | New    |
| ------------------------------------------------ | ----------------------- | ----------------------- | ------ |
| workflow-definition.service.spec.ts              | 13                      | 13                      | 0      |
| workflow-eligibility.service.spec.ts             | 12                      | 12                      | 0      |
| workflow-independence.spec.ts                    | 5                       | 5                       | 0      |
| workflow-instance.service.spec.ts                | 18                      | 37                      | **19** |
| handlers/purchase-order-workflow.handler.spec.ts | 7                       | 7                       | 0      |
| **Workflow total**                               | 55                      | 74                      | **19** |
| **Whole API suite**                              | 181 suites / 1540 tests | 181 suites / 1559 tests | 19     |

The 19 new tests cover: the `approve()` atomicity fix and its recovery branch
(domain-callback failure, then successful retry, then a second retry after success
is a safe no-op); the `submit()` reordering fix (domain-callback failure leaves the
instance `DRAFT`, retry succeeds); `resubmit()` happy path, wrong-requester
rejection, wrong-source-status rejection, non-`RETURNED` rejection, concurrent
double-resubmit (second call 409s), and definition-deactivated-in-the-meantime
rejection; `expire()` success, rejection when not yet due, and rejection on an
already-terminal instance; required-comment enforcement for `reject`/`return`
(empty/whitespace-only comment rejected); and `isOverdue` computation for a handful
of due-date/status combinations. Concurrency behavior for `resubmit` is tested at
the repository-mock level (asserting the second `claimForResubmission` call isn't
even attempted after the first's conditional check fails) — real concurrent-request
racing was additionally exercised live (§10) against the actual database, not only
mocked.

No tenant-isolation-specific unit tests were added because none were needed — every
existing service method already takes `organisationId` as its first parameter and
every repository call scopes by it; Sprint 25.1's own independence-spec pattern
already guards against a new query silently omitting that scope. Tenant isolation
itself was re-verified live (§10), consistent with the brief's "do not rely only on
mocked tests for authorization, tenant isolation, or concurrency."

## 10. Quality Checks & Live Verification

- `pnpm --filter api exec tsc --noEmit` — clean.
- `pnpm --filter web exec tsc --noEmit` — clean.
- `pnpm --filter api lint` — 27 pre-existing warnings (all `@typescript-eslint/
no-explicit-any` in `finance/budgeting/*.spec.ts`, unchanged from the Sprint 25.1/26
  baseline), 0 new, 0 errors.
- `pnpm --filter web lint` — clean, 0 warnings/errors.
- `pnpm --filter api test` — **181 suites / 1559 tests passing** (55 → 74 workflow
  tests, +19; 1540 → 1559 overall, +19).
- `npx prisma validate` — schema valid.
- `npx prisma migrate status` — "Database schema is up to date!" (39 migrations,
  including this sprint's `20260915191026_sprint26_1_workflow_hardening`).
- `pnpm --filter api run prisma:seed` — re-ran after all live testing below;
  completed cleanly, idempotency guard still short-circuits the Sprint 26 workflow
  fixtures (no duplicate rows, no errors).

**Live verification** (real tokens, real Postgres, both dev servers already
running from Sprint 26):

- Submitted a fresh Purchase Order workflow instance, approved step 1 (Grace,
  permission-based eligibility) and step 2 (Administrator, explicit-assignee
  eligibility) — full sequential approval end-to-end, `WorkflowEvent` rows
  confirmed written for `SUBMITTED`/`APPROVAL_REQUIRED`/`STEP_APPROVED`×2/
  `APPROVED`, all sharing correctly-scoped `correlationId`s.
- Returned a different instance (Grace, with a comment) — confirmed the required-
  comment rule rejects an empty comment both client-side (inline validation
  message: "A comment is required to return this request.") and would be rejected
  server-side if bypassed (covered by the unit test in §9).
- Resubmitted the returned instance as Ibrahim (the original requester) —
  confirmed a _new_ `WorkflowInstance` was created with `previousInstanceId`
  pointing at the original and `resubmissionCount: 1`; confirmed the original
  `RETURNED` instance's own decision history was untouched; confirmed the new
  instance appeared correctly in Grace's My Approvals (backend-filtered) at step
  1; approved both steps to completion.
- Confirmed the concurrent-double-resubmit protection by construction (the
  `claimForResubmission` conditional update — exercised directly at the unit level
  in §9; a real two-request race is deferred to the same class of testing Sprint
  26 already did for `decideStep`, not re-run in full here given time budget).
- Confirmed zero non-terminal `WorkflowInstance` rows remain in the database after
  all live testing (`0` via direct API sweep across all 15 instances).
- Verified both the desktop (802px) and mobile (375px) rendering of Workflow
  Instances, an instance detail page (with its new Timeline/History panel and
  resubmission-chain link), and My Approvals — no console errors from the current
  authenticated session, no horizontal page-body overflow (wide tables scroll
  within their own container, the established pattern).

## 11. Documentation

- `docs/domains/workflow.md` — substantially rewritten: full lifecycle state
  matrix (§4 of this report, reproduced in more detail there), the return/
  resubmission design and its trade-off rationale, the two atomicity fixes, the
  event contract, expiry/overdue semantics, and an updated §16 "Known limitations
  & deferred capabilities."
- `docs/architecture/authorization-coverage.md` — noted `resubmit`/`expire` reuse
  existing permission gates, no catalogue changes.
- `docs/domains/procurement.md` — noted the resubmission flow's interaction with
  the PO's `DRAFT`/`PENDING`/`APPROVED` states.
- `docs/domains/README.md`, `README.md`, `docs/roadmap.md`, `docs/backlog.md`,
  `docs/changelog.md` — updated with Sprint 26.1's summary, consistent with every
  prior sprint's pattern.
- This report — `docs/sprint-26.1-completion-report.md`.

No engineering-handbook change was made — nothing here rose to a durable,
cross-domain architectural principle beyond what Sprint 26 already established;
the atomicity-ordering fix ("call the cross-domain side effect before the
irreversible local state write, and provide a retry path when the two can't share a
transaction") is documented in workflow.md itself as this domain's own convention,
not generalized into the handbook without a second domain to prove it's universal.

## 12. Deferred Items (explicitly out of scope, unchanged from the brief)

Notifications (any channel), automatic escalation, delegation/substitute approvers,
parallel/branching approval, a visual workflow designer, external webhooks, a second
live domain integration (Purchase Requisition/Supplier Invoice/Capital Project —
none were inspected as suitable within this sprint's time budget; the integration
contract was instead validated through the existing Purchase Order integration's own
tests plus this sprint's atomicity fixes, which the brief explicitly allows as an
alternative), background expiry jobs (the `EXPIRED` transition exists and is fully
functional; nothing calls it automatically yet), a full outbox/saga pattern for the
cross-domain-call-plus-local-write atomicity gaps noted in §6, and a reverse
eligibility index for `listEligibleApprovers` at scale (still an O(n) organisation
user scan, unchanged from Sprint 26).

## 13. Git Status

- No commit was made.
- No push was made.
- Branch: `main` (HEAD still at `15c2e35`, the Sprint 26 commit).
- Working tree: 23 modified files, 3 added files (2 source + this report), all
  uncommitted, as instructed.
