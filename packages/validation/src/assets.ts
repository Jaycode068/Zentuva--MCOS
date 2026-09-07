import { z } from 'zod';

/**
 * Shared validation schemas for Sprint 20's Asset Register & Asset
 * Management Foundation (docs/domains/assets.md) — `AssetCategory`,
 * `AssetLocation`, `Asset`, `AssetMovement` (transfer), `AssetMeter`,
 * `AssetMeterReading`. Same "one file per domain" convention as
 * `investment.ts`/`decision.ts`.
 */

// === Asset Categories ===

export const createAssetCategorySchema = z.object({
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).optional(),
  parentCategoryId: z.string().trim().min(1).optional(),
});
export type CreateAssetCategoryInput = z.infer<typeof createAssetCategorySchema>;

export const updateAssetCategorySchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  parentCategoryId: z.string().trim().min(1).nullable().optional(),
});
export type UpdateAssetCategoryInput = z.infer<typeof updateAssetCategorySchema>;

// === Asset Locations ===

export const createAssetLocationSchema = z.object({
  name: z.string().trim().min(1).max(120),
  parentLocationId: z.string().trim().min(1).optional(),
});
export type CreateAssetLocationInput = z.infer<typeof createAssetLocationSchema>;

export const updateAssetLocationSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  parentLocationId: z.string().trim().min(1).nullable().optional(),
});
export type UpdateAssetLocationInput = z.infer<typeof updateAssetLocationSchema>;

// === Assets ===

export const assetAcquisitionTypeSchema = z.enum([
  'PURCHASE',
  'CAPITAL_PROJECT',
  'TRANSFER',
  'DONATION',
  'LEASE',
  'OTHER',
]);
export type AssetAcquisitionTypeInput = z.infer<typeof assetAcquisitionTypeSchema>;

export const assetConditionSchema = z.enum(['NEW', 'GOOD', 'FAIR', 'POOR', 'CRITICAL']);
export type AssetConditionInput = z.infer<typeof assetConditionSchema>;

export const createAssetSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).optional(),
  categoryId: z.string().trim().min(1),
  parentAssetId: z.string().trim().min(1).optional(),
  assetTag: z.string().trim().min(1).max(60).optional(),
  serialNumber: z.string().trim().max(120).optional(),
  manufacturer: z.string().trim().max(120).optional(),
  model: z.string().trim().max(120).optional(),
  yearOfManufacture: z.coerce.number().int().min(1900).max(2100).optional(),
  locationId: z.string().trim().min(1).optional(),
  custodianId: z.string().trim().min(1).optional(),
  acquisitionType: assetAcquisitionTypeSchema.default('PURCHASE'),
  acquisitionDate: z.coerce.date().optional(),
  inServiceDate: z.coerce.date().optional(),
  acquisitionCost: z.coerce.number().nonnegative().optional(),
  currency: z.string().trim().min(3).max(3).default('NGN'),
  supplierId: z.string().trim().min(1).optional(),
  purchaseOrderId: z.string().trim().min(1).optional(),
  capitalProjectId: z.string().trim().min(1).optional(),
  warrantyStartDate: z.coerce.date().optional(),
  warrantyEndDate: z.coerce.date().optional(),
  warrantyProvider: z.string().trim().max(200).optional(),
  warrantyReference: z.string().trim().max(120).optional(),
  warrantyNotes: z.string().trim().max(1000).optional(),
  usefulLifeMonths: z.coerce.number().int().positive().optional(),
  salvageValue: z.coerce.number().nonnegative().optional(),
  notes: z.string().trim().max(1000).optional(),
  idempotencyKey: z.string().trim().min(1).optional(),
});
export type CreateAssetInput = z.infer<typeof createAssetSchema>;

export const updateAssetSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  categoryId: z.string().trim().min(1).optional(),
  parentAssetId: z.string().trim().min(1).nullable().optional(),
  assetTag: z.string().trim().min(1).max(60).nullable().optional(),
  condition: assetConditionSchema.optional(),
  serialNumber: z.string().trim().max(120).nullable().optional(),
  manufacturer: z.string().trim().max(120).nullable().optional(),
  model: z.string().trim().max(120).nullable().optional(),
  yearOfManufacture: z.coerce.number().int().min(1900).max(2100).nullable().optional(),
  custodianId: z.string().trim().min(1).nullable().optional(),
  acquisitionDate: z.coerce.date().nullable().optional(),
  inServiceDate: z.coerce.date().nullable().optional(),
  acquisitionCost: z.coerce.number().nonnegative().nullable().optional(),
  supplierId: z.string().trim().min(1).nullable().optional(),
  purchaseOrderId: z.string().trim().min(1).nullable().optional(),
  capitalProjectId: z.string().trim().min(1).nullable().optional(),
  warrantyStartDate: z.coerce.date().nullable().optional(),
  warrantyEndDate: z.coerce.date().nullable().optional(),
  warrantyProvider: z.string().trim().max(200).nullable().optional(),
  warrantyReference: z.string().trim().max(120).nullable().optional(),
  warrantyNotes: z.string().trim().max(1000).nullable().optional(),
  usefulLifeMonths: z.coerce.number().int().positive().nullable().optional(),
  salvageValue: z.coerce.number().nonnegative().nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
});
export type UpdateAssetInput = z.infer<typeof updateAssetSchema>;

export const transferAssetSchema = z
  .object({
    newLocationId: z.string().trim().min(1).optional(),
    newCustodianId: z.string().trim().min(1).optional(),
    reason: z.string().trim().max(200).optional(),
    notes: z.string().trim().max(1000).optional(),
    effectiveAt: z.coerce.date().optional(),
    idempotencyKey: z.string().trim().min(1).optional(),
  })
  .refine((data) => !!data.newLocationId || !!data.newCustodianId, {
    message: 'At least one of newLocationId/newCustodianId must be provided',
  });
export type TransferAssetInput = z.infer<typeof transferAssetSchema>;

// === Asset Meters ===

export const assetMeterTypeSchema = z.enum(['HOURS', 'KILOMETERS', 'CYCLES', 'UNITS', 'OTHER']);
export type AssetMeterTypeInput = z.infer<typeof assetMeterTypeSchema>;

export const createAssetMeterSchema = z.object({
  meterType: assetMeterTypeSchema,
  unit: z.string().trim().min(1).max(40),
});
export type CreateAssetMeterInput = z.infer<typeof createAssetMeterSchema>;

export const recordMeterReadingSchema = z.object({
  reading: z.coerce.number().nonnegative(),
  readingDate: z.coerce.date().optional(),
  notes: z.string().trim().max(1000).optional(),
  idempotencyKey: z.string().trim().min(1).optional(),
});
export type RecordMeterReadingInput = z.infer<typeof recordMeterReadingSchema>;
