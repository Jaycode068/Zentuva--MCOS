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
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { FinanceTabs } from '@/components/app/finance-tabs';
import { ApiError } from '@/lib/api-client';
import { formatCurrency } from '@/lib/format-currency';

import {
  getCashflowAccountBreakdown,
  getCashflowForecast,
  listCashflowScenarios,
  upsertCashflowForecastAdjustment,
  type CashflowForecastBucket,
  type CashflowForecastLineItem,
} from '../api';
import {
  CASHFLOW_CONFIDENCE_LABELS,
  CASHFLOW_CONFIDENCE_VARIANT,
  CASHFLOW_SOURCE_TYPE_LABELS,
} from '../labels';

const HORIZON_OPTIONS = [30, 60, 90, 180, 365];

/**
 * Cashflow dashboard (Sprint 15, docs/domains/cashflow.md) — the forecast is
 * never persisted anywhere; every figure on this page is recomputed live, on
 * every request, from AR/AP outstanding balances, Cash Account book balances,
 * and management-entered Cashflow Items. An invoice's due date is an
 * expectation, never a guaranteed payment date.
 */
export default function CashflowDashboardPage() {
  const queryClient = useQueryClient();
  const [horizonDays, setHorizonDays] = useState(90);
  const [bucketBy, setBucketBy] = useState<'weekly' | 'monthly'>('weekly');
  const [scenarioId, setScenarioId] = useState('');
  const [expandedBucket, setExpandedBucket] = useState<number | null>(null);

  const { data: scenariosData } = useQuery({
    queryKey: ['cashflow-scenarios'],
    queryFn: () => listCashflowScenarios({ status: 'ACTIVE' }),
  });
  const scenarios = scenariosData?.items ?? [];

  const {
    data: forecast,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['cashflow-forecast', horizonDays, bucketBy, scenarioId],
    queryFn: () =>
      getCashflowForecast({
        horizonDays,
        bucketBy,
        scenarioId: scenarioId || undefined,
      }),
  });

  const { data: accountBreakdown } = useQuery({
    queryKey: ['cashflow-account-breakdown', horizonDays],
    queryFn: () => getCashflowAccountBreakdown(horizonDays),
  });

  const chartData = useMemo(
    () =>
      (forecast?.buckets ?? []).map((bucket) => ({
        name: bucket.label,
        closingBalance: bucket.closingBalance,
        inflows: bucket.inflows,
        outflows: bucket.outflows,
        belowMinimumReserve: bucket.belowMinimumReserve,
      })),
    [forecast],
  );

  const invalidateForecast = () => {
    queryClient.invalidateQueries({ queryKey: ['cashflow-forecast'] });
  };

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Finance</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          A forward-looking projection of Opening Cash + Inflows − Outflows = Closing Cash. Due
          dates are expectations, not guaranteed payment dates — figures are never stored, only
          computed live from Accounts Receivable, Accounts Payable, and Cash Accounts.
        </p>
      </div>

      <FinanceTabs />

      <div className="mb-8 flex flex-wrap items-end gap-4">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Horizon</label>
          <Select
            value={String(horizonDays)}
            onChange={(event) => setHorizonDays(Number(event.target.value))}
          >
            {HORIZON_OPTIONS.map((days) => (
              <option key={days} value={days}>
                {days} days
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Buckets</label>
          <Select
            value={bucketBy}
            onChange={(event) => setBucketBy(event.target.value as 'weekly' | 'monthly')}
          >
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </Select>
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Scenario</label>
          <Select value={scenarioId} onChange={(event) => setScenarioId(event.target.value)}>
            <option value="">Base (no scenario)</option>
            {scenarios.map((scenario) => (
              <option key={scenario.id} value={scenario.id}>
                {scenario.name}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {isLoading && (
        <p className="py-10 text-center text-sm text-muted-foreground">Computing forecast…</p>
      )}
      {isError && (
        <p className="py-10 text-center text-sm text-destructive">
          {error instanceof ApiError ? error.message : 'Failed to load the forecast.'}
        </p>
      )}

      {forecast && (
        <>
          {forecast.shortfallDetected && (
            <div className="mb-6 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              Projected cash falls below the management-defined minimum reserve (
              {formatCurrency(forecast.minimumCashReserve, 'NGN')}) in at least one period within
              this horizon. This is a planning signal, not a claim of insolvency.
            </div>
          )}

          <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <SummaryCard title="Current Cash" value={formatCurrency(forecast.currentCash, 'NGN')} />
            <SummaryCard
              title="Forecast Closing Cash"
              value={formatCurrency(forecast.forecastClosingCash, 'NGN')}
            />
            <SummaryCard
              title="Lowest Projected Cash"
              value={formatCurrency(forecast.lowestProjectedCash, 'NGN')}
              warn={forecast.lowestProjectedCash < forecast.minimumCashReserve}
            />
            <SummaryCard
              title="Expected Inflows"
              value={formatCurrency(forecast.totalExpectedInflows, 'NGN')}
            />
            <SummaryCard
              title="Expected Outflows"
              value={formatCurrency(forecast.totalExpectedOutflows, 'NGN')}
            />
          </div>

          <div className="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Projected Cash Balance vs Minimum Reserve
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                      <YAxis
                        tick={{ fontSize: 11 }}
                        tickFormatter={(value) => formatCurrency(value, 'NGN')}
                        width={90}
                      />
                      <Tooltip formatter={(value) => formatCurrency(Number(value), 'NGN')} />
                      <ReferenceLine
                        y={forecast.minimumCashReserve}
                        stroke="hsl(var(--destructive))"
                        strokeDasharray="4 4"
                        label={{ value: 'Min Reserve', fontSize: 10, position: 'insideTopRight' }}
                      />
                      <Bar dataKey="closingBalance" radius={[4, 4, 0, 0]}>
                        {chartData.map((entry, index) => (
                          <Cell
                            key={index}
                            fill={
                              entry.belowMinimumReserve
                                ? 'hsl(var(--destructive))'
                                : 'hsl(var(--primary))'
                            }
                          />
                        ))}
                      </Bar>
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Inflows vs Outflows by Period
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-64 w-full">
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
                      <Bar dataKey="inflows" fill="hsl(var(--success))" radius={[4, 4, 0, 0]} />
                      <Bar
                        dataKey="outflows"
                        fill="hsl(var(--destructive))"
                        radius={[4, 4, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
            <BreakdownCard title="Inflows by Source" rows={forecast.inflowBreakdown} />
            <BreakdownCard title="Outflows by Source" rows={forecast.outflowBreakdown} />
          </div>

          <Card className="mb-8">
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Forecast by Period
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {forecast.buckets.map((bucket, index) => (
                <BucketRow
                  key={index}
                  bucket={bucket}
                  expanded={expandedBucket === index}
                  onToggle={() => setExpandedBucket(expandedBucket === index ? null : index)}
                  onAdjusted={invalidateForecast}
                />
              ))}
            </CardContent>
          </Card>

          {accountBreakdown && accountBreakdown.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Forecast by Cash Account
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="mb-3 text-xs text-muted-foreground">
                  Each account&apos;s own projection includes only items explicitly assigned to it —
                  outstanding AR/AP is shown only in the consolidated view above, since money not
                  yet collected or paid cannot be attributed to a specific account.
                </p>
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full text-sm">
                    <thead className="border-b border-border bg-muted/50 text-left">
                      <tr>
                        <th className="px-4 py-3 font-medium">Account</th>
                        <th className="px-4 py-3 text-right font-medium">Current Balance</th>
                        <th className="px-4 py-3 text-right font-medium">Projected Closing</th>
                      </tr>
                    </thead>
                    <tbody>
                      {accountBreakdown.map((row) => (
                        <tr
                          key={row.cashAccountId}
                          className="border-b border-border last:border-0"
                        >
                          <td className="px-4 py-3">
                            {row.name}{' '}
                            <span className="text-xs text-muted-foreground">
                              ({row.accountCode})
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            {formatCurrency(row.currentBalance, 'NGN')}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {formatCurrency(row.projectedClosing, 'NGN')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </main>
  );
}

function SummaryCard({ title, value, warn }: { title: string; value: string; warn?: boolean }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className={`text-2xl font-semibold ${warn ? 'text-destructive' : ''}`}>{value}</p>
      </CardContent>
    </Card>
  );
}

function BreakdownCard({
  title,
  rows,
}: {
  title: string;
  rows: { sourceType: keyof typeof CASHFLOW_SOURCE_TYPE_LABELS; total: number }[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing in this horizon.</p>
        ) : (
          <ul className="space-y-2">
            {rows.map((row) => (
              <li key={row.sourceType} className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  {CASHFLOW_SOURCE_TYPE_LABELS[row.sourceType]}
                </span>
                <span className="font-medium">{formatCurrency(row.total, 'NGN')}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function BucketRow({
  bucket,
  expanded,
  onToggle,
  onAdjusted,
}: {
  bucket: CashflowForecastBucket;
  expanded: boolean;
  onToggle: () => void;
  onAdjusted: () => void;
}) {
  return (
    <div
      className={`rounded-lg border ${bucket.belowMinimumReserve ? 'border-destructive/40' : 'border-border'}`}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full flex-wrap items-center justify-between gap-2 px-4 py-3 text-left"
      >
        <div>
          <p className="text-sm font-medium">{bucket.label}</p>
          <p className="text-xs text-muted-foreground">
            Opening {formatCurrency(bucket.openingBalance, 'NGN')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <span className="text-success">+{formatCurrency(bucket.inflows, 'NGN')}</span>
          <span className="text-destructive">−{formatCurrency(bucket.outflows, 'NGN')}</span>
          <span className={`font-semibold ${bucket.belowMinimumReserve ? 'text-destructive' : ''}`}>
            {formatCurrency(bucket.closingBalance, 'NGN')}
          </span>
          {bucket.belowMinimumReserve && <Badge variant="destructive">Below Reserve</Badge>}
        </div>
      </button>
      {expanded && (
        <div className="border-t border-border px-4 py-3">
          {bucket.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">No individual items in this period.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-left text-muted-foreground">
                  <tr>
                    <th className="py-1.5 pr-4 font-medium">Description</th>
                    <th className="py-1.5 pr-4 font-medium">Source</th>
                    <th className="py-1.5 pr-4 font-medium">Confidence</th>
                    <th className="py-1.5 pr-4 font-medium">Expected Date</th>
                    <th className="py-1.5 pr-4 text-right font-medium">Amount</th>
                    <th className="py-1.5 text-right font-medium">Adjust</th>
                  </tr>
                </thead>
                <tbody>
                  {bucket.items.map((item, index) => (
                    <ForecastItemRow key={index} item={item} onAdjusted={onAdjusted} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ForecastItemRow({
  item,
  onAdjusted,
}: {
  item: CashflowForecastLineItem;
  onAdjusted: () => void;
}) {
  const [adjusting, setAdjusting] = useState(false);
  const [date, setDate] = useState(item.expectedDate.slice(0, 10));
  const [amount, setAmount] = useState(item.amount);

  const canAdjust =
    item.sourceType === 'CUSTOMER_RECEIVABLE' || item.sourceType === 'SUPPLIER_PAYABLE';

  const mutation = useMutation({
    mutationFn: () =>
      upsertCashflowForecastAdjustment({
        sourceType: item.sourceType as 'CUSTOMER_RECEIVABLE' | 'SUPPLIER_PAYABLE',
        sourceId: item.sourceId,
        adjustedExpectedDate: date,
        adjustedAmount: amount,
        idempotencyKey: crypto.randomUUID(),
      }),
    onSuccess: () => {
      setAdjusting(false);
      onAdjusted();
    },
  });

  return (
    <>
      <tr className="border-t border-border/60">
        <td className="py-1.5 pr-4">{item.description}</td>
        <td className="py-1.5 pr-4 text-muted-foreground">
          {CASHFLOW_SOURCE_TYPE_LABELS[item.sourceType]}
        </td>
        <td className="py-1.5 pr-4">
          <Badge variant={CASHFLOW_CONFIDENCE_VARIANT[item.confidence]}>
            {CASHFLOW_CONFIDENCE_LABELS[item.confidence]}
          </Badge>
          {item.adjusted && <span className="ml-1 text-muted-foreground">(adjusted)</span>}
        </td>
        <td className="py-1.5 pr-4">{new Date(item.expectedDate).toLocaleDateString()}</td>
        <td className="py-1.5 pr-4 text-right">{formatCurrency(item.amount, 'NGN')}</td>
        <td className="py-1.5 text-right">
          {canAdjust && (
            <button
              type="button"
              onClick={() => setAdjusting((value) => !value)}
              className="text-muted-foreground hover:text-foreground"
            >
              {adjusting ? 'Cancel' : 'Adjust'}
            </button>
          )}
        </td>
      </tr>
      {adjusting && (
        <tr className="border-t border-border/60 bg-muted/30">
          <td colSpan={6} className="px-2 py-2">
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <label className="text-[10px] text-muted-foreground">Expected Date</label>
                <Input
                  type="date"
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                  className="h-8"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] text-muted-foreground">Amount</label>
                <Input
                  type="number"
                  step="any"
                  value={amount}
                  onChange={(event) => setAmount(Number(event.target.value))}
                  className="h-8 w-32"
                />
              </div>
              <Button size="sm" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
                {mutation.isPending ? 'Saving…' : 'Save Adjustment'}
              </Button>
              <p className="text-[10px] text-muted-foreground">
                Overrides only this forecast&apos;s expected date/amount — the original invoice is
                never modified.
              </p>
            </div>
            {mutation.isError && (
              <p className="mt-1 text-xs text-destructive">
                {mutation.error instanceof ApiError
                  ? mutation.error.message
                  : 'Failed to save adjustment.'}
              </p>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
