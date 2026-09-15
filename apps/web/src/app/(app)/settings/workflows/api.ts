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
  createdAt: string;
  updatedAt: string;
  stepInstances: WorkflowStepInstance[];
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
}) {
  const qs = new URLSearchParams();
  if (params?.status) qs.set('status', params.status);
  if (params?.subjectType) qs.set('subjectType', params.subjectType);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return apiFetch<{ items: WorkflowInstance[] }>(`/workflows/instances${suffix}`);
}

export function getWorkflowInstance(id: string) {
  return apiFetch<WorkflowInstance>(`/workflows/instances/${id}`);
}

export function getWorkflowInstanceHistory(id: string) {
  return apiFetch<{ items: WorkflowDecisionRecord[] }>(`/workflows/instances/${id}/history`);
}

export function getEligibleApprovers(id: string) {
  return apiFetch<{ items: EligibleApprover[] }>(`/workflows/instances/${id}/eligible-approvers`);
}

export function createWorkflowInstance(payload: {
  workflowDefinitionCode: string;
  subjectType: string;
  subjectId: string;
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

export function rejectWorkflowInstance(id: string, comment?: string) {
  return apiFetch<WorkflowInstance>(`/workflows/instances/${id}/reject`, {
    method: 'POST',
    body: JSON.stringify({ comment }),
  });
}

export function returnWorkflowInstance(id: string, comment?: string) {
  return apiFetch<WorkflowInstance>(`/workflows/instances/${id}/return`, {
    method: 'POST',
    body: JSON.stringify({ comment }),
  });
}

export function cancelWorkflowInstance(id: string) {
  return apiFetch<WorkflowInstance>(`/workflows/instances/${id}/cancel`, { method: 'POST' });
}

// ---------------------------------------------------------------------------
// My Approvals
// ---------------------------------------------------------------------------

export function listMyApprovals() {
  return apiFetch<{ items: MyApprovalItem[] }>('/workflows/instances/my-approvals');
}
