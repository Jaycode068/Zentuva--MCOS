import { apiFetch } from '@/lib/api-client';

/**
 * Sprint 39 — D2C Sales Administration & Operations Dashboard
 * (docs/domains/d2c.md). API client for the admin dashboard/orders/
 * collection-points/territories pages — kept separate from
 * `consumers/api.ts`/`conversation/api.ts` (each area owns its own client,
 * the established convention in this codebase), but reused BY those pages
 * where they need D2C Admin data (e.g. the Consumer detail dialog's order/
 * payment/collection history).
 */

// ---------------------------------------------------------------------------
// Overview / Attention / Territories
// ---------------------------------------------------------------------------

export type AttentionCategory = 'INFORMATION' | 'ACTION_REQUIRED';
/** Added Sprint 43 — a rough operator-triage signal, see `D2CExceptionSeverity` in
 *  `docs/domains/d2c.md` "Operational Exceptions". */
export type AttentionSeverity = 'LOW' | 'MEDIUM' | 'HIGH';
export type AttentionType =
  | 'UNASSIGNED_ORDER'
  | 'FAILED_PAYMENT'
  | 'STALE_PENDING_PAYMENT'
  | 'STUCK_FULFILLMENT'
  | 'STUCK_READY_FOR_COLLECTION'
  | 'DISABLED_COLLECTION_POINT_WITH_QUEUE'
  | 'NOTIFICATION_FAILED';

export interface D2CAttentionItem {
  category: AttentionCategory;
  type: AttentionType;
  severity: AttentionSeverity;
  message: string;
  entityType: 'SalesOrder' | 'CollectionPointFulfillment' | 'Outlet' | 'ConsumerWhatsAppDelivery';
  entityId: string;
  detectedAt: string;
  orderCode?: string | null;
  consumerName?: string | null;
  territoryName?: string | null;
  collectionPointName?: string | null;
}

export interface D2CAdminOverview {
  summary: {
    totalD2COrders: number;
    ordersToday: number;
    ordersPreparing: number;
    ordersReadyForCollection: number;
    ordersCollectedToday: number;
    consumersTotal: number;
    activeConsumers: number;
    newConsumersToday: number;
    activeCollectionPoints: number;
    pendingPayments: number;
    failedPayments: number;
    unassignedOrders: number;
    exceptionsCount: number;
    whatsappSentToday: number;
    whatsappFailedToday: number;
    whatsappEligibleForRetry: number;
  };
  attention: D2CAttentionItem[];
  recentOrders: {
    id: string;
    orderCode: string;
    consumerName: string | null;
    status: string;
    total: number;
    orderDate: string;
  }[];
}

export interface D2CTerritorySummaryRow {
  territoryId: string;
  territoryName: string;
  consumerCount: number;
  d2cOrderCount: number;
  collectionPointCount: number;
  enabledCollectionPointCount: number;
}

export function getD2CAdminOverview(): Promise<D2CAdminOverview> {
  return apiFetch<D2CAdminOverview>('/d2c/admin/overview');
}

export function getD2CAttention(): Promise<{ items: D2CAttentionItem[] }> {
  return apiFetch<{ items: D2CAttentionItem[] }>('/d2c/admin/attention');
}

export function getD2CTerritorySummary(): Promise<{ items: D2CTerritorySummaryRow[] }> {
  return apiFetch<{ items: D2CTerritorySummaryRow[] }>('/d2c/admin/territories');
}

// ---------------------------------------------------------------------------
// D2C Order list/detail (source=D2C slice of the existing SalesOrder aggregate)
// ---------------------------------------------------------------------------

export type D2COrderStatus =
  'DRAFT' | 'CONFIRMED' | 'PARTIALLY_FULFILLED' | 'FULFILLED' | 'CANCELLED';
export type D2CPaymentStatus = 'PENDING' | 'RECORDED' | 'FAILED' | 'VOIDED' | 'CLOSED' | 'NONE';

