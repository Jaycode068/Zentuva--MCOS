'use client';

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Input, Select, cn } from '@zentuva/ui';

import { FactoryIcon } from '@/components/workspace/icons';
import { ApiError } from '@/lib/api-client';

import {
  listBillOfMaterials,
  listProductionOrders,
  type BillOfMaterial,
  type BillOfMaterialStatus,
  type ProductionOrder,
  type ProductionOrderStatus,
} from './api';
import { BillOfMaterialDialog } from './bom-dialog';
import {
  BOM_STATUS_LABELS,
  BOM_STATUS_VARIANT,
  PRODUCTION_ORDER_STATUS_LABELS,
  PRODUCTION_ORDER_STATUS_VARIANT,
} from './labels';
import { ProductionOrderDetailDialog } from './production-order-detail-dialog';
import { ProductionOrderDialog } from './production-order-dialog';

const TABS = [
  { id: 'boms', label: 'Bills of Materials' },
  { id: 'orders', label: 'Production Orders' },
] as const;
type TabId = (typeof TABS)[number]['id'];

/**
 * Production (Sprint 4.6 brief) — the manufacturing chain's frontend: recipes (Bill of
 * Materials) and instructions to manufacture (Production Orders). Material Issues and the
 * Production Run result live inside a Production Order's own detail view rather than
 * their own tabs, since — unlike Goods Receipts — they have no cross-order browsing need
 * (brief §22's implied scope, mirroring the plan's own reasoning).
 */
export default function ProductionSettingsPage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<TabId>('boms');
  const [createBomOpen, setCreateBomOpen] = useState(false);
  const [createOrderOpen, setCreateOrderOpen] = useState(false);

  const invalidateBoms = () => queryClient.invalidateQueries({ queryKey: ['boms'] });
  const invalidateOrders = () => queryClient.invalidateQueries({ queryKey: ['production-orders'] });

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Production</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Bills of materials, production orders, and the material issues and finished-goods
            receipts behind them.
          </p>
        </div>
        {activeTab === 'boms' ? (
          <Button onClick={() => setCreateBomOpen(true)}>Create Bill of Materials</Button>
        ) : (
          <Button onClick={() => setCreateOrderOpen(true)}>Create Production Order</Button>
        )}
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

      {activeTab === 'boms' && <BillOfMaterialsTab onCreate={() => setCreateBomOpen(true)} />}
      {activeTab === 'orders' && <ProductionOrdersTab onCreate={() => setCreateOrderOpen(true)} />}

      {createBomOpen && (
        <BillOfMaterialDialog
          bom={null}
          onOpenChange={() => setCreateBomOpen(false)}
          onSaved={invalidateBoms}
        />
      )}
      {createOrderOpen && (
        <ProductionOrderDialog
          productionOrder={null}
          onOpenChange={() => setCreateOrderOpen(false)}
          onSaved={invalidateOrders}
        />
      )}
    </main>
  );
}

