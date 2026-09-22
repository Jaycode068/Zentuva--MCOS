'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  Input,
  Select,
} from '@zentuva/ui';
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
  const [senderName, setSenderName] = useState(settings.emailDelivery.senderName ?? '');
  const [senderEmail, setSenderEmail] = useState(settings.emailDelivery.senderEmail ?? '');

  const mutation = useMutation({
    mutationFn: (preferences: Partial<WorkspacePreferencesInput>) =>
      updateWorkspaceSettings({ preferences }),
    onSuccess: (updated) => {
      queryClient.setQueryData(['settings', 'workspace'], updated);
    },
    onSettled: () => setPendingKey(null),
  });

  /** Sprint 28 §Workstream H.1 — a SEPARATE mutation (own PATCH `emailDelivery`
   *  key, never merged into `preferences` above) since it writes a different
   *  `WorkspaceSettings` sub-object entirely. */
  const emailDeliveryMutation = useMutation({
    mutationFn: (emailDelivery: {
      enabled?: boolean;
      senderName?: string | null;
      senderEmail?: string | null;
    }) => updateWorkspaceSettings({ emailDelivery }),
    onSuccess: (updated) => {
      queryClient.setQueryData(['settings', 'workspace'], updated);
      setSenderName(updated.emailDelivery.senderName ?? '');
      setSenderEmail(updated.emailDelivery.senderEmail ?? '');
    },
    onSettled: () => setPendingKey(null),
  });

  /** Sprint 29 — another SEPARATE mutation (own PATCH `whatsapp` key), mirroring
   *  `emailDeliveryMutation` above. Enabled-only: no sender-identity fields, since
   *  the WhatsApp Business phone number is environment/platform configuration. */
  const whatsappMutation = useMutation({
    mutationFn: (whatsapp: { enabled: boolean }) => updateWorkspaceSettings({ whatsapp }),
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

  function toggleEmailDeliveryEnabled(value: boolean) {
    setPendingKey('emailDeliveryEnabled');
    emailDeliveryMutation.mutate({ enabled: value });
  }

  function toggleWhatsAppEnabled(value: boolean) {
    setPendingKey('whatsappEnabled');
    whatsappMutation.mutate({ enabled: value });
  }

  function saveSenderIdentity() {
    setPendingKey('emailDeliverySender');
    emailDeliveryMutation.mutate({
      senderName: senderName.trim() || null,
      senderEmail: senderEmail.trim() || null,
    });
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

      <Card>
        <CardHeader>
          <CardTitle>Transactional Email</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Controls whether Zentuva sends transactional email (approval requests, status changes)
            to your team on top of in-app notifications. Each user also chooses which categories
            they receive email for in their own notification preferences.
          </p>
          <label className="flex items-start justify-between gap-4">
            <span>
              <span className="block text-sm font-medium text-foreground">
                Enable transactional email
              </span>
              <span className="block text-xs text-muted-foreground">
                Off by default — no email is sent for this organisation until enabled.
              </span>
            </span>
            <Checkbox
              checked={settings.emailDelivery.enabled}
              disabled={emailDeliveryMutation.isPending}
              onChange={(event) => toggleEmailDeliveryEnabled(event.target.checked)}
            />
          </label>

          <Field label="Sender Name">
            <Input
              value={senderName}
              onChange={(event) => setSenderName(event.target.value)}
              placeholder="Zentuva (default)"
              disabled={emailDeliveryMutation.isPending}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Shown as the email&apos;s display name, e.g. &quot;Boby Bites&quot;.
            </p>
          </Field>
          <Field label="Sender Email">
            <Input
              type="email"
              value={senderEmail}
              onChange={(event) => setSenderEmail(event.target.value)}
              placeholder="noreply@yourcompany.com"
              disabled={emailDeliveryMutation.isPending}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Falls back to the platform default if left blank.
            </p>
          </Field>
          <Button size="sm" onClick={saveSenderIdentity} disabled={emailDeliveryMutation.isPending}>
            Save sender identity
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>WhatsApp</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Controls whether Zentuva sends transactional WhatsApp messages (approval requests) to
            your team on top of in-app and email notifications. Each user also chooses whether they
            receive WhatsApp messages in their own notification preferences.
          </p>
          <label className="flex items-start justify-between gap-4">
            <span>
              <span className="block text-sm font-medium text-foreground">Enable WhatsApp</span>
              <span className="block text-xs text-muted-foreground">
                Off by default — no WhatsApp message is sent for this organisation until enabled.
              </span>
            </span>
            <Checkbox
              checked={settings.whatsapp.enabled}
              disabled={whatsappMutation.isPending}
              onChange={(event) => toggleWhatsAppEnabled(event.target.checked)}
            />
          </label>
        </CardContent>
      </Card>

      {(mutation.isError || emailDeliveryMutation.isError || whatsappMutation.isError) && (
        <p className="text-sm text-destructive">
          {mutation.error instanceof ApiError
            ? mutation.error.message
            : emailDeliveryMutation.error instanceof ApiError
              ? emailDeliveryMutation.error.message
              : whatsappMutation.error instanceof ApiError
                ? whatsappMutation.error.message
                : 'Failed to save changes.'}
        </p>
      )}
      {pendingKey === null &&
        (mutation.isSuccess || emailDeliveryMutation.isSuccess || whatsappMutation.isSuccess) && (
          <p className="text-sm text-primary">Preferences saved.</p>
        )}
    </div>
  );
}
