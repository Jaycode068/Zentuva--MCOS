import { apiFetch } from '@/lib/api-client';

export type ProductType = 'FINISHED_PRODUCT' | 'RAW_MATERIAL' | 'PACKAGING_MATERIAL' | 'CONSUMABLE';

export interface ProductRef {
  id: string;
  code: string;
  name: string;
  unit: string;
}

export type BillOfMaterialStatus = 'DRAFT' | 'ACTIVE' | 'INACTIVE';

/** `GET/POST /api/production/boms`, `GET/PATCH .../:id` response shape — see
 *  `apps/api/src/production/bill-of-material.controller.ts`'s `toBomResponse`. */
export interface BillOfMaterialItem {
  id: string;
  componentProduct: ProductRef & { type: ProductType };
  quantity: number;
  unitOfMeasure: string;
  notes: string | null;
}

export interface BillOfMaterial {
  id: string;
  bomNumber: string;
  product: ProductRef & { type: ProductType };
  name: string | null;
  status: BillOfMaterialStatus;
  yieldQuantity: number;
  notes: string | null;
  items: BillOfMaterialItem[];
  createdAt: string;
  updatedAt: string;
}

export interface BillOfMaterialItemPayload {
  componentProductId: string;
  quantity: number;
  unitOfMeasure: string;
  notes?: string;
}

export interface CreateBillOfMaterialPayload {
  productId: string;
  name?: string;
  yieldQuantity: number;
  notes?: string;
  items: BillOfMaterialItemPayload[];
}

export interface UpdateBillOfMaterialPayload {
  name?: string;
  yieldQuantity?: number;
  notes?: string;
  items?: BillOfMaterialItemPayload[];
}

export interface ListBillOfMaterialsParams {
  productId?: string;
  status?: BillOfMaterialStatus;
  search?: string;
}

export type ProductionOrderStatus = 'DRAFT' | 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';

export type ProductionRejectionReason =
  'BURNT' | 'UNDERWEIGHT' | 'PACKAGING_DEFECT' | 'POOR_SEAL' | 'OTHER';

/** `GET/POST /api/production/orders`, `GET/PATCH .../:id` response shape — see
 *  `apps/api/src/production/production-order.controller.ts`'s `toOrderResponse`. */
export interface ProductionOrderItem {
  id: string;
  componentProduct: ProductRef;
  requiredQuantity: number;
  unitOfMeasure: string;
}

export interface ProductionRun {
  id: string;
  producedQuantity: number;
  rejectedQuantity: number;
  acceptedQuantity: number;
  rejectionReason: ProductionRejectionReason | null;
  rejectionNotes: string | null;
  completedById: string | null;
  completedAt: string;
}

