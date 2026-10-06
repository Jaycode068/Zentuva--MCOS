import { CreatePromotionInput, UpdatePromotionInput } from '@zentuva/validation';

import { apiFetch } from '@/lib/api-client';

/**
 * Sprint 40 — Configurable Promotions, Loyalty, Rewards & Consumer Incentives
 * (docs/domains/d2c.md). API client for the Promotion admin surface — business terms
 * (validity, eligibility conditions, benefit value) are DATA submitted through here,
 * never a code change.
 */

export type PromotionStatus = 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'EXPIRED';
export type PromotionConditionType =
  'FIRST_QUALIFYING_ORDER' | 'MINIMUM_ORDER_VALUE' | 'PRODUCT_QUANTITY' | 'TERRITORY';
export type PromotionBenefitType = 'BONUS_POINTS' | 'FREE_PRODUCT';

export interface PromotionCondition {
  id: string;
  type: PromotionConditionType;
  minOrderValue: number | null;
  productId: string | null;
  minQuantity: number | null;
  territoryId: string | null;
}

export interface PromotionBenefit {
  id: string;
  type: PromotionBenefitType;
  pointsValue: number | null;
  freeProductId: string | null;
  freeProductQuantity: number | null;
}

export interface Promotion {
  id: string;
  name: string;
  description: string | null;
  status: PromotionStatus;
  startsAt: string;
  endsAt: string;
  activatedAt: string | null;
  conditions: PromotionCondition[];
  benefits: PromotionBenefit[];
  createdAt: string;
  updatedAt: string;
}

export interface ListPromotionsParams {
  status?: PromotionStatus;
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface ListPromotionsResult {
  items: Promotion[];
  total: number;
  page: number;
  pageSize: number;
}

export function listPromotions(params: ListPromotionsParams = {}): Promise<ListPromotionsResult> {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== '') query.set(key, String(value));
  });
  const qs = query.toString();
  return apiFetch<ListPromotionsResult>(`/promotions${qs ? `?${qs}` : ''}`);
}

export function getPromotion(id: string): Promise<Promotion> {
  return apiFetch<Promotion>(`/promotions/${id}`);
}

export function createPromotion(input: CreatePromotionInput): Promise<Promotion> {
  return apiFetch<Promotion>('/promotions', { method: 'POST', body: JSON.stringify(input) });
}

export function updatePromotion(id: string, input: UpdatePromotionInput): Promise<Promotion> {
  return apiFetch<Promotion>(`/promotions/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function activatePromotion(id: string): Promise<Promotion> {
  return apiFetch<Promotion>(`/promotions/${id}/activate`, { method: 'POST' });
}

export function pausePromotion(id: string): Promise<Promotion> {
  return apiFetch<Promotion>(`/promotions/${id}/pause`, { method: 'POST' });
}

export function resumePromotion(id: string): Promise<Promotion> {
  return apiFetch<Promotion>(`/promotions/${id}/resume`, { method: 'POST' });
}

// ---------------------------------------------------------------------------
// Reward Grants (read-only — a grant is only ever created by a genuine
// qualifying event, never a direct admin API call)
// ---------------------------------------------------------------------------

export interface RewardGrant {
  id: string;
  consumer: { id: string; consumerCode: string; fullName: string };
  promotion: { id: string; name: string };
  qualifyingSalesOrder: { id: string; orderCode: string };
  promotionNameSnapshot: string;
  benefitTypeSnapshot: PromotionBenefitType;
  pointsAwardedSnapshot: number | null;
  freeProductIdSnapshot: string | null;
  freeProductQuantitySnapshot: number | null;
  status: 'GRANTED' | 'PENDING_FULFILLMENT';
  grantedAt: string;
}

export interface ListGrantsResult {
  items: RewardGrant[];
  total: number;
  page: number;
  pageSize: number;
}

export function listGrants(
  params: { promotionId?: string; page?: number; pageSize?: number } = {},
): Promise<ListGrantsResult> {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined) query.set(key, String(value));
  });
  const qs = query.toString();
  return apiFetch<ListGrantsResult>(`/promotions/grants${qs ? `?${qs}` : ''}`);
}

export function listGrantsForConsumer(
  consumerId: string,
  params: { page?: number; pageSize?: number } = {},
): Promise<ListGrantsResult> {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined) query.set(key, String(value));
  });
  const qs = query.toString();
  return apiFetch<ListGrantsResult>(
    `/promotions/grants/consumer/${consumerId}${qs ? `?${qs}` : ''}`,
  );
}
