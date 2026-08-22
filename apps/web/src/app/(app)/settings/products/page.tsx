'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Input, cn } from '@zentuva/ui';

import { BoxIcon } from '@/components/workspace/icons';
import { ApiError } from '@/lib/api-client';

import {
  activateProduct,
  archiveProduct,
  listProductFamilies,
  listProducts,
  listProductVariants,
  type Product,
  type ProductFamily,
  type ProductVariant,
} from './api';
import { CATEGORY_LABELS, STATUS_VARIANT, TYPE_LABELS } from './labels';
import { ProductDialog } from './product-dialog';
import { ProductFamilyDialog } from './product-family-dialog';
import { ProductVariantDialog } from './product-variant-dialog';
import { ProductViewDialog } from './product-view-dialog';

const VIEWS = [
  { id: 'flat', label: 'All Products' },
  { id: 'hierarchy', label: 'By Family' },
] as const;
type ViewId = (typeof VIEWS)[number]['id'];

export default function ProductsSettingsPage() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['products'],
    queryFn: () => listProducts(),
  });
  const { data: familiesData } = useQuery({
    queryKey: ['product-families'],
    queryFn: () => listProductFamilies(),
  });
  const { data: variantsData } = useQuery({
    queryKey: ['product-variants'],
    queryFn: () => listProductVariants(),
  });
  const [view, setView] = useState<ViewId>('flat');
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [viewingProduct, setViewingProduct] = useState<Product | null>(null);
  const [familyDialog, setFamilyDialog] = useState<{ open: boolean; family: ProductFamily | null }>(
    {
      open: false,
      family: null,
    },
  );
  const [variantDialog, setVariantDialog] = useState<{
    open: boolean;
    variant: ProductVariant | null;
  }>({ open: false, variant: null });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['products'] });
  const invalidateHierarchy = () => {
    invalidate();
    queryClient.invalidateQueries({ queryKey: ['product-families'] });
    queryClient.invalidateQueries({ queryKey: ['product-variants'] });
  };

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
      <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Products</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            The master catalogue of everything your organisation manufactures or sells.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setFamilyDialog({ open: true, family: null })}>
            Add Family
          </Button>
          <Button variant="outline" onClick={() => setVariantDialog({ open: true, variant: null })}>
            Add Variant
          </Button>
          <Button onClick={() => setCreateOpen(true)}>Create Product</Button>
        </div>
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
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Input
              placeholder="Search by product name or code…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="max-w-sm"
            />
            <div className="flex gap-1 rounded-md border border-border p-0.5">
              {VIEWS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setView(option.id)}
                  className={cn(
                    'rounded px-3 py-1.5 text-sm font-medium transition-colors',
                    view === option.id
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                  aria-current={view === option.id ? 'page' : undefined}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {view === 'flat' ? (
            <FlatProductsTable
              products={filtered}
              search={search}
              onView={setViewingProduct}
              onEdit={setEditingProduct}
              onActivate={(id) => activateMutation.mutate(id)}
              onArchive={(id) => archiveMutation.mutate(id)}
              activatePending={activateMutation.isPending}
              archivePending={archiveMutation.isPending}
            />
          ) : (
            <HierarchyView
              products={filtered}
              families={familiesData?.items ?? []}
              variants={variantsData?.items ?? []}
              onSelectProduct={setViewingProduct}
              onEditFamily={(family) => setFamilyDialog({ open: true, family })}
              onEditVariant={(variant) => setVariantDialog({ open: true, variant })}
            />
          )}
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
      {familyDialog.open && (
        <ProductFamilyDialog
          family={familyDialog.family}
          onOpenChange={() => setFamilyDialog({ open: false, family: null })}
          onSaved={invalidateHierarchy}
        />
      )}
      {variantDialog.open && (
        <ProductVariantDialog
          variant={variantDialog.variant}
          onOpenChange={() => setVariantDialog({ open: false, variant: null })}
          onSaved={invalidateHierarchy}
        />
      )}
    </main>
  );
}

