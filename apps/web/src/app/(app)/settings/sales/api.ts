import { apiFetch } from '@/lib/api-client';

export type SalesOrderStatus =
  'DRAFT' | 'CONFIRMED' | 'PARTIALLY_FULFILLED' | 'FULFILLED' | 'CANCELLED';

export interface SalesOrderItem {
  id: string;
  product: { id: string; code: string; name: string; unit: string };
  quantity: number;
  /** Cumulative quantity physically supplied so far (Sprint 4.9) — never client-writable,
   *  only ever moved by `fulfilSalesOrder`. */
  quantityFulfilled: number;
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

/** One line of `GET /:id/availability` (Sprint 4.9) — read-only, purely informational,
 *  never gates `fulfilSalesOrder`. */
export interface SalesOrderAvailabilityRow {
  salesOrderItemId: string;
  productId: string;
  product: { id: string; code: string; name: string; unit: string };
  ordered: number;
  fulfilled: number;
  remaining: number;
  availableStock: number;
  shortfall: number;
}

export interface SalesFulfilmentItem {
  id: string;
  product: { id: string; code: string; name: string; unit: string };
  quantityFulfilled: number;
}

/** `GET /:id/fulfilments` response shape — see
 *  `apps/api/src/sales/sales-order.controller.ts`'s `toSalesFulfilmentResponse`. */
export interface SalesFulfilment {
  id: string;
  fulfilmentDate: string;
  location: { id: string; name: string };
  notes: string | null;
  items: SalesFulfilmentItem[];
  createdAt: string;
}

export interface SalesFulfilmentItemPayload {
  salesOrderItemId: string;
  quantity: number;
}

export interface CreateSalesFulfilmentPayload {
  locationId: string;
  fulfilmentDate: string;
  notes?: string;
  /** Client-generated once per fulfilment attempt (`crypto.randomUUID()`) and reused
   *  across retries of the same submit — lets a double-tap or flaky-network retry return
   *  the original fulfilment instead of deducting stock twice (Sprint 4.9). */
  idempotencyKey?: string;
  items: SalesFulfilmentItemPayload[];
}

export function getSalesOrderAvailability(
  id: string,
  locationId?: string,
): Promise<{ items: SalesOrderAvailabilityRow[] }> {
  const query = locationId ? `?locationId=${encodeURIComponent(locationId)}` : '';
  return apiFetch<{ items: SalesOrderAvailabilityRow[] }>(
    `/sales/orders/${id}/availability${query}`,
  );
}

export function listSalesFulfilments(id: string): Promise<{ items: SalesFulfilment[] }> {
  return apiFetch<{ items: SalesFulfilment[] }>(`/sales/orders/${id}/fulfilments`);
}

export function fulfilSalesOrder(
  id: string,
  input: CreateSalesFulfilmentPayload,
): Promise<SalesOrder> {
  return apiFetch<SalesOrder>(`/sales/orders/${id}/fulfil`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
