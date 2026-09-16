'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@zentuva/ui';

import { ApiError } from '@/lib/api-client';
import { NotificationTabs } from '@/components/app/notification-tabs';

import { getPreferences, NotificationCategory, resetPreferences, updatePreference } from '../api';

const CATEGORY_LABELS: Record<NotificationCategory, { title: string; description: string }> = {
  WORKFLOW_APPROVALS: {
    title: 'Workflow approvals',
    description: 'Something is awaiting your approval right now.',
  },
  WORKFLOW_STATUS_CHANGES: {
    title: 'Workflow status changes',
    description:
      'A request you submitted or acted on changed status — approved, rejected, returned, resubmitted, cancelled, or expired.',
  },
};

/**
 * Sprint 27.1 §Workstream D "Preference API/UI" (docs/domains/notifications.md §6).
 * Self-service only — every read/write is scoped to the caller's own token
 * server-side (`NotificationsController`'s preference routes, `JwtAuthGuard` alone).
 * A missing preference always means enabled; toggling a category off only affects
 * FUTURE notification creation (§6 "suppression semantics") — it never deletes an
 * existing notification, and never touches workflow history/audit/Activity Centre.
 */
export default function NotificationPreferencesPage() {
  const queryClient = useQueryClient();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['notifications', 'preferences'],
    queryFn: () => getPreferences(),
  });

  const updateMutation = useMutation({
    mutationFn: ({
      category,
      inAppEnabled,
    }: {
      category: NotificationCategory;
      inAppEnabled: boolean;
    }) => updatePreference(category, inAppEnabled),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications', 'preferences'] }),
  });

  const resetMutation = useMutation({
    mutationFn: () => resetPreferences(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications', 'preferences'] }),
  });

  const preferences = data ?? [];

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <div className="mb-8 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Notifications</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Choose which in-app notification categories you want to receive.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => resetMutation.mutate()}
          disabled={resetMutation.isPending}
        >
          Reset to defaults
        </Button>
      </div>

      <NotificationTabs />

      {isLoading && (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading preferences…</p>
      )}
      {isError && (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <p className="text-sm text-destructive">
            {error instanceof ApiError ? error.message : 'Failed to load preferences.'}
          </p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      )}

      {!isLoading && !isError && (
        <div className="space-y-3">
          {preferences.map((pref) => (
            <label
              key={pref.category}
              className="flex items-start justify-between gap-4 rounded-lg border border-border p-4"
            >
              <div>
                <p className="font-medium">{CATEGORY_LABELS[pref.category].title}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {CATEGORY_LABELS[pref.category].description}
                </p>
              </div>
              <input
                type="checkbox"
                className="mt-1 h-5 w-5 shrink-0"
                checked={pref.inAppEnabled}
                onChange={(event) =>
                  updateMutation.mutate({
                    category: pref.category,
                    inAppEnabled: event.target.checked,
                  })
                }
                aria-label={`${CATEGORY_LABELS[pref.category].title} in-app notifications`}
              />
            </label>
          ))}
        </div>
      )}
    </main>
  );
}
