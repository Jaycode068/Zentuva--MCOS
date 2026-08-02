'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Input } from '@zentuva/ui';

import { BoxIcon } from '@/components/workspace/icons';
import { ApiError } from '@/lib/api-client';

import { activateProduct, archiveProduct, listProducts, type Product } from './api';
import { CATEGORY_LABELS, STATUS_VARIANT, TYPE_LABELS } from './labels';
import { ProductDialog } from './product-dialog';
import { ProductViewDialog } from './product-view-dialog';

export default function ProductsSettingsPage() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['products'],
    queryFn: () => listProducts(),
  });
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [viewingProduct, setViewingProduct] = useState<Product | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['products'] });

  const activateMutation = useMutation({
    mutationFn: (id: string) => activateProduct(id),
    onSuccess: invalidate,
  });
  const archiveMutation = useMutation({
    mutationFn: (id: string) => archiveProduct(id),
    onSuccess: invalidate,
  });

  const products = useMemo(() => data?.items ?? [], [data]);
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return products;
    return products.filter(
      (product) =>
        product.name.toLowerCase().includes(query) || product.code.toLowerCase().includes(query),
    );
  }, [products, search]);

  if (isLoading) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-10 text-sm text-muted-foreground">
        Loading products…
      </main>
    );
  }

  if (isError) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-10">
        <p className="text-sm text-destructive">
          {error instanceof ApiError ? error.message : 'Failed to load products.'}
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Products</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            The master catalogue of everything your organisation manufactures or sells.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>Create Product</Button>
      </div>

      {(activateMutation.isError || archiveMutation.isError) && (
        <p className="mb-4 text-sm text-destructive">
          {(activateMutation.error ?? archiveMutation.error) instanceof ApiError
            ? ((activateMutation.error ?? archiveMutation.error) as ApiError).message
            : 'Failed to update product status.'}
        </p>
      )}

      {products.length === 0 ? (
        <EmptyCatalogue onCreate={() => setCreateOpen(true)} />
      ) : (
        <>
          <div className="mb-4">
            <Input
              placeholder="Search by product name or code…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="max-w-sm"
            />
          </div>

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/50 text-left">
                <tr>
                  <th className="px-4 py-3 font-medium">Image</th>
                  <th className="px-4 py-3 font-medium">Code</th>
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Category</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Updated</th>
                  <th className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((product) => (
                  <tr key={product.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3">
                      {product.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element -- user-uploaded URL
                        <img
                          src={product.imageUrl}
                          alt=""
                          className="h-10 w-10 rounded-md border border-border object-cover"
                        />
                      ) : (
                        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-brandPurple text-xs font-semibold text-brandPurple-foreground">
                          {product.name.slice(0, 2).toUpperCase()}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      {product.code}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => setViewingProduct(product)}
                        className="font-medium text-foreground hover:underline"
                      >
                        {product.name}
                      </button>
                    </td>
                    <td className="px-4 py-3">{CATEGORY_LABELS[product.category]}</td>
                    <td className="px-4 py-3">{TYPE_LABELS[product.type]}</td>
                    <td className="px-4 py-3">
                      <Badge variant={STATUS_VARIANT[product.status]}>{product.status}</Badge>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {new Date(product.updatedAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setEditingProduct(product)}
                        >
                          Edit
                        </Button>
                        {product.status === 'ACTIVE' ? (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={archiveMutation.isPending}
                            onClick={() => archiveMutation.mutate(product.id)}
                          >
                            Archive
                          </Button>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={activateMutation.isPending}
                            onClick={() => activateMutation.mutate(product.id)}
                          >
                            Activate
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                      No products match &quot;{search}&quot;.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {createOpen && (
        <ProductDialog
          product={null}
          onOpenChange={() => setCreateOpen(false)}
          onSaved={invalidate}
        />
      )}
      {editingProduct && (
        <ProductDialog
          product={editingProduct}
          onOpenChange={() => setEditingProduct(null)}
          onSaved={invalidate}
        />
      )}
      {viewingProduct && (
        <ProductViewDialog product={viewingProduct} onOpenChange={() => setViewingProduct(null)} />
      )}
    </main>
  );
}

function EmptyCatalogue({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed border-border px-6 py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
        <BoxIcon className="h-6 w-6" />
      </div>
      <div>
        <h2 className="text-base font-semibold text-foreground">No products yet</h2>
        <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
          Your Product Catalogue is empty. Add your first product to start building the master
          source of truth for everything your organisation manufactures or sells.
        </p>
      </div>
      <Button onClick={onCreate}>Create Your First Product</Button>
    </div>
  );
}
