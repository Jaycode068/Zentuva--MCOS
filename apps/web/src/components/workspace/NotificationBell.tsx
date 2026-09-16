'use client';

import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@zentuva/ui';

import {
  getUnreadCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  processNotificationEvents,
} from '@/app/(app)/notifications/api';

import { BellIcon } from './icons';

/** Sprint 27 §Workstream 7 "Frontend Notification Centre" — the global bell, mounted
 *  once in `Topbar` so it appears on every authenticated page (desktop and mobile;
 *  `Topbar` already renders responsively at every width). Polling both drives the
 *  unread badge AND is this sprint's chosen trigger for
 *  `NotificationEventProcessorService` (docs/domains/notifications.md §4 "Processing
 *  trigger") — no queue/cron infrastructure exists yet, so "check for new events"
 *  happens here rather than in a background worker. Workflow-mutating pages
 *  additionally call `processNotificationEvents()` directly after a successful
 *  action so a notification appears promptly rather than waiting for the next poll
 *  tick; this poll is the fallback that also covers notifications produced by
 *  OTHER users' actions in the same organisation. */
const POLL_INTERVAL_MS = 20_000;

export function NotificationBell() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: unread } = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: async () => {
      await processNotificationEvents().catch(() => undefined);
      const result = await getUnreadCount();
      return result.count;
    },
    refetchInterval: POLL_INTERVAL_MS,
  });

  const { data: recent } = useQuery({
    queryKey: ['notifications', 'recent'],
    queryFn: () => listNotifications({ pageSize: 5 }),
    refetchInterval: POLL_INTERVAL_MS,
  });

  function invalidateAll() {
    queryClient.invalidateQueries({ queryKey: ['notifications'] });
  }

  async function handleItemClick(id: string, actionUrl: string | null) {
    await markNotificationRead(id).catch(() => undefined);
    invalidateAll();
    if (actionUrl) {
      router.push(actionUrl);
    }
  }

  async function handleMarkAllRead() {
    await markAllNotificationsRead().catch(() => undefined);
    invalidateAll();
  }

  const count = unread ?? 0;
  const items = recent?.items ?? [];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="relative flex h-9 w-9 items-center justify-center rounded-md text-foreground/70 hover:bg-accent hover:text-accent-foreground"
        aria-label={count > 0 ? `Notifications (${count} unread)` : 'Notifications'}
      >
        <BellIcon className="h-5 w-5" />
        {count > 0 && (
          <span
            className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-none text-destructive-foreground"
            aria-hidden="true"
          >
            {count > 9 ? '9+' : count}
          </span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-80">
        <div className="flex items-center justify-between px-2 py-1.5">
          <DropdownMenuLabel className="p-0">Notifications</DropdownMenuLabel>
          {count > 0 && (
            <button
              type="button"
              onClick={handleMarkAllRead}
              className="text-xs font-medium text-primary hover:underline"
            >
              Mark all read
            </button>
          )}
        </div>
        <DropdownMenuSeparator />
        {items.length === 0 ? (
          <div className="px-2 py-6 text-center text-sm text-muted-foreground">
            You&apos;re all caught up.
          </div>
        ) : (
          items.map((notification) => (
            <DropdownMenuItem
              key={notification.id}
              onSelect={() => handleItemClick(notification.id, notification.actionUrl)}
              className="flex-col items-start gap-0.5 whitespace-normal"
            >
              <span className="flex w-full items-center gap-1.5">
                {notification.status === 'UNREAD' && (
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
                    aria-hidden="true"
                  />
                )}
                <span className="font-medium text-foreground">{notification.title}</span>
              </span>
              <span className="text-xs text-muted-foreground">{notification.body}</span>
            </DropdownMenuItem>
          ))
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => router.push('/notifications')}>
          View all notifications
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
