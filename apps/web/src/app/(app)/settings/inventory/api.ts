import { apiFetch } from '@/lib/api-client';

export type ProductStatus = 'DRAFT' | 'ACTIVE' | 'ARCHIVED';

/** `GET /api/inventory`, `GET /api/inventory/:productId` response shape — see
 *  apps/api/src/inventory/inventory.controller.ts's `toStockResponse`. Extended Sprint
 *  4.5 with `location`/`quantityReserved`/`quantityAvailable`/`lastMovement`. */
export interface InventoryStock {
  productId: string;
  product: {
    id: string;
    code: string;
    name: string;
    type: 'FINISHED_PRODUCT' | 'RAW_MATERIAL' | 'PACKAGING_MATERIAL' | 'CONSUMABLE';
    unit: string;
    status: ProductStatus;
  };
  location: { id: string; name: string };
  quantityOnHand: number;
  quantityReserved: number;
  quantityAvailable: number;
  lastMovement: string | null;
  updatedAt: string | null;
}

export interface ListInventoryStockParams {
  search?: string;
  productType?: InventoryStock['product']['type'];
  productStatus?: ProductStatus;
  locationId?: string;
}

export type LocationStatus = 'ACTIVE' | 'INACTIVE';

/** `GET/POST /api/inventory/locations`, `PATCH .../locations/:id` response shape (Sprint
 *  4.5 brief §16/§20). No delete — only `status` toggling, same convention as
 *  Suppliers/Products. */
