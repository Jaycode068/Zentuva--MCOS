import { apiFetch, apiFetchFormData } from '@/lib/api-client';

export type CustomerType =
  | 'DISTRIBUTOR'
  | 'WHOLESALER'
  | 'RETAILER'
  | 'SUPERMARKET'
  | 'CORPORATE'
  | 'INSTITUTION'
  | 'RESTAURANT'
  | 'HOTEL'
  | 'OTHER';
export type CustomerStatus = 'ACTIVE' | 'INACTIVE';

export type OutletType =
  | 'SUPERMARKET'
  | 'HYPERMARKET'
  | 'WHOLESALE_STORE'
  | 'RETAIL_SHOP'
  | 'KIOSK'
  | 'MARKET_STALL'
  | 'DISTRIBUTOR_WAREHOUSE'
  | 'WHOLESALER_WAREHOUSE'
  | 'CONVENIENCE_STORE'
  | 'RESTAURANT'
  | 'HOTEL'
  | 'CORPORATE'
  | 'INSTITUTION'
  | 'OTHER';
export type OutletStatus = 'ACTIVE' | 'INACTIVE';
export type OutletPhotoType = 'FRONT' | 'SIGNAGE' | 'INTERIOR' | 'SHELF_DISPLAY' | 'OTHER';

export type TerritoryStatus = 'ACTIVE' | 'INACTIVE';

export type DistributionRelationshipType =
  'DISTRIBUTES_TO' | 'WHOLESALES_TO' | 'SUPPLIES' | 'OTHER';
export type NetworkRelationshipStatus = 'ACTIVE' | 'INACTIVE';

/** `GET/POST /api/retail/territories`, `GET/PATCH .../:id` response shape — see
 *  `apps/api/src/retail/territory/territory.controller.ts`'s `toTerritoryResponse`. */
