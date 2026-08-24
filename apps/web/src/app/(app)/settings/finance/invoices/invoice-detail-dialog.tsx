'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Dialog, DialogFooter, DialogHeader, DialogTitle } from '@zentuva/ui';

import { ApiError } from '@/lib/api-client';
import { formatCurrency } from '@/lib/format-currency';

import {
  getInvoice,
  issueInvoice,
  listInvoiceCreditNotes,
  listInvoicePayments,
  voidInvoice,
} from '../api';
import {
  CREDIT_NOTE_STATUS_LABELS,
  CREDIT_NOTE_STATUS_VARIANT,
  INVOICE_STATUS_LABELS,
  INVOICE_STATUS_VARIANT,
  PAYMENT_METHOD_LABELS,
  PAYMENT_TERM_LABELS,
} from '../labels';
import { CreditNoteDialog } from './credit-note-dialog';
import { PaymentDialog } from './payment-dialog';

/**
 * Read-only Invoice detail view + lifecycle actions (Sprint 6, docs/domains/finance.md).
 * Nested-dialog composition — "Record Payment"/"Issue Credit Note" each open a separate
 * dialog — mirrors `dispatch-detail-dialog.tsx` opening `DeliveryDialog`.
 */
export function InvoiceDetailDialog({
  invoiceId,
  onOpenChange,
  onChanged,
}: {
  invoiceId: string;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  const queryClient = useQueryClient();
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [creditNoteOpen, setCreditNoteOpen] = useState(false);

  const { data: invoice, isLoading } = useQuery({
    queryKey: ['invoice', invoiceId],
    queryFn: () => getInvoice(invoiceId),
  });
  const { data: paymentsData } = useQuery({
    queryKey: ['invoice-payments', invoiceId],
    queryFn: () => listInvoicePayments(invoiceId),
  });
  const { data: creditNotesData } = useQuery({
    queryKey: ['invoice-credit-notes', invoiceId],
    queryFn: () => listInvoiceCreditNotes(invoiceId),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['invoice', invoiceId] });
    queryClient.invalidateQueries({ queryKey: ['invoice-payments', invoiceId] });
    queryClient.invalidateQueries({ queryKey: ['invoice-credit-notes', invoiceId] });
    onChanged();
  };

  const issueMutation = useMutation({
    mutationFn: () => issueInvoice(invoiceId),
    onSuccess: invalidate,
  });
  const voidMutation = useMutation({
    mutationFn: () => voidInvoice(invoiceId),
    onSuccess: invalidate,
  });

  if (isLoading || !invoice) {
    return (
      <Dialog open onOpenChange={onOpenChange}>
        <DialogHeader>
          <DialogTitle>Invoice</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">Loading…</p>
      </Dialog>
    );
  }

  const canIssue = invoice.status === 'DRAFT';
  const canVoid = invoice.status === 'DRAFT' || invoice.status === 'ISSUED';
  const canPay =
    invoice.status === 'ISSUED' ||
    invoice.status === 'PARTIALLY_PAID' ||
    invoice.status === 'OVERDUE';
  const canCredit = canPay;

  return (
    <>
      <Dialog open onOpenChange={onOpenChange}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {invoice.invoiceCode}
            <Badge variant={INVOICE_STATUS_VARIANT[invoice.status]}>
              {INVOICE_STATUS_LABELS[invoice.status]}
            </Badge>
          </DialogTitle>
        </DialogHeader>
        <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1 text-sm">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-muted-foreground">Customer</p>
              <p>{invoice.customer.customerName}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Outlet</p>
              <p>{invoice.outlet?.name ?? '—'}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Sales Order</p>
              <p className="font-mono text-xs">{invoice.salesOrder?.orderCode ?? '—'}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Payment Terms</p>
              <p>{PAYMENT_TERM_LABELS[invoice.paymentTerms]}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Invoice Date</p>
              <p>{new Date(invoice.invoiceDate).toLocaleDateString()}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Due Date</p>
              <p>{new Date(invoice.dueDate).toLocaleDateString()}</p>
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/50 text-left">
                <tr>
                  <th className="px-3 py-2 font-medium">Product</th>
                  <th className="px-3 py-2 font-medium">Qty</th>
                  <th className="px-3 py-2 font-medium">Unit Price</th>
                  <th className="px-3 py-2 font-medium">Tax</th>
                  <th className="px-3 py-2 font-medium">Line Total</th>
                </tr>
              </thead>
              <tbody>
                {invoice.items.map((item) => (
                  <tr key={item.id} className="border-b border-border last:border-0">
                    <td className="px-3 py-2">{item.productName}</td>
                    <td className="px-3 py-2">{item.quantity}</td>
                    <td className="px-3 py-2">
                      {formatCurrency(item.unitPrice, invoice.currency)}
                    </td>
                    <td className="px-3 py-2">{item.taxRate}%</td>
                    <td className="px-3 py-2">
                      {formatCurrency(item.lineTotal, invoice.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {(paymentsData?.items.length ?? 0) > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Payment History</p>
              <div className="space-y-2">
                {paymentsData!.items.map((payment) => (
                  <div key={payment.id} className="rounded-md border border-border p-2 text-xs">
                    <div className="flex justify-between">
                      <span>
                        {new Date(payment.paymentDate).toLocaleDateString()} —{' '}
                        {PAYMENT_METHOD_LABELS[payment.method]}
                        {payment.reference ? ` (${payment.reference})` : ''}
                      </span>
                      <span className="font-medium text-foreground">
                        {formatCurrency(payment.amount, invoice.currency)}
                      </span>
                    </div>
                    {payment.status === 'VOIDED' && <p className="mt-1 text-destructive">Voided</p>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {(creditNotesData?.items.length ?? 0) > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Credit Notes</p>
              <div className="space-y-2">
                {creditNotesData!.items.map((creditNote) => (
                  <div key={creditNote.id} className="rounded-md border border-border p-2 text-xs">
                    <div className="flex justify-between">
                      <span className="font-mono">{creditNote.creditNoteCode}</span>
                      <Badge variant={CREDIT_NOTE_STATUS_VARIANT[creditNote.status]}>
                        {CREDIT_NOTE_STATUS_LABELS[creditNote.status]}
                      </Badge>
                    </div>
                    <p className="mt-1">{creditNote.reason}</p>
                    <p className="mt-1 font-medium text-foreground">
                      {formatCurrency(creditNote.amount, invoice.currency)}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="rounded-md border border-dashed border-border p-3">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Subtotal</span>
              <span>{formatCurrency(invoice.subtotal, invoice.currency)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Discount</span>
              <span>-{formatCurrency(invoice.discount, invoice.currency)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Tax</span>
              <span>{formatCurrency(invoice.taxAmount, invoice.currency)}</span>
            </div>
            <div className="flex justify-between font-semibold">
              <span>Total</span>
              <span>{formatCurrency(invoice.total, invoice.currency)}</span>
            </div>
            <div className="mt-2 flex justify-between border-t border-border pt-2">
              <span className="text-muted-foreground">Amount Paid</span>
              <span>{formatCurrency(invoice.amountPaid, invoice.currency)}</span>
            </div>
            {invoice.amountCredited > 0 && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Amount Credited</span>
                <span>{formatCurrency(invoice.amountCredited, invoice.currency)}</span>
              </div>
            )}
            <div className="flex justify-between font-semibold">
              <span>Outstanding</span>
              <span>{formatCurrency(invoice.amountOutstanding, invoice.currency)}</span>
            </div>
          </div>

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
              {voidMutation.isPending ? 'Voiding…' : 'Void Invoice'}
            </Button>
          )}
          {canIssue && (
            <Button
              type="button"
              onClick={() => issueMutation.mutate()}
              disabled={issueMutation.isPending}
            >
              {issueMutation.isPending ? 'Issuing…' : 'Issue Invoice'}
            </Button>
          )}
          {canCredit && (
            <Button type="button" variant="outline" onClick={() => setCreditNoteOpen(true)}>
              Issue Credit Note
            </Button>
          )}
          {canPay && (
            <Button type="button" onClick={() => setPaymentOpen(true)}>
              Record Payment
            </Button>
          )}
        </DialogFooter>
      </Dialog>

      {paymentOpen && (
        <PaymentDialog
          invoice={invoice}
          onOpenChange={setPaymentOpen}
          onRecorded={() => {
            invalidate();
            setPaymentOpen(false);
          }}
        />
      )}
      {creditNoteOpen && (
        <CreditNoteDialog
          invoice={invoice}
          onOpenChange={setCreditNoteOpen}
          onIssued={() => {
            invalidate();
            setCreditNoteOpen(false);
          }}
        />
      )}
    </>
  );
}
