'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button } from '@zentuva/ui';

import { listAssets } from '@/app/(app)/settings/assets/api';
import { MaintenanceTabs } from '@/components/app/maintenance-tabs';
import { ApiError } from '@/lib/api-client';

import {
  generateMaintenanceSchedule,
  listMaintenancePlans,
  listMaintenanceSchedules,
} from '../api';
import { ScheduleDialog } from './schedule-dialog';

/**
 * Maintenance Schedules (Sprint 21, docs/domains/maintenance.md) — the
 * concrete, per-asset recurrence of a Plan. Generation is idempotent by
 * construction: running it twice in a row never creates a duplicate work
 * order for the same due occurrence.
 */
export default function MaintenanceSchedulesPage() {
  const [createOpen, setCreateOpen] = useState(false);
  const [generateResult, setGenerateResult] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['maintenance-schedules'],
    queryFn: () => listMaintenanceSchedules(),
  });
  const schedules = useMemo(() => data?.items ?? [], [data]);

  const { data: assetsData } = useQuery({ queryKey: ['assets'], queryFn: () => listAssets() });
  const { data: plansData } = useQuery({
    queryKey: ['maintenance-plans'],
    queryFn: () => listMaintenancePlans(),
  });
  const assetsById = new Map((assetsData?.items ?? []).map((a) => [a.id, a]));
  const plansById = new Map((plansData?.items ?? []).map((p) => [p.id, p]));

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['maintenance-schedules'] });

  const generateMutation = useMutation({
    mutationFn: (id: string) => generateMaintenanceSchedule(id, crypto.randomUUID()),
    onSuccess: (result) => {
      setGenerateResult(
        result.generated
          ? `Generated ${result.workOrder?.workOrderCode}`
          : `Not due yet (${result.reason})`,
      );
      invalidate();
      queryClient.invalidateQueries({ queryKey: ['work-orders'] });
    },
  });

  const isOverdue = (dateStr: string | null) => !!dateStr && new Date(dateStr) < new Date();

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Maintenance</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            When each plan is due for a specific asset — date-based or meter-based.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>New Schedule</Button>
      </div>

      <MaintenanceTabs />

      {generateResult && (
        <p className="mb-4 rounded-md border border-border bg-muted/50 px-4 py-2 text-sm">
          {generateResult}
        </p>
      )}

      {isLoading && (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading schedules…</p>
      )}
      {isError && (
        <p className="py-10 text-center text-sm text-destructive">
          {error instanceof ApiError ? error.message : 'Failed to load schedules.'}
        </p>
      )}
      {!isLoading && !isError && schedules.length === 0 && (
        <p className="py-10 text-center text-sm text-muted-foreground">No schedules yet.</p>
      )}

      {!isLoading && !isError && schedules.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/50 text-left">
              <tr>
                <th className="px-4 py-3 font-medium">Plan</th>
                <th className="px-4 py-3 font-medium">Asset</th>
                <th className="px-4 py-3 font-medium">Trigger</th>
                <th className="px-4 py-3 font-medium">Next Due</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {schedules.map((sch) => (
                <tr key={sch.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3">{plansById.get(sch.maintenancePlanId)?.name ?? '—'}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {assetsById.get(sch.assetId)?.name ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {sch.scheduleType === 'DATE_BASED'
                      ? `Every ${sch.frequencyValue} ${sch.frequencyUnit?.toLowerCase()}`
                      : `Every ${sch.meterInterval} ${sch.meterType?.toLowerCase()}`}
                  </td>
                  <td className="px-4 py-3">
                    {sch.scheduleType === 'DATE_BASED' && sch.nextDueDate ? (
                      <Badge variant={isOverdue(sch.nextDueDate) ? 'destructive' : 'default'}>
                        {new Date(sch.nextDueDate).toLocaleDateString()}
                      </Badge>
                    ) : sch.scheduleType === 'METER_BASED' ? (
                      <span className="text-xs text-muted-foreground">
                        at {sch.nextDueMeterReading}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => generateMutation.mutate(sch.id)}
                      disabled={generateMutation.isPending}
                      className="text-xs text-primary hover:underline"
                    >
                      Generate if Due
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {createOpen && (
        <ScheduleDialog
          onOpenChange={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false);
            invalidate();
          }}
        />
      )}
    </main>
  );
}
