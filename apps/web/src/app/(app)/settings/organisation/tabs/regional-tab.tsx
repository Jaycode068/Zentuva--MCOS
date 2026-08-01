'use client';

import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Select } from '@zentuva/ui';
import { z } from '@zentuva/validation';
import { useForm } from 'react-hook-form';

import { Field } from '@/components/app/settings-field';
import { ApiError } from '@/lib/api-client';
import { updateWorkspaceSettings, type WorkspaceSettings } from '@/lib/settings';

const formSchema = z.object({
  country: z.string().trim().min(2, 'Country is required').max(100),
  state: z.string().trim().max(100).or(z.literal('')),
  city: z.string().trim().max(100).or(z.literal('')),
  timezone: z.string().trim().min(1).max(100),
  currency: z.string().trim().length(3, 'Use a 3-letter currency code, e.g. NGN'),
  dateFormat: z.string().trim().min(1),
  timeFormat: z.string().trim().min(1),
  numberFormat: z.string().trim().min(1),
  fiscalYearStart: z.coerce.number().int().min(1).max(12),
});

type FormValues = z.infer<typeof formSchema>;

const DATE_FORMATS = ['YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY'];
const TIME_FORMATS = [
  { value: 'HH:mm', label: '24-hour (14:30)' },
  { value: 'hh:mm a', label: '12-hour (2:30 PM)' },
];
const NUMBER_FORMATS = ['1,234.56', '1.234,56', '1 234.56'];
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function toFormValues(settings: WorkspaceSettings): FormValues {
  return {
    country: settings.country,
    state: settings.state ?? '',
    city: settings.city ?? '',
    timezone: settings.timezone,
    currency: settings.currency,
    dateFormat: settings.dateFormat,
    timeFormat: settings.timeFormat,
    numberFormat: settings.numberFormat,
    fiscalYearStart: settings.fiscalYearStart,
  };
}

export function RegionalTab({ settings }: { settings: WorkspaceSettings }) {
  const queryClient = useQueryClient();
  const [saveState, setSaveState] = useState<'idle' | 'saved'>('idle');

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    values: toFormValues(settings),
  });

  const mutation = useMutation({
    mutationFn: (values: FormValues) =>
      updateWorkspaceSettings({
        ...values,
        state: values.state === '' ? undefined : values.state,
        city: values.city === '' ? undefined : values.city,
      }),
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
          <CardTitle>Location</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label="Country" error={errors.country?.message}>
            <Input {...form.register('country')} />
          </Field>
          <Field label="State" error={errors.state?.message}>
            <Input {...form.register('state')} />
          </Field>
          <Field label="City" error={errors.city?.message}>
            <Input {...form.register('city')} />
          </Field>
          <Field label="Timezone" error={errors.timezone?.message}>
            <Input placeholder="Africa/Lagos" {...form.register('timezone')} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Formats</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label="Currency" error={errors.currency?.message}>
            <Input placeholder="NGN" {...form.register('currency')} />
          </Field>
          <Field label="Date Format" error={errors.dateFormat?.message}>
            <Select {...form.register('dateFormat')}>
              {DATE_FORMATS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Time Format" error={errors.timeFormat?.message}>
            <Select {...form.register('timeFormat')}>
              {TIME_FORMATS.map((format) => (
                <option key={format.value} value={format.value}>
                  {format.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Number Format" error={errors.numberFormat?.message}>
            <Select {...form.register('numberFormat')}>
              {NUMBER_FORMATS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Language">
            <Select value="English" disabled>
              <option value="English">English</option>
            </Select>
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Fiscal Year</CardTitle>
        </CardHeader>
        <CardContent>
          <Field label="Fiscal Year Start" error={errors.fiscalYearStart?.message}>
            <Select {...form.register('fiscalYearStart')}>
              {MONTHS.map((month, index) => (
                <option key={month} value={index + 1}>
                  {month}
                </option>
              ))}
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
