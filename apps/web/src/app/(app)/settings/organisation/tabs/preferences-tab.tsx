'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, Checkbox, Select } from '@zentuva/ui';
import type { WorkspacePreferencesInput } from '@zentuva/validation';

import { Field } from '@/components/app/settings-field';
import { ApiError } from '@/lib/api-client';
import { updateWorkspaceSettings, type WorkspaceSettings } from '@/lib/settings';

const TOGGLES: { key: keyof WorkspacePreferencesInput; label: string; hint?: string }[] = [
  {
    key: 'compactNavigation',
    label: 'Compact Navigation',
    hint: 'Tighter spacing in the top navigation.',
  },
  { key: 'animationsEnabled', label: 'Animations', hint: 'Subtle motion across the app.' },
  { key: 'emailNotifications', label: 'Email Notifications' },
  { key: 'systemNotifications', label: 'System Notifications' },
  { key: 'marketingEmails', label: 'Marketing Emails' },
  { key: 'aiFeatures', label: 'AI Features', hint: 'Not available yet — off by default.' },
  { key: 'experimentalFeatures', label: 'Experimental Features', hint: 'Off by default.' },
];

/**
 * Every toggle here maps 1:1 to `Organisation.settings.preferences` (Sprint 3.4 brief
 * §5: "store as structured settings"). Each toggle saves immediately on change — a
 * single-switch settings list reads better without a separate Save button per the
 * "avoid long scrolling pages" brief guidance, and the underlying `PATCH` is already a
 * cheap partial update.
 */
export function PreferencesTab({ settings }: { settings: WorkspaceSettings }) {
  const queryClient = useQueryClient();
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (preferences: Partial<WorkspacePreferencesInput>) =>
      updateWorkspaceSettings({ preferences }),
    onSuccess: (updated) => {
      queryClient.setQueryData(['settings', 'workspace'], updated);
    },
    onSettled: () => setPendingKey(null),
  });

  function toggle(key: keyof WorkspacePreferencesInput, value: boolean) {
    setPendingKey(key);
    mutation.mutate({ [key]: value });
  }

  function setDefaultLandingPage(value: 'organisation' | 'users') {
    setPendingKey('defaultLandingPage');
    mutation.mutate({ defaultLandingPage: value });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Navigation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label="Default Landing Page">
            <Select
              value={settings.preferences.defaultLandingPage}
              onChange={(event) =>
                setDefaultLandingPage(event.target.value as 'organisation' | 'users')
              }
              disabled={mutation.isPending}
            >
              <option value="organisation">Organisation Settings</option>
              <option value="users">Users</option>
            </Select>
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Behaviour</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {TOGGLES.map((item) => (
            <label key={item.key} className="flex items-start justify-between gap-4">
              <span>
                <span className="block text-sm font-medium text-foreground">{item.label}</span>
                {item.hint && (
                  <span className="block text-xs text-muted-foreground">{item.hint}</span>
                )}
              </span>
              <Checkbox
                checked={Boolean(settings.preferences[item.key])}
                disabled={mutation.isPending}
                onChange={(event) => toggle(item.key, event.target.checked)}
              />
            </label>
          ))}
        </CardContent>
      </Card>

      {mutation.isError && (
        <p className="text-sm text-destructive">
          {mutation.error instanceof ApiError ? mutation.error.message : 'Failed to save changes.'}
        </p>
      )}
      {pendingKey === null && mutation.isSuccess && (
        <p className="text-sm text-primary">Preferences saved.</p>
      )}
    </div>
  );
}
