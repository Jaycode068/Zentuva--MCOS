'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Button,
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
} from '@zentuva/ui';

import { ApiError } from '@/lib/api-client';

import { createBankReconciliation, listCashAccounts } from '../api';

function todayInputValue(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * "Start Reconciliation" dialog (Sprint 14, docs/domains/cash-management.md §9) —
 * one cash/bank account + a bank-statement period + the opening/closing balances
 * the statement itself reports. Only one `IN_PROGRESS` session per cash account is
 * allowed at a time — the server rejects a second one with a clear error.
 */
export function ReconciliationCreateDialog({
  onOpenChange,
  onCreated,
}: {
  onOpenChange: (open: boolean) => void;
  onCreated: (id: string) => void;
}) {
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [cashAccountId, setCashAccountId] = useState('');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState(() => todayInputValue());
  const [openingBankBalance, setOpeningBankBalance] = useState<number | ''>('');
  const [closingBankBalance, setClosingBankBalance] = useState<number | ''>('');

  const { data: cashAccountsData } = useQuery({
    queryKey: ['cash-accounts', 'ACTIVE'],
    queryFn: () => listCashAccounts({ status: 'ACTIVE' }),
  });
  const cashAccounts = cashAccountsData?.items ?? [];

  const mutation = useMutation({
    mutationFn: () =>
      createBankReconciliation({
        cashAccountId,
        periodStart,
        periodEnd,
        openingBankBalance: Number(openingBankBalance),
        closingBankBalance: Number(closingBankBalance),
        idempotencyKey,
      }),
    onSuccess: (result) => onCreated(result.id),
  });

  const canSubmit =
    cashAccountId.length > 0 &&
    periodStart.length > 0 &&
    periodEnd.length > 0 &&
    openingBankBalance !== '' &&
    closingBankBalance !== '';

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>Start Reconciliation</DialogTitle>
      </DialogHeader>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate();
        }}
      >
        <div className="space-y-1.5">
          <Label>Cash Account</Label>
          <Select value={cashAccountId} onChange={(event) => setCashAccountId(event.target.value)}>
            <option value="">Select an account…</option>
            {cashAccounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Period Start</Label>
            <Input
              type="date"
              value={periodStart}
              onChange={(event) => setPeriodStart(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Period End</Label>
            <Input
              type="date"
              value={periodEnd}
              onChange={(event) => setPeriodEnd(event.target.value)}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Opening Bank Balance</Label>
            <Input
              type="number"
              step="any"
              value={openingBankBalance}
              onChange={(event) =>
                setOpeningBankBalance(event.target.value === '' ? '' : Number(event.target.value))
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label>Closing Bank Balance</Label>
            <Input
              type="number"
              step="any"
              value={closingBankBalance}
              onChange={(event) =>
                setClosingBankBalance(event.target.value === '' ? '' : Number(event.target.value))
              }
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Copy these figures straight from the physical bank statement for this period.
        </p>

        {mutation.isError && (
          <p className="text-sm text-destructive">
            {mutation.error instanceof ApiError
              ? mutation.error.message
              : 'Failed to start reconciliation.'}
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={!canSubmit || mutation.isPending}>
            {mutation.isPending ? 'Starting…' : 'Start Reconciliation'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
