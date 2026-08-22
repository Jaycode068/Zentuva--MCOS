'use client';

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
import { z } from '@zentuva/validation';
import { useForm } from 'react-hook-form';

import { ApiError } from '@/lib/api-client';

import {
  createProductVariant,
  listProductFamilies,
  updateProductVariant,
  type ProductVariant,
} from './api';

/** A local, non-conditional schema covering both create and edit — same "update schema
 *  is a strict optional superset" trick `ProductFamilyDialog` uses, plus the one field
 *  (`productFamilyId`) that's required on create and simply never re-submitted on edit
 *  (the `<Select>` is disabled there — see below). */
const productVariantFormSchema = z.object({
  productFamilyId: z.string().trim().min(1, 'Product family is required'),
  name: z.string().trim().min(1, 'Variant name is required').max(200),
  description: z.string().trim().max(2000).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
});
type ProductVariantFormValues = z.infer<typeof productVariantFormSchema>;

/**
 * Reusable Create/Edit Product Variant dialog (Sprint 4.7 brief, docs/domains/catalogue.md).
 * `variant === null` is create mode. The parent Family is required on create and fixed
 * (disabled) on edit — no re-parenting a variant to a different family this sprint.
 */
export function ProductVariantDialog({
  variant,
  onOpenChange,
  onSaved,
}: {
  variant: ProductVariant | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const isEdit = variant !== null;

  const { data: familiesData } = useQuery({
    queryKey: ['product-families'],
    queryFn: () => listProductFamilies(),
  });
  const activeFamilies = (familiesData?.items ?? []).filter((family) => family.status === 'ACTIVE');

  const form = useForm<ProductVariantFormValues>({
    resolver: zodResolver(productVariantFormSchema),
    defaultValues: {
      productFamilyId: variant?.productFamilyId ?? '',
      name: variant?.name ?? '',
      description: variant?.description ?? '',
      status: variant?.status ?? 'ACTIVE',
    },
  });

  const mutation = useMutation({
    mutationFn: (values: ProductVariantFormValues) => {
      if (isEdit) {
        return updateProductVariant(variant.id, {
          name: values.name,
          description: values.description || undefined,
          status: values.status,
        });
      }
      return createProductVariant({
        productFamilyId: values.productFamilyId,
        name: values.name,
        description: values.description || undefined,
      });
    },
    onSuccess: () => {
      onSaved();
      onOpenChange(false);
    },
  });

  if (!familiesData) {
    return (
      <Dialog open onOpenChange={onOpenChange}>
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit Product Variant' : 'Create Product Variant'}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">Loading…</p>
      </Dialog>
    );
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>{isEdit ? 'Edit Product Variant' : 'Create Product Variant'}</DialogTitle>
      </DialogHeader>
      <form className="space-y-4" onSubmit={form.handleSubmit((values) => mutation.mutate(values))}>
        {isEdit && (
          <p className="rounded-md border border-dashed border-border bg-muted/50 px-3 py-2 font-mono text-xs text-muted-foreground">
            {variant.code}
          </p>
        )}

        <div className="space-y-1.5">
          <Label>Product Family</Label>
          <Select disabled={isEdit} {...form.register('productFamilyId')}>
            <option value="">Select a family…</option>
            {activeFamilies.map((family) => (
              <option key={family.id} value={family.id}>
                {family.name}
              </option>
            ))}
          </Select>
          {activeFamilies.length === 0 && !isEdit && (
            <p className="text-xs text-muted-foreground">
              No active families — create a Product Family first.
            </p>
          )}
          {form.formState.errors.productFamilyId && (
            <p className="text-xs text-destructive">
              {form.formState.errors.productFamilyId.message}
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label>Variant Name</Label>
          <Input placeholder="e.g. Sweet & Spicy — Ripe Plantain" {...form.register('name')} />
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
              : 'Failed to save product variant.'}
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Variant'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
