'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@zentuva/ui';

import { FinanceTabs } from '@/components/app/finance-tabs';
import { ApiError } from '@/lib/api-client';
import { formatCurrency } from '@/lib/format-currency';

import {
  deactivateCashAccount,
  activateCashAccount,
  getAccountActivity,
  getCashAccount,
  getCashAccountNumber,
  listBankReconciliations,
  listBankStatementImports,
  listCashTransactions,
} from '../../api';
import {
  BANK_RECONCILIATION_STATUS_LABELS,
  BANK_RECONCILIATION_STATUS_VARIANT,
  CASH_ACCOUNT_STATUS_LABELS,
  CASH_ACCOUNT_STATUS_VARIANT,
  CASH_ACCOUNT_TYPE_LABELS,
} from '../../labels';

/**
 * Cash Account detail (Sprint 14, docs/domains/cash-management.md §15) — account
 * info, the Book/Reconciled/Unreconciled distinction (§13 — never labelled
 * "available cash"), recent activity, reconciliation history, and statement
 * imports. Book Balance reuses `LedgerService.getAccountActivity` against the
 * account's own linked Chart of Accounts row (Sprint 7/13's existing primitive) —
 * no new balance computation on the frontend either.
 */
export default function CashAccountDetailPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const queryClient = useQueryClient();
  const [revealed, setRevealed] = useState<string | null>(null);

  const {
    data: account,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['cash-account', id],
    queryFn: () => getCashAccount(id),
  });

  const { data: activity } = useQuery({
    queryKey: ['account-activity', account?.linkedChartOfAccountId],
    queryFn: () => getAccountActivity(account!.linkedChartOfAccountId),
    enabled: Boolean(account),
  });

  const { data: reconciliationsData } = useQuery({
    queryKey: ['bank-reconciliations', id],
    queryFn: () => listBankReconciliations(id),
    enabled: Boolean(account),
  });
  const reconciliations = useMemo(() => reconciliationsData?.items ?? [], [reconciliationsData]);
  const latestCompleted = reconciliations.find((r) => r.status === 'COMPLETED');

  const { data: transactionsData } = useQuery({
    queryKey: ['cash-transactions', id],
    queryFn: () => listCashTransactions({ cashAccountId: id }),
    enabled: Boolean(account),
  });
  const transactions = useMemo(() => transactionsData?.items ?? [], [transactionsData]);

  const { data: importsData } = useQuery({
    queryKey: ['bank-statement-imports', id],
    queryFn: () => listBankStatementImports(id),
    enabled: Boolean(account),
  });
  const imports = useMemo(() => importsData?.items ?? [], [importsData]);

  const reveal = async () => {
    const result = await getCashAccountNumber(id);
    setRevealed(result.accountNumber ?? '');
  };

  const toggleActive = async () => {
    if (account?.status === 'ACTIVE') {
      await deactivateCashAccount(id);
    } else {
      await activateCashAccount(id);
    }
    queryClient.invalidateQueries({ queryKey: ['cash-account', id] });
    queryClient.invalidateQueries({ queryKey: ['cash-accounts'] });
  };

  if (isLoading) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-10">
        <FinanceTabs />
        <p className="py-10 text-center text-sm text-muted-foreground">Loading cash account…</p>
      </main>
    );
  }
  if (isError || !account) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-10">
        <FinanceTabs />
        <p className="py-10 text-center text-sm text-destructive">
          {error instanceof ApiError ? error.message : 'Cash account not found.'}
        </p>
      </main>
    );
  }

  const bookBalance = activity?.closingBalance ?? 0;
  const reconciledBalance = latestCompleted?.closingBankBalance ?? account.openingBalance;
  const unreconciledDifference = bookBalance - reconciledBalance;

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <Link
            href="/settings/finance/cash-accounts"
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            ← Cash Accounts
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{account.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {account.accountCode} · {CASH_ACCOUNT_TYPE_LABELS[account.accountType]}
            {account.bankName ? ` · ${account.bankName}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={CASH_ACCOUNT_STATUS_VARIANT[account.status]}>
            {CASH_ACCOUNT_STATUS_LABELS[account.status]}
          </Badge>
          <Button variant="outline" size="sm" onClick={toggleActive}>
            {account.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
          </Button>
        </div>
      </div>

      <FinanceTabs />

      <div className="mb-6 rounded-lg border border-border p-4">
        <p className="text-xs text-muted-foreground">Account Number</p>
        <p className="mt-1 font-mono text-sm">
          {revealed !== null
            ? revealed || 'Not on file'
            : (account.accountNumberMasked ?? 'Not on file')}
        </p>
        {account.accountNumberMasked && revealed === null && (
          <button
            type="button"
            onClick={reveal}
            className="mt-1 text-xs text-primary hover:underline"
          >
            Reveal full number
          </button>
        )}
      </div>

      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <BalanceCard title="Book Balance" value={bookBalance} currency={account.currency} />
        <BalanceCard
          title="Reconciled Balance"
          value={reconciledBalance}
          currency={account.currency}
          subtitle={
            latestCompleted
              ? `As of ${new Date(latestCompleted.periodEnd).toLocaleDateString()}`
              : 'From opening balance — not yet reconciled'
          }
        />
        <BalanceCard
          title="Unreconciled Difference"
          value={unreconciledDifference}
          currency={account.currency}
          destructive={Math.abs(unreconciledDifference) > 0.01}
        />
      </div>

      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold tracking-tight">Recent Transactions</h2>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/50 text-left">
              <tr>
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Journal</th>
                <th className="px-4 py-3 font-medium">Description</th>
                <th className="px-4 py-3 text-right font-medium">Debit</th>
                <th className="px-4 py-3 text-right font-medium">Credit</th>
                <th className="px-4 py-3 text-right font-medium">Balance</th>
              </tr>
            </thead>
            <tbody>
              {(activity?.transactions ?? []).length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">
                    No activity yet.
                  </td>
                </tr>
              )}
              {(activity?.transactions ?? [])
                .slice()
                .reverse()
                .slice(0, 15)
                .map((line) => (
                  <tr key={line.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3">{new Date(line.date).toLocaleDateString()}</td>
                    <td className="px-4 py-3 font-mono text-xs">{line.journalNumber}</td>
                    <td className="px-4 py-3 text-muted-foreground">{line.description ?? '—'}</td>
                    <td className="px-4 py-3 text-right">
                      {line.debit > 0 ? formatCurrency(line.debit, account.currency) : ''}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {line.credit > 0 ? formatCurrency(line.credit, account.currency) : ''}
                    </td>
                    <td className="px-4 py-3 text-right font-medium">
                      {formatCurrency(line.runningBalance, account.currency)}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        {transactions.length > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            {transactions.length} cash transaction{transactions.length === 1 ? '' : 's'} recorded
            outside the Payment/Supplier Payment flows for this account.
          </p>
        )}
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold tracking-tight">Reconciliation History</h2>
        {reconciliations.length === 0 ? (
          <p className="text-sm text-muted-foreground">No reconciliation sessions yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/50 text-left">
                <tr>
                  <th className="px-4 py-3 font-medium">Period</th>
                  <th className="px-4 py-3 text-right font-medium">Closing Bank Balance</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {reconciliations.map((recon) => (
                  <tr key={recon.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3">
                      {new Date(recon.periodStart).toLocaleDateString()} –{' '}
                      {new Date(recon.periodEnd).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {formatCurrency(recon.closingBankBalance, account.currency)}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={BANK_RECONCILIATION_STATUS_VARIANT[recon.status]}>
                        {BANK_RECONCILIATION_STATUS_LABELS[recon.status]}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/settings/finance/reconciliation/${recon.id}`}
                        className="text-xs text-primary hover:underline"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold tracking-tight">Statement Imports</h2>
        {imports.length === 0 ? (
          <p className="text-sm text-muted-foreground">No bank statements imported yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/50 text-left">
                <tr>
                  <th className="px-4 py-3 font-medium">Filename</th>
                  <th className="px-4 py-3 font-medium">Imported</th>
                  <th className="px-4 py-3 text-right font-medium">Rows</th>
                  <th className="px-4 py-3 text-right font-medium">Duplicates</th>
                </tr>
              </thead>
              <tbody>
                {imports.map((imp) => (
                  <tr key={imp.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3">{imp.filename}</td>
                    <td className="px-4 py-3">{new Date(imp.importedAt).toLocaleString()}</td>
                    <td className="px-4 py-3 text-right">
                      {imp.importedRows} / {imp.totalRows}
                    </td>
                    <td className="px-4 py-3 text-right">{imp.duplicateRows}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

function BalanceCard({
  title,
  value,
  currency,
  subtitle,
  destructive,
}: {
  title: string;
  value: number;
  currency: string;
  subtitle?: string;
  destructive?: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className={`text-2xl font-semibold ${destructive ? 'text-destructive' : ''}`}>
          {formatCurrency(value, currency)}
        </p>
        {subtitle && <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>}
      </CardContent>
    </Card>
  );
}
