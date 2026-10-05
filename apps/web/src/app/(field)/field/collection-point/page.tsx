'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button } from '@zentuva/ui';

import { ApiError } from '@/lib/api-client';

import {
  type CollectionPointFulfillment,
  confirmCollection,
  getCollectionPointInventory,
  listCollectionPointQueue,
  listMyCollectionPointOutlets,
  markReadyForCollection,
  startPreparing,
} from './api';

/**
 * Sprint 38 — Field Operations & Collection Point Mobile Experience
 * (docs/domains/d2c.md). A minimal, DOCUMENTED UI-only threshold for flagging "this
 * order has been sitting too long" in the Attention section below — never a business
 * rule, never enforced server-side, purely a display highlight computed from
 * timestamps the backend already returns. No existing configured threshold exists for
 * this anywhere in the codebase (confirmed by audit), so this sprint picks one
 * reasonable, documented default rather than inventing a silent one: 30 minutes since
 * the order's current stage began (`assignedAt` while ASSIGNED, `preparingAt` while
 * PREPARING, `readyAt` while READY_FOR_COLLECTION).
 */
const ATTENTION_WAITING_MINUTES = 30;

function minutesSince(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / 60_000;
}

function currentStageStartedAt(item: CollectionPointFulfillment): string {
  if (item.status === 'READY_FOR_COLLECTION') return item.readyAt ?? item.assignedAt;
  if (item.status === 'PREPARING') return item.preparingAt ?? item.assignedAt;
  return item.assignedAt;
}

/**
 * Sprint 37 — Collection Point Fulfillment, the Field operational screen
 * (docs/domains/d2c.md "Field / Collection Point UX"). Answers exactly one question:
 * "which paid consumer orders do I need to fulfil right now?" Deliberately simple —
 * status-grouped list + one action button per row, never a generalized field-operations
 * framework. Every action is a single guarded backend call; there is no free-text status
 * editor anywhere on this page.
 *
 * Sprint 38 extends this with: a Today dashboard, an Attention Required section (orders
 * awaiting preparation, waiting too long, or facing an inventory shortfall — all
 * computed client-side from data the backend already returned and already authorized,
 * never a new server-side business rule), a compact inventory view, and a confirmation
 * step before the one irreversible action (Confirm Collection).
 */
