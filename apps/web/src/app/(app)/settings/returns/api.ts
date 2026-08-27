import { apiFetch, apiFetchFormData } from '@/lib/api-client';

/**
 * Typed client for Sprint 11's Returns, Claims & Reversals Foundation
 * (docs/domains/sales.md "Customer Returns", docs/domains/procurement.md "Supplier
 * Returns"). Shared by both the Admin `/settings/returns` surface and the Field
 * request-only sheet (`field/api.ts` re-exports this file), same "one backend, two
 * surfaces" convention as every other domain.
 */

export type CustomerReturnReason =
  | 'DAMAGED'
  | 'DEFECTIVE'
  | 'WRONG_ITEM'
  | 'WRONG_QUANTITY'
  | 'CUSTOMER_REJECTED'
  | 'QUALITY_ISSUE'
  | 'EXPIRED'
  | 'OTHER';

export type CustomerReturnStatus = 'REQUESTED' | 'RECEIVED' | 'CANCELLED';

export interface CustomerReturnJournalEntry {
  id: string;
  journalNumber: string;
  status: 'DRAFT' | 'POSTED' | 'VOID';
  totalAmount: number;
}

export interface CustomerReturnCreditNote {
  id: string;
  creditNoteCode: string;
  amount: number;
  status: 'DRAFT' | 'ISSUED' | 'VOID';
}

export interface CustomerReturnItem {
  id: string;
  product: { id: string; code: string; name: string; unit: string };
  salesFulfilmentItemId: string;
  quantityReturned: number;
  unitCost: number;
  unitPrice: number;
  quantityResalable: number;
  quantityDamaged: number;
  quantityQuarantine: number;
  quantityScrap: number;
  quantityCredited: number;
}

/** `GET/POST /api/sales/customer-returns` response shape — see
 *  `apps/api/src/sales/customer-return.controller.ts`'s `toCustomerReturnResponse`. */
export interface CustomerReturn {
  id: string;
  returnCode: string;
  customer: { id: string; customerCode: string; customerName: string };
  outlet: { id: string; outletCode: string; name: string } | null;
  salesOrder: { id: string; orderCode: string };
  location: { id: string; name: string };
  status: CustomerReturnStatus;
  returnDate: string;
  reason: CustomerReturnReason;
  reasonNotes: string | null;
  notes: string | null;
  photoUrl: string | null;
  receivedAt: string | null;
  items: CustomerReturnItem[];
  createdAt: string;
  updatedAt: string;
}

export interface CustomerReturnWithAccounting extends CustomerReturn {
  journalEntry: CustomerReturnJournalEntry | null;
  creditNote: CustomerReturnCreditNote | null;
}

export interface ListCustomerReturnsParams {
  status?: CustomerReturnStatus;
  customerId?: string;
  salesOrderId?: string;
  search?: string;
}

export interface CreateCustomerReturnItemPayload {
  salesFulfilmentItemId: string;
  quantityReturned: number;
}

export interface CreateCustomerReturnPayload {
  salesOrderId: string;
  locationId: string;
  returnDate: string;
  reason: CustomerReturnReason;
  reasonNotes?: string;
  notes?: string;
  idempotencyKey?: string;
  items: CreateCustomerReturnItemPayload[];
}

export interface ReceiveCustomerReturnItemPayload {
  customerReturnItemId: string;
  quantityResalable: number;
  quantityDamaged: number;
  quantityQuarantine: number;
  quantityScrap: number;
  quantityCredited?: number;
}

export interface ReceiveCustomerReturnPayload {
  idempotencyKey?: string;
  items: ReceiveCustomerReturnItemPayload[];
}

export function listCustomerReturns(
  params: ListCustomerReturnsParams = {},
): Promise<{ items: CustomerReturn[] }> {
  const query = new URLSearchParams();
  if (params.status) query.set('status', params.status);
  if (params.customerId) query.set('customerId', params.customerId);
  if (params.salesOrderId) query.set('salesOrderId', params.salesOrderId);
  if (params.search) query.set('search', params.search);
  const queryString = query.toString();
  return apiFetch<{ items: CustomerReturn[] }>(
    `/sales/customer-returns${queryString ? `?${queryString}` : ''}`,
  );
}

export function getCustomerReturn(id: string): Promise<CustomerReturn> {
  return apiFetch<CustomerReturn>(`/sales/customer-returns/${id}`);
}

