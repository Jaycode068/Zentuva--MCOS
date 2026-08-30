import { z } from 'zod';

/**
 * Shared validation schemas for Sprint 16's Budgeting & Financial Planning
 * Foundation (docs/domains/budgeting.md) — `Budget`, `BudgetLine`,
 * `CostCentre`. Split into its own file, same "one file per domain"
 * convention as `cashflow.ts`/`cash.ts`.
 */

export const budgetLineTypeSchema = z.enum(['REVENUE', 'OPERATING_EXPENSE', 'CAPEX']);
export type BudgetLineTypeInput = z.infer<typeof budgetLineTypeSchema>;

// === Cost Centres ===

export const createCostCentreSchema = z.object({
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
});
export type CreateCostCentreInput = z.infer<typeof createCostCentreSchema>;

export const updateCostCentreSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(500).nullable().optional(),
});
export type UpdateCostCentreInput = z.infer<typeof updateCostCentreSchema>;

// === Budgets ===

/**
 * `POST /api/finance/budgets` — `startDate`/`endDate` are deliberately absent:
 * server-derived from `fiscalYear` + the organisation's own `fiscalYearStart`
 * (docs/domains/budgeting.md §11), never a client input that could disagree
 * with the org's own configuration.
 */
export const createBudgetSchema = z.object({
  budgetCode: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).optional(),
  fiscalYear: z.coerce.number().int().min(2000).max(2100),
  scenarioName: z.string().trim().min(1).max(60).default('Base'),
  cashflowScenarioId: z.string().trim().min(1).optional(),
  currency: z.string().trim().min(3).max(3),
  notes: z.string().trim().max(1000).optional(),
  idempotencyKey: z.string().trim().min(1).optional(),
});
export type CreateBudgetInput = z.infer<typeof createBudgetSchema>;

export const updateBudgetSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  cashflowScenarioId: z.string().trim().min(1).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
});
export type UpdateBudgetInput = z.infer<typeof updateBudgetSchema>;

// === Budget Lines ===

/**
 * `POST /api/finance/budgets/:id/lines` — `chartOfAccountId` is required for
 * `REVENUE`/`OPERATING_EXPENSE` and optional for `CAPEX` (service-enforced per
 * `lineType`, not expressible in a single Zod object schema without a
 * discriminated union that would otherwise duplicate every other field).
 */
export const createBudgetLineSchema = z.object({
  chartOfAccountId: z.string().trim().min(1).optional(),
  costCentreId: z.string().trim().min(1).optional(),
  lineType: budgetLineTypeSchema,
  periodMonth: z.coerce.date(),
  amount: z.coerce.number().nonnegative(),
  description: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(1000).optional(),
  idempotencyKey: z.string().trim().min(1).optional(),
});
export type CreateBudgetLineInput = z.infer<typeof createBudgetLineSchema>;

export const updateBudgetLineSchema = z.object({
  amount: z.coerce.number().nonnegative().optional(),
  description: z.string().trim().max(200).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
});
export type UpdateBudgetLineInput = z.infer<typeof updateBudgetLineSchema>;
