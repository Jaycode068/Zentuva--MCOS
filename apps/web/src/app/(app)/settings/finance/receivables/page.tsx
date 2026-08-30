'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { FinanceTabs } from '@/components/app/finance-tabs';
import { ApiError } from '@/lib/api-client';
import { formatCurrency } from '@/lib/format-currency';

import { getArAging, listArByCustomer, type CustomerArRow } from '../api';

type SortKey = 'customerName' | 'totalInvoiced' | 'totalPaid' | 'totalOutstanding';

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'customerName', label: 'Customer' },
  { key: 'totalInvoiced', label: 'Total Invoiced' },
  { key: 'totalPaid', label: 'Total Paid' },
  { key: 'totalOutstanding', label: 'Outstanding' },
];

/** Accounts Receivable by customer (Sprint 6, docs/domains/finance.md) — every row is
 *  derived server-side (`groupBy`/`aggregate` over Invoice), never a stored balance. */
export default function ReceivablesPage() {
  const [sortKey, setSortKey] = useState<SortKey>('totalOutstanding');
  const [sortDesc, setSortDesc] = useState(true);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['ar-by-customer'],
    queryFn: () => listArByCustomer(),
  });
  const rows = useMemo(() => data?.items ?? [], [data]);

  const { data: aging } = useQuery({
    queryKey: ['ar-aging'],
    queryFn: () => getArAging(),
  });

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      const aValue = sortKey === 'customerName' ? a.customerName : a[sortKey];
      const bValue = sortKey === 'customerName' ? b.customerName : b[sortKey];
      const cmp =
        typeof aValue === 'string'
          ? aValue.localeCompare(bValue as string)
          : (aValue as number) - (bValue as number);
      return sortDesc ? -cmp : cmp;
    });
    return copy;
  }, [rows, sortKey, sortDesc]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDesc((prev) => !prev);
    } else {
      setSortKey(key);
      setSortDesc(true);
    }
  };

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Finance</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          What every customer has been invoiced, paid, credited, and still owes.
        </p>
      </div>

      <FinanceTabs />

      {isLoading && (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading receivables…</p>
      )}
      {isError && (
        <p className="py-10 text-center text-sm text-destructive">
          {error instanceof ApiError ? error.message : 'Failed to load receivables.'}
        </p>
      )}

      {!isLoading && !isError && sorted.length === 0 && (
        <p className="py-10 text-center text-sm text-muted-foreground">No outstanding balances.</p>
      )}

      {!isLoading && !isError && sorted.length > 0 && (
        <>
          <div className="hidden overflow-x-auto rounded-lg border border-border md:block">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/50 text-left">
                <tr>
                  {COLUMNS.map((column) => (
                    <th key={column.key} className="px-4 py-3 font-medium">
                      <button
                        type="button"
                        onClick={() => toggleSort(column.key)}
                        className="flex items-center gap-1 hover:text-foreground"
                      >
                        {column.label}
                        {sortKey === column.key && <span>{sortDesc ? '↓' : '↑'}</span>}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((row) => (
                  <ArRow key={row.customerId} row={row} />
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-2 md:hidden">
            {sorted.map((row) => (
              <div key={row.customerId} className="rounded-lg border border-border p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-foreground">{row.customerName}</span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {row.customerCode}
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <p className="text-muted-foreground">Invoiced</p>
                    <p>{formatCurrency(row.totalInvoiced, 'NGN')}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Paid</p>
                    <p>{formatCurrency(row.totalPaid, 'NGN')}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Outstanding</p>
                    <p className="font-medium text-foreground">
                      {formatCurrency(row.totalOutstanding, 'NGN')}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {aging && aging.totalOutstanding > 0 && (
        <div className="mt-8">
          <h2 className="mb-3 text-lg font-semibold tracking-tight">Aging</h2>
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
            <AgingBucketCard label="Current" value={aging.current} />
            <AgingBucketCard label="1-30 Days" value={aging.days1To30} />
            <AgingBucketCard label="31-60 Days" value={aging.days31To60} />
            <AgingBucketCard label="61-90 Days" value={aging.days61To90} />
            <AgingBucketCard label="90+ Days" value={aging.days90Plus} destructive />
          </div>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/50 text-left">
                <tr>
                  <th className="px-4 py-3 font-medium">Customer</th>
                  <th className="px-4 py-3 font-medium">Current</th>
                  <th className="px-4 py-3 font-medium">1-30</th>
                  <th className="px-4 py-3 font-medium">31-60</th>
                  <th className="px-4 py-3 font-medium">61-90</th>
                  <th className="px-4 py-3 font-medium">90+</th>
                  <th className="px-4 py-3 font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {aging.byCustomer.map((row) => (
                  <tr key={row.customerId} className="border-b border-border last:border-0">
                    <td className="px-4 py-3">{row.customerName}</td>
                    <td className="px-4 py-3">{formatCurrency(row.current, 'NGN')}</td>
                    <td className="px-4 py-3">{formatCurrency(row.days1To30, 'NGN')}</td>
                    <td className="px-4 py-3">{formatCurrency(row.days31To60, 'NGN')}</td>
                    <td className="px-4 py-3">{formatCurrency(row.days61To90, 'NGN')}</td>
                    <td className="px-4 py-3">{formatCurrency(row.days90Plus, 'NGN')}</td>
                    <td className="px-4 py-3 font-medium">
                      {formatCurrency(row.totalOutstanding, 'NGN')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </main>
  );
}

function AgingBucketCard({
  label,
  value,
  destructive,
}: {
  label: string;
  value: number;
  destructive?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={`mt-1 text-sm font-semibold ${destructive && value > 0 ? 'text-destructive' : ''}`}
      >
        {formatCurrency(value, 'NGN')}
      </p>
    </div>
  );
}

function ArRow({ row }: { row: CustomerArRow }) {
  return (
    <tr className="border-b border-border last:border-0">
      <td className="px-4 py-3">
        <span className="font-medium text-foreground">{row.customerName}</span>
        <span className="ml-2 font-mono text-xs text-muted-foreground">{row.customerCode}</span>
      </td>
      <td className="px-4 py-3">{formatCurrency(row.totalInvoiced, 'NGN')}</td>
      <td className="px-4 py-3">{formatCurrency(row.totalPaid, 'NGN')}</td>
      <td className="px-4 py-3 font-medium">{formatCurrency(row.totalOutstanding, 'NGN')}</td>
    </tr>
  );
}
