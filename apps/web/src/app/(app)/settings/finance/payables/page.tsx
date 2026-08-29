'use client';

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Select,
} from '@zentuva/ui';

import { FinanceTabs } from '@/components/app/finance-tabs';
import { BanknoteIcon } from '@/components/workspace/icons';
import { ApiError } from '@/lib/api-client';
import { formatCurrency } from '@/lib/format-currency';

import {
  getApSummary,
  listSupplierInvoices,
  type SupplierInvoice,
  type SupplierInvoiceStatus,
} from '../api';
import {
  SUPPLIER_INVOICE_MATCH_STATUS_LABELS,
  SUPPLIER_INVOICE_MATCH_STATUS_VARIANT,
  SUPPLIER_INVOICE_STATUS_LABELS,
  SUPPLIER_INVOICE_STATUS_VARIANT,
} from '../labels';
import { SupplierInvoiceDetailDialog } from './supplier-invoice-detail-dialog';
import { SupplierInvoiceDialog } from './supplier-invoice-dialog';

/**
 * Accounts Payable overview (Sprint 12, docs/domains/finance.md "Accounts Payable") —
 * summary cards + the Supplier Invoice list, exact structural mirror of `invoices/
 * page.tsx` + `page.tsx`'s (Finance Overview) `SummaryCard` pattern. Every figure is
 * derived server-side from `SupplierInvoice`/`SupplierPayment` rows, never a cached
 * balance.
 */
export default function PayablesPage() {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'' | SupplierInvoiceStatus>('');

  const { data: summary } = useQuery({
    queryKey: ['ap-summary'],
    queryFn: () => getApSummary(),
  });

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['supplier-invoices'],
    queryFn: () => listSupplierInvoices(),
  });

  const invoices = useMemo(() => data?.items ?? [], [data]);
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return invoices.filter((invoice) => {
      if (statusFilter && invoice.status !== statusFilter) return false;
      if (!query) return true;
      return (
        invoice.invoiceNumber.toLowerCase().includes(query) ||
        invoice.supplier.supplierName.toLowerCase().includes(query)
      );
    });
  }, [invoices, search, statusFilter]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['supplier-invoices'] });
    queryClient.invalidateQueries({ queryKey: ['ap-summary'] });
    queryClient.invalidateQueries({ queryKey: ['ap-by-supplier'] });
  };

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Finance</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            What every supplier bills, what&apos;s actually owed, and what&apos;s been paid —
            reconciled against what Procurement and Inventory already recorded.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>Create Supplier Invoice</Button>
      </div>

      <FinanceTabs />

      {summary && (
        <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <SummaryCard
            title="Total Outstanding"
            value={formatCurrency(summary.totalOutstanding, 'NGN')}
          />
          <SummaryCard
            title="Overdue"
            value={formatCurrency(summary.totalOverdue, 'NGN')}
            destructive
          />
          <SummaryCard
            title="Partially Paid"
            value={formatCurrency(summary.totalPartiallyPaid, 'NGN')}
          />
          <SummaryCard
            title="Invoiced This Period"
            value={formatCurrency(summary.invoicedThisPeriod, 'NGN')}
          />
          <SummaryCard
            title="Payments Made"
            value={formatCurrency(summary.paymentsMadeThisPeriod, 'NGN')}
          />
        </div>
      )}

      {isLoading && (
        <p className="py-10 text-center text-sm text-muted-foreground">
          Loading supplier invoices…
        </p>
      )}
      {isError && (
        <p className="py-10 text-center text-sm text-destructive">
          {error instanceof ApiError ? error.message : 'Failed to load supplier invoices.'}
        </p>
      )}

      {!isLoading && !isError && invoices.length === 0 && (
        <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed border-border px-6 py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <BanknoteIcon className="h-6 w-6" />
          </div>
          <h2 className="text-base font-semibold text-foreground">No supplier invoices yet</h2>
          <Button onClick={() => setCreateOpen(true)}>Create Your First Supplier Invoice</Button>
        </div>
      )}

      {!isLoading && !isError && invoices.length > 0 && (
        <>
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Input
              placeholder="Search by invoice number or supplier…"
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
              {Object.entries(SUPPLIER_INVOICE_STATUS_LABELS).map(([value, label]) => (
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
                  <th className="px-4 py-3 font-medium">Invoice Number</th>
                  <th className="px-4 py-3 font-medium">Supplier</th>
                  <th className="px-4 py-3 font-medium">Total</th>
                  <th className="px-4 py-3 font-medium">Outstanding</th>
                  <th className="px-4 py-3 font-medium">Match</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((invoice) => (
                  <SupplierInvoiceRow
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
                  <span className="font-mono text-xs font-medium">{invoice.invoiceNumber}</span>
                  <Badge variant={SUPPLIER_INVOICE_STATUS_VARIANT[invoice.status]}>
                    {SUPPLIER_INVOICE_STATUS_LABELS[invoice.status]}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {invoice.supplier.supplierName} ·{' '}
                  {formatCurrency(invoice.total, invoice.currency)}
                </p>
              </button>
            ))}
          </div>
        </>
      )}

      {createOpen && (
        <SupplierInvoiceDialog onOpenChange={() => setCreateOpen(false)} onCreated={invalidate} />
      )}
      {selectedInvoiceId && (
        <SupplierInvoiceDetailDialog
          supplierInvoiceId={selectedInvoiceId}
          onOpenChange={() => setSelectedInvoiceId(null)}
          onChanged={invalidate}
        />
      )}
    </main>
  );
}

function SummaryCard({
  title,
  value,
  destructive,
}: {
  title: string;
  value: string;
  destructive?: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className={`text-2xl font-semibold ${destructive ? 'text-destructive' : ''}`}>{value}</p>
      </CardContent>
    </Card>
  );
}

function SupplierInvoiceRow({
  invoice,
  onSelect,
}: {
  invoice: SupplierInvoice;
  onSelect: () => void;
}) {
  return (
    <tr className="border-b border-border last:border-0">
      <td className="px-4 py-3">
        <button
          type="button"
          onClick={onSelect}
          className="font-mono text-xs font-medium text-foreground hover:underline"
        >
          {invoice.invoiceNumber}
        </button>
      </td>
      <td className="px-4 py-3">{invoice.supplier.supplierName}</td>
      <td className="px-4 py-3">{formatCurrency(invoice.total, invoice.currency)}</td>
      <td className="px-4 py-3">{formatCurrency(invoice.amountOutstanding, invoice.currency)}</td>
      <td className="px-4 py-3">
        {invoice.matchStatus ? (
          <Badge variant={SUPPLIER_INVOICE_MATCH_STATUS_VARIANT[invoice.matchStatus]}>
            {SUPPLIER_INVOICE_MATCH_STATUS_LABELS[invoice.matchStatus]}
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-4 py-3">
        <Badge variant={SUPPLIER_INVOICE_STATUS_VARIANT[invoice.status]}>
          {SUPPLIER_INVOICE_STATUS_LABELS[invoice.status]}
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
