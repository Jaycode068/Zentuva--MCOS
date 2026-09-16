import { apiFetch } from '@/lib/api-client';

/**
 * Shared API client for Sprint 27's Notifications & Activity Centre Foundation
 * (docs/domains/notifications.md), following the exact `settings/workflows/api.ts`
 * one-shared-file-per-domain convention.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NotificationType =
  | 'WORKFLOW_APPROVAL_REQUIRED'
  | 'WORKFLOW_STEP_APPROVED'
  | 'WORKFLOW_APPROVED'
  | 'WORKFLOW_STEP_REJECTED'
  | 'WORKFLOW_RETURNED'
  | 'WORKFLOW_RESUBMITTED'
  | 'WORKFLOW_CANCELLED'
  | 'WORKFLOW_EXPIRED';

export type NotificationStatus = 'UNREAD' | 'READ';

export interface Notification {
  id: string;
  organisationId: string;
  recipientUserId: string;
  type: NotificationType;
  channel: 'IN_APP';
  title: string;
  body: string;
  status: NotificationStatus;
  readAt: string | null;
  sourceEventId: string | null;
  sourceType: string;
  sourceId: string;
  actionUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ActivityRecord {
  id: string;
  organisationId: string;
  actorUserId: string | null;
  actorName: string | null;
  activityType: string;
  subjectType: string;
  subjectId: string;
  subjectReference: string;
  summary: string;
  occurredAt: string;
  sourceEventId: string;
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export function listNotifications(params?: {
  status?: NotificationStatus;
  type?: NotificationType;
  page?: number;
  pageSize?: number;
}) {
  const qs = new URLSearchParams();
  if (params?.status) qs.set('status', params.status);
  if (params?.type) qs.set('type', params.type);
  if (params?.page) qs.set('page', String(params.page));
  if (params?.pageSize) qs.set('pageSize', String(params.pageSize));
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return apiFetch<{ items: Notification[]; total: number; page: number; pageSize: number }>(
    `/notifications${suffix}`,
  );
}

export function getUnreadCount() {
  return apiFetch<{ count: number }>('/notifications/unread-count');
}

export function getNotification(id: string) {
  return apiFetch<Notification>(`/notifications/${id}`);
}

export function markNotificationRead(id: string) {
  return apiFetch<{ ok: true }>(`/notifications/${id}/read`, { method: 'POST' });
}

export function markNotificationUnread(id: string) {
  return apiFetch<{ ok: true }>(`/notifications/${id}/unread`, { method: 'POST' });
}

export function markAllNotificationsRead() {
  return apiFetch<{ count: number }>('/notifications/mark-all-read', { method: 'POST' });
}

/** Sprint 27 §Workstream 2 — no queue/cron infrastructure exists yet, so processing
 *  pending `WorkflowEvent`s into notifications is triggered on demand rather than by
 *  a background job. The notification bell calls this on a periodic poll (see
 *  `useNotificationPolling`) and workflow-mutating pages call it right after a
 *  mutation succeeds, so new notifications appear promptly without a real worker. */
export function processNotificationEvents() {
  return apiFetch<{ processed: number; failed: number; notificationsCreated: number }>(
    '/notifications/process-events',
    { method: 'POST' },
  );
}

// ---------------------------------------------------------------------------
// Activity Centre
// ---------------------------------------------------------------------------

export function listActivity(params?: {
  subjectType?: string;
  subjectId?: string;
  page?: number;
  pageSize?: number;
}) {
  const qs = new URLSearchParams();
  if (params?.subjectType) qs.set('subjectType', params.subjectType);
  if (params?.subjectId) qs.set('subjectId', params.subjectId);
  if (params?.page) qs.set('page', String(params.page));
  if (params?.pageSize) qs.set('pageSize', String(params.pageSize));
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return apiFetch<{ items: ActivityRecord[]; total: number; page: number; pageSize: number }>(
    `/notifications/activity${suffix}`,
  );
}
