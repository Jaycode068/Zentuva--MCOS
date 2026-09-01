import { z } from 'zod';

/**
 * Shared validation schemas for Sprint 19's Financial Decision & Scenario
 * Analysis (docs/domains/financial-decision-analysis.md) —
 * `DecisionAnalysis`, `DecisionScenario`. Same "one file per domain"
 * convention as `investment.ts`/`debt.ts`.
 */

// === Decision Analyses ===

export const decisionTypeSchema = z.enum([
  'NEW_INVESTMENT',
  'EXPANSION',
  'EQUIPMENT_UPGRADE',
  'COST_REDUCTION',
  'OTHER',
]);
export type DecisionTypeInput = z.infer<typeof decisionTypeSchema>;

export const createDecisionAnalysisSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).optional(),
  decisionType: decisionTypeSchema,
  analysisPeriodMonths: z.coerce.number().int().positive().max(360).default(60),
  discountRatePercent: z.coerce.number().min(0).max(100).default(15),
  maxAcceptablePaybackYears: z.coerce.number().positive().max(50).default(3),
  capitalProjectId: z.string().trim().min(1).optional(),
  debtFacilityId: z.string().trim().min(1).optional(),
  currency: z.string().trim().min(3).max(3).default('NGN'),
  notes: z.string().trim().max(1000).optional(),
  idempotencyKey: z.string().trim().min(1).optional(),
});
export type CreateDecisionAnalysisInput = z.infer<typeof createDecisionAnalysisSchema>;

export const updateDecisionAnalysisSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  decisionType: decisionTypeSchema.optional(),
  analysisPeriodMonths: z.coerce.number().int().positive().max(360).optional(),
  discountRatePercent: z.coerce.number().min(0).max(100).optional(),
  maxAcceptablePaybackYears: z.coerce.number().positive().max(50).optional(),
  capitalProjectId: z.string().trim().min(1).nullable().optional(),
  debtFacilityId: z.string().trim().min(1).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
});
export type UpdateDecisionAnalysisInput = z.infer<typeof updateDecisionAnalysisSchema>;

export const rejectDecisionAnalysisSchema = z.object({
  rejectionReason: z.string().trim().max(1000).optional(),
});
export type RejectDecisionAnalysisInput = z.infer<typeof rejectDecisionAnalysisSchema>;

// === Decision Scenarios ===

export const decisionScenarioTypeSchema = z.enum(['BASE', 'OPTIMISTIC', 'PESSIMISTIC', 'CUSTOM']);
export type DecisionScenarioTypeInput = z.infer<typeof decisionScenarioTypeSchema>;

export const scenarioRepaymentMethodSchema = z.enum(['AMORTISING', 'INTEREST_ONLY', 'BULLET']);

export const createDecisionScenarioSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    scenarioType: decisionScenarioTypeSchema.default('CUSTOM'),
    initialInvestment: z.coerce.number().positive().optional(),
    additionalCapex: z.coerce.number().min(0).default(0),
    additionalMonthlyRevenue: z.coerce.number().min(0).default(0),
    annualRevenueGrowthPercent: z.coerce.number().default(0),
    rampUpMonths: z.coerce.number().int().min(0).default(0),
    additionalMonthlyOperatingCost: z.coerce.number().min(0).default(0),
    additionalMonthlyMaintenanceCost: z.coerce.number().min(0).default(0),
    additionalMonthlyLabourCost: z.coerce.number().min(0).default(0),
    additionalMonthlyUtilitiesCost: z.coerce.number().min(0).default(0),
    additionalMonthlyLogisticsCost: z.coerce.number().min(0).default(0),
    cashFundingAmount: z.coerce.number().min(0).default(0),
    debtFundingAmount: z.coerce.number().min(0).default(0),
    debtInterestRatePercent: z.coerce.number().min(0).max(100).optional(),
    debtTermMonths: z.coerce.number().int().positive().optional(),
    debtRepaymentMethod: scenarioRepaymentMethodSchema.default('AMORTISING'),
    workingCapitalImpact: z.coerce.number().default(0),
    notes: z.string().trim().max(1000).optional(),
    idempotencyKey: z.string().trim().min(1).optional(),
  })
  .refine(
    (data) =>
      data.cashFundingAmount > 0 ||
      data.debtFundingAmount > 0 ||
      data.initialInvestment === undefined,
    {
      message:
        'At least one of cashFundingAmount/debtFundingAmount should be set when initialInvestment is provided',
      path: ['cashFundingAmount'],
    },
  );
export type CreateDecisionScenarioInput = z.infer<typeof createDecisionScenarioSchema>;

export const updateDecisionScenarioSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  scenarioType: decisionScenarioTypeSchema.optional(),
  initialInvestment: z.coerce.number().positive().nullable().optional(),
  additionalCapex: z.coerce.number().min(0).optional(),
  additionalMonthlyRevenue: z.coerce.number().min(0).optional(),
  annualRevenueGrowthPercent: z.coerce.number().optional(),
  rampUpMonths: z.coerce.number().int().min(0).optional(),
  additionalMonthlyOperatingCost: z.coerce.number().min(0).optional(),
  additionalMonthlyMaintenanceCost: z.coerce.number().min(0).optional(),
  additionalMonthlyLabourCost: z.coerce.number().min(0).optional(),
  additionalMonthlyUtilitiesCost: z.coerce.number().min(0).optional(),
  additionalMonthlyLogisticsCost: z.coerce.number().min(0).optional(),
  cashFundingAmount: z.coerce.number().min(0).optional(),
  debtFundingAmount: z.coerce.number().min(0).optional(),
  debtInterestRatePercent: z.coerce.number().min(0).max(100).nullable().optional(),
  debtTermMonths: z.coerce.number().int().positive().nullable().optional(),
  debtRepaymentMethod: scenarioRepaymentMethodSchema.optional(),
  workingCapitalImpact: z.coerce.number().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
});
export type UpdateDecisionScenarioInput = z.infer<typeof updateDecisionScenarioSchema>;
