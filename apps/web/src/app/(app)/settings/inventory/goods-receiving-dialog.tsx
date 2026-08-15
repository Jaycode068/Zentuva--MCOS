'use client';

import { useEffect } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
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
import { z } from '@zentuva/validation';
import { useForm } from 'react-hook-form';

import { ApiError } from '@/lib/api-client';

import { listPurchaseOrders, type PurchaseOrderStatus } from '../procurement/api';
import { createGoodsReceipt, getPurchaseOrderReceivingSummary, type RejectionReason } from './api';
import { REJECTION_REASON_LABELS } from './labels';

/** A Purchase Order is receivable in every status except `DRAFT`/`CANCELLED` (Sprint
 *  4.4.1 brief §6/§7) — including `RECEIVED` itself, since a supplier's later
 *  replacement shipment must still be recordable against an order whose original
 *  delivery already fully met its ordered quantity. Mirrors
 *  `InventoryService`'s `NON_RECEIVABLE_PURCHASE_ORDER_STATUSES` — purely a UX
 *  convenience, the backend is the actual source of truth. */
const RECEIVABLE_STATUSES: PurchaseOrderStatus[] = ['PENDING', 'PARTIALLY_RECEIVED', 'RECEIVED'];

const goodsReceiptItemFormSchema = z
  .object({
    purchaseOrderItemId: z.string().min(1),
    productName: z.string(),
    productUnit: z.string(),
    orderedQuantity: z.number(),
    previouslyDelivered: z.number(),
    previouslyAccepted: z.number(),
    previouslyRejected: z.number(),
    outstandingQuantity: z.number(),
    deliveredQuantity: z
      .number({ invalid_type_error: 'Delivered quantity is required' })
      .nonnegative('Delivered quantity cannot be negative'),
    rejectedQuantity: z
      .number({ invalid_type_error: 'Rejected quantity is required' })
      .nonnegative('Rejected quantity cannot be negative'),
    rejectionReason: z.string().optional(),
    rejectionNotes: z.string().optional(),
  })
  .refine((data) => data.rejectedQuantity <= data.deliveredQuantity, {
    message: 'Rejected quantity cannot exceed delivered quantity',
    path: ['rejectedQuantity'],
  });

/** No Add/Remove Row here — every row is one of the Purchase Order's own items,
 *  pre-filled with its Ordered/Previously Delivered/Accepted/Rejected/Outstanding
 *  context (brief §12). Rows with `deliveredQuantity: 0` at submit time (nothing arrived
 *  for that product on this delivery) are dropped before the request is sent. */
const goodsReceiptFormSchema = z.object({
  purchaseOrderId: z.string().min(1, 'Purchase order is required'),
  receivedDate: z.string().min(1, 'Received date is required'),
  remarks: z.string().optional(),
  items: z.array(goodsReceiptItemFormSchema),
});

type GoodsReceiptFormValues = z.infer<typeof goodsReceiptFormSchema>;

function toDateInputValue(value: string): string {
  return value.slice(0, 10);
}

/**
 * "Receive Goods" dialog (Sprint 4.4 brief, redesigned Sprint 4.4.1). Selecting a
 * Purchase Order loads its full receiving history (`getPurchaseOrderReceivingSummary`) —
 * Ordered/Previously Delivered/Accepted/Rejected/Outstanding per item — then the user
 * enters this delivery's Delivered Quantity and (if applicable) Rejected Quantity +
 * Reason. Accepted Quantity is always computed (`delivered - rejected`), never entered
 * directly (brief §12). Delivering more than what's outstanding is allowed and flagged
 * as "Excess Supply," never blocked or silently capped (brief §3 Scenario E).
 */
