import type { BadgeProps } from '@zentuva/ui';

import type {
  AccessScope,
  WorkflowDefinitionStatus,
  WorkflowInstanceStatus,
  WorkflowStepInstanceStatus,
} from './api';

export const WORKFLOW_DEFINITION_STATUS_LABELS: Record<WorkflowDefinitionStatus, string> = {
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
};

export const WORKFLOW_DEFINITION_STATUS_VARIANT: Record<
  WorkflowDefinitionStatus,
  NonNullable<BadgeProps['variant']>
> = {
  ACTIVE: 'success',
  INACTIVE: 'default',
};

export const WORKFLOW_INSTANCE_STATUS_LABELS: Record<WorkflowInstanceStatus, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  IN_PROGRESS: 'In Progress',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  RETURNED: 'Returned',
  CANCELLED: 'Cancelled',
  EXPIRED: 'Expired',
  COMPLETED: 'Completed',
};

export const WORKFLOW_INSTANCE_STATUS_VARIANT: Record<
  WorkflowInstanceStatus,
  NonNullable<BadgeProps['variant']>
> = {
  DRAFT: 'default',
  SUBMITTED: 'default',
  IN_PROGRESS: 'default',
  APPROVED: 'success',
  REJECTED: 'destructive',
  RETURNED: 'destructive',
  CANCELLED: 'default',
  EXPIRED: 'destructive',
  COMPLETED: 'success',
};

/** Sprint 26.1 — non-terminal statuses that a workflow instance chain can still act
 *  on; used by the instance detail page to decide which lifecycle actions to offer. */
export const NON_TERMINAL_INSTANCE_STATUSES: WorkflowInstanceStatus[] = [
  'DRAFT',
  'SUBMITTED',
  'IN_PROGRESS',
];

export const WORKFLOW_STEP_STATUS_LABELS: Record<WorkflowStepInstanceStatus, string> = {
  PENDING: 'Pending',
  ACTIVE: 'Active',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  RETURNED: 'Returned',
  CANCELLED: 'Cancelled',
};

export const ACCESS_SCOPE_LABELS: Record<AccessScope, string> = {
  ORGANISATION: 'Whole Organisation',
  OWN_RECORDS: 'Own Records Only',
  OWN_TEAM: 'Own Team',
  DEPARTMENT: 'Own Department',
  ASSIGNED_RECORDS: 'Assigned Records',
  ASSIGNED_TERRITORY: 'Assigned Territory',
  ASSIGNED_ASSETS: 'Assigned Assets',
  NONE: 'No Access (scoped to nothing)',
};
