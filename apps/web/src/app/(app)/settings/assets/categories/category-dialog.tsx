'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Button,
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  Textarea,
} from '@zentuva/ui';

import { ApiError } from '@/lib/api-client';

import {
  type AssetCategory,
  createAssetCategory,
  listAssetCategories,
  updateAssetCategory,
} from '../api';

/** "Add/Edit Asset Category" dialog (Sprint 20, docs/domains/assets.md) —
 *  a tenant-defined taxonomy, never hard-coded into application logic. */
export function AssetCategoryDialog({
  category,
  onOpenChange,
  onSaved,
}: {
  category?: AssetCategory;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [code, setCode] = useState(category?.code ?? '');
  const [name, setName] = useState(category?.name ?? '');
  const [description, setDescription] = useState(category?.description ?? '');
  const [parentCategoryId, setParentCategoryId] = useState(category?.parentCategoryId ?? '');

  const { data } = useQuery({
    queryKey: ['asset-categories'],
    queryFn: () => listAssetCategories(),
  });
  const candidates = (data?.items ?? []).filter((c) => c.id !== category?.id);

  const mutation = useMutation({
    mutationFn: () =>
      category
        ? updateAssetCategory(category.id, {
            name,
            description: description || undefined,
            parentCategoryId: parentCategoryId || undefined,
          })
        : createAssetCategory({
            code,
            name,
            description: description || undefined,
            parentCategoryId: parentCategoryId || undefined,
          }),
    onSuccess: onSaved,
  });

  const canSubmit = name.trim().length > 0 && (!!category || code.trim().length > 0);

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>{category ? 'Edit Asset Category' : 'Add Asset Category'}</DialogTitle>
      </DialogHeader>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate();
        }}
      >
        {!category && (
          <div className="space-y-1.5">
            <Label>Code</Label>
            <Input
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="e.g. PROD-MACH"
            />
          </div>
        )}
        <div className="space-y-1.5">
          <Label>Name</Label>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Production Machinery"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Description (optional)</Label>
          <Textarea
            rows={2}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Parent Category (optional)</Label>
          <Select
            value={parentCategoryId}
            onChange={(event) => setParentCategoryId(event.target.value)}
          >
            <option value="">None</option>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>

        {mutation.isError && (
          <p className="text-sm text-destructive">
            {mutation.error instanceof ApiError
              ? mutation.error.message
              : 'Failed to save asset category.'}
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={!canSubmit || mutation.isPending}>
            {mutation.isPending ? 'Saving…' : category ? 'Save Changes' : 'Add Category'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
