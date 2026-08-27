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
import { listSalesFulfilments, listSalesOrders } from '@/app/(app)/settings/sales/api';

import { requestCustomerReturn } from './api';
import { CUSTOMER_RETURN_REASON_LABELS } from './labels';

/**
 * "Request Customer Return" dialog (Sprint 11, docs/domains/sales.md "Customer
 * Returns") — the *request* step only (brief §32: no inventory/accounting effect).
 * Two-step: pick a Sales Order, then pick which fulfilled line(s) and quantities are
 * being returned. Mirrors `SalesFulfilmentDialog`'s per-line row shape, applied here
 * to `SalesFulfilmentItem`s instead of `SalesOrderItem`s — a return must always
 * reference a specific fulfilment line (brief §12), never guess cost from the order.
 */
export function CreateCustomerReturnDialog({
  onOpenChange,
  onCreated,
}: {
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [orderSearch, setOrderSearch] = useState('');
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [locationId, setLocationId] = useState('');
  const [returnDate, setReturnDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState<keyof typeof CUSTOMER_RETURN_REASON_LABELS>('DAMAGED');
  const [reasonNotes, setReasonNotes] = useState('');
  const [notes, setNotes] = useState('');
  const [quantities, setQuantities] = useState<Record<string, number>>({});

  const { data: ordersData } = useQuery({
    queryKey: ['sales-orders'],
    queryFn: () => listSalesOrders(),
  });
  const { data: locationsData } = useQuery({
    queryKey: ['inventory-locations'],
    queryFn: () => listInventoryLocations(),
  });
  const activeLocations = (locationsData?.items ?? []).filter((loc) => loc.status === 'ACTIVE');

  const matchingOrders = useMemo(() => {
    const query = orderSearch.trim().toLowerCase();
    const orders = ordersData?.items ?? [];
    if (!query) return orders.slice(0, 8);
    return orders
      .filter(
        (order) =>
          order.orderCode.toLowerCase().includes(query) ||
          order.customer.customerName.toLowerCase().includes(query),
      )
      .slice(0, 8);
  }, [ordersData, orderSearch]);

  const selectedOrder = ordersData?.items.find((order) => order.id === selectedOrderId) ?? null;

  const { data: fulfilmentsData } = useQuery({
    queryKey: ['sales-fulfilments', selectedOrderId],
    queryFn: () => listSalesFulfilments(selectedOrderId!),
    enabled: Boolean(selectedOrderId),
  });

  const fulfilmentItemRows = useMemo(
    () =>
      (fulfilmentsData?.items ?? []).flatMap((fulfilment) =>
        fulfilment.items.map((item) => ({
          salesFulfilmentItemId: item.id,
          product: item.product,
          quantityFulfilled: item.quantityFulfilled,
          fulfilmentDate: fulfilment.fulfilmentDate,
        })),
      ),
    [fulfilmentsData],
  );

  const hasAnyQuantity = Object.values(quantities).some((value) => (value ?? 0) > 0);

  const mutation = useMutation({
    mutationFn: () => {
      const items = fulfilmentItemRows
        .map((row) => ({
          salesFulfilmentItemId: row.salesFulfilmentItemId,
          quantityReturned: quantities[row.salesFulfilmentItemId] ?? 0,
        }))
        .filter((item) => item.quantityReturned > 0);
      return requestCustomerReturn({
        salesOrderId: selectedOrderId!,
        locationId,
        returnDate,
        reason,
        reasonNotes: reasonNotes || undefined,
        notes: notes || undefined,
        idempotencyKey,
        items,
      });
    },
    onSuccess: onCreated,
  });

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>Request Customer Return</DialogTitle>
      </DialogHeader>
      <div className="max-h-[75vh] space-y-4 overflow-y-auto pr-1">
        {!selectedOrder ? (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Find the Sales Order</Label>
              <Input
                placeholder="Search by order code or customer…"
                value={orderSearch}
                onChange={(event) => setOrderSearch(event.target.value)}
              />
            </div>
            <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border border-border p-1">
              {matchingOrders.length === 0 && (
                <p className="p-3 text-sm text-muted-foreground">No matching sales orders.</p>
              )}
              {matchingOrders.map((order) => (
                <button
                  key={order.id}
                  type="button"
                  onClick={() => setSelectedOrderId(order.id)}
                  className="w-full rounded-md p-2 text-left text-sm hover:bg-muted"
                >
                  <span className="font-mono text-xs font-medium">{order.orderCode}</span>
                  <span className="ml-2 text-muted-foreground">{order.customer.customerName}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between rounded-md border border-border bg-muted/30 p-3 text-sm">
              <div>
                <p className="font-mono text-xs font-medium">{selectedOrder.orderCode}</p>
                <p className="text-xs text-muted-foreground">
                  {selectedOrder.customer.customerName}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setSelectedOrderId(null)}
              >
                Change
              </Button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Return Date</Label>
                <Input
                  type="date"
                  value={returnDate}
                  onChange={(event) => setReturnDate(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Receiving Location</Label>
                <Select value={locationId} onChange={(event) => setLocationId(event.target.value)}>
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

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Reason</Label>
                <Select
                  value={reason}
                  onChange={(event) =>
                    setReason(event.target.value as keyof typeof CUSTOMER_RETURN_REASON_LABELS)
                  }
                >
                  {Object.entries(CUSTOMER_RETURN_REASON_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Reason Notes (optional)</Label>
                <Input
                  value={reasonNotes}
                  onChange={(event) => setReasonNotes(event.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Notes (optional)</Label>
              <Textarea rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} />
            </div>

            <div className="space-y-3">
              <Label>Fulfilled Lines</Label>
              {fulfilmentItemRows.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  This order has no fulfilment history — nothing is eligible for return.
                </p>
              )}
              {fulfilmentItemRows.map((row) => (
                <div
                  key={row.salesFulfilmentItemId}
                  className="space-y-2 rounded-md border border-border p-3"
                >
                  <div className="font-medium text-foreground">
                    {row.product.name}{' '}
                    <span className="text-xs text-muted-foreground">
                      ({row.product.unit}, fulfilled {row.quantityFulfilled} on{' '}
                      {row.fulfilmentDate.slice(0, 10)})
                    </span>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Return Quantity</Label>
                    <Input
                      type="number"
                      step="any"
                      min="0"
                      value={quantities[row.salesFulfilmentItemId] ?? ''}
                      onChange={(event) =>
                        setQuantities((prev) => ({
                          ...prev,
                          [row.salesFulfilmentItemId]: Number(event.target.value) || 0,
                        }))
                      }
                    />
                  </div>
                </div>
              ))}
            </div>

            {!hasAnyQuantity && fulfilmentItemRows.length > 0 && (
              <p className="text-xs text-destructive">
                Enter a return quantity for at least one line before saving.
              </p>
            )}
          </>
        )}

        {mutation.isError && (
          <p className="text-sm text-destructive">
            {mutation.error instanceof ApiError
              ? mutation.error.message
              : 'Failed to request return.'}
          </p>
        )}
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        {selectedOrder && (
          <Button
            type="button"
            onClick={() => mutation.mutate()}
            disabled={!locationId || !hasAnyQuantity || mutation.isPending}
          >
            {mutation.isPending ? 'Requesting…' : 'Request Return'}
          </Button>
        )}
      </DialogFooter>
    </Dialog>
  );
}
