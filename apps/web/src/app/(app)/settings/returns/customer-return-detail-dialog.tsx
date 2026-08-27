'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from '@zentuva/ui';

import { ApiError } from '@/lib/api-client';

import {
  cancelCustomerReturn,
  getCustomerReturn,
  receiveCustomerReturn,
  type CustomerReturnWithAccounting,
} from './api';
import {
  CUSTOMER_RETURN_REASON_LABELS,
  CUSTOMER_RETURN_STATUS_LABELS,
  CUSTOMER_RETURN_STATUS_VARIANT,
} from './labels';

/**
 * Customer Return detail view (Sprint 11) — shows the request, and while `REQUESTED`,
 * the disposition/receive form: the one atomic physical+financial event
 * (docs/domains/sales.md "Customer Returns" §receive). Once `RECEIVED`, shows the
 * resulting COGS-reversal journal and Credit Note — Finance traceability (brief §34)
 * without a second round trip.
 */
export function CustomerReturnDetailDialog({
  customerReturnId,
  onOpenChange,
  onChanged,
}: {
  customerReturnId: string;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  const queryClient = useQueryClient();
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [receiveResult, setReceiveResult] = useState<CustomerReturnWithAccounting | null>(null);
  const [disposition, setDisposition] = useState<
    Record<
      string,
      { resalable: number; damaged: number; quarantine: number; scrap: number; credited: number }
    >
  >({});

  const { data: customerReturn, isLoading } = useQuery({
    queryKey: ['customer-return', customerReturnId],
    queryFn: () => getCustomerReturn(customerReturnId),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['customer-return', customerReturnId] });
    queryClient.invalidateQueries({ queryKey: ['customer-returns'] });
    onChanged();
  };

  const receiveMutation = useMutation({
    mutationFn: () => {
      const items = (customerReturn?.items ?? []).map((item) => {
        const row = disposition[item.id] ?? {
          resalable: item.quantityReturned,
          damaged: 0,
          quarantine: 0,
          scrap: 0,
          credited: item.quantityReturned,
        };
        return {
          customerReturnItemId: item.id,
          quantityResalable: row.resalable,
          quantityDamaged: row.damaged,
          quantityQuarantine: row.quarantine,
          quantityScrap: row.scrap,
          quantityCredited: row.credited,
        };
      });
      return receiveCustomerReturn(customerReturnId, { idempotencyKey, items });
    },
    onSuccess: (result) => {
      setReceiveResult(result);
      invalidate();
    },
  });

  const cancelMutation = useMutation({
    mutationFn: () => cancelCustomerReturn(customerReturnId),
    onSuccess: invalidate,
  });

  const dispositionSumsOk = useMemo(() => {
    if (!customerReturn) return false;
    return customerReturn.items.every((item) => {
      const row = disposition[item.id];
      if (!row) return true; // uses the default (all-resalable) — always valid
      const sum = row.resalable + row.damaged + row.quarantine + row.scrap;
      return Math.abs(sum - item.quantityReturned) < 1e-6;
    });
  }, [customerReturn, disposition]);

  function updateRow(
    itemId: string,
    quantityReturned: number,
    patch: Partial<(typeof disposition)[string]>,
  ) {
    setDisposition((prev) => ({
      ...prev,
      [itemId]: {
        resalable: prev[itemId]?.resalable ?? quantityReturned,
        damaged: prev[itemId]?.damaged ?? 0,
        quarantine: prev[itemId]?.quarantine ?? 0,
        scrap: prev[itemId]?.scrap ?? 0,
        credited: prev[itemId]?.credited ?? quantityReturned,
        ...patch,
      },
    }));
  }

  if (isLoading || !customerReturn) {
    return (
      <Dialog open onOpenChange={onOpenChange}>
        <DialogHeader>
          <DialogTitle>Customer Return</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">Loading…</p>
      </Dialog>
    );
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          {customerReturn.returnCode}
          <Badge variant={CUSTOMER_RETURN_STATUS_VARIANT[customerReturn.status]}>
            {CUSTOMER_RETURN_STATUS_LABELS[customerReturn.status]}
          </Badge>
        </DialogTitle>
      </DialogHeader>
      <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1 text-sm">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-muted-foreground">Customer</p>
            <p>{customerReturn.customer.customerName}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Sales Order</p>
            <p className="font-mono text-xs">{customerReturn.salesOrder.orderCode}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Reason</p>
            <p>{CUSTOMER_RETURN_REASON_LABELS[customerReturn.reason]}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Receiving Location</p>
            <p>{customerReturn.location.name}</p>
          </div>
        </div>
        {customerReturn.photoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={customerReturn.photoUrl}
            alt="Return evidence"
            className="h-32 w-32 rounded-md border border-border object-cover"
          />
        )}

        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-xs">
            <thead className="border-b border-border bg-muted/50 text-left">
              <tr>
                <th className="px-3 py-2 font-medium">Product</th>
                <th className="px-3 py-2 font-medium">Returned</th>
                {customerReturn.status === 'REQUESTED' ? (
                  <>
                    <th className="px-3 py-2 font-medium">Resalable</th>
                    <th className="px-3 py-2 font-medium">Damaged</th>
                    <th className="px-3 py-2 font-medium">Quarantine</th>
                    <th className="px-3 py-2 font-medium">Scrap</th>
                    <th className="px-3 py-2 font-medium">Credited Qty</th>
                  </>
                ) : (
                  <>
                    <th className="px-3 py-2 font-medium">Resalable</th>
                    <th className="px-3 py-2 font-medium">Damaged</th>
                    <th className="px-3 py-2 font-medium">Credited</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {customerReturn.items.map((item) => {
                const row = disposition[item.id];
                return (
                  <tr key={item.id} className="border-b border-border last:border-0">
                    <td className="px-3 py-2">{item.product.name}</td>
                    <td className="px-3 py-2">{item.quantityReturned}</td>
                    {customerReturn.status === 'REQUESTED' ? (
                      <>
                        <td className="px-3 py-1">
                          <Input
                            type="number"
                            step="any"
                            min="0"
                            className="h-7 w-20"
                            value={row?.resalable ?? item.quantityReturned}
                            onChange={(event) =>
                              updateRow(item.id, item.quantityReturned, {
                                resalable: Number(event.target.value) || 0,
                              })
                            }
                          />
                        </td>
                        <td className="px-3 py-1">
                          <Input
                            type="number"
                            step="any"
                            min="0"
                            className="h-7 w-20"
                            value={row?.damaged ?? 0}
                            onChange={(event) =>
                              updateRow(item.id, item.quantityReturned, {
                                damaged: Number(event.target.value) || 0,
                              })
                            }
                          />
                        </td>
                        <td className="px-3 py-1">
                          <Input
                            type="number"
                            step="any"
                            min="0"
                            className="h-7 w-20"
                            value={row?.quarantine ?? 0}
                            onChange={(event) =>
                              updateRow(item.id, item.quantityReturned, {
                                quarantine: Number(event.target.value) || 0,
                              })
                            }
                          />
                        </td>
                        <td className="px-3 py-1">
                          <Input
                            type="number"
                            step="any"
                            min="0"
                            className="h-7 w-20"
                            value={row?.scrap ?? 0}
                            onChange={(event) =>
                              updateRow(item.id, item.quantityReturned, {
                                scrap: Number(event.target.value) || 0,
                              })
                            }
                          />
                        </td>
                        <td className="px-3 py-1">
                          <Input
                            type="number"
                            step="any"
                            min="0"
                            className="h-7 w-24"
                            value={row?.credited ?? item.quantityReturned}
                            onChange={(event) =>
                              updateRow(item.id, item.quantityReturned, {
                                credited: Number(event.target.value) || 0,
                              })
                            }
                          />
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-3 py-2">{item.quantityResalable}</td>
                        <td className="px-3 py-2">{item.quantityDamaged}</td>
                        <td className="px-3 py-2">{item.quantityCredited}</td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {customerReturn.status === 'REQUESTED' && !dispositionSumsOk && (
          <p className="text-xs text-destructive">
            Resalable + Damaged + Quarantine + Scrap must add up to the returned quantity for every
            line.
          </p>
        )}

        {receiveMutation.isError && (
          <p className="text-sm text-destructive">
            {receiveMutation.error instanceof ApiError
              ? receiveMutation.error.message
              : 'Failed to receive return.'}
          </p>
        )}
        {cancelMutation.isError && (
          <p className="text-sm text-destructive">
            {cancelMutation.error instanceof ApiError
              ? cancelMutation.error.message
              : 'Failed to cancel return.'}
          </p>
        )}

        {customerReturn.status !== 'REQUESTED' && (
          <div className="space-y-1 rounded-md border border-border bg-muted/30 p-3">
            <Label className="text-xs text-muted-foreground">Accounting</Label>
            {receiveResult ? (
              <>
                <p>
                  COGS Reversal:{' '}
                  {receiveResult.journalEntry
                    ? `${receiveResult.journalEntry.journalNumber} · ${receiveResult.journalEntry.totalAmount.toFixed(2)}`
                    : 'No accounting entry (nothing resalable)'}
                </p>
                <p>
                  Credit Note:{' '}
                  {receiveResult.creditNote
                    ? `${receiveResult.creditNote.creditNoteCode} · ${receiveResult.creditNote.amount.toFixed(2)}`
                    : 'None issued'}
                </p>
              </>
            ) : (
              <p className="text-muted-foreground">
                Received — see Finance → Credit Notes / General Ledger for the posted entries.
              </p>
            )}
          </div>
        )}
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
          Close
        </Button>
        {customerReturn.status === 'REQUESTED' && (
          <>
            <Button
              type="button"
              variant="outline"
              onClick={() => cancelMutation.mutate()}
              disabled={cancelMutation.isPending}
            >
              {cancelMutation.isPending ? 'Cancelling…' : 'Cancel Return'}
            </Button>
            <Button
              type="button"
              onClick={() => receiveMutation.mutate()}
              disabled={!dispositionSumsOk || receiveMutation.isPending}
            >
              {receiveMutation.isPending ? 'Receiving…' : 'Receive & Settle'}
            </Button>
          </>
        )}
      </DialogFooter>
    </Dialog>
  );
}
