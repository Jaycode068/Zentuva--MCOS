'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Dialog, DialogFooter, DialogHeader, DialogTitle } from '@zentuva/ui';
import Link from 'next/link';

import { ApiError } from '@/lib/api-client';
import { formatCurrency } from '@/lib/format-currency';

import {
  cancelProductionOrder,
  getProductionAccountingSummary,
  getProductionOrder,
  getProductionOrderAvailability,
  listMaterialIssues,
  planProductionOrder,
} from './api';
import { MaterialIssueDialog } from './material-issue-dialog';
import {
  PRODUCTION_ORDER_STATUS_LABELS,
  PRODUCTION_ORDER_STATUS_VARIANT,
  REJECTION_REASON_LABELS,
} from './labels';
import { ProductionOrderDialog } from './production-order-dialog';
import { ProductionRunDialog } from './production-run-dialog';

/**
 * Production Order detail view (Sprint 4.6 brief §6–§19) — requirement snapshot with a
 * live Required/Available/Shortfall availability check (informational only, brief §9:
 * never gates any transition below), material issue history, the production run result
 * once completed, and the action buttons for every reachable transition
 * (`DRAFT→PLANNED→IN_PROGRESS→COMPLETED`, `CANCELLED` only from `DRAFT`/`PLANNED`). Built
 * on the shared `Dialog` modal, same "no separate drawer primitive" convention as
 * `ProductViewDialog`.
 */
