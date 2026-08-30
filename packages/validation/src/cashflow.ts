import { z } from 'zod';

/**
 * Shared validation schemas for Sprint 15's Cashflow Management & Forecasting
 * (docs/domains/cashflow.md) — `CashflowForecastItem`, `CashflowScenario`,
 * `CashflowForecastAdjustment`, `CashflowSettings`. Split into its own file, same
 * "one file per domain" convention as `cash.ts`/`accounts-payable.ts`.
 */

export const cashflowDirectionSchema = z.enum(['INFLOW', 'OUTFLOW']);
export type CashflowDirectionInput = z.infer<typeof cashflowDirectionSchema>;

export const cashflowRecurrenceSchema = z.enum([
  'ONE_TIME',
  'WEEKLY',
  'MONTHLY',
  'QUARTERLY',
  'YEARLY',
]);
export type CashflowRecurrenceInput = z.infer<typeof cashflowRecurrenceSchema>;

/**
 * `POST /api/finance/cashflow/items` — a management-entered future cash
 * commitment (docs/domains/cashflow.md §5/§6) — never a substitute for an
 * Invoice/SupplierInvoice/Payment/SupplierPayment. `sourceType` is deliberately
 * absent — server-derived from `recurrence` (`ONE_TIME` → `MANUAL_FORECAST`,
 * else → `RECURRING_ITEM`), never a client input.
 */
export const createCashflowForecastItemSchema = z.object({
  cashAccountId: z.string().trim().min(1).optional(),
  direction: cashflowDirectionSchema,
  description: z.string().trim().min(1, 'Description is required').max(500),
  amount: z.number().positive('Amount must be greater than zero'),
  currency: z.string().trim().min(1, 'Currency is required').max(10),
  expectedDate: z.coerce.date(),
  recurrence: cashflowRecurrenceSchema.optional().default('ONE_TIME'),
  recurrenceEndDate: z.coerce.date().optional(),
  notes: z.string().trim().max(2000).optional(),
  idempotencyKey: z.string().trim().min(1).max(100).optional(),
});
export type CreateCashflowForecastItemInput = z.infer<typeof createCashflowForecastItemSchema>;

/** `PATCH /api/finance/cashflow/items/:id` — `direction`/`recurrence`/`sourceType`
 *  are immutable after creation (deactivate + recreate for a shape change, same
 *  convention as every other identity-field-immutable model in this codebase). */
export const updateCashflowForecastItemSchema = z.object({
  cashAccountId: z.string().trim().min(1).nullable().optional(),
  description: z.string().trim().min(1).max(500).optional(),
  amount: z.number().positive('Amount must be greater than zero').optional(),
  expectedDate: z.coerce.date().optional(),
  recurrenceEndDate: z.coerce.date().nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});
export type UpdateCashflowForecastItemInput = z.infer<typeof updateCashflowForecastItemSchema>;

/**
 * `POST /api/finance/cashflow/scenarios` (docs/domains/cashflow.md §7) — four
 * plain adjustment knobs, not a rules engine. Omitting a knob keeps it at the
 * Base-scenario identity value (delay 0, multiplier 1).
 */
export const createCashflowScenarioSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(200),
  description: z.string().trim().max(2000).optional(),
  inflowDelayDays: z.number().int().optional().default(0),
  inflowMultiplier: z.number().nonnegative('Multiplier cannot be negative').optional().default(1),
  outflowDelayDays: z.number().int().optional().default(0),
  outflowMultiplier: z.number().nonnegative('Multiplier cannot be negative').optional().default(1),
  idempotencyKey: z.string().trim().min(1).max(100).optional(),
});
export type CreateCashflowScenarioInput = z.infer<typeof createCashflowScenarioSchema>;

export const updateCashflowScenarioSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  inflowDelayDays: z.number().int().optional(),
  inflowMultiplier: z.number().nonnegative('Multiplier cannot be negative').optional(),
  outflowDelayDays: z.number().int().optional(),
  outflowMultiplier: z.number().nonnegative('Multiplier cannot be negative').optional(),
});
export type UpdateCashflowScenarioInput = z.infer<typeof updateCashflowScenarioSchema>;

/**
 * `PUT /api/finance/cashflow/adjustments` (docs/domains/cashflow.md §8) — upserted
 * by `(sourceType, sourceId)`; at least one of `adjustedExpectedDate`/
 * `adjustedAmount` must be supplied. Never touches the source
 * Invoice/SupplierInvoice row itself.
 */
export const upsertCashflowForecastAdjustmentSchema = z
  .object({
    sourceType: z.enum(['CUSTOMER_RECEIVABLE', 'SUPPLIER_PAYABLE']),
    sourceId: z.string().trim().min(1, 'Source id is required'),
    adjustedExpectedDate: z.coerce.date().optional(),
    adjustedAmount: z.number().positive('Amount must be greater than zero').optional(),
    notes: z.string().trim().max(2000).optional(),
    idempotencyKey: z.string().trim().min(1).max(100).optional(),
  })
  .refine((data) => data.adjustedExpectedDate !== undefined || data.adjustedAmount !== undefined, {
    message: 'At least one of adjustedExpectedDate/adjustedAmount is required',
    path: ['adjustedExpectedDate'],
  });
export type UpsertCashflowForecastAdjustmentInput = z.infer<
  typeof upsertCashflowForecastAdjustmentSchema
>;

/** `PUT /api/finance/cashflow/settings` (docs/domains/cashflow.md §10). */
export const updateCashflowSettingsSchema = z.object({
  minimumCashReserve: z.number().nonnegative('Minimum cash reserve cannot be negative').optional(),
  defaultCollectionDelayDays: z.number().int().min(0).optional(),
  defaultPaymentDelayDays: z.number().int().min(0).optional(),
});
export type UpdateCashflowSettingsInput = z.infer<typeof updateCashflowSettingsSchema>;

/** `GET /api/finance/cashflow/forecast` query params. */
export const cashflowForecastQuerySchema = z.object({
  horizonDays: z.coerce.number().int().positive().max(730).optional().default(90),
  bucketBy: z.enum(['weekly', 'monthly']).optional().default('weekly'),
  scenarioId: z.string().trim().min(1).optional(),
  cashAccountId: z.string().trim().min(1).optional(),
});
export type CashflowForecastQueryInput = z.infer<typeof cashflowForecastQuerySchema>;
