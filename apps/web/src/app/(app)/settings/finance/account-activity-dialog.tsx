'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Dialog, DialogFooter, DialogHeader, DialogTitle } from '@zentuva/ui';

import { formatCurrency } from '@/lib/format-currency';

import { getAccountActivity } from './api';
import { JournalEntryDetailDialog } from './journal-entries/journal-entry-detail-dialog';

/**
 * Reusable Account Activity view (Sprint 13, docs/domains/accounting.md §16.2) —
 * Opening Balance → transactions → Closing Balance, derived entirely from posted
 * Journal Entries (`LedgerService.getAccountActivity`, unchanged since Sprint 7).
 * Opened by clicking any account code/name across the reporting surface (Trial
 * Balance, Balance Sheet, Profit & Loss, Chart of Accounts) — one dialog, reused
 * everywhere, rather than four bespoke ones. Each transaction row opens the
 * existing `JournalEntryDetailDialog`, completing the brief's own drill-down chain:
 * Statement → Account → Ledger Activity → Journal Entry Detail.
 */
export function AccountActivityDialog({
  accountId,
  from,
  to,
  onOpenChange,
}: {
  accountId: string;
  /** ISO date strings — same range the calling report is currently showing, so the
   *  Opening/Closing balance walkthrough matches what the user was just looking at. */
  from?: string;
  to?: string;
  onOpenChange: (open: boolean) => void;
}) {
  const [journalEntryId, setJournalEntryId] = useState<string | null>(null);

  const { data: activity, isLoading } = useQuery({
    queryKey: ['account-activity', accountId, from, to],
    queryFn: () => getAccountActivity(accountId, { from, to }),
  });

  if (isLoading || !activity) {
    return (
      <Dialog open onOpenChange={onOpenChange}>
        <DialogHeader>
          <DialogTitle>Account Activity</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">Loading…</p>
      </Dialog>
    );
  }

  return (
    <>
      <Dialog open onOpenChange={onOpenChange}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="font-mono text-xs">{activity.account.code}</span>
            {activity.account.name}
          </DialogTitle>
        </DialogHeader>
        <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1 text-sm">
          <div className="grid grid-cols-2 gap-4 rounded-md bg-muted/30 p-3">
            <div>
              <p className="text-xs text-muted-foreground">Opening Balance</p>
              <p className="font-medium text-foreground">
                {formatCurrency(activity.openingBalance, 'NGN')}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Closing Balance</p>
              <p className="font-medium text-foreground">
                {formatCurrency(activity.closingBalance, 'NGN')}
              </p>
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/50 text-left">
                <tr>
                  <th className="px-3 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium">Journal</th>
                  <th className="px-3 py-2 font-medium">Description</th>
                  <th className="px-3 py-2 text-right font-medium">Debit</th>
                  <th className="px-3 py-2 text-right font-medium">Credit</th>
                  <th className="px-3 py-2 text-right font-medium">Balance</th>
                </tr>
              </thead>
              <tbody>
                {activity.transactions.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                      No activity in this range.
                    </td>
                  </tr>
                )}
                {activity.transactions.map((line) => (
                  <tr key={line.id} className="border-b border-border last:border-0">
                    <td className="px-3 py-2">{new Date(line.date).toLocaleDateString()}</td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => setJournalEntryId(line.journalEntryId)}
                        className="font-mono text-xs text-foreground hover:underline"
                      >
                        {line.journalNumber}
                      </button>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{line.description ?? '—'}</td>
                    <td className="px-3 py-2 text-right">
                      {line.debit > 0 ? formatCurrency(line.debit, 'NGN') : ''}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {line.credit > 0 ? formatCurrency(line.credit, 'NGN') : ''}
                    </td>
                    <td className="px-3 py-2 text-right font-medium">
                      {formatCurrency(line.runningBalance, 'NGN')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </Dialog>

      {journalEntryId && (
        <JournalEntryDetailDialog
          journalEntryId={journalEntryId}
          onOpenChange={() => setJournalEntryId(null)}
          onChanged={() => {}}
        />
      )}
    </>
  );
}
