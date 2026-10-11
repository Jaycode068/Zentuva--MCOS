'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent } from '@zentuva/ui';
import Link from 'next/link';

import { getExecutiveDashboard } from '../reports/api';
import type { ComparisonMode, ReportingPeriodPreset } from '../reports/api';
import { ActivityFeed } from '@/components/reporting/activity-feed';
import {
  HealthIndicatorList,
  type HealthIndicatorItem,
} from '@/components/reporting/health-indicator-list';
import { PeriodSelector } from '@/components/reporting/period-selector';
import { ReportError, ReportLoading } from '@/components/reporting/report-states';
import { SummaryCard } from '@/components/reporting/summary-card';
import { TrendChart } from '@/components/reporting/trend-chart';
import { formatCurrency } from '@/lib/format-currency';
import { getWorkspaceSettings } from '@/lib/settings';

/**
 * Sprint 46 — Executive & Management Dashboards (docs/domains/reporting.md
 * "Executive Dashboard"). The primary landing experience for an authorized
 * executive user — "how is the business performing, what changed, what requires
 * attention, where can I investigate further" (brief §4). Every figure here comes
 * from `GET /reporting/dashboard/executive`, which itself composes only
 * already-authoritative domain services (see `ExecutiveDashboardService`'s own
 * backend doc comment) — this page performs NO calculation of its own beyond
 * formatting and the one shared `calculatePercentChange` ALREADY used by every other
 * report page (brief §5B "never calculate a different KPI formula in the frontend").
 *
 * A `null` section below means the viewer lacks that domain's own existing
 * permission (brief §8) — rendered by simply omitting it, the exact same convention
 * `reports/operational-exceptions/page.tsx` already established; never a visible
 * "access denied" card (which would itself leak that the section exists) and never a
 * fabricated zero.
 */
