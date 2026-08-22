'use client';

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Input, Select } from '@zentuva/ui';

import { TrendingUpIcon } from '@/components/workspace/icons';
import { ApiError } from '@/lib/api-client';

import { listSalesOrders, type SalesOrder, type SalesOrderStatus } from './api';
import { SALES_ORDER_STATUS_LABELS, SALES_ORDER_STATUS_VARIANT } from './labels';
import { SalesOrderDetailDialog } from './sales-order-detail-dialog';
import { SalesOrderDialog } from './sales-order-dialog';

/**
 * Sales (Sprint 4.8, docs/domains/sales.md) — the Admin surface for Sales Order
 * management. Creating or confirming an order here never touches inventory; see
 * `apps/web/src/app/(field)/` for the mobile-first Field Sales counterpart hitting the
 * same backend.
 */
export default function SalesSettingsPage() {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'' | SalesOrderStatus>('');

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['sales-orders'],
    queryFn: () => listSalesOrders(),
  });

  const orders = useMemo(() => data?.items ?? [], [data]);
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return orders.filter((order) => {
      if (statusFilter && order.status !== statusFilter) return false;
      if (!query) return true;
      return (
        order.orderCode.toLowerCase().includes(query) ||
        order.customer.customerName.toLowerCase().includes(query)
      );
    });
  }, [orders, search, statusFilter]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['sales-orders'] });

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Sales</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Sales orders record customer demand — inventory is never deducted or reserved when an
            order is created or confirmed.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>Create Sales Order</Button>
      </div>

      {isLoading && (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading sales orders…</p>
      )}
      {isError && (
        <p className="py-10 text-center text-sm text-destructive">
          {error instanceof ApiError ? error.message : 'Failed to load sales orders.'}
        </p>
      )}

      {!isLoading && !isError && orders.length === 0 && (
        <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed border-border px-6 py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <TrendingUpIcon className="h-6 w-6" />
          </div>
          <h2 className="text-base font-semibold text-foreground">No sales orders yet</h2>
          <Button onClick={() => setCreateOpen(true)}>Create Your First Sales Order</Button>
        </div>
      )}

      {!isLoading && !isError && orders.length > 0 && (
        <>
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Input
              placeholder="Search by order code or customer…"
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
              {Object.entries(SALES_ORDER_STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </div>

          <div className="hidden overflow-x-auto rounded-lg border border-border md:block">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/50 text-left">
                <tr>
                  <th className="px-4 py-3 font-medium">Order Code</th>
                  <th className="px-4 py-3 font-medium">Customer</th>
                  <th className="px-4 py-3 font-medium">Outlet</th>
                  <th className="px-4 py-3 font-medium">Total</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((order) => (
                  <SalesOrderRow
                    key={order.id}
                    order={order}
                    onSelect={() => setSelectedOrderId(order.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-2 md:hidden">
            {filtered.map((order) => (
              <button
                key={order.id}
                type="button"
                onClick={() => setSelectedOrderId(order.id)}
                className="w-full rounded-lg border border-border p-3 text-left"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-medium">{order.orderCode}</span>
                  <Badge variant={SALES_ORDER_STATUS_VARIANT[order.status]}>
                    {SALES_ORDER_STATUS_LABELS[order.status]}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {order.customer.customerName} · {order.total.toFixed(2)}
                </p>
              </button>
            ))}
          </div>
        </>
      )}

      {createOpen && (
        <SalesOrderDialog onOpenChange={() => setCreateOpen(false)} onSaved={invalidate} />
      )}
      {selectedOrderId && (
        <SalesOrderDetailDialog
          salesOrderId={selectedOrderId}
          onOpenChange={() => setSelectedOrderId(null)}
          onChanged={invalidate}
        />
      )}
    </main>
  );
}

function SalesOrderRow({ order, onSelect }: { order: SalesOrder; onSelect: () => void }) {
  return (
    <tr className="border-b border-border last:border-0">
      <td className="px-4 py-3">
        <button
          type="button"
          onClick={onSelect}
          className="font-mono text-xs font-medium text-foreground hover:underline"
        >
          {order.orderCode}
        </button>
      </td>
      <td className="px-4 py-3">{order.customer.customerName}</td>
      <td className="px-4 py-3 text-muted-foreground">{order.outlet?.name ?? '—'}</td>
      <td className="px-4 py-3">{order.total.toFixed(2)}</td>
      <td className="px-4 py-3">
        <Badge variant={SALES_ORDER_STATUS_VARIANT[order.status]}>
          {SALES_ORDER_STATUS_LABELS[order.status]}
        </Badge>
      </td>
      <td className="px-4 py-3 text-right">
        <Button variant="outline" size="sm" onClick={onSelect}>
          View
        </Button>
      </td>
    </tr>
  );
}
