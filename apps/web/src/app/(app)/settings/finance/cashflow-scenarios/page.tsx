'use client';

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button } from '@zentuva/ui';

import { FinanceTabs } from '@/components/app/finance-tabs';
import { ApiError } from '@/lib/api-client';

import { deactivateCashflowScenario, listCashflowScenarios, type CashflowScenario } from '../api';
import { CASHFLOW_ITEM_STATUS_LABELS, CASHFLOW_ITEM_STATUS_VARIANT } from '../labels';
import { CashflowScenarioDialog } from './cashflow-scenario-dialog';

function formatMultiplier(value: number): string {
  return `${value.toFixed(2)}×`;
}

/**
 * Cashflow Scenarios (Sprint 15, docs/domains/cashflow.md §7) — named sets of
 * inflow/outflow delay-and-multiplier knobs a user can select on the Cashflow
 * dashboard. Base (no scenario selected) always behaves identically to the
 * unscaled forecast — these rows are pure configuration, never a rules engine.
 */
export default function CashflowScenariosPage() {
  const queryClient = useQueryClient();
  const [dialogState, setDialogState] = useState<{ open: boolean; scenario?: CashflowScenario }>({
    open: false,
  });

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['cashflow-scenarios'],
    queryFn: () => listCashflowScenarios(),
  });
  const scenarios = useMemo(() => data?.items ?? [], [data]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['cashflow-scenarios'] });
    queryClient.invalidateQueries({ queryKey: ['cashflow-forecast'] });
  };

  const deactivate = async (scenario: CashflowScenario) => {
    await deactivateCashflowScenario(scenario.id);
    invalidate();
  };

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Finance</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Named Base/Conservative/Optimistic-style adjustments selectable on the Cashflow
            dashboard — configurable knobs only, no predictive modelling.
          </p>
        </div>
        <Button onClick={() => setDialogState({ open: true })}>Add Scenario</Button>
      </div>

      <FinanceTabs />

      {isLoading && (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading scenarios…</p>
      )}
      {isError && (
        <p className="py-10 text-center text-sm text-destructive">
          {error instanceof ApiError ? error.message : 'Failed to load scenarios.'}
        </p>
      )}
      {!isLoading && !isError && scenarios.length === 0 && (
        <p className="py-10 text-center text-sm text-muted-foreground">
          No scenarios yet — add Base, Conservative, or Optimistic to compare on the dashboard.
        </p>
      )}

      {!isLoading && !isError && scenarios.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/50 text-left">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Description</th>
                <th className="px-4 py-3 text-right font-medium">Inflow Delay</th>
                <th className="px-4 py-3 text-right font-medium">Inflow ×</th>
                <th className="px-4 py-3 text-right font-medium">Outflow Delay</th>
                <th className="px-4 py-3 text-right font-medium">Outflow ×</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {scenarios.map((scenario) => (
                <tr key={scenario.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 font-medium">{scenario.name}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {scenario.description ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-right">{scenario.inflowDelayDays}d</td>
                  <td className="px-4 py-3 text-right">
                    {formatMultiplier(scenario.inflowMultiplier)}
                  </td>
                  <td className="px-4 py-3 text-right">{scenario.outflowDelayDays}d</td>
                  <td className="px-4 py-3 text-right">
                    {formatMultiplier(scenario.outflowMultiplier)}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={CASHFLOW_ITEM_STATUS_VARIANT[scenario.status]}>
                      {CASHFLOW_ITEM_STATUS_LABELS[scenario.status]}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right space-x-3">
                    <button
                      type="button"
                      onClick={() => setDialogState({ open: true, scenario })}
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      Edit
                    </button>
                    {scenario.status === 'ACTIVE' && (
                      <button
                        type="button"
                        onClick={() => deactivate(scenario)}
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
        <CashflowScenarioDialog
          scenario={dialogState.scenario}
          onOpenChange={() => setDialogState({ open: false })}
          onSaved={invalidate}
        />
      )}
    </main>
  );
}
