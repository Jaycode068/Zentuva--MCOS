'use client';

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button } from '@zentuva/ui';

import { AssetTabs } from '@/components/app/asset-tabs';
import { ApiError } from '@/lib/api-client';

import {
  type AssetLocation,
  activateAssetLocation,
  deactivateAssetLocation,
  listAssetLocations,
} from '../api';
import { ASSET_LOCATION_STATUS_LABELS, ASSET_LOCATION_STATUS_VARIANT } from '../labels';
import { AssetLocationDialog } from './location-dialog';

/**
 * Asset Locations (Sprint 20, docs/domains/assets.md) — a new,
 * purpose-built physical-place model (deliberately not a reuse of
 * Inventory's own stock-holding-specific `InventoryLocation`). Supports a
 * Site → Area hierarchy.
 */
export default function AssetLocationsPage() {
  const queryClient = useQueryClient();
  const [dialogState, setDialogState] = useState<{ open: boolean; location?: AssetLocation }>({
    open: false,
  });

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['asset-locations'],
    queryFn: () => listAssetLocations(),
  });
  const locations = useMemo(() => data?.items ?? [], [data]);
  const byId = useMemo(() => new Map(locations.map((l) => [l.id, l])), [locations]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['asset-locations'] });

  const toggleStatus = async (location: AssetLocation) => {
    if (location.status === 'ACTIVE') {
      await deactivateAssetLocation(location.id);
    } else {
      await activateAssetLocation(location.id);
    }
    invalidate();
  };

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Assets</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Physical places assets can be found — a factory site, a production hall, a maintenance
            area, a vehicle yard.
          </p>
        </div>
        <Button onClick={() => setDialogState({ open: true })}>Add Location</Button>
      </div>

      <AssetTabs />

      {isLoading && (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading locations…</p>
      )}
      {isError && (
        <p className="py-10 text-center text-sm text-destructive">
          {error instanceof ApiError ? error.message : 'Failed to load locations.'}
        </p>
      )}
      {!isLoading && !isError && locations.length === 0 && (
        <p className="py-10 text-center text-sm text-muted-foreground">
          No locations yet — add your factory, warehouse, or office to start.
        </p>
      )}

      {!isLoading && !isError && locations.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/50 text-left">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Parent</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {locations.map((location) => (
                <tr key={location.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 font-medium">
                    {location.parentLocationId ? (
                      <span className="mr-2 text-muted-foreground">└</span>
                    ) : null}
                    {location.name}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {location.parentLocationId
                      ? (byId.get(location.parentLocationId)?.name ?? '—')
                      : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={ASSET_LOCATION_STATUS_VARIANT[location.status]}>
                      {ASSET_LOCATION_STATUS_LABELS[location.status]}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right space-x-3">
                    <button
                      type="button"
                      onClick={() => setDialogState({ open: true, location })}
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleStatus(location)}
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      {location.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {dialogState.open && (
        <AssetLocationDialog
          location={dialogState.location}
          onOpenChange={() => setDialogState({ open: false })}
          onSaved={invalidate}
        />
      )}
    </main>
  );
}
