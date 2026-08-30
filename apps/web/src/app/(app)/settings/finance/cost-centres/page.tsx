'use client';

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button } from '@zentuva/ui';

import { FinanceTabs } from '@/components/app/finance-tabs';
import { ApiError } from '@/lib/api-client';

import { deactivateCostCentre, listCostCentres, type CostCentre } from '../api';
import { COST_CENTRE_STATUS_LABELS, COST_CENTRE_STATUS_VARIANT } from '../labels';
import { CostCentreDialog } from './cost-centre-dialog';

/**
 * Cost Centres (Sprint 16, docs/domains/budgeting.md §10) — a lightweight
 * planning dimension a Budget Line may optionally tag itself with. Never
 * linked to the Chart of Accounts, never a redesign of the accounting model.
 */
export default function CostCentresPage() {
  const queryClient = useQueryClient();
  const [dialogState, setDialogState] = useState<{ open: boolean; costCentre?: CostCentre }>({
    open: false,
  });

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['cost-centres'],
    queryFn: () => listCostCentres(),
  });
  const costCentres = useMemo(() => data?.items ?? [], [data]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['cost-centres'] });
  };

  const deactivate = async (costCentre: CostCentre) => {
    await deactivateCostCentre(costCentre.id);
    invalidate();
  };

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Finance</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            A lightweight tag a Budget Line can optionally attach itself to — never linked to the
            Chart of Accounts.
          </p>
        </div>
        <Button onClick={() => setDialogState({ open: true })}>Add Cost Centre</Button>
      </div>

      <FinanceTabs />

      {isLoading && (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading cost centres…</p>
      )}
      {isError && (
        <p className="py-10 text-center text-sm text-destructive">
          {error instanceof ApiError ? error.message : 'Failed to load cost centres.'}
        </p>
      )}
      {!isLoading && !isError && costCentres.length === 0 && (
        <p className="py-10 text-center text-sm text-muted-foreground">
          No cost centres yet — add Production, Sales, or Administration to tag budget lines with.
        </p>
      )}

      {!isLoading && !isError && costCentres.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/50 text-left">
              <tr>
                <th className="px-4 py-3 font-medium">Code</th>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Description</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {costCentres.map((costCentre) => (
                <tr key={costCentre.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 font-medium">{costCentre.code}</td>
                  <td className="px-4 py-3">{costCentre.name}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {costCentre.description ?? '—'}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={COST_CENTRE_STATUS_VARIANT[costCentre.status]}>
                      {COST_CENTRE_STATUS_LABELS[costCentre.status]}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right space-x-3">
                    <button
                      type="button"
                      onClick={() => setDialogState({ open: true, costCentre })}
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      Edit
                    </button>
                    {costCentre.status === 'ACTIVE' && (
                      <button
                        type="button"
                        onClick={() => deactivate(costCentre)}
                        className="text-xs text-muted-foreground hover:text-foreground"
                      >
                        Deactivate
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {dialogState.open && (
        <CostCentreDialog
          costCentre={dialogState.costCentre}
          onOpenChange={() => setDialogState({ open: false })}
          onSaved={invalidate}
        />
      )}
    </main>
  );
}
