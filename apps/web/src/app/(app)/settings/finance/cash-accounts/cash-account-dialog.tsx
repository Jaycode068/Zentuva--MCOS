'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
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

import { createCashAccount, type CashAccountType } from '../api';
import { CASH_ACCOUNT_TYPE_LABELS } from '../labels';

function todayInputValue(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * "Add Cash Account" dialog (Sprint 14, docs/domains/cash-management.md §2/§5) —
 * a single-phase create form, unlike the multi-step Invoice/Supplier Invoice
 * dialogs: there is no upstream document to pick from first. Creating the account
 * atomically provisions its own dedicated Chart of Accounts row and, if an opening
 * balance is supplied, posts the opening-balance journal entry server-side — this
 * form never shows or lets the user pick a Chart of Accounts row directly.
 */
export function CashAccountDialog({
  onOpenChange,
  onCreated,
}: {
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [accountCode, setAccountCode] = useState('');
  const [name, setName] = useState('');
  const [accountType, setAccountType] = useState<CashAccountType>('BANK');
  const [currency, setCurrency] = useState('NGN');
  const [bankName, setBankName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [accountName, setAccountName] = useState('');
  const [description, setDescription] = useState('');
  const [openingBalance, setOpeningBalance] = useState<number | ''>('');
  const [openingBalanceDate, setOpeningBalanceDate] = useState(() => todayInputValue());

  const mutation = useMutation({
    mutationFn: () =>
      createCashAccount({
        accountCode,
        name,
        accountType,
        currency,
        bankName: bankName || undefined,
        accountNumber: accountNumber || undefined,
        accountName: accountName || undefined,
        description: description || undefined,
        openingBalance: openingBalance === '' ? undefined : openingBalance,
        openingBalanceDate: openingBalance === '' ? undefined : openingBalanceDate,
        idempotencyKey,
      }),
    onSuccess: onCreated,
  });

  const canSubmit =
    accountCode.trim().length > 0 && name.trim().length > 0 && currency.trim().length > 0;

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>Add Cash Account</DialogTitle>
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
            <Label>Account Code</Label>
            <Input
              value={accountCode}
              onChange={(event) => setAccountCode(event.target.value)}
              placeholder="CASH-001"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Type</Label>
            <Select
              value={accountType}
              onChange={(event) => setAccountType(event.target.value as CashAccountType)}
            >
              {Object.entries(CASH_ACCOUNT_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Name</Label>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="GTBank Current Account"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Currency</Label>
            <Input value={currency} onChange={(event) => setCurrency(event.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Bank Name (optional)</Label>
            <Input value={bankName} onChange={(event) => setBankName(event.target.value)} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Account Number (optional)</Label>
            <Input
              value={accountNumber}
              onChange={(event) => setAccountNumber(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Displayed masked everywhere except a deliberate reveal action.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label>Account Name (optional)</Label>
            <Input value={accountName} onChange={(event) => setAccountName(event.target.value)} />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Description (optional)</Label>
          <Textarea
            rows={2}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </div>

        <div className="grid grid-cols-2 gap-4 rounded-md border border-border p-3">
          <div className="space-y-1.5">
            <Label>Opening Balance (optional)</Label>
            <Input
              type="number"
              step="any"
              min="0"
              value={openingBalance}
              onChange={(event) =>
                setOpeningBalance(event.target.value === '' ? '' : Number(event.target.value))
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label>Opening Date</Label>
            <Input
              type="date"
              value={openingBalanceDate}
              onChange={(event) => setOpeningBalanceDate(event.target.value)}
              disabled={openingBalance === ''}
            />
          </div>
        </div>

        {mutation.isError && (
          <p className="text-sm text-destructive">
            {mutation.error instanceof ApiError
              ? mutation.error.message
              : 'Failed to create cash account.'}
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={!canSubmit || mutation.isPending}>
            {mutation.isPending ? 'Creating…' : 'Add Cash Account'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
