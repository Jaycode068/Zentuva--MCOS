import { z } from 'zod';

/**
 * Shared validation schemas for Sprint 18's Investment / Capital Project
 * Management Foundation (docs/domains/investment-projects.md) —
 * `CapitalProject`, `CapitalProjectCostLine`, `CapitalProjectFunding`. Same
 * "one file per domain" convention as `debt.ts`/`budgeting.ts`.
 */

export const capitalProjectCategorySchema = z.enum([
  'PRODUCTION_EQUIPMENT',
  'FACTORY_EXPANSION',
  'WAREHOUSE',
  'VEHICLE',
  'POWER_ENERGY',
  'TECHNOLOGY',
  'INFRASTRUCTURE',
  'OTHER',
]);
export type CapitalProjectCategoryInput = z.infer<typeof capitalProjectCategorySchema>;

export const createCapitalProjectSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).optional(),
  businessPurpose: z.string().trim().max(1000).optional(),
  category: capitalProjectCategorySchema,
  ownerId: z.string().trim().min(1).optional(),
  costCentreId: z.string().trim().min(1).optional(),
  capitalRequirementId: z.string().trim().min(1).optional(),
  budgetId: z.string().trim().min(1).optional(),
  budgetLineId: z.string().trim().min(1).optional(),
  plannedStartDate: z.coerce.date(),
  plannedCompletionDate: z.coerce.date(),
  expectedAnnualRevenueImpact: z.coerce.number().optional(),
  expectedAnnualOperatingCostImpact: z.coerce.number().optional(),
  expectedAnnualSavings: z.coerce.number().optional(),
  usefulLifeYears: z.coerce.number().int().positive().optional(),
  currentCapacityUnitsPerDay: z.coerce.number().nonnegative().optional(),
  expectedCapacityUnitsPerDay: z.coerce.number().nonnegative().optional(),
  expectedCommissioningDate: z.coerce.date().optional(),
  currency: z.string().trim().min(3).max(3).default('NGN'),
  notes: z.string().trim().max(1000).optional(),
  idempotencyKey: z.string().trim().min(1).optional(),
});
export type CreateCapitalProjectInput = z.infer<typeof createCapitalProjectSchema>;

export const updateCapitalProjectSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  businessPurpose: z.string().trim().max(1000).nullable().optional(),
  category: capitalProjectCategorySchema.optional(),
  ownerId: z.string().trim().min(1).nullable().optional(),
  costCentreId: z.string().trim().min(1).nullable().optional(),
  capitalRequirementId: z.string().trim().min(1).nullable().optional(),
  budgetId: z.string().trim().min(1).nullable().optional(),
  budgetLineId: z.string().trim().min(1).nullable().optional(),
  plannedStartDate: z.coerce.date().optional(),
  plannedCompletionDate: z.coerce.date().optional(),
  expectedAnnualRevenueImpact: z.coerce.number().nullable().optional(),
  expectedAnnualOperatingCostImpact: z.coerce.number().nullable().optional(),
  expectedAnnualSavings: z.coerce.number().nullable().optional(),
  usefulLifeYears: z.coerce.number().int().positive().nullable().optional(),
  currentCapacityUnitsPerDay: z.coerce.number().nonnegative().nullable().optional(),
  expectedCapacityUnitsPerDay: z.coerce.number().nonnegative().nullable().optional(),
  expectedCommissioningDate: z.coerce.date().nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
});
export type UpdateCapitalProjectInput = z.infer<typeof updateCapitalProjectSchema>;

export const createCapitalProjectCostLineSchema = z.object({
  description: z.string().trim().min(1).max(200),
  category: z.string().trim().max(60).optional(),
  plannedAmount: z.coerce.number().positive(),
  chartOfAccountId: z.string().trim().min(1).optional(),
  costCentreId: z.string().trim().min(1).optional(),
  plannedMonth: z.coerce.date(),
  purchaseOrderId: z.string().trim().min(1).optional(),
  notes: z.string().trim().max(1000).optional(),
});
export type CreateCapitalProjectCostLineInput = z.infer<typeof createCapitalProjectCostLineSchema>;

export const capitalProjectFundingTypeSchema = z.enum(['CASH', 'DEBT', 'OTHER']);
export type CapitalProjectFundingTypeInput = z.infer<typeof capitalProjectFundingTypeSchema>;

export const createCapitalProjectFundingSchema = z
  .object({
    fundingType: capitalProjectFundingTypeSchema,
    amount: z.coerce.number().positive(),
    debtFacilityId: z.string().trim().min(1).optional(),
    cashAccountId: z.string().trim().min(1).optional(),
    description: z.string().trim().max(1000).optional(),
    idempotencyKey: z.string().trim().min(1).optional(),
  })
  .refine((data) => data.fundingType !== 'DEBT' || !!data.debtFacilityId, {
    message: 'debtFacilityId is required when fundingType is DEBT',
    path: ['debtFacilityId'],
  });
export type CreateCapitalProjectFundingInput = z.infer<typeof createCapitalProjectFundingSchema>;
