'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@zentuva/ui';

import { AssetTabs } from '@/components/app/asset-tabs';
import { ApiError } from '@/lib/api-client';
import { formatCurrency } from '@/lib/format-currency';

import { listAssetCategories, listAssetLocations, listAssets } from './api';
import { ASSET_CONDITION_LABELS } from './labels';

/**
 * Asset Overview (Sprint 20, docs/domains/assets.md) — a lightweight
 * dashboard composed entirely from the existing Asset list endpoint,
 * never a duplicated aggregation service. "Total Acquisition Value" is
 * simply the sum of recorded acquisition costs — explicitly never an
 * accounting balance.
 */
export default function AssetsOverviewPage() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['assets'],
    queryFn: () => listAssets(),
  });
  const assets = useMemo(() => data?.items ?? [], [data]);

  const { data: categoriesData } = useQuery({
    queryKey: ['asset-categories'],
    queryFn: () => listAssetCategories(),
  });
  const { data: locationsData } = useQuery({
    queryKey: ['asset-locations'],
    queryFn: () => listAssetLocations(),
  });
  const categoriesById = useMemo(
    () => new Map((categoriesData?.items ?? []).map((c) => [c.id, c.name])),
    [categoriesData],
  );
  const locationsById = useMemo(
    () => new Map((locationsData?.items ?? []).map((l) => [l.id, l.name])),
    [locationsData],
  );

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const asset of assets) counts[asset.status] = (counts[asset.status] ?? 0) + 1;
    return counts;
  }, [assets]);

  const conditionCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const asset of assets) counts[asset.condition] = (counts[asset.condition] ?? 0) + 1;
    return counts;
  }, [assets]);

  const byCategory = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const asset of assets) {
      const label = categoriesById.get(asset.categoryId) ?? 'Uncategorised';
      counts[label] = (counts[label] ?? 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [assets, categoriesById]);

  const byLocation = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const asset of assets) {
      const label = asset.locationId
        ? (locationsById.get(asset.locationId) ?? 'Unknown')
        : 'Unassigned';
      counts[label] = (counts[label] ?? 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [assets, locationsById]);

  const totalAcquisitionValue = useMemo(
    () => assets.reduce((sum, asset) => sum + (asset.acquisitionCost ?? 0), 0),
    [assets],
  );

  const warrantiesNearingExpiry = useMemo(() => {
    const now = new Date();
    const in90Days = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
    return assets.filter((asset) => {
      if (!asset.warrantyEndDate) return false;
      const end = new Date(asset.warrantyEndDate);
      return end >= now && end <= in90Days;
    });
  }, [assets]);

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Assets</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          What physical resources the business has, where they are, and what condition they&apos;re
          in.
        </p>
      </div>

      <AssetTabs />

      {isLoading && (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading overview…</p>
      )}
      {isError && (
        <p className="py-10 text-center text-sm text-destructive">
          {error instanceof ApiError ? error.message : 'Failed to load overview.'}
        </p>
      )}

      {!isLoading && !isError && (
        <>
          <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <SummaryCard title="Total Assets" value={String(assets.length)} />
            <SummaryCard title="Active" value={String(statusCounts.ACTIVE ?? 0)} />
            <SummaryCard title="In Service" value={String(statusCounts.IN_SERVICE ?? 0)} />
            <SummaryCard
              title="Under Maintenance"
              value={String(statusCounts.UNDER_MAINTENANCE ?? 0)}
            />
            <SummaryCard title="Out of Service" value={String(statusCounts.OUT_OF_SERVICE ?? 0)} />
            <SummaryCard title="Disposed" value={String(statusCounts.DISPOSED ?? 0)} />
            <SummaryCard title="Retired" value={String(statusCounts.RETIRED ?? 0)} />
            <SummaryCard
              title="Total Acquisition Value"
              value={formatCurrency(totalAcquisitionValue, 'NGN')}
            />
          </div>

          <div className="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Assets by Category
                </CardTitle>
              </CardHeader>
              <CardContent>
                {byCategory.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No assets yet.</p>
                ) : (
                  <ul className="space-y-1 text-sm">
                    {byCategory.map(([name, count]) => (
                      <li key={name} className="flex items-center justify-between">
                        <span>{name}</span>
                        <span className="text-muted-foreground">{count}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Assets by Location
                </CardTitle>
              </CardHeader>
              <CardContent>
                {byLocation.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No assets yet.</p>
                ) : (
                  <ul className="space-y-1 text-sm">
                    {byLocation.map(([name, count]) => (
                      <li key={name} className="flex items-center justify-between">
                        <span>{name}</span>
                        <span className="text-muted-foreground">{count}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Assets by Condition
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1 text-sm">
                  {Object.entries(ASSET_CONDITION_LABELS).map(([value, label]) => (
                    <li key={value} className="flex items-center justify-between">
                      <span>{label}</span>
                      <span className="text-muted-foreground">{conditionCounts[value] ?? 0}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Warranties Nearing Expiry (90 days)
                </CardTitle>
              </CardHeader>
              <CardContent>
                {warrantiesNearingExpiry.length === 0 ? (
                  <p className="text-sm text-muted-foreground">None.</p>
                ) : (
                  <ul className="space-y-1 text-sm">
                    {warrantiesNearingExpiry.map((asset) => (
                      <li key={asset.id} className="flex items-center justify-between">
                        <a
                          href={`/settings/assets/register/${asset.id}`}
                          className="text-primary hover:underline"
                        >
                          {asset.name}
                        </a>
                        <span className="text-muted-foreground">
                          {asset.warrantyEndDate
                            ? new Date(asset.warrantyEndDate).toLocaleDateString()
                            : '—'}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </main>
  );
}

function SummaryCard({ title, value }: { title: string; value: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xs font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-lg font-semibold">{value}</p>
      </CardContent>
    </Card>
  );
}
