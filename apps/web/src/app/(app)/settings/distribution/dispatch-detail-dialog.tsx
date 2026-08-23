'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Textarea,
} from '@zentuva/ui';

import { ApiError } from '@/lib/api-client';
import { listNetworkRelationships } from '@/app/(app)/settings/retail/api';

import {
  cancelDispatch,
  dispatchOut,
  failDispatch,
  getDispatch,
  listDeliveries,
  markInTransit,
} from './api';
import { DISPATCH_STATUS_LABELS, DISPATCH_STATUS_VARIANT } from './labels';
import { DeliveryDialog } from './delivery-dialog';

/**
 * Read-only Dispatch detail view + lifecycle actions (Sprint 5,
 * docs/domains/distribution.md). The "Associated Distributor" card below is a
 * frontend-only, purely informational composition against the pre-existing public
 * `GET /api/retail/network-relationships?customerId=` endpoint — it never gates any
 * action here, mirroring exactly how Sales's own new-order screen reads inventory
 * informationally without ever gating on it (docs/domains/retail-network.md "Capture
 * the Market First").
 */
export function DispatchDetailDialog({
  dispatchId,
  onOpenChange,
  onChanged,
}: {
  dispatchId: string;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  const queryClient = useQueryClient();
  const [deliveryOpen, setDeliveryOpen] = useState(false);
  const [failReasonOpen, setFailReasonOpen] = useState(false);
  const [failNotes, setFailNotes] = useState('');

  const { data: dispatch, isLoading } = useQuery({
    queryKey: ['dispatch', dispatchId],
    queryFn: () => getDispatch(dispatchId),
  });
  const { data: deliveriesData } = useQuery({
    queryKey: ['deliveries', dispatchId],
    queryFn: () => listDeliveries(dispatchId),
  });
  const { data: networkData } = useQuery({
    queryKey: ['network-relationships', dispatch?.customer.id],
    queryFn: () =>
      listNetworkRelationships({ customerId: dispatch!.customer.id, status: 'ACTIVE' }),
    enabled: !!dispatch,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['dispatch', dispatchId] });
    queryClient.invalidateQueries({ queryKey: ['deliveries', dispatchId] });
    onChanged();
  };

  const dispatchMutation = useMutation({
    mutationFn: () => dispatchOut(dispatchId),
    onSuccess: invalidate,
  });
  const inTransitMutation = useMutation({
    mutationFn: () => markInTransit(dispatchId),
    onSuccess: invalidate,
  });
  const cancelMutation = useMutation({
    mutationFn: () => cancelDispatch(dispatchId),
    onSuccess: invalidate,
  });
  const failMutation = useMutation({
    mutationFn: () => failDispatch(dispatchId, failNotes),
    onSuccess: () => {
      setFailReasonOpen(false);
      setFailNotes('');
      invalidate();
    },
  });

  if (isLoading || !dispatch) {
    return (
      <Dialog open onOpenChange={onOpenChange}>
        <DialogHeader>
          <DialogTitle>Dispatch</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">Loading…</p>
      </Dialog>
    );
  }

  const associatedDistributor = (networkData?.items ?? []).find(
    (relationship) => relationship.targetCustomer.id === dispatch.customer.id,
  );

  const canCancel =
    dispatch.status === 'READY' ||
    dispatch.status === 'DISPATCHED' ||
    dispatch.status === 'IN_TRANSIT';
  const canFail = dispatch.status === 'DISPATCHED' || dispatch.status === 'IN_TRANSIT';
  const canDeliver =
    dispatch.status === 'DISPATCHED' ||
    dispatch.status === 'IN_TRANSIT' ||
    dispatch.status === 'PARTIALLY_DELIVERED';

  return (
    <>
      <Dialog open onOpenChange={onOpenChange}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {dispatch.dispatchCode}
            <Badge variant={DISPATCH_STATUS_VARIANT[dispatch.status]}>
              {DISPATCH_STATUS_LABELS[dispatch.status]}
            </Badge>
          </DialogTitle>
        </DialogHeader>
        <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1 text-sm">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-muted-foreground">Customer</p>
              <p>{dispatch.customer.customerName}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Destination Outlet</p>
              <p>{dispatch.outlet?.name ?? '— (order default)'}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Sales Order</p>
              <p className="font-mono text-xs">{dispatch.salesOrder.orderCode}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Source Location</p>
              <p>{dispatch.sourceLocation.name}</p>
            </div>
          </div>

          <div className="rounded-md border border-dashed border-border p-3 text-xs">
            <p className="font-medium text-muted-foreground">Associated Distributor</p>
            <p className="mt-1">
              {associatedDistributor
                ? `${associatedDistributor.sourceCustomer.customerName} (informational only — never a gate on dispatch or delivery)`
                : 'None on record — this customer buys directly.'}
            </p>
          </div>

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/50 text-left">
                <tr>
                  <th className="px-3 py-2 font-medium">Product</th>
                  <th className="px-3 py-2 font-medium">Dispatched</th>
                  <th className="px-3 py-2 font-medium">Delivered</th>
                </tr>
              </thead>
              <tbody>
                {dispatch.items.map((item) => (
                  <tr key={item.id} className="border-b border-border last:border-0">
                    <td className="px-3 py-2">{item.product.name}</td>
                    <td className="px-3 py-2">
                      {item.quantityDispatched} {item.product.unit}
                    </td>
                    <td className="px-3 py-2">
                      {item.quantityDelivered} / {item.quantityDispatched}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {(deliveriesData?.items.length ?? 0) > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Delivery History</p>
              <div className="space-y-2">
                {deliveriesData!.items.map((delivery) => (
                  <div key={delivery.id} className="rounded-md border border-border p-2 text-xs">
                    <div className="flex justify-between text-muted-foreground">
                      <span>
                        {new Date(delivery.deliveryDate).toLocaleDateString()}
                        {delivery.receivedByName ? ` — Received by ${delivery.receivedByName}` : ''}
                      </span>
                    </div>
                    <div className="mt-1 space-y-0.5">
                      {delivery.items.map((item) => (
                        <div key={item.id} className="flex justify-between">
                          <span>{item.product.name}</span>
                          <span className="font-medium text-foreground">
                            {item.quantityDelivered} {item.product.unit}
                          </span>
                        </div>
                      ))}
                    </div>
                    {delivery.notes && <p className="mt-1 text-foreground">{delivery.notes}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {failReasonOpen && (
            <div className="space-y-1.5 rounded-md border border-destructive/40 p-3">
              <p className="text-xs font-medium text-muted-foreground">
                Why did this dispatch fail?
              </p>
              <Textarea
                rows={2}
                value={failNotes}
                onChange={(event) => setFailNotes(event.target.value)}
                placeholder="e.g. vehicle breakdown, customer refused all goods"
              />
            </div>
          )}

          {(dispatchMutation.isError ||
            inTransitMutation.isError ||
            cancelMutation.isError ||
            failMutation.isError) && (
            <p className="text-sm text-destructive">
              {[dispatchMutation, inTransitMutation, cancelMutation, failMutation]
                .map((m) => (m.error instanceof ApiError ? m.error.message : undefined))
                .find(Boolean) ?? 'That action could not be completed.'}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          {canCancel && !failReasonOpen && (
            <Button
              type="button"
              variant="outline"
              onClick={() => cancelMutation.mutate()}
              disabled={cancelMutation.isPending}
            >
              {cancelMutation.isPending ? 'Cancelling…' : 'Cancel Dispatch'}
            </Button>
          )}
          {canFail && !failReasonOpen && (
            <Button type="button" variant="outline" onClick={() => setFailReasonOpen(true)}>
              Mark Failed
            </Button>
          )}
          {failReasonOpen && (
            <>
              <Button type="button" variant="outline" onClick={() => setFailReasonOpen(false)}>
                Back
              </Button>
              <Button
                type="button"
                onClick={() => failMutation.mutate()}
                disabled={!failNotes.trim() || failMutation.isPending}
              >
                {failMutation.isPending ? 'Saving…' : 'Confirm Failed'}
              </Button>
            </>
          )}
          {dispatch.status === 'READY' && !failReasonOpen && (
            <Button
              type="button"
              onClick={() => dispatchMutation.mutate()}
              disabled={dispatchMutation.isPending}
            >
              {dispatchMutation.isPending ? 'Dispatching…' : 'Dispatch'}
            </Button>
          )}
          {dispatch.status === 'DISPATCHED' && !failReasonOpen && (
            <Button
              type="button"
              onClick={() => inTransitMutation.mutate()}
              disabled={inTransitMutation.isPending}
            >
              {inTransitMutation.isPending ? 'Updating…' : 'Mark In Transit'}
            </Button>
          )}
          {canDeliver && !failReasonOpen && (
            <Button type="button" onClick={() => setDeliveryOpen(true)}>
              Record Delivery
            </Button>
          )}
        </DialogFooter>
      </Dialog>

      {deliveryOpen && (
        <DeliveryDialog
          dispatch={dispatch}
          onOpenChange={setDeliveryOpen}
          onDelivered={() => {
            invalidate();
            setDeliveryOpen(false);
          }}
        />
      )}
    </>
  );
}