export function requestCustomerReturn(input: CreateCustomerReturnPayload): Promise<CustomerReturn> {
  return apiFetch<CustomerReturn>('/sales/customer-returns', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function receiveCustomerReturn(
  id: string,
  input: ReceiveCustomerReturnPayload,
): Promise<CustomerReturnWithAccounting> {
  return apiFetch<CustomerReturnWithAccounting>(`/sales/customer-returns/${id}/receive`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function cancelCustomerReturn(id: string): Promise<CustomerReturn> {
  return apiFetch<CustomerReturn>(`/sales/customer-returns/${id}/cancel`, { method: 'POST' });
}

export function uploadCustomerReturnPhoto(id: string, file: File): Promise<CustomerReturn> {
  const formData = new FormData();
  formData.append('file', file);
  return apiFetchFormData<CustomerReturn>(`/sales/customer-returns/${id}/photo`, formData);
}

// ---------------------------------------------------------------------------------
// Supplier Returns (docs/domains/procurement.md "Supplier Returns")
// ---------------------------------------------------------------------------------

export type SupplierReturnReason =
  'DAMAGED' | 'DEFECTIVE' | 'WRONG_ITEM' | 'WRONG_SPECIFICATION' | 'CONTAMINATED' | 'OTHER';

export interface SupplierReturnItem {
  id: string;
  product: { id: string; code: string; name: string; unit: string };
  goodsReceiptItemId: string;
  quantityReturned: number;
  unitCost: number;
  /** Of `quantityReturned`, how much was allocated to the excess/GRNI bucket vs. the
   *  payable/AP bucket (brief §17-19). */
  excessPortion: number;
}

export interface SupplierReturnJournalEntry {
  id: string;
  journalNumber: string;
  status: 'DRAFT' | 'POSTED' | 'VOID';
  totalAmount: number;
}

/** `GET/POST /api/inventory/supplier-returns` response shape — see
 *  `apps/api/src/inventory/inventory.controller.ts`'s `toSupplierReturnResponse`. */
export interface SupplierReturn {
  id: string;
  returnCode: string;
  supplier: { id: string; supplierCode: string; supplierName: string };
  purchaseOrder: { id: string; purchaseOrderNumber: string };
  goodsReceipt: { id: string; goodsReceiptNumber: string };
  location: { id: string; name: string };
  status: 'COMPLETED';
  returnDate: string;
  reason: SupplierReturnReason;
  reasonNotes: string | null;
  notes: string | null;
  photoUrl: string | null;
  items: SupplierReturnItem[];
  createdAt: string;
}

export interface SupplierReturnWithAccounting extends SupplierReturn {
  journalEntry: SupplierReturnJournalEntry | null;
}

export interface ListSupplierReturnsParams {
  supplierId?: string;
  purchaseOrderId?: string;
  goodsReceiptId?: string;
  search?: string;
}

export interface CreateSupplierReturnItemPayload {
  goodsReceiptItemId: string;
  quantityReturned: number;
}

export interface CreateSupplierReturnPayload {
  purchaseOrderId: string;
  goodsReceiptId: string;
  locationId: string;
  returnDate: string;
  reason: SupplierReturnReason;
  reasonNotes?: string;
  notes?: string;
  idempotencyKey?: string;
  items: CreateSupplierReturnItemPayload[];
}

export function listSupplierReturns(
  params: ListSupplierReturnsParams = {},
): Promise<{ items: SupplierReturn[] }> {
  const query = new URLSearchParams();
  if (params.supplierId) query.set('supplierId', params.supplierId);
  if (params.purchaseOrderId) query.set('purchaseOrderId', params.purchaseOrderId);
  if (params.goodsReceiptId) query.set('goodsReceiptId', params.goodsReceiptId);
  if (params.search) query.set('search', params.search);
  const queryString = query.toString();
  return apiFetch<{ items: SupplierReturn[] }>(
    `/inventory/supplier-returns${queryString ? `?${queryString}` : ''}`,
  );
}

export function getSupplierReturn(id: string): Promise<SupplierReturn> {
  return apiFetch<SupplierReturn>(`/inventory/supplier-returns/${id}`);
}

export function createSupplierReturn(
  input: CreateSupplierReturnPayload,
): Promise<SupplierReturnWithAccounting> {
  return apiFetch<SupplierReturnWithAccounting>('/inventory/supplier-returns', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
