'use client';

import { useMemo, useState } from 'react';
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

import { ApiError } from '@/lib/api-client';
import { listInventoryLocations } from '@/app/(app)/settings/inventory/api';
import { listOutlets } from '@/app/(app)/settings/retail/api';
import {
  listSalesFulfilments,
  listSalesOrders,
  type SalesFulfilment,
  type SalesOrder,
} from '../sales/api';

import { createDispatch, getDispatchAvailability } from './api';

function toDateInputValue(value: string): string {
  return value.slice(0, 10);
}

/**
 * "Create Dispatch" dialog (Sprint 5, docs/domains/distribution.md) — unlike "Fulfil
 * Order" (opened from an already-open Sales Order), a Dispatch has no parent already on
 * screen, so this dialog starts with a compact Sales Order search, then a Sales
 * Fulfilment picker, before showing the same Fulfilled/Dispatched/Remaining item grid
 * shape as `sales-fulfilment-dialog.tsx`. Only orders that could have a fulfilment to
 * dispatch from (`PARTIALLY_FULFILLED`/`FULFILLED`) are searched.
 *
 * Blocks submitting more than a line's Remaining client-side — a UX convenience only;
 * the server re-validates authoritatively and atomically. A `crypto.randomUUID()`
 * idempotency key is generated once per dialog open and reused across retries of the
 * same submit.
 */
