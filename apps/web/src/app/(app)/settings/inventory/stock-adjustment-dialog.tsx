'use client';

import { useMemo } from 'react';
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

import { listProducts } from '../products/api';
import {
  createInventoryAdjustment,
  listInventoryLocations,
  listInventoryStock,
  type AdjustmentReason,
} from './api';
import { ADJUSTMENT_REASON_LABELS } from './labels';

const adjustmentFormSchema = z.object({
  productId: z.string().min(1, 'Product is required'),
  locationId: z.string().min(1, 'Location is required'),
  adjustmentType: z.enum(['INCREASE', 'DECREASE']),
  quantity: z
    .number({ invalid_type_error: 'Quantity is required' })
    .positive('Quantity must be greater than zero'),
  reason: z.string().min(1, 'Reason is required'),
  notes: z.string().optional(),
});

type AdjustmentFormValues = z.infer<typeof adjustmentFormSchema>;

/**
 * "Adjust Stock" dialog (Sprint 4.5 brief §4/§8) — the sole manual correction to
 * `InventoryStock`. `Adjustment Type` (Increase/Decrease) + a non-negative `Quantity`
 * combine into the signed delta the API actually accepts; the current balance is never
 * directly editable — only this signed delta is, and `New Balance` is always a
 * read-only, live-computed preview (`current + delta`), never a field the user types
 * into. Submission is blocked client-side when that preview would go negative, mirroring
 * (not replacing) the server's own guard.
 */
export function StockAdjustmentDialog({
  onOpenChange,
  onAdjusted,
}: {
  onOpenChange: (open: boolean) => void;
  onAdjusted: () => void;
}) {
  const { data: productsData } = useQuery({
    queryKey: ['products', ''],
    queryFn: () => listProducts(),
  });
  const { data: locationsData } = useQuery({
    queryKey: ['inventory-locations'],
    queryFn: () => listInventoryLocations(),
  });
  const { data: stockData } = useQuery({
    queryKey: ['inventory-stock'],
    queryFn: () => listInventoryStock(),
  });

  const products = productsData?.items ?? [];
  const activeLocations = (locationsData?.items ?? []).filter(
    (location) => location.status === 'ACTIVE',
  );
  const defaultLocation =
    activeLocations.find((location) => location.isDefault) ?? activeLocations[0];

  const form = useForm<AdjustmentFormValues>({
    resolver: zodResolver(adjustmentFormSchema),
    defaultValues: {
      productId: '',
      locationId: defaultLocation?.id ?? '',
      adjustmentType: 'INCREASE',
      quantity: 0,
      reason: '',
      notes: '',
    },
  });

  const productId = form.watch('productId');
  const locationId = form.watch('locationId');
  const adjustmentType = form.watch('adjustmentType');
  const quantity = form.watch('quantity');

  const currentQuantity = useMemo(() => {
    const row = (stockData?.items ?? []).find(
      (item) => item.productId === productId && item.location.id === locationId,
    );
    return row?.quantityOnHand ?? 0;
  }, [stockData, productId, locationId]);

  const selectedProduct = products.find((product) => product.id === productId);
  const signedDelta =
    (adjustmentType === 'DECREASE' ? -1 : 1) * (Number.isFinite(quantity) ? quantity : 0);
  const newBalance = currentQuantity + signedDelta;
  const wouldGoNegative = newBalance < 0;

  const mutation = useMutation({
    mutationFn: (values: AdjustmentFormValues) => {
      const delta = (values.adjustmentType === 'DECREASE' ? -1 : 1) * values.quantity;
      return createInventoryAdjustment({
        productId: values.productId,
        locationId: values.locationId,
        quantity: delta,
        reason: values.reason as AdjustmentReason,
        notes: values.notes || undefined,
      });
    },
    onSuccess: onAdjusted,
  });

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>Adjust Stock</DialogTitle>
      </DialogHeader>
      <form className="space-y-4" onSubmit={form.handleSubmit((values) => mutation.mutate(values))}>
        <div className="space-y-1.5">
          <Label>Product</Label>
          <Select {...form.register('productId')}>
            <option value="">Select a product…</option>
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name} ({product.code})
              </option>
            ))}
          </Select>
          {form.formState.errors.productId && (
            <p className="text-xs text-destructive">{form.formState.errors.productId.message}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label>Location</Label>
          <Select {...form.register('locationId')}>
            <option value="">Select a location…</option>
            {activeLocations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
                {location.isDefault ? ' (Default)' : ''}
              </option>
            ))}
          </Select>
          {form.formState.errors.locationId && (
            <p className="text-xs text-destructive">{form.formState.errors.locationId.message}</p>
          )}
        </div>

        {productId && locationId && (
          <p className="rounded-md border border-input bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
            Current quantity on hand:{' '}
            <span className="font-medium text-foreground">
              {currentQuantity} {selectedProduct?.unit}
            </span>
          </p>
        )}

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label>Adjustment Type</Label>
            <Select {...form.register('adjustmentType')}>
              <option value="INCREASE">Increase</option>
              <option value="DECREASE">Decrease</option>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Quantity</Label>
            <Input
              type="number"
              step="any"
              min="0"
              {...form.register('quantity', { valueAsNumber: true })}
            />
            {form.formState.errors.quantity && (
              <p className="text-xs text-destructive">{form.formState.errors.quantity.message}</p>
            )}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Reason</Label>
          <Select {...form.register('reason')}>
            <option value="">Select a reason…</option>
            {Object.entries(ADJUSTMENT_REASON_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
          {form.formState.errors.reason && (
            <p className="text-xs text-destructive">{form.formState.errors.reason.message}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label>Notes (optional)</Label>
          <Textarea rows={2} {...form.register('notes')} />
        </div>

        {productId && locationId && (
          <p
            className={
              wouldGoNegative
                ? 'rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive'
                : 'rounded-md border border-input bg-muted/50 px-3 py-2 text-sm text-muted-foreground'
            }
          >
            New balance:{' '}
            <span className="font-medium text-foreground">
              {newBalance} {selectedProduct?.unit}
            </span>
            {wouldGoNegative && ' — this adjustment would result in negative stock.'}
          </p>
        )}

        {mutation.isError && (
          <p className="text-sm text-destructive">
            {mutation.error instanceof ApiError
              ? mutation.error.message
              : 'Failed to adjust stock.'}
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={wouldGoNegative || mutation.isPending}>
            {mutation.isPending ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
