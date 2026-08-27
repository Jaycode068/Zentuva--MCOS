'use client';

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Input } from '@zentuva/ui';

import { RotateCcwIcon } from '@/components/workspace/icons';
import { ApiError } from '@/lib/api-client';

import {
  listCustomerReturns,
  listSupplierReturns,
  type CustomerReturn,
  type SupplierReturn,
} from './api';
import {
  CUSTOMER_RETURN_REASON_LABELS,
  CUSTOMER_RETURN_STATUS_LABELS,
  CUSTOMER_RETURN_STATUS_VARIANT,
  SUPPLIER_RETURN_REASON_LABELS,
} from './labels';
import { CreateCustomerReturnDialog } from './create-customer-return-dialog';
import { CreateSupplierReturnDialog } from './create-supplier-return-dialog';
import { CustomerReturnDetailDialog } from './customer-return-detail-dialog';
import { SupplierReturnDetailDialog } from './supplier-return-detail-dialog';

type Tab = 'customer' | 'supplier';

/**
 * Returns (Sprint 11, docs/domains/sales.md "Customer Returns",
 * docs/domains/procurement.md "Supplier Returns") — the Admin surface for both return
 * types. Customer Returns are two-phase (Requested → Received); Supplier Returns are a
 * single atomic write. Neither ever edits the original Sales Fulfilment/Goods Receipt —
 * both are new, independently auditable events (brief's central architectural rule).
 */
export default function ReturnsSettingsPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('customer');
  const [createCustomerOpen, setCreateCustomerOpen] = useState(false);
  const [createSupplierOpen, setCreateSupplierOpen] = useState(false);
  const [selectedCustomerReturnId, setSelectedCustomerReturnId] = useState<string | null>(null);
  const [selectedSupplierReturnId, setSelectedSupplierReturnId] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const customerReturnsQuery = useQuery({
    queryKey: ['customer-returns'],
    queryFn: () => listCustomerReturns(),
    enabled: tab === 'customer',
  });
  const supplierReturnsQuery = useQuery({
    queryKey: ['supplier-returns'],
    queryFn: () => listSupplierReturns(),
    enabled: tab === 'supplier',
  });

  const filteredCustomerReturns = useMemo(() => {
    const query = search.trim().toLowerCase();
    const items = customerReturnsQuery.data?.items ?? [];
    if (!query) return items;
    return items.filter(
      (row) =>
        row.returnCode.toLowerCase().includes(query) ||
        row.customer.customerName.toLowerCase().includes(query),
    );
  }, [customerReturnsQuery.data, search]);

  const filteredSupplierReturns = useMemo(() => {
    const query = search.trim().toLowerCase();
    const items = supplierReturnsQuery.data?.items ?? [];
    if (!query) return items;
    return items.filter(
      (row) =>
        row.returnCode.toLowerCase().includes(query) ||
        row.supplier.supplierName.toLowerCase().includes(query),
    );
  }, [supplierReturnsQuery.data, search]);

  const invalidateCustomer = () => {
    queryClient.invalidateQueries({ queryKey: ['customer-returns'] });
    queryClient.invalidateQueries({ queryKey: ['inventory-stock'] });
  };
  const invalidateSupplier = () => {
    queryClient.invalidateQueries({ queryKey: ['supplier-returns'] });
    queryClient.invalidateQueries({ queryKey: ['inventory-stock'] });
    queryClient.invalidateQueries({ queryKey: ['goods-receipts'] });
  };

  const activeQuery = tab === 'customer' ? customerReturnsQuery : supplierReturnsQuery;

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Returns</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Returns never edit an original Sales Fulfilment or Goods Receipt — each is a new,
            independently auditable event that reverses the physical and financial consequences of
            the original one.
          </p>
        </div>
        <Button
          onClick={() =>
            tab === 'customer' ? setCreateCustomerOpen(true) : setCreateSupplierOpen(true)
          }
        >
          {tab === 'customer' ? 'Request Customer Return' : 'Create Supplier Return'}
        </Button>
      </div>

      <div className="mb-6 flex gap-6 border-b border-border" role="tablist">
        {(['customer', 'supplier'] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
            className={
              tab === value
                ? 'border-b-2 border-primary pb-3 text-sm font-medium text-primary'
                : 'border-b-2 border-transparent pb-3 text-sm font-medium text-muted-foreground hover:text-foreground'
            }
          >
            {value === 'customer' ? 'Customer Returns' : 'Supplier Returns'}
          </button>
        ))}
      </div>

      {activeQuery.isLoading && (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
      )}
      {activeQuery.isError && (
        <p className="py-10 text-center text-sm text-destructive">
          {activeQuery.error instanceof ApiError
            ? activeQuery.error.message
            : 'Failed to load returns.'}
        </p>
      )}

      {!activeQuery.isLoading && !activeQuery.isError && (
        <>
          {((tab === 'customer' && filteredCustomerReturns.length === 0) ||
            (tab === 'supplier' && filteredSupplierReturns.length === 0)) &&
            !search && (
              <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed border-border px-6 py-16 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <RotateCcwIcon className="h-6 w-6" />
                </div>
                <h2 className="text-base font-semibold text-foreground">
                  No {tab === 'customer' ? 'customer' : 'supplier'} returns yet
                </h2>
              </div>
            )}

          {((tab === 'customer' && filteredCustomerReturns.length > 0) ||
            (tab === 'supplier' && filteredSupplierReturns.length > 0) ||
            search) && (
            <>
              <div className="mb-4">
                <Input
                  placeholder={`Search by return code or ${tab === 'customer' ? 'customer' : 'supplier'} name…`}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  className="max-w-sm"
                />
              </div>

              {tab === 'customer' ? (
                <CustomerReturnTable
                  rows={filteredCustomerReturns}
                  onSelect={setSelectedCustomerReturnId}
                />
              ) : (
                <SupplierReturnTable
                  rows={filteredSupplierReturns}
                  onSelect={setSelectedSupplierReturnId}
                />
              )}
            </>
          )}
        </>
      )}

      {createCustomerOpen && (
        <CreateCustomerReturnDialog
          onOpenChange={() => setCreateCustomerOpen(false)}
          onCreated={() => {
            setCreateCustomerOpen(false);
            invalidateCustomer();
          }}
        />
      )}
      {createSupplierOpen && (
        <CreateSupplierReturnDialog
          onOpenChange={() => setCreateSupplierOpen(false)}
          onCreated={() => {
            setCreateSupplierOpen(false);
            invalidateSupplier();
          }}
        />
      )}
      {selectedCustomerReturnId && (
        <CustomerReturnDetailDialog
          customerReturnId={selectedCustomerReturnId}
          onOpenChange={() => setSelectedCustomerReturnId(null)}
          onChanged={invalidateCustomer}
        />
      )}
      {selectedSupplierReturnId && (
        <SupplierReturnDetailDialog
          supplierReturnId={selectedSupplierReturnId}
          onOpenChange={() => setSelectedSupplierReturnId(null)}
        />
      )}
    </main>
  );
}

