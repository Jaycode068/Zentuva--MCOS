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
import { listGoodsReceipts, listInventoryLocations } from '@/app/(app)/settings/inventory/api';

import { createSupplierReturn } from './api';
import { SUPPLIER_RETURN_REASON_LABELS } from './labels';

/**
 * "Create Supplier Return" dialog (Sprint 11, docs/domains/procurement.md "Supplier
 * Returns") — a single atomic write, unlike Customer Return's two-phase request/
 * receive (docs/domains/procurement.md explains why: there is no separate inspection
 * step, the goods are simply leaving). Pick a Goods Receipt, then how much of each
 * accepted line is going back — the server computes the excess-vs-payable allocation
 * (brief §17-19) and the reversal journal atomically.
 */
export function CreateSupplierReturnDialog({
  onOpenChange,
  onCreated,
}: {
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [receiptSearch, setReceiptSearch] = useState('');
  const [selectedReceiptId, setSelectedReceiptId] = useState<string | null>(null);
  const [locationId, setLocationId] = useState('');
  const [returnDate, setReturnDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState<keyof typeof SUPPLIER_RETURN_REASON_LABELS>('DEFECTIVE');
  const [reasonNotes, setReasonNotes] = useState('');
  const [notes, setNotes] = useState('');
  const [quantities, setQuantities] = useState<Record<string, number>>({});

  const { data: receiptsData } = useQuery({
    queryKey: ['goods-receipts'],
    queryFn: () => listGoodsReceipts(),
  });
  const { data: locationsData } = useQuery({
    queryKey: ['inventory-locations'],
    queryFn: () => listInventoryLocations(),
  });
  const activeLocations = (locationsData?.items ?? []).filter((loc) => loc.status === 'ACTIVE');

  const matchingReceipts = useMemo(() => {
    const query = receiptSearch.trim().toLowerCase();
    const receipts = receiptsData?.items ?? [];
    if (!query) return receipts.slice(0, 8);
    return receipts
      .filter(
        (receipt) =>
          receipt.goodsReceiptNumber.toLowerCase().includes(query) ||
          receipt.supplier.supplierName.toLowerCase().includes(query),
      )
      .slice(0, 8);
  }, [receiptsData, receiptSearch]);

  const selectedReceipt = receiptsData?.items.find((r) => r.id === selectedReceiptId) ?? null;
  const acceptedItems = (selectedReceipt?.items ?? []).filter((item) => item.acceptedQuantity > 0);
  const hasAnyQuantity = Object.values(quantities).some((value) => (value ?? 0) > 0);

  const mutation = useMutation({
    mutationFn: () => {
      const items = acceptedItems
        .map((item) => ({
          goodsReceiptItemId: item.id,
          quantityReturned: quantities[item.id] ?? 0,
        }))
        .filter((item) => item.quantityReturned > 0);
      return createSupplierReturn({
        purchaseOrderId: selectedReceipt!.purchaseOrder.id,
        goodsReceiptId: selectedReceipt!.id,
        locationId,
        returnDate,
        reason,
        reasonNotes: reasonNotes || undefined,
        notes: notes || undefined,
        idempotencyKey,
        items,
      });
    },
    onSuccess: onCreated,
  });

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>Create Supplier Return</DialogTitle>
      </DialogHeader>
      <div className="max-h-[75vh] space-y-4 overflow-y-auto pr-1">
        {!selectedReceipt ? (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Find the Goods Receipt</Label>
              <Input
                placeholder="Search by GRN number or supplier…"
                value={receiptSearch}
                onChange={(event) => setReceiptSearch(event.target.value)}
              />
            </div>
            <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border border-border p-1">
              {matchingReceipts.length === 0 && (
                <p className="p-3 text-sm text-muted-foreground">No matching goods receipts.</p>
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
                  <span className="ml-2 text-muted-foreground">
                    {receipt.supplier.supplierName}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between rounded-md border border-border bg-muted/30 p-3 text-sm">
              <div>
                <p className="font-mono text-xs font-medium">
                  {selectedReceipt.goodsReceiptNumber}
                </p>
                <p className="text-xs text-muted-foreground">
                  {selectedReceipt.supplier.supplierName}
                </p>
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

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Return Date</Label>
                <Input
                  type="date"
                  value={returnDate}
                  onChange={(event) => setReturnDate(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Source Location</Label>
                <Select value={locationId} onChange={(event) => setLocationId(event.target.value)}>
                  <option value="">Select a location…</option>
                  {activeLocations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name}
                      {location.isDefault ? ' (Default)' : ''}
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Reason</Label>
                <Select
                  value={reason}
                  onChange={(event) =>
                    setReason(event.target.value as keyof typeof SUPPLIER_RETURN_REASON_LABELS)
                  }
                >
                  {Object.entries(SUPPLIER_RETURN_REASON_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Reason Notes (optional)</Label>
                <Input
                  value={reasonNotes}
                  onChange={(event) => setReasonNotes(event.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Notes (optional)</Label>
              <Textarea rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} />
            </div>

            <div className="space-y-3">
              <Label>Accepted Lines</Label>
              {acceptedItems.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Nothing was accepted on this receipt — there is nothing to return.
                </p>
              )}
              {acceptedItems.map((item) => (
                <div key={item.id} className="space-y-2 rounded-md border border-border p-3">
                  <div className="font-medium text-foreground">
                    {item.product.name}{' '}
                    <span className="text-xs text-muted-foreground">
                      ({item.product.unit}, accepted {item.acceptedQuantity})
                    </span>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Return Quantity</Label>
                    <Input
                      type="number"
                      step="any"
                      min="0"
                      max={item.acceptedQuantity}
                      value={quantities[item.id] ?? ''}
                      onChange={(event) =>
                        setQuantities((prev) => ({
                          ...prev,
                          [item.id]: Number(event.target.value) || 0,
                        }))
                      }
                    />
                  </div>
                </div>
              ))}
            </div>

            {!hasAnyQuantity && acceptedItems.length > 0 && (
              <p className="text-xs text-destructive">
                Enter a return quantity for at least one line before saving.
              </p>
            )}
          </>
        )}

        {mutation.isError && (
          <p className="text-sm text-destructive">
            {mutation.error instanceof ApiError
              ? mutation.error.message
              : 'Failed to create return.'}
          </p>
        )}
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        {selectedReceipt && (
          <Button
            type="button"
            onClick={() => mutation.mutate()}
            disabled={!locationId || !hasAnyQuantity || mutation.isPending}
          >
            {mutation.isPending ? 'Creating…' : 'Create Return'}
          </Button>
        )}
      </DialogFooter>
    </Dialog>
  );
}
