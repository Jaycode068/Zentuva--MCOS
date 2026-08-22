'use client';

import { useEffect, useState } from 'react';
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
} from '@zentuva/ui';
import { createOutletSchema, type CreateOutletInput } from '@zentuva/validation';
import { useForm } from 'react-hook-form';

import { MultiImageUploadCard } from '@/components/app/multi-image-upload-card';
import { ApiError } from '@/lib/api-client';
import { captureCoordinates } from '@/lib/geolocation';

import {
  addOutletPhotos,
  createOutlet,
  listCustomers,
  listTerritories,
  removeOutletPhoto,
  updateOutlet,
  type Outlet,
} from './api';
import { OUTLET_TYPE_LABELS } from './labels';

/**
 * Reusable Create/Edit Outlet dialog (Sprint 4.8, docs/domains/outlets.md). `outlet ===
 * null` is create mode. `customerId` is required on create and fixed (disabled) on edit
 * — an outlet's owning customer never changes after creation (service-enforced).
 * Coordinates are optional and captured via the browser's one-shot geolocation, never
 * required. Photo management only renders in edit mode, same "needs an id first"
 * reasoning as the Product Catalogue's own image upload.
 */
export function OutletDialog({
  outlet,
  onOpenChange,
  onSaved,
}: {
  outlet: Outlet | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const isEdit = outlet !== null;
  const [capturingLocation, setCapturingLocation] = useState(false);
  const [locationNote, setLocationNote] = useState<string | null>(null);

  const { data: customersData } = useQuery({
    queryKey: ['customers-for-outlet'],
    queryFn: () => listCustomers({ status: 'ACTIVE' }),
  });
  const { data: territoriesData } = useQuery({
    queryKey: ['territories'],
    queryFn: () => listTerritories({ status: 'ACTIVE' }),
  });
  const customers = customersData?.items ?? [];
  const territories = territoriesData?.items ?? [];

  const form = useForm<CreateOutletInput>({
    resolver: zodResolver(createOutletSchema),
    defaultValues: {
      customerId: outlet?.customer.id ?? '',
      outletType: outlet?.outletType ?? 'RETAIL_SHOP',
      name: outlet?.name ?? '',
      contactPersonName: outlet?.contactPersonName ?? '',
      phoneNumber: outlet?.phoneNumber ?? '',
      address: outlet?.address ?? '',
      city: outlet?.city ?? '',
      state: outlet?.state ?? '',
      country: outlet?.country ?? '',
      territoryId: outlet?.territoryId ?? undefined,
      latitude: outlet?.latitude ?? undefined,
      longitude: outlet?.longitude ?? undefined,
      notes: outlet?.notes ?? '',
    },
  });

  // Both the Customer and Territory `<select>`s are uncontrolled (RHF `register`); each
  // list resolves asynchronously, so if it lands after mount, the matching `<option>`
  // for a real preset id doesn't exist yet and the initial selection is a silent no-op.
  // Re-apply once each list loads, same race avoided by `ProductionOrderDialog`'s own
  // `form.reset()` on its BOM query.
  useEffect(() => {
    if (isEdit && customersData) {
      form.setValue('customerId', outlet.customer.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customersData]);
  useEffect(() => {
    if (isEdit && outlet.territoryId && territoriesData) {
      form.setValue('territoryId', outlet.territoryId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [territoriesData]);

  const mutation = useMutation({
    mutationFn: (values: CreateOutletInput) => {
      const payload = {
        ...values,
        contactPersonName: values.contactPersonName || undefined,
        phoneNumber: values.phoneNumber || undefined,
        address: values.address || undefined,
        city: values.city || undefined,
        state: values.state || undefined,
        country: values.country || undefined,
        territoryId: values.territoryId || undefined,
        notes: values.notes || undefined,
      };
      return isEdit ? updateOutlet(outlet.id, payload) : createOutlet(payload);
    },
    onSuccess: () => {
      onSaved();
      onOpenChange(false);
    },
  });

  const uploadMutation = useMutation({
    mutationFn: (files: File[]) => addOutletPhotos(outlet!.id, files),
    onSuccess: onSaved,
  });
  const removeMutation = useMutation({
    mutationFn: (photoId: string) => removeOutletPhoto(outlet!.id, photoId),
    onSuccess: onSaved,
  });

  async function handleCaptureLocation() {
    setCapturingLocation(true);
    setLocationNote(null);
    const coords = await captureCoordinates();
    setCapturingLocation(false);
    if (!coords) {
      setLocationNote("Location not captured — that's fine, you can add it later.");
      return;
    }
    form.setValue('latitude', coords.latitude);
    form.setValue('longitude', coords.longitude);
    setLocationNote('Location captured.');
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>{isEdit ? 'Edit Outlet' : 'Add Outlet'}</DialogTitle>
      </DialogHeader>
      <form
        className="max-h-[70vh] space-y-4 overflow-y-auto pr-1"
        onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
      >
        {isEdit && (
          <p className="rounded-md border border-dashed border-border bg-muted/50 px-3 py-2 font-mono text-xs text-muted-foreground">
            {outlet.outletCode}
          </p>
        )}

        <div className="space-y-1.5">
          <Label>Customer</Label>
          <Select disabled={isEdit} {...form.register('customerId')}>
            <option value="">Select a customer…</option>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.customerName}
              </option>
            ))}
          </Select>
          {form.formState.errors.customerId && (
            <p className="text-xs text-destructive">{form.formState.errors.customerId.message}</p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Outlet Type</Label>
            <Select {...form.register('outletType')}>
              {Object.entries(OUTLET_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Outlet Name</Label>
            <Input {...form.register('name')} />
            {form.formState.errors.name && (
              <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>
            )}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Territory (optional)</Label>
          <Select {...form.register('territoryId')}>
            <option value="">Not set</option>
            {territories.map((territory) => (
              <option key={territory.id} value={territory.id}>
                {territory.name}
              </option>
            ))}
          </Select>
        </div>

        <div className="space-y-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleCaptureLocation}
            disabled={capturingLocation}
          >
            {capturingLocation ? 'Capturing…' : 'Capture Location'}
          </Button>
          {locationNote && <p className="text-xs text-muted-foreground">{locationNote}</p>}
        </div>

        <details className="rounded-md border border-dashed border-border p-3">
          <summary className="cursor-pointer text-sm font-medium text-foreground">
            Add more details (optional)
          </summary>
          <div className="mt-3 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Contact Person</Label>
                <Input {...form.register('contactPersonName')} />
              </div>
              <div className="space-y-1.5">
                <Label>Phone Number</Label>
                <Input {...form.register('phoneNumber')} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Address</Label>
              <Input {...form.register('address')} />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label>City</Label>
                <Input {...form.register('city')} />
              </div>
              <div className="space-y-1.5">
                <Label>State</Label>
                <Input {...form.register('state')} />
              </div>
              <div className="space-y-1.5">
                <Label>Country</Label>
                <Input {...form.register('country')} />
              </div>
            </div>
          </div>
        </details>

        {isEdit && (
          <MultiImageUploadCard
            title="Outlet Photos"
            description="Front, signage, interior, or shelf display — capture what the outlet looks like."
            photos={outlet.photos}
            onUpload={(files) => uploadMutation.mutate(files)}
            onRemove={(photoId) => removeMutation.mutate(photoId)}
            isUploading={uploadMutation.isPending}
            removingPhotoId={removeMutation.isPending ? (removeMutation.variables ?? null) : null}
            preferCamera
            error={
              uploadMutation.error instanceof ApiError
                ? uploadMutation.error.message
                : removeMutation.error instanceof ApiError
                  ? removeMutation.error.message
                  : undefined
            }
          />
        )}

        {mutation.isError && (
          <p className="text-sm text-destructive">
            {mutation.error instanceof ApiError ? mutation.error.message : 'Failed to save outlet.'}
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Outlet'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
