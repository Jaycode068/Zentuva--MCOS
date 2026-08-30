'use client';

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button } from '@zentuva/ui';

import { FinanceTabs } from '@/components/app/finance-tabs';
import { ApiError } from '@/lib/api-client';
import { formatCurrency } from '@/lib/format-currency';

import { listCashTransactions, type CashTransaction } from '../api';
import { CASH_TRANSACTION_TYPE_LABELS } from '../labels';
import { CashTransactionDialog } from './cash-transaction-dialog';

/**
 * Cash Transaction ledger (Sprint 14, docs/domains/cash-management.md §6) — every
 * cash movement recorded outside the existing Payment/Supplier Payment flows.
 * Always-visible, horizontally-scrollable table (the Trial Balance/Aging pattern) —
 * a dense list without an obvious mobile-card shape.
 */
export default function CashTransactionsPage() {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['cash-transactions'],
    queryFn: () => listCashTransactions(),
  });
  const transactions = useMemo(() => data?.items ?? [], [data]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['cash-transactions'] });
  };

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Finance</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Cash movements recorded outside the existing Payment/Supplier Payment flows — bank
            charges, petty cash, and other legitimate receipts or payments.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>Record Cash Transaction</Button>
      </div>

      <FinanceTabs />

      {isLoading && (
        <p className="py-10 text-center text-sm text-muted-foreground">
          Loading cash transactions…
        </p>
      )}
      {isError && (
        <p className="py-10 text-center text-sm text-destructive">
          {error instanceof ApiError ? error.message : 'Failed to load cash transactions.'}
        </p>
      )}
      {!isLoading && !isError && transactions.length === 0 && (
        <p className="py-10 text-center text-sm text-muted-foreground">
          No cash transactions recorded yet.
        </p>
      )}

      {!isLoading && !isError && transactions.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/50 text-left">
              <tr>
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Cash Account</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Description</th>
                <th className="px-4 py-3 font-medium">Contra Account</th>
                <th className="px-4 py-3 text-right font-medium">Amount</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((transaction) => (
                <CashTransactionRow key={transaction.id} transaction={transaction} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {createOpen && (
        <CashTransactionDialog onOpenChange={() => setCreateOpen(false)} onCreated={invalidate} />
      )}
    </main>
  );
}

function CashTransactionRow({ transaction }: { transaction: CashTransaction }) {
  return (
    <tr className="border-b border-border last:border-0">
      <td className="px-4 py-3">{new Date(transaction.transactionDate).toLocaleDateString()}</td>
      <td className="px-4 py-3">{transaction.cashAccount.name}</td>
      <td className="px-4 py-3">
        <Badge variant={transaction.transactionType === 'RECEIPT' ? 'success' : 'default'}>
          {CASH_TRANSACTION_TYPE_LABELS[transaction.transactionType]}
        </Badge>
      </td>
      <td className="px-4 py-3 text-muted-foreground">{transaction.description}</td>
      <td className="px-4 py-3">
        {transaction.contraAccount.code} — {transaction.contraAccount.name}
      </td>
      <td className="px-4 py-3 text-right font-medium">
        {formatCurrency(transaction.amount, 'NGN')}
      </td>
      <td className="px-4 py-3">
        <Badge variant={transaction.status === 'VOIDED' ? 'destructive' : 'default'}>
          {transaction.status}
        </Badge>
      </td>
    </tr>
  );
}
