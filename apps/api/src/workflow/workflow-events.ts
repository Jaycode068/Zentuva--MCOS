import { WORKFLOW_AUDIT_ACTIONS } from './workflow-audit-actions';

/**
 * Workflow business-event catalog (Sprint 26, docs/domains/workflow.md §11 "Notifications
 * boundary") — the exact convention `maintenance-events.ts` established (Sprint 22): no
 * `EventEmitter`/`DomainEvent`/`NotificationService` exists anywhere in this codebase, and
 * `@nestjs/event-emitter` is not a dependency. Per this sprint's own "do not implement
 * Notifications" instruction, this file is deliberately just a plain, exported name+shape
 * catalog — no emitter, no subscriber, no new npm dependency, nothing wired to anything.
 * Every event name here is cross-referenced to the `WORKFLOW_AUDIT_ACTIONS` entry already
 * recorded at that exact moment — the audit trail already carries every field (actor,
 * tenant, timestamp, workflow instance, subject) a future real dispatcher would need, so
 * it *is* the event log until one is built.
 */
export const WORKFLOW_EVENTS = {
  SUBMITTED: {
    name: 'workflow.submitted',
    auditAction: WORKFLOW_AUDIT_ACTIONS.INSTANCE_SUBMITTED,
  },
  STEP_ASSIGNED: {
    name: 'workflow.step_assigned',
    auditAction: WORKFLOW_AUDIT_ACTIONS.STEP_ASSIGNED,
  },
  /** Fired when a step becomes `ACTIVE` and has at least one resolvable eligible
   *  approver — the future notification a "My Approvals" alert would hang off of.
   *  Nothing computes or emits this yet; documented as the integration point. */
  APPROVAL_REQUIRED: {
    name: 'workflow.approval_required',
    auditAction: WORKFLOW_AUDIT_ACTIONS.STEP_ASSIGNED,
  },
  APPROVED: {
    name: 'workflow.approved',
    auditAction: WORKFLOW_AUDIT_ACTIONS.APPROVAL_GRANTED,
  },
  REJECTED: {
    name: 'workflow.rejected',
    auditAction: WORKFLOW_AUDIT_ACTIONS.APPROVAL_REJECTED,
  },
  RETURNED: {
    name: 'workflow.returned',
    auditAction: WORKFLOW_AUDIT_ACTIONS.APPROVAL_RETURNED,
  },
  CANCELLED: {
    name: 'workflow.cancelled',
    auditAction: WORKFLOW_AUDIT_ACTIONS.INSTANCE_CANCELLED,
  },
  COMPLETED: {
    name: 'workflow.completed',
    auditAction: WORKFLOW_AUDIT_ACTIONS.INSTANCE_COMPLETED,
  },
} as const;

export type WorkflowEventName = (typeof WORKFLOW_EVENTS)[keyof typeof WORKFLOW_EVENTS]['name'];

// === Payload shapes — documentation only, never constructed/emitted ===

export interface WorkflowSubmittedPayload {
  workflowInstanceId: string;
  workflowDefinitionCode: string;
  subjectType: string;
  subjectId: string;
  requestedById: string;
}

export interface WorkflowStepAssignedPayload {
  workflowInstanceId: string;
  workflowStepInstanceId: string;
  stepName: string;
  requiredPermission: string;
  assignedUserId: string | null;
}

export interface WorkflowApprovedPayload {
  workflowInstanceId: string;
  subjectType: string;
  subjectId: string;
  finalApproverId: string;
}

export interface WorkflowRejectedPayload {
  workflowInstanceId: string;
  subjectType: string;
  subjectId: string;
  actorUserId: string;
  comment: string | null;
}

export interface WorkflowReturnedPayload {
  workflowInstanceId: string;
  subjectType: string;
  subjectId: string;
  actorUserId: string;
  comment: string | null;
}

export interface WorkflowCancelledPayload {
  workflowInstanceId: string;
  subjectType: string;
  subjectId: string;
  actorUserId: string;
}

export interface WorkflowCompletedPayload {
  workflowInstanceId: string;
  subjectType: string;
  subjectId: string;
}
