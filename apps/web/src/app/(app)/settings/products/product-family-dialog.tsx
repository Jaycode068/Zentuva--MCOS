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
import { updateProductFamilySchema, type UpdateProductFamilyInput } from '@zentuva/validation';
import { useForm } from 'react-hook-form';

import { ApiError } from '@/lib/api-client';

import { createProductFamily, updateProductFamily, type ProductFamily } from './api';

/**
 * Reusable Create/Edit Product Family dialog (Sprint 4.7 brief, docs/domains/catalogue.md).
 * `family === null` is create mode. Validation always runs against
 * `updateProductFamilySchema` (not a conditional create/update schema) — its fields are a
 * strict optional superset of `createProductFamilySchema`'s, so a fully-populated
 * `defaultValues` satisfies it in either mode, same trick `ProductDialog` uses in reverse
 * (there, the *create* schema is the superset since Product's status transitions are
 * dedicated endpoints, not part of the update body).
 */
export function ProductFamilyDialog({
  family,
  onOpenChange,
  onSaved,
}: {
  family: ProductFamily | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const isEdit = family !== null;

  const form = useForm<UpdateProductFamilyInput>({
    resolver: zodResolver(updateProductFamilySchema),
    defaultValues: {
      name: family?.name ?? '',
      description: family?.description ?? '',
      status: family?.status ?? 'ACTIVE',
    },
  });

  const mutation = useMutation({
    mutationFn: (values: UpdateProductFamilyInput) => {
      const description = values.description || undefined;
      if (isEdit) {
        return updateProductFamily(family.id, { ...values, description });
      }
      // `name` is typed optional here only because this form reuses
      // `updateProductFamilySchema` for both modes (see the component doc comment) —
      // zod's `.min(1)` already guarantees it's a non-empty string by the time
      // `handleSubmit` ever calls this function.
      return createProductFamily({ name: values.name!, description });
    },
    onSuccess: () => {
      onSaved();
      onOpenChange(false);
    },
  });

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>{isEdit ? 'Edit Product Family' : 'Create Product Family'}</DialogTitle>
      </DialogHeader>
      <form className="space-y-4" onSubmit={form.handleSubmit((values) => mutation.mutate(values))}>
        {isEdit && (
          <p className="rounded-md border border-dashed border-border bg-muted/50 px-3 py-2 font-mono text-xs text-muted-foreground">
            {family.code}
          </p>
        )}

        <div className="space-y-1.5">
          <Label>Family Name</Label>
          <Input placeholder="e.g. Plantain Chips" {...form.register('name')} />
          {form.formState.errors.name && (
            <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label>Description (optional)</Label>
          <Textarea rows={3} {...form.register('description')} />
        </div>

        {isEdit && (
          <div className="space-y-1.5">
            <Label>Status</Label>
            <Select {...form.register('status')}>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </Select>
          </div>
        )}

        {mutation.isError && (
          <p className="text-sm text-destructive">
            {mutation.error instanceof ApiError
              ? mutation.error.message
              : 'Failed to save product family.'}
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Family'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
