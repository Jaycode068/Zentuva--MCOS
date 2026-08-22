'use client';

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Input, Select, cn } from '@zentuva/ui';

import { TruckIcon, UsersIcon } from '@/components/workspace/icons';
import { ApiError } from '@/lib/api-client';

import {
  activateCustomer,
  activateOutlet,
  activateTerritory,
  deactivateCustomer,
  deactivateNetworkRelationship,
  deactivateOutlet,
  deactivateTerritory,
  listCustomers,
  listNetworkRelationships,
  listOutlets,
  listTerritories,
  type Customer,
  type CustomerStatus,
  type CustomerType,
  type NetworkRelationshipStatus,
  type Outlet,
  type OutletStatus,
  type OutletType,
  type Territory,
  type TerritoryStatus,
} from './api';
import { CustomerDialog } from './customer-dialog';
import {
  CUSTOMER_STATUS_LABELS,
  CUSTOMER_STATUS_VARIANT,
  CUSTOMER_TYPE_LABELS,
  NETWORK_STATUS_LABELS,
  NETWORK_STATUS_VARIANT,
  OUTLET_STATUS_LABELS,
  OUTLET_STATUS_VARIANT,
  OUTLET_TYPE_LABELS,
  RELATIONSHIP_TYPE_LABELS,
  TERRITORY_STATUS_LABELS,
  TERRITORY_STATUS_VARIANT,
} from './labels';
import { NetworkRelationshipDialog } from './network-relationship-dialog';
import { OutletDialog } from './outlet-dialog';
import { TerritoryDialog } from './territory-dialog';

const TABS = [
  { id: 'customers', label: 'Customers' },
  { id: 'outlets', label: 'Outlets' },
  { id: 'territories', label: 'Territories' },
  { id: 'network', label: 'Network' },
] as const;
type TabId = (typeof TABS)[number]['id'];

/**
 * Retail Network (Sprint 4.8, docs/domains/retail-network.md) — the Admin surface for
 * Customer/Outlet/Territory/Network Relationship management, following the same tabbed
 * layout as `settings/production/page.tsx`. See `apps/web/src/app/(field)/` for the
 * mobile-first Field Sales counterpart to this same backend.
 */
export default function RetailSettingsPage() {
  const [activeTab, setActiveTab] = useState<TabId>('customers');
  const [addCustomerOpen, setAddCustomerOpen] = useState(false);
  const [addOutletOpen, setAddOutletOpen] = useState(false);
  const [addTerritoryOpen, setAddTerritoryOpen] = useState(false);
  const [addRelationshipOpen, setAddRelationshipOpen] = useState(false);
  const queryClient = useQueryClient();

  const invalidate = (key: string) => queryClient.invalidateQueries({ queryKey: [key] });

  const addLabel =
    activeTab === 'customers'
      ? 'Add Customer'
      : activeTab === 'outlets'
        ? 'Add Outlet'
        : activeTab === 'territories'
          ? 'Add Territory'
          : 'Add Relationship';

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Retail Network</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Customers, outlets, territories, and distribution network relationships — the Retail
            Intelligence foundation.
          </p>
        </div>
        <Button
          onClick={() => {
            if (activeTab === 'customers') setAddCustomerOpen(true);
            else if (activeTab === 'outlets') setAddOutletOpen(true);
            else if (activeTab === 'territories') setAddTerritoryOpen(true);
            else setAddRelationshipOpen(true);
          }}
        >
          {addLabel}
        </Button>
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

      {activeTab === 'customers' && <CustomersTab />}
      {activeTab === 'outlets' && <OutletsTab />}
      {activeTab === 'territories' && <TerritoriesTab />}
      {activeTab === 'network' && <NetworkTab />}

      {addCustomerOpen && (
        <CustomerDialog
          customer={null}
          onOpenChange={() => setAddCustomerOpen(false)}
          onSaved={() => invalidate('customers')}
        />
      )}
      {addOutletOpen && (
        <OutletDialog
          outlet={null}
          onOpenChange={() => setAddOutletOpen(false)}
          onSaved={() => invalidate('outlets')}
        />
      )}
      {addTerritoryOpen && (
        <TerritoryDialog
          territory={null}
          onOpenChange={() => setAddTerritoryOpen(false)}
          onSaved={() => invalidate('territories')}
        />
      )}
      {addRelationshipOpen && (
        <NetworkRelationshipDialog
          onOpenChange={() => setAddRelationshipOpen(false)}
          onSaved={() => invalidate('network-relationships')}
        />
      )}
    </main>
  );
}

