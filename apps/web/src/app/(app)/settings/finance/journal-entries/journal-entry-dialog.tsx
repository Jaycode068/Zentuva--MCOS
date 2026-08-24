'use client';

import { useMemo, useState } from 'react';
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

import {
  createJournalEntry,
  listChartOfAccounts,
  postJournalEntry,
  type ChartOfAccount,
} from '../api';

interface LineDraft {
  accountId: string;
  description: string;
  debit: string;
  credit: string;
}

function emptyLine(): LineDraft {
  return { accountId: '', description: '', debit: '', credit: '' };
}

function toDateInputValue(value: string): string {
  return value.slice(0, 10);
}

/**
 * "Create Journal Entry" dialog (Sprint 7, docs/domains/accounting.md). Creates a
 * `DRAFT` entry and immediately posts it in one user action (two server calls) —
 * the same combined create-then-apply pattern Sprint 6's `CreditNoteDialog`
 * established for "create a DRAFT credit note and immediately issue it." The Post
 * button only enables once the client-side totals match; the server re-validates
 * balance authoritatively regardless on both calls.
 */
export function JournalEntryDialog({
  onOpenChange,
  onPosted,
}: {
  onOpenChange: (open: boolean) => void;
  onPosted: () => void;
}) {
  const [date, setDate] = useState(() => toDateInputValue(new Date().toISOString()));
  const [description, setDescription] = useState('');
  const [reference, setReference] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([emptyLine(), emptyLine()]);

  const { data: accountsData } = useQuery({
    queryKey: ['chart-of-accounts', 'active'],
    queryFn: () => listChartOfAccounts({ isActive: true }),
  });
  const accounts = accountsData?.items ?? [];

  const totals = useMemo(() => {
    const totalDebit = lines.reduce((sum, line) => sum + (Number(line.debit) || 0), 0);
    const totalCredit = lines.reduce((sum, line) => sum + (Number(line.credit) || 0), 0);
    return {
      totalDebit,
      totalCredit,
      difference: Math.round((totalDebit - totalCredit) * 100) / 100,
    };
  }, [lines]);

  const validLines = lines.filter(
    (line) => line.accountId && (Number(line.debit) > 0 || Number(line.credit) > 0),
  );
  const canSubmit =
    description.trim().length > 0 &&
    validLines.length >= 2 &&
    validLines.length === lines.length &&
    totals.difference === 0 &&
    totals.totalDebit > 0;

  const mutation = useMutation({
    mutationFn: async () => {
      const created = await createJournalEntry({
        date,
        description,
        reference: reference || undefined,
        lines: lines.map((line) => ({
          accountId: line.accountId,
          description: line.description || undefined,
          debit: Number(line.debit) || undefined,
          credit: Number(line.credit) || undefined,
        })),
      });
      return postJournalEntry(created.id);
    },
    onSuccess: onPosted,
  });

  const updateLine = (index: number, patch: Partial<LineDraft>) => {
    setLines((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>Create Journal Entry</DialogTitle>
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
            <Label>Date</Label>
            <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Reference (optional)</Label>
            <Input value={reference} onChange={(event) => setReference(event.target.value)} />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Description</Label>
          <Textarea
            rows={2}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="e.g. Bank interest received"
          />
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label>Lines</Label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setLines((prev) => [...prev, emptyLine()])}
            >
              Add Line
            </Button>
          </div>
          {lines.map((line, index) => (
            <div
              key={index}
              className="grid grid-cols-12 gap-2 rounded-md border border-border p-2"
            >
              <div className="col-span-5">
                <Select
                  value={line.accountId}
                  onChange={(event) => updateLine(index, { accountId: event.target.value })}
                >
                  <option value="">Select account…</option>
                  {accounts.map((account: ChartOfAccount) => (
                    <option key={account.id} value={account.id}>
                      {account.code} — {account.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="col-span-3">
                <Input
                  type="number"
                  step="any"
                  min="0"
                  placeholder="Debit"
                  value={line.debit}
                  onChange={(event) => updateLine(index, { debit: event.target.value, credit: '' })}
                />
              </div>
              <div className="col-span-3">
                <Input
                  type="number"
                  step="any"
                  min="0"
                  placeholder="Credit"
                  value={line.credit}
                  onChange={(event) => updateLine(index, { credit: event.target.value, debit: '' })}
                />
              </div>
              <div className="col-span-1 flex items-center justify-end">
                {lines.length > 2 && (
                  <button
                    type="button"
                    onClick={() => setLines((prev) => prev.filter((_, i) => i !== index))}
                    className="text-xs text-muted-foreground hover:text-destructive"
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="rounded-md border border-dashed border-border p-3 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Total Debit</span>
            <span>{formatCurrency(totals.totalDebit, 'NGN')}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Total Credit</span>
            <span>{formatCurrency(totals.totalCredit, 'NGN')}</span>
          </div>
          <div className="flex justify-between font-semibold">
            <span>Difference</span>
            <span className={totals.difference !== 0 ? 'text-destructive' : ''}>
              {formatCurrency(totals.difference, 'NGN')}
            </span>
          </div>
        </div>

        {mutation.isError && (
          <p className="text-sm text-destructive">
            {mutation.error instanceof ApiError
              ? mutation.error.message
              : 'Failed to post journal entry.'}
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={!canSubmit || mutation.isPending}>
            {mutation.isPending ? 'Posting…' : 'Post'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
