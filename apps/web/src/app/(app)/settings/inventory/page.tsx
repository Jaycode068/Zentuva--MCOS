'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Input, Select, cn } from '@zentuva/ui';

import { ArchiveIcon } from '@/components/workspace/icons';
import { ApiError } from '@/lib/api-client';

import {
  listGoodsReceipts,
  listInventoryStock,
  listInventoryTransactions,
  updateGoodsReceiptDiscrepancy,
  type DiscrepancyStatus,
  type GoodsReceipt,
  type InventoryStock,
} from './api';
import { GoodsReceivingDialog } from './goods-receiving-dialog';
import {
  DISCREPANCY_STATUS_LABELS,
  DISCREPANCY_STATUS_VARIANT,
  PRODUCT_TYPE_LABELS,
  REJECTION_REASON_LABELS,
  TRANSACTION_TYPE_LABELS,
  TRANSACTION_TYPE_VARIANT,
} from './labels';

const TABS = [
  { id: 'stock', label: 'Inventory Summary' },
  { id: 'transactions', label: 'Transactions' },
  { id: 'receipts', label: 'Goods Receipts' },
] as const;
type TabId = (typeof TABS)[number]['id'];

/**
 * Inventory (Sprint 4.4 brief) — the live stock balance every "receive goods against a
 * Purchase Order" call updates, plus the immutable transaction ledger behind it. No
 * warehouse transfers, stock adjustments, or inventory counts this sprint (brief's
 * Constraints) — the only write surface is "Receive Goods," which opens
 * `GoodsReceivingDialog`.
 */
export default function InventorySettingsPage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<TabId>('stock');
  const [receiveOpen, setReceiveOpen] = useState(false);

  const handleReceived = () => {
    queryClient.invalidateQueries({ queryKey: ['inventory-stock'] });
    queryClient.invalidateQueries({ queryKey: ['inventory-transactions'] });
    queryClient.invalidateQueries({ queryKey: ['goods-receipts'] });
    queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
    queryClient.invalidateQueries({ queryKey: ['purchase-order-receiving-summary'] });
    setReceiveOpen(false);
  };

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Inventory</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Live stock levels and the goods receipt history behind them.
          </p>
        </div>
        <Button onClick={() => setReceiveOpen(true)}>Receive Goods</Button>
      </div>

      <div className="mb-6 flex gap-1 border-b border-border">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              activeTab === tab.id
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
            aria-current={activeTab === tab.id ? 'page' : undefined}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'stock' && <InventorySummaryTab onReceiveGoods={() => setReceiveOpen(true)} />}
      {activeTab === 'transactions' && <InventoryTransactionsTab />}
      {activeTab === 'receipts' && <GoodsReceiptsTab />}

      {receiveOpen && (
        <GoodsReceivingDialog
          onOpenChange={() => setReceiveOpen(false)}
          onReceived={handleReceived}
        />
      )}
    </main>
  );
}

function InventorySummaryTab({ onReceiveGoods }: { onReceiveGoods: () => void }) {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['inventory-stock'],
    queryFn: () => listInventoryStock(),
  });
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'' | InventoryStock['product']['type']>('');

  const stock = useMemo(() => data?.items ?? [], [data]);
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return stock.filter((row) => {
      if (typeFilter && row.product.type !== typeFilter) return false;
      if (!query) return true;
      return (
        row.product.name.toLowerCase().includes(query) ||
        row.product.code.toLowerCase().includes(query)
      );
    });
  }, [stock, search, typeFilter]);

  if (isLoading) {
    return <p className="py-10 text-center text-sm text-muted-foreground">Loading inventory…</p>;
  }

  if (isError) {
    return (
      <p className="py-10 text-center text-sm text-destructive">
        {error instanceof ApiError ? error.message : 'Failed to load inventory.'}
      </p>
    );
  }

  if (stock.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed border-border px-6 py-16 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <ArchiveIcon className="h-6 w-6" />
        </div>
        <div>
          <h2 className="text-base font-semibold text-foreground">No inventory yet</h2>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
            Receive a purchase order to record your first goods receipt and start tracking stock.
          </p>
        </div>
        <Button onClick={onReceiveGoods}>Receive Goods</Button>
      </div>
    );
  }

  return (
    <>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <Input
          placeholder="Search by product name or code…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="max-w-sm"
        />
        <Select
          value={typeFilter}
          onChange={(event) => setTypeFilter(event.target.value as typeof typeFilter)}
          className="max-w-[12rem]"
        >
          <option value="">All product types</option>
          {Object.entries(PRODUCT_TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/50 text-left">
            <tr>
              <th className="px-4 py-3 font-medium">Product</th>
              <th className="px-4 py-3 font-medium">Product Type</th>
              <th className="px-4 py-3 font-medium">Quantity On Hand</th>
              <th className="px-4 py-3 font-medium">Last Updated</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr key={row.productId} className="border-b border-border last:border-0">
                <td className="px-4 py-3">
                  <div className="font-medium text-foreground">{row.product.name}</div>
                  <div className="font-mono text-xs text-muted-foreground">{row.product.code}</div>
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {PRODUCT_TYPE_LABELS[row.product.type]}
                </td>
                <td className="px-4 py-3">
                  {row.quantityOnHand} {row.product.unit}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {row.updatedAt ? new Date(row.updatedAt).toLocaleString() : '—'}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                  No products match your search or filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function InventoryTransactionsTab() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['inventory-transactions'],
    queryFn: () => listInventoryTransactions(),
  });

  const transactions = data?.items ?? [];

  if (isLoading) {
    return <p className="py-10 text-center text-sm text-muted-foreground">Loading transactions…</p>;
  }

  if (isError) {
    return (
      <p className="py-10 text-center text-sm text-destructive">
        {error instanceof ApiError ? error.message : 'Failed to load transactions.'}
      </p>
    );
  }

  if (transactions.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        No inventory transactions yet — they appear here once goods are received.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="border-b border-border bg-muted/50 text-left">
          <tr>
            <th className="px-4 py-3 font-medium">Date</th>
            <th className="px-4 py-3 font-medium">Product</th>
            <th className="px-4 py-3 font-medium">Type</th>
            <th className="px-4 py-3 font-medium">Quantity</th>
            <th className="px-4 py-3 font-medium">Reference</th>
          </tr>
        </thead>
        <tbody>
          {transactions.map((txn) => (
            <tr key={txn.id} className="border-b border-border last:border-0">
              <td className="px-4 py-3 text-muted-foreground">
                {new Date(txn.createdAt).toLocaleString()}
              </td>
              <td className="px-4 py-3">
                <div className="font-medium text-foreground">{txn.product.name}</div>
                <div className="font-mono text-xs text-muted-foreground">{txn.product.code}</div>
              </td>
              <td className="px-4 py-3">
                <Badge variant={TRANSACTION_TYPE_VARIANT[txn.transactionType]}>
                  {TRANSACTION_TYPE_LABELS[txn.transactionType]}
                </Badge>
              </td>
              <td className="px-4 py-3">
                {txn.quantity} {txn.product.unit}
              </td>
              <td className="px-4 py-3 text-muted-foreground">{txn.referenceType}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Read-only receiving history (Sprint 4.4.1 brief §13) — every `GoodsReceipt` ever
 *  recorded, each showing what was delivered/accepted/rejected per item and the
 *  lightweight supplier-resolution state, with a small inline control to progress that
 *  state (brief §5). Never edits what was actually received. */
function GoodsReceiptsTab() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['goods-receipts'],
    queryFn: () => listGoodsReceipts(),
  });

  const receipts = data?.items ?? [];

  if (isLoading) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">Loading goods receipts…</p>
    );
  }

  if (isError) {
    return (
      <p className="py-10 text-center text-sm text-destructive">
        {error instanceof ApiError ? error.message : 'Failed to load goods receipts.'}
      </p>
    );
  }

  if (receipts.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        No goods receipts yet — they appear here once you receive a purchase order.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {receipts.map((receipt) => (
        <GoodsReceiptCard key={receipt.id} receipt={receipt} />
      ))}
    </div>
  );
}

