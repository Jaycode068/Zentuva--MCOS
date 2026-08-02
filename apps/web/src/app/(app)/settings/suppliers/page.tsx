'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Input, Select } from '@zentuva/ui';

import { SupplierIcon } from '@/components/workspace/icons';
import { ApiError } from '@/lib/api-client';

import { listSuppliers, updateSupplier, type Supplier } from './api';
import { CATEGORY_LABELS, STATUS_VARIANT } from './labels';
import { SupplierDialog } from './supplier-dialog';

const CATEGORY_FILTER_OPTIONS = Object.keys(CATEGORY_LABELS) as Supplier['supplierCategory'][];

export default function SuppliersSettingsPage() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => listSuppliers(),
  });
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'' | Supplier['status']>('');
  const [categoryFilter, setCategoryFilter] = useState<'' | Supplier['supplierCategory']>('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['suppliers'] });

  const toggleStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: Supplier['status'] }) =>
      updateSupplier(id, { status }),
    onSuccess: invalidate,
  });

  const suppliers = useMemo(() => data?.items ?? [], [data]);
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return suppliers.filter((supplier) => {
      if (statusFilter && supplier.status !== statusFilter) return false;
      if (categoryFilter && supplier.supplierCategory !== categoryFilter) return false;
      if (!query) return true;
      return (
        supplier.supplierName.toLowerCase().includes(query) ||
        supplier.supplierCode.toLowerCase().includes(query) ||
        (supplier.contactPerson?.toLowerCase().includes(query) ?? false)
      );
    });
  }, [suppliers, search, statusFilter, categoryFilter]);

  if (isLoading) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-10 text-sm text-muted-foreground">
        Loading suppliers…
      </main>
    );
  }

  if (isError) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-10">
        <p className="text-sm text-destructive">
          {error instanceof ApiError ? error.message : 'Failed to load suppliers.'}
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Suppliers</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            The master record of every vendor your organisation buys goods or services from.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>Create Supplier</Button>
      </div>

      {toggleStatusMutation.isError && (
        <p className="mb-4 text-sm text-destructive">
          {toggleStatusMutation.error instanceof ApiError
            ? toggleStatusMutation.error.message
            : 'Failed to update supplier status.'}
        </p>
      )}

      {suppliers.length === 0 ? (
        <EmptySuppliers onCreate={() => setCreateOpen(true)} />
      ) : (
        <>
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Input
              placeholder="Search by name, code, or contact person…"
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
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </Select>
            <Select
              value={categoryFilter}
              onChange={(event) => setCategoryFilter(event.target.value as typeof categoryFilter)}
              className="max-w-[12rem]"
            >
              <option value="">All categories</option>
              {CATEGORY_FILTER_OPTIONS.map((category) => (
                <option key={category} value={category}>
                  {CATEGORY_LABELS[category]}
                </option>
              ))}
            </Select>
          </div>

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/50 text-left">
                <tr>
                  <th className="px-4 py-3 font-medium">Supplier Code</th>
                  <th className="px-4 py-3 font-medium">Supplier Name</th>
                  <th className="px-4 py-3 font-medium">Category</th>
                  <th className="px-4 py-3 font-medium">Contact Person</th>
                  <th className="px-4 py-3 font-medium">Phone</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((supplier) => (
                  <tr key={supplier.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      {supplier.supplierCode}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => setEditingSupplier(supplier)}
                        className="font-medium text-foreground hover:underline"
                      >
                        {supplier.supplierName}
                      </button>
                    </td>
                    <td className="px-4 py-3">{CATEGORY_LABELS[supplier.supplierCategory]}</td>
                    <td className="px-4 py-3">{supplier.contactPerson ?? '—'}</td>
                    <td className="px-4 py-3">{supplier.phoneNumber ?? '—'}</td>
                    <td className="px-4 py-3">
                      <Badge variant={STATUS_VARIANT[supplier.status]}>{supplier.status}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setEditingSupplier(supplier)}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={toggleStatusMutation.isPending}
                          onClick={() =>
                            toggleStatusMutation.mutate({
                              id: supplier.id,
                              status: supplier.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE',
                            })
                          }
                        >
                          {supplier.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                      No suppliers match your search or filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {createOpen && (
        <SupplierDialog
          supplier={null}
          onOpenChange={() => setCreateOpen(false)}
          onSaved={invalidate}
        />
      )}
      {editingSupplier && (
        <SupplierDialog
          supplier={editingSupplier}
          onOpenChange={() => setEditingSupplier(null)}
          onSaved={invalidate}
        />
      )}
    </main>
  );
}

function EmptySuppliers({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed border-border px-6 py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
        <SupplierIcon className="h-6 w-6" />
      </div>
      <div>
        <h2 className="text-base font-semibold text-foreground">No suppliers yet</h2>
        <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
          Add your first supplier to start building the master record of who your organisation buys
          goods and services from.
        </p>
      </div>
      <Button onClick={onCreate}>Create Your First Supplier</Button>
    </div>
  );
}
