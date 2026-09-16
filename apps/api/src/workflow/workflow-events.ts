import { WORKFLOW_AUDIT_ACTIONS } from './workflow-audit-actions';

/**
 * Workflow business-event catalog (Sprint 26.1, docs/domains/workflow.md §7 "Workflow
 * Events"). Sprint 26 shipped this file as documentation-only — a plain name+shape
 * catalog cross-referenced to `WORKFLOW_AUDIT_ACTIONS`, with nothing actually
 * persisted in a structured, Notifications-consumable shape. Sprint 26.1 makes these
 * real: every entry here is an `eventType` value actually written to the durable
 * `WorkflowEvent` table (`workflow-event.repository.ts`) inside the same transaction
 * as the state transition that produced it. Still no `EventEmitter`/dispatcher/queue —
 * that remains a future Notifications sprint's job; this is the durable, queryable
 * record that consumer will read from.
 *
 * Only event types that correspond to an actually-implemented transition are listed —
 * no placeholder for an unsupported transition (Sprint 26.1 brief: "do not create fake
 * events for unsupported transitions").
 */
export const WORKFLOW_EVENT_TYPES = {
  /** `DRAFT` → `SUBMITTED` (fresh submission, not a resubmission — see RESUBMITTED). */
  SUBMITTED: 'SUBMITTED',
  /** A `WorkflowStepInstance` becomes `ACTIVE` — the moment a real approver now has
   *  something waiting on them. Fires for step 1 on submit/resubmit and for every
   *  subsequent step as the previous one is approved. */
  APPROVAL_REQUIRED: 'APPROVAL_REQUIRED',
  /** One step was approved — fires for every approved step, including the final one
   *  (which ALSO fires the separate, one-time `APPROVED` instance-level event below). */
  STEP_APPROVED: 'STEP_APPROVED',
  /** Every required step has been approved and the domain integration has
   *  successfully consumed the outcome (workflow.md §5 "atomicity fix" — this event
   *  never fires if the domain-side transition failed). */
  APPROVED: 'APPROVED',
  /** A step was rejected — always instance-terminal in this sequential MVP (one
   *  rejecting decision rejects the whole instance; there is no per-step-then-continue
   *  semantics), so this doubles as the instance-level "workflow rejected" event. */
  REJECTED: 'REJECTED',
  /** A step was returned for correction — same "step-level and instance-level
   *  coincide" reasoning as `REJECTED`. */
  RETURNED: 'RETURNED',
  /** A new `WorkflowInstance` was created via `resubmit()` against a `RETURNED`
   *  predecessor (workflow.md §3 "Return & Resubmission design") — distinct from
   *  `SUBMITTED`, which only fires for a brand-new, non-resubmission instance. */
  RESUBMITTED: 'RESUBMITTED',
  CANCELLED: 'CANCELLED',
  /** Sprint 26.1 §9 — an explicit, deliberate transition once `dueAt` has passed;
   *  never inferred or silently applied. */
  EXPIRED: 'EXPIRED',
  /** The owning domain has consumed the `APPROVED` outcome (`markCompleted`). */
  COMPLETED: 'COMPLETED',
} as const;

export type WorkflowEventType = (typeof WORKFLOW_EVENT_TYPES)[keyof typeof WORKFLOW_EVENT_TYPES];

/** Cross-reference to the `AuditLog` action recorded at the same moment — every
 *  `WorkflowEvent` has a matching, human-readable `AuditLog` row; this map is purely
 *  informational (e.g. for a future admin view that wants to show both side by side). */
export const WORKFLOW_EVENT_AUDIT_ACTIONS: Record<WorkflowEventType, string> = {
  [WORKFLOW_EVENT_TYPES.SUBMITTED]: WORKFLOW_AUDIT_ACTIONS.INSTANCE_SUBMITTED,
  [WORKFLOW_EVENT_TYPES.APPROVAL_REQUIRED]: WORKFLOW_AUDIT_ACTIONS.STEP_ASSIGNED,
  [WORKFLOW_EVENT_TYPES.STEP_APPROVED]: WORKFLOW_AUDIT_ACTIONS.APPROVAL_GRANTED,
  [WORKFLOW_EVENT_TYPES.APPROVED]: WORKFLOW_AUDIT_ACTIONS.APPROVAL_GRANTED,
  [WORKFLOW_EVENT_TYPES.REJECTED]: WORKFLOW_AUDIT_ACTIONS.APPROVAL_REJECTED,
  [WORKFLOW_EVENT_TYPES.RETURNED]: WORKFLOW_AUDIT_ACTIONS.APPROVAL_RETURNED,
  [WORKFLOW_EVENT_TYPES.RESUBMITTED]: WORKFLOW_AUDIT_ACTIONS.INSTANCE_RESUBMITTED,
  [WORKFLOW_EVENT_TYPES.CANCELLED]: WORKFLOW_AUDIT_ACTIONS.INSTANCE_CANCELLED,
  [WORKFLOW_EVENT_TYPES.EXPIRED]: WORKFLOW_AUDIT_ACTIONS.INSTANCE_EXPIRED,
  [WORKFLOW_EVENT_TYPES.COMPLETED]: WORKFLOW_AUDIT_ACTIONS.INSTANCE_COMPLETED,
};

/**
 * Deterministic idempotency key for one logical occurrence — workflow.md §7 "a
 * retried command must not create duplicate logical events." `subjectKey` is
 * whichever id makes that occurrence happen-exactly-once: a `WorkflowStepInstance` id
 * for step-level events (each step is decided/activated at most once, enforced by
 * `WorkflowInstanceRepository`'s conditional `updateMany`s), or the `WorkflowInstance`
 * id for instance-level events. Re-deriving the same key for the same occurrence is
 * always safe — that is the entire point.
 */
export function buildWorkflowEventIdempotencyKey(
  eventType: WorkflowEventType,
  subjectKey: string,
): string {
  return `${subjectKey}:${eventType}`;
}
