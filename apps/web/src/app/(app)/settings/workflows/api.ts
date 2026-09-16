import { apiFetch } from '@/lib/api-client';

/**
 * Shared API client for Sprint 26's Workflow & Approval Foundation
 * (docs/domains/workflow.md), following the exact `settings/access/api.ts`
 * one-shared-file-per-domain convention.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AccessScope =
  | 'ORGANISATION'
  | 'OWN_RECORDS'
  | 'OWN_TEAM'
  | 'DEPARTMENT'
  | 'ASSIGNED_RECORDS'
  | 'ASSIGNED_TERRITORY'
  | 'ASSIGNED_ASSETS'
  | 'NONE';

export type WorkflowDefinitionStatus = 'ACTIVE' | 'INACTIVE';
export type WorkflowInstanceStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'IN_PROGRESS'
  | 'APPROVED'
  | 'REJECTED'
  | 'RETURNED'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'COMPLETED';
export type WorkflowStepInstanceStatus =
  'PENDING' | 'ACTIVE' | 'APPROVED' | 'REJECTED' | 'RETURNED' | 'CANCELLED';
export type WorkflowDecisionType = 'APPROVE' | 'REJECT' | 'RETURN' | 'CANCEL';

export interface WorkflowStep {
  id: string;
  workflowDefinitionId: string;
  name: string;
  code: string;
  sequence: number;
  requiredPermission: string;
  requiredScope: AccessScope | null;
  assignedUserId: string | null;
  active: boolean;
}

export interface WorkflowDefinition {
  id: string;
  organisationId: string;
  name: string;
  code: string;
  description: string | null;
  subjectType: string;
  status: WorkflowDefinitionStatus;
  version: number;
  allowSelfApproval: boolean;
  createdAt: string;
  updatedAt: string;
  steps: WorkflowStep[];
}

export interface WorkflowDefinitionWithUsage extends WorkflowDefinition {
  instanceCount: number;
}

export interface WorkflowStepInstance {
  id: string;
  workflowInstanceId: string;
  definitionStepId: string | null;
  stepNameSnapshot: string;
  sequence: number;
  requiredPermissionSnapshot: string;
  requiredScopeSnapshot: AccessScope | null;
  assignedUserIdSnapshot: string | null;
  status: WorkflowStepInstanceStatus;
  startedAt: string | null;
  completedAt: string | null;
}

export interface WorkflowInstance {
  id: string;
  organisationId: string;
  workflowDefinitionId: string;
  workflowDefinitionVersion: number;
  subjectType: string;
  subjectId: string;
  status: WorkflowInstanceStatus;
  requestedById: string;
  submittedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  dueAt: string | null;
  expiredAt: string | null;
  resubmittedAt: string | null;
  resubmissionCount: number;
  previousInstanceId: string | null;
  /** Sprint 26.1 — computed server-side at read time, never persisted; `true` only
   *  when `dueAt` has passed AND the instance is still non-terminal. */
  isOverdue: boolean;
  createdAt: string;
  updatedAt: string;
  stepInstances: WorkflowStepInstance[];
}

export interface WorkflowEventRecord {
  id: string;
  workflowInstanceId: string;
  eventType: string;
  actorUserId: string | null;
  targetUserId: string | null;
  workflowStepInstanceId: string | null;
  correlationId: string;
  summary: Record<string, unknown> | null;
  occurredAt: string;
}

export interface MyApprovalItem extends WorkflowStepInstance {
  workflowInstance: WorkflowInstance;
}

export interface WorkflowDecisionRecord {
  id: string;
  workflowInstanceId: string;
  workflowStepInstanceId: string;
  actorUserId: string;
  decision: WorkflowDecisionType;
  comment: string | null;
  createdAt: string;
}

export interface EligibleApprover {
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
}

// ---------------------------------------------------------------------------
// Workflow Definitions
// ---------------------------------------------------------------------------

export function listWorkflowDefinitions() {
  return apiFetch<{ items: WorkflowDefinitionWithUsage[] }>('/workflows/definitions');
}

export function getWorkflowDefinition(id: string) {
  return apiFetch<WorkflowDefinition>(`/workflows/definitions/${id}`);
}

export interface WorkflowStepInput {
  name: string;
  code: string;
  sequence: number;
  requiredPermission: string;
  requiredScope?: AccessScope;
  assignedUserId?: string | null;
}

