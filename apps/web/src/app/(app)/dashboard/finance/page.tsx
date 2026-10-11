'use client';

import { useQuery } from '@tanstack/react-query';
import { Button } from '@zentuva/ui';
import Link from 'next/link';

import { getPayablesReport, getReceivablesReport } from '../../reports/api';
import { ReportError, ReportLoading } from '@/components/reporting/report-states';
import { ReportPageHeader } from '@/components/reporting/report-page-header';
import { SummaryCard } from '@/components/reporting/summary-card';
import { formatCurrency } from '@/lib/format-currency';
import { getWorkspaceSettings } from '@/lib/settings';

/**
 * Sprint 46 — Management Dashboards (brief §6B "Finance Dashboard"). Reuses the
 * existing, already-authoritative Receivables/Payables Aging reports verbatim — no
 * second AR/AP calculation. Net revenue/gross profit/P&L live on the Executive
 * Dashboard and the pre-existing Finance `profit-loss`/`reports/dashboard` pages;
 * deliberately not duplicated a third time here, per brief §6's own "focused view,
 * not an independent reporting system."
 */
export default function FinanceDashboardPage() {
  const {
    data: receivables,
    isLoading: loadingAr,
    isError: errorAr,
  } = useQuery({
    queryKey: ['dashboard-finance-receivables'],
    queryFn: getReceivablesReport,
  });
  const {
    data: payables,
    isLoading: loadingAp,
    isError: errorAp,
  } = useQuery({
    queryKey: ['dashboard-finance-payables'],
    queryFn: getPayablesReport,
  });
  const { data: workspace } = useQuery({
    queryKey: ['workspace-settings-for-dashboard'],
    queryFn: getWorkspaceSettings,
    staleTime: 5 * 60 * 1000,
  });
  const money = (value: number) => formatCurrency(value, workspace?.currency ?? 'NGN');

  const isLoading = loadingAr || loadingAp;
  const isError = errorAr || errorAp;

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <ReportPageHeader
        title="Finance Dashboard"
        description="Receivables and payables aging, reused verbatim from Finance's own authoritative reports. See the Executive Dashboard for net revenue and gross profit."
        backHref="/dashboard"
        backLabel="← Executive Dashboard"
      />

      {isLoading && <ReportLoading />}
      {isError && <ReportError message="Failed to load the finance dashboard." />}

      {receivables && payables && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryCard
              label="Receivables Outstanding"
              value={money(receivables.totalOutstanding)}
              favorableDirection="neutral"
              href="/reports/receivables"
            />
            <SummaryCard
              label="Receivables Overdue"
              value={money(
                receivables.days1To30 +
                  receivables.days31To60 +
                  receivables.days61To90 +
                  receivables.days90Plus,
              )}
              favorableDirection="down"
              href="/reports/receivables"
            />
            <SummaryCard
              label="Payables Outstanding"
              value={money(payables.totalOutstanding)}
              favorableDirection="neutral"
              href="/reports/payables"
            />
            <SummaryCard
              label="Payables Overdue"
              value={money(
                payables.days1To30 +
                  payables.days31To60 +
                  payables.days61To90 +
                  payables.days90Plus,
              )}
              favorableDirection="down"
              href="/reports/payables"
            />
          </div>

          <div className="flex justify-end gap-2">
            <Link href="/reports/receivables">
              <Button variant="outline" size="sm">
                View Receivables Aging
              </Button>
            </Link>
            <Link href="/reports/payables">
              <Button variant="outline" size="sm">
                View Payables Aging
              </Button>
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
