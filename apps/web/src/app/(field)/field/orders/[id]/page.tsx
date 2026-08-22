'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button } from '@zentuva/ui';

import { FieldStickyActionBar } from '@/components/field/FieldStickyActionBar';
import { ApiError } from '@/lib/api-client';

import { cancelSalesOrder, confirmSalesOrder, getSalesOrder } from '../../api';
import { SALES_ORDER_STATUS_LABELS, SALES_ORDER_STATUS_VARIANT } from '../../labels';

/** Order detail (Sprint 4.8 brief §21/§23) — the same record an Admin sees, presented as
 *  a mobile card layout with Confirm/Cancel as the sticky primary actions. */
export default function FieldOrderDetailPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const queryClient = useQueryClient();

  const { data: order } = useQuery({
    queryKey: ['sales-order', id],
    queryFn: () => getSalesOrder(id),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['sales-order', id] });
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

      {(order.status === 'DRAFT' || order.status === 'CONFIRMED') && (
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
          <Button
            variant="outline"
            size="touch"
            className="w-full"
            onClick={() => cancelMutation.mutate()}
            disabled={cancelMutation.isPending}
          >
            {cancelMutation.isPending ? 'Cancelling…' : 'Cancel Order'}
          </Button>
        </FieldStickyActionBar>
      )}
    </div>
  );
}
