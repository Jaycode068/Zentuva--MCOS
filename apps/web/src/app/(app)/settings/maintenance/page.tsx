'use client';

import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@zentuva/ui';

import { MaintenanceTabs } from '@/components/app/maintenance-tabs';
import { ApiError } from '@/lib/api-client';
import { formatCurrency } from '@/lib/format-currency';

import { getMaintenanceOverview } from './api';

/**
 * Maintenance Overview (Sprint 21, docs/domains/maintenance.md) — a
 * lightweight operational dashboard, deliberately not an intelligence/
 * analytics layer (brief's own explicit non-goal). Every figure is a
 * plain read aggregate, computed live, never stored.
 */
export default function MaintenanceOverviewPage() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['maintenance-overview'],
    queryFn: () => getMaintenanceOverview(),
  });

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Maintenance</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          What needs attention, what&apos;s in progress, and what broke down.
        </p>
      </div>

      <MaintenanceTabs />

      {isLoading && (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading overview…</p>
      )}
      {isError && (
        <p className="py-10 text-center text-sm text-destructive">
          {error instanceof ApiError ? error.message : 'Failed to load overview.'}
        </p>
      )}

      {data && (
        <>
          <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <SummaryCard title="Open Requests" value={String(data.openRequests)} />
            <SummaryCard title="Open Work Orders" value={String(data.openWorkOrders)} />
            <SummaryCard title="In Progress" value={String(data.inProgress)} />
            <SummaryCard
              title="Critical Work Orders"
              value={String(data.criticalWorkOrders)}
              destructive={data.criticalWorkOrders > 0}
            />
            <SummaryCard
              title="Overdue Preventive"
              value={String(data.overduePreventive)}
              destructive={data.overduePreventive > 0}
            />
            <SummaryCard title="Due Soon (7 days)" value={String(data.dueSoonPreventive)} />
            <SummaryCard
              title="Assets Under Maintenance"
              value={String(data.assetsUnderMaintenance)}
            />
            <SummaryCard
              title="Unplanned Breakdowns (Month)"
              value={String(data.unplannedBreakdownsThisMonth)}
            />
          </div>

          <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <SummaryCard
              title="Downtime This Month"
              value={`${Math.round(data.downtimeMinutesThisMonth / 60)}h ${data.downtimeMinutesThisMonth % 60}m`}
            />
            <SummaryCard
              title="Maintenance Cost This Month"
              value={formatCurrency(data.maintenanceCostThisMonth, 'NGN')}
            />
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Work Orders by Status
                </CardTitle>
              </CardHeader>
              <CardContent>
                {Object.keys(data.workOrdersByStatus).length === 0 ? (
                  <p className="text-sm text-muted-foreground">No work orders yet.</p>
                ) : (
                  <ul className="space-y-1 text-sm">
                    {Object.entries(data.workOrdersByStatus).map(([status, count]) => (
                      <li key={status} className="flex items-center justify-between">
                        <span>{status.replace('_', ' ')}</span>
                        <span className="text-muted-foreground">{count}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Work Orders by Type
                </CardTitle>
              </CardHeader>
              <CardContent>
                {data.workOrdersByType.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No work orders yet.</p>
                ) : (
                  <ul className="space-y-1 text-sm">
                    {data.workOrdersByType.map((row) => (
                      <li key={row.maintenanceTypeId} className="flex items-center justify-between">
                        <span>{row.name}</span>
                        <span className="text-muted-foreground">{row.count}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </main>
  );
}

function SummaryCard({
  title,
  value,
  destructive,
}: {
  title: string;
  value: string;
  destructive?: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xs font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className={`text-lg font-semibold ${destructive ? 'text-destructive' : ''}`}>{value}</p>
      </CardContent>
    </Card>
  );
}
