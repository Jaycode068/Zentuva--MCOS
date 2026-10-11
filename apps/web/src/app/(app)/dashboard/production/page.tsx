'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@zentuva/ui';
import Link from 'next/link';

import { calculatePercentChange, getProductionPerformanceReport } from '../../reports/api';
import type { ComparisonMode, ReportingPeriodPreset } from '../../reports/api';
import { PeriodSelector } from '@/components/reporting/period-selector';
import { ReportError, ReportLoading } from '@/components/reporting/report-states';
import { ReportPageHeader } from '@/components/reporting/report-page-header';
import { SummaryCard } from '@/components/reporting/summary-card';
import { formatCurrency } from '@/lib/format-currency';
import { getWorkspaceSettings } from '@/lib/settings';

/**
 * Sprint 46 — Management Dashboards (brief §6D "Production Dashboard"). Reuses
 * `production-performance` verbatim. **Material cost only** — this codebase has no
 * labour/overhead costing (Sprint 45 finding, unchanged); this page never labels
 * `materialCost` as a complete production cost or profitability measure, per the
 * brief's own explicit instruction.
 */
export default function ProductionDashboardPage() {
  const [preset, setPreset] = useState<ReportingPeriodPreset>('this_month');
  const [comparison, setComparison] = useState<ComparisonMode>('previous_period');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['dashboard-production', preset, comparison],
    queryFn: () =>
      getProductionPerformanceReport({ preset, comparison }, { page: 1, pageSize: 10 }),
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
        title="Production Dashboard"
        description="Planned versus actual output for completed production orders. Material cost only — no labour/overhead costing exists in this codebase yet."
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
      {isError && <ReportError message="Failed to load the production dashboard." />}

      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <SummaryCard
              label="Accepted Output"
              value={data.totalAccepted.toLocaleString('en-NG')}
              percentChange={
                comparison !== 'none'
                  ? calculatePercentChange(data.totalAccepted, data.comparisonTotalAccepted)
                  : undefined
              }
              href="/reports/production-performance"
            />
            <SummaryCard
              label="Rejected"
              value={data.totalRejected.toLocaleString('en-NG')}
              favorableDirection="down"
            />
            <SummaryCard
              label="Material Cost"
              value={money(data.totalMaterialCost)}
              favorableDirection="neutral"
            />
          </div>

          <div className="flex justify-end">
            <Link href="/reports/production-performance">
              <Button variant="outline" size="sm">
                View Full Production Performance Report
              </Button>
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
