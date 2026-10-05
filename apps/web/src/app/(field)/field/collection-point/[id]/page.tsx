'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button } from '@zentuva/ui';

import { FieldStickyActionBar } from '@/components/field/FieldStickyActionBar';
import { ApiError } from '@/lib/api-client';

import {
  confirmCollection,
  getCollectionPointFulfillment,
  markReadyForCollection,
  startPreparing,
} from '../api';

/**
 * Sprint 38 — Field Operations & Collection Point Mobile Experience
 * (docs/domains/d2c.md). The order detail a Collection Point representative opens from
 * the queue (brief §7 "ORDER DETAIL") — consumer contact, items, payment/order status,
 * timestamps, and exactly the ONE action valid for the order's CURRENT state. The
 * backend remains the sole authority on which action is valid; this page only ever
 * shows the single next step `CollectionPointFulfillmentStatus` implies, never lets the
 * user pick an arbitrary transition.
 */
export default function CollectionPointOrderDetailPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);

  const { data: order, isLoading } = useQuery({
    queryKey: ['collection-point-fulfillment', id],
    queryFn: () => getCollectionPointFulfillment(id),
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['collection-point-fulfillment', id] });
    queryClient.invalidateQueries({ queryKey: ['collection-point-queue'] });
    queryClient.invalidateQueries({ queryKey: ['collection-point-inventory'] });
  }

  const prepareMutation = useMutation({ mutationFn: startPreparing, onSuccess: invalidate });
  const readyMutation = useMutation({ mutationFn: markReadyForCollection, onSuccess: invalidate });
  const collectMutation = useMutation({
    mutationFn: confirmCollection,
    onSuccess: () => {
      setConfirming(false);
      invalidate();
    },
  });

  const actionError =
    prepareMutation.error instanceof ApiError
      ? prepareMutation.error.message
      : readyMutation.error instanceof ApiError
        ? readyMutation.error.message
        : collectMutation.error instanceof ApiError
          ? collectMutation.error.message
          : undefined;

  if (isLoading) {
    return <p className="p-4 text-sm text-muted-foreground">Loading…</p>;
  }

  // Sprint 38 (brief §17 "Unauthorized order" / "stale order state") — a 404 (not
  // authorized, cross-tenant, or genuinely not found) renders the same simple
  // not-found message rather than leaking which case it was.
  if (!order) {
    return (
      <div className="p-4">
        <p className="text-sm text-muted-foreground">
          This order could not be found, or you&apos;re not authorized to view it.
        </p>
        <Link href="/field/collection-point" className="mt-3 inline-block text-sm text-primary">
          ← Back to Collection Point
        </Link>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-5 overflow-y-auto p-4 pb-4">
        <div>
          <Link href="/field/collection-point" className="text-sm text-primary">
            ← Collection Point
          </Link>
          <div className="mt-2 flex items-center justify-between">
            <h1 className="text-xl font-semibold tracking-tight">Order {order.orderReference}</h1>
            <Badge variant="default">{order.status.replace(/_/g, ' ')}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">{order.outletName}</p>
        </div>

        {actionError && (
          <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{actionError}</p>
        )}

        <section className="rounded-lg border border-border p-3">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Consumer
          </h2>
          {order.consumer ? (
            <div className="space-y-0.5 text-sm">
              <p className="font-medium">{order.consumer.name}</p>
              {/* Sprint 38 (brief §16 "Consumer Contact") — the consumer's phone is
                  surfaced here because it is operationally necessary: the rep may need
                  to call/WhatsApp the consumer about their ready order. No new
                  messaging system — this is a plain, read-only phone number, the exact
                  field the existing Consumer/Order detail already exposes elsewhere. */}
              <p className="text-muted-foreground">{order.consumer.phoneNumber}</p>
              {order.consumer.territoryName && (
                <p className="text-muted-foreground">{order.consumer.territoryName}</p>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No consumer on record.</p>
          )}
        </section>

        <section className="rounded-lg border border-border p-3">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Items
          </h2>
          <ul className="space-y-1 text-sm">
            {order.items.map((line, i) => (
              <li key={i} className="flex justify-between">
                <span>{line.productName}</span>
                <span className="text-muted-foreground">
                  {line.quantity} {line.unit}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex justify-between border-t border-border pt-2 text-sm font-medium">
            <span>Total</span>
            <span>{order.total.toFixed(2)}</span>
          </div>
        </section>

        <section className="rounded-lg border border-border p-3">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Status
          </h2>
          <dl className="space-y-1 text-sm">
            <Row label="Order status" value={order.salesOrderStatus} />
            <Row label="Payment" value={order.paymentStatus ?? '—'} />
            <Row label="Ordered" value={new Date(order.orderDate).toLocaleString()} />
            <Row label="Assigned" value={new Date(order.assignedAt).toLocaleString()} />
            {order.preparingAt && (
              <Row label="Preparing since" value={new Date(order.preparingAt).toLocaleString()} />
            )}
            {order.readyAt && (
              <Row label="Ready since" value={new Date(order.readyAt).toLocaleString()} />
            )}
            {order.collectedAt && (
              <Row label="Collected" value={new Date(order.collectedAt).toLocaleString()} />
            )}
          </dl>
        </section>
      </div>

      {/* Sprint 38 — only the ONE action valid for the current status is ever shown;
          the backend's own guarded state machine (Sprint 37) is still what actually
          enforces this, this is purely a display choice mirroring it. */}
      {order.status === 'ASSIGNED' && (
        <FieldStickyActionBar>
          <Button
            className="h-12 flex-1"
            onClick={() => prepareMutation.mutate(order.id)}
            disabled={prepareMutation.isPending}
          >
            {prepareMutation.isPending ? 'Working…' : 'Start Preparing'}
          </Button>
        </FieldStickyActionBar>
      )}
      {order.status === 'PREPARING' && (
        <FieldStickyActionBar>
          <Button
            className="h-12 flex-1"
            onClick={() => readyMutation.mutate(order.id)}
            disabled={readyMutation.isPending}
          >
            {readyMutation.isPending ? 'Working…' : 'Mark Ready for Collection'}
          </Button>
        </FieldStickyActionBar>
      )}
      {order.status === 'READY_FOR_COLLECTION' && (
        <FieldStickyActionBar>
          <Button className="h-12 flex-1" onClick={() => setConfirming(true)}>
            Confirm Collection
          </Button>
        </FieldStickyActionBar>
      )}

      {confirming && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center">
          <div className="w-full max-w-sm rounded-t-xl bg-background p-4 shadow-lg sm:rounded-xl">
            <h2 className="text-base font-semibold">Confirm Collection?</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Order {order.orderReference} will be marked collected and stock will be deducted. This
              cannot be undone.
            </p>
            <div className="mt-4 flex gap-2">
              <Button
                variant="outline"
                className="h-11 flex-1"
                onClick={() => setConfirming(false)}
                disabled={collectMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                className="h-11 flex-1"
                onClick={() => collectMutation.mutate(order.id)}
                disabled={collectMutation.isPending}
              >
                {collectMutation.isPending ? 'Confirming…' : 'Confirm'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}
