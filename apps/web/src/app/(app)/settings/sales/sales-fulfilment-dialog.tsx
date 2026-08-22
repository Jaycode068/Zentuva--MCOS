'use client';

import { useMemo, useState } from 'react';
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
import { listInventoryLocations } from '@/app/(app)/settings/inventory/api';

import { fulfilSalesOrder, getSalesOrderAvailability, type SalesOrder } from './api';

function toDateInputValue(value: string): string {
  return value.slice(0, 10);
}

/**
 * "Fulfil Order" dialog (Sprint 4.9, docs/domains/sales.md "Fulfilment") — one row per
 * order line still outstanding (`quantity - quantityFulfilled > 0`), each showing
 * Ordered/Already Fulfilled/Remaining/Available before the user enters this batch's
 * fulfil quantity. Mirrors `MaterialIssueDialog`'s exact shape, plus a Location
 * `<Select>` (same `listInventoryLocations()` + `ACTIVE`-filter + `isDefault`-default
 * pattern as `stock-adjustment-dialog.tsx`) since — unlike a Production Order — a Sales
 * Order has no location of its own.
 *
 * Blocks submitting more than Remaining or more than Available client-side — a UX
 * convenience only; the server re-validates both authoritatively and atomically. A
 * `crypto.randomUUID()` idempotency key is generated once per dialog open and reused
 * across retries of the same submit, so a double-tap or flaky-network retry can never
 * deduct stock twice.
 */
