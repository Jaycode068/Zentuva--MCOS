'use client';

import { useQuery } from '@tanstack/react-query';
import { Badge } from '@zentuva/ui';

import { listFieldD2CCollectionPoints, listFieldD2COrders } from './api';

/**
 * Sprint 38 — Field Operations & Collection Point Mobile Experience
 * (docs/domains/d2c.md). A Sales Representative's own territory-scoped D2C overview —
 * "what's happening with D2C orders and Collection Points in MY territory, and where
 * do I need to pay attention." Read-only: no mutation lives here, the actual
 * fulfilment actions remain the Collection Point representative's own screen
 * (`/field/collection-point`) — this page exists so a Sales Rep can MONITOR and
 * intervene (e.g. call a Collection Point rep, flag a stuck order to an admin), not
 * operate the queue themselves. Territory scoping is enforced entirely server-side
 * (`FieldD2COverviewService`) — this page never filters by territory itself, it only
 * ever renders what the backend already decided this user may see.
 */
export default function FieldD2COverviewPage() {
  const { data: ordersData, isLoading: ordersLoading } = useQuery({
    queryKey: ['field-d2c-orders'],
    queryFn: listFieldD2COrders,
    refetchInterval: 30000,
  });
  const orders = ordersData?.items ?? [];

  const { data: cpData, isLoading: cpLoading } = useQuery({
    queryKey: ['field-d2c-collection-points'],
    queryFn: listFieldD2CCollectionPoints,
    refetchInterval: 30000,
  });
  const collectionPoints = cpData?.items ?? [];

  const unassigned = orders.filter((order) => !order.collectionPoint);
  const shortOnStaff = collectionPoints.filter(
    (cp) => cp.collectionPointStatus === 'DISABLED' && cp.ordersAwaitingFulfilment > 0,
  );
  const attentionCount = unassigned.length + shortOnStaff.length;

  const isLoading = ordersLoading || cpLoading;

  return (
    <div className="flex h-full flex-col gap-5 overflow-y-auto p-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">D2C Activity</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">Your territory</p>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : orders.length === 0 && collectionPoints.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No D2C orders or Collection Points in your territory yet.
        </p>
      ) : (
        <>
          {attentionCount > 0 && (
            <section className="rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-3">
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-yellow-700 dark:text-yellow-400">
                Needs Attention
              </h2>
              <ul className="space-y-1 text-sm">
                {unassigned.length > 0 && (
                  <li>
                    {unassigned.length} order{unassigned.length === 1 ? '' : 's'} without a
                    Collection Point assigned
                  </li>
                )}
                {shortOnStaff.map((cp) => (
                  <li key={cp.outletId}>
                    {cp.outletName} is disabled with {cp.ordersAwaitingFulfilment} order
                    {cp.ordersAwaitingFulfilment === 1 ? '' : 's'} still queued
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              D2C Orders ({orders.length})
            </h2>
            {orders.length === 0 ? (
              <p className="text-sm text-muted-foreground">No D2C orders yet.</p>
            ) : (
              <div className="space-y-2">
                {orders.map((order) => (
                  <div key={order.id} className="rounded-md border border-border p-3">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{order.orderCode}</span>
                      <Badge variant="default">{order.status.replace(/_/g, ' ')}</Badge>
                    </div>
                    {order.consumer && (
                      <p className="text-sm text-muted-foreground">
                        {order.consumer.name}
                        {order.consumer.territoryName ? ` · ${order.consumer.territoryName}` : ''}
                      </p>
                    )}
                    {order.collectionPoint ? (
                      <p className="mt-1 text-sm">
                        {order.collectionPoint.outletName} ·{' '}
                        <span className="text-muted-foreground">
                          {order.collectionPoint.fulfillmentStatus.replace(/_/g, ' ')}
                        </span>
                      </p>
                    ) : (
                      <p className="mt-1 text-sm text-muted-foreground">No Collection Point yet</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Collection Points ({collectionPoints.length})
            </h2>
            {collectionPoints.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No Collection Points in your territory.
              </p>
            ) : (
              <div className="space-y-2">
                {collectionPoints.map((cp) => (
                  <div key={cp.outletId} className="rounded-md border border-border p-3">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{cp.outletName}</span>
                      <Badge
                        variant={cp.collectionPointStatus === 'ENABLED' ? 'success' : 'default'}
                      >
                        {cp.collectionPointStatus}
                      </Badge>
                    </div>
                    {cp.territoryName && (
                      <p className="text-sm text-muted-foreground">{cp.territoryName}</p>
                    )}
                    {cp.operatingHours && (
                      <p className="text-sm text-muted-foreground">{cp.operatingHours}</p>
                    )}
                    <p className="mt-1 text-sm">
                      {cp.ordersAwaitingFulfilment} awaiting · {cp.ordersReadyForCollection} ready
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
