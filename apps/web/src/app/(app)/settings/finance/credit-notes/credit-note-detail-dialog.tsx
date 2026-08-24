'use client';

import { useMutation } from '@tanstack/react-query';
import { Badge, Button, Dialog, DialogFooter, DialogHeader, DialogTitle } from '@zentuva/ui';

import { ApiError } from '@/lib/api-client';
import { formatCurrency } from '@/lib/format-currency';

import { issueCreditNote, voidCreditNote, type CreditNote } from '../api';
import { CREDIT_NOTE_STATUS_LABELS, CREDIT_NOTE_STATUS_VARIANT } from '../labels';

/** Read-only Credit Note detail + Issue/Void actions (Sprint 6, docs/domains/
 *  finance.md). A credit note created via the Invoice detail dialog's combined
 *  create+issue flow lands here already ISSUED — this view exists for independently
 *  reviewing/voiding an existing credit note from the flat Credit Notes list. */
export function CreditNoteDetailDialog({
  creditNote,
  onOpenChange,
  onChanged,
}: {
  creditNote: CreditNote;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  const issueMutation = useMutation({
    mutationFn: () => issueCreditNote(creditNote.id),
    onSuccess: onChanged,
  });
  const voidMutation = useMutation({
    mutationFn: () => voidCreditNote(creditNote.id),
    onSuccess: onChanged,
  });

  const canIssue = creditNote.status === 'DRAFT';
  const canVoid = creditNote.status === 'DRAFT' || creditNote.status === 'ISSUED';

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          {creditNote.creditNoteCode}
          <Badge variant={CREDIT_NOTE_STATUS_VARIANT[creditNote.status]}>
            {CREDIT_NOTE_STATUS_LABELS[creditNote.status]}
          </Badge>
        </DialogTitle>
      </DialogHeader>
      <div className="space-y-4 text-sm">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-muted-foreground">Customer</p>
            <p>{creditNote.customer.customerName}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Invoice</p>
            <p className="font-mono text-xs">{creditNote.invoice?.invoiceCode ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Date</p>
            <p>{new Date(creditNote.creditNoteDate).toLocaleDateString()}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Amount</p>
            <p className="font-semibold">
              {formatCurrency(creditNote.amount, creditNote.currency)}
            </p>
          </div>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Reason</p>
          <p>{creditNote.reason}</p>
        </div>
        {creditNote.notes && (
          <div>
            <p className="text-xs text-muted-foreground">Notes</p>
            <p>{creditNote.notes}</p>
          </div>
        )}

        {(issueMutation.isError || voidMutation.isError) && (
          <p className="text-sm text-destructive">
            {[issueMutation, voidMutation]
              .map((m) => (m.error instanceof ApiError ? m.error.message : undefined))
              .find(Boolean) ?? 'That action could not be completed.'}
          </p>
        )}
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
          Close
        </Button>
        {canVoid && (
          <Button
            type="button"
            variant="outline"
            onClick={() => voidMutation.mutate()}
            disabled={voidMutation.isPending}
          >
            {voidMutation.isPending ? 'Voiding…' : 'Void'}
          </Button>
        )}
        {canIssue && (
          <Button
            type="button"
            onClick={() => issueMutation.mutate()}
            disabled={issueMutation.isPending}
          >
            {issueMutation.isPending ? 'Issuing…' : 'Issue'}
          </Button>
        )}
      </DialogFooter>
    </Dialog>
  );
}
