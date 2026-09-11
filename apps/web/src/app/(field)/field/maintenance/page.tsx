'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@zentuva/ui';

import { getAccountProfile } from '@/lib/account';
import { FieldCard } from '@/components/field/FieldCard';

import { listWorkOrders, type WorkOrder } from '../api';
import { MAINTENANCE_PRIORITY_LABELS, MAINTENANCE_PRIORITY_VARIANT } from '../labels';

const OPEN_STATUSES = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD'] as const;

/**
 * Field Technician Maintenance Home (Sprint 22, docs/domains/
 * maintenance-integration.md "Field Technician Experience") — the exact
 * `FieldDeliveriesPage`/`FieldHomePage` card-list convention, applied to a
 * technician's own assigned Work Orders. No new Technician role exists
 * (decision unchanged since Sprint 21) — "my work orders" is simply every
 * `WorkOrder` where `assignedToId` equals the signed-in user's own id, the
 * same `assignedToId` convention Admin already uses.
 */
export default function FieldMaintenanceHomePage() {
  const { data: profile } = useQuery({
    queryKey: ['account', 'profile'],
    queryFn: getAccountProfile,
  });
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['work-orders', 'field', profile?.id],
    queryFn: () => listWorkOrders({ assignedToId: profile!.id }),
    enabled: !!profile?.id,
  });

  const sections = useMemo(() => {
    const now = new Date();
    const today = now.toDateString();
    const items = (data?.items ?? []).filter(
      (wo) => wo.status !== 'COMPLETED' && wo.status !== 'CANCELLED',
    );
    const overdue = items.filter(
      (wo) =>
        (OPEN_STATUSES as readonly string[]).includes(wo.status) &&
        wo.plannedEndAt &&
        new Date(wo.plannedEndAt) < now,
    );
    const inProgress = items.filter((wo) => wo.status === 'IN_PROGRESS' && !overdue.includes(wo));
    const remaining = items.filter((wo) => !overdue.includes(wo) && !inProgress.includes(wo));
    const todays = remaining.filter(
      (wo) => wo.plannedStartAt && new Date(wo.plannedStartAt).toDateString() === today,
    );
    const upcoming = remaining.filter((wo) => !todays.includes(wo));
    return { overdue, inProgress, todays, upcoming };
  }, [data]);

  return (
    <div className="space-y-6 p-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">My Work Orders</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {isLoading
            ? 'Loading…'
            : `${sections.overdue.length + sections.inProgress.length + sections.todays.length + sections.upcoming.length} open work order(s)`}
        </p>
      </div>

      {isLoading && <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>}

      {isError && (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <p className="text-sm text-destructive">
            {error instanceof Error ? error.message : 'Failed to load your work orders.'}
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

      {!isLoading && !isError && (
        <>
          <WorkOrderSection title="Overdue" items={sections.overdue} emphasize />
          <WorkOrderSection title="In Progress" items={sections.inProgress} />
          <WorkOrderSection title="Today" items={sections.todays} />
          <WorkOrderSection title="Upcoming" items={sections.upcoming} />
          {sections.overdue.length === 0 &&
            sections.inProgress.length === 0 &&
            sections.todays.length === 0 &&
            sections.upcoming.length === 0 && (
              <p className="py-10 text-center text-sm text-muted-foreground">
                No work orders assigned to you right now.
              </p>
            )}
        </>
      )}
    </div>
  );
}

function WorkOrderSection({
  title,
  items,
  emphasize,
}: {
  title: string;
  items: WorkOrder[];
  emphasize?: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <section>
      <h2
        className={`mb-2 text-sm font-semibold ${emphasize ? 'text-destructive' : 'text-foreground'}`}
      >
        {title} ({items.length})
      </h2>
      <div className="space-y-2">
        {items.map((wo) => (
          <FieldCard key={wo.id} href={`/field/maintenance/${wo.id}`}>
            <div className="flex items-center justify-between gap-2">
              <p className="min-w-0 flex-1 truncate font-medium">{wo.title}</p>
              <Badge variant={MAINTENANCE_PRIORITY_VARIANT[wo.priority]}>
                {MAINTENANCE_PRIORITY_LABELS[wo.priority]}
              </Badge>
            </div>
            <p className="mt-0.5 font-mono text-xs text-muted-foreground">{wo.workOrderCode}</p>
            {wo.plannedStartAt && (
              <p className="text-xs text-muted-foreground">
                {new Date(wo.plannedStartAt).toLocaleDateString()}
              </p>
            )}
          </FieldCard>
        ))}
      </div>
    </section>
  );
}
