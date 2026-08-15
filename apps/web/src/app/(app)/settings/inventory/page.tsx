'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Input, Select, cn } from '@zentuva/ui';

import { ArchiveIcon } from '@/components/workspace/icons';
import { ApiError } from '@/lib/api-client';

import {
  listGoodsReceipts,
  listInventoryLocations,
  listInventoryStock,
  listInventoryTransactions,
  updateGoodsReceiptDiscrepancy,
  type DiscrepancyStatus,
  type GoodsReceipt,
  type InventoryLocation,
  type InventoryStock,
  type ProductStatus,
} from './api';
import { GoodsReceivingDialog } from './goods-receiving-dialog';
import {
  DISCREPANCY_STATUS_LABELS,
  DISCREPANCY_STATUS_VARIANT,
  LOCATION_STATUS_LABELS,
  LOCATION_STATUS_VARIANT,
  PRODUCT_TYPE_LABELS,
  REJECTION_REASON_LABELS,
  TRANSACTION_TYPE_LABELS,
  TRANSACTION_TYPE_VARIANT,
} from './labels';
import { LocationDialog } from './location-dialog';
import { StockAdjustmentDialog } from './stock-adjustment-dialog';

const PRODUCT_STATUS_LABELS: Record<ProductStatus, string> = {
  DRAFT: 'Draft',
  ACTIVE: 'Active',
  ARCHIVED: 'Archived',
};

const TABS = [
  { id: 'stock', label: 'Inventory Summary' },
  { id: 'transactions', label: 'Transactions' },
  { id: 'receipts', label: 'Goods Receipts' },
  { id: 'locations', label: 'Locations' },
] as const;
type TabId = (typeof TABS)[number]['id'];

/**
 * Inventory (Sprint 4.4 brief, extended 4.4.1 for receiving discrepancies, extended 4.5
 * for locations and manual stock adjustments) — the live stock balance every "receive
 * goods against a Purchase Order" or "adjust stock" call updates, plus the immutable
 * transaction ledger behind it. Two write surfaces: "Receive Goods" (`GoodsReceivingDialog`)
 * and "Adjust Stock" (`StockAdjustmentDialog`) — no warehouse transfers or manual Issue
 * this sprint (brief's Constraints).
 */
