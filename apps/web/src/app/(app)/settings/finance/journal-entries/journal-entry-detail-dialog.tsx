'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { Badge, Button, Dialog, DialogFooter, DialogHeader, DialogTitle } from '@zentuva/ui';

import { ApiError } from '@/lib/api-client';
import { formatCurrency } from '@/lib/format-currency';

import { getJournalEntry, voidJournalEntry } from '../api';
import {
  JOURNAL_ENTRY_STATUS_LABELS,
  JOURNAL_ENTRY_STATUS_VARIANT,
  JOURNAL_SOURCE_TYPE_LABELS,
} from '../labels';

/** Read-only Journal Entry detail view (Sprint 7, docs/domains/accounting.md). `Void`
 *  is a bare status flip — it never reverses the accounting effect (a true correction
 *  is a new manual journal, not an automatic reversal — see the domain doc's
 *  "Immutability & Correction" section). Where `sourceType` is set, the source code
 *  (e.g. an invoice number) is shown as plain text — Finance's own Invoices/Payments/
 *  Credit Notes tabs are where a user navigates to that record directly. */
export function JournalEntryDetailDialog({
  journalEntryId,
  onOpenChange,
  onChanged,
}: {
  journalEntryId: string;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  const { data: entry, isLoading } = useQuery({
    queryKey: ['journal-entry', journalEntryId],
    queryFn: () => getJournalEntry(journalEntryId),
  });

  const voidMutation = useMutation({
    mutationFn: () => voidJournalEntry(journalEntryId),
    onSuccess: onChanged,
  });

  if (isLoading || !entry) {
    return (
      <Dialog open onOpenChange={onOpenChange}>
        <DialogHeader>
          <DialogTitle>Journal Entry</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">Loading…</p>
      </Dialog>
    );
  }

  const canVoid = entry.status !== 'VOID';

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          {entry.journalNumber}
          <Badge variant={JOURNAL_ENTRY_STATUS_VARIANT[entry.status]}>
            {JOURNAL_ENTRY_STATUS_LABELS[entry.status]}
          </Badge>
        </DialogTitle>
      </DialogHeader>
      <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1 text-sm">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-muted-foreground">Date</p>
            <p>{new Date(entry.date).toLocaleDateString()}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Period</p>
            <p>{entry.accountingPeriod.name}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Source</p>
            <p>
              {JOURNAL_SOURCE_TYPE_LABELS[entry.sourceType ?? 'MANUAL'] ?? entry.sourceType}
              {entry.reference ? ` — ${entry.reference}` : ''}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Posted</p>
            <p>{entry.postedAt ? new Date(entry.postedAt).toLocaleString() : '—'}</p>
          </div>
        </div>

        <div>
          <p className="text-xs text-muted-foreground">Description</p>
          <p>{entry.description}</p>
        </div>

        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/50 text-left">
              <tr>
                <th className="px-3 py-2 font-medium">Account</th>
                <th className="px-3 py-2 font-medium">Description</th>
                <th className="px-3 py-2 text-right font-medium">Debit</th>
                <th className="px-3 py-2 text-right font-medium">Credit</th>
              </tr>
            </thead>
            <tbody>
              {entry.lines.map((line) => (
                <tr key={line.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2">
                    <span className="font-mono text-xs">{line.account.code}</span>{' '}
                    {line.account.name}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{line.description ?? '—'}</td>
                  <td className="px-3 py-2 text-right">
                    {line.debit > 0 ? formatCurrency(line.debit, 'NGN') : ''}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {line.credit > 0 ? formatCurrency(line.credit, 'NGN') : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {voidMutation.isError && (
          <p className="text-sm text-destructive">
            {voidMutation.error instanceof ApiError
              ? voidMutation.error.message
              : 'Failed to void journal entry.'}
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
      </DialogFooter>
    </Dialog>
  );
}
