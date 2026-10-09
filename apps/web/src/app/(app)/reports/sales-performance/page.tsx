'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent } from '@zentuva/ui';

import { getSalesPerformanceReport } from '../api';
import { ExportButton } from '@/components/reporting/export-button';
import { PeriodSelector } from '@/components/reporting/period-selector';
import { ReportDataTable, ReportPagination } from '@/components/reporting/report-data-table';
import { ReportPageHeader } from '@/components/reporting/report-page-header';
import { ReportError, ReportLoading } from '@/components/reporting/report-states';
import { SummaryCard } from '@/components/reporting/summary-card';
import type { ComparisonMode, ReportingPeriodPreset } from '../api';

const COLUMNS = [
  { key: 'orderCode', label: 'Order', type: 'STRING' as const },
  { key: 'customerName', label: 'Customer', type: 'STRING' as const },
  { key: 'status', label: 'Status', type: 'ENUM' as const },
  { key: 'orderDate', label: 'Order Date', type: 'DATE' as const },
  { key: 'total', label: 'Total', type: 'CURRENCY' as const },
];

function calculatePercentChange(current: number, previous: number | null): number | null {
  if (previous == null || previous === 0) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}

export default function SalesPerformancePage() {
  const [preset, setPreset] = useState<ReportingPeriodPreset>('this_month');
  const [comparison, setComparison] = useState<ComparisonMode>('none');
  const [page, setPage] = useState(1);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['reporting-sales-performance', preset, comparison, page],
    queryFn: () => getSalesPerformanceReport({ preset, comparison }, { page, pageSize: 25 }),
  });

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <ReportPageHeader
        title="Sales Performance"
        description="B2B sales order activity — net revenue and cost of sales come from the General Ledger, the same figures Finance's own reports show."
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
              path={`/reporting/reports/sales-performance/export?preset=${preset}&comparison=${comparison}`}
              filename="sales-performance.csv"
            />
          </>
        }
      />

      {isLoading && <ReportLoading />}
      {isError && <ReportError message="Failed to load the sales performance report." />}

      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <SummaryCard
              label="Net Revenue"
              value={data.revenue.totalRevenue.toLocaleString('en-NG', {
                style: 'currency',
                currency: 'NGN',
              })}
              percentChange={
                comparison !== 'none'
                  ? calculatePercentChange(data.revenue.totalRevenue, data.comparisonRevenue)
                  : undefined
              }
            />
            <SummaryCard label="Orders" value={String(data.table.total)} />
            <SummaryCard
              label="Distinct Customers"
              value={String(data.revenue.byCustomer.length)}
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
