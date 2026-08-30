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
  Textarea,
} from '@zentuva/ui';

import { ApiError } from '@/lib/api-client';

import {
  createCashTransaction,
  listCashAccounts,
  listChartOfAccounts,
  type CashTransactionType,
} from '../api';
import { CASH_TRANSACTION_TYPE_LABELS } from '../labels';

function todayInputValue(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * "Record Cash Transaction" dialog (Sprint 14, docs/domains/cash-management.md §6)
 * — for cash movements OUTSIDE the existing Payment/Supplier Payment flows (a bank
 * charge, a petty cash payment, a miscellaneous receipt). The Contra Account picker
 * mirrors Supplier Invoice's Path B "Debit Account" picker: any non-system Chart of
 * Accounts entry, never a default.
 */
export function CashTransactionDialog({
  onOpenChange,
  onCreated,
}: {
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [cashAccountId, setCashAccountId] = useState('');
  const [transactionType, setTransactionType] = useState<CashTransactionType>('RECEIPT');
  const [transactionDate, setTransactionDate] = useState(() => todayInputValue());
  const [amount, setAmount] = useState<number | ''>('');
  const [description, setDescription] = useState('');
  const [reference, setReference] = useState('');
  const [contraAccountId, setContraAccountId] = useState('');

  const { data: cashAccountsData } = useQuery({
    queryKey: ['cash-accounts', 'ACTIVE'],
    queryFn: () => listCashAccounts({ status: 'ACTIVE' }),
  });
  const cashAccounts = cashAccountsData?.items ?? [];

  const { data: chartOfAccountsData } = useQuery({
    queryKey: ['chart-of-accounts', 'isActive'],
    queryFn: () => listChartOfAccounts({ isActive: true }),
  });
  const contraAccountOptions = (chartOfAccountsData?.items ?? []).filter(
    (account) => !account.isSystemAccount,
  );

  const mutation = useMutation({
    mutationFn: () =>
      createCashTransaction({
        cashAccountId,
        transactionType,
        transactionDate,
        amount: Number(amount),
        description,
        reference: reference || undefined,
        contraAccountId,
        idempotencyKey,
      }),
    onSuccess: onCreated,
  });

  const canSubmit =
    cashAccountId.length > 0 &&
    contraAccountId.length > 0 &&
    description.trim().length > 0 &&
    typeof amount === 'number' &&
    amount > 0;

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>Record Cash Transaction</DialogTitle>
      </DialogHeader>
      <form
        className="max-h-[75vh] space-y-4 overflow-y-auto pr-1"
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate();
        }}
      >
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Cash Account</Label>
            <Select
              value={cashAccountId}
              onChange={(event) => setCashAccountId(event.target.value)}
            >
              <option value="">Select an account…</option>
              {cashAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Type</Label>
            <Select
              value={transactionType}
              onChange={(event) => setTransactionType(event.target.value as CashTransactionType)}
            >
              {Object.entries(CASH_TRANSACTION_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Amount</Label>
            <Input
              type="number"
              step="any"
              min="0"
              value={amount}
              onChange={(event) =>
                setAmount(event.target.value === '' ? '' : Number(event.target.value))
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label>Date</Label>
            <Input
              type="date"
              value={transactionDate}
              onChange={(event) => setTransactionDate(event.target.value)}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Description</Label>
          <Textarea
            rows={2}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="e.g. Bank charge, Petty cash top-up"
          />
        </div>

        <div className="space-y-1.5">
          <Label>Contra Account</Label>
          <Select
            value={contraAccountId}
            onChange={(event) => setContraAccountId(event.target.value)}
          >
            <option value="">Select the other side of this entry…</option>
            {contraAccountOptions.map((account) => (
              <option key={account.id} value={account.id}>
                {account.code} — {account.name}
              </option>
            ))}
          </Select>
          <p className="text-xs text-muted-foreground">
            {transactionType === 'RECEIPT'
              ? 'What this money represents (e.g. Other Income).'
              : 'What this money was spent on (e.g. Bank Charges).'}
          </p>
        </div>

        <div className="space-y-1.5">
          <Label>Reference (optional)</Label>
          <Input value={reference} onChange={(event) => setReference(event.target.value)} />
        </div>

        {mutation.isError && (
          <p className="text-sm text-destructive">
            {mutation.error instanceof ApiError
              ? mutation.error.message
              : 'Failed to record cash transaction.'}
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={!canSubmit || mutation.isPending}>
            {mutation.isPending ? 'Recording…' : 'Record Transaction'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