function FlatProductsTable({
  products,
  search,
  onView,
  onEdit,
  onActivate,
  onArchive,
  activatePending,
  archivePending,
}: {
  products: Product[];
  search: string;
  onView: (product: Product) => void;
  onEdit: (product: Product) => void;
  onActivate: (id: string) => void;
  onArchive: (id: string) => void;
  activatePending: boolean;
  archivePending: boolean;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="border-b border-border bg-muted/50 text-left">
          <tr>
            <th className="px-4 py-3 font-medium">Image</th>
            <th className="px-4 py-3 font-medium">Code</th>
            <th className="px-4 py-3 font-medium">Name</th>
            <th className="px-4 py-3 font-medium">Family / Variant</th>
            <th className="px-4 py-3 font-medium">Category</th>
            <th className="px-4 py-3 font-medium">Type</th>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 font-medium">Updated</th>
            <th className="px-4 py-3 text-right font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {products.map((product) => (
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
              <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{product.code}</td>
              <td className="px-4 py-3">
                <button
                  type="button"
                  onClick={() => onView(product)}
                  className="font-medium text-foreground hover:underline"
                >
                  {product.name}
                </button>
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                {product.productVariant
                  ? `${product.productVariant.productFamily.name} — ${product.productVariant.name}`
                  : '—'}
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
                  <Button variant="outline" size="sm" onClick={() => onEdit(product)}>
                    Edit
                  </Button>
                  {product.status === 'ACTIVE' ? (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={archivePending}
                      onClick={() => onArchive(product.id)}
                    >
                      Archive
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={activatePending}
                      onClick={() => onActivate(product.id)}
                    >
                      Activate
                    </Button>
                  )}
                </div>
              </td>
            </tr>
          ))}
          {products.length === 0 && (
            <tr>
              <td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">
                No products match &quot;{search}&quot;.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/** Family → Variant → SKU tree (Sprint 4.7 brief §11) — grouped client-side from the
 *  same product list the flat table already fetched, no separate per-group query. The
 *  real `ProductFamily`/`ProductVariant` rows (fetched once on the page, not
 *  reconstructed from the product's own nested — and deliberately narrower — read-only
 *  context) are looked up by id so the Edit dialogs open with correct `status`/
 *  `description` rather than fabricated defaults. Products with no `productVariant`
 *  (raw materials, packaging, consumables, and any finished product never attached to
 *  the hierarchy) are collected under "Ungrouped" rather than hidden. */
function HierarchyView({
  products,
  families: allFamilies,
  variants: allVariants,
  onSelectProduct,
  onEditFamily,
  onEditVariant,
}: {
  products: Product[];
  families: ProductFamily[];
  variants: ProductVariant[];
  onSelectProduct: (product: Product) => void;
  onEditFamily: (family: ProductFamily) => void;
  onEditVariant: (variant: ProductVariant) => void;
}) {
  const familiesById = useMemo(() => new Map(allFamilies.map((f) => [f.id, f])), [allFamilies]);
  const variantsById = useMemo(() => new Map(allVariants.map((v) => [v.id, v])), [allVariants]);

  const families = useMemo(() => {
    type FamilyGroup = {
      family: ProductFamily;
      variants: Map<string, { variant: ProductVariant; products: Product[] }>;
    };
    const groups = new Map<string, FamilyGroup>();
    const ungrouped: Product[] = [];

    for (const product of products) {
      const variantRef = product.productVariant;
      const family = variantRef ? familiesById.get(variantRef.productFamily.id) : undefined;
      const variant = variantRef ? variantsById.get(variantRef.id) : undefined;
      if (!variantRef || !family || !variant) {
        ungrouped.push(product);
        continue;
      }

      let group = groups.get(family.id);
      if (!group) {
        group = { family, variants: new Map() };
        groups.set(family.id, group);
      }
      let variantEntry = group.variants.get(variant.id);
      if (!variantEntry) {
        variantEntry = { variant, products: [] };
        group.variants.set(variant.id, variantEntry);
      }
      variantEntry.products.push(product);
    }

    return { groups: Array.from(groups.values()), ungrouped };
  }, [products, familiesById, variantsById]);

  if (families.groups.length === 0 && families.ungrouped.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        No products match your search.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {families.groups.map(({ family, variants }) => (
        <div key={family.id} className="rounded-lg border border-border">
          <button
            type="button"
            onClick={() => onEditFamily(family)}
            className="flex w-full items-center gap-2 border-b border-border bg-muted/40 px-4 py-2.5 text-left font-semibold text-foreground hover:bg-muted/60"
          >
            {family.name}
            <span className="font-mono text-xs font-normal text-muted-foreground">
              {family.code}
            </span>
          </button>
          <div className="divide-y divide-border">
            {Array.from(variants.values()).map(({ variant, products: skus }) => (
              <div key={variant.id} className="p-3 pl-6">
                <button
                  type="button"
                  onClick={() => onEditVariant(variant)}
                  className="mb-2 flex items-center gap-2 text-left text-sm font-medium text-foreground hover:underline"
                >
                  {variant.name}
                  <span className="font-mono text-xs font-normal text-muted-foreground">
                    {variant.code}
                  </span>
                </button>
                <ul className="space-y-1 pl-4">
                  {skus.map((sku) => (
                    <li key={sku.id}>
                      <button
                        type="button"
                        onClick={() => onSelectProduct(sku)}
                        className="flex w-full items-center justify-between rounded px-2 py-1 text-left text-sm hover:bg-muted/40"
                      >
                        <span>{sku.name}</span>
                        <Badge variant={STATUS_VARIANT[sku.status]}>{sku.status}</Badge>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      ))}

      {families.ungrouped.length > 0 && (
        <div className="rounded-lg border border-dashed border-border">
          <div className="border-b border-border bg-muted/20 px-4 py-2.5 font-semibold text-muted-foreground">
            Ungrouped
            <span className="ml-2 text-xs font-normal">
              Raw materials, packaging, consumables, and any finished product not yet attached to a
              family/variant.
            </span>
          </div>
          <ul className="divide-y divide-border">
            {families.ungrouped.map((product) => (
              <li key={product.id}>
                <button
                  type="button"
                  onClick={() => onSelectProduct(product)}
                  className="flex w-full items-center justify-between px-4 py-2 text-left text-sm hover:bg-muted/30"
                >
                  <span>
                    {product.name}{' '}
                    <span className="font-mono text-xs text-muted-foreground">
                      ({product.code})
                    </span>
                  </span>
                  <Badge variant={STATUS_VARIANT[product.status]}>{product.status}</Badge>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
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
