'use client';

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button } from '@zentuva/ui';

import { AssetTabs } from '@/components/app/asset-tabs';
import { ApiError } from '@/lib/api-client';

import {
  type AssetCategory,
  deactivateAssetCategory,
  activateAssetCategory,
  listAssetCategories,
} from '../api';
import { ASSET_CATEGORY_STATUS_LABELS, ASSET_CATEGORY_STATUS_VARIANT } from '../labels';
import { AssetCategoryDialog } from './category-dialog';

/**
 * Asset Categories (Sprint 20, docs/domains/assets.md) — a tenant-defined
 * taxonomy, never hard-coded into application logic. Supports an optional
 * parent for a simple hierarchy.
 */
export default function AssetCategoriesPage() {
  const queryClient = useQueryClient();
  const [dialogState, setDialogState] = useState<{ open: boolean; category?: AssetCategory }>({
    open: false,
  });

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['asset-categories'],
    queryFn: () => listAssetCategories(),
  });
  const categories = useMemo(() => data?.items ?? [], [data]);
  const byId = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['asset-categories'] });

  const toggleStatus = async (category: AssetCategory) => {
    if (category.status === 'ACTIVE') {
      await deactivateAssetCategory(category.id);
    } else {
      await activateAssetCategory(category.id);
    }
    invalidate();
  };

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Assets</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            A tenant-defined taxonomy for the asset register — organise assets the way your business
            actually thinks about them.
          </p>
        </div>
        <Button onClick={() => setDialogState({ open: true })}>Add Category</Button>
      </div>

      <AssetTabs />

      {isLoading && (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading categories…</p>
      )}
      {isError && (
        <p className="py-10 text-center text-sm text-destructive">
          {error instanceof ApiError ? error.message : 'Failed to load categories.'}
        </p>
      )}
      {!isLoading && !isError && categories.length === 0 && (
        <p className="py-10 text-center text-sm text-muted-foreground">
          No categories yet — add Production Machinery, Vehicles, or IT Equipment to start.
        </p>
      )}

      {!isLoading && !isError && categories.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/50 text-left">
              <tr>
                <th className="px-4 py-3 font-medium">Code</th>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Parent</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((category) => (
                <tr key={category.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 font-mono text-xs">{category.code}</td>
                  <td className="px-4 py-3 font-medium">{category.name}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {category.parentCategoryId
                      ? (byId.get(category.parentCategoryId)?.name ?? '—')
                      : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={ASSET_CATEGORY_STATUS_VARIANT[category.status]}>
                      {ASSET_CATEGORY_STATUS_LABELS[category.status]}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right space-x-3">
                    <button
                      type="button"
                      onClick={() => setDialogState({ open: true, category })}
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleStatus(category)}
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      {category.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {dialogState.open && (
        <AssetCategoryDialog
          category={dialogState.category}
          onOpenChange={() => setDialogState({ open: false })}
          onSaved={invalidate}
        />
      )}
    </main>
  );
}
