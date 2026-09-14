'use client';

import { useQuery } from '@tanstack/react-query';
import { Button } from '@zentuva/ui';

import { AccessTabs } from '@/components/app/access-tabs';
import { ApiError } from '@/lib/api-client';

import { listAccessAuditLog } from '../api';

/**
 * Access Review (Sprint 25, docs/domains/access-control.md §11 "Access Review" tab) —
 * a read-only view over the pre-existing, insert-only, organisation-wide audit log
 * (every domain writes into the same table via `AuditService.record(...)`, not just
 * Access Control). Every mutation on the Roles/User Access/Common Employee Access
 * pages appears here (`access.*` actions) alongside every other domain's events,
 * since a reviewer verifying an access change often needs the surrounding context
 * (e.g. the login or business action right before/after it) — narrower filtering by
 * `action`/`entityType` is supported by the API (`listAccessAuditLog({ action })`)
 * but not yet exposed as a UI control.
 */
export default function AccessReviewPage() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['access-audit-log'],
    queryFn: () => listAccessAuditLog({ take: 100 }),
  });

  return (
    <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Access Control</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Access Review — the organisation&apos;s immutable audit trail, including every
          access-control change (roles created or edited, permissions granted or revoked, roles
          assigned or removed, common employee access policy updates) alongside other recorded
          business events for context.
        </p>
      </div>

      <AccessTabs />

      {isLoading && <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>}
      {isError && (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <p className="text-sm text-destructive">
            {error instanceof ApiError ? error.message : 'Failed to load audit history.'}
          </p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      )}

      {data && (
        <div className="space-y-2">
          {data.items.length === 0 && (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No access-control changes recorded yet.
            </p>
          )}
          {data.items.map((entry) => (
            <div key={entry.id} className="rounded-md border border-border p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-xs">{entry.action}</span>
                <span className="text-xs text-muted-foreground">
                  {new Date(entry.createdAt).toLocaleString()}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {entry.actorEmail ?? 'Unknown actor'} · {entry.entityType}
                {entry.entityId ? ` · ${entry.entityId}` : ''}
              </p>
              {Object.keys(entry.metadata ?? {}).length > 0 && (
                <pre className="mt-2 overflow-x-auto rounded bg-muted p-2 text-xs">
                  {JSON.stringify(entry.metadata, null, 2)}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