export interface ProductionOrder {
  id: string;
  productionOrderNumber: string;
  product: ProductRef;
  billOfMaterial: { id: string; bomNumber: string };
  plannedQuantity: number;
  location: { id: string; name: string };
  status: ProductionOrderStatus;
  notes: string | null;
  items: ProductionOrderItem[];
  productionRun: ProductionRun | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProductionOrderPayload {
  billOfMaterialId: string;
  plannedQuantity: number;
  locationId: string;
  notes?: string;
}

export interface UpdateProductionOrderPayload {
  plannedQuantity?: number;
  locationId?: string;
  notes?: string;
}

export interface ListProductionOrdersParams {
  status?: ProductionOrderStatus;
  productId?: string;
  search?: string;
}

/** `GET /api/production/orders/:id/availability` response shape — informational only,
 *  never gates any status transition (brief §9). */
export interface MaterialAvailabilityRow {
  componentProductId: string;
  product: ProductRef;
  requiredQuantity: number;
  unitOfMeasure: string;
  availableQuantity: number;
  shortfall: number;
}

/** `GET/POST /api/production/orders/:id/material-issues` response shape — see
 *  `toMaterialIssueResponse`. */
export interface ProductionMaterialIssueItem {
  id: string;
  componentProduct: ProductRef;
  quantityIssued: number;
}

/** Added Sprint 9 — the automatically-posted Journal Entry for a Material Issue's/
 *  Production Run's accounting consequence, `null` when nothing was posted (e.g.
 *  every issued component had a `0` cost). */
export interface ProductionJournalEntry {
  id: string;
  journalNumber: string;
  status: 'DRAFT' | 'POSTED' | 'VOID';
  totalAmount: number;
}

export interface ProductionMaterialIssue {
  id: string;
  productionOrderId: string;
  issuedDate: string;
  issuedById: string | null;
  notes: string | null;
  items: ProductionMaterialIssueItem[];
  createdAt: string;
  journalEntry?: ProductionJournalEntry | null;
}

export interface MaterialIssueItemPayload {
  componentProductId: string;
  quantity: number;
}

/** Local "wire" payload type, deliberately not the zod-inferred `CreateMaterialIssueInput`
 *  from `@zentuva/validation` — same `Date`-vs-string mismatch as every other
 *  `Create*Payload` type in this codebase (e.g. `inventory/api.ts`'s
 *  `CreateGoodsReceiptPayload`): the schema's `issuedDate` is `z.coerce.date()` so the
 *  *server* can parse an incoming JSON string, but this form works with a plain
 *  `<input type="date">` string end to end. */
export interface CreateMaterialIssuePayload {
  issuedDate: string;
  notes?: string;
  items: MaterialIssueItemPayload[];
  /** Added Sprint 9 — same double-submit protection every other create-payload in
   *  this codebase has. */
  idempotencyKey?: string;
}

export interface CompleteProductionOrderPayload {
  producedQuantity: number;
  rejectedQuantity: number;
  rejectionReason?: ProductionRejectionReason;
  rejectionNotes?: string;
  /** Added Sprint 9 — lets a genuine retry of the same completion request return the
   *  original result instead of a hard conflict error. */
  idempotencyKey?: string;
}

export interface CompleteProductionResult {
  productionOrder: ProductionOrder;
  productionRun: ProductionRun;
  journalEntry?: ProductionJournalEntry | null;
}

/** Added Sprint 9 — `GET /production/orders/:id/accounting` response shape (brief
 *  §14/§15). */
export interface ProductionAccountingSummary {
  materialCost: number;
  journalEntries: ProductionJournalEntry[];
}

export function listBillOfMaterials(
  params: ListBillOfMaterialsParams = {},
): Promise<{ items: BillOfMaterial[] }> {
  const query = new URLSearchParams();
  if (params.productId) query.set('productId', params.productId);
  if (params.status) query.set('status', params.status);
  if (params.search) query.set('search', params.search);
  const queryString = query.toString();
  return apiFetch<{ items: BillOfMaterial[] }>(
    `/production/boms${queryString ? `?${queryString}` : ''}`,
  );
}

export function getBillOfMaterial(id: string): Promise<BillOfMaterial> {
  return apiFetch<BillOfMaterial>(`/production/boms/${id}`);
}

export function createBillOfMaterial(input: CreateBillOfMaterialPayload): Promise<BillOfMaterial> {
  return apiFetch<BillOfMaterial>('/production/boms', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateBillOfMaterial(
  id: string,
  input: UpdateBillOfMaterialPayload,
): Promise<BillOfMaterial> {
  return apiFetch<BillOfMaterial>(`/production/boms/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function activateBillOfMaterial(id: string): Promise<BillOfMaterial> {
  return apiFetch<BillOfMaterial>(`/production/boms/${id}/activate`, { method: 'POST' });
}

export function deactivateBillOfMaterial(id: string): Promise<BillOfMaterial> {
  return apiFetch<BillOfMaterial>(`/production/boms/${id}/deactivate`, { method: 'POST' });
}

export function listProductionOrders(
  params: ListProductionOrdersParams = {},
): Promise<{ items: ProductionOrder[] }> {
  const query = new URLSearchParams();
  if (params.status) query.set('status', params.status);
  if (params.productId) query.set('productId', params.productId);
  if (params.search) query.set('search', params.search);
  const queryString = query.toString();
  return apiFetch<{ items: ProductionOrder[] }>(
    `/production/orders${queryString ? `?${queryString}` : ''}`,
  );
}

export function getProductionOrder(id: string): Promise<ProductionOrder> {
  return apiFetch<ProductionOrder>(`/production/orders/${id}`);
}

export function createProductionOrder(
  input: CreateProductionOrderPayload,
): Promise<ProductionOrder> {
  return apiFetch<ProductionOrder>('/production/orders', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateProductionOrder(
  id: string,
  input: UpdateProductionOrderPayload,
): Promise<ProductionOrder> {
  return apiFetch<ProductionOrder>(`/production/orders/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function getProductionOrderAvailability(
  id: string,
): Promise<{ items: MaterialAvailabilityRow[] }> {
  return apiFetch<{ items: MaterialAvailabilityRow[] }>(`/production/orders/${id}/availability`);
}

export function planProductionOrder(id: string): Promise<ProductionOrder> {
  return apiFetch<ProductionOrder>(`/production/orders/${id}/plan`, { method: 'POST' });
}

export function cancelProductionOrder(id: string): Promise<ProductionOrder> {
  return apiFetch<ProductionOrder>(`/production/orders/${id}/cancel`, { method: 'POST' });
}

export function listMaterialIssues(
  productionOrderId: string,
): Promise<{ items: ProductionMaterialIssue[] }> {
  return apiFetch<{ items: ProductionMaterialIssue[] }>(
    `/production/orders/${productionOrderId}/material-issues`,
  );
}

export function issueMaterial(
  productionOrderId: string,
  input: CreateMaterialIssuePayload,
): Promise<ProductionMaterialIssue> {
  return apiFetch<ProductionMaterialIssue>(
    `/production/orders/${productionOrderId}/material-issues`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  );
}

export function getProductionRun(productionOrderId: string): Promise<ProductionRun | null> {
  return apiFetch<ProductionRun | null>(`/production/orders/${productionOrderId}/production-run`);
}

export function completeProduction(
  productionOrderId: string,
  input: CompleteProductionOrderPayload,
): Promise<CompleteProductionResult> {
  return apiFetch<CompleteProductionResult>(`/production/orders/${productionOrderId}/complete`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** Added Sprint 9 — read-only accounting summary (brief §14/§15). */
export function getProductionAccountingSummary(
  productionOrderId: string,
): Promise<ProductionAccountingSummary> {
  return apiFetch<ProductionAccountingSummary>(
    `/production/orders/${productionOrderId}/accounting`,
  );
}
