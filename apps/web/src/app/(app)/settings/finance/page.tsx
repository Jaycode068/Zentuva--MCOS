'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, Select } from '@zentuva/ui';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { FinanceTabs } from '@/components/app/finance-tabs';
import { formatCurrency } from '@/lib/format-currency';
import { ApiError } from '@/lib/api-client';
import {
  REPORT_PERIOD_PRESET_LABELS,
  resolveReportDateRange,
  toDateInputValue,
  type ReportPeriodPreset,
} from '@/lib/report-date-range';

import {
  getCashOverview,
  getCashflowForecast,
  getDashboard,
  getDebtMetrics,
  listDecisionAnalyses,
} from './api';
import {
  DECISION_ANALYSIS_STATUS_LABELS,
  DECISION_ANALYSIS_STATUS_VARIANT,
  DECISION_TYPE_LABELS,
} from './labels';

/**
 * Management Dashboard (Sprint 13, docs/domains/accounting.md §16.5) — the Finance
 * Overview page upgraded from Sprint 6's four AR-only cards into the reusable
 * reporting foundation the brief asks for. Deliberately small: "what is happening in
 * my business right now," not every metric this codebase could produce (brief §18).
 * Every figure is *composed* from the more specific reports (`FinancialStatementService`,
 * AR/AP summaries, Inventory Valuation) — nothing here is recomputed independently.
 */
