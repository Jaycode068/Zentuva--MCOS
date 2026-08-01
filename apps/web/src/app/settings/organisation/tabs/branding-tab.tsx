'use client';

import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Select } from '@zentuva/ui';
import { workspaceThemeSchema, z, type WorkspaceThemeInput } from '@zentuva/validation';
import { useForm } from 'react-hook-form';

import { ImageUploadCard } from '@/components/app/image-upload-card';
import { Field } from '@/components/app/settings-field';
import { ApiError } from '@/lib/api-client';
import { orgInitialsFor } from '@/lib/org-initials';
import {
  deleteLogo,
  updateWorkspaceSettings,
  uploadLogo,
  type WorkspaceSettings,
} from '@/lib/settings';

const DEFAULT_PRIMARY = '#EC4899';
const DEFAULT_ACCENT = '#F472B6';

const hexColorSchema = z
  .string()
  .trim()
  .regex(/^#([0-9A-Fa-f]{6}|[0-9A-Fa-f]{3})$/, 'Enter a valid hex colour');

const themeFormSchema = z.object({
  workspaceName: z.string().trim().max(200).or(z.literal('')),
  primaryColor: hexColorSchema,
  accentColor: hexColorSchema,
  theme: workspaceThemeSchema,
});

type ThemeFormValues = z.infer<typeof themeFormSchema>;

export function BrandingTab({ settings }: { settings: WorkspaceSettings }) {
  return (
    <div className="space-y-6">
      <LogoCard
        settings={settings}
        variant="light"
        title="Company Logo"
        description="Shown in the top navigation and anywhere your workspace is represented."
      />
      <LogoCard
        settings={settings}
        variant="dark"
        title="Dark Logo (optional)"
        description="Used instead of the Company Logo when your workspace is in dark mode. Falls back to the Company Logo if not set."
      />

      <PlaceholderUploadCard title="Favicon" description="Shown in the browser tab. Coming soon." />
      <PlaceholderUploadCard
        title="Email Header Logo"
        description="Shown at the top of transactional emails. Coming soon."
      />

      <ThemeAndColorCard settings={settings} />
    </div>
  );
}

function LogoCard({
  settings,
  variant,
  title,
  description,
}: {
  settings: WorkspaceSettings;
  variant: 'light' | 'dark';
  title: string;
  description: string;
}) {
  const queryClient = useQueryClient();
  const currentUrl = variant === 'dark' ? settings.darkLogoUrl : settings.logoUrl;

  const uploadMutation = useMutation({
    mutationFn: (file: File) => uploadLogo(file, variant),
    onSuccess: (updated) => queryClient.setQueryData(['settings', 'workspace'], updated),
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteLogo(variant),
    onSuccess: (updated) => queryClient.setQueryData(['settings', 'workspace'], updated),
  });

  return (
    <ImageUploadCard
      title={title}
      description={description}
      imageUrl={currentUrl}
      fallbackInitials={orgInitialsFor(settings.organisationName)}
      shape="square"
      onUpload={(file) => uploadMutation.mutate(file)}
      onRemove={() => deleteMutation.mutate()}
      isUploading={uploadMutation.isPending}
      isRemoving={deleteMutation.isPending}
      error={
        uploadMutation.error instanceof ApiError
          ? uploadMutation.error.message
          : deleteMutation.error instanceof ApiError
            ? deleteMutation.error.message
            : uploadMutation.isError || deleteMutation.isError
              ? 'Something went wrong. Please try again.'
              : undefined
      }
    />
  );
}

function PlaceholderUploadCard({ title, description }: { title: string; description: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-4">
          <div
            className="flex h-16 w-16 items-center justify-center rounded-lg border border-dashed border-border bg-muted text-xs text-muted-foreground"
            aria-hidden="true"
          >
            —
          </div>
          <div>
            <Button type="button" variant="outline" size="sm" disabled title="Coming soon">
              Upload
            </Button>
            <p className="mt-1.5 text-xs text-muted-foreground">{description}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ThemeAndColorCard({ settings }: { settings: WorkspaceSettings }) {
  const queryClient = useQueryClient();
  const [saveState, setSaveState] = useState<'idle' | 'saved'>('idle');

  const form = useForm<ThemeFormValues>({
    resolver: zodResolver(themeFormSchema),
    values: {
      workspaceName: settings.displayName ?? '',
      primaryColor: settings.primaryColor ?? DEFAULT_PRIMARY,
      accentColor: settings.accentColor ?? DEFAULT_ACCENT,
      theme: settings.theme,
    },
  });

  const mutation = useMutation({
    mutationFn: (values: ThemeFormValues) =>
      updateWorkspaceSettings({
        ...(values.workspaceName !== '' && { displayName: values.workspaceName }),
        primaryColor: values.primaryColor,
        accentColor: values.accentColor,
        theme: values.theme,
      }),
    onMutate: () => setSaveState('idle'),
    onSuccess: (updated) => {
      queryClient.setQueryData(['settings', 'workspace'], updated);
      setSaveState('saved');
    },
  });

  const primaryColor = form.watch('primaryColor');
  const accentColor = form.watch('accentColor');

  return (
    <form className="space-y-6" onSubmit={form.handleSubmit((values) => mutation.mutate(values))}>
      <Card>
        <CardHeader>
          <CardTitle>Workspace Identity</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label="Workspace Name" error={form.formState.errors.workspaceName?.message}>
            <Input {...form.register('workspaceName')} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Colours</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label="Primary Brand Colour" error={form.formState.errors.primaryColor?.message}>
            <div className="flex items-center gap-3">
              <input
                type="color"
                className="h-10 w-14 cursor-pointer rounded-md border border-input"
                {...form.register('primaryColor')}
              />
              <span className="font-mono text-sm text-muted-foreground">{primaryColor}</span>
            </div>
          </Field>
          <Field label="Accent Colour" error={form.formState.errors.accentColor?.message}>
            <div className="flex items-center gap-3">
              <input
                type="color"
                className="h-10 w-14 cursor-pointer rounded-md border border-input"
                {...form.register('accentColor')}
              />
              <span className="font-mono text-sm text-muted-foreground">{accentColor}</span>
            </div>
          </Field>
          <p className="text-xs text-muted-foreground">
            These drive every button, link, and highlight across Zentuva for your workspace.
            Zentuva&apos;s own deep purple brand mark stays as-is.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Brand Theme</CardTitle>
        </CardHeader>
        <CardContent>
          <Field label="Theme">
            <Select
              value={form.watch('theme')}
              onChange={(event) =>
                form.setValue('theme', event.target.value as WorkspaceThemeInput, {
                  shouldDirty: true,
                })
              }
            >
              <option value="light">Light</option>
              <option value="dark">Dark</option>
              <option value="system">System</option>
            </Select>
          </Field>
        </CardContent>
      </Card>

      {mutation.isError && (
        <p className="text-sm text-destructive">
          {mutation.error instanceof ApiError ? mutation.error.message : 'Failed to save changes.'}
        </p>
      )}
      {saveState === 'saved' && !mutation.isPending && (
        <p className="text-sm text-primary">Changes saved.</p>
      )}

      <div className="flex justify-end gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            form.reset({
              workspaceName: settings.displayName ?? '',
              primaryColor: settings.primaryColor ?? DEFAULT_PRIMARY,
              accentColor: settings.accentColor ?? DEFAULT_ACCENT,
              theme: settings.theme,
            })
          }
          disabled={mutation.isPending}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </form>
  );
}
