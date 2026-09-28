import { apiFetch } from '@/lib/api-client';

/**
 * Sprint 32 — Consumer Identity, Territory & Location Foundation
 * (docs/domains/d2c.md). Internal/admin API client only — see
 * `apps/api/src/d2c/consumer/consumer.controller.ts`'s own doc comment for
 * why there is no public/consumer-facing route yet.
 */

export type ConsumerStatus = 'ACTIVE' | 'SUSPENDED' | 'INACTIVE';

/** `GET/POST /api/d2c/consumers`, `GET/PATCH .../:id` response shape — see
 *  `ConsumerController`'s `toConsumerResponse`. */
export interface Consumer {
  id: string;
  consumerCode: string;
  fullName: string;
  phoneNumber: string;
  normalizedPhone: string;
  email: string | null;
  status: ConsumerStatus;
  territoryId: string | null;
  address: string | null;
  marketingOptIn: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RegisterConsumerPayload {
  fullName: string;
  phoneNumber: string;
  email?: string;
  territoryId?: string;
  address?: string;
  marketingOptIn?: boolean;
}

export interface UpdateConsumerProfilePayload {
  fullName?: string;
  email?: string;
  address?: string;
  marketingOptIn?: boolean;
}

export interface ListConsumersParams {
  status?: ConsumerStatus;
  territoryId?: string;
  search?: string;
}

export interface ConsumerLocationRequest {
  id: string;
  consumerId: string;
  rawLocationText: string;
  resolvedAt: string | null;
  resolvedByUserId: string | null;
  resolutionNotes: string | null;
  createdAt: string;
}

export function listConsumers(params: ListConsumersParams = {}): Promise<{ items: Consumer[] }> {
  const query = new URLSearchParams();
  if (params.status) query.set('status', params.status);
  if (params.territoryId) query.set('territoryId', params.territoryId);
  if (params.search) query.set('search', params.search);
  const queryString = query.toString();
  return apiFetch<{ items: Consumer[] }>(`/d2c/consumers${queryString ? `?${queryString}` : ''}`);
}

export function getConsumer(id: string): Promise<Consumer> {
  return apiFetch<Consumer>(`/d2c/consumers/${id}`);
}

export function registerConsumer(
  input: RegisterConsumerPayload,
): Promise<Consumer & { alreadyRegistered: boolean }> {
  return apiFetch<Consumer & { alreadyRegistered: boolean }>('/d2c/consumers', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateConsumerProfile(
  id: string,
  input: UpdateConsumerProfilePayload,
): Promise<Consumer> {
  return apiFetch<Consumer>(`/d2c/consumers/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function updateConsumerLocation(id: string, territoryId: string | null): Promise<Consumer> {
  return apiFetch<Consumer>(`/d2c/consumers/${id}/location`, {
    method: 'PATCH',
    body: JSON.stringify({ territoryId }),
  });
}

export function activateConsumer(id: string): Promise<Consumer> {
  return apiFetch<Consumer>(`/d2c/consumers/${id}/activate`, { method: 'POST' });
}

export function suspendConsumer(id: string): Promise<Consumer> {
  return apiFetch<Consumer>(`/d2c/consumers/${id}/suspend`, { method: 'POST' });
}

export function deactivateConsumer(id: string): Promise<Consumer> {
  return apiFetch<Consumer>(`/d2c/consumers/${id}/deactivate`, { method: 'POST' });
}

export function reportConsumerLocationNotFound(
  id: string,
  rawLocationText: string,
): Promise<ConsumerLocationRequest> {
  return apiFetch<ConsumerLocationRequest>(`/d2c/consumers/${id}/location-requests`, {
    method: 'POST',
    body: JSON.stringify({ rawLocationText }),
  });
}

export function listConsumerLocationRequests(
  openOnly?: boolean,
): Promise<{ items: ConsumerLocationRequest[] }> {
  const query = openOnly === undefined ? '' : `?openOnly=${openOnly}`;
  return apiFetch<{ items: ConsumerLocationRequest[] }>(`/d2c/consumers/location-requests${query}`);
}

export function resolveConsumerLocationRequest(
  id: string,
  resolutionNotes?: string,
): Promise<{ resolved: boolean }> {
  return apiFetch<{ resolved: boolean }>(`/d2c/consumers/location-requests/${id}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ resolutionNotes }),
  });
}
