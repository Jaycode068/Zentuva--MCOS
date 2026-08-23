'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Badge, Select } from '@zentuva/ui';

import { FieldCard } from '@/components/field/FieldCard';

import { listDispatches, type DispatchStatus } from '../api';
import { DISPATCH_STATUS_LABELS, DISPATCH_STATUS_VARIANT } from '../labels';

const ACTIONABLE_STATUSES: DispatchStatus[] = ['DISPATCHED', 'IN_TRANSIT', 'PARTIALLY_DELIVERED'];

/** Dispatch list card view (Sprint 5, docs/domains/distribution.md) — defaults to the
 *  dispatches a field agent still has an action on (dispatched/in transit/partially
 *  delivered); "All statuses" surfaces the rest for reference. */
export default function FieldDeliveriesPage() {
  const [statusFilter, setStatusFilter] = useState<'' | DispatchStatus>('');
  const { data, isLoading } = useQuery({
    queryKey: ['dispatches', 'field', statusFilter],
    queryFn: () => listDispatches({ status: statusFilter || undefined }),
  });

  const dispatches = useMemo(() => {
    const items = data?.items ?? [];
    if (statusFilter) return items;
    return items.filter((dispatch) => ACTIONABLE_STATUSES.includes(dispatch.status));
  }, [data, statusFilter]);

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-3 p-4">
        <h1 className="text-xl font-semibold tracking-tight">Deliveries</h1>
        <Select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
          className="h-12 text-base"
        >
          <option value="">Needs action</option>
          {Object.entries(DISPATCH_STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </div>

      <div className="flex-1 space-y-2 px-4 pb-4">
        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {!isLoading && dispatches.length === 0 && (
          <p className="py-10 text-center text-sm text-muted-foreground">No dispatches found.</p>
        )}
        {dispatches.map((dispatch) => (
          <FieldCard key={dispatch.id} href={`/field/deliveries/${dispatch.id}`}>
            <div className="flex items-center justify-between">
              <p className="font-mono text-xs font-medium">{dispatch.dispatchCode}</p>
              <Badge variant={DISPATCH_STATUS_VARIANT[dispatch.status]}>
                {DISPATCH_STATUS_LABELS[dispatch.status]}
              </Badge>
            </div>
            <p className="mt-0.5 text-sm">{dispatch.customer.customerName}</p>
            <p className="text-xs text-muted-foreground">
              {dispatch.outlet?.name ?? 'Order default destination'}
            </p>
          </FieldCard>
        ))}
      </div>
    </div>
  );
}
