'use client';

import { useQuery } from '@tanstack/react-query';

import { getProcurementSummaryReport } from '../../reports/api';
import { ReportDataTable } from '@/components/reporting/report-data-table';
import { ReportEmpty, ReportError, ReportLoading } from '@/components/reporting/report-states';
import { ReportPageHeader } from '@/components/reporting/report-page-header';
import { SummaryCard } from '@/components/reporting/summary-card';
import { formatCurrency } from '@/lib/format-currency';
import { getWorkspaceSettings } from '@/lib/settings';

const COLUMNS = [
  { key: 'purchaseOrderNumber', label: 'PO Number', type: 'STRING' as const },
  { key: 'supplierName', label: 'Supplier', type: 'STRING' as const },
  { key: 'status', label: 'Status', type: 'ENUM' as const },
  { key: 'orderDate', label: 'Order Date', type: 'DATE' as const },
  { key: 'total', label: 'Total', type: 'CURRENCY' as const },
];

/**
 * Sprint 46 — Management Dashboards (brief §6E "Procurement Dashboard"). Open
 * purchase orders are a new, narrow read (no existing report covered this before
 * Sprint 46); payables are reused verbatim from Finance's own `AccountsPayableService`
 * — the two figures are deliberately kept separate (commitments vs. invoiced
 * obligations) rather than summed, so no procurement obligation is ever counted
 * twice (brief's own explicit warning).
 */
export default function ProcurementDashboardPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['dashboard-procurement'],
    queryFn: getProcurementSummaryReport,
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
        title="Procurement Dashboard"
        description="Open purchase orders and outstanding supplier payables. Payables are reused verbatim from Finance — never double-counted against the purchase order commitments below."
        backHref="/dashboard"
        backLabel="← Executive Dashboard"
      />

      {isLoading && <ReportLoading />}
      {isError && <ReportError message="Failed to load the procurement dashboard." />}

      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryCard
              label="Open Purchase Orders"
              value={String(data.openPurchaseOrderCount)}
              favorableDirection="neutral"
            />
            <SummaryCard
              label="Open PO Value"
              value={money(data.openPurchaseOrderValue)}
              favorableDirection="neutral"
            />
            <SummaryCard
              label="Payables Outstanding"
              value={money(data.payables.totalOutstanding)}
              favorableDirection="neutral"
              href="/reports/payables"
            />
            <SummaryCard
              label="Invoice Discrepancies"
              value={String(data.discrepancyCount)}
              favorableDirection="down"
            />
          </div>

          <div className="rounded-lg border border-border p-4">
            <h3 className="mb-2 text-sm font-medium text-muted-foreground">
              Open Purchase Orders (most recent 25)
            </h3>
            {data.openPurchaseOrders.length === 0 ? (
              <ReportEmpty message="No open purchase orders." />
            ) : (
              <ReportDataTable columns={COLUMNS} rows={data.openPurchaseOrders} />
            )}
          </div>
        </>
      )}
    </div>
  );
}
