'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Badge, Card, CardContent, CardHeader, CardTitle } from '@zentuva/ui';

import { FinanceTabs } from '@/components/app/finance-tabs';
import { ApiError } from '@/lib/api-client';
import { formatCurrency } from '@/lib/format-currency';

import { getCashOverview } from '../api';

/**
 * Cash Position Dashboard (Sprint 14, docs/domains/cash-management.md §14) — Total
 * Cash, Bank Balances, Cash on Hand, Unreconciled, Recent Transactions, and
 * Accounts Requiring Reconciliation. Every figure composed — never
 * recomputed — from `CashDashboardService.getOverview`. Deliberately its own
 * landing page rather than folded into the busy Sprint 13 Finance Overview.
 */
export default function CashOverviewPage() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['cash-overview'],
    queryFn: () => getCashOverview(),
  });

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Finance</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          How much cash do we have, and where is it? Book balances, reconciled balances, and what
          still needs attention.
        </p>
      </div>

      <FinanceTabs />

      {isLoading && (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading cash position…</p>
      )}
      {isError && (
        <p className="py-10 text-center text-sm text-destructive">
          {error instanceof ApiError ? error.message : 'Failed to load the cash overview.'}
        </p>
      )}

      {data && (
        <>
          <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryCard title="Total Cash" value={formatCurrency(data.totalCash, 'NGN')} />
            <SummaryCard title="Bank Balances" value={formatCurrency(data.bankBalance, 'NGN')} />
            <SummaryCard title="Cash on Hand" value={formatCurrency(data.cashOnHand, 'NGN')} />
            <SummaryCard
              title="Unreconciled"
              value={formatCurrency(data.totalUnreconciled, 'NGN')}
              destructive={data.totalUnreconciled > 0.01}
            />
          </div>

          <section className="mb-8">
            <h2 className="mb-3 text-lg font-semibold tracking-tight">Cash Accounts</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {data.accounts.map((account) => (
                <Link key={account.id} href={`/settings/finance/cash-accounts/${account.id}`}>
                  <Card className="h-full transition-colors hover:border-primary/50">
                    <CardHeader>
                      <CardTitle className="text-base">{account.name}</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-1 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Book</span>
                        <span className="font-medium">
                          {formatCurrency(account.bookBalance, 'NGN')}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Reconciled</span>
                        <span className="font-medium">
                          {formatCurrency(account.reconciledBalance, 'NGN')}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Unreconciled</span>
                        <span
                          className={`font-medium ${
                            Math.abs(account.unreconciledDifference) > 0.01
                              ? 'text-destructive'
                              : ''
                          }`}
                        >
                          {formatCurrency(account.unreconciledDifference, 'NGN')}
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </section>

          {data.accountsRequiringReconciliation.length > 0 && (
            <section className="mb-8">
              <h2 className="mb-3 text-lg font-semibold tracking-tight">
                Accounts Requiring Reconciliation
              </h2>
              <div className="flex flex-wrap gap-3">
                {data.accountsRequiringReconciliation.map((account) => (
                  <Badge key={account.id} variant="warning">
                    {account.name}: {formatCurrency(account.unreconciledDifference, 'NGN')}
                  </Badge>
                ))}
              </div>
            </section>
          )}

          <section>
            <h2 className="mb-3 text-lg font-semibold tracking-tight">Recent Transactions</h2>
            {data.recentTransactions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No recent activity.</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead className="border-b border-border bg-muted/50 text-left">
                    <tr>
                      <th className="px-4 py-3 font-medium">Date</th>
                      <th className="px-4 py-3 font-medium">Account</th>
                      <th className="px-4 py-3 font-medium">Description</th>
                      <th className="px-4 py-3 text-right font-medium">Debit</th>
                      <th className="px-4 py-3 text-right font-medium">Credit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recentTransactions.map((txn) => (
                      <tr key={txn.id} className="border-b border-border last:border-0">
                        <td className="px-4 py-3">{new Date(txn.date).toLocaleDateString()}</td>
                        <td className="px-4 py-3">{txn.cashAccountName}</td>
                        <td className="px-4 py-3 text-muted-foreground">{txn.description}</td>
                        <td className="px-4 py-3 text-right">
                          {txn.debit > 0 ? formatCurrency(txn.debit, 'NGN') : ''}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {txn.credit > 0 ? formatCurrency(txn.credit, 'NGN') : ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}

function SummaryCard({
  title,
  value,
  destructive,
}: {
  title: string;
  value: string;
  destructive?: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className={`text-2xl font-semibold ${destructive ? 'text-destructive' : ''}`}>{value}</p>
      </CardContent>
    </Card>
  );
}