export interface D2COrderSummary {
  id: string;
  orderCode: string;
  consumer: {
    id: string;
    consumerCode: string;
    fullName: string;
    territoryId: string | null;
  } | null;
  source: 'B2B' | 'D2C';
  status: D2COrderStatus;
  orderDate: string;
  total: number;
  items: {
    id: string;
    product: { id: string; code: string; name: string; unit: string };
    quantity: number;
    quantityFulfilled: number;
    unitPrice: number;
    lineTotal: number;
  }[];
  createdAt: string;
}

export interface ListD2COrdersParams {
  status?: D2COrderStatus;
  consumerId?: string;
  territoryId?: string;
  collectionPointOutletId?: string;
  paymentStatus?: D2CPaymentStatus;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface ListD2COrdersResult {
  items: D2COrderSummary[];
  total: number;
  page: number;
  pageSize: number;
}

export function listD2COrders(params: ListD2COrdersParams = {}): Promise<ListD2COrdersResult> {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== '') query.set(key, String(value));
  });
  const qs = query.toString();
  return apiFetch<ListD2COrdersResult>(`/d2c/admin/orders${qs ? `?${qs}` : ''}`);
}

export function getD2COrder(id: string): Promise<D2COrderSummary> {
  return apiFetch<D2COrderSummary>(`/sales/orders/${id}`);
}

// ---------------------------------------------------------------------------
// Collection Point fulfilment (admin-wide, source: the existing Sprint 37/38
// CollectionPointFulfillment aggregate — never a parallel entity)
// ---------------------------------------------------------------------------

export type CollectionPointFulfillmentStatusValue =
  'ASSIGNED' | 'PREPARING' | 'READY_FOR_COLLECTION' | 'COLLECTED';

export interface CollectionPointFulfillmentSummary {
  id: string;
  salesOrderId: string;
  orderReference: string;
  orderDate: string;
  total: number;
  outletId: string;
  outletName: string;
  status: CollectionPointFulfillmentStatusValue;
  assignedAt: string;
  preparingAt: string | null;
  readyAt: string | null;
  collectedAt: string | null;
  salesOrderStatus: string;
  paymentStatus: string | null;
  paidAt: string | null;
  consumer: { name: string; phoneNumber: string; territoryName: string | null } | null;
  items: { productName: string; quantity: number; unit: string }[];
}

export interface ListCollectionPointFulfillmentsParams {
  status?: CollectionPointFulfillmentStatusValue;
  outletId?: string;
  territoryId?: string;
  consumerId?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface ListCollectionPointFulfillmentsResult {
  items: CollectionPointFulfillmentSummary[];
  total: number;
  page: number;
  pageSize: number;
}

export function listCollectionPointFulfillments(
  params: ListCollectionPointFulfillmentsParams = {},
): Promise<ListCollectionPointFulfillmentsResult> {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== '') query.set(key, String(value));
  });
  const qs = query.toString();
  return apiFetch<ListCollectionPointFulfillmentsResult>(
    `/d2c/collection-point-fulfillments${qs ? `?${qs}` : ''}`,
  );
}

export function getCollectionPointFulfillmentBySalesOrder(
  salesOrderId: string,
): Promise<{ item: CollectionPointFulfillmentSummary | null }> {
  return apiFetch<{ item: CollectionPointFulfillmentSummary | null }>(
    `/d2c/collection-point-fulfillments/by-sales-order/${salesOrderId}`,
  );
}

/** Every enabled Collection Point tenant-wide (an admin caller) — used by the admin-wide
 *  Collection Points page's outlet filter. */
export function listEnabledCollectionPointOutlets(): Promise<{
  items: { id: string; name: string }[];
}> {
  return apiFetch<{ items: { id: string; name: string }[] }>(
    '/d2c/collection-point-fulfillments/my-outlets',
  );
}

/** The reassignment dialog's own picker — unlike the plain "enabled" list above, this is
 *  pre-filtered to outlets that will actually pass `reassign()`'s eligibility check
 *  (active, enabled, AND a configured inventory location), so every option offered here
 *  is guaranteed to succeed. */
export function listEligibleOutletsForReassignment(): Promise<{
  items: { id: string; name: string }[];
}> {
  return apiFetch<{ items: { id: string; name: string }[] }>(
    '/d2c/collection-point-fulfillments/eligible-for-reassignment',
  );
}

