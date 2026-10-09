'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent } from '@zentuva/ui';

import { getProductionPerformanceReport } from '../api';
import type { ComparisonMode, ReportingPeriodPreset } from '../api';
import { ExportButton } from '@/components/reporting/export-button';
import { PeriodSelector } from '@/components/reporting/period-selector';
import { ReportDataTable, ReportPagination } from '@/components/reporting/report-data-table';
import { ReportPageHeader } from '@/components/reporting/report-page-header';
import { ReportError, ReportLoading } from '@/components/reporting/report-states';
import { SummaryCard } from '@/components/reporting/summary-card';

const COLUMNS = [
  { key: 'productionOrderNumber', label: 'Order', type: 'STRING' as const },
  { key: 'productName', label: 'Product', type: 'STRING' as const },
  { key: 'plannedQuantity', label: 'Planned', type: 'NUMBER' as const },
  { key: 'acceptedQuantity', label: 'Accepted', type: 'NUMBER' as const },
  { key: 'rejectedQuantity', label: 'Rejected', type: 'NUMBER' as const },
  { key: 'yieldPercent', label: 'Yield %', type: 'PERCENT' as const },
  { key: 'materialCost', label: 'Material Cost', type: 'CURRENCY' as const },
  { key: 'completedAt', label: 'Completed', type: 'DATE' as const },
];

function calculatePercentChange(current: number, previous: number | null): number | null {
  if (previous == null || previous === 0) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}

export default function ProductionPerformancePage() {
  const [preset, setPreset] = useState<ReportingPeriodPreset>('this_month');
  const [comparison, setComparison] = useState<ComparisonMode>('none');
  const [page, setPage] = useState(1);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['reporting-production-performance', preset, comparison, page],
    queryFn: () => getProductionPerformanceReport({ preset, comparison }, { page, pageSize: 25 }),
  });

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <ReportPageHeader
        title="Production Performance"
        description="Planned versus actual output for completed production orders — material cost only; this codebase has no labour/overhead costing yet."
        actions={
          <>
            <PeriodSelector
              preset={preset}
              comparison={comparison}
              onChange={(p, c) => {
                setPreset(p);
                setComparison(c);
                setPage(1);
              }}
            />
            <ExportButton
              path={`/reporting/reports/production-performance/export?preset=${preset}&comparison=${comparison}`}
              filename="production-performance.csv"
            />
          </>
        }
      />

      {isLoading && <ReportLoading />}
      {isError && <ReportError message="Failed to load the production performance report." />}

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
            />
            <SummaryCard label="Rejected" value={data.totalRejected.toLocaleString('en-NG')} />
            <SummaryCard
              label="Material Cost"
              value={data.totalMaterialCost.toLocaleString('en-NG', {
                style: 'currency',
                currency: 'NGN',
              })}
            />
          </div>
          <Card>
            <CardContent className="p-4">
              <ReportDataTable columns={COLUMNS} rows={data.table.rows} />
              <ReportPagination
                page={data.table.page}
                pageSize={data.table.pageSize}
                total={data.table.total}
                onPageChange={setPage}
              />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
