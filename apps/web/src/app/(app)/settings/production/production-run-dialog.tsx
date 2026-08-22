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
} from '@zentuva/ui';
import { z } from '@zentuva/validation';
import { useForm } from 'react-hook-form';

import { ApiError } from '@/lib/api-client';

import { completeProduction, type ProductionOrder, type ProductionRejectionReason } from './api';
import { REJECTION_REASON_LABELS } from './labels';

const productionRunFormSchema = z
  .object({
    producedQuantity: z
      .number({ invalid_type_error: 'Produced quantity is required' })
      .nonnegative('Produced quantity cannot be negative'),
    rejectedQuantity: z
      .number({ invalid_type_error: 'Rejected quantity is required' })
      .nonnegative('Rejected quantity cannot be negative'),
    rejectionReason: z.string().optional(),
    rejectionNotes: z.string().optional(),
  })
  .refine((data) => data.rejectedQuantity <= data.producedQuantity, {
    message: 'Rejected quantity cannot exceed produced quantity',
    path: ['rejectedQuantity'],
  });

type ProductionRunFormValues = z.infer<typeof productionRunFormSchema>;

/**
 * "Complete Production" dialog (Sprint 4.6 brief §15/§16/§19) — records what was actually
 * produced and rejected; Accepted Quantity is always a read-only, live-computed preview
 * (`produced - rejected`), never a field the user enters, matching
 * `GoodsReceivingDialog`'s Accepted-is-always-computed convention. The server performs
 * this same subtraction again authoritatively and never trusts a client-supplied accepted
 * value (brief §19). Only reachable while the order is `IN_PROGRESS`, and completing it
 * moves the accepted quantity into Inventory via a `RECEIPT` transaction — this is the
 * only way a Production Order becomes `COMPLETED`.
 */
export function ProductionRunDialog({
  productionOrder,
  onOpenChange,
  onCompleted,
}: {
  productionOrder: ProductionOrder;
  onOpenChange: (open: boolean) => void;
  onCompleted: () => void;
}) {
  const form = useForm<ProductionRunFormValues>({
    resolver: zodResolver(productionRunFormSchema),
    defaultValues: {
      producedQuantity: 0,
      rejectedQuantity: 0,
      rejectionReason: '',
      rejectionNotes: '',
    },
  });

  const producedQuantity = form.watch('producedQuantity') || 0;
  const rejectedQuantity = form.watch('rejectedQuantity') || 0;
  const acceptedQuantity = Math.max(0, producedQuantity - rejectedQuantity);

  const mutation = useMutation({
    mutationFn: (values: ProductionRunFormValues) =>
      completeProduction(productionOrder.id, {
        producedQuantity: values.producedQuantity,
        rejectedQuantity: values.rejectedQuantity,
        rejectionReason:
          values.rejectedQuantity > 0 && values.rejectionReason
            ? (values.rejectionReason as ProductionRejectionReason)
            : undefined,
        rejectionNotes: values.rejectionNotes || undefined,
      }),
    onSuccess: onCompleted,
  });

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>Complete Production — {productionOrder.productionOrderNumber}</DialogTitle>
      </DialogHeader>
      <form className="space-y-4" onSubmit={form.handleSubmit((values) => mutation.mutate(values))}>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label>Produced Quantity</Label>
            <Input
              type="number"
              step="any"
              min="0"
              {...form.register('producedQuantity', { valueAsNumber: true })}
            />
            {form.formState.errors.producedQuantity && (
              <p className="text-xs text-destructive">
                {form.formState.errors.producedQuantity.message}
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Rejected Quantity</Label>
            <Input
              type="number"
              step="any"
              min="0"
              {...form.register('rejectedQuantity', { valueAsNumber: true })}
            />
            {form.formState.errors.rejectedQuantity && (
              <p className="text-xs text-destructive">
                {form.formState.errors.rejectedQuantity.message}
              </p>
            )}
          </div>
        </div>

        <p className="rounded-md border border-input bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
          Accepted quantity (computed):{' '}
          <span className="font-medium text-foreground">{acceptedQuantity}</span> — this is what
          will be added to Inventory as finished goods.
        </p>

        {rejectedQuantity > 0 && (
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Rejection Reason</Label>
              <Select {...form.register('rejectionReason')}>
                <option value="">Select a reason…</option>
                {Object.entries(REJECTION_REASON_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Rejection Notes (optional)</Label>
              <Input {...form.register('rejectionNotes')} />
            </div>
          </div>
        )}

        {form.formState.errors.rejectedQuantity?.message && rejectedQuantity > producedQuantity && (
          <p className="text-xs text-destructive">
            {form.formState.errors.rejectedQuantity.message}
          </p>
        )}

        {mutation.isError && (
          <p className="text-sm text-destructive">
            {mutation.error instanceof ApiError
              ? mutation.error.message
              : 'Failed to complete production.'}
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? 'Completing…' : 'Complete Production'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
