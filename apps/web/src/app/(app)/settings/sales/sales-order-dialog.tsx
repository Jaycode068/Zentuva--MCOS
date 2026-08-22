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
} from '@zentuva/ui';

import { ApiError } from '@/lib/api-client';
import { listCustomers, listOutlets } from '@/app/(app)/settings/retail/api';
import { listProducts } from '@/app/(app)/settings/products/api';

import { createSalesOrder, type CreateSalesOrderPayload, type SalesOrderItemPayload } from './api';

/**
 * Create Sales Order dialog (Sprint 4.8, docs/domains/sales.md) — the desktop Admin
 * counterpart to the Field Sales mobile new-order flow, both hitting the same backend.
 * Loads reference data (customers, outlets scoped to the chosen customer, finished-
 * product SKUs) via parallel queries, guarded by a "Loading…" stub dialog until they
 * resolve — same convention as `ProductionOrderDialog`. The line-item totals shown here
 * are a live client-side preview only; the server always recomputes `lineTotal`/
 * `subtotal`/`total` authoritatively at save time (docs/domains/sales.md).
 *
 * Selecting a customer never checks or requires a distribution-network relationship —
 * every customer, regardless of type or network mapping, can be sold to directly.
 */
export function SalesOrderDialog({
  onOpenChange,
  onSaved,
}: {
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [customerId, setCustomerId] = useState('');
  const [outletId, setOutletId] = useState('');
  const [orderDate, setOrderDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [discount, setDiscount] = useState(0);
  const [items, setItems] = useState<SalesOrderItemPayload[]>([
    { productId: '', quantity: 1, unitPrice: 0 },
  ]);

  const { data: customersData } = useQuery({
    queryKey: ['customers-for-sales-order'],
    queryFn: () => listCustomers({ status: 'ACTIVE' }),
  });
  const { data: outletsData } = useQuery({
    queryKey: ['outlets-for-customer', customerId],
    queryFn: () => listOutlets({ customerId, status: 'ACTIVE' }),
    enabled: customerId.length > 0,
  });
  const { data: productsData } = useQuery({
    queryKey: ['products-for-sales-order'],
    queryFn: () => listProducts(),
  });

  const customers = customersData?.items ?? [];
  const outlets = outletsData?.items ?? [];
  const finishedProducts = useMemo(
    () => (productsData?.items ?? []).filter((product) => product.type === 'FINISHED_PRODUCT'),
    [productsData],
  );

  const subtotal = useMemo(
    () => items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0),
    [items],
  );
  const total = Math.max(0, subtotal - discount);

  const mutation = useMutation({
    mutationFn: (payload: CreateSalesOrderPayload) => createSalesOrder(payload),
    onSuccess: () => {
      onSaved();
      onOpenChange(false);
    },
  });

  function updateItem(index: number, patch: Partial<SalesOrderItemPayload>) {
    setItems((current) => current.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const validItems = items.filter((item) => item.productId && item.quantity > 0);
    if (!customerId || validItems.length === 0) return;
    mutation.mutate({
      customerId,
      outletId: outletId || undefined,
      orderDate,
      discount,
      items: validItems,
    });
  }

  if (!customersData || !productsData) {
    return (
      <Dialog open onOpenChange={onOpenChange}>
        <DialogHeader>
          <DialogTitle>Create Sales Order</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">Loading…</p>
      </Dialog>
    );
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>Create Sales Order</DialogTitle>
      </DialogHeader>
      <form className="max-h-[70vh] space-y-4 overflow-y-auto pr-1" onSubmit={handleSubmit}>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Customer</Label>
            <Select
              value={customerId}
              onChange={(event) => {
                setCustomerId(event.target.value);
                setOutletId('');
              }}
            >
              <option value="">Select a customer…</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.customerName}
                </option>
              ))}
            </Select>
            <p className="text-xs text-muted-foreground">Any customer can order directly.</p>
          </div>
          <div className="space-y-1.5">
            <Label>Outlet (optional)</Label>
            <Select
              value={outletId}
              onChange={(event) => setOutletId(event.target.value)}
              disabled={!customerId}
            >
              <option value="">No outlet / direct delivery</option>
              {outlets.map((outlet) => (
                <option key={outlet.id} value={outlet.id}>
                  {outlet.name}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Order Date</Label>
            <Input
              type="date"
              value={orderDate}
              onChange={(event) => setOrderDate(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Discount</Label>
            <Input
              type="number"
              min={0}
              step="0.01"
              value={discount}
              onChange={(event) => setDiscount(Number(event.target.value) || 0)}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label>Items</Label>
          {items.map((item, index) => (
            <div key={index} className="grid grid-cols-[1fr_5rem_6rem_auto] gap-2">
              <Select
                value={item.productId}
                onChange={(event) => updateItem(index, { productId: event.target.value })}
              >
                <option value="">Select a SKU…</option>
                {finishedProducts.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name} ({product.code})
                  </option>
                ))}
              </Select>
              <Input
                type="number"
                min={1}
                value={item.quantity}
                onChange={(event) =>
                  updateItem(index, { quantity: Number(event.target.value) || 0 })
                }
              />
              <Input
                type="number"
                min={0}
                step="0.01"
                value={item.unitPrice}
                onChange={(event) =>
                  updateItem(index, { unitPrice: Number(event.target.value) || 0 })
                }
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setItems((current) => current.filter((_, i) => i !== index))}
                disabled={items.length === 1}
              >
                Remove
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              setItems((current) => [...current, { productId: '', quantity: 1, unitPrice: 0 }])
            }
          >
            Add Another SKU
          </Button>
        </div>

        <div className="rounded-md border border-dashed border-border p-3 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Subtotal</span>
            <span>{subtotal.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Discount</span>
            <span>-{discount.toFixed(2)}</span>
          </div>
          <div className="flex justify-between font-semibold">
            <span>Total</span>
            <span>{total.toFixed(2)}</span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Preview only — the server recalculates totals authoritatively when you save.
          </p>
        </div>

        {mutation.isError && (
          <p className="text-sm text-destructive">
            {mutation.error instanceof ApiError
              ? mutation.error.message
              : 'Failed to create sales order.'}
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={mutation.isPending || !customerId}>
            {mutation.isPending ? 'Saving…' : 'Create Sales Order'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
