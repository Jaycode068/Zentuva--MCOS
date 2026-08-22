'use client';

import { useRouter } from 'next/navigation';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Button, Input, Label, Select, Textarea } from '@zentuva/ui';
import { createCustomerSchema, type CreateCustomerInput } from '@zentuva/validation';
import { useForm } from 'react-hook-form';

import { FieldStickyActionBar } from '@/components/field/FieldStickyActionBar';
import { ApiError } from '@/lib/api-client';

import { createCustomer, listTerritories } from '../../api';
import { CUSTOMER_TYPE_LABELS } from '../../labels';

/**
 * Progressive Customer onboarding (Sprint 4.8 brief §7) — only Type/Name/Phone appear
 * above the fold; everything else, including Territory, sits behind a collapsed "Add
 * more details" disclosure. A field agent can complete this screen in well under a
 * minute. No distribution relationship, outlet, photo, or GPS is ever required here.
 */
export default function NewFieldCustomerPage() {
  const router = useRouter();

  const { data: territoriesData } = useQuery({
    queryKey: ['territories'],
    queryFn: () => listTerritories({ status: 'ACTIVE' }),
  });
  const territories = territoriesData?.items ?? [];

  const form = useForm<CreateCustomerInput>({
    resolver: zodResolver(createCustomerSchema),
    defaultValues: { customerType: 'RETAILER', customerName: '', phoneNumber: '' },
  });

  const mutation = useMutation({
    mutationFn: (values: CreateCustomerInput) => {
      const payload = {
        ...values,
        contactPersonName: values.contactPersonName || undefined,
        territoryId: values.territoryId || undefined,
        notes: values.notes || undefined,
      };
      return createCustomer(payload);
    },
    onSuccess: (customer) => router.replace(`/field/customers/${customer.id}`),
  });

  return (
    <form
      onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
      className="flex h-full flex-col"
    >
      <div className="flex-1 space-y-5 p-4">
        <h1 className="text-xl font-semibold tracking-tight">New Customer</h1>

        <div className="space-y-1.5">
          <Label className="text-base">Customer Type</Label>
          <Select className="h-12 text-base" {...form.register('customerType')}>
            {Object.entries(CUSTOMER_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-base">Business / Customer Name</Label>
          <Input
            className="h-12 text-base"
            placeholder="e.g. Bodija Supermart"
            {...form.register('customerName')}
          />
          {form.formState.errors.customerName && (
            <p className="text-sm text-destructive">{form.formState.errors.customerName.message}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label className="text-base">Primary Phone</Label>
          <Input className="h-12 text-base" type="tel" {...form.register('phoneNumber')} />
          {form.formState.errors.phoneNumber && (
            <p className="text-sm text-destructive">{form.formState.errors.phoneNumber.message}</p>
          )}
        </div>

        <details className="rounded-xl border border-dashed border-border p-3">
          <summary className="cursor-pointer text-base font-medium text-foreground">
            Add more details (optional)
          </summary>
          <div className="mt-3 space-y-4">
            <div className="space-y-1.5">
              <Label className="text-base">Territory</Label>
              <Select className="h-12 text-base" {...form.register('territoryId')}>
                <option value="">Not set — add later</option>
                {territories.map((territory) => (
                  <option key={territory.id} value={territory.id}>
                    {territory.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-base">Contact Person</Label>
              <Input className="h-12 text-base" {...form.register('contactPersonName')} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-base">Notes</Label>
              <Textarea rows={3} {...form.register('notes')} />
            </div>
          </div>
        </details>

        {mutation.isError && (
          <p className="text-sm text-destructive">
            {mutation.error instanceof ApiError
              ? mutation.error.message
              : 'Failed to save customer.'}
          </p>
        )}
      </div>

      <FieldStickyActionBar>
        <Button type="submit" size="touch" className="w-full" disabled={mutation.isPending}>
          {mutation.isPending ? 'Saving…' : 'Save Customer'}
        </Button>
      </FieldStickyActionBar>
    </form>
  );
}
