'use client';

import { Suspense, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
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
  createSalesOrder,
  getInventoryStockByProduct,
  listCustomers,
  listOutlets,
  listProducts,
  type SalesOrderItemPayload,
} from '../../api';

/**
 * New Sales Order (Sprint 4.8 brief §23) — Select Customer -> Select Outlet if
 * applicable -> Search SKU -> Select quantity -> Add another SKU -> Review -> Confirm ->
 * Success. Every customer is selectable regardless of type or network mapping — there is
 * no distributor requirement anywhere in this flow, and an explicit "Any customer can
 * order directly" note makes that visible. Stock availability, when shown, is purely
 * informational (a live read of the existing Inventory endpoint) and never blocks
 * adding an item or submitting the order.
 */
export default function NewFieldOrderPage() {
  return (
    <Suspense fallback={<p className="p-4 text-sm text-muted-foreground">Loading…</p>}>
      <NewFieldOrderForm />
    </Suspense>
  );
}

function NewFieldOrderForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [customerId, setCustomerId] = useState(searchParams.get('customerId') ?? '');
  const [outletId, setOutletId] = useState(searchParams.get('outletId') ?? '');
  const [items, setItems] = useState<SalesOrderItemPayload[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [productSearch, setProductSearch] = useState('');
  const [success, setSuccess] = useState<string | null>(null);

  const { data: customersData } = useQuery({
    queryKey: ['customers'],
    queryFn: () => listCustomers({ status: 'ACTIVE' }),
  });
  const { data: outletsData } = useQuery({
    queryKey: ['outlets', 'by-customer', customerId],
    queryFn: () => listOutlets({ customerId, status: 'ACTIVE' }),
    enabled: customerId.length > 0,
  });
  const { data: productsData } = useQuery({
    queryKey: ['products-for-field-order'],
    queryFn: () => listProducts(),
  });

  const customers = customersData?.items ?? [];
  const outlets = outletsData?.items ?? [];
  const finishedProducts = useMemo(
    () => (productsData?.items ?? []).filter((p) => p.type === 'FINISHED_PRODUCT'),
    [productsData],
  );
  const filteredProducts = useMemo(() => {
    const query = productSearch.trim().toLowerCase();
    if (!query) return finishedProducts;
    return finishedProducts.filter(
      (p) => p.name.toLowerCase().includes(query) || p.code.toLowerCase().includes(query),
    );
  }, [finishedProducts, productSearch]);

  const productsById = useMemo(
    () => new Map(finishedProducts.map((p) => [p.id, p])),
    [finishedProducts],
  );
  const subtotal = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);

  const mutation = useMutation({
    mutationFn: () =>
      createSalesOrder({
        customerId,
        outletId: outletId || undefined,
        orderDate: new Date().toISOString().slice(0, 10),
        items,
      }),
    onSuccess: (order) => setSuccess(order.id),
  });

  function addProduct(productId: string) {
    setItems((current) => {
      if (current.some((item) => item.productId === productId)) return current;
      return [...current, { productId, quantity: 1, unitPrice: 0 }];
    });
    setPickerOpen(false);
  }

  function updateItem(productId: string, patch: Partial<SalesOrderItemPayload>) {
    setItems((current) =>
      current.map((item) => (item.productId === productId ? { ...item, ...patch } : item)),
    );
  }

  if (success) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-4 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-3xl text-primary">
          ✓
        </div>
        <h1 className="text-xl font-semibold">Order Saved</h1>
        <p className="text-sm text-muted-foreground">The order was created successfully.</p>
        <div className="flex w-full flex-col gap-2">
          <Button
            size="touch"
            className="w-full"
            onClick={() => router.replace(`/field/orders/${success}`)}
          >
            View Order
          </Button>
          <Button
            variant="outline"
            size="touch"
            className="w-full"
            onClick={() => router.replace('/field/orders/new')}
          >
            Create Another Order
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-5 p-4">
        <h1 className="text-xl font-semibold tracking-tight">New Order</h1>

        <div className="space-y-1.5">
          <Label className="text-base">Customer</Label>
          <Select
            className="h-12 text-base"
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

        {customerId && (
          <div className="space-y-1.5">
            <Label className="text-base">Outlet (optional)</Label>
            <Select
              className="h-12 text-base"
              value={outletId}
              onChange={(event) => setOutletId(event.target.value)}
            >
              <option value="">No outlet / direct delivery</option>
              {outlets.map((outlet) => (
                <option key={outlet.id} value={outlet.id}>
                  {outlet.name}
                </option>
              ))}
            </Select>
          </div>
        )}

        {customerId && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-base">Items</Label>
              <Button type="button" variant="outline" size="sm" onClick={() => setPickerOpen(true)}>
                + Add SKU
              </Button>
            </div>
            {items.length === 0 && (
              <p className="text-sm text-muted-foreground">No items added yet.</p>
            )}
            {items.map((item) => {
              const product = productsById.get(item.productId);
              return (
                <div key={item.productId} className="rounded-xl border border-border p-3">
                  <p className="font-medium">{product?.name ?? item.productId}</p>
                  <p className="text-xs text-muted-foreground">{product?.code}</p>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs">Quantity</Label>
                      <Input
                        type="number"
                        min={1}
                        className="h-11 text-base"
                        value={item.quantity}
                        onChange={(event) =>
                          updateItem(item.productId, { quantity: Number(event.target.value) || 0 })
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Unit Price</Label>
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        className="h-11 text-base"
                        value={item.unitPrice}
                        onChange={(event) =>
                          updateItem(item.productId, { unitPrice: Number(event.target.value) || 0 })
                        }
                      />
                    </div>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Line total</span>
                    <span className="font-medium">
                      {(item.quantity * item.unitPrice).toFixed(2)}
                    </span>
                  </div>
                  <ItemStockHint productId={item.productId} />
                </div>
              );
            })}
          </div>
        )}

        {items.length > 0 && (
          <div className="rounded-xl border border-dashed border-border p-3">
            <div className="flex justify-between text-base font-semibold">
              <span>Total</span>
              <span>{subtotal.toFixed(2)}</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              The server recalculates this total authoritatively when you save.
            </p>
          </div>
        )}

        {mutation.isError && (
          <p className="text-sm text-destructive">
            {mutation.error instanceof ApiError ? mutation.error.message : 'Failed to save order.'}
          </p>
        )}
      </div>

      <FieldStickyActionBar>
        <Button
          size="touch"
          className="w-full"
          disabled={!customerId || items.length === 0 || mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          {mutation.isPending ? 'Saving…' : `Confirm Order — ${subtotal.toFixed(2)}`}
        </Button>
      </FieldStickyActionBar>

      <Sheet open={pickerOpen} onOpenChange={setPickerOpen} side="bottom">
        <SheetHeader>
          <SheetTitle>Select a SKU</SheetTitle>
        </SheetHeader>
        <Input
          placeholder="Search products…"
          className="h-12 text-base"
          value={productSearch}
          onChange={(event) => setProductSearch(event.target.value)}
        />
        <div className="mt-3 max-h-80 space-y-2 overflow-y-auto">
          {filteredProducts.map((product) => (
            <button
              key={product.id}
              type="button"
              onClick={() => addProduct(product.id)}
              className="flex w-full items-center justify-between rounded-lg border border-border p-3 text-left active:bg-muted/50"
            >
              <div>
                <p className="font-medium">{product.name}</p>
                <p className="text-xs text-muted-foreground">
                  {product.code} · {product.unit}
                </p>
              </div>
            </button>
          ))}
          {filteredProducts.length === 0 && (
            <p className="text-sm text-muted-foreground">No products found.</p>
          )}
        </div>
        <SheetFooter>
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => setPickerOpen(false)}
          >
            Close
          </Button>
        </SheetFooter>
      </Sheet>
    </div>
  );
}

/** Read-only, purely informational stock line under an item card (Sprint 4.9) — a live
 *  read of the existing Inventory endpoint, same convention this file's own docblock
 *  already commits to. Never blocks adding items or submitting the order regardless of
 *  what it shows. */
function ItemStockHint({ productId }: { productId: string }) {
  const { data } = useQuery({
    queryKey: ['inventory-stock', productId],
    queryFn: () => getInventoryStockByProduct(productId),
  });

  if (!data) return null;
  return (
    <p className="mt-1 text-xs text-muted-foreground">
      In stock: {data.quantityOnHand} {data.product.unit}
    </p>
  );
}