export interface InventoryLocation {
  id: string;
  name: string;
  status: LocationStatus;
  isDefault: boolean;
  productCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateInventoryLocationPayload {
  name: string;
}

export interface UpdateInventoryLocationPayload {
  name?: string;
  status?: LocationStatus;
}

export type AdjustmentReason =
  'PHYSICAL_COUNT' | 'DAMAGE' | 'SPOILAGE' | 'LOSS' | 'FOUND_STOCK' | 'DATA_CORRECTION' | 'OTHER';

export interface CreateInventoryAdjustmentPayload {
  productId: string;
  locationId?: string;
  /** Signed delta — positive increases stock, negative decreases it. Never a new
   *  absolute balance. */
  quantity: number;
  reason: AdjustmentReason;
  notes?: string;
}

/** `POST /api/inventory/adjustments` response shape — see `toAdjustmentResponse`. */
export interface StockAdjustmentResult {
  productId: string;
  product: { id: string; code: string; name: string; unit: string };
  location: { id: string; name: string };
  reason: AdjustmentReason;
  quantityDelta: number;
  previousQuantity: number;
  newQuantity: number;
  transactionId: string;
}

export type InventoryTransactionType = 'RECEIPT' | 'ISSUE' | 'ADJUSTMENT';

/** `GET /api/inventory/transactions` response shape — see `toTransactionResponse`. */
export interface InventoryTransaction {
  id: string;
  product: { id: string; code: string; name: string; unit: string };
  transactionType: InventoryTransactionType;
  quantity: number;
  referenceType: string;
  referenceId: string;
  createdAt: string;
}

export type RejectionReason =
  'DAMAGED' | 'DEFECTIVE' | 'WRONG_ITEM' | 'WRONG_SPECIFICATION' | 'CONTAMINATED' | 'OTHER';

export type DiscrepancyStatus =
  | 'NONE'
  | 'PENDING_SUPPLIER'
  | 'REPLACEMENT_EXPECTED'
  | 'REPLACEMENT_RECEIVED'
  | 'CREDIT_EXPECTED'
  | 'RESOLVED';

/** `GET/POST /api/inventory/goods-receipts`, `GET .../:id` response shape — see
 *  `toGoodsReceiptResponse`. Redesigned Sprint 4.4.1 to distinguish what was delivered
 *  from what was accepted/rejected (brief §1) — `quantityReceived` no longer exists. */
export interface GoodsReceiptItem {
  id: string;
  purchaseOrderItemId: string;
  product: { id: string; code: string; name: string; unit: string };
  deliveredQuantity: number;
  rejectedQuantity: number;
  acceptedQuantity: number;
  rejectionReason: RejectionReason | null;
  rejectionNotes: string | null;
}

export interface GoodsReceipt {
  id: string;
  goodsReceiptNumber: string;
  purchaseOrder: { id: string; purchaseOrderNumber: string };
  supplier: { id: string; supplierCode: string; supplierName: string };
  receivedDate: string;
  remarks: string | null;
  discrepancyStatus: DiscrepancyStatus;
  discrepancyNotes: string | null;
  items: GoodsReceiptItem[];
  createdAt: string;
  receivedById: string | null;
}

/** `GET /api/inventory/purchase-orders/:purchaseOrderId/receiving` response shape (Sprint
 *  4.4.1 brief §8/§13) — a per-item Ordered/Delivered/Accepted/Rejected/Outstanding view
 *  plus the full receipt history, aggregated across every `GoodsReceipt` ever recorded
 *  against the order. Powers both the Goods Receiving dialog's "previously delivered"
 *  context and Procurement's receiving-summary display. */
export interface PurchaseOrderItemReceivingSummary {
  purchaseOrderItemId: string;
  product: { id: string; code: string; name: string; unit: string };
  orderedQuantity: number;
  deliveredQuantity: number;
  acceptedQuantity: number;
  rejectedQuantity: number;
  outstandingQuantity: number;
  excessQuantity: number;
}

export interface PurchaseOrderReceivingSummary {
  purchaseOrder: { id: string; purchaseOrderNumber: string; status: string };
  items: PurchaseOrderItemReceivingSummary[];
  receipts: GoodsReceipt[];
}

export interface GoodsReceiptItemPayload {
  purchaseOrderItemId: string;
  deliveredQuantity: number;
  rejectedQuantity: number;
  rejectionReason?: RejectionReason;
  rejectionNotes?: string;
}

/** Local "wire" payload type, deliberately not the zod-inferred `CreateGoodsReceiptInput`
 *  from `@zentuva/validation` — same `orderDate`-style `Date`-vs-string mismatch as
 *  `procurement/api.ts`'s `CreatePurchaseOrderPayload`: the schema's `receivedDate` is
 *  `z.coerce.date()` so the *server* can parse an incoming JSON string, but this form
 *  works with a plain `<input type="date">` string end to end. */
export interface CreateGoodsReceiptPayload {
  purchaseOrderId: string;
  receivedDate: string;
  remarks?: string;
  items: GoodsReceiptItemPayload[];
}

export interface UpdateGoodsReceiptDiscrepancyPayload {
  status: DiscrepancyStatus;
  notes?: string;
}

export function listInventoryStock(
  params: ListInventoryStockParams = {},
): Promise<{ items: InventoryStock[] }> {
  const query = new URLSearchParams();
  if (params.search) query.set('search', params.search);
  if (params.productType) query.set('productType', params.productType);
  if (params.productStatus) query.set('productStatus', params.productStatus);
  if (params.locationId) query.set('locationId', params.locationId);
  const queryString = query.toString();
  return apiFetch<{ items: InventoryStock[] }>(`/inventory${queryString ? `?${queryString}` : ''}`);
}

export function getInventoryStockByProduct(productId: string): Promise<InventoryStock> {
  return apiFetch<InventoryStock>(`/inventory/${productId}`);
}

export interface ListInventoryTransactionsParams {
  productId?: string;
  transactionType?: InventoryTransactionType;
}

export function listInventoryTransactions(
  params: ListInventoryTransactionsParams = {},
): Promise<{ items: InventoryTransaction[] }> {
  const query = new URLSearchParams();
  if (params.productId) query.set('productId', params.productId);
  if (params.transactionType) query.set('transactionType', params.transactionType);
  const queryString = query.toString();
  return apiFetch<{ items: InventoryTransaction[] }>(
    `/inventory/transactions${queryString ? `?${queryString}` : ''}`,
  );
}

export function listGoodsReceipts(): Promise<{ items: GoodsReceipt[] }> {
  return apiFetch<{ items: GoodsReceipt[] }>('/inventory/goods-receipts');
}

export function getGoodsReceipt(id: string): Promise<GoodsReceipt> {
  return apiFetch<GoodsReceipt>(`/inventory/goods-receipts/${id}`);
}

export function createGoodsReceipt(input: CreateGoodsReceiptPayload): Promise<GoodsReceipt> {
  return apiFetch<GoodsReceipt>('/inventory/goods-receipts', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateGoodsReceiptDiscrepancy(
  id: string,
  input: UpdateGoodsReceiptDiscrepancyPayload,
): Promise<GoodsReceipt> {
  return apiFetch<GoodsReceipt>(`/inventory/goods-receipts/${id}/discrepancy`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function getPurchaseOrderReceivingSummary(
  purchaseOrderId: string,
): Promise<PurchaseOrderReceivingSummary> {
  return apiFetch<PurchaseOrderReceivingSummary>(
    `/inventory/purchase-orders/${purchaseOrderId}/receiving`,
  );
}

export function listInventoryLocations(): Promise<{ items: InventoryLocation[] }> {
  return apiFetch<{ items: InventoryLocation[] }>('/inventory/locations');
}

export function createInventoryLocation(
  input: CreateInventoryLocationPayload,
): Promise<InventoryLocation> {
  return apiFetch<InventoryLocation>('/inventory/locations', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateInventoryLocation(
  id: string,
  input: UpdateInventoryLocationPayload,
): Promise<InventoryLocation> {
  return apiFetch<InventoryLocation>(`/inventory/locations/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function createInventoryAdjustment(
  input: CreateInventoryAdjustmentPayload,
): Promise<StockAdjustmentResult> {
  return apiFetch<StockAdjustmentResult>('/inventory/adjustments', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
