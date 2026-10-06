'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button, Input, Select } from '@zentuva/ui';

import { D2cTabs } from '@/components/app/d2c-tabs';
import { ApiError } from '@/lib/api-client';

import { listPromotions, PromotionStatus } from './api';
import { PromotionDialog } from './promotion-dialog';

const PAGE_SIZE = 20;

const STATUS_OPTIONS: PromotionStatus[] = ['DRAFT', 'ACTIVE', 'PAUSED', 'EXPIRED'];

const STATUS_BADGE_VARIANT: Record<PromotionStatus, 'default' | 'success' | 'warning'> = {
  DRAFT: 'default',
  ACTIVE: 'success',
  PAUSED: 'warning',
  EXPIRED: 'default',
};

/**
 * Sprint 40 — Configurable Promotions, Loyalty, Rewards & Consumer Incentives
 * (docs/domains/d2c.md). Promotions are DATA an authorized business user configures
 * here — a new commercial promotion (different validity, eligibility, benefit value)
 * never requires a code change. Extends the existing `/settings/d2c` admin shell, the
 * exact `settings/hr/employees` filter/table/pagination convention.
 */
export default function PromotionsPage() {
  const [status, setStatus] = useState<PromotionStatus | ''>('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['promotions', status, search, page],
    queryFn: () =>
      listPromotions({
        status: status || undefined,
        search: search || undefined,
        page,
        pageSize: PAGE_SIZE,
      }),
  });

  const promotions = data?.items ?? [];
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Promotions</h1>
          <p className="text-sm text-muted-foreground">
            Configurable, time-based consumer promotions — eligibility, benefit, and validity are
            all data, never a code change.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>New Promotion</Button>
      </div>

      <D2cTabs />

      <div className="flex flex-wrap gap-3">
        <Input
          placeholder="Search promotion name…"
          value={search}
          onChange={(e) => resetPage(setSearch)(e.target.value)}
          className="max-w-xs"
        />
        <Select
          value={status}
          onChange={(e) => resetPage(setStatus)(e.target.value as PromotionStatus | '')}
          className="max-w-[10rem]"
        >
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
      </div>

      {isLoading && <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>}
      {isError && (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <p className="text-sm text-destructive">
            {error instanceof ApiError ? error.message : 'Failed to load promotions.'}
          </p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      )}

      {!isLoading && !isError && promotions.length === 0 && (
        <p className="py-10 text-center text-sm text-muted-foreground">
          No promotions match these filters.
        </p>
      )}

      {!isLoading && !isError && promotions.length > 0 && (
        <>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Validity</th>
                  <th className="px-4 py-3">Eligibility</th>
                  <th className="px-4 py-3">Benefit</th>
                </tr>
              </thead>
              <tbody>
                {promotions.map((promotion) => (
                  <tr
                    key={promotion.id}
                    className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/30"
                    onClick={() =>
                      window.location.assign(`/settings/d2c/promotions/${promotion.id}`)
                    }
                  >
                    <td className="px-4 py-3 font-medium">{promotion.name}</td>
                    <td className="px-4 py-3">
                      <Badge variant={STATUS_BADGE_VARIANT[promotion.status]}>
                        {promotion.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {new Date(promotion.startsAt).toLocaleDateString()} –{' '}
                      {new Date(promotion.endsAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {promotion.conditions.length} condition
                      {promotion.conditions.length === 1 ? '' : 's'}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {promotion.benefits[0]
                        ? promotion.benefits[0].type === 'BONUS_POINTS'
                          ? `${promotion.benefits[0].pointsValue} points`
                          : `Free product × ${promotion.benefits[0].freeProductQuantity}`
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <p>
              Page {page} of {totalPages} · {total} promotion{total === 1 ? '' : 's'}
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

      {createOpen && (
        <PromotionDialog
          promotion={null}
          onOpenChange={setCreateOpen}
          onSaved={(created) => {
            refetch();
            window.location.assign(`/settings/d2c/promotions/${created.id}`);
          }}
        />
      )}
    </div>
  );
}
