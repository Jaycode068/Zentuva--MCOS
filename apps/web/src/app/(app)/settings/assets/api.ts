import { apiFetch, apiFetchFormData } from '@/lib/api-client';

/**
 * Shared API client for Sprint 20's Asset Register & Asset Management
 * Foundation (docs/domains/assets.md), following the exact
 * `finance/api.ts` one-shared-file convention.
 */

export type AssetCategoryStatus = 'ACTIVE' | 'INACTIVE';
export type AssetLocationStatus = 'ACTIVE' | 'INACTIVE';
export type AssetStatus =
  | 'DRAFT'
  | 'ACTIVE'
  | 'IN_SERVICE'
  | 'UNDER_MAINTENANCE'
  | 'OUT_OF_SERVICE'
  | 'DISPOSED'
  | 'RETIRED';
export type AssetCondition = 'NEW' | 'GOOD' | 'FAIR' | 'POOR' | 'CRITICAL';
export type AssetAcquisitionType =
  'PURCHASE' | 'CAPITAL_PROJECT' | 'TRANSFER' | 'DONATION' | 'LEASE' | 'OTHER';
export type AssetDocumentType =
  'PHOTO' | 'INVOICE' | 'WARRANTY_DOCUMENT' | 'MANUAL' | 'CERTIFICATE' | 'REGISTRATION' | 'OTHER';
export type AssetMeterType = 'HOURS' | 'KILOMETERS' | 'CYCLES' | 'UNITS' | 'OTHER';

// === Asset Categories ===

