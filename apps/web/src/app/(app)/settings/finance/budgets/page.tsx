'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@zentuva/ui';

import { FinanceTabs } from '@/components/app/finance-tabs';
import { ApiError } from '@/lib/api-client';
import { formatCurrency } from '@/lib/format-currency';

import { getBudgetVsActual, listBudgets, type Budget } from '../api';
import { BUDGET_STATUS_LABELS, BUDGET_STATUS_VARIANT } from '../labels';
import { BudgetDialog } from './budget-dialog';

/**
 * Budgets (Sprint 16, docs/domains/budgeting.md) — every planned financial
 * year an organisation has created, across every scenario and revision. The
 * Overview strip summarizes the currently `ACTIVE` budget's own Budget vs
 * Actual — a deliberate simplification: aggregating across multiple
 * simultaneously-active budgets (e.g. different fiscal years) is left for a
 * future iteration, documented in docs/sprint-16-completion-report.md.
 */
export default function BudgetsPage() {
  const [createOpen, setCreateOpen] = useState(false);
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['budgets'],
    queryFn: () => listBudgets(),
  });
  const budgets = useMemo(() => data?.items ?? [], [data]);
  const activeBudget = useMemo(
    () => budgets.find((budget) => budget.status === 'ACTIVE'),
    [budgets],
  );

  const { data: overview } = useQuery({
    queryKey: ['budget-vs-actual', activeBudget?.id],
    queryFn: () => getBudgetVsActual(activeBudget!.id),
    enabled: !!activeBudget,
  });

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Finance</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Planned revenue, expenses, and capital expenditure — compared against actual General
            Ledger results and the Cashflow Forecast. Actuals always come from the ledger, never
            duplicated here.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>Add Budget</Button>
      </div>

      <FinanceTabs />

      {overview && (
        <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <SummaryCard
            title="Revenue"
            budget={overview.totalRevenueBudget}
            actual={overview.totalRevenueActual}
          />
          <SummaryCard
            title="Operating Expenses"
            budget={overview.totalExpenseBudget}
            actual={overview.totalExpenseActual}
          />
          <SummaryCard
            title="CAPEX"
            budget={overview.totalCapexBudget}
            actual={overview.totalCapexActual}
          />
        </div>
      )}

      {isLoading && (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading budgets…</p>
      )}
      {isError && (
        <p className="py-10 text-center text-sm text-destructive">
          {error instanceof ApiError ? error.message : 'Failed to load budgets.'}
        </p>
      )}
      {!isLoading && !isError && budgets.length === 0 && (
        <p className="py-10 text-center text-sm text-muted-foreground">
          No budgets yet — add a fiscal year&apos;s operating plan to get started.
        </p>
      )}

      {!isLoading && !isError && budgets.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/50 text-left">
              <tr>
                <th className="px-4 py-3 font-medium">Code</th>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Fiscal Year</th>
                <th className="px-4 py-3 font-medium">Scenario</th>
                <th className="px-4 py-3 font-medium">Version</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Open</th>
              </tr>
            </thead>
            <tbody>
              {budgets.map((budget) => (
                <BudgetRow key={budget.id} budget={budget} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {createOpen && (
        <BudgetDialog
          onOpenChange={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false);
            refetch();
          }}
        />
      )}
    </main>
  );
}

function SummaryCard({ title, budget, actual }: { title: string; budget: number; actual: number }) {
  const variance = actual - budget;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground">Budget</p>
        <p className="text-lg font-semibold">{formatCurrency(budget, 'NGN')}</p>
        <p className="mt-2 text-xs text-muted-foreground">Actual</p>
        <p className="text-lg font-semibold">{formatCurrency(actual, 'NGN')}</p>
        <p className={`mt-2 text-xs ${variance >= 0 ? 'text-success' : 'text-destructive'}`}>
          {variance >= 0 ? '+' : ''}
          {formatCurrency(variance, 'NGN')} variance
        </p>
      </CardContent>
    </Card>
  );
}

function BudgetRow({ budget }: { budget: Budget }) {
  return (
    <tr className="border-b border-border last:border-0">
      <td className="px-4 py-3 font-mono text-xs">{budget.budgetCode}</td>
      <td className="px-4 py-3">{budget.name}</td>
      <td className="px-4 py-3">{budget.fiscalYear}</td>
      <td className="px-4 py-3">{budget.scenarioName}</td>
      <td className="px-4 py-3">v{budget.version}</td>
      <td className="px-4 py-3">
        <Badge variant={BUDGET_STATUS_VARIANT[budget.status]}>
          {BUDGET_STATUS_LABELS[budget.status]}
        </Badge>
      </td>
      <td className="px-4 py-3 text-right">
        <Link
          href={`/settings/finance/budgets/${budget.id}`}
          className="text-xs text-primary hover:underline"
        >
          Open
        </Link>
      </td>
    </tr>
  );
}
