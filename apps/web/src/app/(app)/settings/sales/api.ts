import { apiFetch } from '@/lib/api-client';

export type SalesOrderStatus = 'DRAFT' | 'CONFIRMED' | 'CANCELLED';

export interface SalesOrderItem {
  id: string;
  product: { id: string; code: string; name: string; unit: string };
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

/** `GET/POST /api/sales/orders`, `GET/PATCH .../:id` response shape — see
 *  `apps/api/src/sales/sales-order.controller.ts`'s `toSalesOrderResponse`. */
export interface SalesOrder {
  id: string;
  orderCode: string;
  customer: { id: string; customerCode: string; customerName: string };
  outlet: { id: string; outletCode: string; name: string } | null;
  salesAgentId: string;
  status: SalesOrderStatus;
  orderDate: string;
  notes: string | null;
  subtotal: number;
  discount: number;
  total: number;
  items: SalesOrderItem[];
  createdAt: string;
  updatedAt: string;
}

export interface SalesOrderItemPayload {
  productId: string;
  quantity: number;
  unitPrice: number;
}

/** Local "wire" payload type — same `Date`-vs-string distinction as every other
 *  `Create*Payload` type in this codebase (e.g. `production/api.ts`'s
 *  `CreateMaterialIssuePayload`): the schema's `orderDate` is `z.coerce.date()` so the
 *  server can parse an incoming JSON string, but this form works with a plain
 *  `<input type="date">` string end to end. */
export interface CreateSalesOrderPayload {
  customerId: string;
  outletId?: string;
  orderDate: string;
  discount?: number;
  notes?: string;
  items: SalesOrderItemPayload[];
}

export interface UpdateSalesOrderPayload {
  outletId?: string | null;
  orderDate?: string;
  discount?: number;
  notes?: string;
  items?: SalesOrderItemPayload[];
}

export interface ListSalesOrdersParams {
  status?: SalesOrderStatus;
  customerId?: string;
  outletId?: string;
  search?: string;
}

export function listSalesOrders(
  params: ListSalesOrdersParams = {},
): Promise<{ items: SalesOrder[] }> {
  const query = new URLSearchParams();
  if (params.status) query.set('status', params.status);
  if (params.customerId) query.set('customerId', params.customerId);
  if (params.outletId) query.set('outletId', params.outletId);
  if (params.search) query.set('search', params.search);
  const queryString = query.toString();
  return apiFetch<{ items: SalesOrder[] }>(`/sales/orders${queryString ? `?${queryString}` : ''}`);
}

export function getSalesOrder(id: string): Promise<SalesOrder> {
  return apiFetch<SalesOrder>(`/sales/orders/${id}`);
}

export function createSalesOrder(input: CreateSalesOrderPayload): Promise<SalesOrder> {
  return apiFetch<SalesOrder>('/sales/orders', { method: 'POST', body: JSON.stringify(input) });
}

export function updateSalesOrder(id: string, input: UpdateSalesOrderPayload): Promise<SalesOrder> {
  return apiFetch<SalesOrder>(`/sales/orders/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function confirmSalesOrder(id: string): Promise<SalesOrder> {
  return apiFetch<SalesOrder>(`/sales/orders/${id}/confirm`, { method: 'POST' });
}

export function cancelSalesOrder(id: string): Promise<SalesOrder> {
  return apiFetch<SalesOrder>(`/sales/orders/${id}/cancel`, { method: 'POST' });
}
