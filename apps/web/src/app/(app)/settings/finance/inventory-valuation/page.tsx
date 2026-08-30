'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Card, CardContent, CardHeader, CardTitle } from '@zentuva/ui';

import { FinanceTabs } from '@/components/app/finance-tabs';
import { ApiError } from '@/lib/api-client';
import { formatCurrency } from '@/lib/format-currency';

import { getInventoryValuation } from '../api';

/**
 * Inventory Valuation (Sprint 13, docs/domains/accounting.md §16.3) —
 * `quantityOnHand × averageUnitCost` per (product, location), reusing Inventory's
 * existing moving-weighted-average costing figure. No second costing engine.
 */
export default function InventoryValuationPage() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['inventory-valuation'],
    queryFn: () => getInventoryValuation(),
  });

  const lines = useMemo(() => data?.lines ?? [], [data]);

  return (
    <main className="mx-auto max-w-6xl px-6 py-10 print:max-w-full print:px-0">
      <div className="mb-8 flex items-center justify-between print:hidden">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Finance</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            What every product, at every location, is currently worth.
          </p>
        </div>
        <Button variant="outline" onClick={() => window.print()}>
          Print
        </Button>
      </div>

      <div className="print:hidden">
        <FinanceTabs />
      </div>

      {isLoading && <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>}
      {isError && (
        <p className="py-10 text-center text-sm text-destructive">
          {error instanceof ApiError ? error.message : 'Failed to load inventory valuation.'}
        </p>
      )}

      {data && (
        <>
          <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3 print:hidden">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Total Inventory Value
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold">
                  {formatCurrency(data.totals.grandTotal, 'NGN')}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  By Location
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                {data.totals.byLocation.map((row) => (
                  <div key={row.label} className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{row.label}</span>
                    <span>{formatCurrency(row.value, 'NGN')}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  By Product Type
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                {data.totals.byProductType.map((row) => (
                  <div key={row.label} className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{row.label}</span>
                    <span>{formatCurrency(row.value, 'NGN')}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          <div className="hidden overflow-x-auto rounded-lg border border-border md:block">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/50 text-left">
                <tr>
                  <th className="px-4 py-3 font-medium">Product</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium">Location</th>
                  <th className="px-4 py-3 font-medium">Quantity</th>
                  <th className="px-4 py-3 font-medium">Avg. Unit Cost</th>
                  <th className="px-4 py-3 font-medium">Value</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => (
                  <tr
                    key={`${line.productId}-${line.locationId}`}
                    className="border-b border-border last:border-0"
                  >
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs text-muted-foreground">
                        {line.productCode}
                      </span>{' '}
                      {line.productName}
                    </td>
                    <td className="px-4 py-3">{line.productType}</td>
                    <td className="px-4 py-3">{line.locationName}</td>
                    <td className="px-4 py-3">
                      {line.quantityOnHand} {line.unit}
                    </td>
                    <td className="px-4 py-3">{formatCurrency(line.averageUnitCost, 'NGN')}</td>
                    <td className="px-4 py-3 font-medium">
                      {formatCurrency(line.inventoryValue, 'NGN')}
                    </td>
                  </tr>
                ))}
                {lines.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                      No inventory on hand.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="space-y-2 md:hidden">
            {lines.map((line) => (
              <div
                key={`${line.productId}-${line.locationId}`}
                className="rounded-lg border border-border p-3"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-foreground">{line.productName}</span>
                  <span className="text-sm font-medium">
                    {formatCurrency(line.inventoryValue, 'NGN')}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {line.locationName} · {line.quantityOnHand} {line.unit} @{' '}
                  {formatCurrency(line.averageUnitCost, 'NGN')}
                </p>
              </div>
            ))}
          </div>
        </>
      )}
    </main>
  );
}