function CustomersTab() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['customers'],
    queryFn: () => listCustomers(),
  });
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'' | CustomerType>('');
  const [statusFilter, setStatusFilter] = useState<'' | CustomerStatus>('');
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);

  const customers = useMemo(() => data?.items ?? [], [data]);
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return customers.filter((customer) => {
      if (typeFilter && customer.customerType !== typeFilter) return false;
      if (statusFilter && customer.status !== statusFilter) return false;
      if (!query) return true;
      return (
        customer.customerName.toLowerCase().includes(query) ||
        customer.customerCode.toLowerCase().includes(query) ||
        customer.phoneNumber.toLowerCase().includes(query)
      );
    });
  }, [customers, search, typeFilter, statusFilter]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['customers'] });

  if (isLoading)
    return <p className="py-10 text-center text-sm text-muted-foreground">Loading customers…</p>;
  if (isError) {
    return (
      <p className="py-10 text-center text-sm text-destructive">
        {error instanceof ApiError ? error.message : 'Failed to load customers.'}
      </p>
    );
  }
  if (customers.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed border-border px-6 py-16 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <UsersIcon className="h-6 w-6" />
        </div>
        <h2 className="text-base font-semibold text-foreground">No customers yet</h2>
      </div>
    );
  }

  return (
    <>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <Input
          placeholder="Search by name, code, or phone…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="max-w-sm"
        />
        <Select
          value={typeFilter}
          onChange={(event) => setTypeFilter(event.target.value as typeof typeFilter)}
          className="max-w-[12rem]"
        >
          <option value="">All types</option>
          {Object.entries(CUSTOMER_TYPE_LABELS).map(([value, label]) => (
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
          <option value="">All statuses</option>
          {Object.entries(CUSTOMER_STATUS_LABELS).map(([value, label]) => (
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
              <th className="px-4 py-3 font-medium">Code</th>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Type</th>
              <th className="px-4 py-3 font-medium">Phone</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((customer) => (
              <tr key={customer.id} className="border-b border-border last:border-0">
                <td className="px-4 py-3 font-mono text-xs">{customer.customerCode}</td>
                <td className="px-4 py-3">{customer.customerName}</td>
                <td className="px-4 py-3 text-muted-foreground">
                  {CUSTOMER_TYPE_LABELS[customer.customerType]}
                </td>
                <td className="px-4 py-3 text-muted-foreground">{customer.phoneNumber}</td>
                <td className="px-4 py-3">
                  <Badge variant={CUSTOMER_STATUS_VARIANT[customer.status]}>
                    {CUSTOMER_STATUS_LABELS[customer.status]}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setEditingCustomer(customer)}
                    >
                      Edit
                    </Button>
                    {customer.status === 'ACTIVE' ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => deactivateCustomer(customer.id).then(invalidate)}
                      >
                        Deactivate
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => activateCustomer(customer.id).then(invalidate)}
                      >
                        Activate
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="space-y-2 md:hidden">
        {filtered.map((customer) => (
          <button
            key={customer.id}
            type="button"
            onClick={() => setEditingCustomer(customer)}
            className="w-full rounded-lg border border-border p-3 text-left"
          >
            <div className="flex items-center justify-between">
              <span className="font-medium">{customer.customerName}</span>
              <Badge variant={CUSTOMER_STATUS_VARIANT[customer.status]}>
                {CUSTOMER_STATUS_LABELS[customer.status]}
              </Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {customer.customerCode} · {CUSTOMER_TYPE_LABELS[customer.customerType]} ·{' '}
              {customer.phoneNumber}
            </p>
          </button>
        ))}
      </div>

      {editingCustomer && (
        <CustomerDialog
          customer={editingCustomer}
          onOpenChange={() => setEditingCustomer(null)}
          onSaved={invalidate}
        />
      )}
    </>
  );
}

function OutletsTab() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['outlets'],
    queryFn: () => listOutlets(),
  });
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'' | OutletType>('');
  const [statusFilter, setStatusFilter] = useState<'' | OutletStatus>('');
  const [editingOutlet, setEditingOutlet] = useState<Outlet | null>(null);

  const outlets = useMemo(() => data?.items ?? [], [data]);
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return outlets.filter((outlet) => {
      if (typeFilter && outlet.outletType !== typeFilter) return false;
      if (statusFilter && outlet.status !== statusFilter) return false;
      if (!query) return true;
      return (
        outlet.name.toLowerCase().includes(query) || outlet.outletCode.toLowerCase().includes(query)
      );
    });
  }, [outlets, search, typeFilter, statusFilter]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['outlets'] });

  if (isLoading)
    return <p className="py-10 text-center text-sm text-muted-foreground">Loading outlets…</p>;
  if (isError) {
    return (
      <p className="py-10 text-center text-sm text-destructive">
        {error instanceof ApiError ? error.message : 'Failed to load outlets.'}
      </p>
    );
  }
  if (outlets.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed border-border px-6 py-16 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <TruckIcon className="h-6 w-6" />
        </div>
        <h2 className="text-base font-semibold text-foreground">No outlets yet</h2>
      </div>
    );
  }

  return (
    <>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <Input
          placeholder="Search by name or code…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="max-w-sm"
        />
        <Select
          value={typeFilter}
          onChange={(event) => setTypeFilter(event.target.value as typeof typeFilter)}
          className="max-w-[12rem]"
        >
          <option value="">All types</option>
          {Object.entries(OUTLET_TYPE_LABELS).map(([value, label]) => (
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
          <option value="">All statuses</option>
          {Object.entries(OUTLET_STATUS_LABELS).map(([value, label]) => (
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
              <th className="px-4 py-3 font-medium">Code</th>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Customer</th>
              <th className="px-4 py-3 font-medium">Type</th>
              <th className="px-4 py-3 font-medium">Photos</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((outlet) => (
              <tr key={outlet.id} className="border-b border-border last:border-0">
                <td className="px-4 py-3 font-mono text-xs">{outlet.outletCode}</td>
                <td className="px-4 py-3">{outlet.name}</td>
                <td className="px-4 py-3 text-muted-foreground">{outlet.customer.customerName}</td>
                <td className="px-4 py-3 text-muted-foreground">
                  {OUTLET_TYPE_LABELS[outlet.outletType]}
                </td>
                <td className="px-4 py-3 text-muted-foreground">{outlet.photos.length}</td>
                <td className="px-4 py-3">
                  <Badge variant={OUTLET_STATUS_VARIANT[outlet.status]}>
                    {OUTLET_STATUS_LABELS[outlet.status]}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={() => setEditingOutlet(outlet)}>
                      Edit
                    </Button>
                    {outlet.status === 'ACTIVE' ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => deactivateOutlet(outlet.id).then(invalidate)}
                      >
                        Deactivate
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => activateOutlet(outlet.id).then(invalidate)}
                      >
                        Activate
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="space-y-2 md:hidden">
        {filtered.map((outlet) => (
          <button
            key={outlet.id}
            type="button"
            onClick={() => setEditingOutlet(outlet)}
            className="w-full rounded-lg border border-border p-3 text-left"
          >
            <div className="flex items-center justify-between">
              <span className="font-medium">{outlet.name}</span>
              <Badge variant={OUTLET_STATUS_VARIANT[outlet.status]}>
                {OUTLET_STATUS_LABELS[outlet.status]}
              </Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {outlet.outletCode} · {outlet.customer.customerName} · {outlet.photos.length} photos
            </p>
          </button>
        ))}
      </div>

      {editingOutlet && (
        <OutletDialog
          outlet={editingOutlet}
          onOpenChange={() => setEditingOutlet(null)}
          onSaved={invalidate}
        />
      )}
    </>
  );
}

function TerritoriesTab() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['territories'],
    queryFn: () => listTerritories(),
  });
  const [statusFilter, setStatusFilter] = useState<'' | TerritoryStatus>('');
  const [editingTerritory, setEditingTerritory] = useState<Territory | null>(null);

  const territories = useMemo(() => data?.items ?? [], [data]);
  const filtered = useMemo(
    () => territories.filter((t) => !statusFilter || t.status === statusFilter),
    [territories, statusFilter],
  );
  const byId = useMemo(() => new Map(territories.map((t) => [t.id, t])), [territories]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['territories'] });

  function depthOf(territory: Territory): number {
    let depth = 0;
    let current: Territory | undefined = territory;
    while (current?.parentTerritoryId) {
      current = byId.get(current.parentTerritoryId);
      depth += 1;
      if (depth > 20) break;
    }
    return depth;
  }

  if (isLoading)
    return <p className="py-10 text-center text-sm text-muted-foreground">Loading territories…</p>;
  if (isError) {
    return (
      <p className="py-10 text-center text-sm text-destructive">
        {error instanceof ApiError ? error.message : 'Failed to load territories.'}
      </p>
    );
  }

  const sorted = [...filtered].sort(
    (a, b) => depthOf(a) - depthOf(b) || a.name.localeCompare(b.name),
  );

  return (
    <>
      <div className="mb-4">
        <Select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
          className="max-w-[10rem]"
        >
          <option value="">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="INACTIVE">Inactive</option>
        </Select>
      </div>

      {sorted.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-6 py-16 text-center text-sm text-muted-foreground">
          No territories yet.
        </div>
      ) : (
        <div className="space-y-1 rounded-lg border border-border p-3">
          {sorted.map((territory) => (
            <div
              key={territory.id}
              className="flex items-center justify-between rounded-md px-3 py-2 hover:bg-muted/50"
              style={{ marginLeft: `${depthOf(territory) * 1.25}rem` }}
            >
              <button
                type="button"
                onClick={() => setEditingTerritory(territory)}
                className="flex items-center gap-2 text-left"
              >
                <span className="font-medium">{territory.name}</span>
                <span className="text-xs text-muted-foreground">{territory.type}</span>
                <span className="font-mono text-xs text-muted-foreground">
                  {territory.territoryCode}
                </span>
              </button>
              <div className="flex items-center gap-2">
                <Badge variant={TERRITORY_STATUS_VARIANT[territory.status]}>
                  {TERRITORY_STATUS_LABELS[territory.status]}
                </Badge>
                {territory.status === 'ACTIVE' ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => deactivateTerritory(territory.id).then(invalidate)}
                  >
                    Deactivate
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => activateTerritory(territory.id).then(invalidate)}
                  >
                    Activate
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {editingTerritory && (
        <TerritoryDialog
          territory={editingTerritory}
          onOpenChange={() => setEditingTerritory(null)}
          onSaved={invalidate}
        />
      )}
    </>
  );
}

function NetworkTab() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['network-relationships'],
    queryFn: () => listNetworkRelationships(),
  });
  const [statusFilter, setStatusFilter] = useState<'' | NetworkRelationshipStatus>('');

  const relationships = useMemo(() => data?.items ?? [], [data]);
  const filtered = useMemo(
    () => relationships.filter((r) => !statusFilter || r.status === statusFilter),
    [relationships, statusFilter],
  );

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['network-relationships'] });

  if (isLoading)
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        Loading network relationships…
      </p>
    );
  if (isError) {
    return (
      <p className="py-10 text-center text-sm text-destructive">
        {error instanceof ApiError ? error.message : 'Failed to load network relationships.'}
      </p>
    );
  }
  if (relationships.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border px-6 py-16 text-center text-sm text-muted-foreground">
        No network relationships yet. Customers can buy directly without one — relationships are
        optional market intelligence, added as the distribution network becomes clear.
      </div>
    );
  }

  return (
    <>
      <div className="mb-4">
        <Select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
          className="max-w-[10rem]"
        >
          <option value="">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="INACTIVE">Inactive</option>
        </Select>
      </div>

      <div className="space-y-2">
        {filtered.map((relationship) => (
          <div
            key={relationship.id}
            className="flex items-center justify-between rounded-lg border border-border p-3"
          >
            <div className="flex items-center gap-2 text-sm">
              <span className="font-medium">{relationship.sourceCustomer.customerName}</span>
              <span className="text-muted-foreground">
                {RELATIONSHIP_TYPE_LABELS[relationship.relationshipType]}
              </span>
              <span className="font-medium">{relationship.targetCustomer.customerName}</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={NETWORK_STATUS_VARIANT[relationship.status]}>
                {NETWORK_STATUS_LABELS[relationship.status]}
              </Badge>
              {relationship.status === 'ACTIVE' && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => deactivateNetworkRelationship(relationship.id).then(invalidate)}
                >
                  Deactivate
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
