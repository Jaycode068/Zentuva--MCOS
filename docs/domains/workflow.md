# Workflow & Approval Domain

- **Status:** MVP sequential approval engine implemented — Sprint 26.
- **Sprint:** 26
- **Depends on:** [Access Control](access-control.md) (`EffectiveAccessResolver`,
  `ScopeEvaluator`, the permission catalogue — Workflow introduces zero new
  authorization primitives), [Procurement](procurement.md) (the one domain integration
  this sprint implements), [Identity](identity.md) (tenant boundary, `User`),
  [ADR-002 — Modular Monolith](../adr/ADR-002-modular-monolith.md),
  [ADR-003 — Multi-Tenancy](../adr/ADR-003-multi-tenancy.md)
- **See also:** [Sprint 26 Completion Report](../sprint-26-completion-report.md)

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
                          ↓
                    REJECTED | RETURNED | CANCELLED   (terminal for this instance)
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
- **`APPROVED`** — every step approved. The subject handler's `onWorkflowApproved` has
  already run by the time this status is visible (§7) — approval and the domain-side
  effect are not two separately-observable moments.
- **`REJECTED`** / **`RETURNED`** — terminal for _this_ `WorkflowInstance` (§4's
  restart/resume rule, expanded in §5).
- **`CANCELLED`** — terminal, reachable from any non-terminal status including `DRAFT`.
- **`COMPLETED`** — the owning domain has consumed the `APPROVED` outcome.
  `WorkflowInstanceService.markCompleted()` exists and is exposed via the domain layer,
  but nothing calls it yet in Sprint 26 — the Purchase Order integration's
  `onWorkflowApproved` already performs the PO's entire side effect (`PENDING` →
  `APPROVED`) at the moment of final approval, so there is no further "consumption"
  step for this integration to mark complete. Reserved for a future integration whose
  approved outcome is consumed asynchronously (e.g. a nightly batch, or a second manual
  action).

