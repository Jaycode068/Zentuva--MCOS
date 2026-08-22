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
  Textarea,
} from '@zentuva/ui';
import { z } from '@zentuva/validation';
import { useForm } from 'react-hook-form';

import { ApiError } from '@/lib/api-client';

import {
  getProductionOrderAvailability,
  issueMaterial,
  listMaterialIssues,
  type ProductionOrder,
} from './api';

function toDateInputValue(value: string): string {
  return value.slice(0, 10);
}

/**
 * "Issue Material" dialog (Sprint 4.6 brief §12/§13/§14) — one row per component still
 * outstanding (`required - already issued > 0`), each showing Required/Already Issued/
 * Remaining/Available before the user enters this batch's Issue Quantity. Blocks
 * submitting more than Remaining or more than Available client-side — a UX convenience
 * only, the server re-validates both authoritatively and atomically (brief §13: "never
 * partially issue materials — the whole issue succeeds or the whole issue fails").
 */
export function MaterialIssueDialog({
  productionOrder,
  onOpenChange,
  onIssued,
}: {
  productionOrder: ProductionOrder;
  onOpenChange: (open: boolean) => void;
  onIssued: () => void;
}) {
  const { data: issuesData } = useQuery({
    queryKey: ['material-issues', productionOrder.id],
    queryFn: () => listMaterialIssues(productionOrder.id),
  });
  const { data: availabilityData } = useQuery({
    queryKey: ['production-order-availability', productionOrder.id],
    queryFn: () => getProductionOrderAvailability(productionOrder.id),
  });

  const issuedTotals = useMemo(() => {
    const totals = new Map<string, number>();
    for (const issue of issuesData?.items ?? []) {
      for (const item of issue.items) {
        totals.set(
          item.componentProduct.id,
          (totals.get(item.componentProduct.id) ?? 0) + item.quantityIssued,
        );
      }
    }
    return totals;
  }, [issuesData]);

  const availabilityByProduct = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of availabilityData?.items ?? []) {
      map.set(row.componentProductId, row.availableQuantity);
    }
    return map;
  }, [availabilityData]);

  const rows = useMemo(
    () =>
      productionOrder.items
        .map((item) => {
          const alreadyIssued = issuedTotals.get(item.componentProduct.id) ?? 0;
          const remaining = Math.max(0, item.requiredQuantity - alreadyIssued);
          const available = availabilityByProduct.get(item.componentProduct.id) ?? 0;
          return {
            componentProductId: item.componentProduct.id,
            name: item.componentProduct.name,
            unit: item.unitOfMeasure,
            required: item.requiredQuantity,
            alreadyIssued,
            remaining,
            available,
          };
        })
        .filter((row) => row.remaining > 0),
    [productionOrder.items, issuedTotals, availabilityByProduct],
  );

  const formSchema = useMemo(
    () =>
      z.object({
        issuedDate: z.string().min(1, 'Issued date is required'),
        notes: z.string().optional(),
        quantities: z.record(z.string(), z.number().nonnegative('Cannot be negative')),
      }),
    [],
  );
  type FormValues = z.infer<typeof formSchema>;

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      issuedDate: toDateInputValue(new Date().toISOString()),
      notes: '',
      quantities: Object.fromEntries(rows.map((row) => [row.componentProductId, 0])),
    },
  });

  const watchedQuantities = form.watch('quantities');
  const hasAnyIssue = Object.values(watchedQuantities ?? {}).some((value) => (value ?? 0) > 0);
  const hasOverIssue = rows.some(
    (row) => (watchedQuantities?.[row.componentProductId] ?? 0) > row.remaining,
  );
  const hasOverAvailable = rows.some(
    (row) => (watchedQuantities?.[row.componentProductId] ?? 0) > row.available,
  );

  const mutation = useMutation({
    mutationFn: (values: FormValues) => {
      const items = rows
        .map((row) => ({
          componentProductId: row.componentProductId,
          quantity: values.quantities[row.componentProductId] ?? 0,
        }))
        .filter((item) => item.quantity > 0);
      return issueMaterial(productionOrder.id, {
        issuedDate: values.issuedDate,
        notes: values.notes || undefined,
        items,
      });
    },
    onSuccess: onIssued,
  });

  if (!issuesData || !availabilityData) {
    return (
      <Dialog open onOpenChange={onOpenChange}>
        <DialogHeader>
          <DialogTitle>Issue Material</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">Loading…</p>
      </Dialog>
    );
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>Issue Material — {productionOrder.productionOrderNumber}</DialogTitle>
      </DialogHeader>
      <form
        className="max-h-[75vh] space-y-4 overflow-y-auto pr-1"
        onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
      >
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Every component required by this production order has already been fully issued.
          </p>
        ) : (
          <>
            <div className="space-y-1.5">
              <Label>Issued Date</Label>
              <Input type="date" {...form.register('issuedDate')} />
              {form.formState.errors.issuedDate && (
                <p className="text-xs text-destructive">
                  {form.formState.errors.issuedDate.message}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>Notes (optional)</Label>
              <Textarea rows={2} {...form.register('notes')} />
            </div>

            <div className="space-y-3">
              <Label>Components</Label>
              {rows.map((row) => {
                const issueQuantity = watchedQuantities?.[row.componentProductId] ?? 0;
                const overIssue = issueQuantity > row.remaining;
                const overAvailable = issueQuantity > row.available;
                return (
                  <div
                    key={row.componentProductId}
                    className="space-y-2 rounded-md border border-border p-3"
                  >
                    <div className="font-medium text-foreground">
                      {row.name} <span className="text-xs text-muted-foreground">({row.unit})</span>
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-md bg-muted/30 p-2 text-xs text-muted-foreground sm:grid-cols-4">
                      <div>
                        Required
                        <div className="font-medium text-foreground">{row.required}</div>
                      </div>
                      <div>
                        Already Issued
                        <div className="font-medium text-foreground">{row.alreadyIssued}</div>
                      </div>
                      <div>
                        Remaining
                        <div className="font-medium text-foreground">{row.remaining}</div>
                      </div>
                      <div>
                        Available
                        <div className="font-medium text-foreground">{row.available}</div>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Issue Quantity</Label>
                      <Input
                        type="number"
                        step="any"
                        min="0"
                        {...form.register(`quantities.${row.componentProductId}`, {
                          valueAsNumber: true,
                        })}
                      />
                      {overIssue && (
                        <p className="text-xs text-destructive">
                          Cannot issue more than the {row.remaining} {row.unit} still remaining.
                        </p>
                      )}
                      {!overIssue && overAvailable && (
                        <p className="text-xs text-destructive">
                          Only {row.available} {row.unit} is available in stock.
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {!hasAnyIssue && (
              <p className="text-xs text-destructive">
                Enter an issue quantity for at least one component before saving.
              </p>
            )}
          </>
        )}

        {mutation.isError && (
          <p className="text-sm text-destructive">
            {mutation.error instanceof ApiError
              ? mutation.error.message
              : 'Failed to issue material.'}
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {rows.length === 0 ? 'Close' : 'Cancel'}
          </Button>
          {rows.length > 0 && (
            <Button
              type="submit"
              disabled={!hasAnyIssue || hasOverIssue || hasOverAvailable || mutation.isPending}
            >
              {mutation.isPending ? 'Issuing…' : 'Issue Material'}
            </Button>
          )}
        </DialogFooter>
      </form>
    </Dialog>
  );
}