function BillOfMaterialsTab({ onCreate }: { onCreate: () => void }) {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['boms'],
    queryFn: () => listBillOfMaterials(),
  });
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'' | BillOfMaterialStatus>('');
  const [editingBom, setEditingBom] = useState<BillOfMaterial | null>(null);

  const boms = useMemo(() => data?.items ?? [], [data]);
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return boms.filter((bom) => {
      if (statusFilter && bom.status !== statusFilter) return false;
      if (!query) return true;
      return (
        bom.bomNumber.toLowerCase().includes(query) ||
        bom.product.name.toLowerCase().includes(query) ||
        (bom.name ?? '').toLowerCase().includes(query)
      );
    });
  }, [boms, search, statusFilter]);

  const handleSaved = () => {
    queryClient.invalidateQueries({ queryKey: ['boms'] });
    setEditingBom(null);
  };

  if (isLoading) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">Loading bills of materials…</p>
    );
  }

  if (isError) {
    return (
      <p className="py-10 text-center text-sm text-destructive">
        {error instanceof ApiError ? error.message : 'Failed to load bills of materials.'}
      </p>
    );
  }

  if (boms.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed border-border px-6 py-16 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <FactoryIcon className="h-6 w-6" />
        </div>
        <div>
          <h2 className="text-base font-semibold text-foreground">No bills of materials yet</h2>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
            Create a bill of materials to define what raw materials and packaging a finished product
            needs, then activate it to start planning production.
          </p>
        </div>
        <Button onClick={onCreate}>Create Your First Bill of Materials</Button>
      </div>
    );
  }

  return (
    <>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <Input
          placeholder="Search by BOM number, name, or product…"
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
          {Object.entries(BOM_STATUS_LABELS).map(([value, label]) => (
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
              <th className="px-4 py-3 font-medium">BOM Number</th>
              <th className="px-4 py-3 font-medium">Finished Product</th>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Yield</th>
              <th className="px-4 py-3 font-medium">Components</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((bom) => (
              <tr key={bom.id} className="border-b border-border last:border-0">
                <td className="px-4 py-3">
                  <button
                    type="button"
                    onClick={() => setEditingBom(bom)}
                    className="font-mono text-xs font-medium text-foreground hover:underline"
                  >
                    {bom.bomNumber}
                  </button>
                </td>
                <td className="px-4 py-3">{bom.product.name}</td>
                <td className="px-4 py-3 text-muted-foreground">{bom.name ?? '—'}</td>
                <td className="px-4 py-3 text-muted-foreground">
                  {bom.yieldQuantity} {bom.product.unit}
                </td>
                <td className="px-4 py-3 text-muted-foreground">{bom.items.length}</td>
                <td className="px-4 py-3">
                  <Badge variant={BOM_STATUS_VARIANT[bom.status]}>
                    {BOM_STATUS_LABELS[bom.status]}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-right">
                  <Button variant="outline" size="sm" onClick={() => setEditingBom(bom)}>
                    {bom.status === 'DRAFT' ? 'Edit' : 'View'}
                  </Button>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                  No bills of materials match your search or filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editingBom && (
        <BillOfMaterialDialog
          bom={editingBom}
          onOpenChange={() => setEditingBom(null)}
          onSaved={handleSaved}
        />
      )}
    </>
  );
}

function ProductionOrdersTab({ onCreate }: { onCreate: () => void }) {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['production-orders'],
    queryFn: () => listProductionOrders(),
  });
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'' | ProductionOrderStatus>('');
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);

  const orders = useMemo(() => data?.items ?? [], [data]);
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return orders.filter((order) => {
      if (statusFilter && order.status !== statusFilter) return false;
      if (!query) return true;
      return (
        order.productionOrderNumber.toLowerCase().includes(query) ||
        order.product.name.toLowerCase().includes(query)
      );
    });
  }, [orders, search, statusFilter]);

  const handleChanged = () => {
    queryClient.invalidateQueries({ queryKey: ['production-orders'] });
  };

  if (isLoading) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">Loading production orders…</p>
    );
  }

  if (isError) {
    return (
      <p className="py-10 text-center text-sm text-destructive">
        {error instanceof ApiError ? error.message : 'Failed to load production orders.'}
      </p>
    );
  }

  if (orders.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed border-border px-6 py-16 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <FactoryIcon className="h-6 w-6" />
        </div>
        <div>
          <h2 className="text-base font-semibold text-foreground">No production orders yet</h2>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
            Create a production order against an active bill of materials to start planning a
            manufacturing run.
          </p>
        </div>
        <Button onClick={onCreate}>Create Your First Production Order</Button>
      </div>
    );
  }

  return (
    <>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <Input
          placeholder="Search by order number or product…"
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
          {Object.entries(PRODUCTION_ORDER_STATUS_LABELS).map(([value, label]) => (
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
              <th className="px-4 py-3 font-medium">Order Number</th>
              <th className="px-4 py-3 font-medium">Product</th>
              <th className="px-4 py-3 font-medium">Bill of Materials</th>
              <th className="px-4 py-3 font-medium">Location</th>
              <th className="px-4 py-3 font-medium">Planned Quantity</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((order) => (
              <ProductionOrderRow
                key={order.id}
                order={order}
                onSelect={() => setSelectedOrderId(order.id)}
              />
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                  No production orders match your search or filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {selectedOrderId && (
        <ProductionOrderDetailDialog
          productionOrderId={selectedOrderId}
          onOpenChange={() => setSelectedOrderId(null)}
          onChanged={handleChanged}
        />
      )}
    </>
  );
}

function ProductionOrderRow({ order, onSelect }: { order: ProductionOrder; onSelect: () => void }) {
  return (
    <tr className="border-b border-border last:border-0">
      <td className="px-4 py-3">
        <button
          type="button"
          onClick={onSelect}
          className="font-mono text-xs font-medium text-foreground hover:underline"
        >
          {order.productionOrderNumber}
        </button>
      </td>
      <td className="px-4 py-3">{order.product.name}</td>
      <td className="px-4 py-3 text-muted-foreground">{order.billOfMaterial.bomNumber}</td>
      <td className="px-4 py-3 text-muted-foreground">{order.location.name}</td>
      <td className="px-4 py-3">
        {order.plannedQuantity} {order.product.unit}
      </td>
      <td className="px-4 py-3">
        <Badge variant={PRODUCTION_ORDER_STATUS_VARIANT[order.status]}>
          {PRODUCTION_ORDER_STATUS_LABELS[order.status]}
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
