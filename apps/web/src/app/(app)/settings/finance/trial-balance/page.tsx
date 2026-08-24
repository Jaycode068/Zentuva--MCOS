'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Select } from '@zentuva/ui';

import { FinanceTabs } from '@/components/app/finance-tabs';
import { ApiError } from '@/lib/api-client';
import { formatCurrency } from '@/lib/format-currency';

import { getTrialBalance, listAccountingPeriods } from '../api';

/** Trial Balance (Sprint 7, docs/domains/accounting.md §16) — always satisfies
 *  `Σdebit === Σcredit` by construction (`LedgerService.getTrialBalance`'s own doc
 *  comment explains why). Period selector, defaulting to no filter (all-time). */
export default function TrialBalancePage() {
  const [accountingPeriodId, setAccountingPeriodId] = useState('');

  const { data: periodsData } = useQuery({
    queryKey: ['accounting-periods'],
    queryFn: () => listAccountingPeriods(),
  });
  const periods = useMemo(() => periodsData?.items ?? [], [periodsData]);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['trial-balance', accountingPeriodId],
    queryFn: () => getTrialBalance({ accountingPeriodId: accountingPeriodId || undefined }),
  });

  const selectedPeriod = periods.find((period) => period.id === accountingPeriodId);
  const isBalanced = data ? data.totalDebit === data.totalCredit : true;

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Finance</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every account&apos;s posted balance, split into Debit/Credit columns — always in balance.
        </p>
      </div>

      <FinanceTabs />

      <div className="mb-4">
        <Select
          value={accountingPeriodId}
          onChange={(event) => setAccountingPeriodId(event.target.value)}
          className="max-w-xs"
        >
          <option value="">All time</option>
          {periods.map((period) => (
            <option key={period.id} value={period.id}>
              {period.name}
            </option>
          ))}
        </Select>
      </div>

      {isLoading && (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading trial balance…</p>
      )}
      {isError && (
        <p className="py-10 text-center text-sm text-destructive">
          {error instanceof ApiError ? error.message : 'Failed to load the trial balance.'}
        </p>
      )}

      {!isLoading && !isError && data && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/50 text-left">
              <tr>
                <th className="px-4 py-3 font-medium" colSpan={2}>
                  Trial Balance {selectedPeriod ? `— ${selectedPeriod.name}` : ''}
                </th>
                <th className="px-4 py-3 text-right font-medium">Debit</th>
                <th className="px-4 py-3 text-right font-medium">Credit</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center text-muted-foreground">
                    No posted activity in this range.
                  </td>
                </tr>
              ) : (
                data.rows.map((row) => (
                  <tr key={row.accountId} className="border-b border-border last:border-0">
                    <td className="px-4 py-3" colSpan={2}>
                      <span className="font-mono text-xs">{row.code}</span> {row.name}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {row.debit > 0 ? formatCurrency(row.debit, 'NGN') : ''}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {row.credit > 0 ? formatCurrency(row.credit, 'NGN') : ''}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            <tfoot>
              <tr className="border-t border-border font-semibold">
                <td className="px-4 py-3" colSpan={2}>
                  Total
                </td>
                <td className="px-4 py-3 text-right">{formatCurrency(data.totalDebit, 'NGN')}</td>
                <td className="px-4 py-3 text-right">{formatCurrency(data.totalCredit, 'NGN')}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {!isLoading && !isError && data && (
        <p className={`mt-3 text-sm ${isBalanced ? 'text-primary' : 'text-destructive'}`}>
          {isBalanced
            ? '✓ Debit and Credit totals match.'
            : 'Debit and Credit totals do not match.'}
        </p>
      )}
    </main>
  );
}
