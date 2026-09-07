'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button, Input, Select } from '@zentuva/ui';

import { AssetTabs } from '@/components/app/asset-tabs';
import { ApiError } from '@/lib/api-client';
import { formatCurrency } from '@/lib/format-currency';

import {
  type AssetCondition,
  type AssetStatus,
  listAssetCategories,
  listAssetLocations,
  listAssets,
} from '../api';
import {
  ASSET_CONDITION_LABELS,
  ASSET_CONDITION_VARIANT,
  ASSET_STATUS_LABELS,
  ASSET_STATUS_VARIANT,
} from '../labels';
import { AssetDialog } from './asset-dialog';

/**
 * Assets (Sprint 20, docs/domains/assets.md) — the register itself.
 * `assetCode` is always server-generated; Planned/Committed/Actual-style
 * figures don't exist yet for assets (that's a future Maintenance-sprint
 * concept) — this list shows only what is directly recorded.
 */
export default function AssetsRegisterPage() {
  const [createOpen, setCreateOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<AssetStatus | ''>('');
  const [condition, setCondition] = useState<AssetCondition | ''>('');
  const [categoryId, setCategoryId] = useState('');
  const [locationId, setLocationId] = useState('');

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['assets', search, status, condition, categoryId, locationId],
    queryFn: () =>
      listAssets({
        search: search || undefined,
        status: status || undefined,
        condition: condition || undefined,
        categoryId: categoryId || undefined,
        locationId: locationId || undefined,
      }),
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
  const categoriesById = new Map((categoriesData?.items ?? []).map((c) => [c.id, c]));
  const locationsById = new Map((locationsData?.items ?? []).map((l) => [l.id, l]));

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Assets</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            The register of every physical resource the business owns, leases, or controls.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>Add Asset</Button>
      </div>

      <AssetTabs />

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search code, tag, name, serial, manufacturer…"
          className="max-w-xs"
        />
        <Select
          value={status}
          onChange={(event) => setStatus(event.target.value as AssetStatus | '')}
          className="max-w-[10rem]"
        >
          <option value="">All Statuses</option>
          {Object.entries(ASSET_STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
        <Select
          value={condition}
          onChange={(event) => setCondition(event.target.value as AssetCondition | '')}
          className="max-w-[10rem]"
        >
          <option value="">All Conditions</option>
          {Object.entries(ASSET_CONDITION_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
        <Select
          value={categoryId}
          onChange={(event) => setCategoryId(event.target.value)}
          className="max-w-[12rem]"
        >
          <option value="">All Categories</option>
          {(categoriesData?.items ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Select
          value={locationId}
          onChange={(event) => setLocationId(event.target.value)}
          className="max-w-[12rem]"
        >
          <option value="">All Locations</option>
          {(locationsData?.items ?? []).map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </Select>
      </div>

      {isLoading && (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading assets…</p>
      )}
      {isError && (
        <p className="py-10 text-center text-sm text-destructive">
          {error instanceof ApiError ? error.message : 'Failed to load assets.'}
        </p>
      )}
      {!isLoading && !isError && assets.length === 0 && (
        <p className="py-10 text-center text-sm text-muted-foreground">
          No assets yet — add your first machine, vehicle, or equipment.
        </p>
      )}

      {!isLoading && !isError && assets.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/50 text-left">
              <tr>
                <th className="px-4 py-3 font-medium">Asset</th>
                <th className="px-4 py-3 font-medium">Category</th>
                <th className="px-4 py-3 font-medium">Location</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Condition</th>
                <th className="px-4 py-3 text-right font-medium">Acquisition Cost</th>
                <th className="px-4 py-3 text-right font-medium">Open</th>
              </tr>
            </thead>
            <tbody>
              {assets.map((asset) => (
                <tr key={asset.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3">
                    <div className="font-medium">{asset.name}</div>
                    <div className="font-mono text-xs text-muted-foreground">
                      {asset.assetCode}
                      {asset.assetTag ? ` · ${asset.assetTag}` : ''}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {categoriesById.get(asset.categoryId)?.name ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {asset.locationId ? (locationsById.get(asset.locationId)?.name ?? '—') : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={ASSET_STATUS_VARIANT[asset.status]}>
                      {ASSET_STATUS_LABELS[asset.status]}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={ASSET_CONDITION_VARIANT[asset.condition]}>
                      {ASSET_CONDITION_LABELS[asset.condition]}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {asset.acquisitionCost !== null
                      ? formatCurrency(asset.acquisitionCost, asset.currency)
                      : '—'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/settings/assets/register/${asset.id}`}
                      className="text-xs text-primary hover:underline"
                    >
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {createOpen && (
        <AssetDialog
          onOpenChange={() => setCreateOpen(false)}
          onCreated={(id) => {
            setCreateOpen(false);
            refetch();
            window.location.assign(`/settings/assets/register/${id}`);
          }}
        />
      )}
    </main>
  );
}