function CustomerReturnTable({
  rows,
  onSelect,
}: {
  rows: CustomerReturn[];
  onSelect: (id: string) => void;
}) {
  return (
    <>
      <div className="hidden overflow-x-auto rounded-lg border border-border md:block">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/50 text-left">
            <tr>
              <th className="px-4 py-3 font-medium">Return Code</th>
              <th className="px-4 py-3 font-medium">Customer</th>
              <th className="px-4 py-3 font-medium">Sales Order</th>
              <th className="px-4 py-3 font-medium">Reason</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-border last:border-0">
                <td className="px-4 py-3">
                  <button
                    type="button"
                    onClick={() => onSelect(row.id)}
                    className="font-mono text-xs font-medium text-foreground hover:underline"
                  >
                    {row.returnCode}
                  </button>
                </td>
                <td className="px-4 py-3">{row.customer.customerName}</td>
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                  {row.salesOrder.orderCode}
                </td>
                <td className="px-4 py-3">{CUSTOMER_RETURN_REASON_LABELS[row.reason]}</td>
                <td className="px-4 py-3">
                  <Badge variant={CUSTOMER_RETURN_STATUS_VARIANT[row.status]}>
                    {CUSTOMER_RETURN_STATUS_LABELS[row.status]}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-right">
                  <Button variant="outline" size="sm" onClick={() => onSelect(row.id)}>
                    View
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="space-y-2 md:hidden">
        {rows.map((row) => (
          <button
            key={row.id}
            type="button"
            onClick={() => onSelect(row.id)}
            className="w-full rounded-lg border border-border p-3 text-left"
          >
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs font-medium">{row.returnCode}</span>
              <Badge variant={CUSTOMER_RETURN_STATUS_VARIANT[row.status]}>
                {CUSTOMER_RETURN_STATUS_LABELS[row.status]}
              </Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {row.customer.customerName} · {row.salesOrder.orderCode}
            </p>
          </button>
        ))}
      </div>
    </>
  );
}

function SupplierReturnTable({
  rows,
  onSelect,
}: {
  rows: SupplierReturn[];
  onSelect: (id: string) => void;
}) {
  return (
    <>
      <div className="hidden overflow-x-auto rounded-lg border border-border md:block">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/50 text-left">
            <tr>
              <th className="px-4 py-3 font-medium">Return Code</th>
              <th className="px-4 py-3 font-medium">Supplier</th>
              <th className="px-4 py-3 font-medium">Goods Receipt</th>
              <th className="px-4 py-3 font-medium">Reason</th>
              <th className="px-4 py-3 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-border last:border-0">
                <td className="px-4 py-3">
                  <button
                    type="button"
                    onClick={() => onSelect(row.id)}
                    className="font-mono text-xs font-medium text-foreground hover:underline"
                  >
                    {row.returnCode}
                  </button>
                </td>
                <td className="px-4 py-3">{row.supplier.supplierName}</td>
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                  {row.goodsReceipt.goodsReceiptNumber}
                </td>
                <td className="px-4 py-3">{SUPPLIER_RETURN_REASON_LABELS[row.reason]}</td>
                <td className="px-4 py-3 text-right">
                  <Button variant="outline" size="sm" onClick={() => onSelect(row.id)}>
                    View
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="space-y-2 md:hidden">
        {rows.map((row) => (
          <button
            key={row.id}
            type="button"
            onClick={() => onSelect(row.id)}
            className="w-full rounded-lg border border-border p-3 text-left"
          >
            <span className="font-mono text-xs font-medium">{row.returnCode}</span>
            <p className="mt-1 text-xs text-muted-foreground">
              {row.supplier.supplierName} · {row.goodsReceipt.goodsReceiptNumber}
            </p>
          </button>
        ))}
      </div>
    </>
  );
}