export default function ExecutiveDashboardPage() {
  const [preset, setPreset] = useState<ReportingPeriodPreset>('this_month');
  const [comparison, setComparison] = useState<ComparisonMode>('previous_period');

  const { data, isLoading, isError, dataUpdatedAt } = useQuery({
    queryKey: ['reporting-executive-dashboard', preset, comparison],
    queryFn: () => getExecutiveDashboard({ preset, comparison }),
  });
  const { data: workspace } = useQuery({
    queryKey: ['workspace-settings-for-dashboard'],
    queryFn: getWorkspaceSettings,
    staleTime: 5 * 60 * 1000,
  });
  const currency = workspace?.currency ?? 'NGN';
  const money = (value: number) => formatCurrency(value, currency);

  const healthItems: HealthIndicatorItem[] = [];
  if (data?.finance) {
    healthItems.push({
      label: 'Overdue Receivables',
      status: data.finance.receivablesOverdue > 0 ? 'attention' : 'ok',
      detail:
        data.finance.receivablesOverdue > 0
          ? `${money(data.finance.receivablesOverdue)} past due`
          : 'No customer invoices are past due.',
      href: '/reports/receivables',
    });
    healthItems.push({
      label: 'Overdue Payables',
      status: data.finance.payablesOverdue > 0 ? 'attention' : 'ok',
      detail:
        data.finance.payablesOverdue > 0
          ? `${money(data.finance.payablesOverdue)} past due to suppliers`
          : 'No supplier invoices are past due.',
      href: '/reports/payables',
    });
  }
  if (
    data?.exceptions.pendingApprovalsCount !== null &&
    data?.exceptions.pendingApprovalsCount !== undefined
  ) {
    healthItems.push({
      label: 'Pending Approvals',
      status: data.exceptions.pendingApprovalsCount > 0 ? 'attention' : 'ok',
      detail:
        data.exceptions.pendingApprovalsCount > 0
          ? `${data.exceptions.pendingApprovalsCount} workflow step(s) awaiting action`
          : 'No approvals are currently pending.',
      href: '/reports/operational-exceptions',
    });
  }
  if (
    data?.exceptions.overdueMaintenanceCount !== null &&
    data?.exceptions.overdueMaintenanceCount !== undefined
  ) {
    healthItems.push({
      label: 'Overdue Maintenance',
      status: data.exceptions.overdueMaintenanceCount > 0 ? 'attention' : 'ok',
      detail:
        data.exceptions.overdueMaintenanceCount > 0
          ? `${data.exceptions.overdueMaintenanceCount} work order(s) past their planned end date`
          : 'No maintenance work orders are overdue.',
      href: '/reports/operational-exceptions',
    });
  }
  if (
    data?.exceptions.failedNotificationsCount !== null &&
    data?.exceptions.failedNotificationsCount !== undefined
  ) {
    healthItems.push({
      label: 'Failed Notifications',
      status: data.exceptions.failedNotificationsCount > 0 ? 'attention' : 'ok',
      detail:
        data.exceptions.failedNotificationsCount > 0
          ? `${data.exceptions.failedNotificationsCount} delivery attempt(s) failed`
          : 'No notification deliveries are currently failing.',
      href: '/reports/operational-exceptions',
    });
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Executive Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            How the business is performing, what changed, and what needs your attention.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <PeriodSelector
            preset={preset}
            comparison={comparison}
            onChange={(p, c) => {
              setPreset(p);
              setComparison(c);
            }}
          />
          {dataUpdatedAt > 0 && (
            <p className="text-xs text-muted-foreground">
              Last updated {new Date(dataUpdatedAt).toLocaleTimeString('en-NG')}
            </p>
          )}
        </div>
      </div>

      {isLoading && <ReportLoading />}
      {isError && <ReportError message="Failed to load the executive dashboard." />}

      {data && (
        <>
          {/* Section B — Business Performance Summary. A deliberately small,
           *  curated set of KPIs, each reused from the exact figure its own report
           *  page already shows — never every metric in the registry at once. */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {data.finance && (
              <>
                <SummaryCard
                  label="Net Revenue"
                  value={money(data.finance.netRevenue.value)}
                  percentChange={
                    comparison !== 'none' ? data.finance.netRevenue.percentChange : undefined
                  }
                  favorableDirection="up"
                  href="/reports/sales-performance"
                />
                <SummaryCard
                  label="Gross Profit"
                  value={money(data.finance.grossProfit.value)}
                  percentChange={
                    comparison !== 'none' ? data.finance.grossProfit.percentChange : undefined
                  }
                  favorableDirection="up"
                />
                <SummaryCard
                  label="Receivables Outstanding"
                  value={money(data.finance.receivablesOutstanding)}
                  favorableDirection="neutral"
                  href="/reports/receivables"
                />
                <SummaryCard
                  label="Payables Outstanding"
                  value={money(data.finance.payablesOutstanding)}
                  favorableDirection="neutral"
                  href="/reports/payables"
                />
              </>
            )}
            {data.inventory && (
              <SummaryCard
                label="Inventory Value"
                value={money(data.inventory.value)}
                favorableDirection="neutral"
                href="/reports/inventory-position"
              />
            )}
            {data.sales && (
              <SummaryCard
                label="Sales Orders"
                value={data.sales.orderCount.value.toLocaleString('en-NG')}
                percentChange={
                  comparison !== 'none' ? data.sales.orderCount.percentChange : undefined
                }
                favorableDirection="up"
                href="/reports/sales-performance"
              />
            )}
            {data.production && (
              <SummaryCard
                label="Production Output (Accepted)"
                value={data.production.acceptedOutput.value.toLocaleString('en-NG')}
                percentChange={
                  comparison !== 'none' ? data.production.acceptedOutput.percentChange : undefined
                }
                favorableDirection="up"
                href="/reports/production-performance"
              />
            )}
            {data.workforce && (
              <SummaryCard
                label="Active Headcount"
                value={data.workforce.activeHeadcount.toLocaleString('en-NG')}
                favorableDirection="neutral"
                href="/reports/workforce-summary"
              />
            )}
          </div>

          {data.finance == null &&
            data.inventory == null &&
            data.sales == null &&
            data.production == null &&
            data.workforce == null && (
              <p className="text-sm text-muted-foreground">
                No business-performance metrics are visible to you — this reflects your current
                permissions. Contact an administrator for access.
              </p>
            )}

          {/* Section C — Business Trends. Only the two metrics whose source data
           *  actually supports a real day-by-day series — never a manufactured
           *  historical line from one current total. */}
          <div className="grid gap-4 lg:grid-cols-2">
            {data.sales && (
              <TrendChart
                title="Sales Order Value by Day"
                points={data.sales.trend.map((point) => ({
                  label: new Date(point.date).toLocaleDateString('en-NG', {
                    month: 'short',
                    day: 'numeric',
                  }),
                  value: point.totalRevenue,
                }))}
                valueFormatter={(v) => money(v)}
                emptyMessage="Not enough daily sales activity in this period to show a trend."
              />
            )}
            {data.production && (
              <TrendChart
                title="Accepted Production Output by Day"
                points={data.production.trend.map((point) => ({
                  label: new Date(point.date).toLocaleDateString('en-NG', {
                    month: 'short',
                    day: 'numeric',
                  }),
                  value: point.acceptedQuantity,
                }))}
                valueFormatter={(v) => v.toLocaleString('en-NG')}
                emptyMessage="Not enough completed production runs in this period to show a trend."
              />
            )}
          </div>

          {/* Section D — Business Health and Attention Required. */}
          <HealthIndicatorList items={healthItems} />

          {/* Section E — Recent Business Activity. */}
          {data.recentActivity !== null && <ActivityFeed rows={data.recentActivity} />}

          {/* Level 2 — Management Dashboards (brief §4 "Level 2"). Focused
           *  departmental views over the same reporting foundation, not a second
           *  set of links duplicated into the main sidebar. */}
          <div>
            <h2 className="mb-2 text-sm font-medium text-muted-foreground">
              Departmental Dashboards
            </h2>
            <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
              {[
                { label: 'Sales', href: '/dashboard/sales' },
                { label: 'Finance', href: '/dashboard/finance' },
                { label: 'Inventory', href: '/dashboard/inventory' },
                { label: 'Production', href: '/dashboard/production' },
                { label: 'Procurement', href: '/dashboard/procurement' },
                { label: 'Workforce', href: '/dashboard/workforce' },
              ].map((dept) => (
                <Link key={dept.href} href={dept.href}>
                  <Card className="transition-colors hover:border-primary">
                    <CardContent className="p-3 text-center text-sm font-medium">
                      {dept.label}
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
