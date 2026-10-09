'use client';

import { useQuery } from '@tanstack/react-query';
import { Card, CardContent } from '@zentuva/ui';

import { getPayablesReport } from '../api';
import { ExportButton } from '@/components/reporting/export-button';
import { ReportDataTable } from '@/components/reporting/report-data-table';
import { ReportPageHeader } from '@/components/reporting/report-page-header';
import { ReportError, ReportLoading } from '@/components/reporting/report-states';
import { SummaryCard } from '@/components/reporting/summary-card';

const COLUMNS = [
  { key: 'supplierCode', label: 'Code', type: 'STRING' as const },
  { key: 'supplierName', label: 'Supplier', type: 'STRING' as const },
  { key: 'current', label: 'Current', type: 'CURRENCY' as const },
  { key: 'days1To30', label: '1-30 Days', type: 'CURRENCY' as const },
  { key: 'days31To60', label: '31-60 Days', type: 'CURRENCY' as const },
  { key: 'days61To90', label: '61-90 Days', type: 'CURRENCY' as const },
  { key: 'days90Plus', label: '90+ Days', type: 'CURRENCY' as const },
  { key: 'totalOutstanding', label: 'Total', type: 'CURRENCY' as const },
];

function money(value: number) {
  return value.toLocaleString('en-NG', { style: 'currency', currency: 'NGN' });
}

export default function PayablesPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['reporting-payables'],
    queryFn: getPayablesReport,
  });

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <ReportPageHeader
        title="Payables Aging"
        description="Outstanding supplier invoice obligations, using the existing Finance Accounts Payable aging methodology."
        actions={<ExportButton path="/reporting/reports/payables/export" filename="payables.csv" />}
      />

      {isLoading && <ReportLoading />}
      {isError && <ReportError message="Failed to load the payables report." />}

      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <SummaryCard label="Total Outstanding" value={money(data.totalOutstanding)} />
            <SummaryCard
              label="Overdue (1+ days)"
              value={money(data.totalOutstanding - data.current)}
            />
            <SummaryCard label="Current (not yet due)" value={money(data.current)} />
          </div>
          <Card>
            <CardContent className="p-4">
              <ReportDataTable columns={COLUMNS} rows={data.bySupplier} />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
