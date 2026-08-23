'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Input,
  Label,
  Sheet,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  Textarea,
} from '@zentuva/ui';

import { FieldStickyActionBar } from '@/components/field/FieldStickyActionBar';
import { ImageUploadCard } from '@/components/app/image-upload-card';
import { ApiError } from '@/lib/api-client';

import {
  cancelDispatch,
  createDelivery,
  dispatchOut,
  getDispatch,
  listDeliveries,
  markInTransit,
  uploadDeliveryPhoto,
  type Dispatch,
} from '../../api';
import { DISPATCH_STATUS_LABELS, DISPATCH_STATUS_VARIANT } from '../../labels';

/** Dispatch detail (Sprint 5, docs/domains/distribution.md) — the same record an Admin
 *  sees, presented as a mobile card layout with Dispatch/Mark In Transit/Record Delivery
 *  as the sticky primary actions. */
export default function FieldDeliveryDetailPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const queryClient = useQueryClient();
  const [deliverOpen, setDeliverOpen] = useState(false);

  const { data: dispatch } = useQuery({
    queryKey: ['dispatch', id],
    queryFn: () => getDispatch(id),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['dispatch', id] });
    queryClient.invalidateQueries({ queryKey: ['deliveries', id] });
  };
  const dispatchMutation = useMutation({
    mutationFn: () => dispatchOut(id),
    onSuccess: invalidate,
  });
  const inTransitMutation = useMutation({
    mutationFn: () => markInTransit(id),
    onSuccess: invalidate,
  });
  const cancelMutation = useMutation({
    mutationFn: () => cancelDispatch(id),
    onSuccess: invalidate,
  });

  if (!dispatch) {
    return <p className="p-4 text-sm text-muted-foreground">Loading…</p>;
  }

  const canDeliver =
    dispatch.status === 'DISPATCHED' ||
    dispatch.status === 'IN_TRANSIT' ||
    dispatch.status === 'PARTIALLY_DELIVERED';
  const canCancel =
    dispatch.status === 'READY' ||
    dispatch.status === 'DISPATCHED' ||
    dispatch.status === 'IN_TRANSIT';

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-4 p-4">
        <div className="flex items-center justify-between">
          <h1 className="font-mono text-lg font-semibold">{dispatch.dispatchCode}</h1>
          <Badge variant={DISPATCH_STATUS_VARIANT[dispatch.status]}>
            {DISPATCH_STATUS_LABELS[dispatch.status]}
          </Badge>
        </div>
        <div>
          <p className="font-medium">{dispatch.customer.customerName}</p>
          <p className="text-sm text-muted-foreground">
            {dispatch.outlet?.name ?? 'No outlet override — order default destination'}
          </p>
        </div>

        <div className="space-y-2">
          {dispatch.items.map((item) => (
            <div key={item.id} className="rounded-lg border border-border p-3">
              <p className="font-medium">{item.product.name}</p>
              <div className="mt-1 flex justify-between text-sm text-muted-foreground">
                <span>
                  Dispatched: {item.quantityDispatched} {item.product.unit}
                </span>
                <span className="font-medium text-foreground">
                  Delivered: {item.quantityDelivered} / {item.quantityDispatched}
                </span>
              </div>
            </div>
          ))}
        </div>

        {(dispatchMutation.isError || inTransitMutation.isError || cancelMutation.isError) && (
          <p className="text-sm text-destructive">
            {[dispatchMutation, inTransitMutation, cancelMutation]
              .map((m) => (m.error instanceof ApiError ? m.error.message : undefined))
              .find(Boolean) ?? 'That action could not be completed.'}
          </p>
        )}
      </div>

      {(dispatch.status === 'READY' || dispatch.status === 'DISPATCHED' || canDeliver) && (
        <FieldStickyActionBar className="flex-col gap-2">
          {dispatch.status === 'READY' && (
            <Button
              size="touch"
              className="w-full"
              onClick={() => dispatchMutation.mutate()}
              disabled={dispatchMutation.isPending}
            >
              {dispatchMutation.isPending ? 'Dispatching…' : 'Dispatch'}
            </Button>
          )}
          {dispatch.status === 'DISPATCHED' && (
            <Button
              size="touch"
              className="w-full"
              onClick={() => inTransitMutation.mutate()}
              disabled={inTransitMutation.isPending}
            >
              {inTransitMutation.isPending ? 'Updating…' : 'Mark In Transit'}
            </Button>
          )}
          {canDeliver && (
            <Button size="touch" className="w-full" onClick={() => setDeliverOpen(true)}>
              Record Delivery
            </Button>
          )}
          {canCancel && (
            <Button
              variant="outline"
              size="touch"
              className="w-full"
              onClick={() => cancelMutation.mutate()}
              disabled={cancelMutation.isPending}
            >
              {cancelMutation.isPending ? 'Cancelling…' : 'Cancel Dispatch'}
            </Button>
          )}
        </FieldStickyActionBar>
      )}

      <FieldDeliverySheet
        dispatch={dispatch}
        open={deliverOpen}
        onOpenChange={setDeliverOpen}
        onDelivered={invalidate}
      />
    </div>
  );
}

/** Full-screen (`side="full"`) delivery-confirmation flow — mirrors `FieldFulfilSheet`'s
 *  exact shape (Dispatched/Already Delivered/Remaining grid), plus recipient name, notes,
 *  and an optional proof-of-delivery photo captured directly from the device camera.
 *  Deliberately allows a short/partial delivery — this sprint builds no reason-code
 *  enum, so `notes` is where the "why" is captured in free text. Once the delivery is
 *  recorded, the sheet stays open on a second "Add photo" step rather than closing
 *  immediately — the photo-upload endpoint needs the delivery's own id, which only
 *  exists after this first write succeeds. */
