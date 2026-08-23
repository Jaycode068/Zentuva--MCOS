'use client';

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Input, Select } from '@zentuva/ui';

import { TruckIcon } from '@/components/workspace/icons';
import { ApiError } from '@/lib/api-client';

import { listDispatches, type Dispatch, type DispatchStatus } from './api';
import { DISPATCH_STATUS_LABELS, DISPATCH_STATUS_VARIANT } from './labels';
import { DispatchDetailDialog } from './dispatch-detail-dialog';
import { DispatchDialog } from './dispatch-dialog';

/**
 * Distribution (Sprint 5, docs/domains/distribution.md) — the Admin surface for
 * Dispatch/Delivery management. Neither creating a dispatch nor recording a delivery
 * ever deducts inventory a second time — Sales Fulfilment already did that, once; see
 * `apps/web/src/app/(field)/field/deliveries/` for the mobile-first Field Sales
 * counterpart hitting the same backend.
 */
export default function DistributionSettingsPage() {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedDispatchId, setSelectedDispatchId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'' | DispatchStatus>('');

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['dispatches'],
    queryFn: () => listDispatches(),
  });

  const dispatches = useMemo(() => data?.items ?? [], [data]);
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return dispatches.filter((dispatch) => {
      if (statusFilter && dispatch.status !== statusFilter) return false;
      if (!query) return true;
      return (
        dispatch.dispatchCode.toLowerCase().includes(query) ||
        dispatch.customer.customerName.toLowerCase().includes(query)
      );
    });
  }, [dispatches, search, statusFilter]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['dispatches'] });

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Distribution</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Dispatch releases already-fulfilled goods toward a destination; delivery confirms what
            actually arrived. Inventory is never deducted again at either stage.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>Create Dispatch</Button>
      </div>

      {isLoading && (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading dispatches…</p>
      )}
      {isError && (
        <p className="py-10 text-center text-sm text-destructive">
          {error instanceof ApiError ? error.message : 'Failed to load dispatches.'}
        </p>
      )}

      {!isLoading && !isError && dispatches.length === 0 && (
        <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed border-border px-6 py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <TruckIcon className="h-6 w-6" />
          </div>
          <h2 className="text-base font-semibold text-foreground">No dispatches yet</h2>
          <Button onClick={() => setCreateOpen(true)}>Create Your First Dispatch</Button>
        </div>
      )}

      {!isLoading && !isError && dispatches.length > 0 && (
        <>
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Input
              placeholder="Search by dispatch code or customer…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="max-w-sm"
            />
            <Select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
              className="max-w-[12rem]"
            >
              <option value="">All statuses</option>
              {Object.entries(DISPATCH_STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </div>

          <div className="hidden overflow-x-auto rounded-lg border border-border md:block">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/50 text-left">
                <tr>
                  <th className="px-4 py-3 font-medium">Dispatch Code</th>
                  <th className="px-4 py-3 font-medium">Customer</th>
                  <th className="px-4 py-3 font-medium">Destination</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((dispatch) => (
                  <DispatchRow
                    key={dispatch.id}
                    dispatch={dispatch}
                    onSelect={() => setSelectedDispatchId(dispatch.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-2 md:hidden">
            {filtered.map((dispatch) => (
              <button
                key={dispatch.id}
                type="button"
                onClick={() => setSelectedDispatchId(dispatch.id)}
                className="w-full rounded-lg border border-border p-3 text-left"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-medium">{dispatch.dispatchCode}</span>
                  <Badge variant={DISPATCH_STATUS_VARIANT[dispatch.status]}>
                    {DISPATCH_STATUS_LABELS[dispatch.status]}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {dispatch.customer.customerName} · {dispatch.outlet?.name ?? 'Order default'}
                </p>
              </button>
            ))}
          </div>
        </>
      )}

      {createOpen && (
        <DispatchDialog onOpenChange={() => setCreateOpen(false)} onCreated={invalidate} />
      )}
      {selectedDispatchId && (
        <DispatchDetailDialog
          dispatchId={selectedDispatchId}
          onOpenChange={() => setSelectedDispatchId(null)}
          onChanged={invalidate}
        />
      )}
    </main>
  );
}

function DispatchRow({ dispatch, onSelect }: { dispatch: Dispatch; onSelect: () => void }) {
  return (
    <tr className="border-b border-border last:border-0">
      <td className="px-4 py-3">
        <button
          type="button"
          onClick={onSelect}
          className="font-mono text-xs font-medium text-foreground hover:underline"
        >
          {dispatch.dispatchCode}
        </button>
      </td>
      <td className="px-4 py-3">{dispatch.customer.customerName}</td>
      <td className="px-4 py-3 text-muted-foreground">
        {dispatch.outlet?.name ?? 'Order default'}
      </td>
      <td className="px-4 py-3">
        <Badge variant={DISPATCH_STATUS_VARIANT[dispatch.status]}>
          {DISPATCH_STATUS_LABELS[dispatch.status]}
        </Badge>
      </td>
      <td className="px-4 py-3 text-right">
        <Button variant="outline" size="sm" onClick={onSelect}>
          View
        </Button>
      </td>
    </tr>
  );
}
