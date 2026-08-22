'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Button, Input, Label, Select } from '@zentuva/ui';
import { createOutletSchema, type CreateOutletInput } from '@zentuva/validation';
import { useForm } from 'react-hook-form';

import { MultiImageUploadCard } from '@/components/app/multi-image-upload-card';
import { FieldStickyActionBar } from '@/components/field/FieldStickyActionBar';
import { ApiError } from '@/lib/api-client';
import { captureCoordinates } from '@/lib/geolocation';

import { addOutletPhotos, createOutlet, listCustomers, listTerritories } from '../../api';
import { OUTLET_TYPE_LABELS } from '../../labels';

/**
 * New Outlet (Sprint 4.8 brief §22): customer -> type -> basic info -> territory (if
 * known) -> optional one-shot location -> optional photo(s) -> save. The agent never
 * needs to know the full distribution network to create an outlet — Territory is
 * optional, and Customer is preselected when arriving from a customer's own detail page.
 */
export default function NewFieldOutletPage() {
  return (
    <Suspense fallback={<p className="p-4 text-sm text-muted-foreground">Loading…</p>}>
      <NewFieldOutletForm />
    </Suspense>
  );
}

function NewFieldOutletForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const presetCustomerId = searchParams.get('customerId') ?? '';

  const [capturingLocation, setCapturingLocation] = useState(false);
  const [locationNote, setLocationNote] = useState<string | null>(null);
  const [stagedFiles, setStagedFiles] = useState<File[]>([]);

  const { data: customersData } = useQuery({
    queryKey: ['customers'],
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
    defaultValues: { customerId: presetCustomerId, outletType: 'RETAIL_SHOP', name: '' },
  });

  // The customer list loads asynchronously, so the matching <option> doesn't exist yet
  // when react-hook-form applies `defaultValues` on mount — setting a <select>'s value
  // to an id with no corresponding option is a silent no-op. Re-apply once the list (and
  // the preset id's own option) actually exists.
  useEffect(() => {
    if (presetCustomerId && customers.some((customer) => customer.id === presetCustomerId)) {
      form.setValue('customerId', presetCustomerId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetCustomerId, customers]);

  const mutation = useMutation({
    mutationFn: async (values: CreateOutletInput) => {
      const outlet = await createOutlet({
        ...values,
        territoryId: values.territoryId || undefined,
      });
      if (stagedFiles.length > 0) {
        await addOutletPhotos(outlet.id, stagedFiles);
      }
      return outlet;
    },
    onSuccess: (outlet) => router.replace(`/field/outlets/${outlet.id}`),
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
    <form
      onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
      className="flex h-full flex-col"
    >
      <div className="flex-1 space-y-5 p-4">
        <h1 className="text-xl font-semibold tracking-tight">New Outlet</h1>

        <div className="space-y-1.5">
          <Label className="text-base">Customer</Label>
          <Select className="h-12 text-base" {...form.register('customerId')}>
            <option value="">Select a customer…</option>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.customerName}
              </option>
            ))}
          </Select>
          {form.formState.errors.customerId && (
            <p className="text-sm text-destructive">{form.formState.errors.customerId.message}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label className="text-base">Outlet Type</Label>
          <Select className="h-12 text-base" {...form.register('outletType')}>
            {Object.entries(OUTLET_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-base">Outlet Name</Label>
          <Input
            className="h-12 text-base"
            placeholder="e.g. Bodija Supermart — Main Branch"
            {...form.register('name')}
          />
          {form.formState.errors.name && (
            <p className="text-sm text-destructive">{form.formState.errors.name.message}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label className="text-base">Territory (optional)</Label>
          <Select className="h-12 text-base" {...form.register('territoryId')}>
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
            size="touch"
            className="w-full"
            onClick={handleCaptureLocation}
            disabled={capturingLocation}
          >
            {capturingLocation ? 'Capturing…' : '📍 Capture Location'}
          </Button>
          {locationNote && <p className="text-sm text-muted-foreground">{locationNote}</p>}
        </div>

        <MultiImageUploadCard
          title="Outlet Photo"
          description="Front, signage, interior, or shelf display — optional, added after saving."
          photos={[]}
          onUpload={(files) => setStagedFiles((current) => [...current, ...files])}
          preferCamera
        />
        {stagedFiles.length > 0 && (
          <p className="text-sm text-muted-foreground">
            {stagedFiles.length} photo{stagedFiles.length === 1 ? '' : 's'} ready to upload.
          </p>
        )}

        {mutation.isError && (
          <p className="text-sm text-destructive">
            {mutation.error instanceof ApiError ? mutation.error.message : 'Failed to save outlet.'}
          </p>
        )}
      </div>

      <FieldStickyActionBar>
        <Button type="submit" size="touch" className="w-full" disabled={mutation.isPending}>
          {mutation.isPending ? 'Saving…' : 'Save Outlet'}
        </Button>
      </FieldStickyActionBar>
    </form>
  );
}
