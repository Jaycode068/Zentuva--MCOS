'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button } from '@zentuva/ui';

import { FinanceTabs } from '@/components/app/finance-tabs';
import { ApiError } from '@/lib/api-client';

import { closeAccountingPeriod, listAccountingPeriods } from '../api';
import { ACCOUNTING_PERIOD_STATUS_LABELS, ACCOUNTING_PERIOD_STATUS_VARIANT } from '../labels';
import { AccountingPeriodDialog } from './accounting-period-dialog';

/** Accounting Periods (Sprint 7, docs/domains/accounting.md) — only `OPEN` periods can
 *  receive new postings; closing is one-way this sprint (no re-opening, no year-end
 *  closing automation). */
export default function AccountingPeriodsPage() {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [closingId, setClosingId] = useState<string | null>(null);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['accounting-periods'],
    queryFn: () => listAccountingPeriods(),
  });
  const periods = useMemo(() => data?.items ?? [], [data]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['accounting-periods'] });

  const closeMutation = useMutation({
    mutationFn: (id: string) => closeAccountingPeriod(id),
    onMutate: (id) => setClosingId(id),
    onSuccess: invalidate,
    onSettled: () => setClosingId(null),
  });

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Finance</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Only an open period may receive new journal postings.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>Create Period</Button>
      </div>

      <FinanceTabs />

      {isLoading && (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading periods…</p>
      )}
      {isError && (
        <p className="py-10 text-center text-sm text-destructive">
          {error instanceof ApiError ? error.message : 'Failed to load accounting periods.'}
        </p>
      )}
      {closeMutation.isError && (
        <p className="mb-4 text-sm text-destructive">
          {closeMutation.error instanceof ApiError
            ? closeMutation.error.message
            : 'Failed to close the period.'}
        </p>
      )}

      {!isLoading && !isError && periods.length === 0 && (
        <p className="py-10 text-center text-sm text-muted-foreground">
          No accounting periods yet.
        </p>
      )}

      {!isLoading && !isError && periods.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/50 text-left">
              <tr>
                <th className="px-4 py-3 font-medium">Period</th>
                <th className="px-4 py-3 font-medium">Start</th>
                <th className="px-4 py-3 font-medium">End</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {periods.map((period) => (
                <tr key={period.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 font-medium">{period.name}</td>
                  <td className="px-4 py-3">{new Date(period.startDate).toLocaleDateString()}</td>
                  <td className="px-4 py-3">{new Date(period.endDate).toLocaleDateString()}</td>
                  <td className="px-4 py-3">
                    <Badge variant={ACCOUNTING_PERIOD_STATUS_VARIANT[period.status]}>
                      {ACCOUNTING_PERIOD_STATUS_LABELS[period.status]}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {period.status === 'OPEN' && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={closeMutation.isPending && closingId === period.id}
                        onClick={() => closeMutation.mutate(period.id)}
                      >
                        {closeMutation.isPending && closingId === period.id ? 'Closing…' : 'Close'}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {createOpen && (
        <AccountingPeriodDialog
          onOpenChange={() => setCreateOpen(false)}
          onCreated={() => {
            invalidate();
            setCreateOpen(false);
          }}
        />
      )}
    </main>
  );
}
