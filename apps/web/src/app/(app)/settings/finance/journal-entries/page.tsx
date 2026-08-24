'use client';

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Select } from '@zentuva/ui';

import { FinanceTabs } from '@/components/app/finance-tabs';
import { ApiError } from '@/lib/api-client';
import { formatCurrency } from '@/lib/format-currency';

import { listJournalEntries, type JournalEntry, type JournalEntryStatus } from '../api';
import {
  JOURNAL_ENTRY_STATUS_LABELS,
  JOURNAL_ENTRY_STATUS_VARIANT,
  JOURNAL_SOURCE_TYPE_LABELS,
} from '../labels';
import { JournalEntryDetailDialog } from './journal-entry-detail-dialog';
import { JournalEntryDialog } from './journal-entry-dialog';

function lineTotal(entry: JournalEntry): number {
  return entry.lines.reduce((sum, line) => sum + line.debit, 0);
}

/** Journal Entries (Sprint 7, docs/domains/accounting.md) — manually-created entries
 *  and every automatic Finance posting (invoice issued, payment recorded, credit note
 *  issued) side by side, distinguished by `sourceType`. */
export default function JournalEntriesPage() {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'' | JournalEntryStatus>('');
  const [sourceFilter, setSourceFilter] = useState('');

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['journal-entries'],
    queryFn: () => listJournalEntries(),
  });
  const entries = useMemo(() => data?.items ?? [], [data]);

  const filtered = useMemo(
    () =>
      entries.filter((entry) => {
        if (statusFilter && entry.status !== statusFilter) return false;
        if (sourceFilter && (entry.sourceType ?? 'MANUAL') !== sourceFilter) return false;
        return true;
      }),
    [entries, statusFilter, sourceFilter],
  );

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['journal-entries'] });

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Finance</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every double-entry posting to the General Ledger — manual and automatic.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>Create Journal Entry</Button>
      </div>

      <FinanceTabs />

      {isLoading && (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading journal entries…</p>
      )}
      {isError && (
        <p className="py-10 text-center text-sm text-destructive">
          {error instanceof ApiError ? error.message : 'Failed to load journal entries.'}
        </p>
      )}

      {!isLoading && !isError && entries.length === 0 && (
        <p className="py-10 text-center text-sm text-muted-foreground">No journal entries yet.</p>
      )}

      {!isLoading && !isError && entries.length > 0 && (
        <>
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
              className="max-w-[10rem]"
            >
              <option value="">All statuses</option>
              {Object.entries(JOURNAL_ENTRY_STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
            <Select
              value={sourceFilter}
              onChange={(event) => setSourceFilter(event.target.value)}
              className="max-w-[10rem]"
            >
              <option value="">All sources</option>
              {Object.entries(JOURNAL_SOURCE_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </div>

          <div className="hidden overflow-x-auto rounded-lg border border-border md:block">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/50 text-left">
                <tr>
                  <th className="px-4 py-3 font-medium">Journal #</th>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Description</th>
                  <th className="px-4 py-3 font-medium">Source</th>
                  <th className="px-4 py-3 font-medium">Amount</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((entry) => (
                  <tr
                    key={entry.id}
                    className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/30"
                    onClick={() => setSelectedId(entry.id)}
                  >
                    <td className="px-4 py-3 font-mono text-xs font-medium">
                      {entry.journalNumber}
                    </td>
                    <td className="px-4 py-3">{new Date(entry.date).toLocaleDateString()}</td>
                    <td className="px-4 py-3">{entry.description}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {JOURNAL_SOURCE_TYPE_LABELS[entry.sourceType ?? 'MANUAL'] ?? entry.sourceType}
                    </td>
                    <td className="px-4 py-3">{formatCurrency(lineTotal(entry), 'NGN')}</td>
                    <td className="px-4 py-3">
                      <Badge variant={JOURNAL_ENTRY_STATUS_VARIANT[entry.status]}>
                        {JOURNAL_ENTRY_STATUS_LABELS[entry.status]}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-2 md:hidden">
            {filtered.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => setSelectedId(entry.id)}
                className="w-full rounded-lg border border-border p-3 text-left"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-medium">{entry.journalNumber}</span>
                  <Badge variant={JOURNAL_ENTRY_STATUS_VARIANT[entry.status]}>
                    {JOURNAL_ENTRY_STATUS_LABELS[entry.status]}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{entry.description}</p>
                <p className="mt-1 text-sm">{formatCurrency(lineTotal(entry), 'NGN')}</p>
              </button>
            ))}
          </div>
        </>
      )}

      {createOpen && (
        <JournalEntryDialog
          onOpenChange={() => setCreateOpen(false)}
          onPosted={() => {
            invalidate();
            setCreateOpen(false);
          }}
        />
      )}
      {selectedId && (
        <JournalEntryDetailDialog
          journalEntryId={selectedId}
          onOpenChange={() => setSelectedId(null)}
          onChanged={() => {
            invalidate();
            setSelectedId(null);
          }}
        />
      )}
    </main>
  );
}
