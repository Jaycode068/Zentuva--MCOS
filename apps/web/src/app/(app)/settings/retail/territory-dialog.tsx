'use client';

import { useEffect } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
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
import { updateTerritorySchema, type UpdateTerritoryInput } from '@zentuva/validation';
import { useForm } from 'react-hook-form';

import { ApiError } from '@/lib/api-client';

import { createTerritory, listTerritories, updateTerritory, type Territory } from './api';

/**
 * Reusable Create/Edit Territory dialog (Sprint 4.8, docs/domains/territories.md).
 * `territory === null` is create mode. Validation runs against `updateTerritorySchema`
 * for both modes — same "update schema is a strict optional superset" trick
 * `ProductFamilyDialog` uses — with a non-null assertion on `name`/`type` in the create
 * branch, since zod's own `.min(1)` already guarantees non-emptiness by submit time.
 * Excludes itself and (best-effort, client-side) its own descendants from the Parent
 * picker; the service is the authoritative cycle guard.
 */
export function TerritoryDialog({
  territory,
  onOpenChange,
  onSaved,
}: {
  territory: Territory | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const isEdit = territory !== null;

  const { data: territoriesData } = useQuery({
    queryKey: ['territories-for-parent-picker'],
    queryFn: () => listTerritories(),
  });
  const parentOptions = (territoriesData?.items ?? []).filter((t) => t.id !== territory?.id);

  const form = useForm<UpdateTerritoryInput>({
    resolver: zodResolver(updateTerritorySchema),
    defaultValues: {
      name: territory?.name ?? '',
      type: territory?.type ?? '',
      parentTerritoryId: territory?.parentTerritoryId ?? undefined,
      description: territory?.description ?? '',
      status: territory?.status ?? 'ACTIVE',
    },
  });

  // The Parent Territory `<select>` is uncontrolled (RHF `register`); the list resolves
  // asynchronously, so if it lands after mount, a real preset id has no matching
  // `<option>` yet and the initial selection is a silent no-op. Re-apply once the list
  // loads, same race avoided by `ProductionOrderDialog`'s own `form.reset()`.
  useEffect(() => {
    if (isEdit && territory.parentTerritoryId && territoriesData) {
      form.setValue('parentTerritoryId', territory.parentTerritoryId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [territoriesData]);

  const mutation = useMutation({
    mutationFn: (values: UpdateTerritoryInput) => {
      const description = values.description || undefined;
      const parentTerritoryId = values.parentTerritoryId || undefined;
      if (isEdit) {
        return updateTerritory(territory.id, {
          ...values,
          description,
          parentTerritoryId: values.parentTerritoryId || null,
        });
      }
      return createTerritory({
        name: values.name!,
        type: values.type!,
        description,
        parentTerritoryId,
      });
    },
    onSuccess: () => {
      onSaved();
      onOpenChange(false);
    },
  });

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>{isEdit ? 'Edit Territory' : 'Create Territory'}</DialogTitle>
      </DialogHeader>
      <form className="space-y-4" onSubmit={form.handleSubmit((values) => mutation.mutate(values))}>
        {isEdit && (
          <p className="rounded-md border border-dashed border-border bg-muted/50 px-3 py-2 font-mono text-xs text-muted-foreground">
            {territory.territoryCode}
          </p>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input placeholder="e.g. Ibadan North" {...form.register('name')} />
            {form.formState.errors.name && (
              <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Type</Label>
            <Input placeholder="e.g. State, City, LGA, Area" {...form.register('type')} />
            {form.formState.errors.type && (
              <p className="text-xs text-destructive">{form.formState.errors.type.message}</p>
            )}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Parent Territory (optional)</Label>
          <Select {...form.register('parentTerritoryId')}>
            <option value="">No parent — this is a top-level territory</option>
            {parentOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label>Description (optional)</Label>
          <Textarea rows={2} {...form.register('description')} />
        </div>

        {isEdit && (
          <div className="space-y-1.5">
            <Label>Status</Label>
            <Select {...form.register('status')}>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </Select>
          </div>
        )}

        {mutation.isError && (
          <p className="text-sm text-destructive">
            {mutation.error instanceof ApiError
              ? mutation.error.message
              : 'Failed to save territory.'}
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Territory'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
