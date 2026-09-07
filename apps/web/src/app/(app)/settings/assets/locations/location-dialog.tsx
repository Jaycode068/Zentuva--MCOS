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
} from '@zentuva/ui';

import { ApiError } from '@/lib/api-client';

import {
  type AssetLocation,
  createAssetLocation,
  listAssetLocations,
  updateAssetLocation,
} from '../api';

/** "Add/Edit Asset Location" dialog (Sprint 20, docs/domains/assets.md) —
 *  a new, purpose-built physical-place model. Supports a Site → Area
 *  hierarchy (e.g. "Ibadan Factory" → "Production Hall"). */
export function AssetLocationDialog({
  location,
  onOpenChange,
  onSaved,
}: {
  location?: AssetLocation;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(location?.name ?? '');
  const [parentLocationId, setParentLocationId] = useState(location?.parentLocationId ?? '');

  const { data } = useQuery({ queryKey: ['asset-locations'], queryFn: () => listAssetLocations() });
  const candidates = (data?.items ?? []).filter((l) => l.id !== location?.id);

  const mutation = useMutation({
    mutationFn: () =>
      location
        ? updateAssetLocation(location.id, {
            name,
            parentLocationId: parentLocationId || undefined,
          })
        : createAssetLocation({ name, parentLocationId: parentLocationId || undefined }),
    onSuccess: onSaved,
  });

  const canSubmit = name.trim().length > 0;

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>{location ? 'Edit Asset Location' : 'Add Asset Location'}</DialogTitle>
      </DialogHeader>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate();
        }}
      >
        <div className="space-y-1.5">
          <Label>Name</Label>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Ibadan Factory"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Parent Location (optional)</Label>
          <Select
            value={parentLocationId}
            onChange={(event) => setParentLocationId(event.target.value)}
          >
            <option value="">None — a top-level site</option>
            {candidates.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
          <p className="text-xs text-muted-foreground">
            e.g. &quot;Production Hall&quot; inside the &quot;Ibadan Factory&quot; site.
          </p>
        </div>

        {mutation.isError && (
          <p className="text-sm text-destructive">
            {mutation.error instanceof ApiError
              ? mutation.error.message
              : 'Failed to save asset location.'}
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={!canSubmit || mutation.isPending}>
            {mutation.isPending ? 'Saving…' : location ? 'Save Changes' : 'Add Location'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
