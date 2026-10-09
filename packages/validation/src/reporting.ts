import { z } from 'zod';

/**
 * Sprint 45 — Reporting & Business Intelligence Foundation. Query-parameter
 * validation for the new `reporting/*` endpoints — the audit found that every
 * pre-existing report controller (`finance/reports/*`) parses `@Query()` as raw
 * strings with no Zod schema at all; this file is the first validated reporting
 * contract in the codebase; existing Finance report endpoints are left unchanged.
 *
 * Mirrors `pagination.ts`'s own `z.coerce` convention for query-string inputs.
 */

export const reportingPeriodPresetSchema = z.enum([
  'today',
  'yesterday',
  'this_week',
  'last_week',
  'this_month',
  'last_month',
  'this_quarter',
  'last_quarter',
  'this_year',
  'last_year',
  'custom',
]);

export const comparisonModeSchema = z.enum(['none', 'previous_period', 'previous_year']);

/** `customFrom`/`customTo` are required together only when `preset === 'custom'` —
 *  enforced by `.refine` rather than a discriminated union, since every other preset
 *  field is a plain flat query-string shape (`@Query()` params, not a JSON body). */
export const reportingPeriodQuerySchema = z
  .object({
    preset: reportingPeriodPresetSchema.default('this_month'),
    customFrom: z.coerce.date().optional(),
    customTo: z.coerce.date().optional(),
    comparison: comparisonModeSchema.default('none'),
  })
  .refine((value) => value.preset !== 'custom' || (value.customFrom && value.customTo), {
    message: 'customFrom and customTo are required when preset is "custom".',
  })
  .refine((value) => !value.customFrom || !value.customTo || value.customFrom < value.customTo, {
    message: 'customFrom must be before customTo.',
  });

export type ReportingPeriodQuery = z.infer<typeof reportingPeriodQuerySchema>;

/** Shared pagination for a tabular report — same bounds as `paginationSchema`, kept as
 *  a separate export so a reporting-specific default (`pageSize: 25`, matching the
 *  typical report-table page size) doesn't change `pagination.ts`'s own existing
 *  default used elsewhere. */
export const reportPaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export type ReportPaginationInput = z.infer<typeof reportPaginationSchema>;

/** Only a sort field present in a report's own `sortableFields` list is ever honored
 *  server-side (brief §13 "do not interpolate arbitrary client-supplied column names
 *  into SQL") — this schema validates SHAPE only; each report service separately
 *  checks `field` against its own allowlist before using it. */
export const reportSortSchema = z.object({
  field: z.string().min(1).max(64).optional(),
  direction: z.enum(['asc', 'desc']).default('desc'),
});

export type ReportSortInput = z.infer<typeof reportSortSchema>;
