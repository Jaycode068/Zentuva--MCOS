'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button } from '@zentuva/ui';

import { listAssets } from '@/app/(app)/settings/assets/api';
import { MaintenanceTabs } from '@/components/app/maintenance-tabs';
import { ApiError } from '@/lib/api-client';

import {
  approveMaintenanceRequest,
  cancelMaintenanceRequest,
  listMaintenanceRequests,
  rejectMaintenanceRequest,
} from '../api';
import {
  MAINTENANCE_PRIORITY_LABELS,
  MAINTENANCE_PRIORITY_VARIANT,
  MAINTENANCE_REQUEST_STATUS_LABELS,
  MAINTENANCE_REQUEST_STATUS_VARIANT,
} from '../labels';
import { ConvertRequestDialog } from './convert-request-dialog';
import { RequestDialog } from './request-dialog';

/**
 * Maintenance Requests (Sprint 21, docs/domains/maintenance.md) — the
 * entry point for reporting a problem. A request is not itself a work
 * order; `Convert` produces one only once `Approved`.
 */
export default function MaintenanceRequestsPage() {
  const [createOpen, setCreateOpen] = useState(false);
  const [convertingId, setConvertingId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['maintenance-requests'],
    queryFn: () => listMaintenanceRequests(),
  });
  const requests = useMemo(() => data?.items ?? [], [data]);

  const { data: assetsData } = useQuery({ queryKey: ['assets'], queryFn: () => listAssets() });
  const assetsById = new Map((assetsData?.items ?? []).map((a) => [a.id, a]));

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['maintenance-requests'] });

  const approveMutation = useMutation({
    mutationFn: approveMaintenanceRequest,
    onSuccess: invalidate,
  });
  const rejectMutation = useMutation({
    mutationFn: (id: string) => rejectMaintenanceRequest(id, 'Not applicable'),
    onSuccess: invalidate,
  });
  const cancelMutation = useMutation({
    mutationFn: cancelMaintenanceRequest,
    onSuccess: invalidate,
  });

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Maintenance</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Reported problems, awaiting review or approval before becoming a work order.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>Report a Problem</Button>
      </div>

      <MaintenanceTabs />

      {isLoading && (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading requests…</p>
      )}
      {isError && (
        <p className="py-10 text-center text-sm text-destructive">
          {error instanceof ApiError ? error.message : 'Failed to load requests.'}
        </p>
      )}
      {!isLoading && !isError && requests.length === 0 && (
        <p className="py-10 text-center text-sm text-muted-foreground">No requests yet.</p>
      )}

      {!isLoading && !isError && requests.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/50 text-left">
              <tr>
                <th className="px-4 py-3 font-medium">Request</th>
                <th className="px-4 py-3 font-medium">Asset</th>
                <th className="px-4 py-3 font-medium">Priority</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((req) => (
                <tr key={req.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3">
                    <div className="font-medium">{req.title}</div>
                    <div className="font-mono text-xs text-muted-foreground">{req.requestCode}</div>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {assetsById.get(req.assetId)?.name ?? '—'}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={MAINTENANCE_PRIORITY_VARIANT[req.priority]}>
                      {MAINTENANCE_PRIORITY_LABELS[req.priority]}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={MAINTENANCE_REQUEST_STATUS_VARIANT[req.status]}>
                      {MAINTENANCE_REQUEST_STATUS_LABELS[req.status]}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right space-x-3">
                    {(req.status === 'OPEN' || req.status === 'UNDER_REVIEW') && (
                      <>
                        <button
                          type="button"
                          onClick={() => approveMutation.mutate(req.id)}
                          className="text-xs text-primary hover:underline"
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          onClick={() => rejectMutation.mutate(req.id)}
                          className="text-xs text-muted-foreground hover:text-destructive"
                        >
                          Reject
                        </button>
                      </>
                    )}
                    {req.status === 'APPROVED' && (
                      <button
                        type="button"
                        onClick={() => setConvertingId(req.id)}
                        className="text-xs text-primary hover:underline"
                      >
                        Convert to Work Order
                      </button>
                    )}
                    {(req.status === 'OPEN' ||
                      req.status === 'UNDER_REVIEW' ||
                      req.status === 'APPROVED') && (
                      <button
                        type="button"
                        onClick={() => cancelMutation.mutate(req.id)}
                        className="text-xs text-muted-foreground hover:text-destructive"
                      >
                        Cancel
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {createOpen && (
        <RequestDialog
          onOpenChange={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false);
            invalidate();
          }}
        />
      )}
      {convertingId && (
        <ConvertRequestDialog
          requestId={convertingId}
          onOpenChange={() => setConvertingId(null)}
          onConverted={(workOrderId) => {
            setConvertingId(null);
            window.location.assign(`/settings/maintenance/work-orders/${workOrderId}`);
          }}
        />
      )}
    </main>
  );
}
