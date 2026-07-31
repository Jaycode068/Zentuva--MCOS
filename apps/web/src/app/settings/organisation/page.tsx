'use client';

import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Textarea,
} from '@zentuva/ui';
import { z } from '@zentuva/validation';
import { useForm } from 'react-hook-form';

import { ApiError } from '@/lib/api-client';

import { getOrganisationProfile, OrganisationProfile, updateOrganisationProfile } from './api';

/**
 * Mirrors `@zentuva/validation`'s `updateOrganisationProfileSchema` constraints, but each
 * optional field also accepts `''` — form inputs represent "not filled in" as an empty
 * string, while the API schema represents "no change" by omitting the key entirely. The
 * two are reconciled in `onSubmit` below (empty strings are dropped before the request is
 * sent), not by loosening the API contract itself.
 */
const formSchema = z.object({
  organisationName: z.string().trim().min(1, 'Organisation name is required').max(200),
  displayName: z.string().trim().max(200).or(z.literal('')),
  description: z.string().trim().max(2000).or(z.literal('')),
  email: z.string().trim().email('Enter a valid email address').or(z.literal('')),
  phoneNumber: z
    .string()
    .trim()
    .max(30)
    .or(z.literal(''))
    .refine((value) => value === '' || value.length >= 7, 'Phone number is too short'),
  website: z.string().trim().url('Enter a valid URL, e.g. https://example.com').or(z.literal('')),
  country: z.string().trim().min(2, 'Country is required').max(100),
  state: z.string().trim().max(100).or(z.literal('')),
  city: z.string().trim().max(100).or(z.literal('')),
  addressLine: z.string().trim().max(200).or(z.literal('')),
  industry: z.string().trim().max(100).or(z.literal('')),
  currency: z.string().trim().length(3, 'Use a 3-letter currency code, e.g. NGN').or(z.literal('')),
  timezone: z.string().trim().max(100).or(z.literal('')),
});

type FormValues = z.infer<typeof formSchema>;

function toFormValues(profile: OrganisationProfile): FormValues {
  return {
    organisationName: profile.organisationName,
    displayName: profile.displayName ?? '',
    description: profile.description ?? '',
    email: profile.email,
    phoneNumber: profile.phoneNumber ?? '',
    website: profile.website ?? '',
    country: profile.country,
    state: profile.state ?? '',
    city: profile.city ?? '',
    addressLine: profile.addressLine ?? '',
    industry: profile.industry ?? '',
    currency: profile.currency,
    timezone: profile.timezone,
  };
}

/** Drops empty-string fields (form's "not filled in") so the PATCH request only carries
 *  fields the user actually set — matches the API's partial-update semantics. */
function toUpdatePayload(values: FormValues) {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== ''));
}

export default function OrganisationSettingsPage() {
  const queryClient = useQueryClient();
  const [saveState, setSaveState] = useState<'idle' | 'saved'>('idle');

  const {
    data: profile,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['organisation', 'me'],
    queryFn: getOrganisationProfile,
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    values: profile ? toFormValues(profile) : undefined,
  });

  const mutation = useMutation({
    mutationFn: (values: FormValues) => updateOrganisationProfile(toUpdatePayload(values)),
    onMutate: () => setSaveState('idle'),
    onSuccess: (updated) => {
      queryClient.setQueryData(['organisation', 'me'], updated);
      setSaveState('saved');
    },
  });

  if (isLoading) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-10 text-sm text-muted-foreground">
        Loading organisation profile…
      </main>
    );
  }

  if (isError || !profile) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-10">
        <p className="text-sm text-destructive">
          {error instanceof ApiError ? error.message : 'Failed to load organisation profile.'}
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Organisation Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {profile.organisationCode} · Created {new Date(profile.createdAt).toLocaleDateString()}
        </p>
      </div>

      <form className="space-y-6" onSubmit={form.handleSubmit((values) => mutation.mutate(values))}>
        <Card>
          <CardHeader>
            <CardTitle>General Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field
              label="Organisation Name"
              error={form.formState.errors.organisationName?.message}
            >
              <Input {...form.register('organisationName')} />
            </Field>
            <Field label="Display Name" error={form.formState.errors.displayName?.message}>
              <Input {...form.register('displayName')} />
            </Field>
            <Field label="Business Description" error={form.formState.errors.description?.message}>
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

        <Card>
          <CardHeader>
            <CardTitle>Address</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="Country" error={form.formState.errors.country?.message}>
              <Input {...form.register('country')} />
            </Field>
            <Field label="State" error={form.formState.errors.state?.message}>
              <Input {...form.register('state')} />
            </Field>
            <Field label="City" error={form.formState.errors.city?.message}>
              <Input {...form.register('city')} />
            </Field>
            <Field label="Address Line" error={form.formState.errors.addressLine?.message}>
              <Input {...form.register('addressLine')} />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Business Settings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="Industry" error={form.formState.errors.industry?.message}>
              <Input {...form.register('industry')} />
            </Field>
            <Field label="Currency" error={form.formState.errors.currency?.message}>
              <Input placeholder="NGN" {...form.register('currency')} />
            </Field>
            <Field label="Timezone" error={form.formState.errors.timezone?.message}>
              <Input placeholder="Africa/Lagos" {...form.register('timezone')} />
            </Field>
          </CardContent>
        </Card>

        {mutation.isError && (
          <p className="text-sm text-destructive">
            {mutation.error instanceof ApiError
              ? mutation.error.message
              : 'Failed to save changes.'}
          </p>
        )}
        {saveState === 'saved' && !mutation.isPending && (
          <p className="text-sm text-primary">Changes saved.</p>
        )}

        <div className="flex justify-end gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => form.reset(toFormValues(profile))}
            disabled={mutation.isPending}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? 'Saving…' : 'Save Changes'}
          </Button>
        </div>
      </form>
    </main>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
