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
  createCashflowForecastItem,
  listCashAccounts,
  type CashflowDirection,
  type CashflowRecurrence,
} from '../api';
import { CASHFLOW_DIRECTION_LABELS, CASHFLOW_RECURRENCE_LABELS } from '../labels';

function todayInputValue(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * "Add Cashflow Item" dialog (Sprint 15, docs/domains/cashflow.md §5/§6) — a
 * management-entered future cash commitment (a known one-time payment or a
 * recurring one like rent), never a substitute for an Invoice/SupplierInvoice/
 * Payment/SupplierPayment. `sourceType` is never shown here — it's derived
 * server-side from the recurrence chosen.
 */
export function CashflowItemDialog({
  onOpenChange,
  onCreated,
}: {
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [direction, setDirection] = useState<CashflowDirection>('OUTFLOW');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState<number | ''>('');
  const [currency, setCurrency] = useState('NGN');
  const [expectedDate, setExpectedDate] = useState(() => todayInputValue());
  const [recurrence, setRecurrence] = useState<CashflowRecurrence>('ONE_TIME');
  const [recurrenceEndDate, setRecurrenceEndDate] = useState('');
  const [cashAccountId, setCashAccountId] = useState('');
  const [notes, setNotes] = useState('');

  const { data: cashAccountsData } = useQuery({
    queryKey: ['cash-accounts', 'ACTIVE'],
    queryFn: () => listCashAccounts({ status: 'ACTIVE' }),
  });
  const cashAccounts = cashAccountsData?.items ?? [];

  const mutation = useMutation({
    mutationFn: () =>
      createCashflowForecastItem({
        cashAccountId: cashAccountId || undefined,
        direction,
        description,
        amount: Number(amount),
        currency,
        expectedDate,
        recurrence,
        recurrenceEndDate: recurrenceEndDate || undefined,
        notes: notes || undefined,
        idempotencyKey,
      }),
    onSuccess: onCreated,
  });

  const canSubmit = description.trim().length > 0 && typeof amount === 'number' && amount > 0;

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>Add Cashflow Item</DialogTitle>
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
            <Label>Type</Label>
            <Select
              value={direction}
              onChange={(event) => setDirection(event.target.value as CashflowDirection)}
            >
              {Object.entries(CASHFLOW_DIRECTION_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Recurrence</Label>
            <Select
              value={recurrence}
              onChange={(event) => setRecurrence(event.target.value as CashflowRecurrence)}
            >
              {Object.entries(CASHFLOW_RECURRENCE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Description</Label>
          <Textarea
            rows={2}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="e.g. Factory Rent, Planned Equipment Payment"
          />
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
            <Label>Currency</Label>
            <Input value={currency} onChange={(event) => setCurrency(event.target.value)} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>{recurrence === 'ONE_TIME' ? 'Expected Date' : 'First Occurrence'}</Label>
            <Input
              type="date"
              value={expectedDate}
              onChange={(event) => setExpectedDate(event.target.value)}
            />
          </div>
          {recurrence !== 'ONE_TIME' && (
            <div className="space-y-1.5">
              <Label>Ends (optional)</Label>
              <Input
                type="date"
                value={recurrenceEndDate}
                onChange={(event) => setRecurrenceEndDate(event.target.value)}
              />
            </div>
          )}
        </div>

        {cashAccounts.length > 0 && (
          <div className="space-y-1.5">
            <Label>Cash Account (optional)</Label>
            <Select
              value={cashAccountId}
              onChange={(event) => setCashAccountId(event.target.value)}
            >
              <option value="">Not assigned to a specific account</option>
              {cashAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </Select>
            <p className="text-xs text-muted-foreground">
              Only assigned items appear in that account&apos;s own forecast — money not yet
              collected/paid can&apos;t be attributed to a specific account.
            </p>
          </div>
        )}

        <div className="space-y-1.5">
          <Label>Notes (optional)</Label>
          <Textarea rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} />
        </div>

        {mutation.isError && (
          <p className="text-sm text-destructive">
            {mutation.error instanceof ApiError ? mutation.error.message : 'Failed to create item.'}
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={!canSubmit || mutation.isPending}>
            {mutation.isPending ? 'Adding…' : 'Add Item'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
