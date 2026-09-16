'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button } from '@zentuva/ui';

import { ApiError } from '@/lib/api-client';
import { NotificationTabs } from '@/components/app/notification-tabs';

import { listProcessingRecords, NotificationProcessingStatus, retryProcessingRecord } from '../api';

const STATUS_VARIANT: Record<
  NotificationProcessingStatus,
  'default' | 'success' | 'warning' | 'destructive'
> = {
  PENDING: 'default',
  PROCESSING: 'warning',
  PROCESSED: 'success',
  FAILED: 'destructive',
};

const RETRYABLE: NotificationProcessingStatus[] = ['FAILED', 'PROCESSING'];

/**
 * Sprint 27.1 §Workstream F "Operational Administration" (docs/domains/
 * notifications.md §5). Gated server-side by `notification.processing.view`/
 * `.manage` — this page renders for everyone (no client-side permission hook
 * exists anywhere in this codebase, matching every other admin-only surface's
 * existing convention) and shows a clear permission-denied state on a 403 rather
 * than silently failing.
 */
export default function NotificationAdminProcessingPage() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<'' | NotificationProcessingStatus>('FAILED');

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['notifications', 'admin', 'processing', statusFilter],
    queryFn: () => listProcessingRecords({ status: statusFilter || undefined, pageSize: 50 }),
  });

  const retryMutation = useMutation({
    mutationFn: (eventId: string) => retryProcessingRecord(eventId),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['notifications', 'admin', 'processing'] }),
  });

  const isForbidden = error instanceof ApiError && error.status === 403;
  const records = data?.items ?? [];

  return (
    <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Notifications</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Admin: Processing — inspect and retry notification event processing.
        </p>
      </div>

      <NotificationTabs />

      {isLoading && (
        <p className="py-10 text-center text-sm text-muted-foreground">
          Loading processing records…
        </p>
      )}

      {isError && isForbidden && (
        <div className="flex flex-col items-center gap-2 py-10 text-center">
          <p className="text-sm text-destructive">
            You don&apos;t have permission to view notification processing records.
          </p>
          <p className="text-xs text-muted-foreground">
            Requires the &quot;View notification processing&quot; permission.
          </p>
        </div>
      )}
      {isError && !isForbidden && (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <p className="text-sm text-destructive">
            {error instanceof ApiError ? error.message : 'Failed to load processing records.'}
          </p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      )}

      {!isLoading && !isError && (
        <>
          <div className="mb-4 flex items-center gap-2 overflow-x-auto pb-1">
            {(['', 'FAILED', 'PROCESSING', 'PENDING', 'PROCESSED'] as const).map((status) => (
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
              No processing records match this filter.
            </p>
          )}

          <div className="space-y-3">
            {records.map((record) => (
              <div key={record.id} className="rounded-lg border border-border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs">{record.eventType}</span>
                      <Badge variant={STATUS_VARIANT[record.status]}>{record.status}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {record.subjectType} {record.subjectId} · attempts: {record.attempts} ·
                      occurred {new Date(record.occurredAt).toLocaleString()}
                    </p>
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