export default function CollectionPointPage() {
  const queryClient = useQueryClient();
  const [selectedOutletId, setSelectedOutletId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

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

  const { data: inventoryData } = useQuery({
    queryKey: ['collection-point-inventory', outletId],
    queryFn: () => getCollectionPointInventory(outletId!),
    enabled: !!outletId,
    refetchInterval: 15000,
  });
  const inventory = inventoryData?.items ?? [];
  const shortages = inventory.filter((row) => row.status === 'SHORT');

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['collection-point-queue', outletId] });
    queryClient.invalidateQueries({ queryKey: ['collection-point-inventory', outletId] });
  }

  const prepareMutation = useMutation({ mutationFn: startPreparing, onSuccess: invalidate });
  const readyMutation = useMutation({ mutationFn: markReadyForCollection, onSuccess: invalidate });
  const collectMutation = useMutation({
    mutationFn: confirmCollection,
    onSuccess: () => {
      setConfirmingId(null);
      invalidate();
    },
  });

  // Sprint 38 — a stale/already-processed/conflicting operation (e.g. another rep
  // confirmed collection first) surfaces here as a plain error message, never a faked
  // success — the user is expected to dismiss and the next 15s poll (or a manual
  // refresh) reconciles the real state. No frontend locking is attempted.
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
  const collectedToday = items.filter(
    (item) =>
      item.status === 'COLLECTED' &&
      item.collectedAt &&
      new Date(item.collectedAt).toDateString() === new Date().toDateString(),
  );

  const waitingTooLong = [...assigned, ...preparing, ...ready].filter(
    (item) => minutesSince(currentStageStartedAt(item)) > ATTENTION_WAITING_MINUTES,
  );
  const attentionCount = assigned.length + waitingTooLong.length + shortages.length;

  return (
    <div className="flex h-full flex-col gap-5 p-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Collection Point</h1>
        {outlets.length > 1 ? (
          <select
            className="mt-2 h-11 w-full rounded-md border border-border bg-background px-3 text-sm"
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

      {error && (
        <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</p>
      )}

      {queueLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="space-y-5 overflow-y-auto">
          <section>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Today
            </h2>
            <div className="grid grid-cols-3 gap-2">
              <StatTile label="Preparing" value={preparing.length} />
              <StatTile label="Ready for Collection" value={ready.length} />
              <StatTile label="Collected" value={collectedToday.length} />
            </div>
          </section>

          {attentionCount > 0 && (
            <section className="rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-3">
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-yellow-700 dark:text-yellow-400">
                Needs Attention
              </h2>
              <ul className="space-y-1 text-sm">
                {assigned.length > 0 && (
                  <li>
                    {assigned.length} order{assigned.length === 1 ? '' : 's'} awaiting preparation
                  </li>
                )}
                {waitingTooLong.length > 0 && (
                  <li>
                    {waitingTooLong.length} order{waitingTooLong.length === 1 ? '' : 's'} waiting
                    over {ATTENTION_WAITING_MINUTES} minutes
                  </li>
                )}
                {shortages.map((row) => (
                  <li key={row.productId}>
                    {row.productName} short by {row.shortfall} {row.unit}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {inventory.length > 0 && (
            <section>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Inventory for Queued Orders
              </h2>
              <div className="space-y-1.5">
                {inventory.map((row) => (
                  <div
                    key={row.productId}
                    className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm"
                  >
                    <span className="font-medium">{row.productName}</span>
                    <span
                      className={
                        row.status === 'SHORT' ? 'text-destructive' : 'text-muted-foreground'
                      }
                    >
                      {row.available} on hand · {row.required} needed
                      {row.status === 'SHORT' ? ` · short ${row.shortfall}` : ''}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground">No D2C orders assigned right now.</p>
          ) : (
            <section className="space-y-5">
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
                onAction={(id) => setConfirmingId(id)}
                actionPending={collectMutation.isPending}
              />
              <QueueSection title="Collected Today" items={collectedToday} />
            </section>
          )}
        </div>
      )}

      {confirmingId && (
        <ConfirmCollectionDialog
          order={items.find((item) => item.id === confirmingId) ?? null}
          pending={collectMutation.isPending}
          onCancel={() => setConfirmingId(null)}
          onConfirm={() => collectMutation.mutate(confirmingId)}
        />
      )}
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border p-3 text-center">
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
      <p className="mt-0.5 text-xs leading-tight text-muted-foreground">{label}</p>
    </div>
  );
}

/** Sprint 38 (brief §14: "confirmation before irreversible operational actions") —
 *  Confirm Collection is the one step that triggers real inventory deduction via the
 *  existing `SalesFulfilmentService.fulfil()`; a mis-tap here cannot be undone from the
 *  Field UI. A plain, blocking confirmation — no new dialog framework. */
function ConfirmCollectionDialog({
  order,
  pending,
  onCancel,
  onConfirm,
}: {
  order: CollectionPointFulfillment | null;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center">
      <div className="w-full max-w-sm rounded-t-xl bg-background p-4 shadow-lg sm:rounded-xl">
        <h2 className="text-base font-semibold">Confirm Collection?</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {order
            ? `Order ${order.orderReference} will be marked collected and stock will be deducted. This cannot be undone.`
            : 'This cannot be undone.'}
        </p>
        <div className="mt-4 flex gap-2">
          <Button variant="outline" className="h-11 flex-1" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
          <Button className="h-11 flex-1" onClick={onConfirm} disabled={pending}>
            {pending ? 'Confirming…' : 'Confirm'}
          </Button>
        </div>
      </div>
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
        {items.map((item) => {
          const waiting = minutesSince(currentStageStartedAt(item)) > ATTENTION_WAITING_MINUTES;
          return (
            <div key={item.id} className="rounded-md border border-border p-3">
              <div className="flex items-center justify-between gap-2">
                <Link
                  href={`/field/collection-point/${item.id}`}
                  className="font-medium text-foreground underline-offset-2 hover:underline"
                >
                  Order {item.orderReference}
                </Link>
                <div className="flex items-center gap-1.5">
                  {waiting && (
                    <Badge
                      variant="warning"
                      title={`Waiting over ${ATTENTION_WAITING_MINUTES} min`}
                    >
                      Waiting
                    </Badge>
                  )}
                  <Badge variant="default">{item.status.replace(/_/g, ' ')}</Badge>
                </div>
              </div>
              {item.consumer && (
                <p className="text-sm text-muted-foreground">{item.consumer.name}</p>
              )}
              <ul className="mt-1 text-sm text-muted-foreground">
                {item.items.map((line, i) => (
                  <li key={i}>
                    {line.quantity} {line.unit} — {line.productName}
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex gap-2">
                {actionLabel && onAction && (
                  <Button
                    size="sm"
                    className="h-10 flex-1"
                    onClick={() => onAction(item.id)}
                    disabled={actionPending}
                  >
                    {actionPending ? 'Working…' : actionLabel}
                  </Button>
                )}
                <Link href={`/field/collection-point/${item.id}`} className="shrink-0">
                  <Button size="sm" variant="outline" className="h-10">
                    View
                  </Button>
                </Link>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