function FieldDeliverySheet({
  dispatch,
  open,
  onOpenChange,
  onDelivered,
}: {
  dispatch: Dispatch;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDelivered: () => void;
}) {
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [deliveryId, setDeliveryId] = useState<string | null>(null);
  const [receivedByName, setReceivedByName] = useState('');
  const [notes, setNotes] = useState('');
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

  const rows = useMemo(
    () =>
      dispatch.items
        .map((item) => ({
          dispatchItemId: item.id,
          name: item.product.name,
          unit: item.product.unit,
          dispatched: item.quantityDispatched,
          alreadyDelivered: item.quantityDelivered,
          remaining: Math.max(0, item.quantityDispatched - item.quantityDelivered),
        }))
        .filter((row) => row.remaining > 0),
    [dispatch.items],
  );

  const mutation = useMutation({
    mutationFn: async () => {
      const items = rows
        .map((row) => ({
          dispatchItemId: row.dispatchItemId,
          quantity: quantities[row.dispatchItemId] ?? 0,
        }))
        .filter((item) => item.quantity > 0);
      await createDelivery(dispatch.id, {
        deliveryDate: new Date().toISOString().slice(0, 10),
        receivedByName: receivedByName || undefined,
        notes: notes || undefined,
        idempotencyKey,
        items,
      });
      const deliveries = await listDeliveries(dispatch.id);
      return deliveries.items[0] ?? null;
    },
    onSuccess: (delivery) => {
      setQuantities({});
      if (delivery) setDeliveryId(delivery.id);
      onDelivered();
    },
  });

  const photoMutation = useMutation({
    mutationFn: (file: File) => uploadDeliveryPhoto(deliveryId!, file),
    onSuccess: (delivery) => setPhotoUrl(delivery.photoUrl),
  });

  const hasAnyQuantity = Object.values(quantities).some((value) => (value ?? 0) > 0);
  const hasOverDelivery = rows.some((row) => (quantities[row.dispatchItemId] ?? 0) > row.remaining);

  function reset() {
    setDeliveryId(null);
    setReceivedByName('');
    setNotes('');
    setPhotoUrl(null);
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setIdempotencyKey(crypto.randomUUID());
          reset();
        }
        onOpenChange(next);
      }}
      side="full"
    >
      <SheetHeader>
        <SheetTitle>Deliver {dispatch.dispatchCode}</SheetTitle>
      </SheetHeader>

      {deliveryId ? (
        <div className="flex-1 space-y-4 overflow-y-auto">
          <p className="text-sm text-muted-foreground">
            Delivery recorded. Attach a photo for proof of delivery (optional).
          </p>
          <ImageUploadCard
            title="Proof of Delivery"
            description="A quick photo of the received goods or a signed note."
            imageUrl={photoUrl}
            fallbackInitials="PD"
            onUpload={(file) => photoMutation.mutate(file)}
            isUploading={photoMutation.isPending}
            error={photoMutation.error instanceof ApiError ? photoMutation.error.message : null}
            preferCamera
          />
        </div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Every line on this dispatch has already been fully delivered.
        </p>
      ) : (
        <div className="flex-1 space-y-4 overflow-y-auto">
          <div className="space-y-1.5">
            <Label className="text-base">Received By (optional)</Label>
            <Input
              className="h-12 text-base"
              value={receivedByName}
              onChange={(event) => setReceivedByName(event.target.value)}
              placeholder="Recipient's name"
            />
          </div>

          <div className="space-y-2">
            {rows.map((row) => {
              const quantity = quantities[row.dispatchItemId] ?? 0;
              const overDelivery = quantity > row.remaining;
              return (
                <div key={row.dispatchItemId} className="rounded-xl border border-border p-3">
                  <p className="font-medium">{row.name}</p>
                  <div className="mt-2 grid grid-cols-3 gap-x-4 gap-y-1 rounded-md bg-muted/30 p-2 text-xs text-muted-foreground">
                    <div>
                      Dispatched
                      <div className="font-medium text-foreground">{row.dispatched}</div>
                    </div>
                    <div>
                      Delivered
                      <div className="font-medium text-foreground">{row.alreadyDelivered}</div>
                    </div>
                    <div>
                      Remaining
                      <div className="font-medium text-foreground">{row.remaining}</div>
                    </div>
                  </div>
                  <div className="mt-2 space-y-1">
                    <Label className="text-xs">Delivered Quantity</Label>
                    <Input
                      type="number"
                      min={0}
                      className="h-11 text-base"
                      value={quantity}
                      onChange={(event) =>
                        setQuantities((current) => ({
                          ...current,
                          [row.dispatchItemId]: Number(event.target.value) || 0,
                        }))
                      }
                    />
                    {overDelivery && (
                      <p className="text-xs text-destructive">
                        Only {row.remaining} {row.unit} remains undelivered.
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="space-y-1.5">
            <Label className="text-base">Notes (optional)</Label>
            <Textarea
              className="text-base"
              rows={2}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Explain any shortfall — e.g. damaged, lost, or refused"
            />
          </div>

          {mutation.isError && (
            <p className="text-sm text-destructive">
              {mutation.error instanceof ApiError
                ? mutation.error.message
                : 'Failed to record delivery.'}
            </p>
          )}
        </div>
      )}

      <SheetFooter>
        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={() => onOpenChange(false)}
        >
          {deliveryId ? 'Done' : rows.length === 0 ? 'Close' : 'Cancel'}
        </Button>
        {!deliveryId && rows.length > 0 && (
          <Button
            type="button"
            className="w-full"
            disabled={!hasAnyQuantity || hasOverDelivery || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? 'Recording…' : 'Record Delivery'}
          </Button>
        )}
      </SheetFooter>
    </Sheet>
  );
}
