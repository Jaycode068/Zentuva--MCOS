'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
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
import { createSupplierSchema, type CreateSupplierInput } from '@zentuva/validation';
import { useForm } from 'react-hook-form';

import { ApiError } from '@/lib/api-client';

import { createSupplier, updateSupplier } from './api';
import type { Supplier } from './api';
import { CATEGORY_LABELS } from './labels';

const CATEGORY_OPTIONS: { value: Supplier['supplierCategory']; label: string }[] = (
  Object.keys(CATEGORY_LABELS) as Supplier['supplierCategory'][]
).map((value) => ({ value, label: CATEGORY_LABELS[value] }));

/**
 * Reusable Create/Edit Supplier dialog (Sprint 4.2 brief: "Create Supplier, Edit Supplier"
 * — same one-component-per-mode pattern as `ProductDialog`/`EditUserDialog`).
 * `supplier === null` is create mode. Validation always runs against
 * `createSupplierSchema` (not a conditional create/update schema) since every field is
 * always populated via `defaultValues` in both modes.
 *
 * Unlike `ProductDialog`, `Status` is a plain form field here rather than a dedicated
 * activate/archive action — the brief lists it directly among the Create/Edit fields, and
 * the backend accepts it on both `POST` and `PATCH` (see `SupplierController`'s
 * `resolveUpdateAuditAction` for how a status change still gets its own audit event).
 */
export function SupplierDialog({
  supplier,
  onOpenChange,
  onSaved,
}: {
  supplier: Supplier | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const isEdit = supplier !== null;

  const form = useForm<CreateSupplierInput>({
    resolver: zodResolver(createSupplierSchema),
    defaultValues: {
      supplierName: supplier?.supplierName ?? '',
      displayName: supplier?.displayName ?? '',
      contactPerson: supplier?.contactPerson ?? '',
      email: supplier?.email ?? '',
      phoneNumber: supplier?.phoneNumber ?? '',
      website: supplier?.website ?? '',
      country: supplier?.country ?? '',
      state: supplier?.state ?? '',
      city: supplier?.city ?? '',
      address: supplier?.address ?? '',
      taxIdentificationNumber: supplier?.taxIdentificationNumber ?? '',
      supplierCategory: supplier?.supplierCategory ?? 'RAW_MATERIAL',
      notes: supplier?.notes ?? '',
      status: supplier?.status ?? 'ACTIVE',
    },
  });

  const mutation = useMutation({
    mutationFn: (values: CreateSupplierInput) => {
      const payload = {
        ...values,
        displayName: values.displayName || undefined,
        contactPerson: values.contactPerson || undefined,
        phoneNumber: values.phoneNumber || undefined,
        country: values.country || undefined,
        state: values.state || undefined,
        city: values.city || undefined,
        address: values.address || undefined,
        taxIdentificationNumber: values.taxIdentificationNumber || undefined,
        notes: values.notes || undefined,
      };
      return isEdit ? updateSupplier(supplier.id, payload) : createSupplier(payload);
    },
    onSuccess: () => {
      onSaved();
      onOpenChange(false);
    },
  });

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>{isEdit ? 'Edit Supplier' : 'Create Supplier'}</DialogTitle>
      </DialogHeader>
      <form
        className="max-h-[70vh] space-y-4 overflow-y-auto pr-1"
        onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
      >
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Supplier Name</Label>
            <Input {...form.register('supplierName')} />
            {form.formState.errors.supplierName && (
              <p className="text-xs text-destructive">
                {form.formState.errors.supplierName.message}
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Display Name (optional)</Label>
            <Input {...form.register('displayName')} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Category</Label>
            <Select {...form.register('supplierCategory')}>
              {CATEGORY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Status</Label>
            <Select {...form.register('status')}>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Contact Person (optional)</Label>
            <Input {...form.register('contactPerson')} />
          </div>
          <div className="space-y-1.5">
            <Label>Phone (optional)</Label>
            <Input {...form.register('phoneNumber')} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Email (optional)</Label>
            <Input type="email" {...form.register('email')} />
            {form.formState.errors.email && (
              <p className="text-xs text-destructive">{form.formState.errors.email.message}</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Website (optional)</Label>
            <Input placeholder="https://" {...form.register('website')} />
            {form.formState.errors.website && (
              <p className="text-xs text-destructive">{form.formState.errors.website.message}</p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Country (optional)</Label>
            <Input {...form.register('country')} />
          </div>
          <div className="space-y-1.5">
            <Label>State (optional)</Label>
            <Input {...form.register('state')} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>City (optional)</Label>
            <Input {...form.register('city')} />
          </div>
          <div className="space-y-1.5">
            <Label>Tax ID (optional)</Label>
            <Input {...form.register('taxIdentificationNumber')} />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Address (optional)</Label>
          <Textarea rows={2} {...form.register('address')} />
        </div>

        <div className="space-y-1.5">
          <Label>Notes (optional)</Label>
          <Textarea rows={3} {...form.register('notes')} />
        </div>

        {mutation.isError && (
          <p className="text-sm text-destructive">
            {mutation.error instanceof ApiError
              ? mutation.error.message
              : 'Failed to save supplier.'}
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Supplier'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
