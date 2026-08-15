import { apiFetch } from '@/lib/api-client';

/** `GET/POST /api/procurement/purchase-orders`, `GET/PATCH .../:id` response shape —
 *  see apps/api/src/procurement/purchase-order/purchase-order.controller.ts. */
export interface PurchaseOrderItem {
  id: string;
  product: { id: string; code: string; name: string; unit: string };
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export type PurchaseOrderStatus =
  'DRAFT' | 'PENDING' | 'APPROVED' | 'PARTIALLY_RECEIVED' | 'RECEIVED' | 'CANCELLED';

export interface PurchaseOrder {
  id: string;
  purchaseOrderNumber: string;
  supplier: { id: string; supplierCode: string; supplierName: string };
  orderDate: string;
  expectedDeliveryDate: string | null;
  status: PurchaseOrderStatus;
  remarks: string | null;
  subtotal: number;
  total: number;
  items: PurchaseOrderItem[];
  createdAt: string;
  updatedAt: string;
  createdById: string | null;
  updatedById: string | null;
  approvedById: string | null;
}

export interface PurchaseOrderItemPayload {
  productId: string;
  quantity: number;
  unitPrice: number;
}

/**
 * Local "wire" payload types, deliberately not imported from `@zentuva/validation`'s
 * `CreatePurchaseOrderInput`/`UpdatePurchaseOrderInput` — those infer `orderDate`/
 * `expectedDeliveryDate` as `Date` (from the schema's `z.coerce.date()`, which exists so
 * the *server* can parse an incoming JSON string), but this form works with plain
 * `<input type="date">` strings end to end; the backend's Zod pipe coerces them on
 * arrival regardless of this file's types.
 */
export interface CreatePurchaseOrderPayload {
  supplierId: string;
  orderDate: string;
  expectedDeliveryDate?: string;
  remarks?: string;
  items: PurchaseOrderItemPayload[];
}

export interface UpdatePurchaseOrderPayload {
  supplierId?: string;
  orderDate?: string;
  expectedDeliveryDate?: string;
  remarks?: string;
  status?: 'DRAFT' | 'PENDING';
  items?: PurchaseOrderItemPayload[];
}

export function listPurchaseOrders(): Promise<{ items: PurchaseOrder[] }> {
  return apiFetch<{ items: PurchaseOrder[] }>('/procurement/purchase-orders');
}

export function getPurchaseOrder(id: string): Promise<PurchaseOrder> {
  return apiFetch<PurchaseOrder>(`/procurement/purchase-orders/${id}`);
}

export function createPurchaseOrder(input: CreatePurchaseOrderPayload): Promise<PurchaseOrder> {
  return apiFetch<PurchaseOrder>('/procurement/purchase-orders', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updatePurchaseOrder(
  id: string,
  input: UpdatePurchaseOrderPayload,
): Promise<PurchaseOrder> {
  return apiFetch<PurchaseOrder>(`/procurement/purchase-orders/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function cancelPurchaseOrder(id: string): Promise<PurchaseOrder> {
  return apiFetch<PurchaseOrder>(`/procurement/purchase-orders/${id}/cancel`, {
    method: 'POST',
  });
}