export function ProductionOrderDetailDialog({
  productionOrderId,
  onOpenChange,
  onChanged,
}: {
  productionOrderId: string;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  const queryClient = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [issueOpen, setIssueOpen] = useState(false);
  const [completeOpen, setCompleteOpen] = useState(false);

  const { data: order, isLoading } = useQuery({
    queryKey: ['production-order', productionOrderId],
    queryFn: () => getProductionOrder(productionOrderId),
  });
  const { data: availabilityData } = useQuery({
    queryKey: ['production-order-availability', productionOrderId],
    queryFn: () => getProductionOrderAvailability(productionOrderId),
    enabled: order?.status !== 'COMPLETED' && order?.status !== 'CANCELLED',
  });
  const { data: issuesData } = useQuery({
    queryKey: ['material-issues', productionOrderId],
    queryFn: () => listMaterialIssues(productionOrderId),
    enabled: order != null && order.status !== 'DRAFT',
  });
  // Sprint 9 — brief §14: a read-only summary of this order's accounting
  // consequence, not a Finance workspace embedded in Production.
  const { data: accounting } = useQuery({
    queryKey: ['production-order-accounting', productionOrderId],
    queryFn: () => getProductionAccountingSummary(productionOrderId),
    enabled: order != null && order.status !== 'DRAFT',
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['production-order', productionOrderId] });
    queryClient.invalidateQueries({
      queryKey: ['production-order-availability', productionOrderId],
    });
    queryClient.invalidateQueries({ queryKey: ['material-issues', productionOrderId] });
    queryClient.invalidateQueries({ queryKey: ['production-order-accounting', productionOrderId] });
    queryClient.invalidateQueries({ queryKey: ['inventory-stock'] });
    queryClient.invalidateQueries({ queryKey: ['inventory-transactions'] });
    onChanged();
  };

  const planMutation = useMutation({
    mutationFn: () => planProductionOrder(productionOrderId),
    onSuccess: invalidate,
  });
  const cancelMutation = useMutation({
    mutationFn: () => cancelProductionOrder(productionOrderId),
    onSuccess: invalidate,
  });

  if (isLoading || !order) {
    return (
      <Dialog open onOpenChange={onOpenChange}>
        <DialogHeader>
          <DialogTitle>Production Order</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">Loading…</p>
      </Dialog>
    );
  }

  const availability = availabilityData?.items ?? [];
  const issues = issuesData?.items ?? [];
  const mutationError = planMutation.error ?? cancelMutation.error;

  return (
    <>
      <Dialog open onOpenChange={onOpenChange}>
        <DialogHeader>
          <DialogTitle>Production Order — {order.productionOrderNumber}</DialogTitle>
        </DialogHeader>

        <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="font-medium text-foreground">{order.product.name}</div>
              <div className="text-xs text-muted-foreground">
                {order.billOfMaterial.bomNumber} · {order.location.name} · Planned{' '}
                {order.plannedQuantity} {order.product.unit}
              </div>
            </div>
            <Badge variant={PRODUCTION_ORDER_STATUS_VARIANT[order.status]}>
              {PRODUCTION_ORDER_STATUS_LABELS[order.status]}
            </Badge>
          </div>

          {order.notes && <p className="text-xs text-muted-foreground">Notes: {order.notes}</p>}

          <div className="space-y-2">
            <p className="font-medium text-foreground">Material Requirements</p>
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <thead className="border-b border-border bg-muted/50 text-left">
                  <tr>
                    <th className="px-3 py-2 font-medium">Component</th>
                    <th className="px-3 py-2 font-medium">Required</th>
                    {availability.length > 0 && (
                      <>
                        <th className="px-3 py-2 font-medium">Available</th>
                        <th className="px-3 py-2 font-medium">Shortfall</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {order.items.map((item) => {
                    const row = availability.find(
                      (a) => a.componentProductId === item.componentProduct.id,
                    );
                    return (
                      <tr key={item.id} className="border-b border-border last:border-0">
                        <td className="px-3 py-2">
                          {item.componentProduct.name}{' '}
                          <span className="text-xs text-muted-foreground">
                            ({item.componentProduct.unit})
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          {item.requiredQuantity} {item.unitOfMeasure}
                        </td>
                        {availability.length > 0 && (
                          <>
                            <td className="px-3 py-2">
                              {row?.availableQuantity ?? '—'} {item.unitOfMeasure}
                            </td>
                            <td className="px-3 py-2">
                              {row && row.shortfall > 0 ? (
                                <Badge variant="warning">
                                  {row.shortfall} {item.unitOfMeasure} short
                                </Badge>
                              ) : (
                                '—'
                              )}
                            </td>
                          </>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {availability.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Availability is informational only — it never blocks planning, issuing, or
                completing this order.
              </p>
            )}
          </div>

          {order.status !== 'DRAFT' && (
            <div className="space-y-2">
              <p className="font-medium text-foreground">Material Issue History</p>
              {issues.length === 0 ? (
                <p className="text-xs text-muted-foreground">No material has been issued yet.</p>
              ) : (
                <div className="space-y-2">
                  {issues.map((issue) => (
                    <div key={issue.id} className="rounded-md border border-border p-2">
                      <div className="mb-1 text-xs text-muted-foreground">
                        {new Date(issue.issuedDate).toLocaleDateString()}
                        {issue.notes && ` — ${issue.notes}`}
                      </div>
                      <ul className="space-y-0.5 text-xs">
                        {issue.items.map((item) => (
                          <li key={item.id}>
                            {item.componentProduct.name}: {item.quantityIssued}{' '}
                            {item.componentProduct.unit}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {order.productionRun && (
            <div className="space-y-2">
              <p className="font-medium text-foreground">Production Result</p>
              <div className="grid grid-cols-3 gap-x-4 gap-y-1 rounded-md bg-muted/30 p-2 text-xs text-muted-foreground">
                <div>
                  Produced
                  <div className="font-medium text-foreground">
                    {order.productionRun.producedQuantity}
                  </div>
                </div>
                <div>
                  Rejected
                  <div className="font-medium text-foreground">
                    {order.productionRun.rejectedQuantity}
                  </div>
                </div>
                <div>
                  Accepted
                  <div className="font-medium text-foreground">
                    {order.productionRun.acceptedQuantity}
                  </div>
                </div>
              </div>
              {order.productionRun.rejectionReason && (
                <p className="text-xs text-muted-foreground">
                  Rejection reason: {REJECTION_REASON_LABELS[order.productionRun.rejectionReason]}
                  {order.productionRun.rejectionNotes && ` — ${order.productionRun.rejectionNotes}`}
                </p>
              )}
            </div>
          )}

          {order.status !== 'DRAFT' && accounting && (
            <div className="space-y-2">
              <p className="font-medium text-foreground">Accounting</p>
              <div className="rounded-md bg-muted/30 p-2 text-xs text-muted-foreground">
                Material Cost
                <div className="font-medium text-foreground">
                  {formatCurrency(accounting.materialCost, 'NGN')}
                </div>
              </div>
              {accounting.journalEntries.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No accounting entry yet — nothing has been issued with a known cost.
                </p>
              ) : (
                <ul className="space-y-1 text-xs">
                  {accounting.journalEntries.map((journalEntry) => (
                    <li key={journalEntry.id}>
                      <Link
                        href="/settings/finance/journal-entries"
                        className="font-medium text-foreground underline-offset-2 hover:underline"
                      >
                        {journalEntry.journalNumber}
                      </Link>{' '}
                      · {journalEntry.status} · {formatCurrency(journalEntry.totalAmount, 'NGN')}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {mutationError && (
            <p className="text-sm text-destructive">
              {mutationError instanceof ApiError
                ? mutationError.message
                : 'Failed to update production order.'}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          {order.status === 'DRAFT' && (
            <Button type="button" variant="outline" onClick={() => setEditOpen(true)}>
              Edit
            </Button>
          )}
          {(order.status === 'DRAFT' || order.status === 'PLANNED') && (
            <Button
              type="button"
              variant="outline"
              disabled={cancelMutation.isPending}
              onClick={() => cancelMutation.mutate()}
            >
              {cancelMutation.isPending ? 'Cancelling…' : 'Cancel Order'}
            </Button>
          )}
          {order.status === 'DRAFT' && (
            <Button
              type="button"
              disabled={planMutation.isPending}
              onClick={() => planMutation.mutate()}
            >
              {planMutation.isPending ? 'Planning…' : 'Plan'}
            </Button>
          )}
          {(order.status === 'PLANNED' || order.status === 'IN_PROGRESS') && (
            <Button type="button" onClick={() => setIssueOpen(true)}>
              Issue Material
            </Button>
          )}
          {order.status === 'IN_PROGRESS' && (
            <Button type="button" onClick={() => setCompleteOpen(true)}>
              Complete Production
            </Button>
          )}
        </DialogFooter>
      </Dialog>

      {editOpen && (
        <ProductionOrderDialog
          productionOrder={order}
          onOpenChange={() => setEditOpen(false)}
          onSaved={invalidate}
        />
      )}
      {issueOpen && (
        <MaterialIssueDialog
          productionOrder={order}
          onOpenChange={() => setIssueOpen(false)}
          onIssued={() => {
            invalidate();
            setIssueOpen(false);
          }}
        />
      )}
      {completeOpen && (
        <ProductionRunDialog
          productionOrder={order}
          onOpenChange={() => setCompleteOpen(false)}
          onCompleted={() => {
            invalidate();
            setCompleteOpen(false);
          }}
        />
      )}
    </>
  );
}
