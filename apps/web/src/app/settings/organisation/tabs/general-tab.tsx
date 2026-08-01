'use client';

import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Textarea } from '@zentuva/ui';
import { z } from '@zentuva/validation';
import { useForm } from 'react-hook-form';

import { Field, ReadOnlyField } from '@/components/app/settings-field';
import { ApiError } from '@/lib/api-client';
import { updateWorkspaceSettings, type WorkspaceSettings } from '@/lib/settings';

/** Same empty-string-vs-undefined reconciliation established in Sprint 2.1/3.3: form
 *  inputs represent "not filled in" as `''`, the API's `.optional()` only accepts
 *  `undefined`. `email` stays required — `Organisation.businessEmail` is a non-nullable
 *  column. */
const formSchema = z.object({
  displayName: z.string().trim().max(200).or(z.literal('')),
  description: z.string().trim().max(2000).or(z.literal('')),
  email: z.string().trim().email('Enter a valid email address'),
  phoneNumber: z
    .string()
    .trim()
    .max(30)
    .or(z.literal(''))
    .refine((value) => value === '' || value.length >= 7, 'Phone number is too short'),
  website: z.string().trim().url('Enter a valid URL, e.g. https://example.com').or(z.literal('')),
});

type FormValues = z.infer<typeof formSchema>;

function toFormValues(settings: WorkspaceSettings): FormValues {
  return {
    displayName: settings.displayName ?? '',
    description: settings.description ?? '',
    email: settings.email,
    phoneNumber: settings.phoneNumber ?? '',
    website: settings.website ?? '',
  };
}

function toUpdatePayload(values: FormValues) {
  return Object.fromEntries(
    Object.entries(values).filter(([key, value]) => value !== '' || key === 'email'),
  );
}

export function GeneralTab({ settings }: { settings: WorkspaceSettings }) {
  const queryClient = useQueryClient();
  const [saveState, setSaveState] = useState<'idle' | 'saved'>('idle');

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    values: toFormValues(settings),
  });

  const mutation = useMutation({
    mutationFn: (values: FormValues) => updateWorkspaceSettings(toUpdatePayload(values)),
    onMutate: () => setSaveState('idle'),
    onSuccess: (updated) => {
      queryClient.setQueryData(['settings', 'workspace'], updated);
      setSaveState('saved');
    },
  });

  return (
    <form className="space-y-6" onSubmit={form.handleSubmit((values) => mutation.mutate(values))}>
      <Card>
        <CardHeader>
          <CardTitle>Organisation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ReadOnlyField label="Organisation Name" value={settings.organisationName} />
          <Field label="Display Name" error={form.formState.errors.displayName?.message}>
            <Input {...form.register('displayName')} />
          </Field>
          <Field label="Description" error={form.formState.errors.description?.message}>
            <Textarea rows={3} {...form.register('description')} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Contact Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label="Email" error={form.formState.errors.email?.message}>
            <Input type="email" {...form.register('email')} />
          </Field>
          <Field label="Phone Number" error={form.formState.errors.phoneNumber?.message}>
            <Input {...form.register('phoneNumber')} />
          </Field>
          <Field label="Website" error={form.formState.errors.website?.message}>
            <Input placeholder="https://example.com" {...form.register('website')} />
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
          onClick={() => form.reset(toFormValues(settings))}
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
