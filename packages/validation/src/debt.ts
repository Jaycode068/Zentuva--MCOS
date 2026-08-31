import { z } from 'zod';

/**
 * Shared validation schemas for Sprint 17's Capital & Debt Management
 * Foundation (docs/domains/debt-management.md) — `Lender`,
 * `CapitalRequirement`, `DebtFacility`, `DebtDrawdown`, `DebtRepayment`. Same
 * "one file per domain" convention as `budgeting.ts`/`cashflow.ts`.
 */

// === Lenders ===

export const lenderTypeSchema = z.enum([
  'BANK',
  'FINANCIAL_INSTITUTION',
  'INVESTOR',
  'DIRECTOR',
  'SHAREHOLDER',
  'OTHER',
]);
export type LenderTypeInput = z.infer<typeof lenderTypeSchema>;

export const createLenderSchema = z.object({
  name: z.string().trim().min(1).max(120),
  type: lenderTypeSchema,
  contactName: z.string().trim().max(120).optional(),
  email: z.string().trim().email().optional(),
  phone: z.string().trim().max(40).optional(),
  notes: z.string().trim().max(1000).optional(),
});
export type CreateLenderInput = z.infer<typeof createLenderSchema>;

export const updateLenderSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  contactName: z.string().trim().max(120).nullable().optional(),
  email: z.string().trim().email().nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
});
export type UpdateLenderInput = z.infer<typeof updateLenderSchema>;

// === Capital Requirements ===

export const capitalRequirementTypeSchema = z.enum([
  'CAPEX',
  'WORKING_CAPITAL',
  'EXPANSION',
  'EQUIPMENT',
  'OTHER',
]);
export type CapitalRequirementTypeInput = z.infer<typeof capitalRequirementTypeSchema>;

export const capitalRequirementPrioritySchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
export type CapitalRequirementPriorityInput = z.infer<typeof capitalRequirementPrioritySchema>;

export const createCapitalRequirementSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).optional(),
  requiredAmount: z.coerce.number().positive(),
  requiredDate: z.coerce.date(),
  type: capitalRequirementTypeSchema,
  priority: capitalRequirementPrioritySchema.default('MEDIUM'),
  budgetId: z.string().trim().min(1).optional(),
  budgetLineId: z.string().trim().min(1).optional(),
  costCentreId: z.string().trim().min(1).optional(),
  notes: z.string().trim().max(1000).optional(),
  idempotencyKey: z.string().trim().min(1).optional(),
});
export type CreateCapitalRequirementInput = z.infer<typeof createCapitalRequirementSchema>;

export const updateCapitalRequirementSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  requiredAmount: z.coerce.number().positive().optional(),
  requiredDate: z.coerce.date().optional(),
  priority: capitalRequirementPrioritySchema.optional(),
  budgetId: z.string().trim().min(1).nullable().optional(),
  budgetLineId: z.string().trim().min(1).nullable().optional(),
  costCentreId: z.string().trim().min(1).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
});
export type UpdateCapitalRequirementInput = z.infer<typeof updateCapitalRequirementSchema>;

// === Debt Facilities ===

export const debtTypeSchema = z.enum([
  'TERM_LOAN',
  'WORKING_CAPITAL',
  'ASSET_FINANCE',
  'OVERDRAFT',
  'OTHER',
]);
export type DebtTypeInput = z.infer<typeof debtTypeSchema>;

export const repaymentMethodSchema = z.enum(['AMORTISING', 'INTEREST_ONLY', 'BULLET']);
export type RepaymentMethodInput = z.infer<typeof repaymentMethodSchema>;

export const repaymentFrequencySchema = z.enum(['MONTHLY', 'QUARTERLY', 'YEARLY']);
export type RepaymentFrequencyInput = z.infer<typeof repaymentFrequencySchema>;

export const createDebtFacilitySchema = z
  .object({
    lenderId: z.string().trim().min(1),
    name: z.string().trim().min(1).max(200),
    debtType: debtTypeSchema,
    principalAmount: z.coerce.number().positive(),
    currency: z.string().trim().min(3).max(3),
    interestRatePercent: z.coerce.number().min(0).max(100),
    repaymentMethod: repaymentMethodSchema,
    repaymentFrequency: repaymentFrequencySchema.default('MONTHLY'),
    startDate: z.coerce.date(),
    tenorMonths: z.coerce.number().int().positive(),
    graceMonths: z.coerce.number().int().min(0).default(0),
    liabilityAccountId: z.string().trim().min(1),
    interestExpenseAccountId: z.string().trim().min(1),
    capitalRequirementId: z.string().trim().min(1).optional(),
    notes: z.string().trim().max(1000).optional(),
    idempotencyKey: z.string().trim().min(1).optional(),
  })
  .refine((data) => data.graceMonths < data.tenorMonths, {
    message: 'graceMonths must be less than tenorMonths',
    path: ['graceMonths'],
  });
export type CreateDebtFacilityInput = z.infer<typeof createDebtFacilitySchema>;

export const updateDebtFacilitySchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  capitalRequirementId: z.string().trim().min(1).nullable().optional(),
});
export type UpdateDebtFacilityInput = z.infer<typeof updateDebtFacilitySchema>;

export const createDebtDrawdownSchema = z.object({
  cashAccountId: z.string().trim().min(1),
  amount: z.coerce.number().positive(),
  drawdownDate: z.coerce.date(),
  reference: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(1000).optional(),
  idempotencyKey: z.string().trim().min(1).optional(),
});
export type CreateDebtDrawdownInput = z.infer<typeof createDebtDrawdownSchema>;

export const createDebtRepaymentSchema = z
  .object({
    cashAccountId: z.string().trim().min(1),
    paymentDate: z.coerce.date(),
    principalAmount: z.coerce.number().min(0).default(0),
    interestAmount: z.coerce.number().min(0).default(0),
    feeAmount: z.coerce.number().min(0).default(0),
    feeExpenseAccountId: z.string().trim().min(1).optional(),
    reference: z.string().trim().max(120).optional(),
    notes: z.string().trim().max(1000).optional(),
    idempotencyKey: z.string().trim().min(1).optional(),
  })
  .refine((data) => data.principalAmount + data.interestAmount + data.feeAmount > 0, {
    message: 'At least one of principalAmount/interestAmount/feeAmount must be greater than zero',
  })
  .refine((data) => data.feeAmount === 0 || !!data.feeExpenseAccountId, {
    message: 'feeExpenseAccountId is required when feeAmount is greater than zero',
    path: ['feeExpenseAccountId'],
  });
export type CreateDebtRepaymentInput = z.infer<typeof createDebtRepaymentSchema>;
