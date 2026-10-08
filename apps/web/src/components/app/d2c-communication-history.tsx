'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Badge, Button } from '@zentuva/ui';

import { ApiError } from '@/lib/api-client';
import {
  type ConsumerWhatsAppDeliverySummary,
  retryCommunication,
} from '@/app/(app)/settings/d2c/api';

const KIND_LABELS: Record<string, string> = {
  COLLECTION_READY: 'Ready for Collection',
  COLLECTION_CONFIRMED: 'Collected',
};

const STATUS_BADGE_VARIANT: Record<string, 'success' | 'destructive' | 'default'> = {
  SENT: 'success',
  FAILED: 'destructive',
  PENDING: 'default',
  PROCESSING: 'default',
};

/**
 * Sprint 43 — D2C Operations, Notifications & Production Hardening
 * (docs/domains/d2c.md "Consumer Communication Delivery Visibility"). Shared by the
 * order detail page (`by-order/:salesOrderId`) and a future consumer detail view
 * (`by-consumer/:consumerId`) — the caller fetches the list and passes it in, this
 * component only renders it plus the Retry action. A failed retry (e.g. a 403 from a
 * caller without `d2c.communication.manage`) surfaces inline, never silently.
 */
export function CommunicationHistoryList({
  items,
  queryKeyToInvalidate,
}: {
  items: ConsumerWhatsAppDeliverySummary[];
  /** Re-fetched after a successful retry so the row's new status/attempts/WAMID shows
   *  immediately — never a stale, pre-retry row. */
  queryKeyToInvalidate: unknown[];
}) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">No WhatsApp notifications sent yet.</p>;
  }

  return (
    <ul className="space-y-3 text-sm">
      {items.map((item) => (
        <CommunicationRow key={item.id} item={item} queryKeyToInvalidate={queryKeyToInvalidate} />
      ))}
    </ul>
  );
}

function CommunicationRow({
  item,
  queryKeyToInvalidate,
}: {
  item: ConsumerWhatsAppDeliverySummary;
  queryKeyToInvalidate: unknown[];
}) {
  const queryClient = useQueryClient();
  const retry = useMutation({
    mutationFn: () => retryCommunication(item.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeyToInvalidate });
    },
  });

  return (
    <li className="rounded-md border border-border p-3">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="font-medium">{KIND_LABELS[item.kind] ?? item.kind}</p>
          <p className="text-xs text-muted-foreground">
            {new Date(item.createdAt).toLocaleString()} · {item.providerName ?? 'no provider'}
          </p>
        </div>
        <Badge variant={STATUS_BADGE_VARIANT[item.status] ?? 'default'}>{item.status}</Badge>
      </div>
      {item.providerMessageId && (
        <p className="mt-1 text-xs text-muted-foreground">WAMID: {item.providerMessageId}</p>
      )}
      {item.status === 'FAILED' && (
        <div className="mt-2 space-y-2">
          <p className="text-xs text-destructive">
            {item.lastErrorCode}
            {item.lastErrorMessage ? ` — ${item.lastErrorMessage}` : ''}
          </p>
          {retry.isError && (
            <p className="text-xs text-destructive">
              {retry.error instanceof ApiError ? retry.error.message : 'Retry failed.'}
            </p>
          )}
          <Button
            size="sm"
            variant="outline"
            disabled={retry.isPending}
            onClick={() => retry.mutate()}
          >
            {retry.isPending ? 'Retrying…' : 'Retry'}
          </Button>
        </div>
      )}
    </li>
  );
}
