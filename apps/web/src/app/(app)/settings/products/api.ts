import type { CreateProductInput, UpdateProductInput } from '@zentuva/validation';

import { ApiError, apiFetch, getAccessToken } from '@/lib/api-client';
import { env } from '@/lib/env';

/** `GET/POST /api/products`, `GET/PATCH /api/products/:id` response shape — see
 *  apps/api/src/catalogue/product/product.controller.ts. */
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
