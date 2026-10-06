'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Dialog, DialogFooter, DialogHeader, DialogTitle, Input, Label } from '@zentuva/ui';

import { D2cTabs } from '@/components/app/d2c-tabs';
import { ApiError } from '@/lib/api-client';

import { getConsumer } from '../consumers/api';
import { adjustLoyaltyBalance, getLoyaltyLedger, listLoyaltyAccounts } from './api';

const PAGE_SIZE = 20;

/**
 * Sprint 40 — Loyalty admin (docs/domains/d2c.md "Admin Experience"). Account balances
 * (a maintained running total, never the source of truth — `LoyaltyLedgerEntry` is) plus
 * each consumer's full ledger history, and the one administrative mutation: a reasoned
 * balance adjustment, never a silent overwrite.
 */
export default function LoyaltyPage() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selectedConsumerId, setSelectedConsumerId] = useState<string | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['loyalty-accounts', search, page],
    queryFn: () => listLoyaltyAccounts({ search: search || undefined, page, pageSize: PAGE_SIZE }),
  });

  const accounts = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Loyalty</h1>
        <p className="text-sm text-muted-foreground">
          Consumer loyalty accounts — balance, ledger history, and administrative adjustments.
        </p>
      </div>

      <D2cTabs />

      <Input
        placeholder="Search consumer name or code…"
        value={search}
        onChange={(e) => {
          setPage(1);
          setSearch(e.target.value);
        }}
        className="max-w-xs"
      />

      {isLoading && <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>}
      {isError && (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <p className="text-sm text-destructive">
            {error instanceof ApiError ? error.message : 'Failed to load loyalty accounts.'}
          </p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      )}

      {!isLoading && !isError && accounts.length === 0 && (
        <p className="py-10 text-center text-sm text-muted-foreground">
          No consumer has earned any points yet.
        </p>
      )}

      {!isLoading && !isError && accounts.length > 0 && (
        <>
          <div className="divide-y divide-border rounded-lg border border-border">
            {accounts.map((account) => (
              <button
                key={account.id}
                type="button"
                onClick={() => setSelectedConsumerId(account.consumerId)}
                className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left hover:bg-muted/50"
              >
                <div>
                  <p className="font-medium">{account.consumer.fullName}</p>
                  <p className="text-sm text-muted-foreground">{account.consumer.consumerCode}</p>
                </div>
                <p className="text-lg font-semibold">{account.balance.toLocaleString()} pts</p>
              </button>
            ))}
          </div>

          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <p>
              Page {page} of {totalPages} · {total} account{total === 1 ? '' : 's'}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}

      {selectedConsumerId && (
        <LoyaltyAccountDialog
          consumerId={selectedConsumerId}
          onOpenChange={(open) => !open && setSelectedConsumerId(null)}
          onChanged={() => refetch()}
        />
      )}
    </div>
  );
}

function LoyaltyAccountDialog({
  consumerId,
  onOpenChange,
  onChanged,
}: {
  consumerId: string;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');

  const { data: consumer } = useQuery({
    queryKey: ['consumer', consumerId],
    queryFn: () => getConsumer(consumerId),
  });
  const { data: ledgerData, refetch: refetchLedger } = useQuery({
    queryKey: ['loyalty-ledger', consumerId],
    queryFn: () => getLoyaltyLedger(consumerId, { pageSize: 50 }),
  });
  const entries = ledgerData?.items ?? [];

  const adjustMutation = useMutation({
    mutationFn: () => adjustLoyaltyBalance(consumerId, Number(amount), reason),
    onSuccess: () => {
      setAmount('');
      setReason('');
      refetchLedger();
      queryClient.invalidateQueries({ queryKey: ['loyalty-accounts'] });
      onChanged();
    },
  });

  const currentBalance = entries[0]?.balanceAfter ?? 0;

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>Loyalty Account — {consumer?.fullName ?? '…'}</DialogTitle>
      </DialogHeader>
      <div className="space-y-4">
        <div className="rounded-md border border-dashed border-border bg-muted/50 p-3 text-center">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Current Balance</p>
          <p className="text-2xl font-semibold">{currentBalance.toLocaleString()} pts</p>
        </div>

        <div className="space-y-1.5 border-t border-border pt-4">
          <Label>Manual Adjustment</Label>
          <div className="flex gap-2">
            <Input
              type="number"
              placeholder="Amount (+/-)"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <Input
              placeholder="Reason (required)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          {adjustMutation.isError && (
            <p className="text-sm text-destructive">
              {adjustMutation.error instanceof ApiError
                ? adjustMutation.error.message
                : 'Adjustment failed.'}
            </p>
          )}
          <DialogFooter>
            <Button
              size="sm"
              disabled={!amount || !reason.trim() || adjustMutation.isPending}
              onClick={() => adjustMutation.mutate()}
            >
              {adjustMutation.isPending ? 'Applying…' : 'Apply Adjustment'}
            </Button>
          </DialogFooter>
        </div>

        <div className="space-y-1.5 border-t border-border pt-4">
          <Label>Ledger History</Label>
          {entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">No ledger entries yet.</p>
          ) : (
            <ul className="max-h-64 space-y-1 overflow-y-auto text-sm">
              {entries.map((entry) => (
                <li key={entry.id} className="flex items-center justify-between">
                  <span>
                    {entry.type} {entry.reason ? `· ${entry.reason}` : ''}
                  </span>
                  <span className={entry.amount >= 0 ? 'text-primary' : 'text-destructive'}>
                    {entry.amount >= 0 ? '+' : ''}
                    {entry.amount} → {entry.balanceAfter}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Dialog>
  );
}
