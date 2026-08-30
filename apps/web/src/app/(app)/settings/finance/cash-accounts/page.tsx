'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@zentuva/ui';

import { FinanceTabs } from '@/components/app/finance-tabs';
import { BanknoteIcon } from '@/components/workspace/icons';
import { ApiError } from '@/lib/api-client';
import { formatCurrency } from '@/lib/format-currency';

import { listCashAccounts, type CashAccount } from '../api';
import {
  CASH_ACCOUNT_STATUS_LABELS,
  CASH_ACCOUNT_STATUS_VARIANT,
  CASH_ACCOUNT_TYPE_LABELS,
} from '../labels';
import { CashAccountDialog } from './cash-account-dialog';

/**
 * Cash Account master list (Sprint 14, docs/domains/cash-management.md) — every
 * account an organisation holds money in, each linked to its own dedicated Chart of
 * Accounts row. Row click opens the full account detail page
 * (`/settings/finance/cash-accounts/[id]`), not a dialog — that view needs
 * Transactions/Reconciliation History/Statements sections, too much for a dialog.
 */
export default function CashAccountsPage() {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['cash-accounts'],
    queryFn: () => listCashAccounts(),
  });
  const accounts = useMemo(() => data?.items ?? [], [data]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['cash-accounts'] });
  };

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Finance</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every bank account, cash drawer, or settlement account this organisation holds money in.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>Add Cash Account</Button>
      </div>

      <FinanceTabs />

      {isLoading && (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading cash accounts…</p>
      )}
      {isError && (
        <p className="py-10 text-center text-sm text-destructive">
          {error instanceof ApiError ? error.message : 'Failed to load cash accounts.'}
        </p>
      )}

      {!isLoading && !isError && accounts.length === 0 && (
        <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed border-border px-6 py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <BanknoteIcon className="h-6 w-6" />
          </div>
          <h2 className="text-base font-semibold text-foreground">No cash accounts yet</h2>
          <p className="max-w-sm text-sm text-muted-foreground">
            Add your first bank account, petty cash drawer, or settlement account to start tracking
            book balances and reconciling against bank statements.
          </p>
          <Button onClick={() => setCreateOpen(true)}>Add Your First Cash Account</Button>
        </div>
      )}

      {!isLoading && !isError && accounts.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {accounts.map((account) => (
            <CashAccountCard key={account.id} account={account} />
          ))}
        </div>
      )}

      {createOpen && (
        <CashAccountDialog onOpenChange={() => setCreateOpen(false)} onCreated={invalidate} />
      )}
    </main>
  );
}

function CashAccountCard({ account }: { account: CashAccount }) {
  return (
    <Link href={`/settings/finance/cash-accounts/${account.id}`}>
      <Card className="h-full transition-colors hover:border-primary/50">
        <CardHeader className="flex flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle className="text-base">{account.name}</CardTitle>
            <p className="mt-1 font-mono text-xs text-muted-foreground">{account.accountCode}</p>
          </div>
          <Badge variant={CASH_ACCOUNT_STATUS_VARIANT[account.status]}>
            {CASH_ACCOUNT_STATUS_LABELS[account.status]}
          </Badge>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">
            {CASH_ACCOUNT_TYPE_LABELS[account.accountType]}
            {account.bankName ? ` · ${account.bankName}` : ''}
          </p>
          {account.accountNumberMasked && (
            <p className="mt-1 font-mono text-xs text-muted-foreground">
              {account.accountNumberMasked}
            </p>
          )}
          <p className="mt-3 text-xs text-muted-foreground">Opening Balance</p>
          <p className="text-lg font-semibold">
            {formatCurrency(account.openingBalance, account.currency)}
          </p>
        </CardContent>
      </Card>
    </Link>
  );
}
