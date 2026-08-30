'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button } from '@zentuva/ui';

import { FinanceTabs } from '@/components/app/finance-tabs';
import { ApiError } from '@/lib/api-client';
import { formatCurrency } from '@/lib/format-currency';

import { listBankReconciliations, listCashAccounts } from '../api';
import { BANK_RECONCILIATION_STATUS_LABELS, BANK_RECONCILIATION_STATUS_VARIANT } from '../labels';
import { ReconciliationCreateDialog } from './reconciliation-create-dialog';

/**
 * Reconciliation sessions across every cash account (Sprint 14, docs/domains/
 * cash-management.md §9-§12) — every session ever started, its period, and whether
 * it's still `IN_PROGRESS` or `COMPLETED`. Click through to the workspace
 * (`/settings/finance/reconciliation/[id]`) to match transactions.
 */
export default function ReconciliationPage() {
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);

  const { data: cashAccountsData } = useQuery({
    queryKey: ['cash-accounts'],
    queryFn: () => listCashAccounts(),
  });
  const cashAccountsById = new Map((cashAccountsData?.items ?? []).map((a) => [a.id, a]));

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['bank-reconciliations'],
    queryFn: () => listBankReconciliations(),
  });
  const reconciliations = useMemo(() => data?.items ?? [], [data]);

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Finance</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Reconcile Zentuva&apos;s book transactions against your bank statement, one account and
            period at a time.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>Start Reconciliation</Button>
      </div>

      <FinanceTabs />

      {isLoading && (
        <p className="py-10 text-center text-sm text-muted-foreground">
          Loading reconciliation sessions…
        </p>
      )}
      {isError && (
        <p className="py-10 text-center text-sm text-destructive">
          {error instanceof ApiError ? error.message : 'Failed to load reconciliations.'}
        </p>
      )}
      {!isLoading && !isError && reconciliations.length === 0 && (
        <p className="py-10 text-center text-sm text-muted-foreground">
          No reconciliation sessions yet.
        </p>
      )}

      {!isLoading && !isError && reconciliations.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/50 text-left">
              <tr>
                <th className="px-4 py-3 font-medium">Cash Account</th>
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
                    {cashAccountsById.get(recon.cashAccountId)?.name ?? recon.cashAccountId}
                  </td>
                  <td className="px-4 py-3">
                    {new Date(recon.periodStart).toLocaleDateString()} –{' '}
                    {new Date(recon.periodEnd).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {formatCurrency(recon.closingBankBalance, 'NGN')}
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
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {createOpen && (
        <ReconciliationCreateDialog
          onOpenChange={() => setCreateOpen(false)}
          onCreated={(id) => router.push(`/settings/finance/reconciliation/${id}`)}
        />
      )}
    </main>
  );
}