function GoodsReceiptCard({ receipt }: { receipt: GoodsReceipt }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<DiscrepancyStatus>(receipt.discrepancyStatus);

  const mutation = useMutation({
    mutationFn: (nextStatus: DiscrepancyStatus) =>
      updateGoodsReceiptDiscrepancy(receipt.id, { status: nextStatus }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['goods-receipts'] });
    },
  });

  const hasDiscrepancy = receipt.items.some((item) => item.rejectedQuantity > 0);
  const isDirty = status !== receipt.discrepancyStatus;

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className="font-mono text-sm font-medium text-foreground">
            {receipt.goodsReceiptNumber}
          </span>
          <span className="ml-2 text-sm text-muted-foreground">
            {receipt.purchaseOrder.purchaseOrderNumber} — {receipt.supplier.supplierName}
          </span>
        </div>
        <span className="text-xs text-muted-foreground">
          {new Date(receipt.receivedDate).toLocaleDateString()}
        </span>
      </div>

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/50 text-left">
            <tr>
              <th className="px-3 py-2 font-medium">Product</th>
              <th className="px-3 py-2 font-medium">Delivered</th>
              <th className="px-3 py-2 font-medium">Rejected</th>
              <th className="px-3 py-2 font-medium">Accepted</th>
              <th className="px-3 py-2 font-medium">Reason</th>
            </tr>
          </thead>
          <tbody>
            {receipt.items.map((item) => (
              <tr key={item.id} className="border-b border-border last:border-0">
                <td className="px-3 py-2">
                  {item.product.name}{' '}
                  <span className="text-xs text-muted-foreground">({item.product.unit})</span>
                </td>
                <td className="px-3 py-2">{item.deliveredQuantity}</td>
                <td className="px-3 py-2">{item.rejectedQuantity}</td>
                <td className="px-3 py-2">{item.acceptedQuantity}</td>
                <td className="px-3 py-2 text-muted-foreground">
                  {item.rejectionReason ? REJECTION_REASON_LABELS[item.rejectionReason] : '—'}
                  {item.rejectionNotes && (
                    <span className="block text-xs italic">{item.rejectionNotes}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {receipt.remarks && (
        <p className="mt-2 text-xs text-muted-foreground">Remarks: {receipt.remarks}</p>
      )}

      {hasDiscrepancy ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Badge variant={DISCREPANCY_STATUS_VARIANT[receipt.discrepancyStatus]}>
            {DISCREPANCY_STATUS_LABELS[receipt.discrepancyStatus]}
          </Badge>
          <Select
            value={status}
            onChange={(event) => setStatus(event.target.value as DiscrepancyStatus)}
            className="max-w-[12rem]"
          >
            {Object.entries(DISCREPANCY_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
          <Button
            variant="outline"
            size="sm"
            disabled={!isDirty || mutation.isPending}
            onClick={() => mutation.mutate(status)}
          >
            {mutation.isPending ? 'Saving…' : 'Update'}
          </Button>
        </div>
      ) : (
        <Badge variant={DISCREPANCY_STATUS_VARIANT[receipt.discrepancyStatus]} className="mt-3">
          {DISCREPANCY_STATUS_LABELS[receipt.discrepancyStatus]}
        </Badge>
      )}
    </div>
  );
}
