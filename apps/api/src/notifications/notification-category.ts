import { NotificationCategory, NotificationType } from '@prisma/client';

/**
 * Sprint 27.1 §Workstream D "Preference Categories" (notifications.md §6). A
 * coarse, static mapping — every `NotificationType` falls into exactly one
 * `NotificationCategory`. `WORKFLOW_APPROVAL_REQUIRED` is the only type that
 * represents "something needs YOUR action"; every other type is a status change
 * about a request the recipient already knows exists (their own, or one they
 * previously acted on).
 */
export const NOTIFICATION_TYPE_CATEGORY: Record<NotificationType, NotificationCategory> = {
  WORKFLOW_APPROVAL_REQUIRED: 'WORKFLOW_APPROVALS',
  WORKFLOW_STEP_APPROVED: 'WORKFLOW_STATUS_CHANGES',
  WORKFLOW_APPROVED: 'WORKFLOW_STATUS_CHANGES',
  WORKFLOW_STEP_REJECTED: 'WORKFLOW_STATUS_CHANGES',
  WORKFLOW_RETURNED: 'WORKFLOW_STATUS_CHANGES',
  WORKFLOW_RESUBMITTED: 'WORKFLOW_STATUS_CHANGES',
  WORKFLOW_CANCELLED: 'WORKFLOW_STATUS_CHANGES',
  WORKFLOW_EXPIRED: 'WORKFLOW_STATUS_CHANGES',
};

export function categoryForType(type: NotificationType): NotificationCategory {
  return NOTIFICATION_TYPE_CATEGORY[type];
}

export const ALL_NOTIFICATION_CATEGORIES: NotificationCategory[] = [
  'WORKFLOW_APPROVALS',
  'WORKFLOW_STATUS_CHANGES',
];
