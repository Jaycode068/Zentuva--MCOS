'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Select,
} from '@zentuva/ui';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { FinanceTabs } from '@/components/app/finance-tabs';
import { formatCurrency } from '@/lib/format-currency';

import {
  activateBudget,
  approveBudget,
  closeBudget,
  getBudget,
  getBudgetSiblings,
  getBudgetVsActual,
  getBudgetVsForecast,
  listBudgetLines,
  listChartOfAccounts,
  listCostCentres,
  reviseBudget,
  upsertBudgetLine,
  type Budget,
  type BudgetLine,
  type BudgetLineType,
  type BudgetVarianceReport,
  type BudgetVsForecastResult,
  type ChartOfAccount,
  type CostCentre,
} from '../../api';
import { BUDGET_LINE_TYPE_LABELS, BUDGET_STATUS_LABELS, BUDGET_STATUS_VARIANT } from '../../labels';

const MONTH_LABELS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/**
 * Budget detail (Sprint 16, docs/domains/budgeting.md) — the monthly grid
 * (Revenue/OpEx/CAPEX), Budget vs Actual (always live from the General
 * Ledger, never duplicated here), Budget vs Forecast (genuinely composes
 * Sprint 15's own forecast, never a second engine), and scenario/revision
 * lineage. Cells become editable only while the budget is still `DRAFT` —
 * once `APPROVED`, this page is read-only until a revision is created.
 */
