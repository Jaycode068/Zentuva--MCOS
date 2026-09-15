# Sprint 26 Completion Report — Workflow & Approval Foundation

## 1. Existing workflow-related lifecycle implementations inspected

Before designing anything, inspected the actual, current Purchase Order lifecycle
(`apps/api/src/procurement/purchase-order/`) rather than assuming one:
`PurchaseOrderStatus` (`DRAFT → PENDING → APPROVED → PARTIALLY_RECEIVED → RECEIVED`,
`CANCELLED` a terminal branch from `DRAFT`/`PENDING`) already reserved `APPROVED` and
an `approvedById` column since Sprint 4.3, with that column's own doc comment reading
_"Always null in this sprint — no approval workflow exists yet. Reserved for when
APPROVED becomes reachable."_ Confirmed by full-repo inspection that **nothing**
anywhere transitioned a Purchase Order to `PENDING` via a dedicated action or to
`APPROVED` at all — the generic `PATCH /procurement/purchase-orders/:id` endpoint's
Zod schema restricted `status` to `z.enum(['DRAFT', 'PENDING'])`, explicitly commented
_"APPROVED/RECEIVED aren't reachable by any endpoint this sprint."_

Also inspected: `identity/authorization/effective-access-resolver.ts` and
`scope-evaluator.ts` (Sprint 25, unchanged in this sprint — the exact primitives
Workflow's eligibility engine reuses), `identity/authorization/permission-catalogue.ts`
(121 entries at the Sprint 25.1 baseline), `access-control/` module structure (the
`AccessControlModule → HrModule` one-directional read-only import — the precedent
`WorkflowModule → PurchaseOrderModule` copies exactly), and
`maintenance/maintenance-events.ts` (the plain-catalog, no-emitter event-boundary
convention `workflow-events.ts` copies exactly).

No competing authorization system was created. No existing Purchase Order business
rule, audit event, or Procurement/Inventory integration boundary was changed.

## 2. Access Control integration approach

Two-layer authorization, by design (workflow.md §2.2):

1. **Controller-level `@RequirePermission`** — a coarse, static "may this user use the
   workflow engine's approval machinery at all" gate.
2. **Service-level `WorkflowEligibilityService`** — the real, dynamic decision, calling
   `EffectiveAccessResolver.resolve()` + `ScopeEvaluator.hasAny`/`hasScope` per request,
   never cached, re-evaluated on every single approval attempt. Checks, in order:
   self-approval policy → explicit assignment → user active → permission (+ optional
   scope).

Zero new authorization primitives. No workflow-specific `Role`/`Permission` table, no
`user.position === 'X'` or `role.name === 'X'` or `department.name === 'X'` check
anywhere in `src/workflow/` — enforced executably by
`workflow-independence.spec.ts`'s dedicated guard for exactly that.

## 3. Workflow data model

Five new tables, one new top-level domain module (`apps/api/src/workflow/`):

- **`WorkflowDefinition`** — tenant-scoped, `(organisationId, code)` unique,
  `subjectType`, `status` (`ACTIVE`/`INACTIVE`), `version` (bumped on step edits to an
  active definition), `allowSelfApproval` (default `false`).
- **`WorkflowStep`** — `sequence`-ordered, `requiredPermission` (a real catalogue key),
  optional `requiredScope`, optional explicit `assignedUserId`. Unique
  `(definitionId, code)` and `(definitionId, sequence)`.
- **`WorkflowInstance`** — `(subjectType, subjectId)` reference, `status` (8-state
  lifecycle, §see workflow.md §4), `requestedById`, `submittedAt`/`completedAt`/
  `cancelledAt`.
- **`WorkflowStepInstance`** — a **snapshot** of one `WorkflowStep`, taken at
  `WorkflowInstance` creation (not submission), so a later definition edit never
  rewrites an in-progress approval. Only one `ACTIVE` per instance at a time.
- **`WorkflowDecision`** — immutable, append-only. `APPROVE`/`REJECT`/`RETURN`/`CANCEL`.

Full field-by-field detail: [`docs/domains/workflow.md`](domains/workflow.md) §3.

## 4. Migration details

`20260915085005_sprint26_workflow_approval_foundation` — five new tables, four new
enums (`WorkflowDefinitionStatus`, `WorkflowInstanceStatus`,
`WorkflowStepInstanceStatus`, `WorkflowDecisionType`), reusing the existing
`AccessScope` enum for `requiredScope`/`requiredScopeSnapshot`. **Zero changes to any
existing table** — `PurchaseOrder.approvedById` (Sprint 4.3) is the only pre-existing
column this sprint populates for the first time. Applied cleanly to the local dev
database; `prisma validate` and `prisma generate` both clean.

## 5. Permission catalogue additions

121 → **132** entries (+11, one more than the brief's suggested list since
`procurement.purchase_order.approve` was also needed and didn't exist):

`workflow.definition.view`, `workflow.definition.manage`, `workflow.instance.view`,
`workflow.instance.submit`, `workflow.instance.cancel`, `workflow.approval.view`,
`workflow.approval.approve`, `workflow.approval.reject`, `workflow.approval.return`,
`workflow.audit.view`, `procurement.purchase_order.approve` (`SCOPABLE`).

The existing catalogue was searched first (per the brief's own instruction) — none of
these already existed under a different name; each is a genuine new distinction (e.g.
"may submit a workflow" is not the same claim as "may edit a purchase order").
Role grants updated deliberately in seed data (§12) — no permission was granted to
every employee by default, and Administrator's existing "grant every catalogue
permission" mechanism picked these up automatically with no seed code change required.

## 6. Workflow lifecycle

`DRAFT → SUBMITTED → IN_PROGRESS → APPROVED → COMPLETED`, with `REJECTED`/`RETURNED`/
`CANCELLED` as terminal-for-this-instance branches from `IN_PROGRESS` (`CANCELLED`
also reachable from `DRAFT`). Full state-by-state semantics:
[`docs/domains/workflow.md`](domains/workflow.md) §4.

## 7. Sequential approval behaviour

Only the current `ACTIVE` step can be acted upon; a future step can't be approved
early; a decided step can't be re-decided (enforced by the concurrency-safe
conditional transition, §13); approving the final step transitions the instance to
`APPROVED` and calls the subject handler; self-approval blocked by default,
organisation-configurable per definition, not snapshotted (read live — a deliberate
choice, explained in workflow.md §5); `RETURNED` is terminal for the instance in this
MVP — resuming means submitting a **new** `WorkflowInstance`, never rewinding
already-decided steps (workflow.md §5's restart/resume rule).

## 8. Eligibility resolution

`WorkflowEligibilityService.checkStepEligibility()` — self-approval → explicit
assignment → user-active → permission(+scope), in that order, fully re-evaluated per
request. `listEligibleApprovers()` powers the eligible-approvers endpoint and reuses
the same check per organisation user (no reverse permission index exists — documented
as a scale limitation, not a correctness gap, in workflow.md §6/§16).

## 9. Scope enforcement

`ScopeEvaluator.hasScope()` is used exactly as Access Control already defined it —
proving the candidate **holds** the step's `requiredScope`, never proving that the
specific subject record falls within that scope (no Purchase Order has a
department/team relationship to check against). This sprint's seed data only
configures `ORGANISATION` scope for that reason — the one fully-provable choice —
while the data model and guard logic genuinely support narrower scopes the moment a
future subject type's domain data can support the check. Documented honestly in
workflow.md §6, following the exact precedent Sprint 25.1 set for
`ASSIGNED_TERRITORY`.

## 10. Domain integrations completed

**One** — Purchase Order (`PurchaseOrderWorkflowHandler`), per the brief's "choose the
smallest useful integration." `validateForSubmission` (must be `DRAFT`),
`onWorkflowSubmitted` (`DRAFT → PENDING`), `onWorkflowApproved` (`PENDING → APPROVED`,
sets `approvedById`), `onWorkflowExited` (reject/return/cancel → `PENDING → DRAFT`,
no-op if the PO never left `DRAFT`). Zero schema, service, or controller changes to
`PurchaseOrder` itself. Full design rationale and the one honestly-documented gap this
sprint deliberately left alone (the generic `PATCH` endpoint can still set
`PENDING` directly, bypassing Workflow — unchanged Sprint 4.3 behaviour):
[`docs/domains/workflow.md`](domains/workflow.md) §8.

Supplier Payment integration was **not** implemented — inspecting the existing Payment
domain, there was no clean draft/submission boundary equivalent to Purchase Order's
already-reserved `PENDING`/`APPROVED` slot, and the brief made this integration
explicitly conditional ("if the existing payment domain has a suitable draft/
submission lifecycle"). Documented as deferred, not attempted with an unsafe rewrite.

## 11. APIs added

17 endpoints under `/workflows/definitions/*` and `/workflows/instances/*` — full
table with permissions: [`docs/domains/workflow.md`](domains/workflow.md) §10. One
deliberate route-shape deviation from the brief's suggested list: `my-approvals` is
nested under `/workflows/instances/` rather than a separate top-level
`/workflows/my-approvals`, since it returns instance-adjacent step data and the brief's
own routes were explicitly framed as suggestions.

## 12. UI routes added

`/settings/workflows` (Overview), `/settings/workflows/definitions` (list + create),
`/settings/workflows/definitions/:id` (detail, edit steps, activate/deactivate),
`/settings/workflows/instances` (list), `/settings/workflows/instances/:id` (detail +
history), `/settings/workflows/my-approvals` (backend-filtered approve/reject/return
actions). Plus a new "Submit for Approval" button on the existing
`/settings/procurement` page (visible only for `DRAFT` orders).

Known, documented frontend limitation: the Workflow Definitions admin buttons are not
yet hidden for users lacking `workflow.definition.manage` (clicking correctly 403s
server-side; the button itself still renders) — workflow.md §9's own honest note,
matching this codebase's established practice of naming known UI-polish gaps.

## 13. Audit events

Ten `AuditLog` actions, all via the standard `AuditService.record()` call-after-the-
fact convention (never inside the state-change transaction, matching every other
domain): `workflow.definition.created/updated/activated/deactivated`,
`workflow.instance.created/submitted/cancelled`, `workflow.approval.granted/rejected/
returned`. `workflow.approval.denied` is defined but not yet wired to a call site — a
documented deferred capability (no other domain in this codebase audits denied
_attempts_ either, only successful mutations). Every `WorkflowDecision` row is itself
a second, permanent, immutable record independent of `AuditLog`, readable via
`GET /workflows/instances/:id/history` under `workflow.audit.view`.

## 14. Concurrency and idempotency safeguards

Every transition is a **conditional `updateMany`** keyed on expected current status —
this codebase's own established idiom (`PurchaseOrderRepository.update`,
`AttendanceRepository.findOrCreateForDate`), not a new pattern. `decideStep` wraps the
step-status update and the new `WorkflowDecision` insert in one `prisma.$transaction`.
Live-verified (§18): two concurrent `approve` requests against the same step produced
exactly one `201` and one `409`, with exactly one `WorkflowDecision` row written; two
concurrent `submit` requests produced one `201` and one `409`; a subject with an
`IN_PROGRESS` instance correctly rejected a second concurrent submission attempt,
while a subject whose only instance was terminal (cancelled) correctly accepted a
fresh one.

## 15. Seed changes and repeated-run results

New `seedWorkflowFixtures()` function (own idempotency guard, matching the
`seedAccessControlFixtures`/`seedHrFixtures` per-sprint-function convention — **not**
added inside `seedAccessControlFixtures`, whose own early-return guard would have
silently skipped it on every subsequent run). Seeds:

- One `PURCHASE_ORDER_APPROVAL` workflow definition, `ACTIVE`, two sequential steps
  (Procurement Review — permission+scope only; Final Approval — the same
  permission+scope plus an explicit assignee, demonstrating both eligibility
  mechanisms).
- Two new roles: "Procurement Officer" (create/edit/view POs, submit/cancel workflow
  instances, **no** approve permission — self-approval structurally impossible) and
  "Purchase Order Approver" (`procurement.purchase_order.approve` + the
  `workflow.approval.*` permissions).
- Two new demo users, each linking a previously-unlinked Sprint 23 Employee (the
  `seedDemoEmployeeUser` pattern Sprint 25 established): Ibrahim Musa (`EMP-000004`,
  Procurement Officer) and Grace Effiong (`EMP-000005`, Warehouse Supervisor → Purchase
  Order Approver).

Ran the seed **three times** in this session: first run seeded 132 permissions and the
new definition/steps/roles/users; second and third runs both printed "Skipping Sprint
26 Workflow fixtures — already seeded" with identical row counts
(`{ defs: 1, steps: 2 }`, `permissionsSeeded: 132` unchanged) — confirmed idempotent.
No existing role's functionality was altered; no existing seed data was overwritten.

## 16. Files changed

**New (API):**

```text
apps/api/prisma/migrations/20260915085005_sprint26_workflow_approval_foundation/migration.sql
apps/api/src/workflow/workflow-audit-actions.ts
apps/api/src/workflow/workflow-events.ts
apps/api/src/workflow/workflow-subject-handler.ts
apps/api/src/workflow/workflow-definition.repository.ts
apps/api/src/workflow/workflow-definition.service.ts
apps/api/src/workflow/workflow-definition.service.spec.ts
apps/api/src/workflow/workflow-definition.controller.ts
apps/api/src/workflow/workflow-instance.repository.ts
apps/api/src/workflow/workflow-instance.service.ts
apps/api/src/workflow/workflow-instance.service.spec.ts
apps/api/src/workflow/workflow-instance.controller.ts
apps/api/src/workflow/workflow-eligibility.service.ts
apps/api/src/workflow/workflow-eligibility.service.spec.ts
apps/api/src/workflow/workflow-independence.spec.ts
apps/api/src/workflow/workflow.module.ts
apps/api/src/workflow/handlers/purchase-order-workflow.handler.ts
apps/api/src/workflow/handlers/purchase-order-workflow.handler.spec.ts
packages/validation/src/workflow.ts
```

**Modified (API):**

```text
apps/api/prisma/schema.prisma
apps/api/prisma/seed.ts
apps/api/src/app.module.ts
apps/api/src/identity/authorization/permission-catalogue.ts
packages/validation/src/index.ts
```

**New (Web):**

```text
apps/web/src/app/(app)/settings/workflows/api.ts
apps/web/src/app/(app)/settings/workflows/labels.ts
apps/web/src/app/(app)/settings/workflows/step-editor.tsx
apps/web/src/app/(app)/settings/workflows/page.tsx
apps/web/src/app/(app)/settings/workflows/definitions/page.tsx
apps/web/src/app/(app)/settings/workflows/definitions/[id]/page.tsx
apps/web/src/app/(app)/settings/workflows/instances/page.tsx
apps/web/src/app/(app)/settings/workflows/instances/[id]/page.tsx
apps/web/src/app/(app)/settings/workflows/my-approvals/page.tsx
apps/web/src/components/app/workflow-tabs.tsx
```

**Modified (Web):**

```text
apps/web/src/app/(app)/settings/procurement/page.tsx
apps/web/src/components/workspace/icons.tsx
apps/web/src/components/workspace/navigation-config.ts
```

**Documentation (new/modified):**

```text
docs/domains/workflow.md                    (new)
docs/sprint-26-completion-report.md          (new, this file)
docs/domains/README.md
docs/domains/access-control.md
docs/domains/procurement.md
README.md
docs/roadmap.md
docs/backlog.md
docs/changelog.md
```

## 17. Tests added

**55 new tests, 5 new suites** — full breakdown in
[`docs/domains/workflow.md`](domains/workflow.md) §14:
`workflow-eligibility.service.spec.ts` (12), `workflow-definition.service.spec.ts`
(13), `workflow-instance.service.spec.ts` (18),
`handlers/purchase-order-workflow.handler.spec.ts` (7),
`workflow-independence.spec.ts` (5).

## 18. Final test suites and count

**181 suites / 1540 tests passing** (176 suites / 1485 tests Sprint 25.1 baseline + 5
suites / 55 tests). Zero failures, zero skipped.

## 19. API typecheck result

Clean. `pnpm --filter api exec tsc --noEmit` — zero errors.

## 20. Web typecheck result

Clean. `pnpm --filter web exec tsc --noEmit` — zero errors.

## 21. API lint result

Clean — **27 pre-existing warnings**, the identical set Sprint 25.1's own baseline
already carried (all in `finance/budgeting/*.spec.ts`, all `@typescript-eslint/
no-explicit-any`/unused-import warnings predating this sprint). Zero new warnings, zero
errors.

## 22. Web lint result

Clean. `pnpm --filter web lint` — "No ESLint warnings or errors."

## 23. API build result

Not separately run as a standalone build step this sprint (typecheck + full test suite

- a clean dev-server boot with every route mapped, §24, cover the same ground the
  compiled build would) — the dev server was rebuilt and re-verified live multiple times
  during this sprint's work, always booting cleanly with zero DI errors and every
  `/api/workflows/*` route correctly mapped.

## 24. Web build result

`pnpm --filter web build` — succeeded. All 6 new workflow routes built correctly
(`/settings/workflows`, `/settings/workflows/definitions` [+ `[id]`],
`/settings/workflows/instances` [+ `[id]`], `/settings/workflows/my-approvals`), no
new warnings, no errors.

## 25. Live verification scenarios

All performed against the real database and real, freshly-issued JWTs — no mocks. In
order (numbers reference the brief's own 24-point checklist):

1–2. Seeded `PURCHASE_ORDER_APPROVAL` definition confirmed `ACTIVE`, two sequential
steps each requiring `procurement.purchase_order.approve` @ `ORGANISATION`. 3. A DRAFT Purchase Order (`PO-000004`) created as Ibrahim Musa; a `WorkflowInstance`
created and submitted — Purchase Order correctly transitioned to `PENDING`. 4. Grace Effiong's `GET /workflows/instances/my-approvals` showed exactly the one
eligible step ("Procurement Review"). 5. `member@bobybites.local` (no workflow permissions at all) received `403
Forbidden` attempting to even create a workflow instance. 6. Direct `POST .../approve` as the same ineligible user → `403 Forbidden`.
7–8. Grace approved step 1 (with a comment) — instance advanced to `IN_PROGRESS`,
step 2 activated, step 1 recorded `APPROVED`. 9. Grace's repeat attempt on the now-active step 2 correctly denied ("This step is
assigned to a specific approver" — she is not the explicit assignee).
10–11. Administrator (the explicit step-2 assignee) approved — instance reached
`APPROVED`; Purchase Order reached `APPROVED` with `approvedById` correctly set to
Administrator's user id. 12. A second Purchase Order's workflow instance was rejected by Grace at step 1 —
instance `REJECTED`, Purchase Order correctly reverted to `DRAFT`; a repeat approval
attempt correctly failed ("no active step to act on"). 13. A third instance was returned (not rejected) — instance `RETURNED`, Purchase Order
reverted to `DRAFT`, confirming the documented restart/resume rule (no step rewound). 14. Grace's "Purchase Order Approver" role was removed via
`DELETE /access/users/:userId/roles/:roleId` mid-flight on a fourth instance — her
same still-valid token's next approval attempt was immediately denied (`403`). 15. Grace's linked Employee was suspended (`POST /hr/employees/:id/suspend`) — her
same still-valid token's approval attempt was immediately denied (`403`); reactivating
the Employee alone did **not** restore access (Sprint 25's documented "reactivate is
deliberately not symmetric" — a separate `PATCH /users/:id` with `status: "ACTIVE"`
was required, correctly confirming that documented behaviour rather than exposing a
bug). 16. A second organisation's Owner (`owner@testtenant.local`) received `404` on a
direct `GET` of Boby Bites' `WorkflowInstance` id and `404` on an approval attempt
against it (tenant scoping rejected the request before eligibility was even checked). 17. The same rival-org user's `GET /workflows/instances` returned `{"items":[]}`
(empty), and their own `POST /workflows/instances` against a `PURCHASE_ORDER_APPROVAL`
code that only exists in Boby Bites correctly `404`'d ("Workflow definition ... not
found"). 18. `GET /workflows/instances/:id/history` showed every decision in the correct order
with correct actor ids and comments, for every instance exercised. 19. Two concurrent `approve` requests against the same active step: one `201`, one
`409 Conflict`; exactly one `WorkflowDecision` row confirmed via direct query. Two
concurrent `submit` requests against the same instance: one `201`, one `409`.
20–21. The full existing Procurement/Inventory test suite (production, inventory,
finance, sales, distribution regression suites) still passes unchanged — 181/1540
green — and manual PO create/edit/cancel via the existing endpoints was exercised
throughout this session with no behaviour change observed. 22. Attempted `PATCH /workflows/definitions/:id` with a new step list while two
instances were still `IN_PROGRESS` — correctly rejected ("Cannot change steps while 2
workflow instance(s) are still in progress"), proving in-progress snapshots can never
be silently rewritten (a stronger guarantee than just relying on the snapshot alone). 23. The Workflow Definitions page was verified live in the browser at 375px width —
graceful degradation (tabs scroll horizontally, a clear inline permission error for an
unauthorized viewer, no broken layout). 24. Console/network inspection after every live browser interaction (page loads, the
My Approvals "Approve" action) showed zero unexpected errors — the only console errors
observed for the whole session traced to one deliberate wrong-id test navigation, not
an application defect (confirmed by re-checking with the correct id immediately after).

All test data left in a resolved, terminal state (no orphaned in-progress workflow
instances remain); Grace's suspended-then-restored account and removed-then-restored
role were both fully reverted to their pre-verification state.

## 26. Existing domain regression results

Zero regressions. Full suite green before and after this sprint's changes at every
checkpoint (181/1540 final). No existing Purchase Order, Inventory, Finance,
Procurement, or Access Control test needed modification.

## 27. Deferred capabilities

Full list with reasoning: [`docs/domains/workflow.md`](domains/workflow.md) §16.
Summary: `RETURNED` resume-in-place (new instance instead), record-level scope proof
for non-`ORGANISATION` scopes, `workflow.approval.denied` audit wiring, a second domain
integration (Supplier Payment/Sales Order), parallel/branching approval, an expression
engine, a visual builder, escalation/SLA/delegation, Notifications (event boundary only
— `workflow-events.ts`), permission-aware hiding of the Workflow Definitions admin
buttons, an indexed reverse-eligibility lookup for `listEligibleApprovers` at scale,
and tightening the pre-existing `PATCH /procurement/purchase-orders/:id` endpoint to
remove its independent `PENDING`-setting path.

## 28. Documentation updates

New: `docs/domains/workflow.md`, `docs/sprint-26-completion-report.md` (this file).
Updated: `docs/domains/README.md` (new status row), `docs/domains/access-control.md`
(§15 "Future Workflow Integration Points" confirmed fulfilled), `docs/domains/
procurement.md` (new "Sprint 26 update" section closing its own long-standing "no
approval workflow exists yet" note), root `README.md`, `docs/roadmap.md` (Sprint 26
marked shipped), `docs/backlog.md` (current-focus narrative extended). The engineering
handbook was not changed — this sprint's two-layer authorization pattern is a
domain-specific application of Access Control's existing principles, fully documented
in workflow.md itself, not a new cross-cutting product/engineering principle.

---

## Not committed or pushed

Per this sprint's explicit instruction, all work remains uncommitted. `git status`
confirms every file listed in §16 as modified or untracked, nothing staged, nothing
committed.
