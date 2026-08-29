'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Textarea,
} from '@zentuva/ui';

import { ApiError } from '@/lib/api-client';
import { formatCurrency } from '@/lib/format-currency';

import {
  acknowledgeSupplierInvoiceDiscrepancy,
  getSupplierInvoice,
  listSupplierCreditNotes,
  listSupplierPayments,
  postSupplierInvoice,
  voidSupplierInvoice,
} from '../api';
import {
  PAYMENT_METHOD_LABELS,
  PAYMENT_TERM_LABELS,
  SUPPLIER_INVOICE_MATCH_STATUS_LABELS,
  SUPPLIER_INVOICE_MATCH_STATUS_VARIANT,
  SUPPLIER_INVOICE_STATUS_LABELS,
  SUPPLIER_INVOICE_STATUS_VARIANT,
} from '../labels';
import { SupplierCreditNoteDialog } from './supplier-credit-note-dialog';
import { SupplierPaymentDialog } from './supplier-payment-dialog';

/**
 * Read-only Supplier Invoice detail view + lifecycle actions (Sprint 12, docs/domains/
 * finance.md "Accounts Payable"). Nested-dialog composition — "Record Payment"/"Issue
 * Credit Note" each open a separate dialog — mirrors `InvoiceDetailDialog` exactly.
 * `Post` is the one-way transition that computes and freezes the match result shown
 * here (Ordered/Recognized/Variance per line, Matched/Discrepancy badge) — nothing
 * before that point is authoritative.
 */