export interface Territory {
  id: string;
  territoryCode: string;
  name: string;
  type: string;
  parentTerritoryId: string | null;
  status: TerritoryStatus;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTerritoryPayload {
  name: string;
  type: string;
  parentTerritoryId?: string;
  description?: string;
}

export interface UpdateTerritoryPayload {
  name?: string;
  type?: string;
  parentTerritoryId?: string | null;
  description?: string;
  status?: TerritoryStatus;
}

export interface ListTerritoriesParams {
  status?: TerritoryStatus;
  parentTerritoryId?: string;
  search?: string;
}

/** `GET/POST /api/retail/customers`, `GET/PATCH .../:id` response shape — see
 *  `apps/api/src/retail/customer/customer.controller.ts`'s `toCustomerResponse`. */
export interface Customer {
  id: string;
  customerCode: string;
  customerType: CustomerType;
  customerName: string;
  contactPersonName: string | null;
  phoneNumber: string;
  alternatePhoneNumber: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  territoryId: string | null;
  status: CustomerStatus;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Only `customerType`/`customerName`/`phoneNumber` are required — see
 *  `createCustomerSchema`'s docblock in `@zentuva/validation`. */
export interface CreateCustomerPayload {
  customerType: CustomerType;
  customerName: string;
  phoneNumber: string;
  contactPersonName?: string;
  alternatePhoneNumber?: string;
  email?: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  territoryId?: string;
  notes?: string;
}

export type UpdateCustomerPayload = Partial<CreateCustomerPayload>;

export interface ListCustomersParams {
  status?: CustomerStatus;
  customerType?: CustomerType;
  territoryId?: string;
  search?: string;
}

export interface OutletPhoto {
  id: string;
  url: string;
  photoType: OutletPhotoType | null;
  caption: string | null;
  createdAt: string;
}

/** `GET/POST /api/retail/outlets`, `GET/PATCH .../:id` response shape — see
 *  `apps/api/src/retail/outlet/outlet.controller.ts`'s `toOutletResponse`. */
export interface Outlet {
  id: string;
  outletCode: string;
  outletType: OutletType;
  name: string;
  contactPersonName: string | null;
  phoneNumber: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  territoryId: string | null;
  latitude: number | null;
  longitude: number | null;
  status: OutletStatus;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  customer: { id: string; customerCode: string; customerName: string };
  territory: { id: string; name: string } | null;
  photos: OutletPhoto[];
}

export interface CreateOutletPayload {
  customerId: string;
  outletType: OutletType;
  name: string;
  contactPersonName?: string;
  phoneNumber?: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  territoryId?: string;
  latitude?: number;
  longitude?: number;
  notes?: string;
}

export type UpdateOutletPayload = Partial<Omit<CreateOutletPayload, 'customerId'>>;

export interface ListOutletsParams {
  status?: OutletStatus;
  outletType?: OutletType;
  customerId?: string;
  territoryId?: string;
  search?: string;
}

/** `GET/POST /api/retail/network-relationships`, `GET/PATCH .../:id` response shape. */
export interface NetworkRelationship {
  id: string;
  sourceCustomer: {
    id: string;
    customerCode: string;
    customerName: string;
    customerType: CustomerType;
  };
  targetCustomer: {
    id: string;
    customerCode: string;
    customerName: string;
    customerType: CustomerType;
  };
  relationshipType: DistributionRelationshipType;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: NetworkRelationshipStatus;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateNetworkRelationshipPayload {
  sourceCustomerId: string;
  targetCustomerId: string;
  relationshipType: DistributionRelationshipType;
  effectiveFrom?: string;
  effectiveTo?: string;
  notes?: string;
}

export interface ListNetworkRelationshipsParams {
  status?: NetworkRelationshipStatus;
  customerId?: string;
  relationshipType?: DistributionRelationshipType;
}

// ---------------------------------------------------------------------------
// Territories
// ---------------------------------------------------------------------------

export function listTerritories(
  params: ListTerritoriesParams = {},
): Promise<{ items: Territory[] }> {
  const query = new URLSearchParams();
  if (params.status) query.set('status', params.status);
  if (params.parentTerritoryId) query.set('parentTerritoryId', params.parentTerritoryId);
  if (params.search) query.set('search', params.search);
  const queryString = query.toString();
  return apiFetch<{ items: Territory[] }>(
    `/retail/territories${queryString ? `?${queryString}` : ''}`,
  );
}

export function createTerritory(input: CreateTerritoryPayload): Promise<Territory> {
  return apiFetch<Territory>('/retail/territories', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateTerritory(id: string, input: UpdateTerritoryPayload): Promise<Territory> {
  return apiFetch<Territory>(`/retail/territories/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function activateTerritory(id: string): Promise<Territory> {
  return apiFetch<Territory>(`/retail/territories/${id}/activate`, { method: 'POST' });
}

export function deactivateTerritory(id: string): Promise<Territory> {
  return apiFetch<Territory>(`/retail/territories/${id}/deactivate`, { method: 'POST' });
}

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

export function listCustomers(params: ListCustomersParams = {}): Promise<{ items: Customer[] }> {
  const query = new URLSearchParams();
  if (params.status) query.set('status', params.status);
  if (params.customerType) query.set('customerType', params.customerType);
  if (params.territoryId) query.set('territoryId', params.territoryId);
  if (params.search) query.set('search', params.search);
  const queryString = query.toString();
  return apiFetch<{ items: Customer[] }>(
    `/retail/customers${queryString ? `?${queryString}` : ''}`,
  );
}

export function getCustomer(id: string): Promise<Customer> {
  return apiFetch<Customer>(`/retail/customers/${id}`);
}

export function createCustomer(input: CreateCustomerPayload): Promise<Customer> {
  return apiFetch<Customer>('/retail/customers', { method: 'POST', body: JSON.stringify(input) });
}

export function updateCustomer(id: string, input: UpdateCustomerPayload): Promise<Customer> {
  return apiFetch<Customer>(`/retail/customers/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function activateCustomer(id: string): Promise<Customer> {
  return apiFetch<Customer>(`/retail/customers/${id}/activate`, { method: 'POST' });
}

export function deactivateCustomer(id: string): Promise<Customer> {
  return apiFetch<Customer>(`/retail/customers/${id}/deactivate`, { method: 'POST' });
}

// ---------------------------------------------------------------------------
// Outlets
// ---------------------------------------------------------------------------

export function listOutlets(params: ListOutletsParams = {}): Promise<{ items: Outlet[] }> {
  const query = new URLSearchParams();
  if (params.status) query.set('status', params.status);
  if (params.outletType) query.set('outletType', params.outletType);
  if (params.customerId) query.set('customerId', params.customerId);
  if (params.territoryId) query.set('territoryId', params.territoryId);
  if (params.search) query.set('search', params.search);
  const queryString = query.toString();
  return apiFetch<{ items: Outlet[] }>(`/retail/outlets${queryString ? `?${queryString}` : ''}`);
}

export function getOutlet(id: string): Promise<Outlet> {
  return apiFetch<Outlet>(`/retail/outlets/${id}`);
}

export function createOutlet(input: CreateOutletPayload): Promise<Outlet> {
  return apiFetch<Outlet>('/retail/outlets', { method: 'POST', body: JSON.stringify(input) });
}

export function updateOutlet(id: string, input: UpdateOutletPayload): Promise<Outlet> {
  return apiFetch<Outlet>(`/retail/outlets/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function activateOutlet(id: string): Promise<Outlet> {
  return apiFetch<Outlet>(`/retail/outlets/${id}/activate`, { method: 'POST' });
}

export function deactivateOutlet(id: string): Promise<Outlet> {
  return apiFetch<Outlet>(`/retail/outlets/${id}/deactivate`, { method: 'POST' });
}

export function addOutletPhotos(
  id: string,
  files: File[],
  input: { photoType?: OutletPhotoType; caption?: string } = {},
): Promise<{ items: OutletPhoto[] }> {
  const formData = new FormData();
  for (const file of files) {
    formData.append('files', file);
  }
  if (input.photoType) formData.append('photoType', input.photoType);
  if (input.caption) formData.append('caption', input.caption);
  return apiFetchFormData<{ items: OutletPhoto[] }>(`/retail/outlets/${id}/photos`, formData);
}

export function removeOutletPhoto(id: string, photoId: string): Promise<{ success: boolean }> {
  return apiFetch<{ success: boolean }>(`/retail/outlets/${id}/photos/${photoId}`, {
    method: 'DELETE',
  });
}

// ---------------------------------------------------------------------------
// Network relationships
// ---------------------------------------------------------------------------

export function listNetworkRelationships(
  params: ListNetworkRelationshipsParams = {},
): Promise<{ items: NetworkRelationship[] }> {
  const query = new URLSearchParams();
  if (params.status) query.set('status', params.status);
  if (params.customerId) query.set('customerId', params.customerId);
  if (params.relationshipType) query.set('relationshipType', params.relationshipType);
  const queryString = query.toString();
  return apiFetch<{ items: NetworkRelationship[] }>(
    `/retail/network-relationships${queryString ? `?${queryString}` : ''}`,
  );
}

export function createNetworkRelationship(
  input: CreateNetworkRelationshipPayload,
): Promise<NetworkRelationship> {
  return apiFetch<NetworkRelationship>('/retail/network-relationships', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function deactivateNetworkRelationship(id: string): Promise<NetworkRelationship> {
  return apiFetch<NetworkRelationship>(`/retail/network-relationships/${id}/deactivate`, {
    method: 'POST',
  });
}
