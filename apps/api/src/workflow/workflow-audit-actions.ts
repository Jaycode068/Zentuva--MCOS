/**
 * Sprint 26 — Workflow & Approval Foundation (docs/domains/workflow.md §12). The
 * `<entity>.<event>` naming convention every prior domain's own audit catalog uses
 * (`HR_AUDIT_ACTIONS`, `MAINTENANCE_AUDIT_ACTIONS`, `ACCESS_AUDIT_ACTIONS`, ...).
 */
export const WORKFLOW_AUDIT_ACTIONS = {
  DEFINITION_CREATED: 'workflow.definition.created',
  DEFINITION_UPDATED: 'workflow.definition.updated',
  DEFINITION_ACTIVATED: 'workflow.definition.activated',
  DEFINITION_DEACTIVATED: 'workflow.definition.deactivated',
  INSTANCE_CREATED: 'workflow.instance.created',
  INSTANCE_SUBMITTED: 'workflow.instance.submitted',
  STEP_ASSIGNED: 'workflow.step.assigned',
  APPROVAL_GRANTED: 'workflow.approval.granted',
  APPROVAL_REJECTED: 'workflow.approval.rejected',
  APPROVAL_RETURNED: 'workflow.approval.returned',
  INSTANCE_CANCELLED: 'workflow.instance.cancelled',
  INSTANCE_COMPLETED: 'workflow.instance.completed',
  APPROVAL_DENIED: 'workflow.approval.denied',
  /** Sprint 26.1. */
  INSTANCE_RESUBMITTED: 'workflow.instance.resubmitted',
  INSTANCE_EXPIRED: 'workflow.instance.expired',
} as const;
