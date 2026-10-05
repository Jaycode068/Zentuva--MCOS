'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button, Input, Select } from '@zentuva/ui';

import { D2cTabs } from '@/components/app/d2c-tabs';
import { ApiError } from '@/lib/api-client';

import { listTerritories } from '../../retail/api';
import {
  CollectionPointFulfillmentStatusValue,
  listCollectionPointFulfillments,
  listEnabledCollectionPointOutlets,
} from '../api';

const PAGE_SIZE = 20;

const STATUS_OPTIONS: CollectionPointFulfillmentStatusValue[] = [
  'ASSIGNED',
  'PREPARING',
  'READY_FOR_COLLECTION',
  'COLLECTED',
];

/**
 * Sprint 39 — D2C Sales Administration & Operations Dashboard
 * (docs/domains/d2c.md). The org-wide Collection Point operational summary
 * (brief §"Collection Point operational summary") — a live, filterable queue
 * over the EXISTING `CollectionPointFulfillment` aggregate
 * (`CollectionPointFulfillmentService.listAll`, admin-only), never a second
 * Collection Point entity. Each row links to the underlying order detail.
 */
export default function D2CCollectionPointsPage() {
  const [status, setStatus] = useState<CollectionPointFulfillmentStatusValue | ''>('');
  const [outletId, setOutletId] = useState('');
  const [territoryId, setTerritoryId] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const { data: outletsData } = useQuery({
    queryKey: ['d2c-collection-point-outlets'],
    queryFn: listEnabledCollectionPointOutlets,
  });
  const { data: territoriesData } = useQuery({
    queryKey: ['territories'],
    queryFn: () => listTerritories({ status: 'ACTIVE' }),
  });

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['d2c-collection-point-fulfillments', status, outletId, territoryId, search, page],
    queryFn: () =>
      listCollectionPointFulfillments({
        status: status || undefined,
        outletId: outletId || undefined,
        territoryId: territoryId || undefined,
        search: search || undefined,
        page,
        pageSize: PAGE_SIZE,
      }),
  });

  const rows = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function resetPage<T>(setter: (value: T) => void) {
    return (value: T) => {
      setPage(1);
      setter(value);
    };
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Collection Points</h1>
        <p className="text-sm text-muted-foreground">
          Org-wide Collection Point fulfilment queue — every order currently assigned, preparing,
          ready, or collected.
        </p>
      </div>

      <D2cTabs />

      <div className="flex flex-wrap gap-3">
        <Input
          placeholder="Search order code or consumer…"
          value={search}
          onChange={(e) => resetPage(setSearch)(e.target.value)}
          className="max-w-xs"
        />
        <Select
          value={status}
          onChange={(e) =>
            resetPage(setStatus)(e.target.value as CollectionPointFulfillmentStatusValue | '')
          }
          className="max-w-[10rem]"
        >
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, ' ')}
            </option>
          ))}
        </Select>
        <Select
          value={outletId}
          onChange={(e) => resetPage(setOutletId)(e.target.value)}
          className="max-w-[12rem]"
        >
          <option value="">All Collection Points</option>
          {(outletsData?.items ?? []).map((outlet) => (
            <option key={outlet.id} value={outlet.id}>
              {outlet.name}
            </option>
          ))}
        </Select>
        <Select
          value={territoryId}
          onChange={(e) => resetPage(setTerritoryId)(e.target.value)}
          className="max-w-[10rem]"
        >
          <option value="">All territories</option>
          {(territoriesData?.items ?? []).map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
      </div>

      {isLoading && <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>}
      {isError && (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <p className="text-sm text-destructive">
            {error instanceof ApiError ? error.message : 'Failed to load the queue.'}
          </p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      )}

      {!isLoading && !isError && rows.length === 0 && (
        <p className="py-10 text-center text-sm text-muted-foreground">
          No fulfilments match these filters.
        </p>
      )}

      {!isLoading && !isError && rows.length > 0 && (
        <>
          <div className="space-y-2">
            {rows.map((row) => (
              <a
                key={row.id}
                href={`/settings/d2c/orders/${row.salesOrderId}`}
                className="block rounded-lg border border-border p-3 hover:bg-muted/30"
              >
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="font-mono text-sm">{row.orderReference}</p>
                    <p className="text-sm text-muted-foreground">
                      {row.outletName}
                      {row.consumer ? ` · ${row.consumer.name}` : ''}
                    </p>
                  </div>
                  <div className="text-right">
                    <Badge variant={row.status === 'COLLECTED' ? 'success' : 'default'}>
                      {row.status.replace(/_/g, ' ')}
                    </Badge>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {new Date(row.assignedAt).toLocaleDateString()}
                    </p>
                  </div>
                </div>
              </a>
            ))}
          </div>

          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <p>
              Page {page} of {totalPages} · {total} row{total === 1 ? '' : 's'}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
