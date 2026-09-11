'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Select } from '@zentuva/ui';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { type CostCentre, listCostCentres } from '@/app/(app)/settings/finance/api';
import { MaintenanceTabs } from '@/components/app/maintenance-tabs';
import { ApiError } from '@/lib/api-client';
import { formatCurrency } from '@/lib/format-currency';
import {
  REPORT_PERIOD_PRESET_LABELS,
  type ReportPeriodPreset,
  resolveReportDateRange,
  toDateInputValue,
} from '@/lib/report-date-range';

import {
  type CostBreakdownResult,
  type CostBreakdownRow,
  type CostVsBudgetResult,
  type OperationalMetricsResult,
  type RiskSignal,
  getCostBreakdown,
  getCostVsBudget,
  getMaintenanceOverview,
  getOperationalMetrics,
  getRiskSignals,
} from '../api';

/**
 * Maintenance Analytics (Sprint 22, docs/domains/maintenance-integration.md
 * "Analytics") — a Maintenance-owned operational analytics surface, not
 * the future cross-domain Zentuva Reporting platform. Every figure comes
 * from `MaintenanceAnalyticsService`'s existing endpoints; this page is a
 * pure presentation layer — no metric is computed here from raw rows, only
 * light display aggregation (formatting, sorting an already-sorted list,
 * summing two already-authoritative counts) over responses the server
 * already aggregated. Nothing here is stored — every section re-fetches
 * live via TanStack Query, the same convention every other report page in
 * this codebase already uses.
 */
