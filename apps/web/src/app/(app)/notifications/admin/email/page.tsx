'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button } from '@zentuva/ui';

import { ApiError } from '@/lib/api-client';
import { NotificationTabs } from '@/components/app/notification-tabs';

import {
  EmailDeliveryStatus,
  listEmailDeliveries,
  processEmailDeliveries,
  retryEmailDelivery,
} from '../../api';

const STATUS_VARIANT: Record<
  EmailDeliveryStatus,
  'default' | 'success' | 'warning' | 'destructive'
> = {
  PENDING: 'default',
  PROCESSING: 'warning',
  SENT: 'success',
  FAILED: 'destructive',
};

const RETRYABLE: EmailDeliveryStatus[] = ['FAILED', 'PROCESSING'];

/**
 * Sprint 28 §Workstream G "Operational Administration" (docs/architecture/
 * email-delivery.md). Gated server-side by `notification.email.view`/`.manage` —
 * this page renders for everyone (no client-side permission hook exists anywhere
 * in this codebase, matching `NotificationAdminProcessingPage`'s own precedent)
 * and shows a clear permission-denied state on a 403 rather than silently
 * failing. Recipient email addresses ARE shown here — a genuinely more
 * sensitive surface than the in-app processing-records page, which is exactly
 * why this is a separate permission/tab rather than folded into that one.
 */
export default function NotificationAdminEmailDeliveriesPage() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<'' | EmailDeliveryStatus>('FAILED');

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['notifications', 'admin', 'email-deliveries', statusFilter],
    queryFn: () => listEmailDeliveries({ status: statusFilter || undefined, pageSize: 50 }),
  });

  const retryMutation = useMutation({
    mutationFn: (id: string) => retryEmailDelivery(id),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['notifications', 'admin', 'email-deliveries'] }),
  });

  const checkNowMutation = useMutation({
    mutationFn: () => processEmailDeliveries(),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['notifications', 'admin', 'email-deliveries'] }),
  });

  const isForbidden = error instanceof ApiError && error.status === 403;
  const records = data?.items ?? [];

  return (
    <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <div className="mb-8 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Notifications</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Admin: Email Deliveries — inspect and retry transactional email delivery.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => checkNowMutation.mutate()}
          disabled={checkNowMutation.isPending}
        >
          {checkNowMutation.isPending ? 'Checking…' : 'Check for new'}
        </Button>
      </div>

      <NotificationTabs />

      {isLoading && (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading email deliveries…</p>
      )}

      {isError && isForbidden && (
        <div className="flex flex-col items-center gap-2 py-10 text-center">
          <p className="text-sm text-destructive">
            You don&apos;t have permission to view email delivery records.
          </p>
          <p className="text-xs text-muted-foreground">
            Requires the &quot;View email delivery&quot; permission.
          </p>
        </div>
      )}
      {isError && !isForbidden && (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <p className="text-sm text-destructive">
            {error instanceof ApiError ? error.message : 'Failed to load email deliveries.'}
          </p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      )}

      {!isLoading && !isError && (
        <>
          <div className="mb-4 flex items-center gap-2 overflow-x-auto pb-1">
            {(['', 'FAILED', 'PROCESSING', 'PENDING', 'SENT'] as const).map((status) => (
              <Button
                key={status || 'all'}
                size="sm"
                variant={statusFilter === status ? 'default' : 'outline'}
                onClick={() => setStatusFilter(status)}
              >
                {status || 'All'}
              </Button>
            ))}
          </div>

          {records.length === 0 && (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No email deliveries match this filter.
            </p>
          )}

          <div className="space-y-3">
            {records.map((record) => (
              <div key={record.id} className="rounded-lg border border-border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs">{record.templateKey}</span>
                      <Badge variant={STATUS_VARIANT[record.status]}>{record.status}</Badge>
                      {record.providerName && (
                        <Badge variant="default">{record.providerName}</Badge>
                      )}
                    </div>
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      to {record.recipientEmail}
                      {record.recipientDisplayName ? ` (${record.recipientDisplayName})` : ''} ·
                      subject &quot;{record.subject}&quot;
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      attempts: {record.attempts} · created{' '}
                      {new Date(record.createdAt).toLocaleString()}
                      {record.sentAt && <> · sent {new Date(record.sentAt).toLocaleString()}</>}
                    </p>
                    {record.providerMessageId && (
                      <p className="mt-1 truncate text-xs text-muted-foreground">
                        provider message id: {record.providerMessageId}
                      </p>
                    )}
                    {record.lastError && (
                      <p className="mt-1 text-xs text-destructive">
                        [{record.lastErrorCategory ?? 'ERROR'}] {record.lastError}
                      </p>
                    )}
                    {record.nextRetryAt && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Next automatic retry: {new Date(record.nextRetryAt).toLocaleString()}
                      </p>
                    )}
                  </div>
                  {RETRYABLE.includes(record.status) && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => retryMutation.mutate(record.id)}
                      disabled={retryMutation.isPending}
                    >
                      Retry now
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </main>
  );
}
