'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Input, Select } from '@zentuva/ui';

import { CartIcon } from '@/components/workspace/icons';
import { ApiError } from '@/lib/api-client';

import {
  createWorkflowInstance,
  listWorkflowInstances,
  resubmitWorkflowInstance,
  submitWorkflowInstance,
} from '../workflows/api';
import { listSuppliers } from '../suppliers/api';
import { cancelPurchaseOrder, listPurchaseOrders, type PurchaseOrder } from './api';
import { EDITABLE_STATUSES, formatCurrency, STATUS_LABELS, STATUS_VARIANT } from './labels';
import { PurchaseOrderDialog } from './purchase-order-dialog';

export default function ProcurementSettingsPage() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['purchase-orders'],
    queryFn: () => listPurchaseOrders(),
  });
  const { data: suppliersData } = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => listSuppliers(),
  });
  /** Sprint 26.1 §3 — a DRAFT purchase order that came back from a `RETURNED`
   *  workflow needs `resubmit()` (preserving the linked history), not a brand-new,
   *  unlinked `create()+submit()` — this map lets the row-level button below tell the
   *  two cases apart. */
  const { data: returnedWorkflowsData } = useQuery({
    queryKey: ['workflow-instances', 'RETURNED', 'PURCHASE_ORDER'],
    queryFn: () => listWorkflowInstances({ status: 'RETURNED', subjectType: 'PURCHASE_ORDER' }),
  });
  const returnedInstanceBySubjectId = useMemo(() => {
    const map = new Map<string, string>();
    for (const instance of returnedWorkflowsData?.items ?? []) {
      map.set(instance.subjectId, instance.id);
    }
    return map;
  }, [returnedWorkflowsData]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'' | PurchaseOrder['status']>('');
  const [supplierFilter, setSupplierFilter] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editingOrder, setEditingOrder] = useState<PurchaseOrder | null>(null);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
    queryClient.invalidateQueries({ queryKey: ['workflow-instances'] });
  };

  const cancelMutation = useMutation({
    mutationFn: (id: string) => cancelPurchaseOrder(id),
    onSuccess: invalidate,
  });

  /** Sprint 26 (docs/domains/workflow.md §8) — creates and immediately submits a
   *  `PURCHASE_ORDER_APPROVAL` workflow instance for this DRAFT order. Fails
   *  gracefully (surfaces the error inline) if the organisation has no ACTIVE
   *  `PURCHASE_ORDER_APPROVAL` workflow definition configured. */
  const submitForApprovalMutation = useMutation({
    mutationFn: async (id: string) => {
      const instance = await createWorkflowInstance({
        workflowDefinitionCode: 'PURCHASE_ORDER_APPROVAL',
        subjectType: 'PURCHASE_ORDER',
        subjectId: id,
      });
      return submitWorkflowInstance(instance.id);
    },
    onSuccess: invalidate,
  });

  /** Sprint 26.1 §3 — resubmits the linked `RETURNED` workflow instance rather than
   *  starting a brand-new, unlinked one; see `returnedInstanceBySubjectId` above. */
  const resubmitForApprovalMutation = useMutation({
    mutationFn: (returnedInstanceId: string) => resubmitWorkflowInstance(returnedInstanceId),
    onSuccess: invalidate,
  });

  const suppliers = suppliersData?.items ?? [];
  const purchaseOrders = useMemo(() => data?.items ?? [], [data]);
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return purchaseOrders.filter((po) => {
      if (statusFilter && po.status !== statusFilter) return false;
      if (supplierFilter && po.supplier.id !== supplierFilter) return false;
      if (!query) return true;
      return (
        po.purchaseOrderNumber.toLowerCase().includes(query) ||
        po.supplier.supplierName.toLowerCase().includes(query)
      );
    });
  }, [purchaseOrders, search, statusFilter, supplierFilter]);

  if (isLoading) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-10 text-sm text-muted-foreground">
        Loading purchase orders…
      </main>
    );
  }

  if (isError) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-10">
        <p className="text-sm text-destructive">
          {error instanceof ApiError ? error.message : 'Failed to load purchase orders.'}
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Procurement</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Purchase orders for the raw materials, packaging, and supplies your organisation buys.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>Create Purchase Order</Button>
      </div>

      {cancelMutation.isError && (
        <p className="mb-4 text-sm text-destructive">
          {cancelMutation.error instanceof ApiError
            ? cancelMutation.error.message
            : 'Failed to cancel purchase order.'}
        </p>
      )}
      {submitForApprovalMutation.isError && (
        <p className="mb-4 text-sm text-destructive">
          {submitForApprovalMutation.error instanceof ApiError
            ? submitForApprovalMutation.error.message
            : 'Failed to submit purchase order for approval.'}
        </p>
      )}
      {resubmitForApprovalMutation.isError && (
        <p className="mb-4 text-sm text-destructive">
          {resubmitForApprovalMutation.error instanceof ApiError
            ? resubmitForApprovalMutation.error.message
            : 'Failed to resubmit purchase order for approval.'}
        </p>
      )}

      {purchaseOrders.length === 0 ? (
        <EmptyPurchaseOrders onCreate={() => setCreateOpen(true)} />
      ) : (
        <>
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Input
              placeholder="Search by PO number or supplier…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="max-w-sm"
            />
            <Select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
              className="max-w-[10rem]"
            >
              <option value="">All statuses</option>
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
            <Select
              value={supplierFilter}
              onChange={(event) => setSupplierFilter(event.target.value)}
              className="max-w-[12rem]"
            >
              <option value="">All suppliers</option>
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.supplierName}
                </option>
              ))}
            </Select>
          </div>

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/50 text-left">
                <tr>
                  <th className="px-4 py-3 font-medium">PO Number</th>
                  <th className="px-4 py-3 font-medium">Supplier</th>
                  <th className="px-4 py-3 font-medium">Order Date</th>
                  <th className="px-4 py-3 font-medium">Expected Delivery</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Total</th>
                  <th className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((po) => {
                  const editable = EDITABLE_STATUSES.includes(po.status);
                  return (
                    <tr key={po.id} className="border-b border-border last:border-0">
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => setEditingOrder(po)}
                          className="font-mono text-xs font-medium text-foreground hover:underline"
                        >
                          {po.purchaseOrderNumber}
                        </button>
                      </td>
                      <td className="px-4 py-3">{po.supplier.supplierName}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {new Date(po.orderDate).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {po.expectedDeliveryDate
                          ? new Date(po.expectedDeliveryDate).toLocaleDateString()
                          : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={STATUS_VARIANT[po.status]}>
                          {STATUS_LABELS[po.status]}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">{formatCurrency(po.total)}</td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-2">
                          <Button variant="outline" size="sm" onClick={() => setEditingOrder(po)}>
                            {editable ? 'Edit' : 'View'}
                          </Button>
                          {po.status === 'DRAFT' &&
                            (returnedInstanceBySubjectId.has(po.id) ? (
                              <Button
                                size="sm"
                                disabled={resubmitForApprovalMutation.isPending}
                                onClick={() =>
                                  resubmitForApprovalMutation.mutate(
                                    returnedInstanceBySubjectId.get(po.id) as string,
                                  )
                                }
                              >
                                Resubmit for Approval
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                disabled={submitForApprovalMutation.isPending}
                                onClick={() => submitForApprovalMutation.mutate(po.id)}
                              >
                                Submit for Approval
                              </Button>
                            ))}
                          {editable && (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={cancelMutation.isPending}
                              onClick={() => cancelMutation.mutate(po.id)}
                            >
                              Cancel
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                      No purchase orders match your search or filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {createOpen && (
        <PurchaseOrderDialog
          purchaseOrder={null}
          onOpenChange={() => setCreateOpen(false)}
          onSaved={invalidate}
        />
      )}
      {editingOrder && (
        <PurchaseOrderDialog
          purchaseOrder={editingOrder}
          onOpenChange={() => setEditingOrder(null)}
          onSaved={invalidate}
        />
      )}
    </main>
  );
}

function EmptyPurchaseOrders({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed border-border px-6 py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
        <CartIcon className="h-6 w-6" />
      </div>
      <div>
        <h2 className="text-base font-semibold text-foreground">No purchase orders yet</h2>
        <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
          Create your first purchase order to start ordering raw materials, packaging, and supplies
          from your suppliers.
        </p>
      </div>
      <Button onClick={onCreate}>Create Your First Purchase Order</Button>
    </div>
  );
}