Reaching `APPROVED` never automatically mutates a business record beyond what the
subject handler's `onWorkflowApproved` explicitly implements (§2.3/§7 of the brief) —
there is no generic "workflow reached APPROVED, therefore do something" hook outside
that one, deliberate, per-subject-type call.

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
- **Restart/resume rule for `RETURNED`**: for this MVP, `RETURNED` (like `REJECTED` and
  `CANCELLED`) is **terminal for the `WorkflowInstance`** — no step is rewound back to
  `PENDING` or re-activated. The subject reverts to an editable state (via the
  handler's `onWorkflowExited`, §7) and, once corrected, resubmission means creating a
  **new** `WorkflowInstance` against the same definition (`POST /workflows/instances`
  again — blocked only if a conflicting active instance for the same subject still
  exists, §7). A true "resume the same instance from step 1" pattern — rewinding
  already-decided step instances — is a documented, deferred capability (§16); it is
  exactly the kind of state-machine complexity the brief's "establish a clean MVP
  foundation" instruction says to avoid this sprint.

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
   live-verified in §17.
4. **Permission (+ optional scope)** — `ScopeEvaluator.hasScope()` if the step has a
   `requiredScope`, else `ScopeEvaluator.hasAny()`. Owner bypass and `NONE`-scopeType
   permissions behave exactly as Access Control already documents (access-control.md
   §5) — nothing new here.

`isEligibleCandidate()` is the boolean-only convenience wrapper `WorkflowInstanceService`
calls before every decision — **re-evaluated on every single request**, never a cached
"eligible users" list computed once at submission time. This matters concretely: revoke
a role mid-flight and the very next approval attempt with the same still-valid token
fails (live-verified in §17), exactly like Access Control's own revocation guarantee.

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
   rule (§13). Checked at the service-call boundary immediately before insert, not a
   declarative DB constraint (Prisma has no partial-unique-index support for "unique
   only among non-terminal rows," and an always-on unique constraint would wrongly
   block a legitimate _second_ approval of the same subject after the first
   completed).

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
all** — this is unrelated, unchanged Sprint 4.3 behaviour, and this sprint deliberately
did **not** tighten it to funnel `PENDING` exclusively through the workflow engine, per
the brief's own explicit allowance: _"If the existing domain is not ready for a clean
approval integration, implement the workflow foundation and a thin adapter/service
without forcing an unsafe lifecycle rewrite."_ Workflow adds a genuinely new, governed
path to `APPROVED` (previously unreachable by any means) without touching a single
existing, tested code path. Tightening the generic PATCH endpoint's allowed `status`
values (removing `PENDING`) so that submission-for-approval becomes the _only_ path
there is a natural, low-risk follow-up — but is a deliberate change to established
Sprint 4.3 behaviour that belongs in its own reviewed change, not silently bundled into
this sprint's foundation work.

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
  (not the explicit assignee) — live-verified in §17.

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
- **Workflow Instances** — list + detail page showing every step's status and the full
  immutable decision history (actor, decision, comment, timestamp).
- **My Approvals** — the backend does the real filtering
  (`WorkflowInstanceService.listMyApprovals`); this page never hides an ineligible
  action behind a disabled button, because ineligible items are never present in the
  response at all. Approve/Reject/Return each open a comment dialog and re-invalidate
  the list on success.

A **"Submit for Approval"** button was also added to the existing
`/settings/procurement` Purchase Order list (visible only for `DRAFT` orders) — the
natural entry point a Procurement Officer actually uses, creating and immediately
submitting a `PURCHASE_ORDER_APPROVAL` instance in one action.

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

| Method | Route                                         | Permission                   |
| ------ | --------------------------------------------- | ---------------------------- |
| GET    | `/workflows/definitions`                      | `workflow.definition.view`   |
| GET    | `/workflows/definitions/:id`                  | `workflow.definition.view`   |
| POST   | `/workflows/definitions`                      | `workflow.definition.manage` |
| PATCH  | `/workflows/definitions/:id`                  | `workflow.definition.manage` |
| POST   | `/workflows/definitions/:id/activate`         | `workflow.definition.manage` |
| POST   | `/workflows/definitions/:id/deactivate`       | `workflow.definition.manage` |
| GET    | `/workflows/instances`                        | `workflow.instance.view`     |
| GET    | `/workflows/instances/:id`                    | `workflow.instance.view`     |
| GET    | `/workflows/instances/:id/history`            | `workflow.audit.view`        |
| GET    | `/workflows/instances/:id/eligible-approvers` | `workflow.instance.view`     |
| GET    | `/workflows/instances/my-approvals`           | `workflow.approval.view`     |
| POST   | `/workflows/instances`                        | `workflow.instance.submit`   |
| POST   | `/workflows/instances/:id/submit`             | `workflow.instance.submit`   |
| POST   | `/workflows/instances/:id/approve`            | `workflow.approval.approve`  |
| POST   | `/workflows/instances/:id/reject`             | `workflow.approval.reject`   |
| POST   | `/workflows/instances/:id/return`             | `workflow.approval.return`   |
| POST   | `/workflows/instances/:id/cancel`             | `workflow.instance.cancel`   |

Deliberate deviation from the brief's suggested route list: `my-approvals` is nested
under `/workflows/instances/` (not a separate top-level `/workflows/my-approvals`) —
it returns instance-adjacent step data and the `WorkflowInstanceController` is where
that data already lives; RESTful, and the brief's own routes were explicitly
"suggestions... follow existing conventions."

## 11. Audit Trail

Every meaningful transition records an `AuditLog` row via `AuditService.record()` —
the same call-after-the-fact pattern every other domain in this codebase already uses
(never inside the same DB transaction as the state change itself, matching precedent
exactly):

| Action                            | Recorded on                                  |
| --------------------------------- | -------------------------------------------- |
| `workflow.definition.created`     | `POST /workflows/definitions`                |
| `workflow.definition.updated`     | `PATCH /workflows/definitions/:id`           |
| `workflow.definition.activated`   | `POST /workflows/definitions/:id/activate`   |
| `workflow.definition.deactivated` | `POST /workflows/definitions/:id/deactivate` |
| `workflow.instance.created`       | `POST /workflows/instances`                  |
| `workflow.instance.submitted`     | `POST /workflows/instances/:id/submit`       |
| `workflow.approval.granted`       | `POST /workflows/instances/:id/approve`      |
| `workflow.approval.rejected`      | `POST /workflows/instances/:id/reject`       |
| `workflow.approval.returned`      | `POST /workflows/instances/:id/return`       |
| `workflow.instance.cancelled`     | `POST /workflows/instances/:id/cancel`       |

Live-verified (§17): a full create → submit → approve → approve cycle produced exactly
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
  `WorkflowDecision` row was written (§17).
- **`submit`** — only succeeds if the instance is still `DRAFT`. **Live-verified**: two
  concurrent `submit` requests against the same instance — one `201`, one `409`.
- **`setInstanceStatus`** (reject/return/cancel/approve-final-step) — only succeeds if
  the instance is still non-terminal.
- **No conflicting active workflow per subject** — checked immediately before insert
  (§7); **live-verified**: a cancelled instance's subject could immediately receive a
  fresh `WorkflowInstance`, while an `IN_PROGRESS` one correctly rejected a second
  concurrent submission attempt for the same subject.

`AuditLog` writes are **not** part of the same DB transaction as the state change —
matching every other domain's established convention exactly (the audit call always
happens after the awaited service call returns, never inside a shared transaction).

