import type {
  CreateProductFamilyInput,
  CreateProductInput,
  CreateProductVariantInput,
  UpdateProductFamilyInput,
  UpdateProductInput,
  UpdateProductVariantInput,
} from '@zentuva/validation';

import { ApiError, apiFetch, getAccessToken } from '@/lib/api-client';
import { env } from '@/lib/env';

/** `GET/POST /api/products`, `GET/PATCH /api/products/:id` response shape — see
 *  apps/api/src/catalogue/product/product.controller.ts. `productVariantId`/
 *  `productVariant` added Sprint 4.7 — `productVariant` is only ever populated on the
 *  two read endpoints (`list`/`getOne`); write endpoints (create/update/activate/
 *  archive/image) always return it `null` even for a variant-attached product, matching
 *  `toProductResponse`'s own flat shape server-side. */
export interface Product {
  id: string;
  code: string;
  name: string;
  displayName: string | null;
  slug: string;
  category:
    'SNACKS' | 'BEVERAGE' | 'WATER' | 'CONFECTIONERY' | 'RAW_MATERIALS' | 'PACKAGING' | 'OTHERS';
  type: 'FINISHED_PRODUCT' | 'RAW_MATERIAL' | 'PACKAGING_MATERIAL' | 'CONSUMABLE';
  shortDescription: string | null;
  longDescription: string | null;
  unit: string;
  imageUrl: string | null;
  status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
  createdAt: string;
  updatedAt: string;
  createdById: string | null;
  updatedById: string | null;
  productVariantId: string | null;
  productVariant: {
    id: string;
    code: string;
    name: string;
    productFamily: { id: string; code: string; name: string };
  } | null;
}

/**
 * `Organisation → ProductFamily → ProductVariant → Product(SKU)` hierarchy (Sprint 4.7,
 * docs/domains/catalogue.md). `ProductFamily`/`ProductVariant` are grouping/navigation
 * entities only — BOM/Production/Inventory continue to target `Product` (the SKU)
 * directly, never these.
 */
export interface ProductFamily {
  id: string;
  code: string;
  name: string;
  description: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  createdAt: string;
  updatedAt: string;
}

export interface ProductVariant {
  id: string;
  productFamilyId: string;
  code: string;
  name: string;
  description: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  createdAt: string;
  updatedAt: string;
}

export function listProducts(search?: string): Promise<{ items: Product[] }> {
  const query = search ? `?search=${encodeURIComponent(search)}` : '';
  return apiFetch<{ items: Product[] }>(`/products${query}`);
}

export function getProduct(id: string): Promise<Product> {
  return apiFetch<Product>(`/products/${id}`);
}

export function createProduct(input: CreateProductInput): Promise<Product> {
  return apiFetch<Product>('/products', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateProduct(id: string, input: UpdateProductInput): Promise<Product> {
  return apiFetch<Product>(`/products/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function activateProduct(id: string): Promise<Product> {
  return apiFetch<Product>(`/products/${id}/activate`, { method: 'POST' });
}

export function archiveProduct(id: string): Promise<Product> {
  return apiFetch<Product>(`/products/${id}/archive`, { method: 'POST' });
}

/** `POST /api/products/:id/image` — multipart upload, same pattern as `lib/settings.ts`'s
 *  `uploadLogo` (bypasses `apiFetch`'s JSON `Content-Type` so the browser can set the
 *  correct multipart boundary itself). */
export async function uploadProductImage(id: string, file: File): Promise<Product> {
  const formData = new FormData();
  formData.append('file', file);

  const token = getAccessToken();
  const response = await fetch(`${env.NEXT_PUBLIC_API_URL}/products/${id}/image`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: formData,
  });

  if (!response.ok) {
    const body = await response.json().catch(() => undefined);
    throw new ApiError(response.status, body?.message ?? response.statusText, body);
  }
  return (await response.json()) as Product;
}

export function deleteProductImage(id: string): Promise<Product> {
  return apiFetch<Product>(`/products/${id}/image`, { method: 'DELETE' });
}

export function listProductFamilies(): Promise<{ items: ProductFamily[] }> {
  return apiFetch<{ items: ProductFamily[] }>('/product-families');
}

export function getProductFamily(id: string): Promise<ProductFamily> {
  return apiFetch<ProductFamily>(`/product-families/${id}`);
}

export function createProductFamily(input: CreateProductFamilyInput): Promise<ProductFamily> {
  return apiFetch<ProductFamily>('/product-families', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateProductFamily(
  id: string,
  input: UpdateProductFamilyInput,
): Promise<ProductFamily> {
  return apiFetch<ProductFamily>(`/product-families/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function listProductVariants(
  productFamilyId?: string,
): Promise<{ items: ProductVariant[] }> {
  const query = productFamilyId ? `?productFamilyId=${encodeURIComponent(productFamilyId)}` : '';
  return apiFetch<{ items: ProductVariant[] }>(`/product-variants${query}`);
}

export function getProductVariant(id: string): Promise<ProductVariant> {
  return apiFetch<ProductVariant>(`/product-variants/${id}`);
}

export function createProductVariant(input: CreateProductVariantInput): Promise<ProductVariant> {
  return apiFetch<ProductVariant>('/product-variants', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateProductVariant(
  id: string,
  input: UpdateProductVariantInput,
): Promise<ProductVariant> {
  return apiFetch<ProductVariant>(`/product-variants/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}