export function reassignCollectionPoint(
  id: string,
  outletId: string,
): Promise<CollectionPointFulfillmentSummary> {
  return apiFetch<CollectionPointFulfillmentSummary>(
    `/d2c/collection-point-fulfillments/${id}/reassign`,
    { method: 'POST', body: JSON.stringify({ outletId }) },
  );
}

// ---------------------------------------------------------------------------
// Payment history (the existing Finance Payment aggregate's D2C-aware filters)
// ---------------------------------------------------------------------------

export interface D2CPaymentSummary {
  id: string;
  consumer: { id: string; consumerCode: string; fullName: string } | null;
  paymentDate: string;
  amount: number;
  currency: string;
  method: string;
  status: string;
  provider: string | null;
  salesOrderId: string | null;
  createdAt: string;
}

export function listPaymentsForConsumer(
  consumerId: string,
): Promise<{ items: D2CPaymentSummary[] }> {
  return apiFetch<{ items: D2CPaymentSummary[] }>(`/finance/payments?consumerId=${consumerId}`);
}

export function listPaymentsForOrder(
  salesOrderId: string,
): Promise<{ items: D2CPaymentSummary[] }> {
  return apiFetch<{ items: D2CPaymentSummary[] }>(`/finance/payments?salesOrderId=${salesOrderId}`);
}

// ---------------------------------------------------------------------------
// Consumer Communication / Delivery History (Sprint 43 —
// docs/domains/d2c.md "Consumer Communication Delivery Visibility")
// ---------------------------------------------------------------------------

export type WhatsAppDeliveryStatusValue = 'PENDING' | 'PROCESSING' | 'SENT' | 'FAILED';

export interface ConsumerWhatsAppDeliverySummary {
  id: string;
  organisationId: string;
  // Sprint 43.5 — widened nullable: a `CONVERSATION_REPLY` sent before registration
  // completes has no Consumer yet, and most conversation turns have no SalesOrder.
  consumerId: string | null;
  salesOrderId: string | null;
  conversationId: string | null;
  kind: 'COLLECTION_READY' | 'COLLECTION_CONFIRMED' | 'CONVERSATION_REPLY';
  recipientPhoneSnapshot: string;
  messageSnapshot: string;
  status: WhatsAppDeliveryStatusValue;
  attempts: number;
  providerName: string | null;
  providerMessageId: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  firstAttemptedAt: string | null;
  lastAttemptedAt: string | null;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function listCommunicationsForConsumer(
  consumerId: string,
  params: { page?: number; pageSize?: number } = {},
): Promise<{
  items: ConsumerWhatsAppDeliverySummary[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const query = new URLSearchParams();
  if (params.page) query.set('page', String(params.page));
  if (params.pageSize) query.set('pageSize', String(params.pageSize));
  const qs = query.toString();
  return apiFetch<{
    items: ConsumerWhatsAppDeliverySummary[];
    total: number;
    page: number;
    pageSize: number;
  }>(`/d2c/communications/by-consumer/${consumerId}${qs ? `?${qs}` : ''}`);
}

export function listCommunicationsForOrder(
  salesOrderId: string,
): Promise<{ items: ConsumerWhatsAppDeliverySummary[] }> {
  return apiFetch<{ items: ConsumerWhatsAppDeliverySummary[] }>(
    `/d2c/communications/by-order/${salesOrderId}`,
  );
}

/** Added Sprint 43.5 — the admin conversation-transcript page's own delivery-log read. */
export function listCommunicationsForConversation(
  conversationId: string,
): Promise<{ items: ConsumerWhatsAppDeliverySummary[] }> {
  return apiFetch<{ items: ConsumerWhatsAppDeliverySummary[] }>(
    `/d2c/communications/by-conversation/${conversationId}`,
  );
}

export function retryCommunication(id: string): Promise<ConsumerWhatsAppDeliverySummary> {
  return apiFetch<ConsumerWhatsAppDeliverySummary>(`/d2c/communications/${id}/retry`, {
    method: 'POST',
  });
}
