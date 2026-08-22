'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button, Select } from '@zentuva/ui';

import { FieldCard } from '@/components/field/FieldCard';
import { FieldStickyActionBar } from '@/components/field/FieldStickyActionBar';

import { listSalesOrders, type SalesOrderStatus } from '../api';
import { SALES_ORDER_STATUS_LABELS, SALES_ORDER_STATUS_VARIANT } from '../labels';

/** Order history card list (Sprint 4.8 brief §20) — status filter only, no dense table. */
export default function FieldOrdersPage() {
  const [statusFilter, setStatusFilter] = useState<'' | SalesOrderStatus>('');
  const { data, isLoading } = useQuery({
    queryKey: ['sales-orders', 'field', statusFilter],
    queryFn: () => listSalesOrders({ status: statusFilter || undefined }),
  });

  const orders = data?.items ?? [];

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-3 p-4">
        <h1 className="text-xl font-semibold tracking-tight">Orders</h1>
        <Select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
          className="h-12 text-base"
        >
          <option value="">All statuses</option>
          {Object.entries(SALES_ORDER_STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </div>

      <div className="flex-1 space-y-2 px-4 pb-4">
        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {!isLoading && orders.length === 0 && (
          <p className="py-10 text-center text-sm text-muted-foreground">No orders found.</p>
        )}
        {orders.map((order) => (
          <FieldCard key={order.id} href={`/field/orders/${order.id}`}>
            <div className="flex items-center justify-between">
              <p className="font-mono text-xs font-medium">{order.orderCode}</p>
              <Badge variant={SALES_ORDER_STATUS_VARIANT[order.status]}>
                {SALES_ORDER_STATUS_LABELS[order.status]}
              </Badge>
            </div>
            <p className="mt-0.5 text-sm">{order.customer.customerName}</p>
            <p className="text-xs text-muted-foreground">{order.total.toFixed(2)}</p>
          </FieldCard>
        ))}
      </div>

      <FieldStickyActionBar>
        <Link href="/field/orders/new" className="w-full">
          <Button size="touch" className="w-full">
            + New Order
          </Button>
        </Link>
      </FieldStickyActionBar>
    </div>
  );
}
