'use client';

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button } from '@zentuva/ui';

import { listAssetCategories, listAssets } from '@/app/(app)/settings/assets/api';
import { MaintenanceTabs } from '@/components/app/maintenance-tabs';
import { ApiError } from '@/lib/api-client';

import { listMaintenancePlans, listMaintenanceTypes } from '../api';
import { MAINTENANCE_PRIORITY_LABELS, MAINTENANCE_PRIORITY_VARIANT } from '../labels';
import { PlanDialog } from './plan-dialog';

/**
 * Maintenance Plans (Sprint 21, docs/domains/maintenance.md) — reusable
 * templates. Each plan targets exactly one of a specific Asset or an
 * Asset Category — never neither, never both.
 */
export default function MaintenancePlansPage() {
  const [createOpen, setCreateOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['maintenance-plans'],
    queryFn: () => listMaintenancePlans(),
  });
  const plans = useMemo(() => data?.items ?? [], [data]);

  const { data: assetsData } = useQuery({ queryKey: ['assets'], queryFn: () => listAssets() });
  const { data: categoriesData } = useQuery({
    queryKey: ['asset-categories'],
    queryFn: () => listAssetCategories(),
  });
  const { data: typesData } = useQuery({
    queryKey: ['maintenance-types'],
    queryFn: () => listMaintenanceTypes(),
  });
  const assetsById = new Map((assetsData?.items ?? []).map((a) => [a.id, a]));
  const categoriesById = new Map((categoriesData?.items ?? []).map((c) => [c.id, c]));
  const typesById = new Map((typesData?.items ?? []).map((t) => [t.id, t]));

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['maintenance-plans'] });

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Maintenance</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Reusable maintenance templates — a checklist and a target asset or category.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>New Plan</Button>
      </div>

      <MaintenanceTabs />

      {isLoading && (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading plans…</p>
      )}
      {isError && (
        <p className="py-10 text-center text-sm text-destructive">
          {error instanceof ApiError ? error.message : 'Failed to load plans.'}
        </p>
      )}
      {!isLoading && !isError && plans.length === 0 && (
        <p className="py-10 text-center text-sm text-muted-foreground">No plans yet.</p>
      )}

      {!isLoading && !isError && plans.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {plans.map((plan) => (
            <div key={plan.id} className="rounded-lg border border-border p-4">
              <div className="mb-2 flex items-start justify-between">
                <h3 className="font-medium">{plan.name}</h3>
                <Badge variant={MAINTENANCE_PRIORITY_VARIANT[plan.priority]}>
                  {MAINTENANCE_PRIORITY_LABELS[plan.priority]}
                </Badge>
              </div>
              <p className="mb-2 text-xs text-muted-foreground">
                {typesById.get(plan.maintenanceTypeId)?.name ?? '—'} ·{' '}
                {plan.assetId
                  ? (assetsById.get(plan.assetId)?.name ?? 'Asset')
                  : `${categoriesById.get(plan.assetCategoryId ?? '')?.name ?? 'Category'} (category)`}
              </p>
              {plan.description && <p className="mb-2 text-sm">{plan.description}</p>}
              <p className="text-xs text-muted-foreground">{plan.tasks.length} checklist step(s)</p>
            </div>
          ))}
        </div>
      )}

      {createOpen && (
        <PlanDialog
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
