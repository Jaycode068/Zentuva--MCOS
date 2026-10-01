'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button } from '@zentuva/ui';

import { ApiError } from '@/lib/api-client';

import {
  type CollectionPointFulfillment,
  confirmCollection,
  listCollectionPointQueue,
  listMyCollectionPointOutlets,
  markReadyForCollection,
  startPreparing,
} from './api';

/**
 * Sprint 37 — Collection Point Fulfillment, the Field operational screen
 * (docs/domains/d2c.md "Field / Collection Point UX"). Answers exactly one question:
 * "which paid consumer orders do I need to fulfil right now?" Deliberately simple —
 * status-grouped list + one action button per row, never a generalized field-operations
 * framework. Every action is a single guarded backend call; there is no free-text status
 * editor anywhere on this page.
 */
export default function CollectionPointPage() {
  const queryClient = useQueryClient();
  const [selectedOutletId, setSelectedOutletId] = useState<string | null>(null);

  const { data: outletsData, isLoading: outletsLoading } = useQuery({
    queryKey: ['my-collection-point-outlets'],
    queryFn: listMyCollectionPointOutlets,
  });
  const outlets = outletsData?.items ?? [];
  const outletId = selectedOutletId ?? outlets[0]?.id ?? null;

  const { data: queueData, isLoading: queueLoading } = useQuery({
    queryKey: ['collection-point-queue', outletId],
    queryFn: () => listCollectionPointQueue(outletId!),
    enabled: !!outletId,
    refetchInterval: 15000,
  });
  const items = queueData?.items ?? [];

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['collection-point-queue', outletId] });
  }

  const prepareMutation = useMutation({ mutationFn: startPreparing, onSuccess: invalidate });
  const readyMutation = useMutation({ mutationFn: markReadyForCollection, onSuccess: invalidate });
  const collectMutation = useMutation({ mutationFn: confirmCollection, onSuccess: invalidate });

  const error =
    prepareMutation.error instanceof ApiError
      ? prepareMutation.error.message
      : readyMutation.error instanceof ApiError
        ? readyMutation.error.message
        : collectMutation.error instanceof ApiError
          ? collectMutation.error.message
          : undefined;

  if (outletsLoading) {
    return <p className="p-4 text-sm text-muted-foreground">Loading…</p>;
  }

  if (outlets.length === 0) {
    return (
      <div className="p-4">
        <h1 className="text-xl font-semibold tracking-tight">Collection Point</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          You are not the responsible representative for any Collection Point yet.
        </p>
      </div>
    );
  }

  const assigned = items.filter((item) => item.status === 'ASSIGNED');
  const preparing = items.filter((item) => item.status === 'PREPARING');
  const ready = items.filter((item) => item.status === 'READY_FOR_COLLECTION');
  const collected = items.filter((item) => item.status === 'COLLECTED');

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Collection Point</h1>
        {outlets.length > 1 ? (
          <select
            className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            value={outletId ?? ''}
            onChange={(e) => setSelectedOutletId(e.target.value)}
          >
            {outlets.map((outlet) => (
              <option key={outlet.id} value={outlet.id}>
                {outlet.name}
              </option>
            ))}
          </select>
        ) : (
          <p className="text-sm text-muted-foreground">{outlets[0]!.name}</p>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {queueLoading ? (
        <p className="text-sm text-muted-foreground">Loading queue…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No D2C orders assigned right now.</p>
      ) : (
        <div className="space-y-6 overflow-y-auto">
          <QueueSection
            title="Needs Preparation"
            items={assigned}
            actionLabel="Start Preparing"
            onAction={(id) => prepareMutation.mutate(id)}
            actionPending={prepareMutation.isPending}
          />
          <QueueSection
            title="Preparing"
            items={preparing}
            actionLabel="Mark Ready for Collection"
            onAction={(id) => readyMutation.mutate(id)}
            actionPending={readyMutation.isPending}
          />
          <QueueSection
            title="Ready for Collection"
            items={ready}
            actionLabel="Confirm Collection"
            onAction={(id) => collectMutation.mutate(id)}
            actionPending={collectMutation.isPending}
          />
          <QueueSection title="Recently Collected" items={collected} />
        </div>
      )}
    </div>
  );
}

function QueueSection({
  title,
  items,
  actionLabel,
  onAction,
  actionPending,
}: {
  title: string;
  items: CollectionPointFulfillment[];
  actionLabel?: string;
  onAction?: (id: string) => void;
  actionPending?: boolean;
}) {
  if (items.length === 0) {
    return null;
  }
  return (
    <div>
      <h2 className="mb-2 text-sm font-semibold text-muted-foreground">
        {title} ({items.length})
      </h2>
      <div className="space-y-2">
        {items.map((item) => (
          <div key={item.id} className="rounded-md border border-border p-3">
            <div className="flex items-center justify-between">
              <p className="font-medium text-foreground">Order {item.orderReference}</p>
              <Badge variant="default">{item.salesOrderStatus}</Badge>
            </div>
            {item.consumer && (
              <p className="text-sm text-muted-foreground">
                {item.consumer.name} · {item.consumer.phoneNumber}
              </p>
            )}
            <ul className="mt-1 text-sm text-muted-foreground">
              {item.items.map((line, i) => (
                <li key={i}>
                  {line.quantity} {line.unit} — {line.productName}
                </li>
              ))}
            </ul>
            {actionLabel && onAction && (
              <Button
                size="sm"
                className="mt-2"
                onClick={() => onAction(item.id)}
                disabled={actionPending}
              >
                {actionPending ? 'Working…' : actionLabel}
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
