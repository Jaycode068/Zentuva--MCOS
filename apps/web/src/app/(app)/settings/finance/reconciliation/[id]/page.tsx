'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@zentuva/ui';

import { FinanceTabs } from '@/components/app/finance-tabs';
import { ApiError } from '@/lib/api-client';
import { formatCurrency } from '@/lib/format-currency';

import {
  autoMatchReconciliation,
  completeReconciliation,
  getBankReconciliation,
  getCashAccount,
  matchReconciliation,
  unmatchReconciliation,
} from '../../api';
import {
  BANK_RECONCILIATION_STATUS_LABELS,
  BANK_RECONCILIATION_STATUS_VARIANT,
} from '../../labels';

/**
 * Reconciliation workspace (Sprint 14, docs/domains/cash-management.md §9-§13) —
 * the core feature of this sprint. Matched / Unmatched Bank / Unmatched Book
 * sections, a live Book vs Bank Difference strip, an "Auto-match Exact" bulk
 * action, click-to-select manual matching, and Complete — disabled until every
 * unmatched item is resolved (never a silent "force books to equal bank").
 */
export default function ReconciliationDetailPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const queryClient = useQueryClient();
  const [selectedBankId, setSelectedBankId] = useState<string | null>(null);
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const {
    data: detail,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['bank-reconciliation', id],
    queryFn: () => getBankReconciliation(id),
  });

  const { data: cashAccount } = useQuery({
    queryKey: ['cash-account', detail?.cashAccountId],
    queryFn: () => getCashAccount(detail!.cashAccountId),
    enabled: Boolean(detail),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['bank-reconciliation', id] });

  const autoMatchMutation = useMutation({
    mutationFn: () => autoMatchReconciliation(id),
    onSuccess: () => {
      setActionError(null);
      invalidate();
    },
    onError: (err) => setActionError(err instanceof ApiError ? err.message : 'Auto-match failed.'),
  });

  const matchMutation = useMutation({
    mutationFn: () =>
      matchReconciliation(id, {
        bankStatementTransactionId: selectedBankId!,
        journalEntryLineId: selectedBookId!,
      }),
    onSuccess: () => {
      setActionError(null);
      setSelectedBankId(null);
      setSelectedBookId(null);
      invalidate();
    },
    onError: (err) => setActionError(err instanceof ApiError ? err.message : 'Match failed.'),
  });

  const unmatchMutation = useMutation({
    mutationFn: (matchId: string) => unmatchReconciliation(id, matchId),
    onSuccess: () => {
      setActionError(null);
      invalidate();
    },
    onError: (err) => setActionError(err instanceof ApiError ? err.message : 'Unmatch failed.'),
  });

  const completeMutation = useMutation({
    mutationFn: () => completeReconciliation(id),
    onSuccess: () => {
      setActionError(null);
      invalidate();
    },
    onError: (err) =>
      setActionError(err instanceof ApiError ? err.message : 'Cannot complete reconciliation.'),
  });

  if (isLoading) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-10">
        <FinanceTabs />
        <p className="py-10 text-center text-sm text-muted-foreground">Loading reconciliation…</p>
      </main>
    );
  }
  if (isError || !detail) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-10">
        <FinanceTabs />
        <p className="py-10 text-center text-sm text-destructive">
          {error instanceof ApiError ? error.message : 'Reconciliation not found.'}
        </p>
      </main>
    );
  }

  const currency = cashAccount?.currency ?? 'NGN';
  const inProgress = detail.status === 'IN_PROGRESS';
  const fullyMatched = detail.unmatchedBank.length === 0 && detail.unmatchedBook.length === 0;

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <Link
            href="/settings/finance/reconciliation"
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            ← Reconciliation
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            {cashAccount?.name ?? 'Reconciliation'}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {new Date(detail.periodStart).toLocaleDateString()} –{' '}
            {new Date(detail.periodEnd).toLocaleDateString()}
          </p>
        </div>
        <Badge variant={BANK_RECONCILIATION_STATUS_VARIANT[detail.status]}>
          {BANK_RECONCILIATION_STATUS_LABELS[detail.status]}
        </Badge>
      </div>

      <FinanceTabs />

      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard title="Book Balance" value={formatCurrency(detail.bookBalance, currency)} />
        <SummaryCard
          title="Bank Statement Balance"
          value={formatCurrency(detail.closingBankBalance, currency)}
        />
        <SummaryCard
          title="Difference"
          value={formatCurrency(detail.difference, currency)}
          destructive={Math.abs(detail.difference) > 0.01}
        />
        <SummaryCard
          title="Outstanding Items"
          value={String(detail.unmatchedBank.length + detail.unmatchedBook.length)}
          destructive={detail.unmatchedBank.length + detail.unmatchedBook.length > 0}
        />
      </div>

      {inProgress && (
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <Button
            variant="outline"
            onClick={() => autoMatchMutation.mutate()}
            disabled={autoMatchMutation.isPending}
          >
            {autoMatchMutation.isPending ? 'Matching…' : 'Auto-match Exact'}
          </Button>
          <Button
            disabled={!selectedBankId || !selectedBookId || matchMutation.isPending}
            onClick={() => matchMutation.mutate()}
          >
            {matchMutation.isPending ? 'Matching…' : 'Match Selected'}
          </Button>
          <Button
            disabled={!fullyMatched || completeMutation.isPending}
            onClick={() => completeMutation.mutate()}
          >
            {completeMutation.isPending ? 'Completing…' : 'Complete Reconciliation'}
          </Button>
          {!fullyMatched && (
            <span className="text-xs text-muted-foreground">
              Match every outstanding item before completing.
            </span>
          )}
        </div>
      )}
      {!inProgress && (
        <p className="mb-6 rounded-md bg-muted/30 p-3 text-sm text-muted-foreground">
          This reconciliation is completed and immutable — corrections happen via a new transaction
          handled in a later session.
        </p>
      )}

      {actionError && <p className="mb-4 text-sm text-destructive">{actionError}</p>}

      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold tracking-tight">
          Matched ({detail.matches.length})
        </h2>
        {detail.matches.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing matched yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/50 text-left">
                <tr>
                  <th className="px-4 py-3 font-medium">Bank Transaction</th>
                  <th className="px-4 py-3 font-medium">Book Transaction (Journal)</th>
                  <th className="px-4 py-3 text-right font-medium">Amount</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  {inProgress && <th className="px-4 py-3 text-right font-medium">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {detail.matches.map((match) => (
                  <tr key={match.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3">{match.bankStatementTransaction.description}</td>
                    <td className="px-4 py-3 font-mono text-xs">
                      {match.journalEntryLine.journalNumber}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {formatCurrency(match.bankStatementTransaction.amount, currency)}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {match.matchType === 'EXACT_AUTO' ? 'Auto' : 'Manual'}
                    </td>
                    {inProgress && (
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => unmatchMutation.mutate(match.id)}
                          className="text-xs text-muted-foreground hover:text-destructive"
                        >
                          Unmatch
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section>
          <h2 className="mb-3 text-lg font-semibold tracking-tight">
            Unmatched Bank Transactions ({detail.unmatchedBank.length})
          </h2>
          <p className="mb-2 text-xs text-muted-foreground">
            On the bank statement but not yet represented in the books.
          </p>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/50 text-left">
                <tr>
                  <th className="px-3 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium">Description</th>
                  <th className="px-3 py-2 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {detail.unmatchedBank.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-3 py-6 text-center text-muted-foreground">
                      None outstanding.
                    </td>
                  </tr>
                )}
                {detail.unmatchedBank.map((row) => (
                  <tr
                    key={row.id}
                    onClick={() => inProgress && setSelectedBankId(row.id)}
                    className={`cursor-pointer border-b border-border last:border-0 ${
                      selectedBankId === row.id ? 'bg-primary/10' : ''
                    }`}
                  >
                    <td className="px-3 py-2">
                      {new Date(row.transactionDate).toLocaleDateString()}
                    </td>
                    <td className="px-3 py-2">{row.description}</td>
                    <td className="px-3 py-2 text-right">{formatCurrency(row.amount, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold tracking-tight">
            Unmatched Book Transactions ({detail.unmatchedBook.length})
          </h2>
          <p className="mb-2 text-xs text-muted-foreground">
            Recorded in Zentuva but not yet appearing on the bank statement.
          </p>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/50 text-left">
                <tr>
                  <th className="px-3 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium">Journal</th>
                  <th className="px-3 py-2 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {detail.unmatchedBook.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-3 py-6 text-center text-muted-foreground">
                      None outstanding.
                    </td>
                  </tr>
                )}
                {detail.unmatchedBook.map((row) => (
                  <tr
                    key={row.id}
                    onClick={() => inProgress && setSelectedBookId(row.id)}
                    className={`cursor-pointer border-b border-border last:border-0 ${
                      selectedBookId === row.id ? 'bg-primary/10' : ''
                    }`}
                  >
                    <td className="px-3 py-2">{new Date(row.date).toLocaleDateString()}</td>
                    <td className="px-3 py-2 font-mono text-xs">{row.journalNumber}</td>
                    <td className="px-3 py-2 text-right">
                      {formatCurrency(row.debit - row.credit, currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
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
