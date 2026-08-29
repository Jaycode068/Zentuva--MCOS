'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Badge,
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
import { listGoodsReceipts, type GoodsReceipt, type GoodsReceiptItem } from '../../inventory/api';
import { listSuppliers } from '../../suppliers/api';
import {
  createSupplierInvoice,
  listChartOfAccounts,
  type SupplierInvoiceItemInputPayload,
} from '../api';
import { PAYMENT_TERM_LABELS } from '../labels';
import type { PaymentTermType } from '../api';

function toDateInputValue(value: string): string {
  return value.slice(0, 10);
}

interface PathBLine {
  key: string;
  description: string;
  quantity: number;
  unitPrice: number;
  debitAccountId: string;
}

/** Every Path A line's remaining payable pool, computed the same way `computeLineMatch`
 *  does server-side (docs/domains/accounting.md "Supplier Invoice Matching") — display
 *  only, a starting default for the quantity input. The authoritative figure is always
 *  recomputed by `post()`; this never gets trusted as the source of truth. */
function remainingPayableQuantity(item: GoodsReceiptItem): number {
  return Math.max(
    0,
    item.payableQuantity -
      (item.returnedQuantity - item.returnedExcessQuantity) -
      item.invoicedQuantity,
  );
}

/**
 * "Create Supplier Invoice" dialog (Sprint 12, docs/domains/finance.md "Accounts
 * Payable") — pick a supplier, optionally pull lines from one of that supplier's
 * Goods Receipts (Path A — reconciles against a liability Goods Receipt already
 * posted), and/or add manual lines coded to an explicit Chart of Accounts "Debit
 * Account" (Path B — a fresh liability, e.g. a freight charge on the same bill). Every
 * total shown here is a client preview only — `post()` computes and freezes the
 * authoritative match result, matching `InvoiceDialog`'s own "preview only" convention.
 */
