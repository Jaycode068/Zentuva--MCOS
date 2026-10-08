'use client';

import { useQuery } from '@tanstack/react-query';
import { Badge } from '@zentuva/ui';

import { D2cTabs } from '@/components/app/d2c-tabs';
import { ApiError } from '@/lib/api-client';

import { getD2CAttention, type D2CAttentionItem } from '../api';

const ATTENTION_TYPE_LABELS: Record<string, string> = {
  UNASSIGNED_ORDER: 'Unassigned order',
  FAILED_PAYMENT: 'Failed payment',
  STALE_PENDING_PAYMENT: 'Payment pending too long',
  STUCK_FULFILLMENT: 'Stuck fulfilment',
  STUCK_READY_FOR_COLLECTION: 'Ready too long, not collected',
  DISABLED_COLLECTION_POINT_WITH_QUEUE: 'Disabled Collection Point with a queue',
  NOTIFICATION_FAILED: 'Notification failed',
};

const ENTITY_LINK: Record<string, (id: string) => string> = {
  SalesOrder: (id) => `/settings/d2c/orders/${id}`,
  CollectionPointFulfillment: (id) => `/settings/d2c/orders/${id}`,
  Outlet: () => `/settings/d2c/collection-points`,
  ConsumerWhatsAppDelivery: () => `/settings/d2c/exceptions`,
};

const AVAILABLE_ACTION: Record<string, string> = {
  UNASSIGNED_ORDER: 'Assign a Collection Point',
  FAILED_PAYMENT: 'Review payment',
  STALE_PENDING_PAYMENT: 'Check payment status',
  STUCK_FULFILLMENT: 'Open order',
  STUCK_READY_FOR_COLLECTION: 'Follow up with consumer',
  DISABLED_COLLECTION_POINT_WITH_QUEUE: 'Reassign queued orders',
  NOTIFICATION_FAILED: 'Retry notification from order detail',
};

const SEVERITY_BADGE_VARIANT: Record<string, 'destructive' | 'default'> = {
  HIGH: 'destructive',
  MEDIUM: 'default',
  LOW: 'default',
};

const SEVERITY_ORDER: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

/**
 * Sprint 43 — D2C Operations, Notifications & Production Hardening
 * (docs/domains/d2c.md "Operational Exceptions"). The standalone, full-page view of
 * the EXACT SAME `GET /d2c/admin/attention` list the dashboard's "Attention Required"
 * section already showed inline (Sprint 39) — this page adds no new backend endpoint,
 * only the "view all" surface that was previously missing (the dashboard had no
 * complete list, only the first several items with no pagination/filter). Never a
 * persisted Exception entity — every row here is computed live.
 */
export default function D2CExceptionsPage() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['d2c-admin-attention'],
    queryFn: getD2CAttention,
    refetchInterval: 60000,
  });

  const items = [...(data?.items ?? [])].sort(
    (a, b) => (SEVERITY_ORDER[a.severity] ?? 99) - (SEVERITY_ORDER[b.severity] ?? 99),
  );

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">D2C Operations</h1>
        <p className="text-sm text-muted-foreground">
          Every operational exception detected right now, across orders, Collection Points,
          payments, and consumer notifications — most severe first.
        </p>
      </div>

      <D2cTabs />

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {isError && (
        <div className="space-y-2">
          <p className="text-sm text-destructive">
            {error instanceof ApiError ? error.message : 'Failed to load exceptions.'}
          </p>
          <button className="text-sm text-primary underline" onClick={() => refetch()}>
            Retry
          </button>
        </div>
      )}

      {data && (
        <section className="rounded-lg border border-border">
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold">
              {items.length} exception{items.length === 1 ? '' : 's'}
            </h2>
          </div>
          {items.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">
              Nothing needs attention right now.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2">Severity</th>
                    <th className="px-4 py-2">Issue</th>
                    <th className="px-4 py-2">Order</th>
                    <th className="px-4 py-2">Consumer</th>
                    <th className="px-4 py-2">Territory</th>
                    <th className="px-4 py-2">Collection Point</th>
                    <th className="px-4 py-2">Detected</th>
                    <th className="px-4 py-2">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {items.map((item, i) => (
                    <ExceptionRow key={`${item.entityType}-${item.entityId}-${i}`} item={item} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function ExceptionRow({ item }: { item: D2CAttentionItem }) {
  const href = ENTITY_LINK[item.entityType]?.(item.entityId) ?? '#';
  return (
    <tr className="hover:bg-muted/50">
      <td className="px-4 py-3">
        <Badge variant={SEVERITY_BADGE_VARIANT[item.severity] ?? 'default'}>{item.severity}</Badge>
      </td>
      <td className="px-4 py-3">
        <p className="font-medium">{ATTENTION_TYPE_LABELS[item.type] ?? item.type}</p>
        <p className="text-xs text-muted-foreground">{item.message}</p>
      </td>
      <td className="px-4 py-3">{item.orderCode ?? '—'}</td>
      <td className="px-4 py-3">{item.consumerName ?? '—'}</td>
      <td className="px-4 py-3">{item.territoryName ?? '—'}</td>
      <td className="px-4 py-3">{item.collectionPointName ?? '—'}</td>
      <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
        {new Date(item.detectedAt).toLocaleString()}
      </td>
      <td className="px-4 py-3">
        <a href={href} className="text-primary hover:underline">
          {AVAILABLE_ACTION[item.type] ?? 'View'}
        </a>
      </td>
    </tr>
  );
}