export default function InventorySettingsPage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<TabId>('stock');
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);

  const invalidateStockQueries = () => {
    queryClient.invalidateQueries({ queryKey: ['inventory-stock'] });
    queryClient.invalidateQueries({ queryKey: ['inventory-transactions'] });
  };

  const handleReceived = () => {
    invalidateStockQueries();
    queryClient.invalidateQueries({ queryKey: ['goods-receipts'] });
    queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
    queryClient.invalidateQueries({ queryKey: ['purchase-order-receiving-summary'] });
    setReceiveOpen(false);
  };

  const handleAdjusted = () => {
    invalidateStockQueries();
    setAdjustOpen(false);
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
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setAdjustOpen(true)}>
            Adjust Stock
          </Button>
          <Button onClick={() => setReceiveOpen(true)}>Receive Goods</Button>
        </div>
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
      {activeTab === 'locations' && <LocationsTab />}

      {receiveOpen && (
        <GoodsReceivingDialog
          onOpenChange={() => setReceiveOpen(false)}
          onReceived={handleReceived}
        />
      )}
      {adjustOpen && (
        <StockAdjustmentDialog
          onOpenChange={() => setAdjustOpen(false)}
          onAdjusted={handleAdjusted}
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
  const { data: locationsData } = useQuery({
    queryKey: ['inventory-locations'],
    queryFn: () => listInventoryLocations(),
  });
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'' | InventoryStock['product']['type']>('');
  const [statusFilter, setStatusFilter] = useState<'' | ProductStatus>('');
  const [locationFilter, setLocationFilter] = useState('');

  const stock = useMemo(() => data?.items ?? [], [data]);
  const locations = locationsData?.items ?? [];
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return stock.filter((row) => {
      if (typeFilter && row.product.type !== typeFilter) return false;
      if (statusFilter && row.product.status !== statusFilter) return false;
      if (locationFilter && row.location.id !== locationFilter) return false;
      if (!query) return true;
      return (
        row.product.name.toLowerCase().includes(query) ||
        row.product.code.toLowerCase().includes(query)
      );
    });
  }, [stock, search, typeFilter, statusFilter, locationFilter]);

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
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
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
        <Select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
          className="max-w-[10rem]"
        >
          <option value="">All product statuses</option>
          {Object.entries(PRODUCT_STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
        <Select
          value={locationFilter}
          onChange={(event) => setLocationFilter(event.target.value)}
          className="max-w-[12rem]"
        >
          <option value="">All locations</option>
          {locations.map((location) => (
            <option key={location.id} value={location.id}>
              {location.name}
            </option>
          ))}
        </Select>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/50 text-left">
            <tr>
              <th className="px-4 py-3 font-medium">Product</th>
              <th className="px-4 py-3 font-medium">Code</th>
              <th className="px-4 py-3 font-medium">Type</th>
              <th className="px-4 py-3 font-medium">UoM</th>
              <th className="px-4 py-3 font-medium">Location</th>
              <th className="px-4 py-3 font-medium">Quantity On Hand</th>
              <th className="px-4 py-3 font-medium">Quantity Available</th>
              <th className="px-4 py-3 font-medium">Last Movement</th>
              <th className="px-4 py-3 font-medium">Last Updated</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr
                key={`${row.productId}-${row.location.id}`}
                className="border-b border-border last:border-0"
              >
                <td className="px-4 py-3 font-medium text-foreground">{row.product.name}</td>
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                  {row.product.code}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {PRODUCT_TYPE_LABELS[row.product.type]}
                </td>
                <td className="px-4 py-3 text-muted-foreground">{row.product.unit}</td>
                <td className="px-4 py-3 text-muted-foreground">{row.location.name}</td>
                <td className="px-4 py-3">{row.quantityOnHand}</td>
                <td className="px-4 py-3">{row.quantityAvailable}</td>
                <td className="px-4 py-3 text-muted-foreground">
                  {row.lastMovement ? new Date(row.lastMovement).toLocaleString() : '—'}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {row.updatedAt ? new Date(row.updatedAt).toLocaleString() : '—'}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">
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

/** Sprint 4.5 brief's "per-product inventory history view with running balance" —
 *  running balance only makes sense scoped to one product (mixed-product totals aren't
 *  meaningful), so it only appears once a product filter is chosen. Computed
 *  client-side: fetch that product's full history (the API always orders newest-first),
 *  reverse it to walk oldest-to-newest accumulating `quantity`, then read each row's
 *  balance back off in the original (newest-first) display order — no server endpoint
 *  duplicates `GET /inventory/transactions?productId=`, which already returns exactly
 *  this data. */
function InventoryTransactionsTab() {
  const [productFilter, setProductFilter] = useState('');
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['inventory-transactions', productFilter],
    queryFn: () => listInventoryTransactions(productFilter ? { productId: productFilter } : {}),
  });
  const { data: stockData } = useQuery({
    queryKey: ['inventory-stock'],
    queryFn: () => listInventoryStock(),
  });

  const transactions = useMemo(() => data?.items ?? [], [data]);
  const products = useMemo(() => {
    const seen = new Map<string, { id: string; name: string; code: string }>();
    for (const row of stockData?.items ?? []) {
      seen.set(row.productId, {
        id: row.productId,
        name: row.product.name,
        code: row.product.code,
      });
    }
    return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [stockData]);

  const balanceByTransactionId = useMemo(() => {
    if (!productFilter) return new Map<string, number>();
    const ascending = [...transactions].reverse();
    const balances = new Map<string, number>();
    let running = 0;
    for (const txn of ascending) {
      running += txn.quantity;
      balances.set(txn.id, running);
    }
    return balances;
  }, [transactions, productFilter]);

  return (
    <>
      <div className="mb-4">
        <Select
          value={productFilter}
          onChange={(event) => setProductFilter(event.target.value)}
          className="max-w-sm"
        >
          <option value="">All products</option>
          {products.map((product) => (
            <option key={product.id} value={product.id}>
              {product.name} ({product.code})
            </option>
          ))}
        </Select>
        {!productFilter && (
          <p className="mt-1 text-xs text-muted-foreground">
            Filter by a single product to see its running balance.
          </p>
        )}
      </div>

      {isLoading ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading transactions…</p>
      ) : isError ? (
        <p className="py-10 text-center text-sm text-destructive">
          {error instanceof ApiError ? error.message : 'Failed to load transactions.'}
        </p>
      ) : transactions.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          No inventory transactions yet — they appear here once goods are received or stock is
          adjusted.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/50 text-left">
              <tr>
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Product</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Quantity</th>
                {productFilter && <th className="px-4 py-3 font-medium">Running Balance</th>}
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
                    <div className="font-mono text-xs text-muted-foreground">
                      {txn.product.code}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={TRANSACTION_TYPE_VARIANT[txn.transactionType]}>
                      {TRANSACTION_TYPE_LABELS[txn.transactionType]}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    {txn.quantity > 0 ? `+${txn.quantity}` : txn.quantity} {txn.product.unit}
                  </td>
                  {productFilter && (
                    <td className="px-4 py-3 font-medium text-foreground">
                      {balanceByTransactionId.get(txn.id)} {txn.product.unit}
                    </td>
                  )}
                  <td className="px-4 py-3 text-muted-foreground">{txn.referenceType}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
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

/** Locations tab (Sprint 4.5 brief §16/§20) — create/rename/deactivate physical stock
 *  locations. No delete, matching the Suppliers/Products "retire, never remove"
 *  convention; the default location's status control is disabled both here (via
 *  `LocationDialog`) and server-side. */
function LocationsTab() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['inventory-locations'],
    queryFn: () => listInventoryLocations(),
  });
  const [dialogState, setDialogState] = useState<{
    open: boolean;
    location: InventoryLocation | null;
  }>({ open: false, location: null });

  const locations = data?.items ?? [];

  const handleSaved = () => {
    queryClient.invalidateQueries({ queryKey: ['inventory-locations'] });
    setDialogState({ open: false, location: null });
  };

  if (isLoading) {
    return <p className="py-10 text-center text-sm text-muted-foreground">Loading locations…</p>;
  }

  if (isError) {
    return (
      <p className="py-10 text-center text-sm text-destructive">
        {error instanceof ApiError ? error.message : 'Failed to load locations.'}
      </p>
    );
  }

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button onClick={() => setDialogState({ open: true, location: null })}>Add Location</Button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/50 text-left">
            <tr>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Products Stocked</th>
              <th className="px-4 py-3 font-medium">Created</th>
              <th className="px-4 py-3 font-medium" />
            </tr>
          </thead>
          <tbody>
            {locations.map((location) => (
              <tr key={location.id} className="border-b border-border last:border-0">
                <td className="px-4 py-3 font-medium text-foreground">
                  {location.name}
                  {location.isDefault && <Badge className="ml-2">Default</Badge>}
                </td>
                <td className="px-4 py-3">
                  <Badge variant={LOCATION_STATUS_VARIANT[location.status]}>
                    {LOCATION_STATUS_LABELS[location.status]}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-muted-foreground">{location.productCount}</td>
                <td className="px-4 py-3 text-muted-foreground">
                  {new Date(location.createdAt).toLocaleDateString()}
                </td>
                <td className="px-4 py-3 text-right">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setDialogState({ open: true, location })}
                  >
                    Edit
                  </Button>
                </td>
              </tr>
            ))}
            {locations.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                  No locations yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {dialogState.open && (
        <LocationDialog
          location={dialogState.location}
          onOpenChange={() => setDialogState({ open: false, location: null })}
          onSaved={handleSaved}
        />
      )}
    </>
  );
}