export function createWorkflowDefinition(payload: {
  name: string;
  code: string;
  description?: string;
  subjectType: string;
  allowSelfApproval?: boolean;
  steps: WorkflowStepInput[];
}) {
  return apiFetch<WorkflowDefinition>('/workflows/definitions', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateWorkflowDefinition(
  id: string,
  payload: {
    name?: string;
    description?: string | null;
    allowSelfApproval?: boolean;
    steps?: WorkflowStepInput[];
  },
) {
  return apiFetch<WorkflowDefinition>(`/workflows/definitions/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function activateWorkflowDefinition(id: string) {
  return apiFetch<WorkflowDefinition>(`/workflows/definitions/${id}/activate`, {
    method: 'POST',
  });
}

export function deactivateWorkflowDefinition(id: string) {
  return apiFetch<WorkflowDefinition>(`/workflows/definitions/${id}/deactivate`, {
    method: 'POST',
  });
}

// ---------------------------------------------------------------------------
// Workflow Instances
// ---------------------------------------------------------------------------

export function listWorkflowInstances(params?: {
  status?: WorkflowInstanceStatus;
  subjectType?: string;
  overdue?: boolean;
}) {
  const qs = new URLSearchParams();
  if (params?.status) qs.set('status', params.status);
  if (params?.subjectType) qs.set('subjectType', params.subjectType);
  if (params?.overdue) qs.set('overdue', 'true');
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return apiFetch<{ items: WorkflowInstance[] }>(`/workflows/instances${suffix}`);
}

export function getWorkflowInstance(id: string) {
  return apiFetch<WorkflowInstance>(`/workflows/instances/${id}`);
}

export function getWorkflowInstanceHistory(id: string) {
  return apiFetch<{ items: WorkflowDecisionRecord[] }>(`/workflows/instances/${id}/history`);
}

export function getWorkflowInstanceEvents(id: string) {
  return apiFetch<{ items: WorkflowEventRecord[] }>(`/workflows/instances/${id}/events`);
}

export function getEligibleApprovers(id: string) {
  return apiFetch<{ items: EligibleApprover[] }>(`/workflows/instances/${id}/eligible-approvers`);
}

export function createWorkflowInstance(payload: {
  workflowDefinitionCode: string;
  subjectType: string;
  subjectId: string;
  dueAt?: string;
}) {
  return apiFetch<WorkflowInstance>('/workflows/instances', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function submitWorkflowInstance(id: string) {
  return apiFetch<WorkflowInstance>(`/workflows/instances/${id}/submit`, { method: 'POST' });
}

export function approveWorkflowInstance(id: string, comment?: string) {
  return apiFetch<WorkflowInstance>(`/workflows/instances/${id}/approve`, {
    method: 'POST',
    body: JSON.stringify({ comment }),
  });
}

/** Sprint 26.1 — `comment` is mandatory server-side; the caller (the decision dialog)
 *  is responsible for not submitting an empty one. */
export function rejectWorkflowInstance(id: string, comment: string) {
  return apiFetch<WorkflowInstance>(`/workflows/instances/${id}/reject`, {
    method: 'POST',
    body: JSON.stringify({ comment }),
  });
}

/** Sprint 26.1 — `comment` is mandatory server-side; the caller (the decision dialog)
 *  is responsible for not submitting an empty one. */
export function returnWorkflowInstance(id: string, comment: string) {
  return apiFetch<WorkflowInstance>(`/workflows/instances/${id}/return`, {
    method: 'POST',
    body: JSON.stringify({ comment }),
  });
}

export function cancelWorkflowInstance(id: string) {
  return apiFetch<WorkflowInstance>(`/workflows/instances/${id}/cancel`, { method: 'POST' });
}

/** Sprint 26.1 §3 — resubmits a `RETURNED` instance as a new, linked instance
 *  (`previousInstanceId`), restarting the approval chain from step 1. */
export function resubmitWorkflowInstance(id: string) {
  return apiFetch<WorkflowInstance>(`/workflows/instances/${id}/resubmit`, { method: 'POST' });
}

/** Sprint 26.1 §9 — manually triggers the `EXPIRED` transition; only succeeds once
 *  `dueAt` has passed. No scheduled job calls this yet (deliberately out of scope). */
export function expireWorkflowInstance(id: string) {
  return apiFetch<WorkflowInstance>(`/workflows/instances/${id}/expire`, { method: 'POST' });
}

// ---------------------------------------------------------------------------
// My Approvals
// ---------------------------------------------------------------------------

export function listMyApprovals() {
  return apiFetch<{ items: MyApprovalItem[] }>('/workflows/instances/my-approvals');
}
