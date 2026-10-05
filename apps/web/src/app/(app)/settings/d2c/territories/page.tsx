'use client';

import { useQuery } from '@tanstack/react-query';
import { Button } from '@zentuva/ui';

import { D2cTabs } from '@/components/app/d2c-tabs';
import { ApiError } from '@/lib/api-client';

import { getD2CTerritorySummary } from '../api';

/**
 * Sprint 39 — D2C Sales Administration & Operations Dashboard
 * (docs/domains/d2c.md). Operational visibility only — consumer/order/
 * Collection Point counts per territory, derived live from
 * `GET /d2c/admin/territories` (`D2CAdminService.getTerritorySummary`).
 * Explicitly NOT full Demand Intelligence (trends, forecasting, heatmaps —
 * that's Sprint 41's scope).
 */
export default function D2CTerritoriesPage() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['d2c-admin-territories'],
    queryFn: getD2CTerritorySummary,
  });

  const rows = data?.items ?? [];

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">D2C Territories</h1>
        <p className="text-sm text-muted-foreground">
          Consumer, order, and Collection Point coverage per territory.
        </p>
      </div>

      <D2cTabs />

      {isLoading && <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>}
      {isError && (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <p className="text-sm text-destructive">
            {error instanceof ApiError ? error.message : 'Failed to load territories.'}
          </p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      )}

      {!isLoading && !isError && rows.length === 0 && (
        <p className="py-10 text-center text-sm text-muted-foreground">No territories yet.</p>
      )}

      {!isLoading && !isError && rows.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Territory</th>
                <th className="px-4 py-3">Consumers</th>
                <th className="px-4 py-3">D2C Orders</th>
                <th className="px-4 py-3">Collection Points</th>
                <th className="px-4 py-3">Enabled</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.territoryId} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 font-medium">{row.territoryName}</td>
                  <td className="px-4 py-3">{row.consumerCount}</td>
                  <td className="px-4 py-3">{row.d2cOrderCount}</td>
                  <td className="px-4 py-3">{row.collectionPointCount}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {row.enabledCollectionPointCount} / {row.collectionPointCount}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
