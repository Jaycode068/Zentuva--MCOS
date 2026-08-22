'use client';

import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button } from '@zentuva/ui';

import { MultiImageUploadCard } from '@/components/app/multi-image-upload-card';
import { FieldStickyActionBar } from '@/components/field/FieldStickyActionBar';
import { ApiError } from '@/lib/api-client';

import { addOutletPhotos, getOutlet, removeOutletPhoto } from '../../api';
import { OUTLET_STATUS_LABELS, OUTLET_STATUS_VARIANT, OUTLET_TYPE_LABELS } from '../../labels';

/** Outlet detail (Sprint 4.8 brief §22) — profile, photos (add/remove), and a direct
 *  path into a new order for the owning customer. */
export default function FieldOutletDetailPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const queryClient = useQueryClient();

  const { data: outlet } = useQuery({ queryKey: ['outlet', id], queryFn: () => getOutlet(id) });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['outlet', id] });
  const uploadMutation = useMutation({
    mutationFn: (files: File[]) => addOutletPhotos(id, files),
    onSuccess: invalidate,
  });
  const removeMutation = useMutation({
    mutationFn: (photoId: string) => removeOutletPhoto(id, photoId),
    onSuccess: invalidate,
  });

  if (!outlet) {
    return <p className="p-4 text-sm text-muted-foreground">Loading…</p>;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-4 p-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">{outlet.name}</h1>
            <Badge variant={OUTLET_STATUS_VARIANT[outlet.status]}>
              {OUTLET_STATUS_LABELS[outlet.status]}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {OUTLET_TYPE_LABELS[outlet.outletType]} · {outlet.customer.customerName}
          </p>
          {outlet.territory && (
            <p className="text-sm text-muted-foreground">{outlet.territory.name}</p>
          )}
          {outlet.latitude != null && outlet.longitude != null && (
            <p className="text-xs text-muted-foreground">
              {outlet.latitude.toFixed(4)}, {outlet.longitude.toFixed(4)}
            </p>
          )}
        </div>

        <MultiImageUploadCard
          title="Photos"
          description="Front, signage, interior, or shelf display."
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
      </div>

      <FieldStickyActionBar>
        <Link
          href={`/field/orders/new?customerId=${outlet.customer.id}&outletId=${outlet.id}`}
          className="w-full"
        >
          <Button size="touch" className="w-full">
            + New Order
          </Button>
        </Link>
      </FieldStickyActionBar>
    </div>
  );
}
