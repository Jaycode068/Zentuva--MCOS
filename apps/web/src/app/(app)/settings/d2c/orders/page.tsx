'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button, Input, Select } from '@zentuva/ui';

import { D2cTabs } from '@/components/app/d2c-tabs';
import { ApiError } from '@/lib/api-client';

import { listTerritories } from '../../retail/api';
import { D2COrderStatus, D2CPaymentStatus, listD2COrders } from '../api';

const PAGE_SIZE = 20;

const STATUS_OPTIONS: D2COrderStatus[] = [
  'DRAFT',
  'CONFIRMED',
  'PARTIALLY_FULFILLED',
  'FULFILLED',
  'CANCELLED',
];
const PAYMENT_STATUS_OPTIONS: D2CPaymentStatus[] = [
  'PENDING',
  'RECORDED',
  'FAILED',
  'VOIDED',
  'CLOSED',
  'NONE',
];

/**
 * Sprint 39 — D2C Sales Administration & Operations Dashboard
 * (docs/domains/d2c.md). The D2C slice of the existing `SalesOrder` aggregate
 * (`source: 'D2C'`, forced server-side by `D2CAdminService.listOrders` —
 * never a parallel order list). Status/payment/territory/collection-point/
 * date-range filters plus server-side pagination, the exact
 * `settings/hr/employees` table convention.
 */
export default function D2COrdersPage() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<D2COrderStatus | ''>('');
  const [paymentStatus, setPaymentStatus] = useState<D2CPaymentStatus | ''>('');
  const [territoryId, setTerritoryId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);

  const { data: territoriesData } = useQuery({
    queryKey: ['territories'],
    queryFn: () => listTerritories({ status: 'ACTIVE' }),
  });
  const territories = territoriesData?.items ?? [];

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: [
      'd2c-admin-orders',
      search,
      status,
      paymentStatus,
      territoryId,
      dateFrom,
      dateTo,
      page,
    ],
    queryFn: () =>
      listD2COrders({
        search: search || undefined,
        status: status || undefined,
        paymentStatus: paymentStatus || undefined,
        territoryId: territoryId || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        page,
        pageSize: PAGE_SIZE,
      }),
  });

  const orders = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function resetPage<T>(setter: (value: T) => void) {
    return (value: T) => {
      setPage(1);
      setter(value);
    };
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">D2C Orders</h1>
        <p className="text-sm text-muted-foreground">
          Every direct-to-consumer order — status, payment, territory, and date filters.
        </p>
      </div>

      <D2cTabs />

      <div className="flex flex-wrap gap-3">
        <Input
          placeholder="Search order code or consumer…"
          value={search}
          onChange={(e) => resetPage(setSearch)(e.target.value)}
          className="max-w-xs"
        />
        <Select
          value={status}
          onChange={(e) => resetPage(setStatus)(e.target.value as D2COrderStatus | '')}
          className="max-w-[10rem]"
        >
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, ' ')}
            </option>
          ))}
        </Select>
        <Select
          value={paymentStatus}
          onChange={(e) => resetPage(setPaymentStatus)(e.target.value as D2CPaymentStatus | '')}
          className="max-w-[10rem]"
        >
          <option value="">All payment statuses</option>
          {PAYMENT_STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s === 'NONE' ? 'No payment' : s}
            </option>
          ))}
        </Select>
        <Select
          value={territoryId}
          onChange={(e) => resetPage(setTerritoryId)(e.target.value)}
          className="max-w-[10rem]"
        >
          <option value="">All territories</option>
          {territories.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
        <Input
          type="date"
          value={dateFrom}
          onChange={(e) => resetPage(setDateFrom)(e.target.value)}
          className="max-w-[9.5rem]"
        />
        <Input
          type="date"
          value={dateTo}
          onChange={(e) => resetPage(setDateTo)(e.target.value)}
          className="max-w-[9.5rem]"
        />
      </div>

      {isLoading && <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>}
      {isError && (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <p className="text-sm text-destructive">
            {error instanceof ApiError ? error.message : 'Failed to load orders.'}
          </p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      )}

      {!isLoading && !isError && orders.length === 0 && (
        <p className="py-10 text-center text-sm text-muted-foreground">
          No D2C orders match these filters.
        </p>
      )}

      {!isLoading && !isError && orders.length > 0 && (
        <>
          <div className="hidden overflow-x-auto rounded-lg border border-border md:block">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Order</th>
                  <th className="px-4 py-3">Consumer</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Total</th>
                  <th className="px-4 py-3">Date</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr
                    key={order.id}
                    className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/30"
                    onClick={() => window.location.assign(`/settings/d2c/orders/${order.id}`)}
                  >
                    <td className="px-4 py-3 font-mono">{order.orderCode}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {order.consumer?.fullName ?? '—'}
                    </td>
                    <td className="px-4 py-3">
                      <Badge>{order.status.replace(/_/g, ' ')}</Badge>
                    </td>
                    <td className="px-4 py-3">{order.total.toLocaleString()}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {new Date(order.orderDate).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-2 md:hidden">
            {orders.map((order) => (
              <button
                key={order.id}
                type="button"
                onClick={() => window.location.assign(`/settings/d2c/orders/${order.id}`)}
                className="w-full rounded-lg border border-border p-3 text-left"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="font-mono text-sm">{order.orderCode}</p>
                  <Badge>{order.status.replace(/_/g, ' ')}</Badge>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {order.consumer?.fullName ?? 'No consumer'} · {order.total.toLocaleString()}
                </p>
              </button>
            ))}
          </div>

          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <p>
              Page {page} of {totalPages} · {total} order{total === 1 ? '' : 's'}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
