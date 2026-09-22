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
 * Sprint 27.1 §Workstream D "Preference API/UI", extended Sprint 28
 * §Workstream H.2 "User Preferences" (docs/domains/notifications.md §6, §12).
 * Self-service only — every read/write is scoped to the caller's own token
 * server-side (`NotificationsController`'s preference routes, `JwtAuthGuard`
 * alone). In-app and email are two CLEARLY DISTINCT columns, never a single
 * merged toggle — their defaults are intentionally opposite (in-app defaults
 * enabled, email defaults disabled, Sprint 28 §5.2 "email is disabled unless
 * explicitly enabled") and toggling one never silently changes the other.
 * Disabling either only affects FUTURE notification/email creation — it never
 * deletes an existing notification/delivery, and never touches workflow
 * history/audit/Activity Centre.
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
      patch,
    }: {
      category: NotificationCategory;
      patch: { inAppEnabled?: boolean; emailEnabled?: boolean; whatsappEnabled?: boolean };
    }) => updatePreference(category, patch),
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
            Choose which notification categories you want to receive, and through which channel.
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
            <div key={pref.category} className="rounded-lg border border-border p-4">
              <p className="font-medium">{CATEGORY_LABELS[pref.category].title}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {CATEGORY_LABELS[pref.category].description}
              </p>
              <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={pref.inAppEnabled}
                    onChange={(event) =>
                      updateMutation.mutate({
                        category: pref.category,
                        patch: { inAppEnabled: event.target.checked },
                      })
                    }
                    aria-label={`${CATEGORY_LABELS[pref.category].title} — in-app notifications`}
                  />
                  In-app
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={pref.emailEnabled}
                    onChange={(event) =>
                      updateMutation.mutate({
                        category: pref.category,
                        patch: { emailEnabled: event.target.checked },
                      })
                    }
                    aria-label={`${CATEGORY_LABELS[pref.category].title} — email notifications`}
                  />
                  Email
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={pref.whatsappEnabled}
                    onChange={(event) =>
                      updateMutation.mutate({
                        category: pref.category,
                        patch: { whatsappEnabled: event.target.checked },
                      })
                    }
                    aria-label={`${CATEGORY_LABELS[pref.category].title} — WhatsApp notifications`}
                  />
                  WhatsApp
                </label>
              </div>
            </div>
          ))}
          <p className="text-xs text-muted-foreground">
            Email and WhatsApp also require your organisation to have the corresponding channel
            enabled — ask an administrator if you&apos;ve turned this on but aren&apos;t receiving
            messages.
          </p>
        </div>
      )}
    </main>
  );
}
