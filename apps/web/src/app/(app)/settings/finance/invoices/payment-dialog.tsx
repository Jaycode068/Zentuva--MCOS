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
import { formatCurrency } from '@/lib/format-currency';

import { createPayment, listCashAccounts, type Invoice, type PaymentMethod } from '../api';
import { PAYMENT_METHOD_LABELS } from '../labels';

function toDateInputValue(value: string): string {
  return value.slice(0, 10);
}

/**
 * "Record Payment" dialog (Sprint 6, docs/domains/finance.md). The server rejects an
 * over-payment/a payment against an ineligible invoice authoritatively — the client-side
 * disabled-state below is a UX convenience only.
 */
export function PaymentDialog({
  invoice,
  onOpenChange,
  onRecorded,
}: {
  invoice: Invoice;
  onOpenChange: (open: boolean) => void;
  onRecorded: () => void;
}) {
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [amount, setAmount] = useState<number | ''>('');
  const [method, setMethod] = useState<PaymentMethod>('BANK_TRANSFER');
  const [paymentDate, setPaymentDate] = useState(() => toDateInputValue(new Date().toISOString()));
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [cashAccountId, setCashAccountId] = useState('');

  const { data: cashAccountsData } = useQuery({
    queryKey: ['cash-accounts', 'ACTIVE'],
    queryFn: () => listCashAccounts({ status: 'ACTIVE' }),
  });
  const cashAccounts = cashAccountsData?.items ?? [];

  const mutation = useMutation({
    mutationFn: () =>
      createPayment({
        invoiceId: invoice.id,
        amount: Number(amount),
        method,
        paymentDate,
        reference: reference || undefined,
        notes: notes || undefined,
        cashAccountId: cashAccountId || undefined,
        idempotencyKey,
      }),
    onSuccess: onRecorded,
  });

  const overPayment = typeof amount === 'number' && amount > invoice.amountOutstanding;
  const canSubmit = typeof amount === 'number' && amount > 0 && !overPayment;

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>Record Payment — {invoice.invoiceCode}</DialogTitle>
      </DialogHeader>
      <form
        className="max-h-[75vh] space-y-4 overflow-y-auto pr-1"
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate();
        }}
      >
        <div className="grid grid-cols-3 gap-x-4 gap-y-1 rounded-md bg-muted/30 p-3 text-xs text-muted-foreground">
          <div>
            Total
            <div className="font-medium text-foreground">
              {formatCurrency(invoice.total, invoice.currency)}
            </div>
          </div>
          <div>
            Paid
            <div className="font-medium text-foreground">
              {formatCurrency(invoice.amountPaid, invoice.currency)}
            </div>
          </div>
          <div>
            Outstanding
            <div className="font-medium text-foreground">
              {formatCurrency(invoice.amountOutstanding, invoice.currency)}
            </div>
          </div>
        </div>

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
          {overPayment && (
            <p className="text-xs text-destructive">
              Cannot record more than the{' '}
              {formatCurrency(invoice.amountOutstanding, invoice.currency)} remaining outstanding.
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Payment Method</Label>
            <Select
              value={method}
              onChange={(event) => setMethod(event.target.value as PaymentMethod)}
            >
              {Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Date</Label>
            <Input
              type="date"
              value={paymentDate}
              onChange={(event) => setPaymentDate(event.target.value)}
            />
          </div>
        </div>

        {cashAccounts.length > 0 && (
          <div className="space-y-1.5">
            <Label>Cash Account (optional)</Label>
            <Select
              value={cashAccountId}
              onChange={(event) => setCashAccountId(event.target.value)}
            >
              <option value="">Not specified</option>
              {cashAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </Select>
          </div>
        )}

        <div className="space-y-1.5">
          <Label>Reference (optional)</Label>
          <Input
            value={reference}
            onChange={(event) => setReference(event.target.value)}
            placeholder="Bank transaction reference"
          />
        </div>

        <div className="space-y-1.5">
          <Label>Notes (optional)</Label>
          <Textarea rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} />
        </div>

        {mutation.isError && (
          <p className="text-sm text-destructive">
            {mutation.error instanceof ApiError
              ? mutation.error.message
              : 'Failed to record payment.'}
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={!canSubmit || mutation.isPending}>
            {mutation.isPending ? 'Recording…' : 'Record Payment'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