export default function FinanceOverviewPage() {
  const [preset, setPreset] = useState<ReportPeriodPreset>('this_month');
  const [compare, setCompare] = useState(true);
  const { from, to } = resolveReportDateRange(preset);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['finance-dashboard', from.toISOString(), to.toISOString(), compare],
    queryFn: () =>
      getDashboard({ from: toDateInputValue(from), to: toDateInputValue(to), compare }),
  });

  // Added Sprint 14 — a couple of cross-link cards into the Cash & Bank workspace
  // (docs/domains/cash-management.md §14), not a full second dashboard bolted on
  // here — the Cash Position Dashboard lives at its own `/settings/finance/cash`.
  const { data: cashOverview } = useQuery({
    queryKey: ['cash-overview'],
    queryFn: () => getCashOverview(),
  });

  // Added Sprint 19 — "Where Are We Going?" and "Active Decisions" cross-
  // link sections (docs/domains/financial-decision-analysis.md), the same
  // couple-of-cross-link-cards restraint Sprint 14 established: every
  // figure below is sourced from an *existing* endpoint (Cashflow Forecast,
  // Debt Metrics, Decision Analyses list) — no new backend calculation.
  const { data: forecast } = useQuery({
    queryKey: ['finance-overview-forecast'],
    queryFn: () => getCashflowForecast({ horizonDays: 90, bucketBy: 'monthly' }),
  });
  const { data: debtMetrics } = useQuery({
    queryKey: ['finance-overview-debt-metrics'],
    queryFn: () => getDebtMetrics(),
  });
  const { data: decisionsData } = useQuery({
    queryKey: ['finance-overview-decisions'],
    queryFn: () => listDecisionAnalyses(),
  });
  const activeDecisions = (decisionsData?.items ?? [])
    .filter((analysis) => analysis.status === 'UNDER_REVIEW' || analysis.status === 'APPROVED')
    .slice(0, 3);

  const current = data?.pnl.current;
  const previous = data?.pnl.previous;

  const revenueCogsChart = current
    ? [
        { name: 'Revenue', value: current.revenue },
        { name: 'COGS', value: current.costOfSales },
        { name: 'Gross Profit', value: current.grossProfit },
      ]
    : [];
  const arApChart = data
    ? [
        { name: 'AR', value: data.ar.totalOutstanding },
        { name: 'AP', value: data.ap.totalOutstanding },
      ]
    : [];

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Finance</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          What is happening in the business right now — revenue, cost, profitability, and
          what&apos;s owed, reconciled against the General Ledger.
        </p>
      </div>

      <FinanceTabs />

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Select
          value={preset}
          onChange={(event) => setPreset(event.target.value as ReportPeriodPreset)}
          className="max-w-[10rem]"
        >
          {Object.entries(REPORT_PERIOD_PRESET_LABELS)
            .filter(([value]) => value !== 'custom')
            .map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
        </Select>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={compare}
            onChange={(event) => setCompare(event.target.checked)}
          />
          Compare to previous period
        </label>
      </div>

      {isLoading && (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading overview…</p>
      )}
      {isError && (
        <p className="py-10 text-center text-sm text-destructive">
          {error instanceof ApiError ? error.message : 'Failed to load overview.'}
        </p>
      )}

      {data && current && (
        <>
          <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Financial
          </p>
          <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryCard
              title="Revenue"
              value={formatCurrency(current.revenue, 'NGN')}
              delta={previous ? current.revenue - previous.revenue : undefined}
            />
            <SummaryCard title="COGS" value={formatCurrency(current.costOfSales, 'NGN')} />
            <SummaryCard
              title="Gross Profit"
              value={formatCurrency(current.grossProfit, 'NGN')}
              delta={previous ? current.grossProfit - previous.grossProfit : undefined}
            />
            <SummaryCard
              title="Gross Margin"
              value={
                current.grossMarginPercent === null
                  ? '—'
                  : `${current.grossMarginPercent.toFixed(1)}%`
              }
            />
            <SummaryCard
              title="Net Profit"
              value={formatCurrency(current.netProfit, 'NGN')}
              delta={previous ? current.netProfit - previous.netProfit : undefined}
            />
            <SummaryCard
              title="Accounts Receivable"
              value={formatCurrency(data.ar.totalOutstanding, 'NGN')}
            />
            <SummaryCard
              title="Accounts Payable"
              value={formatCurrency(data.ap.totalOutstanding, 'NGN')}
            />
            <SummaryCard
              title="Inventory Value"
              value={formatCurrency(data.inventoryValue, 'NGN')}
            />
          </div>

          {compare && !previous && (
            <p className="mb-8 text-sm text-muted-foreground">
              No comparison data — the previous period has no posted activity.
            </p>
          )}

          <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Operational
          </p>
          <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <SummaryCard title="Sales Orders" value={String(data.operational.salesOrderCount)} />
            <SummaryCard
              title="Sales Order Value"
              value={formatCurrency(data.operational.salesOrderTotal, 'NGN')}
            />
            <SummaryCard
              title="Production Runs Completed"
              value={String(data.operational.productionOrdersCompleted)}
            />
          </div>

          <div className="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
            <ChartCard title="Revenue vs. COGS vs. Gross Profit" data={revenueCogsChart} />
            <ChartCard title="Accounts Receivable vs. Accounts Payable" data={arApChart} />
          </div>

          {cashOverview && (
            <>
              <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Cash &amp; Bank
              </p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Link href="/settings/finance/cash">
                  <Card className="h-full transition-colors hover:border-primary/50">
                    <CardHeader>
                      <CardTitle className="text-sm font-medium text-muted-foreground">
                        Total Cash
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-2xl font-semibold">
                        {formatCurrency(cashOverview.totalCash, 'NGN')}
                      </p>
                    </CardContent>
                  </Card>
                </Link>
                <Link href="/settings/finance/cash">
                  <Card className="h-full transition-colors hover:border-primary/50">
                    <CardHeader>
                      <CardTitle className="text-sm font-medium text-muted-foreground">
                        Unreconciled
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p
                        className={`text-2xl font-semibold ${
                          cashOverview.totalUnreconciled > 0.01 ? 'text-destructive' : ''
                        }`}
                      >
                        {formatCurrency(cashOverview.totalUnreconciled, 'NGN')}
                      </p>
                    </CardContent>
                  </Card>
                </Link>
              </div>
            </>
          )}

          {(forecast || debtMetrics) && (
            <>
              <p className="mb-3 mt-8 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Where Are We Going?
              </p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {forecast && (
                  <Link href="/settings/finance/cashflow">
                    <Card className="h-full transition-colors hover:border-primary/50">
                      <CardHeader>
                        <CardTitle className="text-sm font-medium text-muted-foreground">
                          Forecast Closing Cash (90d)
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <p className="text-2xl font-semibold">
                          {formatCurrency(forecast.forecastClosingCash, 'NGN')}
                        </p>
                        {forecast.shortfallDetected && (
                          <p className="mt-1 text-xs text-destructive">
                            Projected cash dips below the minimum reserve
                          </p>
                        )}
                      </CardContent>
                    </Card>
                  </Link>
                )}
                {debtMetrics && (
                  <Link href="/settings/finance/debt">
                    <Card className="h-full transition-colors hover:border-primary/50">
                      <CardHeader>
                        <CardTitle className="text-sm font-medium text-muted-foreground">
                          Monthly Debt Service
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <p className="text-2xl font-semibold">
                          {formatCurrency(debtMetrics.monthlyDebtService, 'NGN')}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {formatCurrency(debtMetrics.outstandingPrincipal, 'NGN')} outstanding
                          principal
                        </p>
                      </CardContent>
                    </Card>
                  </Link>
                )}
              </div>
            </>
          )}

          {activeDecisions.length > 0 && (
            <>
              <p className="mb-3 mt-8 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                What Decisions Are Being Considered?
              </p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                {activeDecisions.map((analysis) => (
                  <Link key={analysis.id} href={`/settings/finance/decisions/${analysis.id}`}>
                    <Card className="h-full transition-colors hover:border-primary/50">
                      <CardHeader>
                        <CardTitle className="text-sm font-medium text-muted-foreground">
                          {analysis.name}
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <p className="text-xs text-muted-foreground">
                          {DECISION_TYPE_LABELS[analysis.decisionType]}
                        </p>
                        <span
                          className={`mt-2 inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${
                            DECISION_ANALYSIS_STATUS_VARIANT[analysis.status] === 'success'
                              ? 'bg-success/10 text-success'
                              : 'bg-warning/10 text-warning'
                          }`}
                        >
                          {DECISION_ANALYSIS_STATUS_LABELS[analysis.status]}
                        </span>
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </main>
  );
}

function SummaryCard({ title, value, delta }: { title: string; value: string; delta?: number }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold">{value}</p>
        {delta !== undefined && (
          <p className={`mt-1 text-xs ${delta >= 0 ? 'text-success' : 'text-destructive'}`}>
            {delta >= 0 ? '+' : ''}
            {formatCurrency(delta, 'NGN')} vs previous period
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function ChartCard({ title, data }: { title: string; data: { name: string; value: number }[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="name" tick={{ fontSize: 12 }} />
              <YAxis
                tick={{ fontSize: 12 }}
                tickFormatter={(value) => formatCurrency(value, 'NGN')}
                width={90}
              />
              <Tooltip formatter={(value) => formatCurrency(Number(value), 'NGN')} />
              <Bar dataKey="value" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
