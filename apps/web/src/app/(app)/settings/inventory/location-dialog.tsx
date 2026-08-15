'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
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
import { z } from '@zentuva/validation';
import { useForm } from 'react-hook-form';

import { ApiError } from '@/lib/api-client';

import { createInventoryLocation, updateInventoryLocation, type InventoryLocation } from './api';
import { LOCATION_STATUS_LABELS } from './labels';

const locationFormSchema = z.object({
  name: z.string().trim().min(1, 'Location name is required'),
  status: z.enum(['ACTIVE', 'INACTIVE']),
});

type LocationFormValues = z.infer<typeof locationFormSchema>;

/**
 * Create/Edit Location dialog (Sprint 4.5 brief §16/§20) — rename and/or activate or
 * deactivate a physical stock location. No delete (a location already carrying
 * inventory history is retired, never removed) and no editing the `isDefault` flag —
 * that's a server-side invariant (exactly one default per organisation), not a form
 * field.
 */
export function LocationDialog({
  location,
  onOpenChange,
  onSaved,
}: {
  location: InventoryLocation | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const isEdit = location !== null;

  const form = useForm<LocationFormValues>({
    resolver: zodResolver(locationFormSchema),
    defaultValues: {
      name: location?.name ?? '',
      status: location?.status ?? 'ACTIVE',
    },
  });

  const mutation = useMutation({
    mutationFn: (values: LocationFormValues) =>
      isEdit
        ? updateInventoryLocation(location.id, values)
        : createInventoryLocation({ name: values.name }),
    onSuccess: onSaved,
  });

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>{isEdit ? 'Edit Location' : 'Add Location'}</DialogTitle>
      </DialogHeader>
      <form className="space-y-4" onSubmit={form.handleSubmit((values) => mutation.mutate(values))}>
        <div className="space-y-1.5">
          <Label>Name</Label>
          <Input {...form.register('name')} />
          {form.formState.errors.name && (
            <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>
          )}
        </div>

        {isEdit && (
          <div className="space-y-1.5">
            <Label>Status</Label>
            <Select {...form.register('status')} disabled={location.isDefault}>
              {Object.entries(LOCATION_STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
            {location.isDefault && (
              <p className="text-xs text-muted-foreground">
                The default location cannot be deactivated.
              </p>
            )}
          </div>
        )}

        {mutation.isError && (
          <p className="text-sm text-destructive">
            {mutation.error instanceof ApiError
              ? mutation.error.message
              : 'Failed to save location.'}
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
