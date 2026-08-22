'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button } from '@zentuva/ui';

import { FieldCard } from '@/components/field/FieldCard';
import { FieldStickyActionBar } from '@/components/field/FieldStickyActionBar';

import { getCustomer, listOutlets, listSalesOrders } from '../../api';
import {
  CUSTOMER_STATUS_LABELS,
  CUSTOMER_STATUS_VARIANT,
  CUSTOMER_TYPE_LABELS,
  SALES_ORDER_STATUS_LABELS,
  SALES_ORDER_STATUS_VARIANT,
} from '../../labels';

/**
 * Customer detail (Sprint 4.8 brief §21): basic details, outlets, recent orders, and
 * clear next actions (Call, New Order, Add Outlet). No dense tables — cards throughout.
 */
export default function FieldCustomerDetailPage({ params }: { params: { id: string } }) {
  const { id } = params;

  const { data: customer } = useQuery({
    queryKey: ['customer', id],
    queryFn: () => getCustomer(id),
  });

  const { data: outletsData } = useQuery({
    queryKey: ['outlets', 'by-customer', id],
    queryFn: () => listOutlets({ customerId: id }),
  });
  const { data: ordersData } = useQuery({
    queryKey: ['sales-orders', 'by-customer', id],
    queryFn: () => listSalesOrders({ customerId: id }),
  });

  if (!customer) {
    return <p className="p-4 text-sm text-muted-foreground">Loading…</p>;
  }

  const outlets = outletsData?.items ?? [];
  const orders = ordersData?.items ?? [];

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-4 p-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">{customer.customerName}</h1>
            <Badge variant={CUSTOMER_STATUS_VARIANT[customer.status]}>
              {CUSTOMER_STATUS_LABELS[customer.status]}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {CUSTOMER_TYPE_LABELS[customer.customerType]} · {customer.customerCode}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <a href={`tel:${customer.phoneNumber}`}>
            <Button variant="outline" size="touch" className="w-full">
              Call {customer.phoneNumber}
            </Button>
          </a>
          <Link href={`/field/outlets/new?customerId=${customer.id}`}>
            <Button variant="outline" size="touch" className="w-full">
              Add Outlet
            </Button>
          </Link>
        </div>

        <section>
          <h2 className="mb-2 text-sm font-semibold text-foreground">Outlets ({outlets.length})</h2>
          <div className="space-y-2">
            {outlets.length === 0 && (
              <p className="text-sm text-muted-foreground">No outlets yet.</p>
            )}
            {outlets.map((outlet) => (
              <FieldCard key={outlet.id} href={`/field/outlets/${outlet.id}`}>
                <p className="font-medium">{outlet.name}</p>
                <p className="text-xs text-muted-foreground">
                  {outlet.photos.length} photo{outlet.photos.length === 1 ? '' : 's'}
                </p>
              </FieldCard>
            ))}
          </div>
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold text-foreground">
            Recent Orders ({orders.length})
          </h2>
          <div className="space-y-2">
            {orders.length === 0 && <p className="text-sm text-muted-foreground">No orders yet.</p>}
            {orders.slice(0, 5).map((order) => (
              <FieldCard key={order.id} href={`/field/orders/${order.id}`}>
                <div className="flex items-center justify-between">
                  <p className="font-mono text-xs font-medium">{order.orderCode}</p>
                  <Badge variant={SALES_ORDER_STATUS_VARIANT[order.status]}>
                    {SALES_ORDER_STATUS_LABELS[order.status]}
                  </Badge>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">{order.total.toFixed(2)}</p>
              </FieldCard>
            ))}
          </div>
        </section>
      </div>

      <FieldStickyActionBar>
        <Link href={`/field/orders/new?customerId=${customer.id}`} className="w-full">
          <Button size="touch" className="w-full">
            + New Order
          </Button>
        </Link>
      </FieldStickyActionBar>
    </div>
  );
}
