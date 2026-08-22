'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Badge, Input } from '@zentuva/ui';

import { FieldCard } from '@/components/field/FieldCard';

import { listCustomers, listSalesOrders } from './api';
import { SALES_ORDER_STATUS_LABELS, SALES_ORDER_STATUS_VARIANT } from './labels';

/**
 * Field Sales Home (Sprint 4.8 brief §20/§21) — the operational landing screen for a
 * sales agent: quick actions, a customer search box, recent customers, and today's
 * orders. Deliberately not analytics-heavy — no charts, no KPIs, just the fastest path
 * into the four common workflows.
 */
export default function FieldHomePage() {
  const { data: customersData } = useQuery({
    queryKey: ['customers'],
    queryFn: () => listCustomers(),
  });
  const { data: ordersData } = useQuery({
    queryKey: ['sales-orders'],
    queryFn: () => listSalesOrders(),
  });

  const recentCustomers = (customersData?.items ?? []).slice(0, 5);
  const recentOrders = (ordersData?.items ?? []).slice(0, 5);
  const today = new Date().toDateString();
  const todaysOrders = (ordersData?.items ?? []).filter(
    (order) => new Date(order.createdAt).toDateString() === today,
  );

  return (
    <div className="space-y-6 p-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Sales Home</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {todaysOrders.length} order{todaysOrders.length === 1 ? '' : 's'} today
        </p>
      </div>

      <Link href="/field/customers" className="block">
        <Input placeholder="Search a customer…" readOnly className="h-12 text-base" />
      </Link>

      <div className="grid grid-cols-3 gap-2">
        <Link
          href="/field/customers/new"
          className="flex flex-col items-center gap-1 rounded-xl border border-border bg-card p-3 text-center text-xs font-medium shadow-sm active:bg-muted/50"
        >
          <span className="text-2xl">＋</span>
          New Customer
        </Link>
        <Link
          href="/field/outlets/new"
          className="flex flex-col items-center gap-1 rounded-xl border border-border bg-card p-3 text-center text-xs font-medium shadow-sm active:bg-muted/50"
        >
          <span className="text-2xl">＋</span>
          New Outlet
        </Link>
        <Link
          href="/field/orders/new"
          className="flex flex-col items-center gap-1 rounded-xl border border-primary bg-primary/10 p-3 text-center text-xs font-medium text-primary shadow-sm active:bg-primary/20"
        >
          <span className="text-2xl">＋</span>
          New Order
        </Link>
      </div>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">Recent Customers</h2>
          <Link href="/field/customers" className="text-xs text-primary">
            See all
          </Link>
        </div>
        <div className="space-y-2">
          {recentCustomers.length === 0 && (
            <p className="text-sm text-muted-foreground">No customers yet.</p>
          )}
          {recentCustomers.map((customer) => (
            <FieldCard key={customer.id} href={`/field/customers/${customer.id}`}>
              <p className="font-medium">{customer.customerName}</p>
              <p className="text-xs text-muted-foreground">{customer.customerCode}</p>
            </FieldCard>
          ))}
        </div>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">Recent Orders</h2>
          <Link href="/field/orders" className="text-xs text-primary">
            See all
          </Link>
        </div>
        <div className="space-y-2">
          {recentOrders.length === 0 && (
            <p className="text-sm text-muted-foreground">No orders yet.</p>
          )}
          {recentOrders.map((order) => (
            <FieldCard key={order.id} href={`/field/orders/${order.id}`}>
              <div className="flex items-center justify-between">
                <p className="font-mono text-xs font-medium">{order.orderCode}</p>
                <Badge variant={SALES_ORDER_STATUS_VARIANT[order.status]}>
                  {SALES_ORDER_STATUS_LABELS[order.status]}
                </Badge>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {order.customer.customerName} · {order.total.toFixed(2)}
              </p>
            </FieldCard>
          ))}
        </div>
      </section>
    </div>
  );
}