export interface AssetCategory {
  id: string;
  code: string;
  name: string;
  description: string | null;
  parentCategoryId: string | null;
  status: AssetCategoryStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAssetCategoryPayload {
  code: string;
  name: string;
  description?: string;
  parentCategoryId?: string;
}

export function listAssetCategories(
  params: { status?: AssetCategoryStatus } = {},
): Promise<{ items: AssetCategory[] }> {
  const query = new URLSearchParams();
  if (params.status) query.set('status', params.status);
  const queryString = query.toString();
  return apiFetch<{ items: AssetCategory[] }>(
    `/assets/categories${queryString ? `?${queryString}` : ''}`,
  );
}

export function createAssetCategory(input: CreateAssetCategoryPayload): Promise<AssetCategory> {
  return apiFetch<AssetCategory>('/assets/categories', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateAssetCategory(
  id: string,
  input: Partial<CreateAssetCategoryPayload>,
): Promise<AssetCategory> {
  return apiFetch<AssetCategory>(`/assets/categories/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function deactivateAssetCategory(id: string): Promise<AssetCategory> {
  return apiFetch<AssetCategory>(`/assets/categories/${id}/deactivate`, { method: 'POST' });
}

export function activateAssetCategory(id: string): Promise<AssetCategory> {
  return apiFetch<AssetCategory>(`/assets/categories/${id}/activate`, { method: 'POST' });
}

// === Asset Locations ===

export interface AssetLocation {
  id: string;
  name: string;
  parentLocationId: string | null;
  status: AssetLocationStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAssetLocationPayload {
  name: string;
  parentLocationId?: string;
}

export function listAssetLocations(
  params: { status?: AssetLocationStatus } = {},
): Promise<{ items: AssetLocation[] }> {
  const query = new URLSearchParams();
  if (params.status) query.set('status', params.status);
  const queryString = query.toString();
  return apiFetch<{ items: AssetLocation[] }>(
    `/assets/locations${queryString ? `?${queryString}` : ''}`,
  );
}

export function createAssetLocation(input: CreateAssetLocationPayload): Promise<AssetLocation> {
  return apiFetch<AssetLocation>('/assets/locations', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateAssetLocation(
  id: string,
  input: Partial<CreateAssetLocationPayload>,
): Promise<AssetLocation> {
  return apiFetch<AssetLocation>(`/assets/locations/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function deactivateAssetLocation(id: string): Promise<AssetLocation> {
  return apiFetch<AssetLocation>(`/assets/locations/${id}/deactivate`, { method: 'POST' });
}

export function activateAssetLocation(id: string): Promise<AssetLocation> {
  return apiFetch<AssetLocation>(`/assets/locations/${id}/activate`, { method: 'POST' });
}

// === Assets ===

export interface Asset {
  id: string;
  assetCode: string;
  assetTag: string | null;
  name: string;
  description: string | null;
  categoryId: string;
  parentAssetId: string | null;
  status: AssetStatus;
  condition: AssetCondition;
  serialNumber: string | null;
  manufacturer: string | null;
  model: string | null;
  yearOfManufacture: number | null;
  locationId: string | null;
  custodianId: string | null;
  acquisitionType: AssetAcquisitionType;
  acquisitionDate: string | null;
  inServiceDate: string | null;
  acquisitionCost: number | null;
  currency: string;
  supplierId: string | null;
  purchaseOrderId: string | null;
  capitalProjectId: string | null;
  warrantyStartDate: string | null;
  warrantyEndDate: string | null;
  warrantyProvider: string | null;
  warrantyReference: string | null;
  warrantyNotes: string | null;
  usefulLifeMonths: number | null;
  salvageValue: number | null;
  notes: string | null;
  imageUrl: string | null;
  imageKey: string | null;
  activatedAt: string | null;
  commissionedAt: string | null;
  disposedAt: string | null;
  retiredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAssetPayload {
  name: string;
  description?: string;
  categoryId: string;
  parentAssetId?: string;
  assetTag?: string;
  serialNumber?: string;
  manufacturer?: string;
  model?: string;
  yearOfManufacture?: number;
  locationId?: string;
  custodianId?: string;
  acquisitionType?: AssetAcquisitionType;
  acquisitionDate?: string;
  inServiceDate?: string;
  acquisitionCost?: number;
  currency?: string;
  supplierId?: string;
  purchaseOrderId?: string;
  capitalProjectId?: string;
  warrantyStartDate?: string;
  warrantyEndDate?: string;
  warrantyProvider?: string;
  warrantyReference?: string;
  warrantyNotes?: string;
  usefulLifeMonths?: number;
  salvageValue?: number;
  notes?: string;
  idempotencyKey?: string;
}

export function listAssets(
  params: {
    status?: AssetStatus;
    condition?: AssetCondition;
    categoryId?: string;
    locationId?: string;
    custodianId?: string;
    acquisitionType?: AssetAcquisitionType;
    search?: string;
  } = {},
): Promise<{ items: Asset[] }> {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value) query.set(key, value);
  });
  const queryString = query.toString();
  return apiFetch<{ items: Asset[] }>(`/assets${queryString ? `?${queryString}` : ''}`);
}

export function getAsset(id: string): Promise<Asset> {
  return apiFetch<Asset>(`/assets/${id}`);
}

export function createAsset(input: CreateAssetPayload): Promise<Asset> {
  return apiFetch<Asset>('/assets', { method: 'POST', body: JSON.stringify(input) });
}

export function updateAsset(id: string, input: Partial<CreateAssetPayload>): Promise<Asset> {
  return apiFetch<Asset>(`/assets/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
}

export type AssetTransition =
  | 'activate'
  | 'commission'
  | 'start-maintenance'
  | 'resume-service'
  | 'take-out-of-service'
  | 'return-to-service'
  | 'dispose'
  | 'retire';

export function transitionAsset(id: string, transition: AssetTransition): Promise<Asset> {
  return apiFetch<Asset>(`/assets/${id}/${transition}`, { method: 'POST' });
}

export function getAssetChildren(id: string): Promise<{ items: Asset[] }> {
  return apiFetch<{ items: Asset[] }>(`/assets/${id}/children`);
}

export interface CustodianCandidate {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

export function listCustodianCandidates(): Promise<{ items: CustodianCandidate[] }> {
  return apiFetch<{ items: CustodianCandidate[] }>('/assets/custodians');
}

// === Movement / Transfer ===

export interface AssetMovement {
  id: string;
  assetId: string;
  previousLocationId: string | null;
  newLocationId: string | null;
  previousCustodianId: string | null;
  newCustodianId: string | null;
  reason: string | null;
  notes: string | null;
  effectiveAt: string;
  performedById: string | null;
  createdAt: string;
}

export interface TransferAssetPayload {
  newLocationId?: string;
  newCustodianId?: string;
  reason?: string;
  notes?: string;
  effectiveAt?: string;
  idempotencyKey?: string;
}

export function transferAsset(id: string, input: TransferAssetPayload): Promise<Asset> {
  return apiFetch<Asset>(`/assets/${id}/transfer`, { method: 'POST', body: JSON.stringify(input) });
}

export function listAssetMovements(id: string): Promise<{ items: AssetMovement[] }> {
  return apiFetch<{ items: AssetMovement[] }>(`/assets/${id}/movements`);
}

// === Documents ===

export interface AssetDocument {
  id: string;
  assetId: string;
  documentType: AssetDocumentType;
  url: string;
  key: string;
  fileName: string | null;
  caption: string | null;
  createdAt: string;
}

export function listAssetDocuments(id: string): Promise<{ items: AssetDocument[] }> {
  return apiFetch<{ items: AssetDocument[] }>(`/assets/${id}/documents`);
}

export function addAssetDocument(
  id: string,
  file: File,
  documentType: AssetDocumentType,
  caption?: string,
): Promise<AssetDocument> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('documentType', documentType);
  if (caption) formData.append('caption', caption);
  return apiFetchFormData<AssetDocument>(`/assets/${id}/documents`, formData);
}

export function removeAssetDocument(id: string, documentId: string): Promise<{ success: boolean }> {
  return apiFetch<{ success: boolean }>(`/assets/${id}/documents/${documentId}`, {
    method: 'DELETE',
  });
}

// === Cover Photo ===

export function uploadAssetImage(id: string, file: File): Promise<Asset> {
  const formData = new FormData();
  formData.append('file', file);
  return apiFetchFormData<Asset>(`/assets/${id}/image`, formData);
}

export function removeAssetImage(id: string): Promise<Asset> {
  return apiFetch<Asset>(`/assets/${id}/image`, { method: 'DELETE' });
}

// === Meters ===

export interface AssetMeter {
  id: string;
  assetId: string;
  meterType: AssetMeterType;
  unit: string;
  currentReading: number;
  lastReadingDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AssetMeterReading {
  id: string;
  meterId: string;
  reading: number;
  readingDate: string;
  recordedById: string | null;
  notes: string | null;
  createdAt: string;
}

export function listAssetMeters(id: string): Promise<{ items: AssetMeter[] }> {
  return apiFetch<{ items: AssetMeter[] }>(`/assets/${id}/meters`);
}

export function createAssetMeter(
  id: string,
  input: { meterType: AssetMeterType; unit: string },
): Promise<AssetMeter> {
  return apiFetch<AssetMeter>(`/assets/${id}/meters`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function listAssetMeterReadings(
  id: string,
  meterId: string,
): Promise<{ items: AssetMeterReading[] }> {
  return apiFetch<{ items: AssetMeterReading[] }>(`/assets/${id}/meters/${meterId}/readings`);
}

export function recordAssetMeterReading(
  id: string,
  meterId: string,
  input: { reading: number; readingDate?: string; notes?: string; idempotencyKey?: string },
): Promise<{ reading: AssetMeterReading; meter: AssetMeter }> {
  return apiFetch<{ reading: AssetMeterReading; meter: AssetMeter }>(
    `/assets/${id}/meters/${meterId}/readings`,
    { method: 'POST', body: JSON.stringify(input) },
  );
}

// === Audit History ===

export interface AssetAuditEvent {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  actorUserId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export function getAssetAuditHistory(id: string): Promise<{ items: AssetAuditEvent[] }> {
  return apiFetch<{ items: AssetAuditEvent[] }>(`/assets/${id}/audit`);
}
