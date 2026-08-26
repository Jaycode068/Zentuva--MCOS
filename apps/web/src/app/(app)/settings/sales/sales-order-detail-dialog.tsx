'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Dialog, DialogFooter, DialogHeader, DialogTitle } from '@zentuva/ui';
import Link from 'next/link';

import { ApiError } from '@/lib/api-client';

import { cancelSalesOrder, confirmSalesOrder, getSalesOrder, listSalesFulfilments } from './api';
import { SALES_ORDER_STATUS_LABELS, SALES_ORDER_STATUS_VARIANT } from './labels';
import { SalesFulfilmentDialog } from './sales-fulfilment-dialog';

/**
 * Read-only Sales Order detail view + Confirm/Cancel actions (Sprint 4.8,
 * docs/domains/sales.md). This is the exact same order history a Field Sales agent sees
 * on their own device (`GET /api/sales/orders/:id`) — confirming, cancelling, or simply
 * re-reading an order never differs by surface, only the presentation does.
 */
export function SalesOrderDetailDialog({
  salesOrderId,
  onOpenChange,
  onChanged,
}: {
  salesOrderId: string;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  const queryClient = useQueryClient();
  const [fulfilOpen, setFulfilOpen] = useState(false);
  const { data: order, isLoading } = useQuery({
    queryKey: ['sales-order', salesOrderId],
    queryFn: () => getSalesOrder(salesOrderId),
  });
  const { data: fulfilmentsData } = useQuery({
    queryKey: ['sales-fulfilments', salesOrderId],
    queryFn: () => listSalesFulfilments(salesOrderId),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['sales-order', salesOrderId] });
    queryClient.invalidateQueries({ queryKey: ['sales-fulfilments', salesOrderId] });
    onChanged();
  };

  const confirmMutation = useMutation({
    mutationFn: () => confirmSalesOrder(salesOrderId),
    onSuccess: invalidate,
  });
  const cancelMutation = useMutation({
    mutationFn: () => cancelSalesOrder(salesOrderId),
    onSuccess: invalidate,
  });

  if (isLoading || !order) {
    return (
      <Dialog open onOpenChange={onOpenChange}>
        <DialogHeader>
          <DialogTitle>Sales Order</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">Loading…</p>
      </Dialog>
    );
  }

  return (
    <>
      <Dialog open onOpenChange={onOpenChange}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {order.orderCode}
            <Badge variant={SALES_ORDER_STATUS_VARIANT[order.status]}>
              {SALES_ORDER_STATUS_LABELS[order.status]}
            </Badge>
          </DialogTitle>
        </DialogHeader>
        <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1 text-sm">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-muted-foreground">Customer</p>
              <p>{order.customer.customerName}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Outlet</p>
              <p>{order.outlet?.name ?? '— (no outlet)'}</p>
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/50 text-left">
                <tr>
                  <th className="px-3 py-2 font-medium">SKU</th>
                  <th className="px-3 py-2 font-medium">Qty</th>
                  <th className="px-3 py-2 font-medium">Fulfilled</th>
                  <th className="px-3 py-2 font-medium">Unit Price</th>
                  <th className="px-3 py-2 font-medium">Line Total</th>
                </tr>
              </thead>
              <tbody>
                {order.items.map((item) => (
                  <tr key={item.id} className="border-b border-border last:border-0">
                    <td className="px-3 py-2">{item.product.name}</td>
                    <td className="px-3 py-2">
                      {item.quantity} {item.product.unit}
                    </td>
                    <td className="px-3 py-2">
                      {item.quantityFulfilled} / {item.quantity}
                    </td>
                    <td className="px-3 py-2">{item.unitPrice.toFixed(2)}</td>
                    <td className="px-3 py-2">{item.lineTotal.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {(fulfilmentsData?.items.length ?? 0) > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Fulfilment History</p>
              <div className="space-y-2">
                {fulfilmentsData!.items.map((fulfilment) => (
                  <div key={fulfilment.id} className="rounded-md border border-border p-2 text-xs">
                    <div className="flex justify-between text-muted-foreground">
                      <span>
                        {new Date(fulfilment.fulfilmentDate).toLocaleDateString()} —{' '}
                        {fulfilment.location.name}
                      </span>
                    </div>
                    <div className="mt-1 space-y-0.5">
                      {fulfilment.items.map((item) => (
                        <div key={item.id} className="flex justify-between">
                          <span>{item.product.name}</span>
                          <span className="font-medium text-foreground">
                            {item.quantityFulfilled} {item.product.unit}
                          </span>
                        </div>
                      ))}
                    </div>
                    <div className="mt-1 flex justify-between border-t border-border pt-1 text-muted-foreground">
                      <span>Inventory Cost</span>
                      <span className="font-medium text-foreground">
                        {fulfilment.items
                          .reduce((sum, item) => sum + item.costAmount, 0)
                          .toFixed(2)}
                      </span>
                    </div>
                    {fulfilment.journalEntry ? (
                      <p className="mt-0.5">
                        <Link
                          href="/settings/finance/journal-entries"
                          className="font-medium text-foreground underline-offset-2 hover:underline"
                        >
                          {fulfilment.journalEntry.journalNumber}
                        </Link>{' '}
                        · {fulfilment.journalEntry.status} · COGS Posted
                      </p>
                    ) : (
                      <p className="mt-0.5 text-muted-foreground">
                        No accounting entry — no known cost at time of fulfilment.
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="rounded-md border border-dashed border-border p-3">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Subtotal</span>
              <span>{order.subtotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Discount</span>
              <span>-{order.discount.toFixed(2)}</span>
            </div>
            <div className="flex justify-between font-semibold">
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

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          {(order.status === 'DRAFT' || order.status === 'CONFIRMED') && (
            <Button
              type="button"
              variant="outline"
              onClick={() => cancelMutation.mutate()}
              disabled={cancelMutation.isPending}
            >
              {cancelMutation.isPending ? 'Cancelling…' : 'Cancel Order'}
            </Button>
          )}
          {order.status === 'DRAFT' && (
            <Button
              type="button"
              onClick={() => confirmMutation.mutate()}
              disabled={confirmMutation.isPending}
            >
              {confirmMutation.isPending ? 'Confirming…' : 'Confirm Order'}
            </Button>
          )}
          {(order.status === 'CONFIRMED' || order.status === 'PARTIALLY_FULFILLED') && (
            <Button type="button" onClick={() => setFulfilOpen(true)}>
              Fulfil Order
            </Button>
          )}
        </DialogFooter>
      </Dialog>

      {fulfilOpen && (
        <SalesFulfilmentDialog
          order={order}
          onOpenChange={setFulfilOpen}
          onFulfilled={() => {
            invalidate();
            setFulfilOpen(false);
          }}
        />
      )}
    </>
  );
}