export function SalesFulfilmentDialog({
  order,
  onOpenChange,
  onFulfilled,
}: {
  order: SalesOrder;
  onOpenChange: (open: boolean) => void;
  onFulfilled: () => void;
}) {
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const { data: locationsData } = useQuery({
    queryKey: ['inventory-locations'],
    queryFn: () => listInventoryLocations(),
  });
  const activeLocations = (locationsData?.items ?? []).filter(
    (location) => location.status === 'ACTIVE',
  );
  const defaultLocation =
    activeLocations.find((location) => location.isDefault) ?? activeLocations[0];

  const { data: availabilityData } = useQuery({
    queryKey: ['sales-order-availability', order.id],
    queryFn: () => getSalesOrderAvailability(order.id),
  });
  const availabilityByItem = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of availabilityData?.items ?? []) {
      map.set(row.salesOrderItemId, row.availableStock);
    }
    return map;
  }, [availabilityData]);

  const rows = useMemo(
    () =>
      order.items
        .map((item) => ({
          salesOrderItemId: item.id,
          name: item.product.name,
          unit: item.product.unit,
          ordered: item.quantity,
          alreadyFulfilled: item.quantityFulfilled,
          remaining: Math.max(0, item.quantity - item.quantityFulfilled),
          available: availabilityByItem.get(item.id) ?? 0,
        }))
        .filter((row) => row.remaining > 0),
    [order.items, availabilityByItem],
  );

  const formSchema = useMemo(
    () =>
      z.object({
        fulfilmentDate: z.string().min(1, 'Fulfilment date is required'),
        locationId: z.string().min(1, 'Location is required'),
        notes: z.string().optional(),
        quantities: z.record(z.string(), z.number().nonnegative('Cannot be negative')),
      }),
    [],
  );
  type FormValues = z.infer<typeof formSchema>;

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      fulfilmentDate: toDateInputValue(new Date().toISOString()),
      locationId: defaultLocation?.id ?? '',
      notes: '',
      quantities: Object.fromEntries(rows.map((row) => [row.salesOrderItemId, 0])),
    },
  });

  const watchedQuantities = form.watch('quantities');
  const hasAnyFulfilment = Object.values(watchedQuantities ?? {}).some((value) => (value ?? 0) > 0);
  const hasOverFulfilment = rows.some(
    (row) => (watchedQuantities?.[row.salesOrderItemId] ?? 0) > row.remaining,
  );
  const hasOverAvailable = rows.some(
    (row) => (watchedQuantities?.[row.salesOrderItemId] ?? 0) > row.available,
  );

  const mutation = useMutation({
    mutationFn: (values: FormValues) => {
      const items = rows
        .map((row) => ({
          salesOrderItemId: row.salesOrderItemId,
          quantity: values.quantities[row.salesOrderItemId] ?? 0,
        }))
        .filter((item) => item.quantity > 0);
      return fulfilSalesOrder(order.id, {
        locationId: values.locationId,
        fulfilmentDate: values.fulfilmentDate,
        notes: values.notes || undefined,
        idempotencyKey,
        items,
      });
    },
    onSuccess: onFulfilled,
  });

  if (!availabilityData) {
    return (
      <Dialog open onOpenChange={onOpenChange}>
        <DialogHeader>
          <DialogTitle>Fulfil Order</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">Loading…</p>
      </Dialog>
    );
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>Fulfil Order — {order.orderCode}</DialogTitle>
      </DialogHeader>
      <form
        className="max-h-[75vh] space-y-4 overflow-y-auto pr-1"
        onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
      >
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Every line on this order has already been fully fulfilled.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Fulfilment Date</Label>
                <Input type="date" {...form.register('fulfilmentDate')} />
                {form.formState.errors.fulfilmentDate && (
                  <p className="text-xs text-destructive">
                    {form.formState.errors.fulfilmentDate.message}
                  </p>
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
                  <p className="text-xs text-destructive">
                    {form.formState.errors.locationId.message}
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Notes (optional)</Label>
              <Textarea rows={2} {...form.register('notes')} />
            </div>

            <div className="space-y-3">
              <Label>Order Lines</Label>
              {rows.map((row) => {
                const fulfilQuantity = watchedQuantities?.[row.salesOrderItemId] ?? 0;
                const overFulfilment = fulfilQuantity > row.remaining;
                const overAvailable = fulfilQuantity > row.available;
                return (
                  <div
                    key={row.salesOrderItemId}
                    className="space-y-2 rounded-md border border-border p-3"
                  >
                    <div className="font-medium text-foreground">
                      {row.name} <span className="text-xs text-muted-foreground">({row.unit})</span>
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-md bg-muted/30 p-2 text-xs text-muted-foreground sm:grid-cols-4">
                      <div>
                        Ordered
                        <div className="font-medium text-foreground">{row.ordered}</div>
                      </div>
                      <div>
                        Already Fulfilled
                        <div className="font-medium text-foreground">{row.alreadyFulfilled}</div>
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
                      <Label className="text-xs">Fulfil Quantity</Label>
                      <Input
                        type="number"
                        step="any"
                        min="0"
                        {...form.register(`quantities.${row.salesOrderItemId}`, {
                          valueAsNumber: true,
                        })}
                      />
                      {overFulfilment && (
                        <p className="text-xs text-destructive">
                          Cannot fulfil more than the {row.remaining} {row.unit} still remaining.
                        </p>
                      )}
                      {!overFulfilment && overAvailable && (
                        <p className="text-xs text-destructive">
                          Only {row.available} {row.unit} is available in stock.
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {!hasAnyFulfilment && (
              <p className="text-xs text-destructive">
                Enter a fulfil quantity for at least one line before saving.
              </p>
            )}
          </>
        )}

        {mutation.isError && (
          <p className="text-sm text-destructive">
            {mutation.error instanceof ApiError
              ? mutation.error.message
              : 'Failed to fulfil order.'}
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {rows.length === 0 ? 'Close' : 'Cancel'}
          </Button>
          {rows.length > 0 && (
            <Button
              type="submit"
              disabled={
                !hasAnyFulfilment || hasOverFulfilment || hasOverAvailable || mutation.isPending
              }
            >
              {mutation.isPending ? 'Fulfilling…' : 'Fulfil Order'}
            </Button>
          )}
        </DialogFooter>
      </form>
    </Dialog>
  );
}
