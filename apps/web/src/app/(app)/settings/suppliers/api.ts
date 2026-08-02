import type { CreateSupplierInput, UpdateSupplierInput } from '@zentuva/validation';

import { apiFetch } from '@/lib/api-client';

/** `GET/POST /api/suppliers`, `GET/PATCH /api/suppliers/:id` response shape — see
 *  apps/api/src/suppliers/supplier/supplier.controller.ts. */
export interface Supplier {
  id: string;
  supplierCode: string;
  supplierName: string;
  displayName: string | null;
  contactPerson: string | null;
  email: string | null;
  phoneNumber: string | null;
  website: string | null;
  country: string | null;
  state: string | null;
  city: string | null;
  address: string | null;
  taxIdentificationNumber: string | null;
  supplierCategory:
    'RAW_MATERIAL' | 'PACKAGING' | 'LOGISTICS' | 'MAINTENANCE' | 'UTILITY' | 'SERVICE' | 'OTHER';
  status: 'ACTIVE' | 'INACTIVE';
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  createdById: string | null;
  updatedById: string | null;
}

export function listSuppliers(): Promise<{ items: Supplier[] }> {
  return apiFetch<{ items: Supplier[] }>('/suppliers');
}

export function getSupplier(id: string): Promise<Supplier> {
  return apiFetch<Supplier>(`/suppliers/${id}`);
}

export function createSupplier(input: CreateSupplierInput): Promise<Supplier> {
  return apiFetch<Supplier>('/suppliers', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateSupplier(id: string, input: UpdateSupplierInput): Promise<Supplier> {
  return apiFetch<Supplier>(`/suppliers/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}
