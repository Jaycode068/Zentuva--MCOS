'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent } from '@zentuva/ui';

import { getInventoryPositionReport } from '../api';
import { ExportButton } from '@/components/reporting/export-button';
import { ReportDataTable, ReportPagination } from '@/components/reporting/report-data-table';
import { ReportPageHeader } from '@/components/reporting/report-page-header';
import { ReportError, ReportLoading } from '@/components/reporting/report-states';
import { SummaryCard } from '@/components/reporting/summary-card';

const COLUMNS = [
  { key: 'productCode', label: 'Code', type: 'STRING' as const },
  { key: 'productName', label: 'Product', type: 'STRING' as const },
  { key: 'locationName', label: 'Location', type: 'STRING' as const },
  { key: 'quantityOnHand', label: 'Qty on Hand', type: 'NUMBER' as const },
  { key: 'averageUnitCost', label: 'Avg Unit Cost', type: 'CURRENCY' as const },
  { key: 'inventoryValue', label: 'Value', type: 'CURRENCY' as const },
];

export default function InventoryPositionPage() {
  const [page, setPage] = useState(1);
  const { data, isLoading, isError } = useQuery({
    queryKey: ['reporting-inventory-position', page],
    queryFn: () => getInventoryPositionReport({ page, pageSize: 25 }),
  });

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <ReportPageHeader
        title="Inventory Position"
        description="Stock on hand and value, using the existing moving-weighted-average valuation — the same figure Finance's Inventory Valuation report shows."
        actions={
          <ExportButton
            path="/reporting/reports/inventory-position/export"
            filename="inventory-position.csv"
          />
        }
      />

      {isLoading && <ReportLoading />}
      {isError && <ReportError message="Failed to load the inventory position report." />}

      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <SummaryCard
              label="Total Inventory Value"
              value={data.totals.grandTotal.toLocaleString('en-NG', {
                style: 'currency',
                currency: 'NGN',
              })}
            />
            {data.totals.byLocation.slice(0, 2).map((loc) => (
              <SummaryCard
                key={loc.label}
                label={loc.label}
                value={loc.value.toLocaleString('en-NG', { style: 'currency', currency: 'NGN' })}
              />
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Low-stock/reorder indicators are not shown — no reorder-point field exists on Product
            yet (known data gap, see the KPI dictionary).
          </p>
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
