'use client';

import { useQuery } from '@tanstack/react-query';
import { Badge } from '@zentuva/ui';

import { D2cTabs } from '@/components/app/d2c-tabs';
import { ApiError } from '@/lib/api-client';

import { getD2CAdminOverview } from './api';

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

const SEVERITY_BADGE_VARIANT: Record<string, 'destructive' | 'default'> = {
  HIGH: 'destructive',
  MEDIUM: 'default',
  LOW: 'default',
};

/**
 * Sprint 39 — D2C Sales Administration & Operations Dashboard
 * (docs/domains/d2c.md). The admin landing page over the whole D2C chain
 * (Consumer -> Conversation -> SalesOrder -> Payment -> CollectionPoint ->
 * FieldOps -> Inventory -> Collection) — summary cards plus an Attention
 * Required section, both derived live from `GET /d2c/admin/overview`
 * (`D2CAdminService`), never a cached/precomputed snapshot.
 */
export default function D2CAdminDashboardPage() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['d2c-admin-overview'],
    queryFn: getD2CAdminOverview,
    refetchInterval: 60000,
  });

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">D2C Operations</h1>
        <p className="text-sm text-muted-foreground">
          Direct-to-consumer sales administration — consumers, orders, payments, and Collection
          Point fulfilment in one view.
        </p>
      </div>

      <D2cTabs />

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {isError && (
        <div className="space-y-2">
          <p className="text-sm text-destructive">
            {error instanceof ApiError ? error.message : 'Failed to load the D2C dashboard.'}
          </p>
          <button className="text-sm text-primary underline" onClick={() => refetch()}>
            Retry
          </button>
        </div>
      )}

      {data && (
        <>
          <DashboardSection title="Orders">
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
              <StatCard label="D2C Orders" value={data.summary.totalD2COrders} />
              <StatCard label="Orders Today" value={data.summary.ordersToday} />
              <StatCard label="Preparing" value={data.summary.ordersPreparing} />
              <StatCard
                label="Ready for Collection"
                value={data.summary.ordersReadyForCollection}
              />
              <StatCard label="Collected Today" value={data.summary.ordersCollectedToday} />
              <StatCard
                label="Exceptions"
                value={data.summary.exceptionsCount}
                tone={data.summary.exceptionsCount > 0 ? 'destructive' : undefined}
              />
            </div>
          </DashboardSection>

          <DashboardSection title="Collection Points">
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
              <StatCard
                label="Active Collection Points"
                value={data.summary.activeCollectionPoints}
              />
              <StatCard label="Orders Awaiting Preparation" value={data.summary.ordersPreparing} />
              <StatCard label="Orders Ready" value={data.summary.ordersReadyForCollection} />
              <StatCard
                label="Unassigned Orders"
                value={data.summary.unassignedOrders}
                tone={data.summary.unassignedOrders > 0 ? 'destructive' : undefined}
              />
            </div>
          </DashboardSection>

          <DashboardSection title="Consumers">
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
              <StatCard label="Consumers" value={data.summary.consumersTotal} />
              <StatCard label="Active Consumers" value={data.summary.activeConsumers} />
              <StatCard label="New Today" value={data.summary.newConsumersToday} />
            </div>
          </DashboardSection>

          <DashboardSection title="Communications">
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
              <StatCard label="WhatsApp Sent Today" value={data.summary.whatsappSentToday} />
              <StatCard
                label="WhatsApp Failed Today"
                value={data.summary.whatsappFailedToday}
                tone={data.summary.whatsappFailedToday > 0 ? 'destructive' : undefined}
              />
              <StatCard
                label="Awaiting Retry"
                value={data.summary.whatsappEligibleForRetry}
                tone={data.summary.whatsappEligibleForRetry > 0 ? 'warning' : undefined}
              />
            </div>
          </DashboardSection>

          <DashboardSection title="Payments">
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
              <StatCard
                label="Pending Payments"
                value={data.summary.pendingPayments}
                tone={data.summary.pendingPayments > 0 ? 'warning' : undefined}
              />
              <StatCard
                label="Failed Payments"
                value={data.summary.failedPayments}
                tone={data.summary.failedPayments > 0 ? 'destructive' : undefined}
              />
            </div>
          </DashboardSection>

          <section className="rounded-lg border border-border">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h2 className="text-sm font-semibold">
                Attention Required {data.attention.length > 0 && `(${data.attention.length})`}
              </h2>
              <a href="/settings/d2c/exceptions" className="text-sm text-primary hover:underline">
                View all
              </a>
            </div>
            {data.attention.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted-foreground">
                Nothing needs attention right now.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {data.attention.slice(0, 10).map((item, i) => (
                  <li key={`${item.entityType}-${item.entityId}-${i}`} className="px-4 py-3">
                    <a
                      href={ENTITY_LINK[item.entityType]?.(item.entityId) ?? '#'}
                      className="flex items-center justify-between gap-4 hover:underline"
                    >
                      <span className="text-sm">{item.message}</span>
                      <div className="flex items-center gap-2">
                        <Badge variant={SEVERITY_BADGE_VARIANT[item.severity] ?? 'default'}>
                          {item.severity}
                        </Badge>
                        <Badge
                          variant={item.category === 'ACTION_REQUIRED' ? 'destructive' : 'default'}
                        >
                          {ATTENTION_TYPE_LABELS[item.type] ?? item.type}
                        </Badge>
                      </div>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-lg border border-border">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h2 className="text-sm font-semibold">Recent D2C Orders</h2>
              <a href="/settings/d2c/orders" className="text-sm text-primary hover:underline">
                View all
              </a>
            </div>
            {data.recentOrders.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted-foreground">No D2C orders yet.</p>
            ) : (
              <ul className="divide-y divide-border">
                {data.recentOrders.map((order) => (
                  <li key={order.id}>
                    <a
                      href={`/settings/d2c/orders/${order.id}`}
                      className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-muted/50"
                    >
                      <div>
                        <p className="font-medium">{order.orderCode}</p>
                        <p className="text-sm text-muted-foreground">
                          {order.consumerName ?? 'No consumer on record'} ·{' '}
                          {new Date(order.orderDate).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-medium">{order.total.toLocaleString()}</p>
                        <Badge>{order.status.replace(/_/g, ' ')}</Badge>
                      </div>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

/** Added Sprint 43 — groups the dashboard's StatCards under the brief's own named
 *  sections (Orders/Collection Points/Consumers/Communications/Payments) rather than
 *  one undifferentiated grid — an operational dashboard, not a report. */
function DashboardSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
      {children}
    </div>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: 'warning' | 'destructive';
}) {
  return (
    <div className="rounded-lg border border-border p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p
        className={
          tone === 'destructive'
            ? 'mt-1 text-2xl font-semibold text-destructive'
            : tone === 'warning'
              ? 'mt-1 text-2xl font-semibold text-yellow-600 dark:text-yellow-400'
              : 'mt-1 text-2xl font-semibold'
        }
      >
        {value}
      </p>
    </div>
  );
}
