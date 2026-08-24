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
  createInvoice,
  listEligibleSalesOrders,
  type EligibleSalesOrder,
  type PaymentTermType,
} from '../api';
import { PAYMENT_TERM_LABELS } from '../labels';

function toDateInputValue(value: string): string {
  return value.slice(0, 10);
}

/**
 * "Create Invoice" dialog (Sprint 6, docs/domains/finance.md) — a two-step flow: search
 * and pick an eligible (`FULFILLED`, not yet invoiced) Sales Order, then the invoice
 * form itself. One step shorter than Distribution's `DispatchDialog` (which needs a
 * second "pick a fulfilment" step) because an Invoice attaches directly to a Sales
 * Order, with no intermediate child record to choose. Server-authoritative totals are
 * recomputed live client-side purely for display — never trusted on submit.
 */
export function InvoiceDialog({
  onOpenChange,
  onCreated,
}: {
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [orderSearch, setOrderSearch] = useState('');
  const [selectedOrder, setSelectedOrder] = useState<EligibleSalesOrder | null>(null);
  const [invoiceDate, setInvoiceDate] = useState(() => toDateInputValue(new Date().toISOString()));
  const [paymentTerms, setPaymentTerms] = useState<PaymentTermType>('DUE_ON_RECEIPT');
  const [notes, setNotes] = useState('');
  const [taxRates, setTaxRates] = useState<Record<string, number | ''>>({});
  const [discounts, setDiscounts] = useState<Record<string, number>>({});

  const { data: eligibleData, isLoading: eligibleLoading } = useQuery({
    queryKey: ['eligible-sales-orders'],
    queryFn: () => listEligibleSalesOrders(),
    enabled: !selectedOrder,
  });
  const filteredOrders = useMemo(() => {
    const query = orderSearch.trim().toLowerCase();
    const orders = eligibleData?.items ?? [];
    if (!query) return orders;
    return orders.filter(
      (order) =>
        order.orderCode.toLowerCase().includes(query) ||
        order.customer.customerName.toLowerCase().includes(query),
    );
  }, [eligibleData, orderSearch]);

  const previewTotals = useMemo(() => {
    if (!selectedOrder) return { subtotal: 0, taxAmount: 0, total: 0 };
    let subtotal = 0;
    let taxAmount = 0;
    for (const item of selectedOrder.items) {
      const discount = discounts[item.id] ?? 0;
      const rate = taxRates[item.id] ?? 7.5;
      const lineSubtotal = item.quantity * item.unitPrice - discount;
      subtotal += item.quantity * item.unitPrice - discount;
      taxAmount += (lineSubtotal * (typeof rate === 'number' ? rate : 0)) / 100;
    }
    return { subtotal, taxAmount, total: subtotal + taxAmount };
  }, [selectedOrder, discounts, taxRates]);

  const mutation = useMutation({
    mutationFn: () => {
      const items = selectedOrder!.items.map((item) => ({
        salesOrderItemId: item.id,
        discount: discounts[item.id] || undefined,
        taxRate: taxRates[item.id] === '' ? undefined : (taxRates[item.id] as number | undefined),
      }));
      return createInvoice({
        salesOrderId: selectedOrder!.id,
        invoiceDate,
        paymentTerms,
        notes: notes || undefined,
        idempotencyKey,
        items,
      });
    },
    onSuccess: onCreated,
  });

  if (!selectedOrder) {
    return (
      <Dialog open onOpenChange={onOpenChange}>
        <DialogHeader>
          <DialogTitle>Create Invoice</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Label>Select a fulfilled Sales Order to invoice</Label>
          <Input
            placeholder="Search by order code or customer…"
            value={orderSearch}
            onChange={(event) => setOrderSearch(event.target.value)}
          />
          <div className="max-h-64 space-y-1 overflow-y-auto">
            {eligibleLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
            {!eligibleLoading && filteredOrders.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No fulfilled, not-yet-invoiced sales orders match your search.
              </p>
            )}
            {filteredOrders.map((order) => (
              <button
                key={order.id}
                type="button"
                onClick={() => setSelectedOrder(order)}
                className="w-full rounded-md border border-border p-2 text-left text-sm hover:bg-muted/50"
              >
                <span className="font-mono text-xs font-medium">{order.orderCode}</span>
                <span className="ml-2 text-muted-foreground">{order.customer.customerName}</span>
                <span className="float-right">{formatCurrency(order.total, 'NGN')}</span>
              </button>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </DialogFooter>
      </Dialog>
    );
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>Create Invoice — {selectedOrder.orderCode}</DialogTitle>
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
            <Label>Invoice Date</Label>
            <Input
              type="date"
              value={invoiceDate}
              onChange={(event) => setInvoiceDate(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Payment Terms</Label>
            <Select
              value={paymentTerms}
              onChange={(event) => setPaymentTerms(event.target.value as PaymentTermType)}
            >
              {Object.entries(PAYMENT_TERM_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Notes (optional)</Label>
          <Textarea rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} />
        </div>

        <div className="space-y-3">
          <Label>Invoice Lines</Label>
          {selectedOrder.items.map((item) => (
            <div key={item.id} className="space-y-2 rounded-md border border-border p-3">
              <div className="flex items-center justify-between">
                <div className="font-medium text-foreground">
                  {item.product.name}{' '}
                  <span className="text-xs text-muted-foreground">
                    ({item.quantity} {item.product.unit} × {formatCurrency(item.unitPrice, 'NGN')})
                  </span>
                </div>
                <div className="text-sm font-medium">{formatCurrency(item.lineTotal, 'NGN')}</div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Discount</Label>
                  <Input
                    type="number"
                    step="any"
                    min="0"
                    value={discounts[item.id] ?? ''}
                    onChange={(event) =>
                      setDiscounts((prev) => ({
                        ...prev,
                        [item.id]: Number(event.target.value) || 0,
                      }))
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Tax Rate % (default 7.5)</Label>
                  <Input
                    type="number"
                    step="any"
                    min="0"
                    max="100"
                    placeholder="7.5"
                    value={taxRates[item.id] ?? ''}
                    onChange={(event) =>
                      setTaxRates((prev) => ({
                        ...prev,
                        [item.id]: event.target.value === '' ? '' : Number(event.target.value),
                      }))
                    }
                  />
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="rounded-md border border-dashed border-border p-3 text-sm">
          <p className="text-xs text-muted-foreground">
            Preview only — the server recalculates every total authoritatively when you save.
          </p>
          <div className="mt-2 flex justify-between">
            <span className="text-muted-foreground">Subtotal</span>
            <span>{formatCurrency(previewTotals.subtotal, 'NGN')}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Tax</span>
            <span>{formatCurrency(previewTotals.taxAmount, 'NGN')}</span>
          </div>
          <div className="flex justify-between font-semibold">
            <span>Total</span>
            <span>{formatCurrency(previewTotals.total, 'NGN')}</span>
          </div>
        </div>

        {mutation.isError && (
          <p className="text-sm text-destructive">
            {mutation.error instanceof ApiError
              ? mutation.error.message
              : 'Failed to create invoice.'}
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setSelectedOrder(null)}>
            Back
          </Button>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? 'Creating…' : 'Create Invoice'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
