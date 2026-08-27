'use client';

import { useQuery } from '@tanstack/react-query';
import { Badge, Button, Dialog, DialogFooter, DialogHeader, DialogTitle } from '@zentuva/ui';

import { getSupplierReturn } from './api';
import { SUPPLIER_RETURN_REASON_LABELS } from './labels';

/** Read-only Supplier Return detail view (Sprint 11) — a completed, immutable record;
 *  no receive/cancel actions (see `create-supplier-return-dialog.tsx`'s doc comment for
 *  why Supplier Return is a one-shot atomic write). */
export function SupplierReturnDetailDialog({
  supplierReturnId,
  onOpenChange,
}: {
  supplierReturnId: string;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: supplierReturn, isLoading } = useQuery({
    queryKey: ['supplier-return', supplierReturnId],
    queryFn: () => getSupplierReturn(supplierReturnId),
  });

  if (isLoading || !supplierReturn) {
    return (
      <Dialog open onOpenChange={onOpenChange}>
        <DialogHeader>
          <DialogTitle>Supplier Return</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">Loading…</p>
      </Dialog>
    );
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          {supplierReturn.returnCode}
          <Badge variant="success">Completed</Badge>
        </DialogTitle>
      </DialogHeader>
      <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1 text-sm">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-muted-foreground">Supplier</p>
            <p>{supplierReturn.supplier.supplierName}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Goods Receipt</p>
            <p className="font-mono text-xs">{supplierReturn.goodsReceipt.goodsReceiptNumber}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Purchase Order</p>
            <p className="font-mono text-xs">{supplierReturn.purchaseOrder.purchaseOrderNumber}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Reason</p>
            <p>{SUPPLIER_RETURN_REASON_LABELS[supplierReturn.reason]}</p>
          </div>
        </div>

        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-xs">
            <thead className="border-b border-border bg-muted/50 text-left">
              <tr>
                <th className="px-3 py-2 font-medium">Product</th>
                <th className="px-3 py-2 font-medium">Returned</th>
                <th className="px-3 py-2 font-medium">Unit Cost</th>
                <th className="px-3 py-2 font-medium">Excess Portion</th>
                <th className="px-3 py-2 font-medium">Payable Portion</th>
              </tr>
            </thead>
            <tbody>
              {supplierReturn.items.map((item) => (
                <tr key={item.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2">{item.product.name}</td>
                  <td className="px-3 py-2">{item.quantityReturned}</td>
                  <td className="px-3 py-2">{item.unitCost.toFixed(2)}</td>
                  <td className="px-3 py-2">{item.excessPortion}</td>
                  <td className="px-3 py-2">{item.quantityReturned - item.excessPortion}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
          Close
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
