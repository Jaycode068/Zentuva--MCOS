'use client';

import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@zentuva/ui';

import { AccessTabs } from '@/components/app/access-tabs';
import { ApiError } from '@/lib/api-client';

import { getAccessOverview } from './api';

/**
 * Access Control Overview (Sprint 25, docs/domains/access-control.md) — plain read
 * aggregates over Roles/UserRole, computed live, never stored.
 */
export default function AccessOverviewPage() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['access-overview'],
    queryFn: () => getAccessOverview(),
  });

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Access Control</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure who can view, create, edit, approve, complete, or administer records across
          Zentuva.
        </p>
      </div>

      <AccessTabs />

      {isLoading && (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading overview…</p>
      )}
      {isError && (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <p className="text-sm text-destructive">
            {error instanceof ApiError ? error.message : 'Failed to load overview.'}
          </p>
          <button
            type="button"
            onClick={() => refetch()}
            className="rounded-md border border-border px-4 py-2 text-sm font-medium"
          >
            Retry
          </button>
        </div>
      )}

      {data && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <SummaryCard title="Total Roles" value={String(data.totalRoles)} />
          <SummaryCard title="Active Roles" value={String(data.activeRoles)} />
          <SummaryCard title="Archived Roles" value={String(data.archivedRoles)} />
          <SummaryCard title="Custom Roles" value={String(data.customRoles)} />
          <SummaryCard title="Total Users" value={String(data.totalUsers)} />
          <SummaryCard
            title="Users Without Any Role"
            value={String(data.usersWithoutAnyRole)}
            destructive={data.usersWithoutAnyRole > 0}
          />
          <SummaryCard
            title="Users With Multiple Roles"
            value={String(data.usersWithMultipleRoles)}
          />
          <SummaryCard title="System Roles" value={String(data.systemRoles)} />
        </div>
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
