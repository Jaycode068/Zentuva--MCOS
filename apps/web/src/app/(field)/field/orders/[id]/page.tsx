'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Input,
  Label,
  Select,
  Sheet,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@zentuva/ui';

import { FieldStickyActionBar } from '@/components/field/FieldStickyActionBar';
import { ApiError } from '@/lib/api-client';

import {
  cancelSalesOrder,
  confirmSalesOrder,
  fulfilSalesOrder,
  getSalesOrder,
  getSalesOrderAvailability,
  listInventoryLocations,
  type SalesOrder,
} from '../../api';
import { SALES_ORDER_STATUS_LABELS, SALES_ORDER_STATUS_VARIANT } from '../../labels';

/** Order detail (Sprint 4.8 brief §21/§23; Fulfilment added Sprint 4.9) — the same
 *  record an Admin sees, presented as a mobile card layout with Confirm/Cancel/Fulfil as
 *  the sticky primary actions. */
export default function FieldOrderDetailPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const queryClient = useQueryClient();
  const [fulfilOpen, setFulfilOpen] = useState(false);

  const { data: order } = useQuery({
    queryKey: ['sales-order', id],
    queryFn: () => getSalesOrder(id),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['sales-order', id] });
    queryClient.invalidateQueries({ queryKey: ['sales-order-availability', id] });
  };
  const confirmMutation = useMutation({
    mutationFn: () => confirmSalesOrder(id),
    onSuccess: invalidate,
  });
  const cancelMutation = useMutation({
    mutationFn: () => cancelSalesOrder(id),
    onSuccess: invalidate,
  });

  if (!order) {
    return <p className="p-4 text-sm text-muted-foreground">Loading…</p>;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-4 p-4">
        <div className="flex items-center justify-between">
          <h1 className="font-mono text-lg font-semibold">{order.orderCode}</h1>
          <Badge variant={SALES_ORDER_STATUS_VARIANT[order.status]}>
            {SALES_ORDER_STATUS_LABELS[order.status]}
          </Badge>
        </div>
        <div>
          <p className="font-medium">{order.customer.customerName}</p>
          <p className="text-sm text-muted-foreground">
            {order.outlet?.name ?? 'No outlet — direct delivery'}
          </p>
        </div>

        <div className="space-y-2">
          {order.items.map((item) => (
            <div key={item.id} className="rounded-lg border border-border p-3">
              <p className="font-medium">{item.product.name}</p>
              <div className="mt-1 flex justify-between text-sm text-muted-foreground">
                <span>
                  {item.quantity} {item.product.unit} × {item.unitPrice.toFixed(2)}
                </span>
                <span className="font-medium text-foreground">{item.lineTotal.toFixed(2)}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="rounded-lg border border-dashed border-border p-3 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Subtotal</span>
            <span>{order.subtotal.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Discount</span>
            <span>-{order.discount.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-base font-semibold">
            <span>Total</span>
            <span>{order.total.toFixed(2)}</span>
          </div>
        </div>

        {confirmMutation.isError && (
          <p className="text-sm text-destructive">
            {confirmMutation.error instanceof ApiError
              ? confirmMutation.error.message
              : 'Failed to confirm order.'}
          </p>
        )}
        {cancelMutation.isError && (
          <p className="text-sm text-destructive">
            {cancelMutation.error instanceof ApiError
              ? cancelMutation.error.message
              : 'Failed to cancel order.'}
          </p>
        )}
      </div>

      {(order.status === 'DRAFT' ||
        order.status === 'CONFIRMED' ||
        order.status === 'PARTIALLY_FULFILLED') && (
        <FieldStickyActionBar className="flex-col gap-2">
          {order.status === 'DRAFT' && (
            <Button
              size="touch"
              className="w-full"
              onClick={() => confirmMutation.mutate()}
              disabled={confirmMutation.isPending}
            >
              {confirmMutation.isPending ? 'Confirming…' : 'Confirm Order'}
            </Button>
          )}
          {(order.status === 'CONFIRMED' || order.status === 'PARTIALLY_FULFILLED') && (
            <Button size="touch" className="w-full" onClick={() => setFulfilOpen(true)}>
              Fulfil Order
            </Button>
          )}
          {(order.status === 'DRAFT' || order.status === 'CONFIRMED') && (
            <Button
              variant="outline"
              size="touch"
              className="w-full"
              onClick={() => cancelMutation.mutate()}
              disabled={cancelMutation.isPending}
            >
              {cancelMutation.isPending ? 'Cancelling…' : 'Cancel Order'}
            </Button>
          )}
        </FieldStickyActionBar>
      )}

      <FieldFulfilSheet
        order={order}
        open={fulfilOpen}
        onOpenChange={setFulfilOpen}
        onFulfilled={() => {
          invalidate();
          setFulfilOpen(false);
        }}
      />
    </div>
  );
}

/** Full-screen (`side="full"`) fulfilment flow — a multi-line quantity-entry step, same
 *  reasoning as the SKU-picker's `side="bottom"` choice in `orders/new/page.tsx`: this is
 *  denser than a single-pick action, so it gets the full-bleed panel. Mirrors the Admin
 *  `SalesFulfilmentDialog`'s Ordered/Already Fulfilled/Remaining/Available grid. */
function FieldFulfilSheet({
  order,
  open,
  onOpenChange,
  onFulfilled,
}: {
  order: SalesOrder;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onFulfilled: () => void;
}) {
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [locationId, setLocationId] = useState('');
  const [quantities, setQuantities] = useState<Record<string, number>>({});

  const { data: locationsData } = useQuery({
    queryKey: ['inventory-locations'],
    queryFn: () => listInventoryLocations(),
    enabled: open,
  });
  const { data: availabilityData } = useQuery({
    queryKey: ['sales-order-availability', order.id],
    queryFn: () => getSalesOrderAvailability(order.id),
    enabled: open,
  });

  const activeLocations = (locationsData?.items ?? []).filter(
    (location) => location.status === 'ACTIVE',
  );
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

  const mutation = useMutation({
    mutationFn: () => {
      const items = rows
        .map((row) => ({
          salesOrderItemId: row.salesOrderItemId,
          quantity: quantities[row.salesOrderItemId] ?? 0,
        }))
        .filter((item) => item.quantity > 0);
      return fulfilSalesOrder(order.id, {
        locationId,
        fulfilmentDate: new Date().toISOString().slice(0, 10),
        idempotencyKey,
        items,
      });
    },
    onSuccess: () => {
      setQuantities({});
      onFulfilled();
    },
  });

  const hasAnyFulfilment = Object.values(quantities).some((value) => (value ?? 0) > 0);
  const hasOverFulfilment = rows.some(
    (row) => (quantities[row.salesOrderItemId] ?? 0) > row.remaining,
  );
  const hasOverAvailable = rows.some(
    (row) => (quantities[row.salesOrderItemId] ?? 0) > row.available,
  );

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setIdempotencyKey(crypto.randomUUID());
        }
        onOpenChange(next);
      }}
      side="full"
    >
      <SheetHeader>
        <SheetTitle>Fulfil {order.orderCode}</SheetTitle>
      </SheetHeader>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Every line on this order has already been fully fulfilled.
        </p>
      ) : (
        <div className="flex-1 space-y-4 overflow-y-auto">
          <div className="space-y-1.5">
            <Label className="text-base">Location</Label>
            <Select
              className="h-12 text-base"
              value={locationId}
              onChange={(event) => setLocationId(event.target.value)}
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

          <div className="space-y-2">
            {rows.map((row) => {
              const quantity = quantities[row.salesOrderItemId] ?? 0;
              const overFulfilment = quantity > row.remaining;
              const overAvailable = quantity > row.available;
              return (
                <div key={row.salesOrderItemId} className="rounded-xl border border-border p-3">
                  <p className="font-medium">{row.name}</p>
                  <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 rounded-md bg-muted/30 p-2 text-xs text-muted-foreground">
                    <div>
                      Ordered
                      <div className="font-medium text-foreground">{row.ordered}</div>
                    </div>
                    <div>
                      Fulfilled
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
                  <div className="mt-2 space-y-1">
                    <Label className="text-xs">Fulfil Quantity</Label>
                    <Input
                      type="number"
                      min={0}
                      className="h-11 text-base"
                      value={quantity}
                      onChange={(event) =>
                        setQuantities((current) => ({
                          ...current,
                          [row.salesOrderItemId]: Number(event.target.value) || 0,
                        }))
                      }
                    />
                    {overFulfilment && (
                      <p className="text-xs text-destructive">
                        Only {row.remaining} {row.unit} remains outstanding.
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

          {mutation.isError && (
            <p className="text-sm text-destructive">
              {mutation.error instanceof ApiError
                ? mutation.error.message
                : 'Failed to fulfil order.'}
            </p>
          )}
        </div>
      )}

      <SheetFooter>
        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={() => onOpenChange(false)}
        >
          {rows.length === 0 ? 'Close' : 'Cancel'}
        </Button>
        {rows.length > 0 && (
          <Button
            type="button"
            className="w-full"
            disabled={
              !locationId ||
              !hasAnyFulfilment ||
              hasOverFulfilment ||
              hasOverAvailable ||
              mutation.isPending
            }
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? 'Fulfilling…' : 'Fulfil'}
          </Button>
        )}
      </SheetFooter>
    </Sheet>
  );
}