export function SupplierInvoiceDetailDialog({
  supplierInvoiceId,
  onOpenChange,
  onChanged,
}: {
  supplierInvoiceId: string;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  const queryClient = useQueryClient();
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [creditNoteOpen, setCreditNoteOpen] = useState(false);
  const [acknowledgeNotes, setAcknowledgeNotes] = useState('');
  const [acknowledging, setAcknowledging] = useState(false);
  const [postIdempotencyKey] = useState(() => crypto.randomUUID());

  const { data: invoice, isLoading } = useQuery({
    queryKey: ['supplier-invoice', supplierInvoiceId],
    queryFn: () => getSupplierInvoice(supplierInvoiceId),
  });
  const { data: paymentsData } = useQuery({
    queryKey: ['supplier-invoice-payments', supplierInvoiceId],
    queryFn: () => listSupplierPayments({ supplierInvoiceId }),
  });
  const { data: creditNotesData } = useQuery({
    queryKey: ['supplier-invoice-credit-notes', supplierInvoiceId],
    queryFn: () => listSupplierCreditNotes({ supplierInvoiceId }),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['supplier-invoice', supplierInvoiceId] });
    queryClient.invalidateQueries({ queryKey: ['supplier-invoice-payments', supplierInvoiceId] });
    queryClient.invalidateQueries({
      queryKey: ['supplier-invoice-credit-notes', supplierInvoiceId],
    });
    onChanged();
  };

  const postMutation = useMutation({
    mutationFn: () => postSupplierInvoice(supplierInvoiceId, postIdempotencyKey),
    onSuccess: invalidate,
  });
  const voidMutation = useMutation({
    mutationFn: () => voidSupplierInvoice(supplierInvoiceId),
    onSuccess: invalidate,
  });
  const acknowledgeMutation = useMutation({
    mutationFn: () =>
      acknowledgeSupplierInvoiceDiscrepancy(supplierInvoiceId, acknowledgeNotes || undefined),
    onSuccess: () => {
      invalidate();
      setAcknowledging(false);
      setAcknowledgeNotes('');
    },
  });

  if (isLoading || !invoice) {
    return (
      <Dialog open onOpenChange={onOpenChange}>
        <DialogHeader>
          <DialogTitle>Supplier Invoice</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">Loading…</p>
      </Dialog>
    );
  }

  const canPost = invoice.status === 'DRAFT';
  const canVoid =
    invoice.status === 'DRAFT' || invoice.status === 'POSTED' || invoice.status === 'OVERDUE';
  const canPay =
    invoice.status === 'POSTED' ||
    invoice.status === 'PARTIALLY_PAID' ||
    invoice.status === 'OVERDUE';
  const canCredit = canPay;
  const canAcknowledge = invoice.matchStatus === 'DISCREPANCY' && !invoice.discrepancyResolvedAt;

  return (
    <>
      <Dialog open onOpenChange={onOpenChange}>
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {invoice.invoiceNumber}
            <Badge variant={SUPPLIER_INVOICE_STATUS_VARIANT[invoice.status]}>
              {SUPPLIER_INVOICE_STATUS_LABELS[invoice.status]}
            </Badge>
            {invoice.matchStatus && (
              <Badge variant={SUPPLIER_INVOICE_MATCH_STATUS_VARIANT[invoice.matchStatus]}>
                {SUPPLIER_INVOICE_MATCH_STATUS_LABELS[invoice.matchStatus]}
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>
        <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1 text-sm">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-muted-foreground">Supplier</p>
              <p>{invoice.supplier.supplierName}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Purchase Order</p>
              <p className="font-mono text-xs">
                {invoice.purchaseOrder?.purchaseOrderNumber ?? '—'}
              </p>
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
                  <th className="px-3 py-2 font-medium">Line</th>
                  <th className="px-3 py-2 font-medium">Path</th>
                  <th className="px-3 py-2 font-medium">Qty</th>
                  <th className="px-3 py-2 font-medium">Unit Price</th>
                  <th className="px-3 py-2 font-medium">Invoiced</th>
                  <th className="px-3 py-2 font-medium">Recognized</th>
                  <th className="px-3 py-2 font-medium">Variance</th>
                </tr>
              </thead>
              <tbody>
                {invoice.items.map((item) => (
                  <tr key={item.id} className="border-b border-border last:border-0">
                    <td className="px-3 py-2">{item.description ?? item.product?.name ?? '—'}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {item.goodsReceiptItemId
                        ? 'Goods Receipt'
                        : (item.debitAccount?.name ?? 'Debit Account')}
                    </td>
                    <td className="px-3 py-2">{item.quantity}</td>
                    <td className="px-3 py-2">
                      {formatCurrency(item.unitPrice, invoice.currency)}
                    </td>
                    <td className="px-3 py-2">
                      {formatCurrency(item.lineTotal, invoice.currency)}
                    </td>
                    <td className="px-3 py-2">
                      {invoice.status === 'DRAFT'
                        ? '—'
                        : formatCurrency(item.recognizedAmount, invoice.currency)}
                    </td>
                    <td className="px-3 py-2">
                      {item.varianceAmount > 0 ? (
                        <span className="font-medium text-destructive">
                          {formatCurrency(item.varianceAmount, invoice.currency)}
                        </span>
                      ) : (
                        '—'
                      )}
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
                      <span className="font-medium text-foreground">
                        {formatCurrency(creditNote.amount, invoice.currency)}
                      </span>
                    </div>
                    <p className="mt-1">{creditNote.reason}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {invoice.matchStatus === 'DISCREPANCY' && (
            <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs">
              <p className="font-medium text-foreground">
                This invoice claims more than what&apos;s still payable against the linked Goods
                Receipt(s) — the difference above is never added to Accounts Payable.
              </p>
              {invoice.discrepancyResolvedAt ? (
                <p className="mt-1 text-muted-foreground">
                  Acknowledged {new Date(invoice.discrepancyResolvedAt).toLocaleDateString()}
                  {invoice.discrepancyResolutionNotes
                    ? ` — ${invoice.discrepancyResolutionNotes}`
                    : ''}
                </p>
              ) : (
                canAcknowledge &&
                (acknowledging ? (
                  <div className="mt-2 space-y-2">
                    <Textarea
                      rows={2}
                      placeholder="Resolution notes (optional)"
                      value={acknowledgeNotes}
                      onChange={(event) => setAcknowledgeNotes(event.target.value)}
                    />
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => acknowledgeMutation.mutate()}
                        disabled={acknowledgeMutation.isPending}
                      >
                        {acknowledgeMutation.isPending ? 'Saving…' : 'Confirm Acknowledgement'}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setAcknowledging(false)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-2"
                    onClick={() => setAcknowledging(true)}
                  >
                    Acknowledge Discrepancy
                  </Button>
                ))
              )}
            </div>
          )}

          <div className="rounded-md border border-dashed border-border p-3">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Subtotal</span>
              <span>{formatCurrency(invoice.subtotal, invoice.currency)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Tax</span>
              <span>{formatCurrency(invoice.taxAmount, invoice.currency)}</span>
            </div>
            <div className="flex justify-between font-semibold">
              <span>Total Billed</span>
              <span>{formatCurrency(invoice.total, invoice.currency)}</span>
            </div>
            {invoice.status !== 'DRAFT' && (
              <div className="mt-2 flex justify-between border-t border-border pt-2">
                <span className="text-muted-foreground">Recognized (Payable)</span>
                <span>{formatCurrency(invoice.recognizedAmount, invoice.currency)}</span>
              </div>
            )}
            <div className="flex justify-between">
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

          {(postMutation.isError || voidMutation.isError || acknowledgeMutation.isError) && (
            <p className="text-sm text-destructive">
              {[postMutation, voidMutation, acknowledgeMutation]
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
          {canPost && (
            <Button
              type="button"
              onClick={() => postMutation.mutate()}
              disabled={postMutation.isPending}
            >
              {postMutation.isPending ? 'Posting…' : 'Post Invoice'}
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
        <SupplierPaymentDialog
          invoice={invoice}
          onOpenChange={setPaymentOpen}
          onRecorded={() => {
            invalidate();
            setPaymentOpen(false);
          }}
        />
      )}
      {creditNoteOpen && (
        <SupplierCreditNoteDialog
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
