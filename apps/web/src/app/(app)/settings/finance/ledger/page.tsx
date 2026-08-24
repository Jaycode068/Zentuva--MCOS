'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Badge, Input, Select } from '@zentuva/ui';

import { FinanceTabs } from '@/components/app/finance-tabs';
import { ApiError } from '@/lib/api-client';
import { formatCurrency } from '@/lib/format-currency';

import { getLedger, listChartOfAccounts } from '../api';
import {
  JOURNAL_ENTRY_STATUS_LABELS,
  JOURNAL_ENTRY_STATUS_VARIANT,
  JOURNAL_SOURCE_TYPE_LABELS,
} from '../labels';

/** General Ledger (Sprint 7, docs/domains/accounting.md §15) — every posted debit/
 *  credit line, filterable by account/date/source, with a deterministic running
 *  balance computed server-side. Most meaningful when filtered to a single account —
 *  see `LedgerService.getLedger`'s own doc comment. */
export default function GeneralLedgerPage() {
  const [accountId, setAccountId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [sourceType, setSourceType] = useState('');

  const { data: accountsData } = useQuery({
    queryKey: ['chart-of-accounts'],
    queryFn: () => listChartOfAccounts(),
  });
  const accounts = useMemo(() => accountsData?.items ?? [], [accountsData]);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['ledger', accountId, from, to, sourceType],
    queryFn: () =>
      getLedger({
        accountId: accountId || undefined,
        from: from || undefined,
        to: to || undefined,
        sourceType: sourceType || undefined,
      }),
  });
  const lines = data?.items ?? [];

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Finance</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every posted transaction, in order — the running balance is most meaningful once you
          filter to one account.
        </p>
      </div>

      <FinanceTabs />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Select value={accountId} onChange={(event) => setAccountId(event.target.value)}>
          <option value="">All accounts</option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.code} — {account.name}
            </option>
          ))}
        </Select>
        <Select value={sourceType} onChange={(event) => setSourceType(event.target.value)}>
          <option value="">All sources</option>
          {Object.entries(JOURNAL_SOURCE_TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
        <Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
        <Input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
      </div>

      {isLoading && (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading ledger…</p>
      )}
      {isError && (
        <p className="py-10 text-center text-sm text-destructive">
          {error instanceof ApiError ? error.message : 'Failed to load the ledger.'}
        </p>
      )}
      {!isLoading && !isError && lines.length === 0 && (
        <p className="py-10 text-center text-sm text-muted-foreground">
          No ledger activity matches these filters.
        </p>
      )}

      {!isLoading && !isError && lines.length > 0 && (
        <>
          <div className="hidden overflow-x-auto rounded-lg border border-border md:block">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/50 text-left">
                <tr>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Journal #</th>
                  <th className="px-4 py-3 font-medium">Account</th>
                  <th className="px-4 py-3 font-medium">Description</th>
                  <th className="px-4 py-3 text-right font-medium">Debit</th>
                  <th className="px-4 py-3 text-right font-medium">Credit</th>
                  <th className="px-4 py-3 text-right font-medium">Balance</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => (
                  <tr key={line.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3">{new Date(line.date).toLocaleDateString()}</td>
                    <td className="px-4 py-3 font-mono text-xs">{line.journalNumber}</td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs">{line.account.code}</span>{' '}
                      {line.account.name}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {line.description ?? '—'}
                      {line.status !== 'POSTED' && (
                        <Badge variant={JOURNAL_ENTRY_STATUS_VARIANT[line.status]} className="ml-2">
                          {JOURNAL_ENTRY_STATUS_LABELS[line.status]}
                        </Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {line.debit > 0 ? formatCurrency(line.debit, 'NGN') : ''}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {line.credit > 0 ? formatCurrency(line.credit, 'NGN') : ''}
                    </td>
                    <td className="px-4 py-3 text-right font-medium">
                      {formatCurrency(line.runningBalance, 'NGN')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-2 md:hidden">
            {lines.map((line) => (
              <div key={line.id} className="rounded-lg border border-border p-3">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{new Date(line.date).toLocaleDateString()}</span>
                  <span className="font-mono">{line.journalNumber}</span>
                </div>
                <p className="mt-1 text-sm font-medium">
                  {line.account.code} — {line.account.name}
                </p>
                <p className="text-xs text-muted-foreground">{line.description ?? '—'}</p>
                <div className="mt-1 flex items-center justify-between text-sm">
                  <span>
                    {line.debit > 0 && `Dr ${formatCurrency(line.debit, 'NGN')}`}
                    {line.credit > 0 && `Cr ${formatCurrency(line.credit, 'NGN')}`}
                  </span>
                  <span className="font-medium">{formatCurrency(line.runningBalance, 'NGN')}</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </main>
  );
}
