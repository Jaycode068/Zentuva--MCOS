'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button } from '@zentuva/ui';

import { ApiError } from '@/lib/api-client';
import { NotificationTabs } from '@/components/app/notification-tabs';

import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  markNotificationUnread,
  Notification,
  processNotificationEvents,
} from './api';

const TYPE_LABELS: Record<Notification['type'], string> = {
  WORKFLOW_APPROVAL_REQUIRED: 'Approval required',
  WORKFLOW_STEP_APPROVED: 'Step approved',
  WORKFLOW_APPROVED: 'Approved',
  WORKFLOW_STEP_REJECTED: 'Rejected',
  WORKFLOW_RETURNED: 'Returned',
  WORKFLOW_RESUBMITTED: 'Resubmitted',
  WORKFLOW_CANCELLED: 'Cancelled',
  WORKFLOW_EXPIRED: 'Expired',
};

const PAGE_SIZE = 20;

/**
 * Sprint 27 §Workstream 7 "Frontend Notification Centre" (docs/domains/
 * notifications.md §12). The full list — the bell's dropdown only ever shows the 5
 * most recent; this page is the complete, filterable, paginated view. Every action
 * here (`markNotificationRead`/`markNotificationUnread`/`markAllNotificationsRead`)
 * is already recipient-scoped server-side (`NotificationsController`, `JwtAuthGuard`
 * only, every query keyed off the caller's own token) — this page never sends or
 * relies on a user id for "whose notifications," only ever the current session's.
 */
export default function NotificationsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [page, setPage] = useState(1);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['notifications', 'list', unreadOnly, page],
    queryFn: () =>
      listNotifications({ status: unreadOnly ? 'UNREAD' : undefined, page, pageSize: PAGE_SIZE }),
  });

  function invalidateAll() {
    queryClient.invalidateQueries({ queryKey: ['notifications'] });
  }

  const markReadMutation = useMutation({
    mutationFn: (id: string) => markNotificationRead(id),
    onSuccess: invalidateAll,
  });
  const markUnreadMutation = useMutation({
    mutationFn: (id: string) => markNotificationUnread(id),
    onSuccess: invalidateAll,
  });
  const markAllReadMutation = useMutation({
    mutationFn: () => markAllNotificationsRead(),
    onSuccess: invalidateAll,
  });
  const refreshMutation = useMutation({
    mutationFn: () => processNotificationEvents(),
    onSuccess: invalidateAll,
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const hasNextPage = page * PAGE_SIZE < total;

  async function handleOpen(notification: Notification) {
    if (notification.status === 'UNREAD') {
      markReadMutation.mutate(notification.id);
    }
    if (notification.actionUrl) {
      router.push(notification.actionUrl);
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <div className="mb-8 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Notifications</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Everything that requires your attention across Zentuva.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refreshMutation.mutate()}
            disabled={refreshMutation.isPending}
          >
            {refreshMutation.isPending ? 'Checking…' : 'Check for new'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => markAllReadMutation.mutate()}
            disabled={markAllReadMutation.isPending}
          >
            Mark all read
          </Button>
        </div>
      </div>

      <NotificationTabs />

      <div className="mb-4 flex items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={unreadOnly}
            onChange={(event) => {
              setUnreadOnly(event.target.checked);
              setPage(1);
            }}
          />
          Unread only
        </label>
      </div>

      {isLoading && (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading notifications…</p>
      )}
      {isError && (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <p className="text-sm text-destructive">
            {error instanceof ApiError ? error.message : 'Failed to load notifications.'}
          </p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      )}

      {!isLoading && !isError && (
        <>
          <div className="space-y-2">
            {items.length === 0 && (
              <p className="py-10 text-center text-sm text-muted-foreground">
                {unreadOnly ? 'No unread notifications.' : 'You have no notifications yet.'}
              </p>
            )}
            {items.map((notification) => (
              <div
                key={notification.id}
                className={`flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border p-4 ${
                  notification.status === 'UNREAD' ? 'bg-primary/5' : ''
                }`}
              >
                <button
                  type="button"
                  onClick={() => handleOpen(notification)}
                  className="flex-1 text-left"
                >
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    {notification.status === 'UNREAD' && (
                      <span
                        className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
                        aria-hidden="true"
                      />
                    )}
                    <span className="font-medium">{notification.title}</span>
                    <Badge variant="default" className="hidden sm:inline-flex">
                      {TYPE_LABELS[notification.type]}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{notification.body}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {new Date(notification.createdAt).toLocaleString()}
                  </p>
                </button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    notification.status === 'UNREAD'
                      ? markReadMutation.mutate(notification.id)
                      : markUnreadMutation.mutate(notification.id)
                  }
                >
                  {notification.status === 'UNREAD' ? 'Mark read' : 'Mark unread'}
                </Button>
              </div>
            ))}
          </div>

          {items.length > 0 && (
            <div className="mt-6 flex items-center justify-between">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </Button>
              <span className="text-xs text-muted-foreground">
                Page {page} · {total} total
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={!hasNextPage}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          )}
        </>
      )}
    </main>
  );
}
