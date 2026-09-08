'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button, Input, Select } from '@zentuva/ui';

import { MaintenanceTabs } from '@/components/app/maintenance-tabs';
import { listAssets } from '@/app/(app)/settings/assets/api';
import { ApiError } from '@/lib/api-client';

import { type MaintenancePriority, type WorkOrderStatus, listWorkOrders } from '../api';
import {
  MAINTENANCE_PRIORITY_LABELS,
  MAINTENANCE_PRIORITY_VARIANT,
  WORK_ORDER_STATUS_LABELS,
  WORK_ORDER_STATUS_VARIANT,
} from '../labels';
import { WorkOrderDialog } from './work-order-dialog';

/**
 * Work Orders (Sprint 21, docs/domains/maintenance.md) — the core
 * maintenance execution record list. `workOrderCode` is always
 * server-generated.
 */
export default function WorkOrdersPage() {
  const [createOpen, setCreateOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<WorkOrderStatus | ''>('');
  const [priority, setPriority] = useState<MaintenancePriority | ''>('');

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['work-orders', search, status, priority],
    queryFn: () =>
      listWorkOrders({
        search: search || undefined,
        status: status || undefined,
        priority: priority || undefined,
      }),
  });
  const workOrders = useMemo(() => data?.items ?? [], [data]);

  const { data: assetsData } = useQuery({ queryKey: ['assets'], queryFn: () => listAssets() });
  const assetsById = new Map((assetsData?.items ?? []).map((a) => [a.id, a]));

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Maintenance</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every maintenance job — preventive, corrective, or breakdown.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>New Work Order</Button>
      </div>

      <MaintenanceTabs />

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search work order code or title…"
          className="max-w-xs"
        />
        <Select
          value={status}
          onChange={(event) => setStatus(event.target.value as WorkOrderStatus | '')}
          className="max-w-[10rem]"
        >
          <option value="">All Statuses</option>
          {Object.entries(WORK_ORDER_STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
        <Select
          value={priority}
          onChange={(event) => setPriority(event.target.value as MaintenancePriority | '')}
          className="max-w-[10rem]"
        >
          <option value="">All Priorities</option>
          {Object.entries(MAINTENANCE_PRIORITY_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </div>

      {isLoading && (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading work orders…</p>
      )}
      {isError && (
        <p className="py-10 text-center text-sm text-destructive">
          {error instanceof ApiError ? error.message : 'Failed to load work orders.'}
        </p>
      )}
      {!isLoading && !isError && workOrders.length === 0 && (
        <p className="py-10 text-center text-sm text-muted-foreground">No work orders yet.</p>
      )}

      {!isLoading && !isError && workOrders.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/50 text-left">
              <tr>
                <th className="px-4 py-3 font-medium">Work Order</th>
                <th className="px-4 py-3 font-medium">Asset</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Priority</th>
                <th className="px-4 py-3 text-right font-medium">Open</th>
              </tr>
            </thead>
            <tbody>
              {workOrders.map((wo) => (
                <tr key={wo.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3">
                    <div className="font-medium">{wo.title}</div>
                    <div className="font-mono text-xs text-muted-foreground">
                      {wo.workOrderCode}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {assetsById.get(wo.assetId)?.name ?? '—'}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={WORK_ORDER_STATUS_VARIANT[wo.status]}>
                      {WORK_ORDER_STATUS_LABELS[wo.status]}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={MAINTENANCE_PRIORITY_VARIANT[wo.priority]}>
                      {MAINTENANCE_PRIORITY_LABELS[wo.priority]}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/settings/maintenance/work-orders/${wo.id}`}
                      className="text-xs text-primary hover:underline"
                    >
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {createOpen && (
        <WorkOrderDialog
          onOpenChange={() => setCreateOpen(false)}
          onCreated={(id) => {
            setCreateOpen(false);
            refetch();
            window.location.assign(`/settings/maintenance/work-orders/${id}`);
          }}
        />
      )}
    </main>
  );
}
