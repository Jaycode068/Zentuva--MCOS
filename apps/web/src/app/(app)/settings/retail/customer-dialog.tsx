'use client';

import { useEffect } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Button,
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  Textarea,
} from '@zentuva/ui';
import { createCustomerSchema, type CreateCustomerInput } from '@zentuva/validation';
import { useForm } from 'react-hook-form';

import { ApiError } from '@/lib/api-client';

import { createCustomer, listTerritories, updateCustomer, type Customer } from './api';
import { CUSTOMER_TYPE_LABELS } from './labels';

/**
 * Reusable Create/Edit Customer dialog (Sprint 4.8, docs/domains/customers.md).
 * `customer === null` is create mode. Validation runs against `createCustomerSchema` in
 * both modes — only `customerType`/`customerName`/`phoneNumber` are required, matching
 * the "onboard a customer in under two minutes" progressive-onboarding rule; every other
 * field, including Territory, is optional and addable later.
 */
export function CustomerDialog({
  customer,
  onOpenChange,
  onSaved,
}: {
  customer: Customer | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const isEdit = customer !== null;

  const { data: territoriesData } = useQuery({
    queryKey: ['territories'],
    queryFn: () => listTerritories({ status: 'ACTIVE' }),
  });
  const territories = territoriesData?.items ?? [];

  const form = useForm<CreateCustomerInput>({
    resolver: zodResolver(createCustomerSchema),
    defaultValues: {
      customerType: customer?.customerType ?? 'RETAILER',
      customerName: customer?.customerName ?? '',
      phoneNumber: customer?.phoneNumber ?? '',
      contactPersonName: customer?.contactPersonName ?? '',
      alternatePhoneNumber: customer?.alternatePhoneNumber ?? '',
      email: customer?.email ?? '',
      address: customer?.address ?? '',
      city: customer?.city ?? '',
      state: customer?.state ?? '',
      country: customer?.country ?? '',
      territoryId: customer?.territoryId ?? undefined,
      notes: customer?.notes ?? '',
    },
  });

  // The Territory `<select>` is uncontrolled (RHF `register`), so its initial selected
  // option is only set once the territories query resolves — if it lands after mount,
  // setting `defaultValues.territoryId` to a real id has nothing to match yet and is a
  // silent no-op. Re-apply once the list loads, same race avoided by
  // `ProductionOrderDialog`'s own `form.reset()` on its BOM query.
  useEffect(() => {
    if (isEdit && customer.territoryId && territoriesData) {
      form.setValue('territoryId', customer.territoryId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [territoriesData]);

  const mutation = useMutation({
    mutationFn: (values: CreateCustomerInput) => {
      const payload = {
        ...values,
        contactPersonName: values.contactPersonName || undefined,
        alternatePhoneNumber: values.alternatePhoneNumber || undefined,
        email: values.email || undefined,
        address: values.address || undefined,
        city: values.city || undefined,
        state: values.state || undefined,
        country: values.country || undefined,
        territoryId: values.territoryId || undefined,
        notes: values.notes || undefined,
      };
      return isEdit ? updateCustomer(customer.id, payload) : createCustomer(payload);
    },
    onSuccess: () => {
      onSaved();
      onOpenChange(false);
    },
  });

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>{isEdit ? 'Edit Customer' : 'Add Customer'}</DialogTitle>
      </DialogHeader>
      <form
        className="max-h-[70vh] space-y-4 overflow-y-auto pr-1"
        onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
      >
        {isEdit && (
          <p className="rounded-md border border-dashed border-border bg-muted/50 px-3 py-2 font-mono text-xs text-muted-foreground">
            {customer.customerCode}
          </p>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Customer Type</Label>
            <Select {...form.register('customerType')}>
              {Object.entries(CUSTOMER_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Primary Phone</Label>
            <Input {...form.register('phoneNumber')} />
            {form.formState.errors.phoneNumber && (
              <p className="text-xs text-destructive">
                {form.formState.errors.phoneNumber.message}
              </p>
            )}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Business / Customer Name</Label>
          <Input
            placeholder="e.g. Bodija Supermart or Alhaji Musa Provision Store"
            {...form.register('customerName')}
          />
          {form.formState.errors.customerName && (
            <p className="text-xs text-destructive">{form.formState.errors.customerName.message}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label>Territory (optional)</Label>
          <Select {...form.register('territoryId')}>
            <option value="">Not set</option>
            {territories.map((territory) => (
              <option key={territory.id} value={territory.id}>
                {territory.name}
              </option>
            ))}
          </Select>
        </div>

        <details className="rounded-md border border-dashed border-border p-3">
          <summary className="cursor-pointer text-sm font-medium text-foreground">
            Add more details (optional)
          </summary>
          <div className="mt-3 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Contact Person</Label>
                <Input {...form.register('contactPersonName')} />
              </div>
              <div className="space-y-1.5">
                <Label>Alternate Phone</Label>
                <Input {...form.register('alternatePhoneNumber')} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input type="email" {...form.register('email')} />
              {form.formState.errors.email && (
                <p className="text-xs text-destructive">{form.formState.errors.email.message}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Address</Label>
              <Input {...form.register('address')} />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label>City</Label>
                <Input {...form.register('city')} />
              </div>
              <div className="space-y-1.5">
                <Label>State</Label>
                <Input {...form.register('state')} />
              </div>
              <div className="space-y-1.5">
                <Label>Country</Label>
                <Input {...form.register('country')} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
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

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Customer'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
