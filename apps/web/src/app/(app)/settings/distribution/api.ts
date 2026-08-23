import { apiFetch, apiFetchFormData } from '@/lib/api-client';

export type DispatchStatus =
  | 'READY'
  | 'DISPATCHED'
  | 'IN_TRANSIT'
  | 'PARTIALLY_DELIVERED'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'FAILED';

export interface DispatchItem {
  id: string;
  product: { id: string; code: string; name: string; unit: string };
  salesFulfilmentItemId: string;
  quantityDispatched: number;
  /** Cumulative quantity confirmed delivered so far — never client-writable, only ever
   *  moved by `createDelivery`. */
  quantityDelivered: number;
}

/** `GET/POST /api/distribution`, `GET .../:id` response shape — see
 *  `apps/api/src/distribution/dispatch.controller.ts`'s `toDispatchResponse`. */
export interface Dispatch {
  id: string;
  dispatchCode: string;
  salesFulfilmentId: string;
  salesOrder: { id: string; orderCode: string };
  customer: { id: string; customerCode: string; customerName: string; territoryId: string | null };
  outlet: { id: string; outletCode: string; name: string; territoryId: string | null } | null;
  /** Resolved server-side: the outlet's territory when set (more specific destination),
   *  falling back to the customer's — purely a display field, never a gate. */
  territoryId: string | null;
  sourceLocation: { id: string; name: string };
  dispatchDate: string;
  status: DispatchStatus;
  notes: string | null;
  items: DispatchItem[];
  createdAt: string;
  updatedAt: string;
}

export interface DispatchItemPayload {
  salesFulfilmentItemId: string;
  quantity: number;
}

export interface CreateDispatchPayload {
  salesFulfilmentId: string;
  outletId?: string;
  sourceLocationId: string;
  dispatchDate: string;
  notes?: string;
  /** Client-generated once per dispatch attempt (`crypto.randomUUID()`) and reused across
   *  retries of the same submit — protects against a double-tap or flaky-network retry
   *  creating two dispatches for the same fulfilment. */
  idempotencyKey?: string;
  items: DispatchItemPayload[];
}

export interface ListDispatchesParams {
  status?: DispatchStatus;
  customerId?: string;
  salesOrderId?: string;
  search?: string;
}

export function listDispatches(params: ListDispatchesParams = {}): Promise<{ items: Dispatch[] }> {
  const query = new URLSearchParams();
  if (params.status) query.set('status', params.status);
  if (params.customerId) query.set('customerId', params.customerId);
  if (params.salesOrderId) query.set('salesOrderId', params.salesOrderId);
  if (params.search) query.set('search', params.search);
  const queryString = query.toString();
  return apiFetch<{ items: Dispatch[] }>(`/distribution${queryString ? `?${queryString}` : ''}`);
}

export function getDispatch(id: string): Promise<Dispatch> {
  return apiFetch<Dispatch>(`/distribution/${id}`);
}

export function createDispatch(input: CreateDispatchPayload): Promise<Dispatch> {
  return apiFetch<Dispatch>('/distribution', { method: 'POST', body: JSON.stringify(input) });
}

export function dispatchOut(id: string): Promise<Dispatch> {
  return apiFetch<Dispatch>(`/distribution/${id}/dispatch`, { method: 'POST' });
}

export function markInTransit(id: string): Promise<Dispatch> {
  return apiFetch<Dispatch>(`/distribution/${id}/in-transit`, { method: 'POST' });
}

export function cancelDispatch(id: string): Promise<Dispatch> {
  return apiFetch<Dispatch>(`/distribution/${id}/cancel`, { method: 'POST' });
}

export function failDispatch(id: string, notes: string): Promise<Dispatch> {
  return apiFetch<Dispatch>(`/distribution/${id}/fail`, {
    method: 'POST',
    body: JSON.stringify({ notes }),
  });
}

/** `GET /distribution/fulfilments/:salesFulfilmentId/dispatch-availability` (read-only,
 *  never gates `createDispatch`). */
export interface DispatchAvailabilityRow {
  salesFulfilmentItemId: string;
  productId: string;
  product: { id: string; code: string; name: string; unit: string };
  fulfilled: number;
  dispatched: number;
  remaining: number;
}

export function getDispatchAvailability(
  salesFulfilmentId: string,
): Promise<{ items: DispatchAvailabilityRow[] }> {
  return apiFetch<{ items: DispatchAvailabilityRow[] }>(
    `/distribution/fulfilments/${salesFulfilmentId}/dispatch-availability`,
  );
}

export interface DeliveryItem {
  id: string;
  product: { id: string; code: string; name: string; unit: string };
  quantityDelivered: number;
}

/** `GET/POST /:id/deliveries` response shape — see
 *  `apps/api/src/distribution/dispatch.controller.ts`'s `toDeliveryResponse`. */
export interface Delivery {
  id: string;
  dispatchId: string;
  deliveryDate: string;
  receivedByName: string | null;
  notes: string | null;
  photoUrl: string | null;
  items: DeliveryItem[];
  createdAt: string;
}

export interface DeliveryItemPayload {
  dispatchItemId: string;
  quantity: number;
}

export interface CreateDeliveryPayload {
  deliveryDate: string;
  receivedByName?: string;
  notes?: string;
  /** Client-generated once per delivery attempt (`crypto.randomUUID()`) and reused across
   *  retries of the same submit (Sprint 5, same pattern as `CreateSalesFulfilmentPayload`). */
  idempotencyKey?: string;
  items: DeliveryItemPayload[];
}

export function listDeliveries(dispatchId: string): Promise<{ items: Delivery[] }> {
  return apiFetch<{ items: Delivery[] }>(`/distribution/${dispatchId}/deliveries`);
}

export function createDelivery(
  dispatchId: string,
  input: CreateDeliveryPayload,
): Promise<Dispatch> {
  return apiFetch<Dispatch>(`/distribution/${dispatchId}/deliveries`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function uploadDeliveryPhoto(deliveryId: string, file: File): Promise<Delivery> {
  const formData = new FormData();
  formData.append('file', file);
  return apiFetchFormData<Delivery>(`/distribution/deliveries/${deliveryId}/photo`, formData);
}
