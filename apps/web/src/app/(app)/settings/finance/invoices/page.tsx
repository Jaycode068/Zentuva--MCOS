'use client';

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Input, Select } from '@zentuva/ui';

import { FinanceTabs } from '@/components/app/finance-tabs';
import { BanknoteIcon } from '@/components/workspace/icons';
import { ApiError } from '@/lib/api-client';
import { formatCurrency } from '@/lib/format-currency';

import { listInvoices, type Invoice, type InvoiceStatus } from '../api';
import { INVOICE_STATUS_LABELS, INVOICE_STATUS_VARIANT } from '../labels';
import { InvoiceDetailDialog } from './invoice-detail-dialog';
import { InvoiceDialog } from './invoice-dialog';

export default function InvoicesPage() {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'' | InvoiceStatus>('');

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['invoices'],
    queryFn: () => listInvoices(),
  });

  const invoices = useMemo(() => data?.items ?? [], [data]);
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return invoices.filter((invoice) => {
      if (statusFilter && invoice.status !== statusFilter) return false;
      if (!query) return true;
      return (
        invoice.invoiceCode.toLowerCase().includes(query) ||
        invoice.customer.customerName.toLowerCase().includes(query)
      );
    });
  }, [invoices, search, statusFilter]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['invoices'] });

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Finance</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Invoices raised against fulfilled Sales Orders. Creating or confirming an order never
            creates an invoice automatically.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>Create Invoice</Button>
      </div>

      <FinanceTabs />

      {isLoading && (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading invoices…</p>
      )}
      {isError && (
        <p className="py-10 text-center text-sm text-destructive">
          {error instanceof ApiError ? error.message : 'Failed to load invoices.'}
        </p>
      )}

      {!isLoading && !isError && invoices.length === 0 && (
        <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed border-border px-6 py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <BanknoteIcon className="h-6 w-6" />
          </div>
          <h2 className="text-base font-semibold text-foreground">No invoices yet</h2>
          <Button onClick={() => setCreateOpen(true)}>Create Your First Invoice</Button>
        </div>
      )}

      {!isLoading && !isError && invoices.length > 0 && (
        <>
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Input
              placeholder="Search by invoice code or customer…"
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
              {Object.entries(INVOICE_STATUS_LABELS).map(([value, label]) => (
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
                  <th className="px-4 py-3 font-medium">Invoice Code</th>
                  <th className="px-4 py-3 font-medium">Customer</th>
                  <th className="px-4 py-3 font-medium">Total</th>
                  <th className="px-4 py-3 font-medium">Outstanding</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((invoice) => (
                  <InvoiceRow
                    key={invoice.id}
                    invoice={invoice}
                    onSelect={() => setSelectedInvoiceId(invoice.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-2 md:hidden">
            {filtered.map((invoice) => (
              <button
                key={invoice.id}
                type="button"
                onClick={() => setSelectedInvoiceId(invoice.id)}
                className="w-full rounded-lg border border-border p-3 text-left"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-medium">{invoice.invoiceCode}</span>
                  <Badge variant={INVOICE_STATUS_VARIANT[invoice.status]}>
                    {INVOICE_STATUS_LABELS[invoice.status]}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {invoice.customer.customerName} ·{' '}
                  {formatCurrency(invoice.total, invoice.currency)}
                </p>
              </button>
            ))}
          </div>
        </>
      )}

      {createOpen && (
        <InvoiceDialog onOpenChange={() => setCreateOpen(false)} onCreated={invalidate} />
      )}
      {selectedInvoiceId && (
        <InvoiceDetailDialog
          invoiceId={selectedInvoiceId}
          onOpenChange={() => setSelectedInvoiceId(null)}
          onChanged={invalidate}
        />
      )}
    </main>
  );
}

function InvoiceRow({ invoice, onSelect }: { invoice: Invoice; onSelect: () => void }) {
  return (
    <tr className="border-b border-border last:border-0">
      <td className="px-4 py-3">
        <button
          type="button"
          onClick={onSelect}
          className="font-mono text-xs font-medium text-foreground hover:underline"
        >
          {invoice.invoiceCode}
        </button>
      </td>
      <td className="px-4 py-3">{invoice.customer.customerName}</td>
      <td className="px-4 py-3">{formatCurrency(invoice.total, invoice.currency)}</td>
      <td className="px-4 py-3">{formatCurrency(invoice.amountOutstanding, invoice.currency)}</td>
      <td className="px-4 py-3">
        <Badge variant={INVOICE_STATUS_VARIANT[invoice.status]}>
          {INVOICE_STATUS_LABELS[invoice.status]}
        </Badge>
      </td>
      <td className="px-4 py-3 text-right">
        <Button variant="outline" size="sm" onClick={onSelect}>
          View
        </Button>
      </td>
    </tr>
  );
}