## 13. Tenant Isolation

Every repository method that reads or writes a specific row takes `organisationId` and
includes it in the query — the identity.md §7 convention, unchanged. Live-verified
(§17): a second organisation's Owner received `404 Not Found` on a direct `GET`, a
`404` on a cross-tenant approval attempt (never even reaching the eligibility check —
tenant scoping happens first), an empty list on `GET /workflows/instances`, and a
`404 "Workflow definition ... not found"` when attempting to create an instance
against a `code` that only exists in the other tenant. `WorkflowStep`/
`WorkflowStepInstance`/`WorkflowDecision` are tenant-scoped through their parent
(`WorkflowDefinition`/`WorkflowInstance`), never carrying their own `organisationId`.

## 14. Testing

**55 new tests**, five new suites, all under `src/workflow/`:

- `workflow-eligibility.service.spec.ts` (12) — self-approval default/override,
  permission present/absent, scope match/mismatch, explicit-assignee eligible/
  ineligible, inactive user denied, Owner bypass, `listEligibleApprovers` filtering.
- `workflow-definition.service.spec.ts` (13) — valid creation, zero-steps rejection,
  duplicate step code/sequence rejection, invalid-catalogue-permission rejection,
  cross-tenant explicit-approver rejection, same-tenant explicit-approver acceptance,
  duplicate-code rejection, step-edit blocked while active instances exist,
  name-only edit allowed regardless, version bump on step change, activate-with-
  zero-steps rejection.
- `workflow-instance.service.spec.ts` (18) — inactive-definition/ineligible-subject/
  conflicting-active-instance rejection at creation, step pre-snapshotting, requester-
  only submission, double-submission conflict, first-step activation +
  `onWorkflowSubmitted`, ineligible-actor rejection, concurrency-conflict surfacing,
  step advancement vs. final-step completion + `onWorkflowApproved`, no-active-step
  rejection, reject/return → `onWorkflowExited`, cancel with/without a prior
  submission, terminal-state conflict, My Approvals filtering.
- `handlers/purchase-order-workflow.handler.spec.ts` (7) — subject-not-found/
  wrong-status/valid-DRAFT validation, `PENDING`/`APPROVED` transitions, revert-to-
  `DRAFT` on exit, no-op when the PO never left `DRAFT`.
- `workflow-independence.spec.ts` (5) — structural guards: no engine file writes a
  domain table directly, no engine file imports a non-Identity/Auth domain,
  `WorkflowModule` imports only `IdentityModule`/`AuthModule`/`PurchaseOrderModule`,
  the Purchase Order handler only writes via its repository (never raw Prisma), no
  role-name/position/department string comparison anywhere in the engine.