export default function BudgetDetailPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const queryClient = useQueryClient();

  const { data: budget } = useQuery({ queryKey: ['budget', id], queryFn: () => getBudget(id) });
  const { data: linesData } = useQuery({
    queryKey: ['budget-lines', id],
    queryFn: () => listBudgetLines(id),
  });
  const lines = linesData?.items ?? [];

  const { data: siblingsData } = useQuery({
    queryKey: ['budget-siblings', id],
    queryFn: () => getBudgetSiblings(id),
    enabled: !!budget,
  });
  const siblings = (siblingsData?.items ?? []).filter((sibling) => sibling.id !== id);

  const { data: vsActual } = useQuery({
    queryKey: ['budget-vs-actual', id],
    queryFn: () => getBudgetVsActual(id),
  });
  const { data: vsForecast } = useQuery({
    queryKey: ['budget-vs-forecast', id],
    queryFn: () => getBudgetVsForecast(id),
  });

  const { data: accountsData } = useQuery({
    queryKey: ['chart-of-accounts', 'all'],
    queryFn: () => listChartOfAccounts({ isActive: true }),
  });
  const accountsById = useMemo(
    () => new Map((accountsData?.items ?? []).map((account) => [account.id, account])),
    [accountsData],
  );

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['budget', id] });
    queryClient.invalidateQueries({ queryKey: ['budget-lines', id] });
    queryClient.invalidateQueries({ queryKey: ['budget-vs-actual', id] });
    queryClient.invalidateQueries({ queryKey: ['budget-vs-forecast', id] });
    queryClient.invalidateQueries({ queryKey: ['budget-siblings', id] });
    queryClient.invalidateQueries({ queryKey: ['budgets'] });
  };

  const lifecycleMutation = useMutation({
    mutationFn: (action: 'approve' | 'activate' | 'close' | 'revise') => {
      if (action === 'approve') return approveBudget(id);
      if (action === 'activate') return activateBudget(id);
      if (action === 'close') return closeBudget(id);
      return reviseBudget(id);
    },
    onSuccess: invalidateAll,
  });

  if (!budget) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-10">
        <p className="text-sm text-muted-foreground">Loading budget…</p>
      </main>
    );
  }

  const isDraft = budget.status === 'DRAFT';
  const revenueLines = lines.filter((line) => line.lineType === 'REVENUE');
  const expenseLines = lines.filter((line) => line.lineType === 'OPERATING_EXPENSE');
  const capexLines = lines.filter((line) => line.lineType === 'CAPEX');

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{budget.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {budget.budgetCode} · FY{budget.fiscalYear} · {budget.scenarioName} · v{budget.version}
          </p>
          {budget.description && (
            <p className="mt-2 text-sm text-muted-foreground">{budget.description}</p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <Badge variant={BUDGET_STATUS_VARIANT[budget.status]}>
            {BUDGET_STATUS_LABELS[budget.status]}
          </Badge>
          {budget.status === 'DRAFT' && (
            <Button
              onClick={() => lifecycleMutation.mutate('approve')}
              disabled={lifecycleMutation.isPending}
            >
              Approve
            </Button>
          )}
          {budget.status === 'APPROVED' && (
            <Button
              onClick={() => lifecycleMutation.mutate('activate')}
              disabled={lifecycleMutation.isPending}
            >
              Activate
            </Button>
          )}
          {budget.status === 'ACTIVE' && (
            <Button
              variant="outline"
              onClick={() => lifecycleMutation.mutate('close')}
              disabled={lifecycleMutation.isPending}
            >
              Close
            </Button>
          )}
          {budget.status !== 'DRAFT' && (
            <Button
              variant="outline"
              onClick={() => lifecycleMutation.mutate('revise')}
              disabled={lifecycleMutation.isPending}
            >
              Revise
            </Button>
          )}
        </div>
      </div>

      <FinanceTabs />

      {isDraft && (
        <p className="mb-6 rounded-lg border border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
          This budget is still a draft — every cell below is editable. Approve, then Activate, to
          make it the in-force plan; editing then requires a new revision.
        </p>
      )}

      <BudgetLineGrid
        title="Revenue"
        lineType="REVENUE"
        lines={revenueLines}
        budget={budget}
        editable={isDraft}
        accountsById={accountsById}
        onSaved={invalidateAll}
      />
      <BudgetLineGrid
        title="Operating Expenses"
        lineType="OPERATING_EXPENSE"
        lines={expenseLines}
        budget={budget}
        editable={isDraft}
        accountsById={accountsById}
        onSaved={invalidateAll}
      />
      <CapexSection lines={capexLines} budget={budget} editable={isDraft} onSaved={invalidateAll} />

      {vsActual && <VsActualSection report={vsActual} />}
      {vsForecast && <VsForecastSection result={vsForecast} />}
      {siblings.length > 0 && <ScenarioSiblingsSection budget={budget} siblings={siblings} />}
    </main>
  );
}

function quarterTotal(monthly: number[], quarter: number): number {
  return monthly.slice(quarter * 3, quarter * 3 + 3).reduce((sum, value) => sum + value, 0);
}

function BudgetLineGrid({
  title,
  lineType,
  lines,
  budget,
  editable,
  accountsById,
  onSaved,
}: {
  title: string;
  lineType: Extract<BudgetLineType, 'REVENUE' | 'OPERATING_EXPENSE'>;
  lines: BudgetLine[];
  budget: Budget;
  editable: boolean;
  accountsById: Map<string, ChartOfAccount>;
  onSaved: () => void;
}) {
  const [addOpen, setAddOpen] = useState(false);

  const rows = useMemo(() => {
    const byKey = new Map<
      string,
      { chartOfAccountId: string; costCentreId: string | null; monthly: (BudgetLine | undefined)[] }
    >();
    for (const line of lines) {
      const key = `${line.chartOfAccountId}|${line.costCentreId ?? ''}`;
      if (!byKey.has(key)) {
        byKey.set(key, {
          chartOfAccountId: line.chartOfAccountId as string,
          costCentreId: line.costCentreId,
          monthly: new Array(12).fill(undefined),
        });
      }
      const monthIndex = new Date(line.periodMonth).getMonth();
      byKey.get(key)!.monthly[monthIndex] = line;
    }
    return [...byKey.values()];
  }, [lines]);

  return (
    <Card className="mb-8">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        {editable && (
          <Button variant="outline" size="sm" onClick={() => setAddOpen((value) => !value)}>
            {addOpen ? 'Cancel' : `Add ${title} Line`}
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {addOpen && (
          <AddGridLineForm
            budget={budget}
            lineType={lineType}
            onSaved={() => {
              setAddOpen(false);
              onSaved();
            }}
          />
        )}

        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No {title.toLowerCase()} lines yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-1.5 pr-3 font-medium">Account</th>
                  {MONTH_LABELS.map((label) => (
                    <th key={label} className="px-1.5 py-1.5 text-right font-medium">
                      {label}
                    </th>
                  ))}
                  <th className="px-1.5 py-1.5 text-right font-medium">Annual</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const monthlyAmounts = row.monthly.map((line) => line?.amount ?? 0);
                  const annual = monthlyAmounts.reduce((sum, value) => sum + value, 0);
                  const account = accountsById.get(row.chartOfAccountId);
                  return (
                    <tr
                      key={`${row.chartOfAccountId}|${row.costCentreId}`}
                      className="border-t border-border/60"
                    >
                      <td className="py-1.5 pr-3 font-medium">
                        {account ? `${account.code} ${account.name}` : row.chartOfAccountId}
                      </td>
                      {row.monthly.map((line, monthIndex) => (
                        <GridCell
                          key={monthIndex}
                          budget={budget}
                          lineType={lineType}
                          chartOfAccountId={row.chartOfAccountId}
                          costCentreId={row.costCentreId}
                          monthIndex={monthIndex}
                          amount={line?.amount ?? 0}
                          editable={editable}
                          onSaved={onSaved}
                        />
                      ))}
                      <td className="px-1.5 py-1.5 text-right font-semibold">
                        {formatCurrency(annual, budget.currency)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-border font-medium">
                  <td className="py-1.5 pr-3">Total</td>
                  {[0, 1, 2, 3].map((quarter) => (
                    <td
                      key={quarter}
                      colSpan={3}
                      className="px-1.5 py-1.5 text-right text-muted-foreground"
                    >
                      Q{quarter + 1}:{' '}
                      {formatCurrency(
                        quarterTotal(
                          rows.reduce((totals: number[], row) => {
                            row.monthly.forEach((line, index) => {
                              totals[index] = (totals[index] ?? 0) + (line?.amount ?? 0);
                            });
                            return totals;
                          }, new Array(12).fill(0)),
                          quarter,
                        ),
                        budget.currency,
                      )}
                    </td>
                  ))}
                  <td className="px-1.5 py-1.5 text-right">
                    {formatCurrency(
                      lines.reduce((sum, line) => sum + line.amount, 0),
                      budget.currency,
                    )}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function GridCell({
  budget,
  lineType,
  chartOfAccountId,
  costCentreId,
  monthIndex,
  amount,
  editable,
  onSaved,
}: {
  budget: Budget;
  lineType: BudgetLineType;
  chartOfAccountId: string;
  costCentreId: string | null;
  monthIndex: number;
  amount: number;
  editable: boolean;
  onSaved: () => void;
}) {
  if (!editable) {
    return (
      <td className="px-1.5 py-1.5 text-right">
        {amount > 0 ? formatCurrency(amount, budget.currency) : '—'}
      </td>
    );
  }

  return (
    <td className="px-0.5 py-1">
      <input
        className="w-20 rounded border border-border bg-transparent px-1 py-0.5 text-right text-xs"
        defaultValue={amount || ''}
        key={`${chartOfAccountId}-${monthIndex}-${amount}`}
        onBlur={(event) => {
          const nextAmount = Number(event.target.value) || 0;
          if (nextAmount !== amount) {
            const periodMonth = new Date(new Date(budget.startDate).getFullYear(), monthIndex, 1);
            upsertBudgetLine(budget.id, {
              chartOfAccountId,
              costCentreId: costCentreId ?? undefined,
              lineType,
              periodMonth: periodMonth.toISOString(),
              amount: nextAmount,
            }).then(onSaved);
          }
        }}
      />
    </td>
  );
}

function AddGridLineForm({
  budget,
  lineType,
  onSaved,
}: {
  budget: Budget;
  lineType: Extract<BudgetLineType, 'REVENUE' | 'OPERATING_EXPENSE'>;
  onSaved: () => void;
}) {
  const eligibleTypes = lineType === 'REVENUE' ? 'REVENUE' : undefined;
  const { data: accountsData } = useQuery({
    queryKey: ['chart-of-accounts', eligibleTypes ?? 'expense'],
    queryFn: () =>
      lineType === 'REVENUE'
        ? listChartOfAccounts({ type: 'REVENUE', isActive: true })
        : listChartOfAccounts({ isActive: true }),
  });
  const accounts = (accountsData?.items ?? []).filter((account: ChartOfAccount) =>
    lineType === 'REVENUE'
      ? account.type === 'REVENUE'
      : account.type === 'EXPENSE' || account.type === 'COST_OF_SALES',
  );
  const { data: costCentresData } = useQuery({
    queryKey: ['cost-centres', 'ACTIVE'],
    queryFn: () => listCostCentres({ status: 'ACTIVE' }),
  });
  const costCentres = costCentresData?.items ?? [];

  const [chartOfAccountId, setChartOfAccountId] = useState('');
  const [costCentreId, setCostCentreId] = useState('');
  const [monthIndex, setMonthIndex] = useState(0);
  const [amount, setAmount] = useState('');

  const mutation = useMutation({
    mutationFn: () =>
      upsertBudgetLine(budget.id, {
        chartOfAccountId,
        costCentreId: costCentreId || undefined,
        lineType,
        periodMonth: new Date(
          new Date(budget.startDate).getFullYear(),
          monthIndex,
          1,
        ).toISOString(),
        amount: Number(amount) || 0,
      }),
    onSuccess: onSaved,
  });

  return (
    <div className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-border bg-muted/20 p-3">
      <div className="space-y-1">
        <label className="text-[10px] text-muted-foreground">Account</label>
        <Select
          value={chartOfAccountId}
          onChange={(event) => setChartOfAccountId(event.target.value)}
          className="h-8"
        >
          <option value="">Select…</option>
          {accounts.map((account: ChartOfAccount) => (
            <option key={account.id} value={account.id}>
              {account.code} {account.name}
            </option>
          ))}
        </Select>
      </div>
      <div className="space-y-1">
        <label className="text-[10px] text-muted-foreground">Cost Centre</label>
        <Select
          value={costCentreId}
          onChange={(event) => setCostCentreId(event.target.value)}
          className="h-8"
        >
          <option value="">None</option>
          {costCentres.map((cc: CostCentre) => (
            <option key={cc.id} value={cc.id}>
              {cc.name}
            </option>
          ))}
        </Select>
      </div>
      <div className="space-y-1">
        <label className="text-[10px] text-muted-foreground">Starting Month</label>
        <Select
          value={monthIndex}
          onChange={(event) => setMonthIndex(Number(event.target.value))}
          className="h-8"
        >
          {MONTH_LABELS.map((label, index) => (
            <option key={label} value={index}>
              {label}
            </option>
          ))}
        </Select>
      </div>
      <div className="space-y-1">
        <label className="text-[10px] text-muted-foreground">Amount</label>
        <Input
          type="number"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          className="h-8 w-32"
        />
      </div>
      <Button
        size="sm"
        disabled={!chartOfAccountId || !amount || mutation.isPending}
        onClick={() => mutation.mutate()}
      >
        {mutation.isPending ? 'Adding…' : 'Add'}
      </Button>
    </div>
  );
}

function CapexSection({
  lines,
  budget,
  editable,
  onSaved,
}: {
  lines: BudgetLine[];
  budget: Budget;
  editable: boolean;
  onSaved: () => void;
}) {
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [monthIndex, setMonthIndex] = useState(0);

  const mutation = useMutation({
    mutationFn: () =>
      upsertBudgetLine(budget.id, {
        lineType: 'CAPEX',
        periodMonth: new Date(
          new Date(budget.startDate).getFullYear(),
          monthIndex,
          1,
        ).toISOString(),
        amount: Number(amount) || 0,
        description,
      }),
    onSuccess: () => {
      setDescription('');
      setAmount('');
      onSaved();
    },
  });

  const total = lines.reduce((sum, line) => sum + line.amount, 0);

  return (
    <Card className="mb-8">
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Capital Expenditure (CAPEX)
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-xs text-muted-foreground">
          Discrete planned items — no Chart of Accounts row required until a Fixed Assets module
          exists, so Budget vs Actual can&apos;t compare these against the ledger yet.
        </p>
        {lines.length === 0 ? (
          <p className="text-sm text-muted-foreground">No CAPEX items yet.</p>
        ) : (
          <ul className="space-y-2">
            {lines.map((line) => (
              <li key={line.id} className="flex items-center justify-between text-sm">
                <span>
                  {line.description} —{' '}
                  <span className="text-xs text-muted-foreground">
                    {new Date(line.periodMonth).toLocaleDateString('en-US', {
                      month: 'long',
                      year: 'numeric',
                    })}
                  </span>
                </span>
                <span className="font-medium">{formatCurrency(line.amount, budget.currency)}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-sm font-semibold">
          Total: {formatCurrency(total, budget.currency)}
        </p>

        {editable && (
          <div className="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-border bg-muted/20 p-3">
            <div className="space-y-1">
              <label className="text-[10px] text-muted-foreground">Description</label>
              <Input
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                className="h-8 w-48"
                placeholder="e.g. New Packaging Machine"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] text-muted-foreground">Month</label>
              <Select
                value={monthIndex}
                onChange={(event) => setMonthIndex(Number(event.target.value))}
                className="h-8"
              >
                {MONTH_LABELS.map((label, index) => (
                  <option key={label} value={index}>
                    {label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] text-muted-foreground">Amount</label>
              <Input
                type="number"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                className="h-8 w-32"
              />
            </div>
            <Button
              size="sm"
              disabled={!description || !amount || mutation.isPending}
              onClick={() => mutation.mutate()}
            >
              {mutation.isPending ? 'Adding…' : 'Add CAPEX Item'}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function VsActualSection({ report }: { report: BudgetVarianceReport }) {
  return (
    <Card className="mb-8">
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Budget vs Actual
        </CardTitle>
      </CardHeader>
      <CardContent>
        {report.accountVariance.length === 0 ? (
          <p className="text-sm text-muted-foreground">No accounted lines yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-1.5 pr-3 font-medium">Account</th>
                  <th className="py-1.5 pr-3 font-medium">Type</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Budget</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Actual</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Variance</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Variance %</th>
                  <th className="py-1.5 text-right font-medium">Favourable</th>
                </tr>
              </thead>
              <tbody>
                {report.accountVariance.map((row) => (
                  <tr key={row.chartOfAccountId} className="border-t border-border/60">
                    <td className="py-1.5 pr-3">
                      {row.accountCode} {row.accountName}
                    </td>
                    <td className="py-1.5 pr-3 text-muted-foreground">
                      {BUDGET_LINE_TYPE_LABELS[row.lineType]}
                    </td>
                    <td className="py-1.5 pr-3 text-right">{formatCurrency(row.budget, 'NGN')}</td>
                    <td className="py-1.5 pr-3 text-right">{formatCurrency(row.actual, 'NGN')}</td>
                    <td className={`py-1.5 pr-3 text-right ${row.variance >= 0 ? '' : ''}`}>
                      {formatCurrency(row.variance, 'NGN')}
                    </td>
                    <td className="py-1.5 pr-3 text-right">
                      {row.variancePercent === null ? '—' : `${row.variancePercent.toFixed(1)}%`}
                    </td>
                    <td className="py-1.5 text-right">
                      {row.favourable === null ? (
                        '—'
                      ) : (
                        <Badge variant={row.favourable ? 'success' : 'destructive'}>
                          {row.favourable ? 'Favourable' : 'Unfavourable'}
                        </Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {report.capexWithoutAccount.length > 0 && (
          <p className="mt-3 text-xs text-muted-foreground">
            {report.capexWithoutAccount.length} CAPEX item(s) have no linked account and can&apos;t
            be compared against actuals yet.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function VsForecastSection({ result }: { result: BudgetVsForecastResult }) {
  if (!result.applicable) {
    return (
      <Card className="mb-8">
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Budget vs Cashflow Forecast
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{result.reason}</p>
        </CardContent>
      </Card>
    );
  }

  const chartData = result.periods.map((period) => ({
    name: period.label,
    Budgeted: period.budgetedExpenditure,
    Forecast: period.forecastExpenditure,
  }));

  return (
    <Card className="mb-8">
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Budget vs Cashflow Forecast
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-xs text-muted-foreground">
          Genuinely reuses Sprint 15&apos;s own Cashflow Forecast — never a second forecast engine.
        </p>
        <div className="mb-4 h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis
                tick={{ fontSize: 11 }}
                tickFormatter={(value) => formatCurrency(value, 'NGN')}
                width={90}
              />
              <Tooltip formatter={(value) => formatCurrency(Number(value), 'NGN')} />
              <Bar dataKey="Budgeted" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Forecast" fill="hsl(var(--destructive))" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="py-1.5 pr-3 font-medium">Period</th>
                <th className="py-1.5 pr-3 text-right font-medium">Budgeted</th>
                <th className="py-1.5 pr-3 text-right font-medium">Forecast</th>
                <th className="py-1.5 pr-3 text-right font-medium">Available Cash</th>
                <th className="py-1.5 text-right font-medium">Shortfall</th>
              </tr>
            </thead>
            <tbody>
              {result.periods.map((period) => (
                <tr key={period.label} className="border-t border-border/60">
                  <td className="py-1.5 pr-3">{period.label}</td>
                  <td className="py-1.5 pr-3 text-right">
                    {formatCurrency(period.budgetedExpenditure, 'NGN')}
                  </td>
                  <td className="py-1.5 pr-3 text-right">
                    {formatCurrency(period.forecastExpenditure, 'NGN')}
                  </td>
                  <td className="py-1.5 pr-3 text-right">
                    {formatCurrency(period.availableCash, 'NGN')}
                  </td>
                  <td className="py-1.5 text-right">
                    {period.potentialShortfall > 0 ? (
                      <Badge variant="destructive">
                        {formatCurrency(period.potentialShortfall, 'NGN')}
                      </Badge>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function ScenarioSiblingsSection({ budget, siblings }: { budget: Budget; siblings: Budget[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Scenario Comparison
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-xs text-muted-foreground">
          Every sibling sharing this budget&apos;s own code and fiscal year — a plain what-if
          comparison, no scenario ever modifies another&apos;s lines.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="py-1.5 pr-3 font-medium">Scenario</th>
                <th className="py-1.5 pr-3 font-medium">Version</th>
                <th className="py-1.5 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-border/60 font-medium">
                <td className="py-1.5 pr-3">{budget.scenarioName} (this budget)</td>
                <td className="py-1.5 pr-3">v{budget.version}</td>
                <td className="py-1.5">
                  <Badge variant={BUDGET_STATUS_VARIANT[budget.status]}>
                    {BUDGET_STATUS_LABELS[budget.status]}
                  </Badge>
                </td>
              </tr>
              {siblings.map((sibling) => (
                <tr key={sibling.id} className="border-t border-border/60">
                  <td className="py-1.5 pr-3">
                    <a
                      href={`/settings/finance/budgets/${sibling.id}`}
                      className="text-primary hover:underline"
                    >
                      {sibling.scenarioName}
                    </a>
                  </td>
                  <td className="py-1.5 pr-3">v{sibling.version}</td>
                  <td className="py-1.5">
                    <Badge variant={BUDGET_STATUS_VARIANT[sibling.status]}>
                      {BUDGET_STATUS_LABELS[sibling.status]}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