export function DispatchDialog({
  onOpenChange,
  onCreated,
}: {
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [orderSearch, setOrderSearch] = useState('');
  const [selectedOrder, setSelectedOrder] = useState<SalesOrder | null>(null);
  const [selectedFulfilment, setSelectedFulfilment] = useState<SalesFulfilment | null>(null);
  const [sourceLocationId, setSourceLocationId] = useState('');
  const [outletId, setOutletId] = useState('');
  const [dispatchDate, setDispatchDate] = useState(() =>
    toDateInputValue(new Date().toISOString()),
  );
  const [notes, setNotes] = useState('');
  const [quantities, setQuantities] = useState<Record<string, number>>({});

  const { data: ordersData, isLoading: ordersLoading } = useQuery({
    queryKey: ['sales-orders', 'dispatchable'],
    queryFn: () => listSalesOrders(),
    enabled: !selectedOrder,
  });
  const dispatchableOrders = useMemo(
    () =>
      (ordersData?.items ?? []).filter(
        (order) =>
          (order.status === 'PARTIALLY_FULFILLED' || order.status === 'FULFILLED') &&
          (!orderSearch.trim() ||
            order.orderCode.toLowerCase().includes(orderSearch.trim().toLowerCase()) ||
            order.customer.customerName.toLowerCase().includes(orderSearch.trim().toLowerCase())),
      ),
    [ordersData, orderSearch],
  );

  const { data: fulfilmentsData } = useQuery({
    queryKey: ['sales-fulfilments', selectedOrder?.id],
    queryFn: () => listSalesFulfilments(selectedOrder!.id),
    enabled: !!selectedOrder,
  });

  const { data: availabilityData } = useQuery({
    queryKey: ['dispatch-availability', selectedFulfilment?.id],
    queryFn: () => getDispatchAvailability(selectedFulfilment!.id),
    enabled: !!selectedFulfilment,
  });

  const { data: locationsData } = useQuery({
    queryKey: ['inventory-locations'],
    queryFn: () => listInventoryLocations(),
    enabled: !!selectedFulfilment,
  });
  const activeLocations = (locationsData?.items ?? []).filter((l) => l.status === 'ACTIVE');
  const defaultLocation = activeLocations.find((l) => l.isDefault) ?? activeLocations[0];
  const resolvedSourceLocationId = sourceLocationId || defaultLocation?.id || '';

  const { data: outletsData } = useQuery({
    queryKey: ['outlets', selectedOrder?.customer.id],
    queryFn: () => listOutlets({ customerId: selectedOrder!.customer.id }),
    enabled: !!selectedOrder,
  });

  const rows = useMemo(
    () => (availabilityData?.items ?? []).filter((row) => row.remaining > 0),
    [availabilityData],
  );

  const hasAnyQuantity = Object.values(quantities).some((value) => (value ?? 0) > 0);
  const hasOverDispatch = rows.some(
    (row) => (quantities[row.salesFulfilmentItemId] ?? 0) > row.remaining,
  );

  const mutation = useMutation({
    mutationFn: () => {
      const items = rows
        .map((row) => ({
          salesFulfilmentItemId: row.salesFulfilmentItemId,
          quantity: quantities[row.salesFulfilmentItemId] ?? 0,
        }))
        .filter((item) => item.quantity > 0);
      return createDispatch({
        salesFulfilmentId: selectedFulfilment!.id,
        outletId: outletId || undefined,
        sourceLocationId: resolvedSourceLocationId,
        dispatchDate,
        notes: notes || undefined,
        idempotencyKey,
        items,
      });
    },
    onSuccess: onCreated,
  });

  if (!selectedOrder) {
    return (
      <Dialog open onOpenChange={onOpenChange}>
        <DialogHeader>
          <DialogTitle>Create Dispatch</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Label>Select a Sales Order to dispatch from</Label>
          <Input
            placeholder="Search by order code or customer…"
            value={orderSearch}
            onChange={(event) => setOrderSearch(event.target.value)}
          />
          <div className="max-h-64 space-y-1 overflow-y-auto">
            {ordersLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
            {!ordersLoading && dispatchableOrders.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No fulfilled sales orders match your search.
              </p>
            )}
            {dispatchableOrders.map((order) => (
              <button
                key={order.id}
                type="button"
                onClick={() => setSelectedOrder(order)}
                className="w-full rounded-md border border-border p-2 text-left text-sm hover:bg-muted/50"
              >
                <span className="font-mono text-xs font-medium">{order.orderCode}</span>
                <span className="ml-2 text-muted-foreground">{order.customer.customerName}</span>
              </button>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </DialogFooter>
      </Dialog>
    );
  }

  if (!selectedFulfilment) {
    const fulfilments = fulfilmentsData?.items ?? [];
    return (
      <Dialog open onOpenChange={onOpenChange}>
        <DialogHeader>
          <DialogTitle>Create Dispatch — {selectedOrder.orderCode}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Label>Select a Sales Fulfilment</Label>
          {fulfilments.length === 0 && (
            <p className="text-sm text-muted-foreground">This order has no fulfilments yet.</p>
          )}
          <div className="max-h-64 space-y-1 overflow-y-auto">
            {fulfilments.map((fulfilment) => (
              <button
                key={fulfilment.id}
                type="button"
                onClick={() => setSelectedFulfilment(fulfilment)}
                className="w-full rounded-md border border-border p-2 text-left text-sm hover:bg-muted/50"
              >
                {new Date(fulfilment.fulfilmentDate).toLocaleDateString()} —{' '}
                {fulfilment.location.name}
              </button>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setSelectedOrder(null)}>
            Back
          </Button>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </DialogFooter>
      </Dialog>
    );
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>Create Dispatch — {selectedOrder.orderCode}</DialogTitle>
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
            Every line on this fulfilment has already been fully dispatched.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Dispatch Date</Label>
                <Input
                  type="date"
                  value={dispatchDate}
                  onChange={(event) => setDispatchDate(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Source Location</Label>
                <Select
                  value={resolvedSourceLocationId}
                  onChange={(event) => setSourceLocationId(event.target.value)}
                >
                  <option value="">Select a location…</option>
                  {activeLocations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name}
                      {location.isDefault ? ' (Default)' : ''}
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Destination Outlet (optional override)</Label>
              <Select value={outletId} onChange={(event) => setOutletId(event.target.value)}>
                <option value="">Use the order&apos;s own outlet</option>
                {(outletsData?.items ?? []).map((outlet) => (
                  <option key={outlet.id} value={outlet.id}>
                    {outlet.name}
                  </option>
                ))}
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Notes (optional)</Label>
              <Textarea rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} />
            </div>

            <div className="space-y-3">
              <Label>Fulfilment Lines</Label>
              {rows.map((row) => {
                const quantity = quantities[row.salesFulfilmentItemId] ?? 0;
                const overDispatch = quantity > row.remaining;
                return (
                  <div
                    key={row.salesFulfilmentItemId}
                    className="space-y-2 rounded-md border border-border p-3"
                  >
                    <div className="font-medium text-foreground">
                      {row.product.name}{' '}
                      <span className="text-xs text-muted-foreground">({row.product.unit})</span>
                    </div>
                    <div className="grid grid-cols-3 gap-x-4 gap-y-1 rounded-md bg-muted/30 p-2 text-xs text-muted-foreground">
                      <div>
                        Fulfilled
                        <div className="font-medium text-foreground">{row.fulfilled}</div>
                      </div>
                      <div>
                        Already Dispatched
                        <div className="font-medium text-foreground">{row.dispatched}</div>
                      </div>
                      <div>
                        Remaining
                        <div className="font-medium text-foreground">{row.remaining}</div>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Dispatch Quantity</Label>
                      <Input
                        type="number"
                        step="any"
                        min="0"
                        value={quantity || ''}
                        onChange={(event) =>
                          setQuantities((prev) => ({
                            ...prev,
                            [row.salesFulfilmentItemId]: Number(event.target.value),
                          }))
                        }
                      />
                      {overDispatch && (
                        <p className="text-xs text-destructive">
                          Cannot dispatch more than the {row.remaining} {row.product.unit}{' '}
                          remaining.
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {!hasAnyQuantity && (
              <p className="text-xs text-destructive">
                Enter a dispatch quantity for at least one line before saving.
              </p>
            )}
          </>
        )}

        {mutation.isError && (
          <p className="text-sm text-destructive">
            {mutation.error instanceof ApiError
              ? mutation.error.message
              : 'Failed to create dispatch.'}
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setSelectedFulfilment(null)}>
            Back
          </Button>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {rows.length > 0 && (
            <Button
              type="submit"
              disabled={
                !hasAnyQuantity ||
                hasOverDispatch ||
                !resolvedSourceLocationId ||
                mutation.isPending
              }
            >
              {mutation.isPending ? 'Creating…' : 'Create Dispatch'}
            </Button>
          )}
        </DialogFooter>
      </form>
    </Dialog>
  );
}
