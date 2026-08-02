'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Input, Select } from '@zentuva/ui';

import { CartIcon } from '@/components/workspace/icons';
import { ApiError } from '@/lib/api-client';

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
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'' | PurchaseOrder['status']>('');
  const [supplierFilter, setSupplierFilter] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editingOrder, setEditingOrder] = useState<PurchaseOrder | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => cancelPurchaseOrder(id),
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
