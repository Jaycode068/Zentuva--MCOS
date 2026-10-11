'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@zentuva/ui';
import Link from 'next/link';

import { calculatePercentChange, getSalesPerformanceReport } from '../../reports/api';
import type { ComparisonMode, ReportingPeriodPreset } from '../../reports/api';
import { PeriodSelector } from '@/components/reporting/period-selector';
import { ReportError, ReportLoading } from '@/components/reporting/report-states';
import { ReportPageHeader } from '@/components/reporting/report-page-header';
import { SummaryCard } from '@/components/reporting/summary-card';
import { formatCurrency } from '@/lib/format-currency';
import { getWorkspaceSettings } from '@/lib/settings';

/**
 * Sprint 46 — Management Dashboards (brief §6A "Sales Dashboard"). A focused view
 * over the SAME `sales-performance` report every figure here already comes from —
 * never a second sales calculation. Territory attribution is deliberately NOT shown:
 * the Sprint 45 audit confirmed `SalesOrder` carries no reliable `territoryId`
 * relationship, so inferring one here would be exactly the "do not infer territory
 * attribution where a sales order lacks a reliable territory relationship" the
 * brief explicitly warns against (documented gap, not built).
 */
export default function SalesDashboardPage() {
  const [preset, setPreset] = useState<ReportingPeriodPreset>('this_month');
  const [comparison, setComparison] = useState<ComparisonMode>('previous_period');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['dashboard-sales', preset, comparison],
    queryFn: () => getSalesPerformanceReport({ preset, comparison }, { page: 1, pageSize: 5 }),
  });
  const { data: workspace } = useQuery({
    queryKey: ['workspace-settings-for-dashboard'],
    queryFn: getWorkspaceSettings,
    staleTime: 5 * 60 * 1000,
  });
  const money = (value: number) => formatCurrency(value, workspace?.currency ?? 'NGN');

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <ReportPageHeader
        title="Sales Dashboard"
        description="B2B sales performance — net revenue and cost of sales are GL-tied, the same figures Finance's own reports show."
        backHref="/dashboard"
        backLabel="← Executive Dashboard"
        actions={
          <PeriodSelector
            preset={preset}
            comparison={comparison}
            onChange={(p, c) => {
              setPreset(p);
              setComparison(c);
            }}
          />
        }
      />

      {isLoading && <ReportLoading />}
      {isError && <ReportError message="Failed to load the sales dashboard." />}

      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <SummaryCard
              label="Net Revenue"
              value={money(data.revenue.totalRevenue)}
              percentChange={
                comparison !== 'none'
                  ? calculatePercentChange(data.revenue.totalRevenue, data.comparisonRevenue)
                  : undefined
              }
              href="/reports/sales-performance"
            />
            <SummaryCard
              label="Orders"
              value={String(data.table.total)}
              href="/reports/sales-performance"
            />
            <SummaryCard
              label="Distinct Customers"
              value={String(data.revenue.byCustomer.length)}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-lg border border-border p-4">
              <h3 className="mb-2 text-sm font-medium text-muted-foreground">Top Products</h3>
              {data.revenue.byProduct.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No product revenue recorded this period.
                </p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {data.revenue.byProduct.slice(0, 5).map((row) => (
                    <li key={row.productId ?? row.productName} className="flex justify-between">
                      <span>{row.productName}</span>
                      <span className="font-medium">{money(row.totalRevenue)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="rounded-lg border border-border p-4">
              <h3 className="mb-2 text-sm font-medium text-muted-foreground">Top Customers</h3>
              {data.revenue.byCustomer.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No customer revenue recorded this period.
                </p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {data.revenue.byCustomer.slice(0, 5).map((row) => (
                    <li key={row.customerId} className="flex justify-between">
                      <span>{row.customerName}</span>
                      <span className="font-medium">{money(row.totalRevenue)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="flex justify-end">
            <Link href="/reports/sales-performance">
              <Button variant="outline" size="sm">
                View Full Sales Performance Report
              </Button>
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
