'use client';

import { zodResolver } from '@hookform/resolvers/zod';
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
import { z } from '@zentuva/validation';
import { useFieldArray, useForm } from 'react-hook-form';

import { ApiError } from '@/lib/api-client';

import { getPurchaseOrderReceivingSummary } from '../inventory/api';
import { listProducts } from '../products/api';
import { listSuppliers } from '../suppliers/api';
import { createPurchaseOrder, updatePurchaseOrder, type PurchaseOrder } from './api';
import { EDITABLE_STATUSES, formatCurrency, STATUS_LABELS } from './labels';

/** A Purchase Order only has receiving activity worth showing once it's actually been
 *  issued to the supplier — `DRAFT` (never issued) and `CANCELLED` (called off) never
 *  have any `GoodsReceipt` rows, so there's nothing to fetch or render for them. */
const STATUSES_WITH_RECEIVING_ACTIVITY = ['PENDING', 'PARTIALLY_RECEIVED', 'RECEIVED'];

/** Second line of defense behind the backend's own check (Sprint 4.3 brief: "This
 *  validation belongs inside the service layer" — the frontend filter here is purely a
 *  UX convenience so a user can't even select a Finished Product, not the source of
 *  truth). */
const PURCHASABLE_PRODUCT_TYPES = ['RAW_MATERIAL', 'PACKAGING_MATERIAL', 'CONSUMABLE'];

/**
 * A local, string-dates form schema — deliberately not `createPurchaseOrderSchema` from
 * `@zentuva/validation`, whose `orderDate`/`expectedDeliveryDate` are typed `Date` (for
 * the *server* to coerce an incoming JSON string). This form works with plain
 * `<input type="date">` strings end to end; the backend re-validates and coerces
 * regardless, so nothing here is trusted as the source of truth for totals or types.
 */
const purchaseOrderFormSchema = z.object({
  supplierId: z.string().min(1, 'Supplier is required'),
  orderDate: z.string().min(1, 'Order date is required'),
  expectedDeliveryDate: z.string().optional(),
  remarks: z.string().optional(),
  status: z.enum(['DRAFT', 'PENDING']),
  items: z
    .array(
      z.object({
        productId: z.string().min(1, 'Product is required'),
        quantity: z
          .number({ invalid_type_error: 'Quantity is required' })
          .positive('Quantity must be greater than zero'),
        unitPrice: z
          .number({ invalid_type_error: 'Unit price is required' })
          .nonnegative('Unit price cannot be negative'),
      }),
    )
    .min(1, 'At least one item is required'),
});

type PurchaseOrderFormValues = z.infer<typeof purchaseOrderFormSchema>;

function toDateInputValue(value: string | null | undefined): string {
  return value ? value.slice(0, 10) : '';
}

/**
 * Reusable Create/Edit Purchase Order dialog (Sprint 4.3 brief). `purchaseOrder === null`
 * is create mode. A `CANCELLED` order renders every field disabled and hides the submit
 * button (brief: "Cancelled POs become read-only") — there's no separate view-only
 * component, just this dialog with everything locked.
 *
 * `Status` is deliberately absent from the Create fields (matching the brief's Create
 * dialog field list) but present in Edit — the brief's Create example always starts a PO
 * as `DRAFT`; marking it `PENDING` ("issued to the supplier," this sprint's finish line)
 * happens by editing it, since no separate "Issue" endpoint exists.
 */
