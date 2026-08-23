'use client';

import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
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

import { ApiError } from '@/lib/api-client';

import { createDelivery, type Dispatch } from './api';

function toDateInputValue(value: string): string {
  return value.slice(0, 10);
}

/**
 * "Record Delivery" dialog (Sprint 5, docs/domains/distribution.md) — one row per
 * dispatch line still undelivered (`quantityDispatched - quantityDelivered > 0`), each
 * showing Dispatched/Already Delivered/Remaining before the user enters this delivery's
 * quantity. Deliberately allows a short/partial delivery (a line's quantity need not sum
 * to Remaining) — this sprint builds no reason-code enum, so `notes` is where the "why"
 * (damaged/lost/refused) is captured in free text.
 *
 * Blocks submitting more than a line's Remaining client-side — a UX convenience only;
 * the server re-validates authoritatively and atomically. A `crypto.randomUUID()`
 * idempotency key is generated once per dialog open and reused across retries of the
 * same submit.
 */
export function DeliveryDialog({
  dispatch,
  onOpenChange,
  onDelivered,
}: {
  dispatch: Dispatch;
  onOpenChange: (open: boolean) => void;
  onDelivered: () => void;
}) {
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [deliveryDate, setDeliveryDate] = useState(() =>
    toDateInputValue(new Date().toISOString()),
  );
  const [receivedByName, setReceivedByName] = useState('');
  const [notes, setNotes] = useState('');
  const [quantities, setQuantities] = useState<Record<string, number>>({});

  const rows = useMemo(
    () =>
      dispatch.items
        .map((item) => ({
          dispatchItemId: item.id,
          name: item.product.name,
          unit: item.product.unit,
          dispatched: item.quantityDispatched,
          alreadyDelivered: item.quantityDelivered,
          remaining: Math.max(0, item.quantityDispatched - item.quantityDelivered),
        }))
        .filter((row) => row.remaining > 0),
    [dispatch.items],
  );

  const hasAnyQuantity = Object.values(quantities).some((value) => (value ?? 0) > 0);
  const hasOverDelivery = rows.some((row) => (quantities[row.dispatchItemId] ?? 0) > row.remaining);

  const mutation = useMutation({
    mutationFn: () => {
      const items = rows
        .map((row) => ({
          dispatchItemId: row.dispatchItemId,
          quantity: quantities[row.dispatchItemId] ?? 0,
        }))
        .filter((item) => item.quantity > 0);
      return createDelivery(dispatch.id, {
        deliveryDate,
        receivedByName: receivedByName || undefined,
        notes: notes || undefined,
        idempotencyKey,
        items,
      });
    },
    onSuccess: onDelivered,
  });

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>Record Delivery — {dispatch.dispatchCode}</DialogTitle>
      </DialogHeader>
      <form
        className="max-h-[75vh] space-y-4 overflow-y-auto pr-1"
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate();
        }}
      >
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Every line on this dispatch has already been fully delivered.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Delivery Date</Label>
                <Input
                  type="date"
                  value={deliveryDate}
                  onChange={(event) => setDeliveryDate(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Received By (optional)</Label>
                <Input
                  value={receivedByName}
                  onChange={(event) => setReceivedByName(event.target.value)}
                  placeholder="Recipient's name"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Notes (optional)</Label>
              <Textarea
                rows={2}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Explain any shortfall — e.g. damaged, lost, or refused"
              />
            </div>

            <div className="space-y-3">
              <Label>Dispatch Lines</Label>
              {rows.map((row) => {
                const quantity = quantities[row.dispatchItemId] ?? 0;
                const overDelivery = quantity > row.remaining;
                return (
                  <div
                    key={row.dispatchItemId}
                    className="space-y-2 rounded-md border border-border p-3"
                  >
                    <div className="font-medium text-foreground">
                      {row.name} <span className="text-xs text-muted-foreground">({row.unit})</span>
                    </div>
                    <div className="grid grid-cols-3 gap-x-4 gap-y-1 rounded-md bg-muted/30 p-2 text-xs text-muted-foreground">
                      <div>
                        Dispatched
                        <div className="font-medium text-foreground">{row.dispatched}</div>
                      </div>
                      <div>
                        Already Delivered
                        <div className="font-medium text-foreground">{row.alreadyDelivered}</div>
                      </div>
                      <div>
                        Remaining
                        <div className="font-medium text-foreground">{row.remaining}</div>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Delivered Quantity</Label>
                      <Input
                        type="number"
                        step="any"
                        min="0"
                        value={quantity || ''}
                        onChange={(event) =>
                          setQuantities((prev) => ({
                            ...prev,
                            [row.dispatchItemId]: Number(event.target.value),
                          }))
                        }
                      />
                      {overDelivery && (
                        <p className="text-xs text-destructive">
                          Cannot deliver more than the {row.remaining} {row.unit} remaining.
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {!hasAnyQuantity && (
              <p className="text-xs text-destructive">
                Enter a delivered quantity for at least one line before saving.
              </p>
            )}
          </>
        )}

        {mutation.isError && (
          <p className="text-sm text-destructive">
            {mutation.error instanceof ApiError
              ? mutation.error.message
              : 'Failed to record delivery.'}
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {rows.length === 0 ? 'Close' : 'Cancel'}
          </Button>
          {rows.length > 0 && (
            <Button
              type="submit"
              disabled={!hasAnyQuantity || hasOverDelivery || mutation.isPending}
            >
              {mutation.isPending ? 'Recording…' : 'Record Delivery'}
            </Button>
          )}
        </DialogFooter>
      </form>
    </Dialog>
  );
}
