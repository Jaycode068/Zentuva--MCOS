import { apiFetch } from '@/lib/api-client';

/** `GET /api/inventory`, `GET /api/inventory/:productId` response shape — see
 *  apps/api/src/inventory/inventory.controller.ts's `toStockResponse`. */
export interface InventoryStock {
  productId: string;
  product: {
    id: string;
    code: string;
    name: string;
    type: 'FINISHED_PRODUCT' | 'RAW_MATERIAL' | 'PACKAGING_MATERIAL' | 'CONSUMABLE';
    unit: string;
  };
  quantityOnHand: number;
  updatedAt: string | null;
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

export function listInventoryStock(): Promise<{ items: InventoryStock[] }> {
  return apiFetch<{ items: InventoryStock[] }>('/inventory');
}

export function getInventoryStockByProduct(productId: string): Promise<InventoryStock> {
  return apiFetch<InventoryStock>(`/inventory/${productId}`);
}

export function listInventoryTransactions(): Promise<{ items: InventoryTransaction[] }> {
  return apiFetch<{ items: InventoryTransaction[] }>('/inventory/transactions');
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
