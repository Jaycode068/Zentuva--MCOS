'use client';

import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from '@zentuva/ui';
import { z } from '@zentuva/validation';
import { useForm } from 'react-hook-form';

import { AccountTabs } from '@/components/app/account-tabs';
import { AccountProfile, getAccountProfile, updateAccountProfile } from '@/lib/account';
import { ApiError } from '@/lib/api-client';

/** Same empty-string-vs-undefined reconciliation as `/settings/organisation` (Sprint
 *  2.1): form inputs represent "not filled in" as `''`, the API's `.optional()` only
 *  accepts `undefined`. */
const formSchema = z.object({
  firstName: z.string().trim().min(1, 'First name is required').max(100),
  lastName: z.string().trim().min(1, 'Last name is required').max(100),
  phoneNumber: z
    .string()
    .trim()
    .max(30)
    .or(z.literal(''))
    .refine((value) => value === '' || value.length >= 7, 'Phone number is too short'),
});

type FormValues = z.infer<typeof formSchema>;

function toFormValues(profile: AccountProfile): FormValues {
  return {
    firstName: profile.firstName,
    lastName: profile.lastName,
    phoneNumber: profile.phoneNumber ?? '',
  };
}

function toUpdatePayload(values: FormValues) {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== ''));
}

export default function AccountProfilePage() {
  const queryClient = useQueryClient();
  const [saveState, setSaveState] = useState<'idle' | 'saved'>('idle');

  const {
    data: profile,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['account', 'profile'],
    queryFn: getAccountProfile,
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    values: profile ? toFormValues(profile) : undefined,
  });

  const mutation = useMutation({
    mutationFn: (values: FormValues) => updateAccountProfile(toUpdatePayload(values)),
    onMutate: () => setSaveState('idle'),
    onSuccess: (updated) => {
      queryClient.setQueryData(['account', 'profile'], updated);
      setSaveState('saved');
    },
  });

  if (isLoading) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-10 text-sm text-muted-foreground">
        Loading your profile…
      </main>
    );
  }

  if (isError || !profile) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-10">
        <AccountTabs />
        <p className="text-sm text-destructive">
          {error instanceof ApiError ? error.message : 'Failed to load your profile.'}
        </p>
      </main>
    );
  }

  const initials = `${profile.firstName.charAt(0)}${profile.lastName.charAt(0)}`.toUpperCase();

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">My Profile</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage your personal details and how they appear across Zentuva.
        </p>
      </div>

      <AccountTabs />

      <form className="space-y-6" onSubmit={form.handleSubmit((values) => mutation.mutate(values))}>
        <Card>
          <CardHeader>
            <CardTitle>Profile Photo</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-brandPurple text-lg font-semibold text-brandPurple-foreground">
              {initials}
            </div>
            <div>
              <Button type="button" variant="outline" size="sm" disabled title="Coming soon">
                Upload Photo
              </Button>
              <p className="mt-1.5 text-xs text-muted-foreground">
                Photo uploads aren&apos;t available yet — this is a placeholder.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Personal Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="First Name" error={form.formState.errors.firstName?.message}>
              <Input {...form.register('firstName')} />
            </Field>
            <Field label="Last Name" error={form.formState.errors.lastName?.message}>
              <Input {...form.register('lastName')} />
            </Field>
            <Field label="Phone Number" error={form.formState.errors.phoneNumber?.message}>
              <Input placeholder="+234 801 234 5678" {...form.register('phoneNumber')} />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Account Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <ReadOnlyField label="Employee Code" value={profile.employeeCode ?? '—'} />
            <ReadOnlyField label="Email" value={profile.email} />
            <ReadOnlyField label="Role" value={profile.role ?? '—'} />
            <ReadOnlyField label="Organisation" value={profile.organisation?.name ?? '—'} />
            <ReadOnlyField
              label="Joined Date"
              value={new Date(profile.joinedAt).toLocaleDateString()}
            />
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

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-muted-foreground">{label}</Label>
      <p className="rounded-md border border-border bg-muted px-3 py-1.5 text-sm text-foreground">
        {value}
      </p>
    </div>
  );
}