Full regression: **181 suites / 1540 tests passing** (176/1485 Sprint 25.1 baseline +
5 suites/55 tests). Zero new lint warnings (still exactly the same 27 pre-existing
`finance/budgeting/*.spec.ts` warnings Sprint 25.1's baseline already carried).

## 15. Live Verification

Performed against the real database and real, freshly-issued JWTs (no mocks) —
restated in full in [the completion report](../sprint-26-completion-report.md §"Live
verification scenarios"). Summary: a full two-step sequential approval reached
`APPROVED` end-to-end with the Purchase Order correctly transitioning
`DRAFT → PENDING → APPROVED` and `approvedById` correctly populated; an ineligible
direct API call was denied; a second approval attempt on an already-decided step was
denied; My Approvals showed exactly the eligible step for each of three different
users (and correctly excluded the requester); reject and return both correctly
reverted the Purchase Order to `DRAFT`; two concurrent approval requests produced
exactly one success and one `409`; a suspended approver was denied using their
already-valid token; a role-removal immediately revoked eligibility using the same
still-valid token; cross-tenant access was denied at every tested surface; and the
admin UI (all four tabs, plus the Procurement page's new "Submit for Approval" button)
was verified live in the browser, including a full approve action end-to-end and a
375px-width render of the Workflow Definitions page, with zero unexpected console
errors.

## 16. Deferred Capabilities (honest limitations, not oversights)

- **`RETURNED` resume-in-place** — resubmission creates a new `WorkflowInstance`, never
  rewinds the existing one's steps (§5).
- **Record-level scope proof for non-`ORGANISATION` `requiredScope`** — the engine
  proves the candidate holds the scope, not that the specific record falls within it
  (§6's honesty note). No subject type this sprint has data that could support a
  stronger check.
- **`workflow.approval.denied` audit event** — defined, not yet wired to a call site
  (§11).
- **Parallel/branching approval, conditional routing, an expression engine, a visual
  workflow builder** — explicitly out of scope (brief §19); this is a sequential-only
  MVP foundation.
- **Escalation timers, SLA monitoring, automatic reminders, delegation, acting
  appointments** — explicitly out of scope.
- **A second domain integration (Supplier Payment, Sales Order, ...)** — the
  `WorkflowSubjectHandler` registry is built to support this additively (register one
  more handler + one more array entry in `WorkflowModule`), but only Purchase Order is
  actually wired this sprint, per the brief's "choose the smallest useful integration."
- **`GET /workflows/instances/:id/eligible-approvers` at scale** — an O(n) scan over
  every organisation `User`, fine at this sprint's expected scale, not indexed for a
  large organisation (§6).
- **Tightening `PATCH /procurement/purchase-orders/:id` to remove direct `PENDING`-
  setting** — a natural, low-risk follow-up (§8) deliberately left for its own
  reviewed change rather than bundled into this sprint's foundation work.
- **Notifications** — explicitly out of scope; §17 covers the event boundary this
  sprint leaves for it.

## 17. Event Boundary for Future Notifications

`workflow-events.ts` — the exact `maintenance-events.ts` convention Sprint 22
established: a plain, exported name+shape catalog (`WORKFLOW_EVENTS`), each entry
cross-referenced to the `WORKFLOW_AUDIT_ACTIONS` entry already recorded at that exact
moment. No `EventEmitter`, no subscriber, no new npm dependency — nothing wired to
anything. The audit trail already carries every field (actor, tenant, timestamp,
workflow instance, subject) a future real dispatcher would need, so it _is_ the event
log until one is built. Events documented: `SUBMITTED`, `STEP_ASSIGNED`,
`APPROVAL_REQUIRED` (the one a "My Approvals" push notification would hang off of),
`APPROVED`, `REJECTED`, `RETURNED`, `CANCELLED`, `COMPLETED`.
