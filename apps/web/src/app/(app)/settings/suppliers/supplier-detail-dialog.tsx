'use client';

import { useQuery } from '@tanstack/react-query';
import { Badge, Button, Dialog, DialogFooter, DialogHeader, DialogTitle } from '@zentuva/ui';

import { formatCurrency } from '@/lib/format-currency';
import { getSupplierFinancialSummary } from '../finance/api';
import { CATEGORY_LABELS, STATUS_VARIANT } from './labels';
import type { Supplier } from './api';

/**
 * Read-only Supplier detail view (Sprint 12, docs/domains/finance.md "Accounts
 * Payable" §12) — identity fields plus a Finance-owned Accounts Payable summary,
 * fetched from Finance's own read model (`GET /finance/accounts-payable/suppliers/
 * :id`) rather than Suppliers reaching into Finance's tables — same one-way, read-only
 * coupling every other cross-domain summary in this codebase uses. Opened from a row
 * click on the Suppliers list; "Edit" stays a separate, explicit action.
 */
export function SupplierDetailDialog({
  supplier,
  onOpenChange,
  onEdit,
}: {
  supplier: Supplier;
  onOpenChange: (open: boolean) => void;
  onEdit: () => void;
}) {
  const { data: summary, isLoading } = useQuery({
    queryKey: ['supplier-financial-summary', supplier.id],
    queryFn: () => getSupplierFinancialSummary(supplier.id),
  });

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          {supplier.supplierName}
          <Badge variant={STATUS_VARIANT[supplier.status]}>{supplier.status}</Badge>
        </DialogTitle>
      </DialogHeader>
      <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1 text-sm">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-muted-foreground">Supplier Code</p>
            <p className="font-mono text-xs">{supplier.supplierCode}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Category</p>
            <p>{CATEGORY_LABELS[supplier.supplierCategory]}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Contact Person</p>
            <p>{supplier.contactPerson ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Phone</p>
            <p>{supplier.phoneNumber ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Email</p>
            <p>{supplier.email ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Location</p>
            <p>
              {[supplier.city, supplier.state, supplier.country].filter(Boolean).join(', ') || '—'}
            </p>
          </div>
        </div>

        <div className="rounded-md border border-dashed border-border p-3">
          <p className="mb-2 text-xs font-medium text-muted-foreground">
            Accounts Payable — Financial Summary
          </p>
          {isLoading && <p className="text-xs text-muted-foreground">Loading…</p>}
          {summary && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-muted-foreground">Total Invoiced</p>
                  <p className="font-medium text-foreground">
                    {formatCurrency(summary.totalInvoiced, 'NGN')}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Total Paid</p>
                  <p className="font-medium text-foreground">
                    {formatCurrency(summary.totalPaid, 'NGN')}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Total Credited</p>
                  <p className="font-medium text-foreground">
                    {formatCurrency(summary.totalCredited, 'NGN')}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Outstanding Payable</p>
                  <p className="font-semibold text-foreground">
                    {formatCurrency(summary.totalOutstanding, 'NGN')}
                  </p>
                </div>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                {summary.recentInvoiceCount} invoice{summary.recentInvoiceCount === 1 ? '' : 's'} ·{' '}
                {summary.recentPaymentCount} payment{summary.recentPaymentCount === 1 ? '' : 's'}{' '}
                recorded
              </p>
            </>
          )}
        </div>

        {supplier.notes && (
          <div>
            <p className="text-xs text-muted-foreground">Notes</p>
            <p className="whitespace-pre-wrap">{supplier.notes}</p>
          </div>
        )}
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
          Close
        </Button>
        <Button type="button" onClick={onEdit}>
          Edit Supplier
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