export default function MaintenanceAnalyticsPage() {
  const [preset, setPreset] = useState<ReportPeriodPreset>('this_month');
  const [customFrom, setCustomFrom] = useState(() => toDateInputValue(new Date()));
  const [customTo, setCustomTo] = useState(() => toDateInputValue(new Date()));

  const range =
    preset === 'custom'
      ? { from: new Date(customFrom), to: new Date(`${customTo}T23:59:59.999`) }
      : resolveReportDateRange(preset);
  const fromIso = range.from.toISOString();
  const toIso = range.to.toISOString();

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Maintenance Analytics</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Maintenance performance, cost, downtime and asset risk.
        </p>
      </div>

      <MaintenanceTabs />

      <div className="mb-8 flex flex-wrap items-center gap-2">
        <Select
          value={preset}
          onChange={(event) => setPreset(event.target.value as ReportPeriodPreset)}
          className="w-auto"
        >
          {Object.entries(REPORT_PERIOD_PRESET_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
        {preset === 'custom' && (
          <>
            <input
              type="date"
              value={customFrom}
              onChange={(event) => setCustomFrom(event.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            />
            <span className="text-sm text-muted-foreground">to</span>
            <input
              type="date"
              value={customTo}
              onChange={(event) => setCustomTo(event.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            />
          </>
        )}
      </div>

      <KpiSummarySection from={fromIso} to={toIso} />
      <CostBreakdownSection from={fromIso} to={toIso} />
      <CostVsBudgetSection from={fromIso} to={toIso} />
      <div className="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <PreventiveCorrectiveSection from={fromIso} to={toIso} />
        <DowntimeSection from={fromIso} to={toIso} />
      </div>
      <TopProblemAssetsSection from={fromIso} to={toIso} />
      <RiskSignalsSection />
    </main>
  );
}

function SectionCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="mb-8">
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function SectionLoading() {
  return <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>;
}

function SectionError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 py-6 text-center">
      <p className="text-sm text-destructive">{message}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `${h}h ${m}m`;
}

function assetIdFromKey(key: string): string {
  return key;
}

// === Section B — KPI Summary ===

function KpiSummarySection({ from, to }: { from: string; to: string }) {
  const metricsQuery = useQuery({
    queryKey: ['maintenance-analytics-operational-metrics', from, to],
    queryFn: () => getOperationalMetrics(from, to),
  });
  const costQuery = useQuery({
    queryKey: ['maintenance-analytics-cost-breakdown', from, to],
    queryFn: () => getCostBreakdown(from, to),
  });
  const overviewQuery = useQuery({
    queryKey: ['maintenance-overview'],
    queryFn: () => getMaintenanceOverview(),
  });

  const isLoading = metricsQuery.isLoading || costQuery.isLoading || overviewQuery.isLoading;
  const isError = metricsQuery.isError || costQuery.isError || overviewQuery.isError;

  if (isLoading) {
    return (
      <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {Array.from({ length: 7 }).map((_, i) => (
          <Card key={i}>
            <CardHeader>
              <CardTitle className="text-xs font-medium text-muted-foreground">Loading…</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-lg font-semibold text-muted-foreground">—</p>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <SectionCard title="KPI Summary">
        <SectionError
          message="Failed to load maintenance KPIs."
          onRetry={() => {
            metricsQuery.refetch();
            costQuery.refetch();
            overviewQuery.refetch();
          }}
        />
      </SectionCard>
    );
  }

  const metrics = metricsQuery.data as OperationalMetricsResult;
  const cost = costQuery.data as CostBreakdownResult;
  const overview = overviewQuery.data!;
  const totalDowntimeMinutes = metrics.downtimeMinutesByAsset.reduce((s, r) => s + r.minutes, 0);
  const totalWorkOrders = metrics.preventiveCount + metrics.correctiveCount;

  return (
    <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
      <KpiCard title="Maintenance Cost" value={formatCurrency(cost.total, 'NGN')} />
      <KpiCard
        title="Downtime"
        value={totalDowntimeMinutes > 0 ? formatMinutes(totalDowntimeMinutes) : '0h 0m'}
      />
      <KpiCard title="Work Orders" value={String(totalWorkOrders)} />
      <KpiCard
        title="Preventive Maintenance"
        value={String(metrics.preventiveCount)}
        hint={
          metrics.preventiveToCorrectiveRatio !== null
            ? `${metrics.preventiveToCorrectiveRatio.toFixed(2)}:1 vs corrective`
            : undefined
        }
      />
      <KpiCard title="Corrective Maintenance" value={String(metrics.correctiveCount)} />
      <KpiCard
        title="Overdue (current)"
        value={String(overview.overdueWorkOrders)}
        destructive={overview.overdueWorkOrders > 0}
      />
      <KpiCard
        title="Avg. Time to Complete"
        value={
          metrics.averageTimeToCompleteHours !== null
            ? `${metrics.averageTimeToCompleteHours.toFixed(1)}h`
            : '—'
        }
      />
    </div>
  );
}

function KpiCard({
  title,
  value,
  hint,
  destructive,
}: {
  title: string;
  value: string;
  hint?: string;
  destructive?: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xs font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className={`text-lg font-semibold ${destructive ? 'text-destructive' : ''}`}>{value}</p>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

// === Section C — Cost Breakdown ===

function CostBreakdownSection({ from, to }: { from: string; to: string }) {
  const query = useQuery({
    queryKey: ['maintenance-analytics-cost-breakdown', from, to],
    queryFn: () => getCostBreakdown(from, to),
  });

  return (
    <SectionCard title="Cost Breakdown" subtitle="Where is maintenance money going?">
      {query.isLoading && <SectionLoading />}
      {query.isError && (
        <SectionError
          message={
            query.error instanceof ApiError ? query.error.message : 'Failed to load cost breakdown.'
          }
          onRetry={() => query.refetch()}
        />
      )}
      {query.data && (
        <>
          {query.data.total === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No maintenance activity for this period.
            </p>
          ) : (
            <>
              <div className="mb-6 h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={query.data.byCategory.map((r) => ({ name: r.label, Cost: r.amount }))}
                  >
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      tickFormatter={(value) => formatCurrency(value, 'NGN')}
                      width={90}
                    />
                    <Tooltip formatter={(value) => formatCurrency(Number(value), 'NGN')} />
                    <Bar dataKey="Cost" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <BreakdownTable
                  title="By Asset"
                  rows={query.data.byAsset}
                  total={query.data.total}
                  assetLink
                />
                <BreakdownTable
                  title="By Maintenance Type"
                  rows={query.data.byMaintenanceType}
                  total={query.data.total}
                />
              </div>
            </>
          )}
        </>
      )}
    </SectionCard>
  );
}

function BreakdownTable({
  title,
  rows,
  total,
  assetLink,
}: {
  title: string;
  rows: CostBreakdownRow[];
  total: number;
  assetLink?: boolean;
}) {
  if (rows.length === 0) {
    return (
      <div>
        <p className="mb-2 text-xs font-medium text-muted-foreground">{title}</p>
        <p className="text-sm text-muted-foreground">No data.</p>
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <p className="mb-2 text-xs font-medium text-muted-foreground">{title}</p>
      <table className="w-full text-xs">
        <thead className="text-left text-muted-foreground">
          <tr>
            <th className="py-1.5 pr-3 font-medium">Label</th>
            <th className="py-1.5 pr-3 text-right font-medium">Amount</th>
            <th className="py-1.5 text-right font-medium">% of Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 10).map((row) => (
            <tr key={row.key} className="border-t border-border">
              <td className="py-1.5 pr-3">
                {assetLink ? (
                  <Link
                    href={`/settings/assets/register/${assetIdFromKey(row.key)}`}
                    className="text-primary hover:underline"
                  >
                    {row.label}
                  </Link>
                ) : (
                  row.label
                )}
              </td>
              <td className="py-1.5 pr-3 text-right">{formatCurrency(row.amount, 'NGN')}</td>
              <td className="py-1.5 text-right text-muted-foreground">
                {total === 0 ? '—' : `${((row.amount / total) * 100).toFixed(1)}%`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// === Section D — Cost vs Budget ===

function CostVsBudgetSection({ from, to }: { from: string; to: string }) {
  const [costCentreId, setCostCentreId] = useState('');
  const costCentresQuery = useQuery({
    queryKey: ['cost-centres'],
    queryFn: () => listCostCentres({ status: 'ACTIVE' }),
  });
  const centres = costCentresQuery.data?.items ?? [];
  const effectiveCostCentreId = costCentreId || centres[0]?.id || '';

  const query = useQuery({
    queryKey: ['maintenance-analytics-cost-vs-budget', effectiveCostCentreId, from, to],
    queryFn: () => getCostVsBudget(effectiveCostCentreId, from, to),
    enabled: !!effectiveCostCentreId,
  });

  return (
    <SectionCard
      title="Cost vs Budget"
      subtitle="Compares tagged maintenance cost against the cost centre's operating expense budget."
    >
      <div className="mb-4">
        <Select
          value={effectiveCostCentreId}
          onChange={(event) => setCostCentreId(event.target.value)}
          className="w-auto"
          disabled={centres.length === 0}
        >
          {centres.length === 0 && <option value="">No cost centres</option>}
          {centres.map((c: CostCentre) => (
            <option key={c.id} value={c.id}>
              {c.code} — {c.name}
            </option>
          ))}
        </Select>
      </div>

      {!effectiveCostCentreId && !costCentresQuery.isLoading && (
        <p className="py-6 text-center text-sm text-muted-foreground">
          No maintenance budget configured for this period.
        </p>
      )}
      {(query.isLoading || costCentresQuery.isLoading) && effectiveCostCentreId && (
        <SectionLoading />
      )}
      {query.isError && (
        <SectionError
          message={
            query.error instanceof ApiError
              ? query.error.message
              : 'Failed to load budget comparison.'
          }
          onRetry={() => query.refetch()}
        />
      )}
      {query.data && <CostVsBudgetDisplay result={query.data} />}
    </SectionCard>
  );
}

function CostVsBudgetDisplay({ result }: { result: CostVsBudgetResult }) {
  if (result.budget === 0 && result.actual === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        No maintenance budget configured for this period.
      </p>
    );
  }
  const chartData = [{ name: 'This Period', Budget: result.budget, Actual: result.actual }];
  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KpiCard title="Budget" value={formatCurrency(result.budget, 'NGN')} />
        <KpiCard title="Actual" value={formatCurrency(result.actual, 'NGN')} />
        <KpiCard
          title="Variance"
          value={formatCurrency(result.variance, 'NGN')}
          destructive={result.variance > 0}
        />
        <KpiCard
          title="Variance %"
          value={result.variancePercent === null ? '—' : `${result.variancePercent.toFixed(1)}%`}
        />
      </div>
      <div className="mb-4">
        <Badge variant={result.withinBudget ? 'success' : 'destructive'}>
          {result.withinBudget ? 'Within Budget' : 'Over Budget'}
        </Badge>
      </div>
      <div className="h-48 w-full">
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
            <Bar dataKey="Budget" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
            <Bar dataKey="Actual" fill="hsl(var(--destructive))" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}

// === Section E — Preventive vs Corrective ===

function PreventiveCorrectiveSection({ from, to }: { from: string; to: string }) {
  const query = useQuery({
    queryKey: ['maintenance-analytics-operational-metrics', from, to],
    queryFn: () => getOperationalMetrics(from, to),
  });

  return (
    <SectionCard
      title="Preventive vs Corrective"
      subtitle="Is maintenance mostly planned, or reactive?"
    >
      {query.isLoading && <SectionLoading />}
      {query.isError && (
        <SectionError
          message={
            query.error instanceof ApiError ? query.error.message : 'Failed to load metrics.'
          }
          onRetry={() => query.refetch()}
        />
      )}
      {query.data &&
        (() => {
          const { preventiveCount, correctiveCount } = query.data;
          const total = preventiveCount + correctiveCount;
          if (total === 0) {
            return (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No maintenance activity for this period.
              </p>
            );
          }
          const preventivePercent = (preventiveCount / total) * 100;
          const correctivePercent = 100 - preventivePercent;
          return (
            <div>
              <div className="mb-2 flex h-4 w-full overflow-hidden rounded-full bg-secondary">
                <div className="bg-primary" style={{ width: `${preventivePercent}%` }} />
                <div className="bg-destructive" style={{ width: `${correctivePercent}%` }} />
              </div>
              <div className="flex justify-between text-sm">
                <span>
                  <span className="inline-block h-2 w-2 rounded-full bg-primary" /> Preventive —{' '}
                  {preventiveCount} ({preventivePercent.toFixed(0)}%)
                </span>
                <span>
                  <span className="inline-block h-2 w-2 rounded-full bg-destructive" /> Corrective —{' '}
                  {correctiveCount} ({correctivePercent.toFixed(0)}%)
                </span>
              </div>
            </div>
          );
        })()}
    </SectionCard>
  );
}

// === Section F — Downtime ===

function DowntimeSection({ from, to }: { from: string; to: string }) {
  const query = useQuery({
    queryKey: ['maintenance-analytics-operational-metrics', from, to],
    queryFn: () => getOperationalMetrics(from, to),
  });

  return (
    <SectionCard title="Downtime" subtitle="Which assets are taking production time away?">
      {query.isLoading && <SectionLoading />}
      {query.isError && (
        <SectionError
          message={
            query.error instanceof ApiError ? query.error.message : 'Failed to load downtime.'
          }
          onRetry={() => query.refetch()}
        />
      )}
      {query.data &&
        (query.data.downtimeMinutesByAsset.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No downtime recorded for this period.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-1.5 pr-3 font-medium">Asset</th>
                  <th className="py-1.5 text-right font-medium">Downtime</th>
                </tr>
              </thead>
              <tbody>
                {query.data.downtimeMinutesByAsset.slice(0, 10).map((row) => (
                  <tr key={row.assetId} className="border-t border-border">
                    <td className="py-1.5 pr-3">
                      <Link
                        href={`/settings/assets/register/${row.assetId}`}
                        className="text-primary hover:underline"
                      >
                        {row.assetCode} — {row.name}
                      </Link>
                    </td>
                    <td className="py-1.5 text-right">{formatMinutes(row.minutes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
    </SectionCard>
  );
}

// === Section H — Top Problem Assets ===

type ProblemRanking = 'cost' | 'downtime' | 'workOrders';

function TopProblemAssetsSection({ from, to }: { from: string; to: string }) {
  const [ranking, setRanking] = useState<ProblemRanking>('cost');
  const costQuery = useQuery({
    queryKey: ['maintenance-analytics-cost-breakdown', from, to],
    queryFn: () => getCostBreakdown(from, to),
  });
  const metricsQuery = useQuery({
    queryKey: ['maintenance-analytics-operational-metrics', from, to],
    queryFn: () => getOperationalMetrics(from, to),
  });

  const isLoading = costQuery.isLoading || metricsQuery.isLoading;
  const isError = costQuery.isError || metricsQuery.isError;

  return (
    <SectionCard
      title="Assets Requiring Attention"
      subtitle="Ranked by cost, downtime, or work order volume."
    >
      <div className="mb-4 flex gap-2">
        {(
          [
            ['cost', 'By Cost'],
            ['downtime', 'By Downtime'],
            ['workOrders', 'By Work Orders'],
          ] as [ProblemRanking, string][]
        ).map(([value, label]) => (
          <Button
            key={value}
            size="sm"
            variant={ranking === value ? 'default' : 'outline'}
            onClick={() => setRanking(value)}
          >
            {label}
          </Button>
        ))}
      </div>

      {isLoading && <SectionLoading />}
      {isError && (
        <SectionError
          message="Failed to load asset rankings."
          onRetry={() => {
            costQuery.refetch();
            metricsQuery.refetch();
          }}
        />
      )}
      {costQuery.data && metricsQuery.data && (
        <TopProblemAssetsList
          ranking={ranking}
          costRows={costQuery.data.byAsset}
          downtimeRows={metricsQuery.data.downtimeMinutesByAsset}
          workOrderRows={metricsQuery.data.workOrderCountByAsset}
        />
      )}
    </SectionCard>
  );
}

function TopProblemAssetsList({
  ranking,
  costRows,
  downtimeRows,
  workOrderRows,
}: {
  ranking: ProblemRanking;
  costRows: CostBreakdownRow[];
  downtimeRows: OperationalMetricsResult['downtimeMinutesByAsset'];
  workOrderRows: OperationalMetricsResult['workOrderCountByAsset'];
}) {
  let items: { id: string; label: string; value: string }[] = [];
  if (ranking === 'cost') {
    items = costRows
      .slice(0, 5)
      .map((r) => ({ id: r.key, label: r.label, value: formatCurrency(r.amount, 'NGN') }));
  } else if (ranking === 'downtime') {
    items = downtimeRows
      .slice(0, 5)
      .map((r) => ({
        id: r.assetId,
        label: `${r.assetCode} — ${r.name}`,
        value: formatMinutes(r.minutes),
      }));
  } else {
    items = workOrderRows
      .slice(0, 5)
      .map((r) => ({
        id: r.assetId,
        label: `${r.assetCode} — ${r.name}`,
        value: `${r.count} work orders`,
      }));
  }

  if (items.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        No maintenance activity for this period.
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {items.map((item, index) => (
        <li
          key={item.id}
          className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-md border border-border px-3 py-2 text-sm"
        >
          <span className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 text-xs text-muted-foreground">#{index + 1}</span>
            <Link
              href={`/settings/assets/register/${item.id}`}
              className="text-primary hover:underline"
            >
              {item.label}
            </Link>
          </span>
          <span className="shrink-0 text-muted-foreground">{item.value}</span>
        </li>
      ))}
    </ul>
  );
}

// === Section G — Risk Signals ===

const RISK_SIGNAL_LABELS: Record<RiskSignal['type'], string> = {
  REPEAT_FAILURE: 'High Maintenance Frequency',
  HIGH_COST: 'High Maintenance Cost',
};

function RiskSignalsSection() {
  const query = useQuery({
    queryKey: ['maintenance-analytics-risk-signals'],
    queryFn: () => getRiskSignals(),
  });

  return (
    <SectionCard
      title="Risk Signals"
      subtitle="Deterministic operational signals — not predictions."
    >
      {query.isLoading && <SectionLoading />}
      {query.isError && (
        <SectionError
          message={
            query.error instanceof ApiError ? query.error.message : 'Failed to load risk signals.'
          }
          onRetry={() => query.refetch()}
        />
      )}
      {query.data &&
        (query.data.items.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No significant maintenance risks detected.
          </p>
        ) : (
          <ul className="space-y-3">
            {query.data.items.map((signal, index) => (
              <li
                key={`${signal.assetId}-${signal.type}-${index}`}
                className="rounded-md border border-border p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <Link
                      href={`/settings/assets/register/${signal.assetId}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {signal.assetCode} — {signal.name}
                    </Link>
                    <Badge
                      variant={signal.type === 'HIGH_COST' ? 'destructive' : 'warning'}
                      className="ml-2"
                    >
                      {RISK_SIGNAL_LABELS[signal.type]}
                    </Badge>
                  </div>
                  <div className="flex gap-2">
                    <Link href={`/settings/assets/register/${signal.assetId}`}>
                      <Button size="sm" variant="outline">
                        View Asset
                      </Button>
                    </Link>
                    <Link href={`/settings/maintenance/work-orders?assetId=${signal.assetId}`}>
                      <Button size="sm" variant="outline">
                        View Work Orders
                      </Button>
                    </Link>
                  </div>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{signal.detail}</p>
              </li>
            ))}
          </ul>
        ))}
    </SectionCard>
  );
}
