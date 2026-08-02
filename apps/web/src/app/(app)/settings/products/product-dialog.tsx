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
import {
  createProductSchema,
  PRODUCT_UNIT_SUGGESTIONS,
  type CreateProductInput,
} from '@zentuva/validation';
import { useForm } from 'react-hook-form';

import { ImageUploadCard } from '@/components/app/image-upload-card';
import { ApiError } from '@/lib/api-client';

import { createProduct, deleteProductImage, updateProduct, uploadProductImage } from './api';
import type { Product } from './api';

const CATEGORY_OPTIONS: { value: Product['category']; label: string }[] = [
  { value: 'SNACKS', label: 'Snacks' },
  { value: 'BEVERAGE', label: 'Beverage' },
  { value: 'WATER', label: 'Water' },
  { value: 'CONFECTIONERY', label: 'Confectionery' },
  { value: 'RAW_MATERIALS', label: 'Raw Materials' },
  { value: 'PACKAGING', label: 'Packaging' },
  { value: 'OTHERS', label: 'Others' },
];

const TYPE_OPTIONS: { value: Product['type']; label: string }[] = [
  { value: 'FINISHED_PRODUCT', label: 'Finished Product' },
  { value: 'RAW_MATERIAL', label: 'Raw Material' },
  { value: 'PACKAGING_MATERIAL', label: 'Packaging Material' },
  { value: 'CONSUMABLE', label: 'Consumable' },
];

/**
 * Reusable Create/Edit Product dialog (Sprint 4.1 brief: "Build a reusable dialog... Edit
 * Product: Reuse the same dialog"). `product === null` is create mode. Validation always
 * runs against `createProductSchema` (not a conditional create/update schema) since every
 * field is always populated via `defaultValues` in both modes — `updateProductSchema`'s
 * only difference is making those same fields optional, which the populated defaults
 * satisfy either way.
 *
 * The image upload control only renders in edit mode: `POST /api/products/:id/image`
 * needs an existing product id, which doesn't exist until the create `POST` round-trips —
 * see docs/domains/catalogue.md "Product Image" for the reasoning.
 */
export function ProductDialog({
  product,
  onOpenChange,
  onSaved,
}: {
  product: Product | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const isEdit = product !== null;

  const form = useForm<CreateProductInput>({
    resolver: zodResolver(createProductSchema),
    defaultValues: {
      name: product?.name ?? '',
      displayName: product?.displayName ?? '',
      category: product?.category ?? 'SNACKS',
      type: product?.type ?? 'FINISHED_PRODUCT',
      unit: product?.unit ?? 'Piece',
      shortDescription: product?.shortDescription ?? '',
      longDescription: product?.longDescription ?? '',
    },
  });

  const mutation = useMutation({
    mutationFn: (values: CreateProductInput) => {
      const payload = {
        ...values,
        displayName: values.displayName || undefined,
        shortDescription: values.shortDescription || undefined,
        longDescription: values.longDescription || undefined,
      };
      return isEdit ? updateProduct(product.id, payload) : createProduct(payload);
    },
    onSuccess: () => {
      onSaved();
      onOpenChange(false);
    },
  });

  const imageUploadMutation = useMutation({
    mutationFn: (file: File) => uploadProductImage(product!.id, file),
    onSuccess: onSaved,
  });
  const imageDeleteMutation = useMutation({
    mutationFn: () => deleteProductImage(product!.id),
    onSuccess: onSaved,
  });

  const currentUnit = form.watch('unit');
  const unitOptions = PRODUCT_UNIT_SUGGESTIONS.includes(
    currentUnit as (typeof PRODUCT_UNIT_SUGGESTIONS)[number],
  )
    ? PRODUCT_UNIT_SUGGESTIONS
    : [currentUnit, ...PRODUCT_UNIT_SUGGESTIONS];

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>{isEdit ? 'Edit Product' : 'Create Product'}</DialogTitle>
      </DialogHeader>
      <form
        className="max-h-[70vh] space-y-4 overflow-y-auto pr-1"
        onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
      >
        {isEdit ? (
          <ImageUploadCard
            title="Product Image"
            description="Shown in the product catalogue and anywhere this product is listed."
            imageUrl={product.imageUrl}
            fallbackInitials={product.name.slice(0, 2).toUpperCase()}
            shape="square"
            onUpload={(file) => imageUploadMutation.mutate(file)}
            onRemove={() => imageDeleteMutation.mutate()}
            isUploading={imageUploadMutation.isPending}
            isRemoving={imageDeleteMutation.isPending}
            error={
              imageUploadMutation.error instanceof ApiError
                ? imageUploadMutation.error.message
                : imageDeleteMutation.error instanceof ApiError
                  ? imageDeleteMutation.error.message
                  : undefined
            }
          />
        ) : (
          <p className="rounded-md border border-dashed border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
            You can add a product image after creating this product.
          </p>
        )}

        <div className="space-y-1.5">
          <Label>Product Name</Label>
          <Input {...form.register('name')} />
          {form.formState.errors.name && (
            <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label>Display Name (optional)</Label>
          <Input {...form.register('displayName')} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Category</Label>
            <Select {...form.register('category')}>
              {CATEGORY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Product Type</Label>
            <Select {...form.register('type')}>
              {TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Unit of Measure</Label>
          <Select {...form.register('unit')}>
            {unitOptions.map((unit) => (
              <option key={unit} value={unit}>
                {unit}
              </option>
            ))}
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label>Short Description (optional)</Label>
          <Textarea rows={2} {...form.register('shortDescription')} />
        </div>

        <div className="space-y-1.5">
          <Label>Long Description (optional)</Label>
          <Textarea rows={4} {...form.register('longDescription')} />
        </div>

        {mutation.isError && (
          <p className="text-sm text-destructive">
            {mutation.error instanceof ApiError
              ? mutation.error.message
              : 'Failed to save product.'}
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Product'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