export function GoodsReceivingDialog({
  onOpenChange,
  onReceived,
}: {
  onOpenChange: (open: boolean) => void;
  onReceived: () => void;
}) {
  const { data: purchaseOrdersData } = useQuery({
    queryKey: ['purchase-orders'],
    queryFn: () => listPurchaseOrders(),
  });
  const eligiblePurchaseOrders = (purchaseOrdersData?.items ?? []).filter((po) =>
    RECEIVABLE_STATUSES.includes(po.status),
  );

  const form = useForm<GoodsReceiptFormValues>({
    resolver: zodResolver(goodsReceiptFormSchema),
    defaultValues: {
      purchaseOrderId: '',
      receivedDate: toDateInputValue(new Date().toISOString()),
      remarks: '',
      items: [],
    },
  });

  const purchaseOrderId = form.watch('purchaseOrderId');
  const selectedPurchaseOrder = eligiblePurchaseOrders.find((po) => po.id === purchaseOrderId);
  const watchedItems = form.watch('items');

  const { data: receivingSummary } = useQuery({
    queryKey: ['purchase-order-receiving-summary', purchaseOrderId],
    queryFn: () => getPurchaseOrderReceivingSummary(purchaseOrderId),
    enabled: purchaseOrderId.length > 0,
  });

  // Every time the receiving summary for the selected Purchase Order loads (or the
  // selection changes), re-derive the items grid from it — `form.reset` (not
  // `setValue`) so the grid's registered inputs stay in sync, same pattern
  // `PurchaseOrderDialog`/the pre-4.4.1 version of this dialog used.
  useEffect(() => {
    if (!receivingSummary) {
      return;
    }
    form.reset({
      purchaseOrderId: form.getValues('purchaseOrderId'),
      receivedDate: form.getValues('receivedDate'),
      remarks: form.getValues('remarks'),
      items: receivingSummary.items.map((item) => ({
        purchaseOrderItemId: item.purchaseOrderItemId,
        productName: item.product.name,
        productUnit: item.product.unit,
        orderedQuantity: item.orderedQuantity,
        previouslyDelivered: item.deliveredQuantity,
        previouslyAccepted: item.acceptedQuantity,
        previouslyRejected: item.rejectedQuantity,
        outstandingQuantity: item.outstandingQuantity,
        deliveredQuantity: item.outstandingQuantity,
        rejectedQuantity: 0,
        rejectionReason: '',
        rejectionNotes: '',
      })),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receivingSummary]);

  const mutation = useMutation({
    mutationFn: (values: GoodsReceiptFormValues) => {
      const items = values.items
        .filter((item) => item.deliveredQuantity > 0)
        .map((item) => ({
          purchaseOrderItemId: item.purchaseOrderItemId,
          deliveredQuantity: item.deliveredQuantity,
          rejectedQuantity: item.rejectedQuantity,
          rejectionReason:
            item.rejectedQuantity > 0 && item.rejectionReason
              ? (item.rejectionReason as RejectionReason)
              : undefined,
          rejectionNotes: item.rejectionNotes || undefined,
        }));
      return createGoodsReceipt({
        purchaseOrderId: values.purchaseOrderId,
        receivedDate: values.receivedDate,
        remarks: values.remarks || undefined,
        items,
      });
    },
    onSuccess: onReceived,
  });

  const hasAnyDelivery = watchedItems.some((item) => (item.deliveredQuantity ?? 0) > 0);

  if (purchaseOrderId && !receivingSummary) {
    return (
      <Dialog open onOpenChange={onOpenChange}>
        <DialogHeader>
          <DialogTitle>Receive Goods</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">Loading…</p>
      </Dialog>
    );
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>Receive Goods</DialogTitle>
      </DialogHeader>
      <form
        className="max-h-[75vh] space-y-4 overflow-y-auto pr-1"
        onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
      >
        <div className="space-y-1.5">
          <Label>Purchase Order</Label>
          <Select {...form.register('purchaseOrderId')}>
            <option value="">Select a purchase order…</option>
            {eligiblePurchaseOrders.map((po) => (
              <option key={po.id} value={po.id}>
                {po.purchaseOrderNumber} — {po.supplier.supplierName} ({po.status})
              </option>
            ))}
          </Select>
          {eligiblePurchaseOrders.length === 0 && (
            <p className="text-xs text-muted-foreground">
              No purchase orders are currently eligible — only orders that have been issued to a
              supplier can be received.
            </p>
          )}
          {form.formState.errors.purchaseOrderId && (
            <p className="text-xs text-destructive">
              {form.formState.errors.purchaseOrderId.message}
            </p>
          )}
        </div>

        {selectedPurchaseOrder && receivingSummary && (
          <>
            <div className="space-y-1.5">
              <Label>Supplier</Label>
              <p className="rounded-md border border-input bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
                {selectedPurchaseOrder.supplier.supplierName}
              </p>
            </div>

            {selectedPurchaseOrder.status === 'RECEIVED' && (
              <p className="rounded-md border border-dashed border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                This order has already been fully received. Recording another delivery here is for a
                supplier replacement or additional goods — it will not change the order&apos;s
                outstanding quantity below zero.
              </p>
            )}

            <div className="space-y-1.5">
              <Label>Received Date</Label>
              <Input type="date" {...form.register('receivedDate')} />
              {form.formState.errors.receivedDate && (
                <p className="text-xs text-destructive">
                  {form.formState.errors.receivedDate.message}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>Remarks (optional)</Label>
              <Textarea rows={2} {...form.register('remarks')} />
            </div>

            <div className="space-y-3">
              <Label>Items</Label>
              {watchedItems.map((item, index) => {
                const itemErrors = form.formState.errors.items?.[index];
                const excess = Math.max(
                  0,
                  (item.deliveredQuantity || 0) - item.outstandingQuantity,
                );
                return (
                  <div
                    key={item.purchaseOrderItemId}
                    className="space-y-3 rounded-md border border-border p-3"
                  >
                    <div className="flex items-center justify-between">
                      <div className="font-medium text-foreground">
                        {item.productName}{' '}
                        <span className="text-xs text-muted-foreground">({item.productUnit})</span>
                      </div>
                      {excess > 0 && <Badge variant="warning">Excess Supply: {excess}</Badge>}
                    </div>

                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-md bg-muted/30 p-2 text-xs text-muted-foreground sm:grid-cols-5">
                      <div>
                        Ordered
                        <div className="font-medium text-foreground">{item.orderedQuantity}</div>
                      </div>
                      <div>
                        Prev. Delivered
                        <div className="font-medium text-foreground">
                          {item.previouslyDelivered}
                        </div>
                      </div>
                      <div>
                        Prev. Accepted
                        <div className="font-medium text-foreground">{item.previouslyAccepted}</div>
                      </div>
                      <div>
                        Prev. Rejected
                        <div className="font-medium text-foreground">{item.previouslyRejected}</div>
                      </div>
                      <div>
                        Outstanding
                        <div className="font-medium text-foreground">
                          {item.outstandingQuantity}
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      <div className="space-y-1">
                        <Label className="text-xs">Delivered Quantity</Label>
                        <Input
                          type="number"
                          step="any"
                          min="0"
                          {...form.register(`items.${index}.deliveredQuantity`, {
                            valueAsNumber: true,
                          })}
                        />
                        {itemErrors?.deliveredQuantity && (
                          <p className="text-xs text-destructive">
                            {itemErrors.deliveredQuantity.message}
                          </p>
                        )}
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Rejected Quantity</Label>
                        <Input
                          type="number"
                          step="any"
                          min="0"
                          {...form.register(`items.${index}.rejectedQuantity`, {
                            valueAsNumber: true,
                          })}
                        />
                        {itemErrors?.rejectedQuantity && (
                          <p className="text-xs text-destructive">
                            {itemErrors.rejectedQuantity.message}
                          </p>
                        )}
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Accepted Quantity</Label>
                        <p className="py-1.5 text-sm font-medium text-foreground">
                          {Math.max(
                            0,
                            (item.deliveredQuantity || 0) - (item.rejectedQuantity || 0),
                          )}{' '}
                          {item.productUnit}
                        </p>
                      </div>
                    </div>

                    {(item.rejectedQuantity || 0) > 0 && (
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <Label className="text-xs">Rejection Reason</Label>
                          <Select {...form.register(`items.${index}.rejectionReason`)}>
                            <option value="">Select a reason…</option>
                            {Object.entries(REJECTION_REASON_LABELS).map(([value, label]) => (
                              <option key={value} value={value}>
                                {label}
                              </option>
                            ))}
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Rejection Notes (optional)</Label>
                          <Input {...form.register(`items.${index}.rejectionNotes`)} />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {!hasAnyDelivery && (
              <p className="text-xs text-destructive">
                Enter a delivered quantity for at least one item before saving.
              </p>
            )}
          </>
        )}

        {mutation.isError && (
          <p className="text-sm text-destructive">
            {mutation.error instanceof ApiError
              ? mutation.error.message
              : 'Failed to receive goods.'}
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={!selectedPurchaseOrder || !hasAnyDelivery || mutation.isPending}
          >
            {mutation.isPending ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
