import { PromotionBenefitType, PromotionConditionType, PromotionStatus } from '@prisma/client';

/**
 * Sprint 40 — Configurable Promotions, Loyalty, Rewards & Consumer Incentives
 * (docs/domains/d2c.md). Result/error shapes only; the Prisma models themselves live in
 * `apps/api/prisma/schema.prisma`.
 */

export interface PromotionConditionResult {
  id: string;
  type: PromotionConditionType;
  minOrderValue: number | null;
  productId: string | null;
  minQuantity: number | null;
  territoryId: string | null;
}

export interface PromotionBenefitResult {
  id: string;
  type: PromotionBenefitType;
  pointsValue: number | null;
  freeProductId: string | null;
  freeProductQuantity: number | null;
}

export interface PromotionResult {
  id: string;
  name: string;
  description: string | null;
  status: PromotionStatus;
  startsAt: Date;
  endsAt: Date;
  activatedAt: Date | null;
  conditions: PromotionConditionResult[];
  benefits: PromotionBenefitResult[];
  createdAt: Date;
  updatedAt: Date;
}

/** `PATCH` attempted on a promotion that has already left `DRAFT` — docs/domains/d2c.md
 *  "Promotion History and Version Preservation": once published, a promotion's terms are
 *  immutable; a new commercial term is always a NEW promotion. */
export class PromotionNotEditableError extends Error {}

/** `activate()`/`pause()`/`resume()` attempted from a status that doesn't allow it. */
export class InvalidPromotionTransitionError extends Error {}

/** `activate()` attempted on a promotion with no conditions, or with zero/more-than-one
 *  benefit — a promotion must be a complete, evaluable configuration before it can ever
 *  be matched against a real consumer. */
export class PromotionNotActivatableError extends Error {}

/** A condition referencing a `productId`/`territoryId` that doesn't belong to this
 *  organisation. */
export class InvalidPromotionConditionError extends Error {}
