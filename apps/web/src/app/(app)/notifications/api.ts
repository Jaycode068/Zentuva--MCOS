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

export type NotificationCategory = 'WORKFLOW_APPROVALS' | 'WORKFLOW_STATUS_CHANGES';

export interface NotificationPreferenceEntry {
  category: NotificationCategory;
  inAppEnabled: boolean;
  /** Sprint 28 — defaults `false` (opposite of `inAppEnabled`'s default `true`). */
  emailEnabled: boolean;
}

export type NotificationProcessingStatus = 'PENDING' | 'PROCESSING' | 'PROCESSED' | 'FAILED';

export interface ProcessingRecord {
  id: string;
  eventType: string;
  workflowInstanceId: string;
  subjectType: string;
  subjectId: string;
  status: NotificationProcessingStatus;
  attempts: number;
  firstAttemptAt: string | null;
  lastAttemptAt: string | null;
  processedAt: string | null;
  nextRetryAt: string | null;
  lastErrorCategory: string | null;
  lastError: string | null;
  occurredAt: string;
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

// ---------------------------------------------------------------------------
// Preferences (Sprint 27.1 §Workstream D)
// ---------------------------------------------------------------------------

export function getPreferences() {
  return apiFetch<NotificationPreferenceEntry[]>('/notifications/preferences');
}

export function updatePreference(
  category: NotificationCategory,
  patch: { inAppEnabled?: boolean; emailEnabled?: boolean },
) {
  return apiFetch<NotificationPreferenceEntry>(`/notifications/preferences/${category}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export function resetPreferences() {
  return apiFetch<NotificationPreferenceEntry[]>('/notifications/preferences/reset', {
    method: 'POST',
  });
}

// ---------------------------------------------------------------------------
// Operational administration (Sprint 27.1 §Workstream F) — requires
// notification.processing.view/.manage; a non-administrator's call 403s, which
// the admin panel surfaces as a permission-denied state rather than hiding the
// tab client-side, matching this codebase's existing convention (no client-side
// permission hook exists anywhere).
// ---------------------------------------------------------------------------

export function listProcessingRecords(params?: {
  status?: NotificationProcessingStatus;
  page?: number;
  pageSize?: number;
}) {
  const qs = new URLSearchParams();
  if (params?.status) qs.set('status', params.status);
  if (params?.page) qs.set('page', String(params.page));
  if (params?.pageSize) qs.set('pageSize', String(params.pageSize));
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return apiFetch<{ items: ProcessingRecord[]; total: number; page: number; pageSize: number }>(
    `/notifications/admin/processing${suffix}`,
  );
}

export function retryProcessingRecord(eventId: string) {
  return apiFetch<ProcessingRecord>(`/notifications/admin/processing/${eventId}/retry`, {
    method: 'POST',
  });
}

// ---------------------------------------------------------------------------
// Email delivery (Sprint 28) — requires notification.email.view/.manage; a
// non-administrator's call 403s, surfaced as a permission-denied state rather
// than hiding the tab, matching the processing-records admin panel above.
// ---------------------------------------------------------------------------

export type EmailDeliveryStatus = 'PENDING' | 'PROCESSING' | 'SENT' | 'FAILED';

export interface EmailDeliveryRecord {
  id: string;
  organisationId: string;
  notificationId: string;
  recipientUserId: string;
  recipientEmail: string;
  recipientDisplayName: string | null;
  fromEmail: string;
  fromName: string;
  templateKey: string;
  category: NotificationCategory;
  subject: string;
  status: EmailDeliveryStatus;
  attempts: number;
  firstAttemptedAt: string | null;
  lastAttemptedAt: string | null;
  sentAt: string | null;
  nextRetryAt: string | null;
  providerName: string | null;
  providerMessageId: string | null;
  lastErrorCategory: string | null;
  lastError: string | null;
  createdAt: string;
}

export function listEmailDeliveries(params?: {
  status?: EmailDeliveryStatus;
  page?: number;
  pageSize?: number;
}) {
  const qs = new URLSearchParams();
  if (params?.status) qs.set('status', params.status);
  if (params?.page) qs.set('page', String(params.page));
  if (params?.pageSize) qs.set('pageSize', String(params.pageSize));
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return apiFetch<{ items: EmailDeliveryRecord[]; total: number; page: number; pageSize: number }>(
    `/notifications/admin/email-deliveries${suffix}`,
  );
}

export function retryEmailDelivery(id: string) {
  return apiFetch<EmailDeliveryRecord>(`/notifications/admin/email-deliveries/${id}/retry`, {
    method: 'POST',
  });
}

/** Sprint 28 §Workstream F — the on-demand trigger for the eligibility →
 *  delivery-record → send pipeline, mirroring `processNotificationEvents`'s own
 *  reasoning exactly (no queue/worker infrastructure exists). */
export function processEmailDeliveries() {
  return apiFetch<{
    created: { evaluated: number; created: number; ineligible: number };
    processed: { processed: number; sent: number; failed: number };
  }>('/notifications/process-email', { method: 'POST' });
}
