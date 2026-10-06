import { z } from 'zod';

/**
 * Sprint 40 — Configurable Promotions, Loyalty, Rewards & Consumer Incentives
 * (docs/domains/d2c.md). The admin-authoring surface for the Promotion/Benefit/
 * Condition configuration model — business terms are DATA submitted through these
 * schemas, never a code change. One shared-file-per-domain, matching every other
 * domain schema file's own convention.
 */

export const promotionConditionTypeSchema = z.enum([
  'FIRST_QUALIFYING_ORDER',
  'MINIMUM_ORDER_VALUE',
  'PRODUCT_QUANTITY',
  'TERRITORY',
]);
export type PromotionConditionTypeInput = z.infer<typeof promotionConditionTypeSchema>;

export const promotionBenefitTypeSchema = z.enum(['BONUS_POINTS', 'FREE_PRODUCT']);
export type PromotionBenefitTypeInput = z.infer<typeof promotionBenefitTypeSchema>;

/** A controlled, discriminated set — mirrors `PromotionConditionType` exactly, never a
 *  generic `{type: string, value: unknown}` shape. Each variant only accepts the field(s)
 *  that condition type actually uses. */
export const promotionConditionInputSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('FIRST_QUALIFYING_ORDER') }),
  z.object({
    type: z.literal('MINIMUM_ORDER_VALUE'),
    minOrderValue: z.number().positive('Minimum order value must be greater than 0'),
  }),
  z.object({
    type: z.literal('PRODUCT_QUANTITY'),
    productId: z.string().trim().min(1, 'productId is required'),
    minQuantity: z.number().int().positive('Minimum quantity must be at least 1'),
  }),
  z.object({
    type: z.literal('TERRITORY'),
    territoryId: z.string().trim().min(1, 'territoryId is required'),
  }),
]);
export type PromotionConditionInput = z.infer<typeof promotionConditionInputSchema>;

/** Exactly one benefit per promotion this sprint (the service enforces the count — the
 *  schema itself stays open to a future array, matching `PromotionBenefit` being a 1:many
 *  table at the data layer even though only one row is ever created today). */
export const promotionBenefitInputSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('BONUS_POINTS'),
    pointsValue: z.number().int().positive('Points value must be at least 1'),
  }),
  z.object({
    type: z.literal('FREE_PRODUCT'),
    freeProductId: z.string().trim().min(1, 'freeProductId is required'),
    freeProductQuantity: z.number().int().positive('Quantity must be at least 1'),
  }),
]);
export type PromotionBenefitInput = z.infer<typeof promotionBenefitInputSchema>;

/** `POST /promotions` — created as `DRAFT`, fully editable until `activate()`. At least
 *  one condition and exactly one benefit are required to ACTIVATE (not to create) — a
 *  promotion can be drafted incrementally. */
export const createPromotionSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(200),
    description: z.string().trim().max(1000).optional(),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
    conditions: z.array(promotionConditionInputSchema).max(10).default([]),
    benefit: promotionBenefitInputSchema.optional(),
  })
  .refine((data) => data.endsAt > data.startsAt, {
    message: 'endsAt must be after startsAt',
    path: ['endsAt'],
  });
export type CreatePromotionInput = z.infer<typeof createPromotionSchema>;

/** `PATCH /promotions/:id` — only reachable while `status === DRAFT` (service-enforced,
 *  docs/domains/d2c.md "Promotion History and Version Preservation"); a promotion past
 *  DRAFT is immutable, a new commercial term is always a NEW promotion. */
export const updatePromotionSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(200).optional(),
    description: z.string().trim().max(1000).optional(),
    startsAt: z.coerce.date().optional(),
    endsAt: z.coerce.date().optional(),
    conditions: z.array(promotionConditionInputSchema).max(10).optional(),
    benefit: promotionBenefitInputSchema.optional(),
  })
  .refine((data) => !data.startsAt || !data.endsAt || data.endsAt > data.startsAt, {
    message: 'endsAt must be after startsAt',
    path: ['endsAt'],
  });
export type UpdatePromotionInput = z.infer<typeof updatePromotionSchema>;

/** `POST /promotions/admin/loyalty/:consumerId/adjustments` — the one administrative
 *  mutation on the loyalty ledger (brief §20): a reason is mandatory, never a silent
 *  balance overwrite. `amount` is signed — positive credits, negative debits (guarded
 *  server-side against taking the balance below zero). */
export const loyaltyAdjustmentSchema = z.object({
  amount: z
    .number()
    .int()
    .refine((value) => value !== 0, 'Amount must not be zero'),
  reason: z.string().trim().min(1, 'A reason is required for every adjustment').max(500),
});
export type LoyaltyAdjustmentInput = z.infer<typeof loyaltyAdjustmentSchema>;
