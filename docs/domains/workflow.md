# Workflow & Approval Domain

- **Status:** MVP sequential approval engine implemented (Sprint 26); hardened —
  return/resubmission, durable events, expiry foundation, domain-integration
  atomicity — Sprint 26.1.
- **Sprint:** 26, 26.1
- **Depends on:** [Access Control](access-control.md) (`EffectiveAccessResolver`,
  `ScopeEvaluator`, the permission catalogue — Workflow introduces zero new
  authorization primitives), [Procurement](procurement.md) (the one domain integration
  implemented so far), [Identity](identity.md) (tenant boundary, `User`),
  [ADR-002 — Modular Monolith](../adr/ADR-002-modular-monolith.md),
  [ADR-003 — Multi-Tenancy](../adr/ADR-003-multi-tenancy.md)
- **See also:** [Sprint 26 Completion Report](../sprint-26-completion-report.md),
  [Sprint 26.1 Completion Report](../sprint-26.1-completion-report.md)

## 1. Domain Purpose

Workflow answers a question Access Control deliberately does not: **is an approval
currently required for this specific record, what step is it on, and whose turn is
it?** Access Control (Sprint 25/25.1) answers a different question — **is this user
authorised to perform this action at all** — and the two must stay separate (§2 of the
Sprint 26 brief, restated here as this domain's central rule):

- A user can hold `procurement.purchase_order.approve` and still have nothing to
  approve, because no workflow step is currently active for them.
- A user can be the requester of a Purchase Order and still be unable to approve it —
  not because they lack the permission, but because the workflow's self-approval
  policy forbids it.

Workflow is a **reusable, tenant-configurable engine**, not a Purchase-Order-specific
feature. Every organisation configures its own approval processes — there is no
hardcoded `Procurement Officer → Finance Manager → GM` chain anywhere in the code, no
`user.position === 'GM'` check, no assumption that every organisation even has
approval requirements for a given action. The engine is generic; Purchase Order
approval (§8) is this sprint's one concrete, fully-wired example of configuring it.

## 2. Access Control Integration

### 2.1 Workflow never re-implements authorization

Every eligibility check in this domain (`WorkflowEligibilityService`, see §6) calls
`EffectiveAccessResolver.resolve()` and `ScopeEvaluator.hasAny`/`hasScope` — the exact
same primitives `PermissionsGuard` uses to protect every other domain's endpoints. No
new `Role`/`Permission` table, no workflow-specific "approver" concept independent of
the permission catalogue, no role-name or position/title string comparison anywhere in
`src/workflow/` — enforced executably by `workflow-independence.spec.ts`'s
`"never a raw role-name or position/department string comparison"` guard.

### 2.2 Two authorization layers, on purpose

A workflow endpoint is protected twice, and the two checks answer different questions:

1. **Controller-level `@RequirePermission`** (a coarse, static gate) — "may this user
   use the workflow engine's approval machinery at all?" E.g.
   `POST /workflows/instances/:id/approve` requires `workflow.approval.approve`.
2. **Service-level eligibility check** (`WorkflowEligibilityService`, dynamic, per
   request) — "is this specific user eligible for the specific step that is currently
   active?" This is the real authorization decision, and it cannot be a static
   decorator: a `WorkflowStep`'s `requiredPermission` is organisation-configured data,
   not a compile-time constant.

Holding `workflow.approval.approve` alone approves nothing — it only gets the caller
past layer 1. Layer 2 is what actually decides.

### 2.3 New permissions (Sprint 26)

Nine new coarse, engine-level permissions, plus one new domain-specific permission for
the Purchase Order integration. All follow the existing `module.resource.action`
convention (access-control.md §4) — none are new authorization _primitives_, just new
catalogue rows:

| Permission                           | scopeType | Purpose                                                                     |
| ------------------------------------ | --------- | --------------------------------------------------------------------------- |
| `workflow.definition.view`           | NONE      | View workflow definitions and their steps                                   |
| `workflow.definition.manage`         | NONE      | Create/edit/activate/deactivate definitions and steps                       |
| `workflow.instance.view`             | NONE      | View all workflow instances (admin-wide)                                    |
| `workflow.instance.submit`           | NONE      | Create and submit a workflow instance                                       |
| `workflow.instance.cancel`           | NONE      | Cancel a workflow instance                                                  |
| `workflow.approval.view`             | NONE      | Access "My Approvals" (baseline gate)                                       |
| `workflow.approval.approve`          | NONE      | Call the approve endpoint (baseline gate)                                   |
| `workflow.approval.reject`           | NONE      | Call the reject endpoint (baseline gate)                                    |
| `workflow.approval.return`           | NONE      | Call the return endpoint (baseline gate)                                    |
| `workflow.audit.view`                | NONE      | View a workflow instance's decision history                                 |
| `procurement.purchase_order.approve` | SCOPABLE  | The first `WorkflowStep.requiredPermission` this sprint actually configures |

Before adding these, the existing 121-entry catalogue (Sprint 25.1 baseline) was
searched for a fit — none existed; Workflow's approval/submission/cancellation actions
are genuinely new distinctions, not duplicates of an existing permission under a
different name. `procurement.purchase_order.approve` is `SCOPABLE` (not `NONE`) for
future-proofing — an organisation may eventually want to scope approval authority (e.g.
by future territory/department data), even though this sprint's own seed data grants it
only at `ORGANISATION` scope (§6's honesty note explains why nothing narrower is
mechanically meaningful yet).

## 3. Data Model

Five new tables, all under a new top-level `workflow` domain module (matching the
"one top-level directory per domain" convention `assets/`/`maintenance/`/`hr/`/
`access-control/` already established).

### 3.1 `WorkflowDefinition`

A tenant-scoped, versionable description of an approval process.

| Field                       | Notes                                                                                                                                                                                                                        |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `organisationId`            | Tenant scope, like every other table in this codebase                                                                                                                                                                        |
| `name`                      | Display name, e.g. "Purchase Order Approval"                                                                                                                                                                                 |
| `code`                      | Stable, organisation-chosen identifier a domain integration submits against (e.g. `PURCHASE_ORDER_APPROVAL`) — unique **per organisation**, not globally, so two tenants may each define their own `PURCHASE_ORDER_APPROVAL` |
| `subjectType`               | The domain subject this definition applies to (e.g. `PURCHASE_ORDER`) — one definition serves exactly one subject type                                                                                                       |
| `status`                    | `ACTIVE` \| `INACTIVE` — defaults `INACTIVE`; a definition with zero steps cannot be activated (§5's validation)                                                                                                             |
| `version`                   | Bumped on every edit to an already-`ACTIVE` definition's steps — informational; the authoritative freeze is the `WorkflowStepInstance` snapshot (§3.4), not this counter                                                     |
| `allowSelfApproval`         | Defaults `false` — see §5's self-approval policy                                                                                                                                                                             |
| `createdById`/`updatedById` | Plain nullable string columns, no FK relation — same convention as `AuditLog.actorUserId`/`PurchaseOrder.createdById`                                                                                                        |

### 3.2 `WorkflowStep`

A configured step within a `WorkflowDefinition`. Sequential MVP only — `sequence` is a
strict total order, one step active at a time (§7).

| Field                | Notes                                                                                                                                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`/`code`        | Display name + stable code, unique within the definition                                                                                                                                                                  |
| `sequence`           | The step's position; unique within the definition                                                                                                                                                                         |
| `requiredPermission` | A `Permission.key` from the existing catalogue — validated against the live catalogue at create/update time (never a new permission concept)                                                                              |
| `requiredScope`      | Optional `AccessScope?` — when set, eligibility additionally requires the candidate hold `requiredPermission` at (at least) this scope, not merely "granted at all"                                                       |
| `assignedUserId`     | Optional explicit approver — must belong to the same organisation (validated at write time) and still separately passes the permission/scope check at approval time; an explicit assignment never bypasses Access Control |
| `active`             | Reserved for future step-level enable/disable without a full definition edit; not yet exposed in the admin UI                                                                                                             |

Scoped through their parent `WorkflowDefinition` — no own `organisationId` column, same
convention as `PurchaseOrderItem`/`SalesOrderItem`.

### 3.3 `WorkflowInstance`

A runtime execution of a `WorkflowDefinition` against one business record.

| Field                                              | Notes                                                                                                                                     |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `workflowDefinitionId`/`workflowDefinitionVersion` | The definition version snapshotted at creation — informational; the authoritative per-step snapshot lives on `WorkflowStepInstance`       |
| `subjectType`/`subjectId`                          | References an existing domain record through the controlled `WorkflowSubjectHandler` registry (§7) — never arbitrary dynamic table access |
| `status`                                           | `DRAFT` → `SUBMITTED` → `IN_PROGRESS` → `APPROVED` \| `REJECTED` \| `RETURNED` \| `CANCELLED` → `COMPLETED` (§4)                          |
| `requestedById`                                    | The submitter — used for self-approval-policy checks                                                                                      |
| `submittedAt`/`completedAt`/`cancelledAt`          | Nullable timestamps, set on the matching transition                                                                                       |

### 3.4 `WorkflowStepInstance`

A runtime copy of one `WorkflowStep`, **snapshotted at `WorkflowInstance` creation
time** (not at submission) — so a later edit to the still-`ACTIVE` `WorkflowDefinition`
never silently rewrites an in-progress approval. Every enforcement decision reads the
snapshot columns (`requiredPermissionSnapshot`, `requiredScopeSnapshot`,
`assignedUserIdSnapshot`, `stepNameSnapshot`), never the live `WorkflowStep` row.
`definitionStepId` is kept for traceability only (`onDelete: SetNull` — deleting a
step definition, rare since steps are normally deactivated not deleted, must never
corrupt a historical instance's snapshot). `status`:
`PENDING` → `ACTIVE` → `APPROVED` \| `REJECTED` \| `RETURNED` \| `CANCELLED`. Only one
step instance is ever `ACTIVE` at a time per workflow instance.

### 3.5 `WorkflowDecision`

An immutable record of one action taken on a `WorkflowStepInstance`. Never updated or
deleted after creation — no `updatedAt` column exists, and no service method ever
mutates one — the same "audit trail is authoritative, not editable" convention
`AuditLog` already establishes elsewhere in this codebase. `decision`:
`APPROVE` \| `REJECT` \| `RETURN` \| `CANCEL`.

### 3.6 Migration

`20260915085005_sprint26_workflow_approval_foundation` — five new tables, four new
enums (`WorkflowDefinitionStatus`, `WorkflowInstanceStatus`,
`WorkflowStepInstanceStatus`, `WorkflowDecisionType`), reusing the existing
`AccessScope` enum for `requiredScope`/`requiredScopeSnapshot`. No changes to any
existing table — `PurchaseOrder.approvedById` (Sprint 4.3, always `null` until this
sprint) is the only pre-existing column this sprint finally populates.

## 4. Workflow Lifecycle

```text
DRAFT → SUBMITTED → IN_PROGRESS → APPROVED → COMPLETED
  ↓          ↓            ↓
  └──────────┴────────────┴──→ CANCELLED                (terminal)
                          ↓
                    REJECTED                             (terminal)
                          ↓
                    RETURNED ──resubmit()──→ (new instance) DRAFT-skipped → SUBMITTED
                          ↓
                    EXPIRED  (Sprint 26.1 — only from DRAFT/SUBMITTED/IN_PROGRESS
                              once dueAt has passed; explicit, never inferred)
```

- **`DRAFT`** — created (`POST /workflows/instances`), not yet submitted. The subject
  itself is untouched at this point; only `submit()` (§5) causes a domain-side effect.
  May be cancelled by the requester (or anyone holding `workflow.instance.cancel`) with
  no subject-side effect, since nothing has changed yet.
- **`SUBMITTED`** — `submit()` has run; step 1 is about to activate. This state is
  momentary in practice (the same call activates step 1 and flips the instance to
  `IN_PROGRESS` within the same request) — kept as its own state per the brief's
  suggested lifecycle rather than collapsed away, so a future integration that needs a
  true "submitted but not yet routed" pause has somewhere to land.
- **`IN_PROGRESS`** — one step is `ACTIVE`.
- **`APPROVED`** — every step approved AND the subject handler's `onWorkflowApproved`
  has already run successfully (Sprint 26.1 atomicity fix, §5.2/§12) — approval and the
  domain-side effect are never two separately-observable moments, and a domain-
  integration failure can never leave the instance falsely claiming `APPROVED`.
- **`REJECTED`** — terminal for _this_ `WorkflowInstance`. No resubmission path exists
  for a rejection (only for `RETURNED`) — a rejected request must be raised again as a
  brand-new submission if the requester still wants to pursue it, a deliberate
  distinction from `RETURNED` (§4.1, §5.2).
- **`RETURNED`** — terminal for _this_ `WorkflowInstance`, but NOT a dead end: the
  dedicated `resubmit()` operation (§5.2) creates a new, linked `WorkflowInstance`
  restarting approval from step 1, once the source record has been corrected.
- **`CANCELLED`** — terminal, reachable from any non-terminal status including `DRAFT`.
- **`EXPIRED`** (Sprint 26.1, §9) — terminal; an explicit, deliberate transition only
  reachable from `DRAFT`/`SUBMITTED`/`IN_PROGRESS` once `dueAt` has passed. Distinct
  from **`OVERDUE`**, which is never a persisted status at all — it is computed at read
  time (`isOverdue` on every `WorkflowInstanceView`) from `dueAt` and the current
  status, so it can never drift out of sync with reality. An expired workflow cannot be
  approved, rejected, returned, or resubmitted — `getActiveStepOrThrow`'s "no active
  step" guard and `resubmit()`'s "only a RETURNED instance" guard both structurally
  exclude it, same as every other terminal status.
- **`COMPLETED`** — the owning domain has consumed the `APPROVED` outcome.
  `WorkflowInstanceService.markCompleted()` exists and is exposed via the domain layer,
  but nothing calls it yet — the Purchase Order integration's `onWorkflowApproved`
  already performs the PO's entire side effect (`PENDING` → `APPROVED`) at the moment
  of final approval, so there is no further "consumption" step for this integration to
  mark complete. Reserved for a future integration whose approved outcome is consumed
  asynchronously (e.g. a nightly batch, or a second manual action).

Reaching `APPROVED` never automatically mutates a business record beyond what the
subject handler's `onWorkflowApproved` explicitly implements (§2.3/§7) — there is no
generic "workflow reached APPROVED, therefore do something" hook outside that one,
deliberate, per-subject-type call.

### 4.1 Lifecycle Matrix

`WorkflowInstance.status`:

| State         | Allowed next states                                                                   | Actor                                                                                                                                                                | Required conditions                                                                          | Terminal? |
| ------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | --------- |
| `DRAFT`       | `SUBMITTED`, `CANCELLED`                                                              | Requester (submit); requester or `workflow.instance.cancel` holder (cancel)                                                                                          | —                                                                                            | No        |
| `SUBMITTED`   | `IN_PROGRESS`                                                                         | System (same request as submit)                                                                                                                                      | Step 1 exists and is `PENDING`                                                               | No        |
| `IN_PROGRESS` | `IN_PROGRESS` (next step), `APPROVED`, `REJECTED`, `RETURNED`, `CANCELLED`, `EXPIRED` | Eligible approver of the `ACTIVE` step (approve/reject/return); `workflow.instance.cancel` holder (cancel); any authenticated actor once `dueAt` has passed (expire) | `WorkflowEligibilityService.checkStepEligibility` passes; comment required for reject/return | No        |
| `APPROVED`    | `COMPLETED`                                                                           | Owning domain (via `markCompleted`, not automatic)                                                                                                                   | Domain has consumed the outcome                                                              | No\*      |
| `REJECTED`    | — (none)                                                                              | —                                                                                                                                                                    | —                                                                                            | Yes       |
| `RETURNED`    | (new linked `WorkflowInstance` in `SUBMITTED`, via `resubmit()`)                      | Original requester                                                                                                                                                   | Source record still valid for submission; not already resubmitted                            | Yes       |
| `CANCELLED`   | — (none)                                                                              | —                                                                                                                                                                    | —                                                                                            | Yes       |
| `EXPIRED`     | — (none)                                                                              | —                                                                                                                                                                    | —                                                                                            | Yes       |
| `COMPLETED`   | — (none — never reopened)                                                             | —                                                                                                                                                                    | —                                                                                            | Yes       |

\* `APPROVED` is practically terminal for approval purposes (no further step decision
is possible) but is not in `NON_TERMINAL_STATUSES` either — it has exactly one further
legitimate transition (`COMPLETED`), modeled as its own precondition
(`WorkflowInstanceRepository.markCompleted`'s `WHERE status = 'APPROVED'`) rather than
folded into the generic non-terminal set.

`WorkflowStepInstance.status`: `PENDING` → `ACTIVE` → `APPROVED` | `REJECTED` |
`RETURNED` | `CANCELLED`. Only one step instance is ever `ACTIVE` per `WorkflowInstance`
(§5). There is no `SKIPPED` state — every step in a sequential chain is always decided
individually; skipping is out of scope (no conditional routing this MVP).

`WorkflowDefinition.status`: `INACTIVE` ⇄ `ACTIVE` (both directions allowed, any
number of times) — see §4.2 for exactly which edits are allowed in which direction.
There is no `ARCHIVED` state distinct from `INACTIVE` — deactivating a definition IS
the archival action; a definition is never hard-deleted (no delete endpoint exists).

### 4.2 Required Decisions (Sprint 26.1 audit)

Explicit answers, restated from the actual implementation (not assumed):

1. **Can a `WorkflowDefinition` be edited after activation?** Yes for `name`/
   `description`/`allowSelfApproval`, always. Editing `steps` is additionally blocked
   while any non-terminal `WorkflowInstance` of that definition exists
   (`WorkflowDefinitionService.update`) — the admin must wait for in-flight instances
   to finish or cancel them first. A successful step edit bumps `version`.
2. **Can an active definition be archived (deactivated)?** Yes, any time, regardless of
   in-flight instances — `deactivate()` has no active-instance guard, because
   deactivating only blocks NEW submissions (`create()` requires `status === 'ACTIVE'`);
   it does not touch any already-running instance's snapshot.
3. **Can a submitted workflow instance be cancelled?** Yes — `cancel()` is reachable
   from any non-terminal status (`DRAFT`/`SUBMITTED`/`IN_PROGRESS`), not only `DRAFT`.
4. **Can an approved workflow be cancelled?** No — `setInstanceStatus`'s conditional
   `WHERE status IN (non-terminal)` excludes `APPROVED`; `cancel()` on an already-
   `APPROVED` instance returns `409 Conflict`.
5. **Can a rejected workflow be resubmitted?** No — only `resubmit()` exists, and it
   requires `status === 'RETURNED'` specifically. A rejected request has no
   resubmission path (§4, §5.2's rationale).
6. **Can a returned workflow be edited?** The `WorkflowInstance` itself, no (its step
   snapshots are immutable). The underlying SOURCE record (e.g. the Purchase Order)
   yes — `onWorkflowExited` reverts it to `DRAFT`, which is directly editable through
   the domain's own normal update endpoint.
7. **Can a returned workflow be resubmitted?** Yes — this is the entire purpose of
   `resubmit()` (§5.2).
8. **Does resubmission restart from Step 1?** Yes, always — the new instance is
   created with every step `PENDING` and step 1 is activated immediately, from
   whichever `WorkflowDefinition` version is CURRENTLY active (§5.2, §5.3).
9. **Can a completed workflow ever be reopened?** No. `COMPLETED` has no outgoing
   transition anywhere in the codebase — not in `WorkflowInstanceRepository`, not in
   `WorkflowInstanceService`.
10. **What happens when an active definition is changed while instances are running?**
    Nothing — running instances read only their own `WorkflowStepInstance` snapshot,
    never the live `WorkflowStep` row (§3.4/§5.3). Step-list edits are additionally
    blocked outright while instances are active (#1 above), so this scenario is
    structurally rare, not just harmless.
11. **What happens when an approver becomes ineligible after submission?** Their next
    approval attempt is denied — eligibility is re-evaluated live on every single
    request, never cached (§6). Live-verified for both suspension and role-removal
    (§15).
12. **What happens when no eligible approver remains for the active step?** The
    `WorkflowInstance` simply stays `IN_PROGRESS` indefinitely — nothing times it out
    or escalates it (escalation is explicit out-of-scope, §16). An administrator can
    still `cancel()` it (permission-gated, no eligibility check required for
    cancellation, §5) or use `GET .../eligible-approvers` to diagnose who, if anyone,
    can currently act.

## 5. Sequential Approval Model

- Only the current `ACTIVE` step can be acted upon — `approve()`/`reject()`/`return()`
  all look up the instance's `ACTIVE` step instance and throw
  `"This workflow instance has no active step to act on"` if none exists (e.g. the
  instance is already terminal).
- A future (`PENDING`) step cannot be approved early — it simply isn't `ACTIVE` yet,
  so it's never the target of an eligibility check or a decision.
- A completed (`APPROVED`/`REJECTED`/`RETURNED`) step cannot be acted upon again — the
  concurrency-safe `decideStep` transition (§13) only succeeds against a step whose
  current status is still `ACTIVE`.
- Approving the last step transitions the instance to `APPROVED` and calls
  `onWorkflowApproved`; approving any earlier step activates the next `PENDING` step
  and the instance stays `IN_PROGRESS`.
- **Self-approval policy**: `WorkflowDefinition.allowSelfApproval` defaults to `false`
  — the requester cannot approve their own request — but is explicitly
  organisation-configurable per definition (never hardcoded true or false in
  application logic). Deliberately **not** snapshotted onto the `WorkflowInstance` —
  unlike `requiredPermission`/`requiredScope` (which are frozen at instance-creation
  time so an admin can never retroactively narrow what a specific in-flight request
  requires), self-approval policy is read live from the current `WorkflowDefinition` at
  decision time. This is a deliberate, documented asymmetry: self-approval is an
  organisation-wide governance toggle meant to apply uniformly to whatever is currently
  in flight, not a per-request commitment worth freezing.
- **Restart/resume rule for `RETURNED`**: `RETURNED` (like `REJECTED` and `CANCELLED`)
  is **terminal for the `WorkflowInstance`** — no step is ever rewound back to
  `PENDING` or re-activated. The subject reverts to an editable state (via the
  handler's `onWorkflowExited`, §7), and correction is resumed via the dedicated
  `resubmit()` operation, §5.2.

### 5.1 Atomicity fix: domain callback before workflow-side state (Sprint 26.1)

Sprint 26's `approve()` called `setInstanceStatus('APPROVED')` **before** the subject
handler's `onWorkflowApproved` — if the domain callback then failed, the
`WorkflowInstance` was already claiming `APPROVED` while the underlying record (e.g.
the Purchase Order) had never actually been updated. Found during this sprint's own
audit (Workstream 1), not reported by a test failure. Fixed by reordering: the handler
now runs first, inside a private `finalizeApproval()`; only if it succeeds does
`setInstanceStatus` run. If the handler throws, the instance stays `IN_PROGRESS` —
truthful ("still not finished"), never a false `APPROVED`.

A parallel, narrower issue existed in `submit()` (`activateStep` before
`onWorkflowSubmitted`) — reordered the same way. Unlike `approve()`, a `submit()`
failure now leaves the instance completely untouched (still cleanly `DRAFT`, since
nothing about the subject had a chance to change before the handler ran), so no
recovery path is needed there — a caller can simply retry `submit()` again.

**Recovery path for `approve()`** specifically: if the LAST step's `decideStep`
succeeded but the subsequent domain callback then failed (e.g. a transient PO-service
error), the instance is left with every step `APPROVED` but its own status still
`IN_PROGRESS` — deliberately, not accidentally, since `finalizeApproval` never ran to
completion. A later call to `approve()` against the same instance detects this exact
condition (no `ACTIVE` step, every step `APPROVED`, instance still `IN_PROGRESS`) and
retries **only** the domain callback + finalization — never a second
`WorkflowDecision` row. This is what makes "repeated integration attempts are safe
where retries are supported" true: `PurchaseOrderWorkflowHandler.onWorkflowApproved` is
a plain idempotent `UPDATE ... SET status = APPROVED`, safe to run twice, and
`setInstanceStatus`'s own conditional `WHERE` makes a retry-after-success a safe no-op.

**Known, narrower, deliberately-unsolved gap**: `reject()`/`return()`/`cancel()`'s
domain callback (`onWorkflowExited`) still runs AFTER the step decision and instance
status are already committed, with no equivalent recovery path. Unlike `approve()`,
reordering isn't safe here — `decideStep`'s race-safe conditional update must be the
FIRST thing that happens (calling the domain handler first, then losing the
concurrency race, would incorrectly revert a subject that a different, winning
decision expects to still be mid-flight). If the callback then fails, the workflow
instance is correctly terminal (the human decision was real) but the domain record may
not have reverted to an editable state — documented honestly here (§16) rather than
solved with additional machinery this sprint; the failure mode is narrow (the callback
is a single conditional `UPDATE`) and the exception is never swallowed (no `catch`
block exists around it, so it surfaces as a real `500` and an application-log entry).

### 5.2 Return & Resubmission Design (Sprint 26.1)

```text
IN_PROGRESS
    ↓ (reject/return on active step, comment required)
RETURNED
    ↓ (requester edits the source record directly, through its own domain endpoint)
resubmit()
    ↓
new WorkflowInstance { previousInstanceId, resubmissionCount: prior + 1 }, SUBMITTED
    ↓ (step 1 activated immediately)
IN_PROGRESS
```

**Chosen model: a new, linked `WorkflowInstance`, not a reused/rewound one.** The brief
offered two options — reuse the same instance with a submission-cycle counter, or
create a new linked instance — and asked for the trade-off to be documented, not
decided casually:

- `WorkflowStepInstance` rows carry `@@unique([workflowInstanceId, sequence])` and are
  immutable, point-in-time snapshots (§3.4) — the entire concurrency-safety and
  auditability model depends on a step instance never being rewritten after its
  decision. Reusing the same `WorkflowInstance` for a second submission cycle would
  require EITHER resetting existing step-instance rows back to `PENDING` in place
  (destroying the first cycle's own decision history — directly violating "previous
  decisions must remain immutable and visible") OR adding a second set of rows for the
  same sequence numbers (violating the unique constraint, or requiring a new
  `submissionCycle` dimension threaded through every query, index, and eligibility
  check in the engine).
- A new, linked instance preserves 100% of the returned instance's history completely
  untouched — nothing about it is ever mutated again — and restarts the approval chain
  from whatever `WorkflowDefinition` version is CURRENTLY active, exactly matching how
  a first-time submission already always uses the live active version. This is the
  simpler of the brief's own two offered options, and the one that best matches the
  sprint's own "establish a clean MVP foundation... avoid complex patterns" guidance.

**Mechanics** (`WorkflowInstanceService.resubmit`):

1. Only the ORIGINAL requester may resubmit (`requestedById` check) — matching
   `submit()`'s own "only the requester" rule.
2. Only a `RETURNED` instance can be resubmitted.
3. **Concurrency — exactly one winner**: `claimForResubmission` is an atomic,
   conditional `updateMany` (`WHERE status = 'RETURNED' AND resubmittedAt IS NULL`) —
   the first concurrent call wins and stamps `resubmittedAt`; every other loses
   (`count === 0`) and receives `409 Conflict`, never a second resubmission of the same
   instance. The database's own partial unique index (§12) additionally guarantees no
   two ACTIVE instances can ever exist for the same subject, independent of this claim.
4. The CURRENT active `WorkflowDefinition` version for the same `code` is looked up
   fresh (not the version the original instance used) — a resubmission always uses
   whatever definition is live right now, same as any first-time submission.
5. The subject handler's `validateForSubmission`/`onWorkflowSubmitted` are re-run,
   exactly as a first-time submission would — the domain callback runs BEFORE the new
   `WorkflowInstance` row is created (same "fail clean" ordering as §5.1's fix): if it
   throws, the claim stays consumed with no new instance created, a narrow known
   limitation documented in §16.
6. A new `WorkflowInstance` is created directly in `SUBMITTED` (not `DRAFT` — a
   resubmission IS a submission, in one action) with `previousInstanceId` pointing at
   the returned predecessor and `resubmissionCount` incremented, every step
   pre-snapshotted `PENDING`, then step 1 is immediately activated.
7. A `RESUBMITTED` event (§7 Workflow Events) is recorded, linked to the new instance.

**Rejected vs. returned, restated**: only `RETURNED` has a resubmission path.
`REJECTED` does not — a rejected request has no "correct and resubmit" flow; the
requester would raise an entirely new, independent submission if they still want to
pursue it. This asymmetry is intentional: reject is meant to communicate "no, and not
in this form," return is meant to communicate "not yet, please fix and try again."

### 5.3 Definition Versioning / Snapshot (formalized, Sprint 26.1)

Sprint 26 already implemented Option A (definition versioning) correctly; Sprint 26.1's
audit confirmed the guarantees hold and added a test proving it (§14). Restated
precisely:

- `WorkflowDefinition.version` bumps only when `steps` are edited on an already-
  `ACTIVE` definition — never on a `name`/`description`/`allowSelfApproval`-only edit.
- Editing `steps` is rejected outright while any non-terminal instance of that
  definition exists (§4.2 #1) — so a version bump can never happen "underneath" a
  running instance; by the time a new version exists, every instance still running on
  the old one has already finished.
- Every `WorkflowInstance` stores `workflowDefinitionVersion` (informational) AND, far
  more importantly, every `WorkflowStepInstance` stores its own full snapshot
  (`stepNameSnapshot`, `requiredPermissionSnapshot`, `requiredScopeSnapshot`,
  `assignedUserIdSnapshot`) at instance-creation time — every enforcement decision
  reads ONLY these snapshot columns, never the live `WorkflowStep` row. A later
  definition edit literally cannot reach an already-created instance's enforcement
  logic, by construction, not by convention.
- Archiving (`deactivate()`) a definition never touches any existing instance — it only
  blocks future `create()` calls (§4.2 #2).
- The admin UI's instance detail page displays `workflowDefinitionVersion`; `resubmit()`
  (§5.2) always targets the CURRENT active version, never the original instance's.

## 6. Eligibility Resolution (`WorkflowEligibilityService`)

`checkStepEligibility(input)` answers, for one candidate user and one step:

1. **Self-approval** — if `!allowSelfApproval && candidateUserId === requestedById`,
   deny immediately.
2. **Explicit assignment** — if the step has an `assignedUserId` and the candidate
   isn't them, deny (`"This step is assigned to a specific approver"`) — an explicit
   assignment narrows eligibility to exactly one person, on top of (never instead of)
   the permission check that follows.
3. **User active** — `EffectiveAccessResolver.resolve()`; a suspended/deactivated
   `User.status` (including one pushed by `EmployeeService.suspend()`, per Access
   Control's own established Identity←HR direction) makes `userIsActive === false` and
   eligibility fails immediately, even against an already-issued, still-valid JWT —
   live-verified in §15.
4. **Permission (+ optional scope)** — `ScopeEvaluator.hasScope()` if the step has a
   `requiredScope`, else `ScopeEvaluator.hasAny()`. Owner bypass and `NONE`-scopeType
   permissions behave exactly as Access Control already documents (access-control.md
   §5) — nothing new here.

`isEligibleCandidate()` is the boolean-only convenience wrapper `WorkflowInstanceService`
calls before every decision — **re-evaluated on every single request**, never a cached
"eligible users" list computed once at submission time. This matters concretely: revoke
a role mid-flight and the very next approval attempt with the same still-valid token
fails (live-verified in §15), exactly like Access Control's own revocation guarantee.

`listEligibleApprovers()` powers `GET /workflows/instances/:id/eligible-approvers` and
the My Approvals filter's underlying data: since `EffectiveAccessResolver` only
resolves access _for_ a given user (there is no reverse "list every user who holds
permission X" index), this fetches every organisation `User` once and re-runs
`checkStepEligibility` per candidate. Fine at this sprint's scale (an organisation's
user list); a real reverse-index is a documented, deferred optimization if this needs
to scale past a few hundred users per organisation.

### Honest scope limitation

A `WorkflowStep.requiredScope` of anything other than `ORGANISATION` (e.g. `OWN_TEAM`)
only proves the candidate **holds that scope granted at all** — it does **not**
additionally verify that the specific business record actually falls within that
scope (e.g. that an `OWN_TEAM`-scoped approver's team genuinely includes whoever raised
this particular Purchase Order). The existing data model has no department/team
relationship on a `PurchaseOrder` to check that against. This sprint's seed data
therefore only configures `ORGANISATION` scope for the one seeded step that has a
scope requirement (§8's Purchase Order Approval definition) — the fully provable,
honest choice — while the data model and guard logic genuinely support narrower
scopes for a future subject type whose domain data _can_ support that check (matching
the same honesty convention Sprint 25.1 established for `sales.order.view`'s
`ASSIGNED_TERRITORY`: "recorded and previewable, not mechanically enforced" where the
underlying relationship doesn't exist).

## 7. Subject References & Domain Integration Boundary

A `WorkflowInstance`'s `(subjectType, subjectId)` reaches into an existing domain
record through exactly one mechanism: a `WorkflowSubjectHandler` implementation,
registered under the `WORKFLOW_SUBJECT_HANDLERS` DI token
(`workflow-subject-handler.ts`). No raw SQL, no dynamic Prisma model-name
interpolation — each handler is an explicit, reviewed, typed class.

```typescript
interface WorkflowSubjectHandler {
  readonly subjectType: string;
  describe(organisationId, subjectId): Promise<string | null>;
  validateForSubmission(organisationId, subjectId): Promise<{ ok; reason? }>;
  onWorkflowSubmitted(organisationId, subjectId, actorUserId): Promise<void>;
  onWorkflowApproved(organisationId, subjectId, finalApproverId): Promise<void>;
  onWorkflowExited(organisationId, subjectId, actorUserId): Promise<void>; // reject/return/cancel
}
```

`WorkflowModule` imports the owning domain's module (e.g. `ProcurementModule`) to
construct its handler — **one-directional only**, matching `AccessControlModule`'s
read-only `HrModule` import (Sprint 25) exactly: the owning domain never imports or
knows about `WorkflowModule` at all. Verified executably by
`workflow-independence.spec.ts`.

Before a `WorkflowInstance` is created, `WorkflowInstanceService.create()`:

1. Confirms the `WorkflowDefinition` (looked up by `organisationId` + `code`) exists
   and is `ACTIVE`.
2. Confirms `subjectType` matches the definition's own `subjectType`.
3. Calls the matching handler's `validateForSubmission()` — subject exists, belongs to
   this organisation (the handler's own repository call is always
   `organisationId`-scoped), and is in a submittable state (e.g. a Purchase Order must
   be `DRAFT`).
4. Confirms no other non-terminal `WorkflowInstance` already targets this exact
   `(organisationId, subjectType, subjectId)` — the "no conflicting active workflow"
   rule (§12). Checked at the service-call boundary immediately before insert as a
   fast, non-authoritative pre-flight; the actual guarantee under concurrency is a
   **database-level partial unique index** added Sprint 26.1 (§12) — Prisma's schema
   language has no declarative "unique only among a WHERE subset" construct, so this
   one index is hand-written directly into the migration SQL.

`resubmit()` (§5.2) reuses this exact same interface unchanged — `validateForSubmission`
and `onWorkflowSubmitted` are called exactly as they would be for a first-time
submission; no second, resubmission-specific interface method was added, keeping the
integration boundary genuinely reusable rather than growing bespoke hooks per lifecycle
path.

**Required-comment rule** (Sprint 26.1, §2 of the brief): `WorkflowInstanceService`'s
`reject`/`return` path (`exitWorkflow`) rejects a missing or whitespace-only `comment`
with `400 Bad Request` — enforced BOTH at the Zod schema layer
(`workflowRequiredCommentInputSchema`, distinct from the optional-comment
`workflowDecisionInputSchema` approve/cancel still use) AND, redundantly, again inside
the service itself — the service is the ultimate authority on this business rule, never
only the HTTP-layer validation pipe.

## 8. Purchase Order Integration

The one domain integration this sprint implements (`PurchaseOrderWorkflowHandler`).

**Inspected the actual, existing lifecycle before designing anything** (brief §8's own
instruction): `PurchaseOrderStatus` already had `DRAFT → PENDING → APPROVED →
PARTIALLY_RECEIVED → RECEIVED`, with `CANCELLED` a terminal branch from `DRAFT`/
`PENDING`. `approvedById` existed on the schema since Sprint 4.3, its own comment
reading _"Always null in this sprint — no approval workflow exists yet. Reserved for
when APPROVED becomes reachable."_ — and, confirmed by inspection, **nothing** in the
codebase had ever transitioned a Purchase Order to `PENDING` via a dedicated action, or
to `APPROVED` at all; the Zod validation schema restricted the generic
`PATCH /procurement/purchase-orders/:id` endpoint's `status` field to
`z.enum(['DRAFT', 'PENDING'])`, explicitly documented _"APPROVED/RECEIVED aren't
reachable by any endpoint this sprint."_

This meant the cleanest possible integration required **zero schema changes and zero
new `PurchaseOrderStatus` values** — the states this sprint needed were already
reserved and waiting:

- `validateForSubmission` — subject exists, belongs to the organisation, `status ===
DRAFT`.
- `onWorkflowSubmitted` — `DRAFT → PENDING` (reuses the existing
  `PurchaseOrderRepository.update()`, the same method Inventory already calls for its
  own goods-receipt status writes).
- `onWorkflowApproved` — `PENDING → APPROVED`, finally setting `approvedById` to the
  final approver's user id. **This is the one thing genuinely new** — nothing else in
  the codebase can reach `APPROVED` today.
- `onWorkflowExited` (reject/return/cancel) — `PENDING → DRAFT`, guarded to no-op if
  the PO never left `DRAFT` (e.g. its instance was cancelled pre-submission). All three
  decision types map to the identical domain-side effect since `PurchaseOrder` has no
  separate "rejected" status of its own, and adding one is out of scope for this
  sprint (brief §8: "do not introduce duplicate or contradictory states") — the
  distinction between _why_ the PO came back lives entirely in the immutable
  `WorkflowDecision` trail, never in the subject's own status column.

### Honest, deliberately-unaddressed gap

The pre-existing generic `PATCH /procurement/purchase-orders/:id` endpoint (Sprint 4.3)
still allows directly setting `status: "PENDING"` **without going through Workflow at
all** — this is unrelated, unchanged Sprint 4.3 behaviour, and Sprint 26 deliberately
did **not** tighten it to funnel `PENDING` exclusively through the workflow engine, per
the brief's own explicit allowance: _"If the existing domain is not ready for a clean
approval integration, implement the workflow foundation and a thin adapter/service
without forcing an unsafe lifecycle rewrite."_ Workflow adds a genuinely new, governed
path to `APPROVED` (previously unreachable by any means) without touching a single
existing, tested code path. Tightening the generic PATCH endpoint's allowed `status`
values (removing `PENDING`) so that submission-for-approval becomes the _only_ path
there is a natural, low-risk follow-up — but is a deliberate change to established
Sprint 4.3 behaviour that belongs in its own reviewed change, not silently bundled into
this or the prior sprint's foundation work.

**Sprint 26.1 re-confirmed, not just re-asserted**: `updatePurchaseOrderSchema.status`
(`packages/validation/src/procurement.ts`) is `z.enum(['DRAFT', 'PENDING'])` —
`APPROVED`/`COMPLETED` are not, and never were, reachable through the generic PATCH
endpoint at all. The Sprint 26.1 brief's Workstream 2 instruction — "do not allow users
to bypass workflow by directly changing a source record from a returned state into an
approved or completed state" — was inspected directly against this schema during this
sprint's audit and confirmed already true by construction; no code change was needed to
satisfy it. Only the narrower, already-documented `PENDING`-bypass gap above remains.

**Resubmission** (§5.2) reuses `PurchaseOrderWorkflowHandler` completely unchanged: a
`RETURNED` workflow's `onWorkflowExited` has already reverted the PO to `DRAFT`
(exactly like reject/cancel), so `resubmit()`'s call to `validateForSubmission`/
`onWorkflowSubmitted` behaves identically to a first-time submission — no
resubmission-specific Purchase Order logic exists anywhere.

### Seed data

One `PURCHASE_ORDER_APPROVAL` definition, `ACTIVE`, two sequential steps:

1. **Procurement Review** — `procurement.purchase_order.approve` @ `ORGANISATION`, no
   explicit assignee. Granted to the new "Purchase Order Approver" role.
2. **Final Approval** — the same permission/scope, **plus** an explicit
   `assignedUserId` (the seeded Administrator, who already holds this permission via
   Administrator's existing full-catalogue grant — using them here demonstrates
   explicit-approver narrowing without granting them anything new, honouring "do not
   seed broad approval authority unnecessarily").

Two new demo users, each linking a previously-unlinked Sprint 23 Employee (the same
`seedDemoEmployeeUser` pattern Sprint 25 established):

- **Ibrahim Musa** (`EMP-000004`, Procurement Officer, Procurement department) — new
  "Procurement Officer" role: create/edit/view Purchase Orders, submit/cancel workflow
  instances. **No** `procurement.purchase_order.approve` grant at all — self-approval
  is structurally impossible for him, not merely policy-blocked.
- **Grace Effiong** (`EMP-000005`, Warehouse Supervisor) — new "Purchase Order
  Approver" role: `procurement.purchase_order.approve` @ `ORGANISATION`, the
  `workflow.approval.*` permissions. Eligible for step 1; **not** eligible for step 2
  (not the explicit assignee) — live-verified in §15.

## 9. Admin UI

`/settings/workflows` — four tabs (Overview / Workflow Definitions / Workflow
Instances / My Approvals), matching `/settings/access`'s exact tab-bar convention
(`WorkflowTabs`, cloned from `AccessTabs`).

- **Overview** — plain client-computed aggregates over the Definitions/Instances list
  endpoints (no dedicated `/workflows/overview` endpoint — this domain's scale doesn't
  warrant one yet, unlike Access Control's Roles/UserRole aggregate).
- **Workflow Definitions** — list with usage counts (`instanceCount`), a create dialog
  with an inline multi-step editor (`StepEditor`, shared between create and edit), and
  a detail page supporting activate/deactivate and step editing (blocked while any
  non-terminal instance exists, §3.4).
- **Workflow Instances** — list + detail page showing every step's status, the
  definition version the instance is executing, the full immutable decision history
  (actor, decision, comment, timestamp), and (Sprint 26.1) an **Overdue** badge/filter
  and a **status filter** covering every lifecycle state including `EXPIRED`.
- **My Approvals** — the backend does the real filtering
  (`WorkflowInstanceService.listMyApprovals`); this page never hides an ineligible
  action behind a disabled button, because ineligible items are never present in the
  response at all. Approve/Reject/Return each open a comment dialog and re-invalidate
  the list on success; Reject/Return (Sprint 26.1) block submission client-side until a
  non-empty comment is entered — a UX convenience only, the server enforces the same
  rule authoritatively regardless (§7).

A **"Submit for Approval"** button was also added to the existing
`/settings/procurement` Purchase Order list (visible only for `DRAFT` orders) — the
natural entry point a Procurement Officer actually uses, creating and immediately
submitting a `PURCHASE_ORDER_APPROVAL` instance in one action. Sprint 26.1 extends this:
a `DRAFT` order that came back from a `RETURNED` workflow shows **"Resubmit for
Approval"** instead, calling the dedicated `resubmit()` endpoint against the linked
prior instance rather than starting a brand-new, unlinked one — the page distinguishes
the two cases by checking whether a `RETURNED` instance currently exists for that
Purchase Order.

The Workflow Instance detail page also gained (Sprint 26.1): a **Resubmit** action
(shown only when `status === 'RETURNED'`, navigating to the new instance on success), a
back-link to the predecessor instance when viewing a resubmission
(`previousInstanceId`), and a resubmission-count indicator.

### Known frontend limitation

The "New Workflow" / "Edit Steps" / activate-deactivate buttons on the Workflow
Definitions pages are not currently hidden for users lacking
`workflow.definition.manage` — clicking one correctly 403s server-side, but the button
itself is still rendered. This is a frontend polish gap, not a security gap (brief §13:
_"do not treat frontend visibility as authorization — the backend remains
authoritative"_); documented honestly here rather than silently left unmentioned,
matching this codebase's established practice of naming known UI-polish gaps rather
than claiming a finish that isn't quite there.

## 10. API Reference

All under `JwtAuthGuard` + `PermissionsGuard`; every route requires the
`@RequirePermission` shown (§2.2 for what that layer does and doesn't cover).

| Method | Route                                                         | Permission                   |
| ------ | ------------------------------------------------------------- | ---------------------------- |
| GET    | `/workflows/definitions`                                      | `workflow.definition.view`   |
| GET    | `/workflows/definitions/:id`                                  | `workflow.definition.view`   |
| POST   | `/workflows/definitions`                                      | `workflow.definition.manage` |
| PATCH  | `/workflows/definitions/:id`                                  | `workflow.definition.manage` |
| POST   | `/workflows/definitions/:id/activate`                         | `workflow.definition.manage` |
| POST   | `/workflows/definitions/:id/deactivate`                       | `workflow.definition.manage` |
| GET    | `/workflows/instances` (`?status=&subjectType=&overdue=true`) | `workflow.instance.view`     |
| GET    | `/workflows/instances/:id`                                    | `workflow.instance.view`     |
| GET    | `/workflows/instances/:id/history`                            | `workflow.audit.view`        |
| GET    | `/workflows/instances/:id/events` **(Sprint 26.1)**           | `workflow.audit.view`        |
| GET    | `/workflows/instances/:id/eligible-approvers`                 | `workflow.instance.view`     |
| GET    | `/workflows/instances/my-approvals`                           | `workflow.approval.view`     |
| POST   | `/workflows/instances` (body may include `dueAt`)             | `workflow.instance.submit`   |
| POST   | `/workflows/instances/:id/submit`                             | `workflow.instance.submit`   |
| POST   | `/workflows/instances/:id/approve` (comment optional)         | `workflow.approval.approve`  |
| POST   | `/workflows/instances/:id/reject` (comment **required**)      | `workflow.approval.reject`   |
| POST   | `/workflows/instances/:id/return` (comment **required**)      | `workflow.approval.return`   |
| POST   | `/workflows/instances/:id/cancel`                             | `workflow.instance.cancel`   |
| POST   | `/workflows/instances/:id/resubmit` **(Sprint 26.1)**         | `workflow.instance.submit`   |
| POST   | `/workflows/instances/:id/expire` **(Sprint 26.1)**           | `workflow.instance.cancel`   |

Deliberate deviation from the brief's suggested route list: `my-approvals` is nested
under `/workflows/instances/` (not a separate top-level `/workflows/my-approvals`) —
it returns instance-adjacent step data and the `WorkflowInstanceController` is where
that data already lives; RESTful, and the brief's own routes were explicitly
"suggestions... follow existing conventions." `resubmit`/`expire` (Sprint 26.1)
deliberately reuse `workflow.instance.submit`/`workflow.instance.cancel` rather than
adding two new catalogue rows — resubmission IS a submission action, and manually
expiring a stuck workflow is the same trust level as cancelling one; a dedicated
permission for a manually-triggered interim `expire` path (no scheduled job calls it
yet, §9) would be premature.

## 11. Audit Trail

Every meaningful transition records an `AuditLog` row via `AuditService.record()` —
the same call-after-the-fact pattern every other domain in this codebase already uses
(never inside the same DB transaction as the state change itself, matching precedent
exactly):

| Action                            | Recorded on                                                |
| --------------------------------- | ---------------------------------------------------------- |
| `workflow.definition.created`     | `POST /workflows/definitions`                              |
| `workflow.definition.updated`     | `PATCH /workflows/definitions/:id`                         |
| `workflow.definition.activated`   | `POST /workflows/definitions/:id/activate`                 |
| `workflow.definition.deactivated` | `POST /workflows/definitions/:id/deactivate`               |
| `workflow.instance.created`       | `POST /workflows/instances`                                |
| `workflow.instance.submitted`     | `POST /workflows/instances/:id/submit`                     |
| `workflow.approval.granted`       | `POST /workflows/instances/:id/approve`                    |
| `workflow.approval.rejected`      | `POST /workflows/instances/:id/reject`                     |
| `workflow.approval.returned`      | `POST /workflows/instances/:id/return`                     |
| `workflow.instance.cancelled`     | `POST /workflows/instances/:id/cancel`                     |
| `workflow.instance.resubmitted`   | `POST /workflows/instances/:id/resubmit` **(Sprint 26.1)** |
| `workflow.instance.expired`       | `POST /workflows/instances/:id/expire` **(Sprint 26.1)**   |

Live-verified (§15): a full create → submit → approve → approve cycle produced exactly
the expected sequence of `AuditLog` rows with correct actor, entity id, and metadata.

Separately, every `WorkflowDecision` row (§3.5) is itself a permanent, immutable
record of who decided what and when — never editable, and readable only through
`GET /workflows/instances/:id/history`, gated by `workflow.audit.view`.

`workflow.approval.denied` (a failed/denied approval attempt) is defined in
`WORKFLOW_AUDIT_ACTIONS` but not yet wired to a call site — an eligibility failure
currently surfaces as a `400`/`403` HTTP response (itself inspectable via ordinary
application logs) but does not yet write a dedicated `AuditLog` row. Documented as a
deferred capability (§16), matching the brief's "where supported by the existing audit
strategy" qualifier — no other domain in this codebase audits denied _attempts_ either,
only successful mutations.

## 12. Concurrency & Idempotency

Every state transition uses a **conditional `updateMany`** whose `WHERE` clause
includes the expected current status — this codebase's own established concurrency
idiom (`PurchaseOrderRepository.update`'s `updateMany`-then-recheck,
`AttendanceRepository.findOrCreateForDate`'s P2002 catch), not a new pattern invented
for this domain. `count === 0` means "someone else already moved it"; the caller
surfaces a `409 Conflict`, never a silent no-op or a second success.

- **`decideStep`** (the approve/reject/return path) — only succeeds if the step is
  still `ACTIVE`; wraps the step-status update and the new `WorkflowDecision` insert in
  one `prisma.$transaction`, so a step can never end up decided with no matching
  decision row, or vice versa. **Live-verified**: two concurrent `approve` requests
  against the same step — one succeeded (`201`), the other correctly received `409
Conflict` (`"This step has already been decided by someone else"`), and exactly one
  `WorkflowDecision` row was written (§15).
- **`submit`** — only succeeds if the instance is still `DRAFT`. **Live-verified**: two
  concurrent `submit` requests against the same instance — one `201`, one `409`.
- **`setInstanceStatus`** (reject/return/cancel/approve-final-step) — only succeeds if
  the instance is still non-terminal.
- **No conflicting active workflow per subject** — checked immediately before insert
  (§7); **live-verified**: a cancelled instance's subject could immediately receive a
  fresh `WorkflowInstance`, while an `IN_PROGRESS` one correctly rejected a second
  concurrent submission attempt for the same subject.
- **`claimForResubmission`** (Sprint 26.1) — only succeeds if the instance is still
  `RETURNED` AND `resubmittedAt IS NULL`; the first concurrent `resubmit()` call wins,
  every other receives `409 Conflict`. **Live-verified**: two concurrent `resubmit`
  requests against the same `RETURNED` instance — one `201` (a new linked instance),
  one `409`, and exactly one new `WorkflowInstance` row exists for that chain
  afterward (§15).
- **`expire`** (Sprint 26.1) — only succeeds if the instance is still non-terminal AND
  `dueAt` has actually passed; a caller cannot expire an instance early or one with no
  `dueAt` configured (`dueAt: { lt: now }` is never true against a `null` column).

### Database-level partial unique index (Sprint 26.1)

This sprint's audit found a genuine gap: `create()`/`resubmit()`'s "no conflicting
active instance" check (§7) is a classic check-then-act — nothing in Sprint 26
prevented two concurrent requests from both passing that check and both inserting.
Prisma's schema language has no declarative "unique only among a `WHERE` subset"
construct, so the fix is a hand-written raw-SQL index added directly to the Sprint 26.1
migration:

```sql
CREATE UNIQUE INDEX "workflow_instances_one_active_per_subject"
ON "workflow_instances" ("organisationId", "subjectType", "subjectId")
WHERE "status" IN ('DRAFT', 'SUBMITTED', 'IN_PROGRESS');
```

`WorkflowInstanceRepository.createWithSteps` catches the resulting
`Prisma.PrismaClientKnownRequestError` (`P2002`) and re-throws it as a typed
`ConflictingActiveInstanceError`, which the service layer translates into `409
Conflict` — the same outward behavior as every other concurrency conflict in this
domain, but now backed by an actual database constraint rather than only application
logic. **Live-verified**: two concurrent `POST /workflows/instances` calls for the
same subject — one `201`, one `409`, confirmed via the index name in the Postgres
error detail (§15).

### Event durability & idempotency (Sprint 26.1)

Every successful transition that produces a `WorkflowEvent` (§7) writes it inside the
SAME `prisma.$transaction` as the state mutation itself — `WorkflowInstanceRepository`'s
`submit`/`activateStep`/`decideStep`/`setInstanceStatus`/`markCompleted`/`expire`/
`createWithSteps` all accept an optional, fully-built event descriptor and insert it in
the same transaction if the mutation succeeds. This is what "a successful workflow
transition must produce one durable, tenant-scoped event record" means concretely — the
event can never exist without the mutation, or the mutation without the event.

`idempotencyKey` is deterministically derived from the logical occurrence (a
`WorkflowStepInstance` id for step-level events, a `WorkflowInstance` id for
instance-level ones — see `buildWorkflowEventIdempotencyKey`), never a random value, and
is unique per `(organisationId, idempotencyKey)` at the database level. Re-deriving the
same key for the same occurrence — the only way this code path could ever be invoked
twice — is always safe: `recordWorkflowEventInTx` catches a duplicate-key violation and
treats it as a no-op, never an error. In practice this should be unreachable in normal
operation, because every event-producing mutation is itself gated by the exact same
conditional `updateMany`/unique-index guarantees described above (a step can only be
decided once, an instance can only reach `APPROVED` once, etc.) — the idempotency-key
uniqueness is a second, independent layer of protection, not the only one.

`AuditLog` writes remain, as before, **not** part of the same DB transaction as the
state change — matching every other domain's established convention exactly (the audit
call always happens after the awaited service call returns, never inside a shared
transaction). `WorkflowEvent` and `AuditLog` are deliberately two separate mechanisms
with two different durability guarantees: `AuditLog` is a best-effort,
human-readable trail; `WorkflowEvent` is the strict, machine-consumable, exactly-once
record Notifications will read from (§7).

## 13. Tenant Isolation

Every repository method that reads or writes a specific row takes `organisationId` and
includes it in the query — the identity.md §7 convention, unchanged. Live-verified
(§15): a second organisation's Owner received `404 Not Found` on a direct `GET`, a
`404` on a cross-tenant approval attempt (never even reaching the eligibility check —
tenant scoping happens first), an empty list on `GET /workflows/instances`, and a
`404 "Workflow definition ... not found"` when attempting to create an instance
against a `code` that only exists in the other tenant. `WorkflowStep`/
`WorkflowStepInstance`/`WorkflowDecision` are tenant-scoped through their parent
(`WorkflowDefinition`/`WorkflowInstance`), never carrying their own `organisationId`.

## 14. Testing

**74 workflow tests** across five suites under `src/workflow/` (55 from Sprint 26 + 19
new from Sprint 26.1's hardening pass — no suite was deleted or replaced, all extended
in place):

- `workflow-eligibility.service.spec.ts` (12) — self-approval default/override,
  permission present/absent, scope match/mismatch, explicit-assignee eligible/
  ineligible, inactive user denied, Owner bypass, `listEligibleApprovers` filtering.
- `workflow-definition.service.spec.ts` (13) — valid creation, zero-steps rejection,
  duplicate step code/sequence rejection, invalid-catalogue-permission rejection,
  cross-tenant explicit-approver rejection, same-tenant explicit-approver acceptance,
  duplicate-code rejection, step-edit blocked while active instances exist,
  name-only edit allowed regardless, version bump on step change, activate-with-
  zero-steps rejection.
- `workflow-instance.service.spec.ts` (**37**, +19 Sprint 26.1) — inactive-definition/
  ineligible-subject/conflicting-active-instance rejection at creation
  (incl. the DB-level `ConflictingActiveInstanceError` → 409 translation), step
  pre-snapshotting, requester-only submission, double-submission conflict without a
  redundant domain-handler call, **handler-before-write ordering proven via explicit
  call-order assertions for both `submit()` and `approve()`'s final step**, **domain-
  integration failure never marks the instance `APPROVED`**, **the recovery/retry path
  when a prior domain-integration attempt failed after every step was already
  approved**, ineligible-actor rejection, concurrency-conflict surfacing, step
  advancement vs. final-step completion + `onWorkflowApproved`, no-active-step
  rejection, **reject/return reject an empty or whitespace-only comment**, reject/return
  → `onWorkflowExited`, **the full `resubmit()` suite** (wrong requester, wrong source
  status, claim-race conflict, happy path with correct linkage/step-restart, DB-level
  conflict translation), **`expire()`'s success and not-yet-due/already-terminal
  rejection**, **`isOverdue` computed correctly for no-due-date / future-due-date /
  past-due-but-terminal / past-due-and-non-terminal**, **the `overdue` list filter
  passthrough**, cancel with/without a prior submission, terminal-state conflict, My
  Approvals filtering.
- `handlers/purchase-order-workflow.handler.spec.ts` (7) — subject-not-found/
  wrong-status/valid-DRAFT validation, `PENDING`/`APPROVED` transitions, revert-to-
  `DRAFT` on exit, no-op when the PO never left `DRAFT`. Unchanged this sprint — the
  handler interface itself did not change, and resubmission reuses it as-is (§8).
- `workflow-independence.spec.ts` (5) — structural guards: no engine file writes a
  domain table directly, no engine file imports a non-Identity/Auth domain,
  `WorkflowModule` imports only `IdentityModule`/`AuthModule`/`PurchaseOrderModule`,
  the Purchase Order handler only writes via its repository (never raw Prisma), no
  role-name/position/department string comparison anywhere in the engine.

Full regression: **181 suites / 1559 tests passing** (1540 baseline + 19 new). Zero new
lint warnings (still exactly the same 27 pre-existing `finance/budgeting/*.spec.ts`
warnings the prior baseline already carried).

Per the brief's own instruction ("do not rely only on mocked tests for authorization,
tenant isolation, or concurrency"), the genuinely concurrency-sensitive guarantees —
the two-winner races, the database partial unique index, event idempotency under a
real duplicate insert attempt — were additionally exercised live against the real
database and real HTTP layer (§15), not only asserted against a mocked repository.

## 15. Live Verification

Performed against the real database and real, freshly-issued JWTs (no mocks) —
restated in full in
[the Sprint 26.1 completion report](../sprint-26.1-completion-report.md). Sprint 26's
own scenarios (full two-step approval cycle, ineligible-actor denial, concurrent
approval race, suspended/role-removed approver revocation, cross-tenant isolation, full
admin UI including a 375px render) were re-run and still hold unchanged. Sprint 26.1
added: an end-to-end return → edit → resubmit cycle reaching `APPROVED` on the new
linked instance with the original `RETURNED` instance's history fully intact and
unmodified; two concurrent `resubmit` requests against the same returned instance
producing exactly one success; two concurrent `POST /workflows/instances` requests for
the same subject producing exactly one success at the database-index level; a reject
and a return attempt each rejected with `400` for a missing comment; an `expire`
attempt rejected before `dueAt` passed and accepted after; an expired instance
correctly refusing a subsequent `approve` attempt; and the Workflow Instances / My
Approvals / instance-detail pages re-verified in the browser at both desktop and 375px
widths with the new Resubmit button, Overdue badge, and definition-version display all
rendering correctly, zero unexpected console errors.

## 16. Deferred Capabilities (honest limitations, not oversights)

- **Record-level scope proof for non-`ORGANISATION` `requiredScope`** — the engine
  proves the candidate holds the scope, not that the specific record falls within it
  (§6's honesty note). No subject type has data yet that could support a stronger
  check.
- **`workflow.approval.denied` audit event** — defined, not yet wired to a call site
  (§11).
- **Parallel/branching approval, conditional routing, an expression engine, a visual
  workflow builder** — explicitly out of scope; this remains a sequential-only MVP
  foundation.
- **Automatic escalation, SLA monitoring, automatic reminders, delegation, acting
  appointments** — explicitly out of scope. `dueAt`/`isOverdue`/`EXPIRED` (§4, §9) are
  the deliberately minimal foundation a future scheduled job would build on — no job
  exists yet, and none is implied by this sprint's work.
- **A second domain integration (Supplier Payment, Sales Order, Purchase Requisition,
  Capital Project, ...)** — inspected during this sprint's audit; no candidate had a
  clean draft/submission/approval boundary as ready as Purchase Order's already-
  reserved `PENDING`/`APPROVED` states, so none was added. The `WorkflowSubjectHandler`
  contract itself was reviewed and left unchanged (§7, §8) — validated through the
  existing tests and this documentation rather than a second live integration, per the
  brief's own explicit fallback allowance.
- **`GET /workflows/instances/:id/eligible-approvers` at scale** — an O(n) scan over
  every organisation `User`, fine at expected scale, not indexed for a large
  organisation (§6).
- **Tightening `PATCH /procurement/purchase-orders/:id` to remove direct `PENDING`-
  setting** — a natural, low-risk follow-up (§8) deliberately left for its own
  reviewed change.
- **`exitWorkflow`'s (`reject`/`return`/`cancel`) domain-callback failure has no retry
  path** — unlike `approve()`'s `finalizeApproval` (§5.1), a failure here leaves the
  workflow instance correctly terminal but the domain record possibly not reverted;
  narrow, honestly documented, not solved with additional machinery this sprint (§5.1).
- **`resubmit()`'s domain-callback failure leaves a consumed claim with no new
  instance** — the same class of gap as the bullet above, on the resubmission path
  specifically (§5.2); the claimed instance stays `RETURNED` with `resubmittedAt` set,
  requiring manual intervention to un-stick.
- **A "Submitted by me" instance-list filter** — the brief's suggested filter list
  included this; not added because the frontend has no existing current-user-id
  helper to build it on (unlike "Assigned to me," which the backend already fully
  computes for My Approvals). A small, isolated frontend addition if ever needed.
- **`docs/architecture/authorization-coverage.md`'s route inventory** — a Sprint
  25.1-era snapshot (534 routes, generated before Workflow existed) that was never
  updated when Workflow shipped in Sprint 26. This sprint added a short addendum
  section rather than regenerating the entire 534-route extraction, which is out of
  scope for a Workflow-focused hardening pass.
- **Notifications** — explicitly out of scope; §17 covers the event boundary this
  sprint hardens into a durable, idempotent record for it.

## 17. Event Boundary — Now Consumed by Notifications (Sprint 27)

Sprint 26 shipped `workflow-events.ts` as documentation-only — a plain name+shape
catalog cross-referenced to `AuditLog`, nothing actually persisted in a structured
form. Sprint 26.1 made this real: every event type became a durable row in a
dedicated `WorkflowEvent` table, written transactionally alongside the state change
that produced it (§12). **Sprint 27 is the consumer** that boundary was built for —
see [docs/domains/notifications.md](notifications.md) for the full design. The
relationship stays exactly one-directional: `NotificationsModule` imports
`WorkflowModule` read-only (this module now `exports:
[WorkflowEligibilityService, WorkflowDefinitionService, WORKFLOW_SUBJECT_HANDLERS]`
for that purpose — the only change Sprint 27 made to any file in this domain);
`WorkflowModule` itself has zero awareness of Notifications and nothing here was
redesigned. Still **no** `EventEmitter`/dispatcher/queue — Sprint 27's own consumer
is triggered on demand (frontend poll + post-mutation calls), not a background
worker, matching this codebase's continued absence of any queue/cron
infrastructure.

### Event types (`WORKFLOW_EVENT_TYPES`, `workflow-events.ts`)

Only events that correspond to an actually-implemented transition exist — no
placeholder for an unsupported one:

| Event type          | Fires when                                                             | Fires more than once per instance? |
| ------------------- | ---------------------------------------------------------------------- | ---------------------------------- |
| `SUBMITTED`         | `DRAFT` → `SUBMITTED` (a fresh submission, not a resubmission)         | No                                 |
| `APPROVAL_REQUIRED` | A `WorkflowStepInstance` becomes `ACTIVE`                              | Yes — once per step                |
| `STEP_APPROVED`     | A step is approved                                                     | Yes — once per step                |
| `APPROVED`          | The FINAL step is approved AND the domain integration succeeded (§5.1) | No                                 |
| `REJECTED`          | A step is rejected (always instance-terminal in this sequential MVP)   | No                                 |
| `RETURNED`          | A step is returned for correction                                      | No                                 |
| `RESUBMITTED`       | A new instance is created via `resubmit()` (§5.2)                      | No (fires on the NEW instance)     |
| `CANCELLED`         | `cancel()` succeeds                                                    | No                                 |
| `EXPIRED`           | `expire()` succeeds (§9)                                               | No                                 |
| `COMPLETED`         | `markCompleted()` succeeds                                             | No                                 |

### Payload / metadata

Every `WorkflowEvent` row carries: `organisationId`, `workflowInstanceId`,
`workflowDefinitionId`, `workflowDefinitionVersion`, `subjectType`, `subjectId`,
`subjectReference` (optional, human-readable), `eventType`, `actorUserId` (optional),
`targetUserId` (optional, unused so far — reserved for a future "assigned to" event),
`workflowStepInstanceId` (present only for step-level events), `correlationId` (shared
across every event produced by one logical user action — e.g. an `approve()` call that
both closes the current step and activates the next produces two events sharing one
`correlationId`), `idempotencyKey`, a freeform `summary` JSON blob (step sequence,
comment text where relevant), and `occurredAt`. This is deliberately enough for a
future Notifications consumer to render a human-readable message and address it,
without querying `WorkflowStepInstance`/`WorkflowDecision` internals at all.

### Durability & idempotency guarantees (restated from §12)

- **Transactionally persisted with the workflow mutation** — every event-producing
  repository method wraps the state mutation and the event insert in one
  `prisma.$transaction`; the event can never exist without the mutation having
  actually succeeded, and vice versa.
- **Exactly-once per logical occurrence** — `idempotencyKey` is deterministic (never
  random) and unique per `(organisationId, idempotencyKey)`; a duplicate insert attempt
  is caught and silently no-op'd, never surfaced as an error.
- **Tenant-scoped** — every row carries `organisationId`; read access
  (`GET /workflows/instances/:id/events`) re-confirms the instance belongs to the
  caller's organisation before returning anything, the same pattern `history` already
  uses.
- **Not** an outbox pattern with a separate publish step — there is no "pending →
  published" state on `WorkflowEvent` rows themselves. **Sprint 27 update**:
  Notifications added its OWN processing-state columns directly to this same table
  (`notificationProcessedAt`/`notificationAttempts`/`notificationLastAttemptAt`/
  `notificationLastError`) rather than a separate outbox table — see
  notifications.md §4 "Option B." This domain's own code never reads or writes
  those columns; they exist purely for Notifications' consumption bookkeeping.

Read access exists for verification, debugging, and is now also how Notifications'
`NotificationEventProcessorService` itself reads pending events (directly via
Prisma, not through `WorkflowEventRepository` or any other Workflow service) —
`WorkflowEventRepository.findManyByInstance`/`findManyByOrganisation` remains the
HTTP-facing surface, exposed via `GET /workflows/instances/:id/events`
(`workflow.audit.view`). No admin UI surfaces raw `WorkflowEvent` rows directly
(the admin UI's History tab uses `WorkflowDecision`, the human-readable
equivalent) — the Notifications domain's own UI (notifications.md §13) is the
first real UI consumer of this event stream.
