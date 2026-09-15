/**
 * Sprint 26 — Workflow & Approval Foundation (docs/domains/workflow.md §7 "Subject
 * references"). The controlled, typed mechanism a `WorkflowInstance` uses to reach into
 * an existing domain record — deliberately NOT arbitrary dynamic table access (no raw
 * SQL, no interpolated model names). Each supported `subjectType` registers exactly one
 * `WorkflowSubjectHandler`, injected here as an explicit array
 * (`WORKFLOW_SUBJECT_HANDLERS`) rather than looked up by string against a live registry
 * of Prisma models.
 *
 * One-directional dependency, matching `AccessControlModule`'s read-only `HrModule`
 * import (Sprint 25): `WorkflowModule` imports the owning domain's module (e.g.
 * `ProcurementModule`) to construct its handler; the owning domain never imports or
 * knows about `WorkflowModule` at all. Workflow calls into the domain; the domain never
 * calls into Workflow.
 */
export interface WorkflowSubjectValidationResult {
  ok: boolean;
  /** Present only when `ok` is `false` — shown to the caller as the reason submission
   *  was rejected (e.g. "Purchase order is not in a submittable state"). */
  reason?: string;
}

export interface WorkflowSubjectHandler {
  /** Must match `WorkflowDefinition.subjectType` exactly (e.g. `PURCHASE_ORDER`). */
  readonly subjectType: string;

  /** A short, human-readable label for the subject (e.g. `PO-000012`) — used by the
   *  admin UI's Workflow Instances / My Approvals lists so they never need to
   *  special-case rendering per subject type. */
  describe(organisationId: string, subjectId: string): Promise<string | null>;

  /** Called once, before a `WorkflowInstance` is created (workflow.md §7): the subject
   *  must exist, belong to `organisationId`, and be in a state eligible for submission
   *  (e.g. a Purchase Order must be `DRAFT`). Deliberately separate from
   *  `onWorkflowSubmitted` — creating a `WorkflowInstance` (`DRAFT` status) does not
   *  yet touch the subject; only `submit()` does. */
  validateForSubmission(
    organisationId: string,
    subjectId: string,
  ): Promise<WorkflowSubjectValidationResult>;

  /** Called when the `WorkflowInstance` transitions `DRAFT` → `SUBMITTED` — the domain's
   *  own "this record is now awaiting approval" transition (e.g. Purchase Order
   *  `DRAFT` → `PENDING`). Must not duplicate workflow state (workflow.md §2.3) — only
   *  the domain's own fields change here. */
  onWorkflowSubmitted(
    organisationId: string,
    subjectId: string,
    actorUserId: string,
  ): Promise<void>;

  /** Called when every required step has been approved — the domain's own "approval is
   *  complete" transition (e.g. Purchase Order `PENDING` → `APPROVED`, recording
   *  `approvedById`). This is the ONLY thing "workflow reached `APPROVED`" does —
   *  it does not itself confirm, receive, post, or otherwise finalize the record
   *  (workflow.md §2.3); a further domain-specific action, if any, is a separate,
   *  later step the owning domain's own controller still gates. */
  onWorkflowApproved(
    organisationId: string,
    subjectId: string,
    finalApproverId: string,
  ): Promise<void>;

  /** Called on `REJECT`, `RETURN`, or `CANCEL` — the domain's own "send this back for
   *  correction" transition (e.g. Purchase Order `PENDING` → `DRAFT`). All three
   *  decisions map to the same domain-side effect here since the Purchase Order model
   *  has no separate "rejected" state of its own (workflow.md §8) — the distinction
   *  between why the record came back lives entirely in the `WorkflowDecision`/audit
   *  trail, not in the subject's own status column. */
  onWorkflowExited(organisationId: string, subjectId: string, actorUserId: string): Promise<void>;
}

export const WORKFLOW_SUBJECT_HANDLERS = Symbol('WORKFLOW_SUBJECT_HANDLERS');