export function PurchaseOrderDialog({
  purchaseOrder,
  onOpenChange,
  onSaved,
}: {
  purchaseOrder: PurchaseOrder | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const isEdit = purchaseOrder !== null;
  const readOnly = isEdit && !EDITABLE_STATUSES.includes(purchaseOrder.status);

  const { data: suppliersData } = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => listSuppliers(),
  });
  const { data: productsData } = useQuery({
    queryKey: ['products'],
    queryFn: () => listProducts(),
  });
  const suppliers = suppliersData?.items ?? [];
  const purchasableProducts = (productsData?.items ?? []).filter((product) =>
    PURCHASABLE_PRODUCT_TYPES.includes(product.type),
  );

  const showReceivingSummary =
    isEdit && STATUSES_WITH_RECEIVING_ACTIVITY.includes(purchaseOrder.status);
  const { data: receivingSummary } = useQuery({
    queryKey: ['purchase-order-receiving-summary', purchaseOrder?.id],
    queryFn: () => getPurchaseOrderReceivingSummary(purchaseOrder!.id),
    enabled: showReceivingSummary,
  });

  const form = useForm<PurchaseOrderFormValues>({
    resolver: zodResolver(purchaseOrderFormSchema),
    defaultValues: {
      supplierId: purchaseOrder?.supplier.id ?? '',
      orderDate:
        toDateInputValue(purchaseOrder?.orderDate) || toDateInputValue(new Date().toISOString()),
      expectedDeliveryDate: toDateInputValue(purchaseOrder?.expectedDeliveryDate),
      remarks: purchaseOrder?.remarks ?? '',
      status: purchaseOrder?.status === 'PENDING' ? 'PENDING' : 'DRAFT',
      items: purchaseOrder
        ? purchaseOrder.items.map((item) => ({
            productId: item.product.id,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
          }))
        : [{ productId: '', quantity: 1, unitPrice: 0 }],
    },
  });

  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'items' });
  const watchedItems = form.watch('items');
  const subtotal = watchedItems.reduce(
    (sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.unitPrice) || 0),
    0,
  );

  const mutation = useMutation({
    mutationFn: (values: PurchaseOrderFormValues) => {
      const items = values.items.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
      }));
      if (isEdit) {
        return updatePurchaseOrder(purchaseOrder.id, {
          supplierId: values.supplierId,
          orderDate: values.orderDate,
          expectedDeliveryDate: values.expectedDeliveryDate || undefined,
          remarks: values.remarks || undefined,
          status: values.status,
          items,
        });
      }
      return createPurchaseOrder({
        supplierId: values.supplierId,
        orderDate: values.orderDate,
        expectedDeliveryDate: values.expectedDeliveryDate || undefined,
        remarks: values.remarks || undefined,
        items,
      });
    },
    onSuccess: () => {
      onSaved();
      onOpenChange(false);
    },
  });

  // The Supplier/Product <select>s are uncontrolled (RHF `register`) — their initial
  // selected option is set once at mount from `defaultValues`. If either list is still
  // loading when the dialog first renders, the option matching the current value
  // doesn't exist yet, and the select never re-syncs once it arrives (the field's value
  // is already set; only the DOM's rendered `<option>`s are missing). Waiting for both
  // queries here avoids that race entirely, rather than patching it up after the fact.
  if (!suppliersData || !productsData) {
    return (
      <Dialog open onOpenChange={onOpenChange}>
        <DialogHeader>
          <DialogTitle>
            {readOnly
              ? 'View Purchase Order'
              : isEdit
                ? 'Edit Purchase Order'
                : 'Create Purchase Order'}
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">Loading…</p>
      </Dialog>
    );
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>
          {readOnly
            ? 'View Purchase Order'
            : isEdit
              ? 'Edit Purchase Order'
              : 'Create Purchase Order'}
        </DialogTitle>
      </DialogHeader>
      <form
        className="max-h-[70vh] space-y-4 overflow-y-auto pr-1"
        onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
      >
        {isEdit && (
          <p className="rounded-md border border-dashed border-border bg-muted/50 px-3 py-2 font-mono text-xs text-muted-foreground">
            {purchaseOrder.purchaseOrderNumber}
          </p>
        )}

        <div className="space-y-1.5">
          <Label>Supplier</Label>
          <Select disabled={readOnly} {...form.register('supplierId')}>
            <option value="">Select a supplier…</option>
            {suppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.supplierName}
              </option>
            ))}
          </Select>
          {form.formState.errors.supplierId && (
            <p className="text-xs text-destructive">{form.formState.errors.supplierId.message}</p>
          )}
        </div>

        {isEdit && (
          <div className="space-y-1.5">
            <Label>Status</Label>
            {readOnly ? (
              // A cancelled order's real status can't be represented by the
              // Draft/Pending-only <select> below (brief: editing only ever reaches
              // those two) — show it as plain text instead of a misleading dropdown.
              <p className="rounded-md border border-input bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
                {STATUS_LABELS[purchaseOrder.status]}
              </p>
            ) : (
              <Select {...form.register('status')}>
                <option value="DRAFT">Draft</option>
                <option value="PENDING">Pending — issued to supplier</option>
              </Select>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Order Date</Label>
            <Input type="date" disabled={readOnly} {...form.register('orderDate')} />
            {form.formState.errors.orderDate && (
              <p className="text-xs text-destructive">{form.formState.errors.orderDate.message}</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Expected Delivery (optional)</Label>
            <Input type="date" disabled={readOnly} {...form.register('expectedDeliveryDate')} />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Remarks (optional)</Label>
          <Textarea rows={2} disabled={readOnly} {...form.register('remarks')} />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Items</Label>
            {!readOnly && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => append({ productId: '', quantity: 1, unitPrice: 0 })}
              >
                Add Row
              </Button>
            )}
          </div>
          {form.formState.errors.items?.message && (
            <p className="text-xs text-destructive">{form.formState.errors.items.message}</p>
          )}

          <div className="space-y-3">
            {fields.map((field, index) => {
              const item = watchedItems[index];
              const lineTotal = (Number(item?.quantity) || 0) * (Number(item?.unitPrice) || 0);
              const itemErrors = form.formState.errors.items?.[index];
              return (
                <div key={field.id} className="space-y-2 rounded-md border border-border p-2">
                  <div className="flex items-end gap-2">
                    <div className="flex-1 space-y-1">
                      <Label className="text-xs">Product</Label>
                      <Select disabled={readOnly} {...form.register(`items.${index}.productId`)}>
                        <option value="">Select a product…</option>
                        {purchasableProducts.map((product) => (
                          <option key={product.id} value={product.id}>
                            {product.name} ({product.unit})
                          </option>
                        ))}
                      </Select>
                    </div>
                    {!readOnly && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={fields.length === 1}
                        onClick={() => remove(index)}
                      >
                        Remove
                      </Button>
                    )}
                  </div>
                  {itemErrors?.productId && (
                    <p className="text-xs text-destructive">{itemErrors.productId.message}</p>
                  )}

                  <div className="grid grid-cols-3 gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs">Quantity</Label>
                      <Input
                        type="number"
                        step="any"
                        min="0"
                        disabled={readOnly}
                        {...form.register(`items.${index}.quantity`, { valueAsNumber: true })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Unit Price</Label>
                      <Input
                        type="number"
                        step="any"
                        min="0"
                        disabled={readOnly}
                        {...form.register(`items.${index}.unitPrice`, { valueAsNumber: true })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Line Total</Label>
                      <p className="py-1.5 text-sm font-medium text-foreground">
                        {formatCurrency(lineTotal)}
                      </p>
                    </div>
                  </div>
                  {(itemErrors?.quantity || itemErrors?.unitPrice) && (
                    <p className="text-xs text-destructive">
                      {itemErrors.quantity?.message ?? itemErrors.unitPrice?.message}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col items-end gap-1 border-t border-border pt-3 text-sm">
          <div className="flex w-full max-w-[12rem] justify-between">
            <span className="text-muted-foreground">Subtotal</span>
            <span>{formatCurrency(subtotal)}</span>
          </div>
          <div className="flex w-full max-w-[12rem] justify-between font-semibold">
            <span>Total</span>
            <span>{formatCurrency(subtotal)}</span>
          </div>
        </div>

        {showReceivingSummary && receivingSummary && (
          <div className="space-y-2 border-t border-border pt-3">
            <Label>Receiving Summary</Label>
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <thead className="border-b border-border bg-muted/50 text-left">
                  <tr>
                    <th className="px-3 py-2 font-medium">Product</th>
                    <th className="px-3 py-2 font-medium">Ordered</th>
                    <th className="px-3 py-2 font-medium">Delivered</th>
                    <th className="px-3 py-2 font-medium">Accepted</th>
                    <th className="px-3 py-2 font-medium">Rejected</th>
                    <th className="px-3 py-2 font-medium">Outstanding</th>
                  </tr>
                </thead>
                <tbody>
                  {receivingSummary.items.map((item) => (
                    <tr
                      key={item.purchaseOrderItemId}
                      className="border-b border-border last:border-0"
                    >
                      <td className="px-3 py-2">
                        {item.product.name}{' '}
                        <span className="text-xs text-muted-foreground">({item.product.unit})</span>
                      </td>
                      <td className="px-3 py-2">{item.orderedQuantity}</td>
                      <td className="px-3 py-2">
                        {item.deliveredQuantity}
                        {item.excessQuantity > 0 && (
                          <span className="ml-1 text-xs text-muted-foreground">
                            (+{item.excessQuantity} excess)
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">{item.acceptedQuantity}</td>
                      <td className="px-3 py-2">{item.rejectedQuantity}</td>
                      <td className="px-3 py-2">{item.outstandingQuantity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {mutation.isError && (
          <p className="text-sm text-destructive">
            {mutation.error instanceof ApiError
              ? mutation.error.message
              : 'Failed to save purchase order.'}
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {readOnly ? 'Close' : 'Cancel'}
          </Button>
          {!readOnly && (
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Purchase Order'}
            </Button>
          )}
        </DialogFooter>
      </form>
    </Dialog>
  );
}
