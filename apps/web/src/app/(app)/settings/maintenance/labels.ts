import type { BadgeProps } from '@zentuva/ui';

import type {
  MaintenanceCostCategory,
  MaintenanceIssueType,
  MaintenancePartUsageStatus,
  MaintenancePriority,
  MaintenanceProcurementStatus,
  MaintenanceRequestStatus,
  WorkOrderStatus,
  WorkOrderTaskStatus,
} from './api';

export const MAINTENANCE_PRIORITY_LABELS: Record<MaintenancePriority, string> = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
  CRITICAL: 'Critical',
};

export const MAINTENANCE_PRIORITY_VARIANT: Record<
  MaintenancePriority,
  NonNullable<BadgeProps['variant']>
> = {
  LOW: 'default',
  MEDIUM: 'warning',
  HIGH: 'warning',
  CRITICAL: 'destructive',
};

export const MAINTENANCE_REQUEST_STATUS_LABELS: Record<MaintenanceRequestStatus, string> = {
  OPEN: 'Open',
  UNDER_REVIEW: 'Under Review',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CONVERTED_TO_WORK_ORDER: 'Converted',
  CANCELLED: 'Cancelled',
};

export const MAINTENANCE_REQUEST_STATUS_VARIANT: Record<
  MaintenanceRequestStatus,
  NonNullable<BadgeProps['variant']>
> = {
  OPEN: 'default',
  UNDER_REVIEW: 'warning',
  APPROVED: 'success',
  REJECTED: 'destructive',
  CONVERTED_TO_WORK_ORDER: 'success',
  CANCELLED: 'default',
};

export const WORK_ORDER_STATUS_LABELS: Record<WorkOrderStatus, string> = {
  OPEN: 'Open',
  ASSIGNED: 'Assigned',
  IN_PROGRESS: 'In Progress',
  ON_HOLD: 'On Hold',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

export const WORK_ORDER_STATUS_VARIANT: Record<
  WorkOrderStatus,
  NonNullable<BadgeProps['variant']>
> = {
  OPEN: 'default',
  ASSIGNED: 'warning',
  IN_PROGRESS: 'warning',
  ON_HOLD: 'destructive',
  COMPLETED: 'success',
  CANCELLED: 'default',
};

export const WORK_ORDER_TASK_STATUS_LABELS: Record<WorkOrderTaskStatus, string> = {
  PENDING: 'Pending',
  IN_PROGRESS: 'In Progress',
  COMPLETED: 'Completed',
  SKIPPED: 'Skipped',
};

export const MAINTENANCE_ISSUE_TYPE_LABELS: Record<MaintenanceIssueType, string> = {
  BREAKDOWN: 'Breakdown',
  PERFORMANCE: 'Performance Issue',
  SAFETY: 'Safety Concern',
  NOISE: 'Abnormal Noise',
  LEAK: 'Leak',
  ELECTRICAL: 'Electrical',
  MECHANICAL: 'Mechanical',
  OTHER: 'Other',
};

export const MAINTENANCE_COST_CATEGORY_LABELS: Record<MaintenanceCostCategory, string> = {
  LABOUR: 'Labour',
  PARTS: 'Parts',
  SERVICE: 'Service',
  TRANSPORT: 'Transport',
  OTHER: 'Other',
};

// === Sprint 22 ===

export const PART_USAGE_STATUS_LABELS: Record<MaintenancePartUsageStatus, string> = {
  REQUESTED: 'Requested',
  ISSUED: 'Issued',
  CANCELLED: 'Cancelled',
};

export const PART_USAGE_STATUS_VARIANT: Record<
  MaintenancePartUsageStatus,
  NonNullable<BadgeProps['variant']>
> = {
  REQUESTED: 'warning',
  ISSUED: 'success',
  CANCELLED: 'default',
};

export const PROCUREMENT_STATUS_LABELS: Record<MaintenanceProcurementStatus, string> = {
  IDENTIFIED: 'Identified',
  LINKED: 'Linked to PO',
  CANCELLED: 'Cancelled',
};

export const PROCUREMENT_STATUS_VARIANT: Record<
  MaintenanceProcurementStatus,
  NonNullable<BadgeProps['variant']>
> = {
  IDENTIFIED: 'warning',
  LINKED: 'success',
  CANCELLED: 'default',
};
