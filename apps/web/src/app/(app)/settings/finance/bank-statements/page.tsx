'use client';

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Select } from '@zentuva/ui';

import { FinanceTabs } from '@/components/app/finance-tabs';
import { ApiError } from '@/lib/api-client';
import { formatCurrency } from '@/lib/format-currency';

import { listBankStatementTransactions, listCashAccounts } from '../api';
import {
  BANK_TRANSACTION_MATCH_STATUS_LABELS,
  BANK_TRANSACTION_MATCH_STATUS_VARIANT,
} from '../labels';
import { BankStatementImportDialog } from './bank-statement-import-dialog';

/**
 * Bank Statement transactions (Sprint 14, docs/domains/cash-management.md §7/§8) —
 * every row imported from a bank statement, across every cash account, with its
 * reconciliation match status. Always-visible, horizontally-scrollable table.
 */
export default function BankStatementsPage() {
  const queryClient = useQueryClient();
  const [importOpen, setImportOpen] = useState(false);
  const [cashAccountId, setCashAccountId] = useState('');

  const { data: cashAccountsData } = useQuery({
    queryKey: ['cash-accounts'],
    queryFn: () => listCashAccounts(),
  });
  const cashAccounts = cashAccountsData?.items ?? [];

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['bank-statement-transactions', cashAccountId],
    queryFn: () => listBankStatementTransactions({ cashAccountId: cashAccountId || undefined }),
  });
  const transactions = useMemo(() => data?.items ?? [], [data]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['bank-statement-transactions'] });
    queryClient.invalidateQueries({ queryKey: ['bank-statement-imports'] });
  };

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Finance</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Transactions imported from bank statements — matched or still awaiting reconciliation.
          </p>
        </div>
        <Button onClick={() => setImportOpen(true)}>Import Statement</Button>
      </div>

      <FinanceTabs />

      <div className="mb-4">
        <Select
          value={cashAccountId}
          onChange={(event) => setCashAccountId(event.target.value)}
          className="max-w-xs"
        >
          <option value="">All cash accounts</option>
          {cashAccounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </Select>
      </div>

      {isLoading && (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading transactions…</p>
      )}
      {isError && (
        <p className="py-10 text-center text-sm text-destructive">
          {error instanceof ApiError
            ? error.message
            : 'Failed to load bank statement transactions.'}
        </p>
      )}
      {!isLoading && !isError && transactions.length === 0 && (
        <p className="py-10 text-center text-sm text-muted-foreground">
          No bank statement transactions imported yet.
        </p>
      )}

      {!isLoading && !isError && transactions.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/50 text-left">
              <tr>
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Description</th>
                <th className="px-4 py-3 font-medium">Reference</th>
                <th className="px-4 py-3 text-right font-medium">Debit</th>
                <th className="px-4 py-3 text-right font-medium">Credit</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((transaction) => (
                <tr key={transaction.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3">
                    {new Date(transaction.transactionDate).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{transaction.description}</td>
                  <td className="px-4 py-3 font-mono text-xs">{transaction.reference ?? '—'}</td>
                  <td className="px-4 py-3 text-right">
                    {transaction.debit > 0 ? formatCurrency(transaction.debit, 'NGN') : ''}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {transaction.credit > 0 ? formatCurrency(transaction.credit, 'NGN') : ''}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={BANK_TRANSACTION_MATCH_STATUS_VARIANT[transaction.matchStatus]}>
                      {BANK_TRANSACTION_MATCH_STATUS_LABELS[transaction.matchStatus]}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {importOpen && (
        <BankStatementImportDialog
          onOpenChange={() => setImportOpen(false)}
          onImported={invalidate}
        />
      )}
    </main>
  );
}
