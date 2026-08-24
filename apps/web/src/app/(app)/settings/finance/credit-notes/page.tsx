'use client';

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Input, Select } from '@zentuva/ui';

import { FinanceTabs } from '@/components/app/finance-tabs';
import { ApiError } from '@/lib/api-client';
import { formatCurrency } from '@/lib/format-currency';

import { listCreditNotes, type CreditNote, type CreditNoteStatus } from '../api';
import { CREDIT_NOTE_STATUS_LABELS, CREDIT_NOTE_STATUS_VARIANT } from '../labels';
import { CreditNoteDetailDialog } from './credit-note-detail-dialog';

/** Credit Note list (Sprint 6, docs/domains/finance.md) — the financial consequence of
 *  a customer return or commercial adjustment; the physical return itself belongs to
 *  Sales/Logistics/Inventory. New credit notes are created from the Invoice detail
 *  dialog's combined create+issue flow; this list is for reviewing/voiding existing ones. */
export default function CreditNotesPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'' | CreditNoteStatus>('');
  const [selected, setSelected] = useState<CreditNote | null>(null);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['credit-notes'],
    queryFn: () => listCreditNotes(),
  });
  const creditNotes = useMemo(() => data?.items ?? [], [data]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return creditNotes.filter((creditNote) => {
      if (statusFilter && creditNote.status !== statusFilter) return false;
      if (!query) return true;
      return (
        creditNote.creditNoteCode.toLowerCase().includes(query) ||
        creditNote.customer.customerName.toLowerCase().includes(query)
      );
    });
  }, [creditNotes, search, statusFilter]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['credit-notes'] });

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Finance</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every credit note issued against an invoice, across every customer.
        </p>
      </div>

      <FinanceTabs />

      {isLoading && (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading credit notes…</p>
      )}
      {isError && (
        <p className="py-10 text-center text-sm text-destructive">
          {error instanceof ApiError ? error.message : 'Failed to load credit notes.'}
        </p>
      )}

      {!isLoading && !isError && creditNotes.length === 0 && (
        <p className="py-10 text-center text-sm text-muted-foreground">No credit notes yet.</p>
      )}

      {!isLoading && !isError && creditNotes.length > 0 && (
        <>
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Input
              placeholder="Search by credit note code or customer…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="max-w-sm"
            />
            <Select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
              className="max-w-[12rem]"
            >
              <option value="">All statuses</option>
              {Object.entries(CREDIT_NOTE_STATUS_LABELS).map(([value, label]) => (
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
                  <th className="px-4 py-3 font-medium">Code</th>
                  <th className="px-4 py-3 font-medium">Customer</th>
                  <th className="px-4 py-3 font-medium">Invoice</th>
                  <th className="px-4 py-3 font-medium">Amount</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((creditNote) => (
                  <tr
                    key={creditNote.id}
                    className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/30"
                    onClick={() => setSelected(creditNote)}
                  >
                    <td className="px-4 py-3 font-mono text-xs font-medium">
                      {creditNote.creditNoteCode}
                    </td>
                    <td className="px-4 py-3">{creditNote.customer.customerName}</td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      {creditNote.invoice?.invoiceCode ?? '—'}
                    </td>
                    <td className="px-4 py-3">
                      {formatCurrency(creditNote.amount, creditNote.currency)}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={CREDIT_NOTE_STATUS_VARIANT[creditNote.status]}>
                        {CREDIT_NOTE_STATUS_LABELS[creditNote.status]}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-2 md:hidden">
            {filtered.map((creditNote) => (
              <button
                key={creditNote.id}
                type="button"
                onClick={() => setSelected(creditNote)}
                className="w-full rounded-lg border border-border p-3 text-left"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-medium">{creditNote.creditNoteCode}</span>
                  <Badge variant={CREDIT_NOTE_STATUS_VARIANT[creditNote.status]}>
                    {CREDIT_NOTE_STATUS_LABELS[creditNote.status]}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {creditNote.customer.customerName} ·{' '}
                  {formatCurrency(creditNote.amount, creditNote.currency)}
                </p>
              </button>
            ))}
          </div>
        </>
      )}

      {selected && (
        <CreditNoteDetailDialog
          creditNote={selected}
          onOpenChange={() => setSelected(null)}
          onChanged={() => {
            invalidate();
            setSelected(null);
          }}
        />
      )}
    </main>
  );
}
