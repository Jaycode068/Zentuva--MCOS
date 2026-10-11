'use client';

import { useQuery } from '@tanstack/react-query';
import { Button } from '@zentuva/ui';
import Link from 'next/link';

import { getInventoryPositionReport } from '../../reports/api';
import { ReportError, ReportLoading } from '@/components/reporting/report-states';
import { ReportPageHeader } from '@/components/reporting/report-page-header';
import { SummaryCard } from '@/components/reporting/summary-card';
import { formatCurrency } from '@/lib/format-currency';
import { getWorkspaceSettings } from '@/lib/settings';

/**
 * Sprint 46 — Management Dashboards (brief §6C "Inventory Dashboard"). Reuses
 * `InventoryValuationService` verbatim via the existing `inventory-position` report
 * — the same moving-weighted-average valuation Finance's own report shows, never a
 * second formula. Low-stock/stock-out indicators remain omitted: the Sprint 45 audit
 * found no reorder-point field exists on `Product`, so there is no reliable
 * threshold to evaluate (documented gap, not fabricated).
 */
export default function InventoryDashboardPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['dashboard-inventory'],
    queryFn: () => getInventoryPositionReport({ page: 1, pageSize: 10 }),
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
        title="Inventory Dashboard"
        description="Stock on hand and value, using the existing moving-weighted-average valuation. Low-stock indicators are not shown — no reorder-point field exists on Product yet (known data gap)."
        backHref="/dashboard"
        backLabel="← Executive Dashboard"
      />

      {isLoading && <ReportLoading />}
      {isError && <ReportError message="Failed to load the inventory dashboard." />}

      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <SummaryCard
              label="Total Inventory Value"
              value={money(data.totals.grandTotal)}
              favorableDirection="neutral"
              href="/reports/inventory-position"
            />
            {data.totals.byLocation.slice(0, 2).map((loc) => (
              <SummaryCard
                key={loc.label}
                label={loc.label}
                value={money(loc.value)}
                favorableDirection="neutral"
              />
            ))}
          </div>

          <div className="rounded-lg border border-border p-4">
            <h3 className="mb-2 text-sm font-medium text-muted-foreground">By Product Type</h3>
            <ul className="space-y-1 text-sm">
              {data.totals.byProductType.map((row) => (
                <li key={row.label} className="flex justify-between">
                  <span>{row.label}</span>
                  <span className="font-medium">{money(row.value)}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex justify-end">
            <Link href="/reports/inventory-position">
              <Button variant="outline" size="sm">
                View Full Inventory Position Report
              </Button>
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
