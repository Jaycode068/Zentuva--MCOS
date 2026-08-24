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
  Textarea,
} from '@zentuva/ui';

import { ApiError } from '@/lib/api-client';
import { formatCurrency } from '@/lib/format-currency';

import { createCreditNote, issueCreditNote, type Invoice } from '../api';

function toDateInputValue(value: string): string {
  return value.slice(0, 10);
}

/**
 * "Issue Credit Note" dialog (Sprint 6, docs/domains/finance.md) — the financial
 * consequence of a customer return or commercial adjustment. The physical return itself
 * belongs to Sales/Logistics/Inventory, entirely out of scope here. Creates a DRAFT
 * credit note and immediately issues it in one user action (two server calls) — Sprint 6
 * has no separate "review a draft credit note later" workflow yet.
 */
export function CreditNoteDialog({
  invoice,
  onOpenChange,
  onIssued,
}: {
  invoice: Invoice;
  onOpenChange: (open: boolean) => void;
  onIssued: () => void;
}) {
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [amount, setAmount] = useState<number | ''>('');
  const [reason, setReason] = useState('');
  const [creditNoteDate, setCreditNoteDate] = useState(() =>
    toDateInputValue(new Date().toISOString()),
  );

  const mutation = useMutation({
    mutationFn: async () => {
      const created = await createCreditNote({
        invoiceId: invoice.id,
        amount: Number(amount),
        reason,
        creditNoteDate,
        idempotencyKey,
      });
      return issueCreditNote(created.id);
    },
    onSuccess: onIssued,
  });

  const overCredit = typeof amount === 'number' && amount > invoice.amountOutstanding;
  const canSubmit =
    typeof amount === 'number' && amount > 0 && !overCredit && reason.trim().length > 0;

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>Issue Credit Note — {invoice.invoiceCode}</DialogTitle>
      </DialogHeader>
      <form
        className="max-h-[75vh] space-y-4 overflow-y-auto pr-1"
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate();
        }}
      >
        <div className="rounded-md bg-muted/30 p-3 text-xs text-muted-foreground">
          Outstanding
          <div className="font-medium text-foreground">
            {formatCurrency(invoice.amountOutstanding, invoice.currency)}
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
          {overCredit && (
            <p className="text-xs text-destructive">
              Cannot credit more than the{' '}
              {formatCurrency(invoice.amountOutstanding, invoice.currency)} remaining outstanding.
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label>Reason</Label>
          <Textarea
            rows={2}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="e.g. Returned goods — damaged in transit, 25 packs"
          />
        </div>

        <div className="space-y-1.5">
          <Label>Date</Label>
          <Input
            type="date"
            value={creditNoteDate}
            onChange={(event) => setCreditNoteDate(event.target.value)}
          />
        </div>

        {mutation.isError && (
          <p className="text-sm text-destructive">
            {mutation.error instanceof ApiError
              ? mutation.error.message
              : 'Failed to issue credit note.'}
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={!canSubmit || mutation.isPending}>
            {mutation.isPending ? 'Issuing…' : 'Issue Credit Note'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
