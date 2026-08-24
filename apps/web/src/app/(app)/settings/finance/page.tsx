'use client';

import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@zentuva/ui';

import { FinanceTabs } from '@/components/app/finance-tabs';
import { formatCurrency } from '@/lib/format-currency';
import { ApiError } from '@/lib/api-client';

import { getArSummary } from './api';

/**
 * Finance Overview (Sprint 6, docs/domains/finance.md) — deliberately lightweight: four
 * summary cards, no executive analytics. Every figure is derived server-side from
 * `Invoice`/`Payment` rows (`groupBy`/`aggregate`), never a cached balance.
 */
export default function FinanceOverviewPage() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['finance-ar-summary'],
    queryFn: () => getArSummary(),
  });

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Finance</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Invoices, payments, credit notes, and accounts receivable — the financial consequence of
          what Sales, Inventory, and Distribution have already recorded.
        </p>
      </div>

      <FinanceTabs />

      {isLoading && (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading overview…</p>
      )}
      {isError && (
        <p className="py-10 text-center text-sm text-destructive">
          {error instanceof ApiError ? error.message : 'Failed to load overview.'}
        </p>
      )}

      {data && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryCard
            title="Total Outstanding"
            value={formatCurrency(data.totalOutstanding, 'NGN')}
          />
          <SummaryCard
            title="Overdue"
            value={formatCurrency(data.totalOverdue, 'NGN')}
            destructive
          />
          <SummaryCard
            title="Invoiced This Period"
            value={formatCurrency(data.invoicedThisPeriod, 'NGN')}
          />
          <SummaryCard
            title="Payments Received"
            value={formatCurrency(data.paymentsReceivedThisPeriod, 'NGN')}
          />
        </div>
      )}
    </main>
  );
}

function SummaryCard({
  title,
  value,
  destructive,
}: {
  title: string;
  value: string;
  destructive?: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className={`text-2xl font-semibold ${destructive ? 'text-destructive' : ''}`}>{value}</p>
      </CardContent>
    </Card>
  );
}