export function SupplierInvoiceDialog({
  onOpenChange,
  onCreated,
}: {
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [supplierId, setSupplierId] = useState('');
  const [receiptSearch, setReceiptSearch] = useState('');
  const [selectedReceiptId, setSelectedReceiptId] = useState<string | null>(null);
  const [enabledLines, setEnabledLines] = useState<Record<string, boolean>>({});
  const [lineQuantities, setLineQuantities] = useState<Record<string, number>>({});
  const [lineUnitPrices, setLineUnitPrices] = useState<Record<string, number>>({});
  const [pathBLines, setPathBLines] = useState<PathBLine[]>([]);

  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(() => toDateInputValue(new Date().toISOString()));
  const [paymentTerms, setPaymentTerms] = useState<PaymentTermType>('NET_30');
  const [taxAmount, setTaxAmount] = useState<number | ''>('');
  const [notes, setNotes] = useState('');

  const { data: suppliersData } = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => listSuppliers(),
  });
  const suppliers = suppliersData?.items ?? [];

  const { data: receiptsData } = useQuery({
    queryKey: ['goods-receipts'],
    queryFn: () => listGoodsReceipts(),
    enabled: Boolean(supplierId),
  });
  const supplierReceipts = useMemo(
    () => (receiptsData?.items ?? []).filter((receipt) => receipt.supplier.id === supplierId),
    [receiptsData, supplierId],
  );
  const matchingReceipts = useMemo(() => {
    const query = receiptSearch.trim().toLowerCase();
    if (!query) return supplierReceipts.slice(0, 8);
    return supplierReceipts
      .filter((receipt) => receipt.goodsReceiptNumber.toLowerCase().includes(query))
      .slice(0, 8);
  }, [supplierReceipts, receiptSearch]);
  const selectedReceipt: GoodsReceipt | null =
    supplierReceipts.find((receipt) => receipt.id === selectedReceiptId) ?? null;
  const eligibleReceiptItems = (selectedReceipt?.items ?? []).filter(
    (item) => item.acceptedQuantity > 0,
  );

  const { data: accountsData } = useQuery({
    queryKey: ['accounts-debit-eligible'],
    queryFn: () => listChartOfAccounts({ isActive: true }),
  });
  const debitAccounts = (accountsData?.items ?? []).filter(
    (account) =>
      !account.isSystemAccount && (account.type === 'ASSET' || account.type === 'EXPENSE'),
  );

  const pathALines = eligibleReceiptItems
    .filter((item) => enabledLines[item.id] ?? true)
    .map((item) => ({
      goodsReceiptItemId: item.id,
      description: item.product.name,
      quantity: lineQuantities[item.id] ?? remainingPayableQuantity(item),
      unitPrice: lineUnitPrices[item.id] ?? item.unitPrice,
    }));

  const previewLines = [
    ...pathALines.map((line) => ({
      ...line,
      lineTotal: line.quantity * line.unitPrice,
      isPathA: true as const,
      available: eligibleReceiptItems.find((i) => i.id === line.goodsReceiptItemId)!,
    })),
    ...pathBLines.map((line) => ({
      ...line,
      lineTotal: line.quantity * line.unitPrice,
      isPathA: false as const,
    })),
  ];
  const subtotal = previewLines.reduce((sum, line) => sum + line.lineTotal, 0);
  const tax = typeof taxAmount === 'number' ? taxAmount : 0;
  const total = subtotal + tax;

  const canSubmit =
    supplierId.length > 0 &&
    invoiceNumber.trim().length > 0 &&
    previewLines.length > 0 &&
    pathBLines.every((line) => line.description.trim() && line.debitAccountId && line.quantity > 0);

  const mutation = useMutation({
    mutationFn: () => {
      const items: SupplierInvoiceItemInputPayload[] = [
        ...pathALines
          .filter((line) => line.quantity > 0)
          .map((line) => ({
            description: line.description,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            goodsReceiptItemId: line.goodsReceiptItemId,
          })),
        ...pathBLines.map((line) => ({
          description: line.description,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          debitAccountId: line.debitAccountId,
        })),
      ];
      return createSupplierInvoice({
        supplierId,
        purchaseOrderId: selectedReceipt?.purchaseOrder.id,
        invoiceNumber: invoiceNumber.trim(),
        invoiceDate,
        paymentTerms,
        taxAmount: taxAmount === '' ? undefined : taxAmount,
        notes: notes || undefined,
        idempotencyKey,
        items,
      });
    },
    onSuccess: onCreated,
  });

  function addPathBLine() {
    setPathBLines((prev) => [
      ...prev,
      { key: crypto.randomUUID(), description: '', quantity: 1, unitPrice: 0, debitAccountId: '' },
    ]);
  }

  function updatePathBLine(key: string, patch: Partial<PathBLine>) {
    setPathBLines((prev) => prev.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  function removePathBLine(key: string) {
    setPathBLines((prev) => prev.filter((line) => line.key !== key));
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>Create Supplier Invoice</DialogTitle>
      </DialogHeader>
      <form
        className="max-h-[75vh] space-y-4 overflow-y-auto pr-1"
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate();
        }}
      >
        <div className="space-y-1.5">
          <Label>Supplier</Label>
          <Select
            value={supplierId}
            onChange={(event) => {
              setSupplierId(event.target.value);
              setSelectedReceiptId(null);
            }}
          >
            <option value="">Select a supplier…</option>
            {suppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.supplierName}
              </option>
            ))}
          </Select>
        </div>

        {supplierId && (
          <>
            <div className="space-y-2 rounded-md border border-dashed border-border p-3">
              <Label className="text-xs text-muted-foreground">
                Optional — pull lines from a Goods Receipt (reconciles against what&apos;s already
                payable; no unnecessary restriction to have one)
              </Label>
              {!selectedReceipt ? (
                <>
                  <Input
                    placeholder="Search by GRN number…"
                    value={receiptSearch}
                    onChange={(event) => setReceiptSearch(event.target.value)}
                  />
                  <div className="max-h-32 space-y-1 overflow-y-auto">
                    {matchingReceipts.length === 0 && (
                      <p className="p-2 text-xs text-muted-foreground">
                        No goods receipts found for this supplier.
                      </p>
                    )}
                    {matchingReceipts.map((receipt) => (
                      <button
                        key={receipt.id}
                        type="button"
                        onClick={() => setSelectedReceiptId(receipt.id)}
                        className="w-full rounded-md p-2 text-left text-sm hover:bg-muted"
                      >
                        <span className="font-mono text-xs font-medium">
                          {receipt.goodsReceiptNumber}
                        </span>
                        <span className="ml-2 text-xs text-muted-foreground">
                          {receipt.purchaseOrder.purchaseOrderNumber}
                        </span>
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <div className="flex items-center justify-between text-sm">
                  <div>
                    <span className="font-mono text-xs font-medium">
                      {selectedReceipt.goodsReceiptNumber}
                    </span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {selectedReceipt.purchaseOrder.purchaseOrderNumber}
                    </span>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setSelectedReceiptId(null)}
                  >
                    Change
                  </Button>
                </div>
              )}
            </div>

            {eligibleReceiptItems.length > 0 && (
              <div className="space-y-2">
                <Label>Lines from {selectedReceipt!.goodsReceiptNumber}</Label>
                {eligibleReceiptItems.map((item) => {
                  const available = remainingPayableQuantity(item);
                  const enabled = enabledLines[item.id] ?? true;
                  const quantity = lineQuantities[item.id] ?? available;
                  const unitPrice = lineUnitPrices[item.id] ?? item.unitPrice;
                  const recognizable = Math.min(quantity, available) * unitPrice;
                  const lineTotal = quantity * unitPrice;
                  const discrepancy = recognizable < lineTotal;
                  return (
                    <div key={item.id} className="space-y-2 rounded-md border border-border p-3">
                      <div className="flex items-start justify-between gap-2">
                        <label className="flex items-center gap-2 text-sm font-medium text-foreground">
                          <input
                            type="checkbox"
                            checked={enabled}
                            onChange={(event) =>
                              setEnabledLines((prev) => ({
                                ...prev,
                                [item.id]: event.target.checked,
                              }))
                            }
                          />
                          {item.product.name}
                          <span className="text-xs font-normal text-muted-foreground">
                            (available to invoice: {available} {item.product.unit})
                          </span>
                        </label>
                        {enabled && discrepancy && <Badge variant="warning">Discrepancy</Badge>}
                      </div>
                      {enabled && (
                        <div className="grid grid-cols-3 gap-3">
                          <div className="space-y-1">
                            <Label className="text-xs">Invoiced Quantity</Label>
                            <Input
                              type="number"
                              step="any"
                              min="0"
                              value={quantity}
                              onChange={(event) =>
                                setLineQuantities((prev) => ({
                                  ...prev,
                                  [item.id]: Number(event.target.value) || 0,
                                }))
                              }
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Unit Price</Label>
                            <Input
                              type="number"
                              step="any"
                              min="0"
                              value={unitPrice}
                              onChange={(event) =>
                                setLineUnitPrices((prev) => ({
                                  ...prev,
                                  [item.id]: Number(event.target.value) || 0,
                                }))
                              }
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Line Total</Label>
                            <p className="py-1.5 text-sm font-medium text-foreground">
                              {formatCurrency(lineTotal, 'NGN')}
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Additional Lines (Debit Account)</Label>
                <Button type="button" variant="outline" size="sm" onClick={addPathBLine}>
                  Add Line
                </Button>
              </div>
              {pathBLines.map((line) => (
                <div key={line.key} className="space-y-2 rounded-md border border-border p-3">
                  <div className="flex items-end gap-2">
                    <div className="flex-1 space-y-1">
                      <Label className="text-xs">Description</Label>
                      <Input
                        value={line.description}
                        onChange={(event) =>
                          updatePathBLine(line.key, { description: event.target.value })
                        }
                        placeholder="e.g. Freight and logistics"
                      />
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => removePathBLine(line.key)}
                    >
                      Remove
                    </Button>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Quantity</Label>
                      <Input
                        type="number"
                        step="any"
                        min="0"
                        value={line.quantity}
                        onChange={(event) =>
                          updatePathBLine(line.key, { quantity: Number(event.target.value) || 0 })
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Unit Price</Label>
                      <Input
                        type="number"
                        step="any"
                        min="0"
                        value={line.unitPrice}
                        onChange={(event) =>
                          updatePathBLine(line.key, { unitPrice: Number(event.target.value) || 0 })
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Debit Account</Label>
                      <Select
                        value={line.debitAccountId}
                        onChange={(event) =>
                          updatePathBLine(line.key, { debitAccountId: event.target.value })
                        }
                      >
                        <option value="">Select an account…</option>
                        {debitAccounts.map((account) => (
                          <option key={account.id} value={account.id}>
                            {account.code} — {account.name}
                          </option>
                        ))}
                      </Select>
                    </div>
                  </div>
                </div>
              ))}
              {pathBLines.length === 0 && eligibleReceiptItems.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No Goods Receipt lines available — add at least one line above, coded to a debit
                  account, before saving.
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Invoice Number</Label>
                <Input
                  value={invoiceNumber}
                  onChange={(event) => setInvoiceNumber(event.target.value)}
                  placeholder="Supplier's own invoice number"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Invoice Date</Label>
                <Input
                  type="date"
                  value={invoiceDate}
                  onChange={(event) => setInvoiceDate(event.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
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
              <div className="space-y-1.5">
                <Label>Tax Amount (optional)</Label>
                <Input
                  type="number"
                  step="any"
                  min="0"
                  value={taxAmount}
                  onChange={(event) =>
                    setTaxAmount(event.target.value === '' ? '' : Number(event.target.value))
                  }
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Notes (optional)</Label>
              <Textarea rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} />
            </div>

            <div className="rounded-md border border-dashed border-border p-3 text-sm">
              <p className="text-xs text-muted-foreground">
                Preview only — the server recalculates and freezes the authoritative match result
                when you post this invoice.
              </p>
              <div className="mt-2 flex justify-between">
                <span className="text-muted-foreground">Subtotal</span>
                <span>{formatCurrency(subtotal, 'NGN')}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Tax</span>
                <span>{formatCurrency(tax, 'NGN')}</span>
              </div>
              <div className="flex justify-between font-semibold">
                <span>Total</span>
                <span>{formatCurrency(total, 'NGN')}</span>
              </div>
            </div>
          </>
        )}

        {mutation.isError && (
          <p className="text-sm text-destructive">
            {mutation.error instanceof ApiError
              ? mutation.error.message
              : 'Failed to create supplier invoice.'}
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={!canSubmit || mutation.isPending}>
            {mutation.isPending ? 'Creating…' : 'Create Supplier Invoice'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
