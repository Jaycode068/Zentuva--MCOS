'use client';

import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Card, CardContent, CardHeader, CardTitle, Input } from '@zentuva/ui';
import { z } from '@zentuva/validation';
import { useForm } from 'react-hook-form';

import { Field } from '@/components/app/settings-field';
import { ApiError } from '@/lib/api-client';
import { updateWorkspaceSettings, type WorkspaceSettings } from '@/lib/settings';

/** All fields optional per the brief ("Most fields optional"). "Business Description" is
 *  deliberately not repeated here — it's the same underlying field as General's
 *  "Description" (`Organisation.description`); editing it in two places would risk two
 *  unsaved, conflicting drafts of the same value, so it lives in General only. */
const formSchema = z.object({
  industry: z.string().trim().max(100).or(z.literal('')),
  manufacturingSector: z.string().trim().max(100).or(z.literal('')),
  registrationNumber: z.string().trim().max(100).or(z.literal('')),
  taxId: z.string().trim().max(100).or(z.literal('')),
  employeeCount: z.string().trim().max(50).or(z.literal('')),
});

type FormValues = z.infer<typeof formSchema>;

function toFormValues(settings: WorkspaceSettings): FormValues {
  return {
    industry: settings.industry ?? '',
    manufacturingSector: settings.manufacturingSector ?? '',
    registrationNumber: settings.registrationNumber ?? '',
    taxId: settings.taxId ?? '',
    employeeCount: settings.employeeCount ?? '',
  };
}

function toUpdatePayload(values: FormValues) {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== ''));
}

export function BusinessTab({ settings }: { settings: WorkspaceSettings }) {
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

  const errors = form.formState.errors;

  return (
    <form className="space-y-6" onSubmit={form.handleSubmit((values) => mutation.mutate(values))}>
      <Card>
        <CardHeader>
          <CardTitle>Business Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label="Industry" error={errors.industry?.message}>
            <Input {...form.register('industry')} />
          </Field>
          <Field label="Manufacturing Sector" error={errors.manufacturingSector?.message}>
            <Input {...form.register('manufacturingSector')} />
          </Field>
          <Field label="Number of Employees" error={errors.employeeCount?.message}>
            <Input placeholder="e.g. 25 or 11–50" {...form.register('employeeCount')} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Registration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label="Business Registration Number" error={errors.registrationNumber?.message}>
            <Input {...form.register('registrationNumber')} />
          </Field>
          <Field label="Tax Identification Number" error={errors.taxId?.message}>
            <Input {...form.register('taxId')} />
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
