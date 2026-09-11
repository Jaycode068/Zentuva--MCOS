import { z } from 'zod';

/**
 * Shared validation schemas for Sprint 21's Maintenance Management
 * Foundation (docs/domains/maintenance.md) — `MaintenanceType`,
 * `MaintenancePlan`/`MaintenancePlanTask`, `MaintenanceSchedule`,
 * `MaintenanceRequest`, `WorkOrder`/`WorkOrderTask`, `AssetDowntime`,
 * `MaintenancePartUsage`, `MaintenanceCost`. Same "one file per domain"
 * convention as `assets.ts`/`decision.ts`.
 */

export const maintenancePrioritySchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
export type MaintenancePriorityInput = z.infer<typeof maintenancePrioritySchema>;

// === Maintenance Types ===

export const createMaintenanceTypeSchema = z.object({
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).optional(),
});
export type CreateMaintenanceTypeInput = z.infer<typeof createMaintenanceTypeSchema>;

export const updateMaintenanceTypeSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
});
export type UpdateMaintenanceTypeInput = z.infer<typeof updateMaintenanceTypeSchema>;

// === Maintenance Plans ===

export const createMaintenancePlanTaskSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).optional(),
  mandatory: z.boolean().default(true),
  estimatedDurationMinutes: z.coerce.number().int().positive().optional(),
});
export type CreateMaintenancePlanTaskInput = z.infer<typeof createMaintenancePlanTaskSchema>;

export const createMaintenancePlanSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().max(1000).optional(),
    maintenanceTypeId: z.string().trim().min(1),
    assetId: z.string().trim().min(1).optional(),
    assetCategoryId: z.string().trim().min(1).optional(),
    priority: maintenancePrioritySchema.default('MEDIUM'),
    estimatedDurationMinutes: z.coerce.number().int().positive().optional(),
    instructions: z.string().trim().max(4000).optional(),
    safetyNotes: z.string().trim().max(2000).optional(),
    tasks: z.array(createMaintenancePlanTaskSchema).default([]),
    idempotencyKey: z.string().trim().min(1).optional(),
  })
  .refine((data) => !!data.assetId !== !!data.assetCategoryId, {
    message: 'A plan must target exactly one of assetId or assetCategoryId',
  });
export type CreateMaintenancePlanInput = z.infer<typeof createMaintenancePlanSchema>;

export const updateMaintenancePlanSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  priority: maintenancePrioritySchema.optional(),
  estimatedDurationMinutes: z.coerce.number().int().positive().nullable().optional(),
  instructions: z.string().trim().max(4000).nullable().optional(),
  safetyNotes: z.string().trim().max(2000).nullable().optional(),
});
export type UpdateMaintenancePlanInput = z.infer<typeof updateMaintenancePlanSchema>;

// === Maintenance Schedules ===

export const maintenanceScheduleTypeSchema = z.enum(['DATE_BASED', 'METER_BASED']);
export type MaintenanceScheduleTypeInput = z.infer<typeof maintenanceScheduleTypeSchema>;

export const maintenanceFrequencyUnitSchema = z.enum(['DAYS', 'WEEKS', 'MONTHS', 'YEARS']);
export type MaintenanceFrequencyUnitInput = z.infer<typeof maintenanceFrequencyUnitSchema>;

export const createMaintenanceScheduleSchema = z
  .object({
    maintenancePlanId: z.string().trim().min(1),
    assetId: z.string().trim().min(1),
    scheduleType: maintenanceScheduleTypeSchema,
    frequencyValue: z.coerce.number().int().positive().optional(),
    frequencyUnit: maintenanceFrequencyUnitSchema.optional(),
    nextDueDate: z.coerce.date().optional(),
    meterType: z.enum(['HOURS', 'KILOMETERS', 'CYCLES', 'UNITS', 'OTHER']).optional(),
    meterInterval: z.coerce.number().positive().optional(),
    nextDueMeterReading: z.coerce.number().nonnegative().optional(),
    idempotencyKey: z.string().trim().min(1).optional(),
  })
  .refine(
    (data) =>
      data.scheduleType === 'DATE_BASED'
        ? !!data.frequencyValue && !!data.frequencyUnit && !!data.nextDueDate
        : !!data.meterType && !!data.meterInterval && data.nextDueMeterReading !== undefined,
    {
      message:
        'DATE_BASED schedules require frequencyValue/frequencyUnit/nextDueDate; METER_BASED schedules require meterType/meterInterval/nextDueMeterReading',
    },
  );
export type CreateMaintenanceScheduleInput = z.infer<typeof createMaintenanceScheduleSchema>;

export const updateMaintenanceScheduleSchema = z.object({
  frequencyValue: z.coerce.number().int().positive().optional(),
  frequencyUnit: maintenanceFrequencyUnitSchema.optional(),
  nextDueDate: z.coerce.date().optional(),
  meterInterval: z.coerce.number().positive().optional(),
  nextDueMeterReading: z.coerce.number().nonnegative().optional(),
});
export type UpdateMaintenanceScheduleInput = z.infer<typeof updateMaintenanceScheduleSchema>;

export const generateMaintenanceScheduleSchema = z.object({
  idempotencyKey: z.string().trim().min(1).optional(),
});
export type GenerateMaintenanceScheduleInput = z.infer<typeof generateMaintenanceScheduleSchema>;

// === Maintenance Requests ===

export const maintenanceIssueTypeSchema = z.enum([
  'BREAKDOWN',
  'PERFORMANCE',
  'SAFETY',
  'NOISE',
  'LEAK',
  'ELECTRICAL',
  'MECHANICAL',
  'OTHER',
]);
export type MaintenanceIssueTypeInput = z.infer<typeof maintenanceIssueTypeSchema>;

export const createMaintenanceRequestSchema = z.object({
  assetId: z.string().trim().min(1),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  priority: maintenancePrioritySchema.default('MEDIUM'),
  issueType: maintenanceIssueTypeSchema.optional(),
  requestedDueDate: z.coerce.date().optional(),
  notes: z.string().trim().max(2000).optional(),
  idempotencyKey: z.string().trim().min(1).optional(),
});
export type CreateMaintenanceRequestInput = z.infer<typeof createMaintenanceRequestSchema>;

export const updateMaintenanceRequestSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  priority: maintenancePrioritySchema.optional(),
  issueType: maintenanceIssueTypeSchema.nullable().optional(),
  requestedDueDate: z.coerce.date().nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});
export type UpdateMaintenanceRequestInput = z.infer<typeof updateMaintenanceRequestSchema>;

export const rejectMaintenanceRequestSchema = z.object({
  rejectionReason: z.string().trim().min(1).max(1000),
});
export type RejectMaintenanceRequestInput = z.infer<typeof rejectMaintenanceRequestSchema>;

export const convertMaintenanceRequestSchema = z.object({
  maintenanceTypeId: z.string().trim().min(1),
  plannedStartAt: z.coerce.date().optional(),
  plannedEndAt: z.coerce.date().optional(),
  assignedToId: z.string().trim().min(1).optional(),
  idempotencyKey: z.string().trim().min(1).optional(),
});
export type ConvertMaintenanceRequestInput = z.infer<typeof convertMaintenanceRequestSchema>;

// === Work Orders ===

export const createWorkOrderSchema = z.object({
  assetId: z.string().trim().min(1),
  maintenanceTypeId: z.string().trim().min(1),
  maintenanceRequestId: z.string().trim().min(1).optional(),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  priority: maintenancePrioritySchema.default('MEDIUM'),
  assignedToId: z.string().trim().min(1).optional(),
  plannedStartAt: z.coerce.date().optional(),
  plannedEndAt: z.coerce.date().optional(),
  failureReason: z.string().trim().max(2000).optional(),
  isExternalService: z.boolean().default(false),
  externalSupplierId: z.string().trim().min(1).optional(),
  externalProviderName: z.string().trim().max(200).optional(),
  externalReference: z.string().trim().max(120).optional(),
  externalSentAt: z.coerce.date().optional(),
  notes: z.string().trim().max(2000).optional(),
  idempotencyKey: z.string().trim().min(1).optional(),
});
export type CreateWorkOrderInput = z.infer<typeof createWorkOrderSchema>;

export const updateWorkOrderSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  priority: maintenancePrioritySchema.optional(),
  plannedStartAt: z.coerce.date().nullable().optional(),
  plannedEndAt: z.coerce.date().nullable().optional(),
  failureReason: z.string().trim().max(2000).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});
export type UpdateWorkOrderInput = z.infer<typeof updateWorkOrderSchema>;

export const assignWorkOrderSchema = z.object({
  assignedToId: z.string().trim().min(1),
});
export type AssignWorkOrderInput = z.infer<typeof assignWorkOrderSchema>;

export const holdWorkOrderSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});
export type HoldWorkOrderInput = z.infer<typeof holdWorkOrderSchema>;

export const completeWorkOrderSchema = z.object({
  resolution: z.string().trim().min(1).max(2000),
  rootCause: z.string().trim().max(2000).optional(),
  correctiveAction: z.string().trim().max(2000).optional(),
  notes: z.string().trim().max(2000).optional(),
  meterReading: z.coerce.number().nonnegative().optional(),
  /// Required only when the asset has more than one meter (e.g. a
  /// vehicle with both KILOMETERS and HOURS) — disambiguates which one
  /// `meterReading` applies to. If the asset has exactly one meter, it is
  /// resolved automatically.
  meterType: z.enum(['HOURS', 'KILOMETERS', 'CYCLES', 'UNITS', 'OTHER']).optional(),
  externalReturnedAt: z.coerce.date().optional(),
  idempotencyKey: z.string().trim().min(1).optional(),
});
export type CompleteWorkOrderInput = z.infer<typeof completeWorkOrderSchema>;

export const cancelWorkOrderSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});
export type CancelWorkOrderInput = z.infer<typeof cancelWorkOrderSchema>;

// === Work Order Tasks ===

export const createWorkOrderTaskSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).optional(),
  mandatory: z.boolean().default(true),
  assignedToId: z.string().trim().min(1).optional(),
  estimatedDurationMinutes: z.coerce.number().int().positive().optional(),
});
export type CreateWorkOrderTaskInput = z.infer<typeof createWorkOrderTaskSchema>;

export const updateWorkOrderTaskSchema = z.object({
  status: z.enum(['PENDING', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED']).optional(),
  actualDurationMinutes: z.coerce.number().int().nonnegative().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
});
export type UpdateWorkOrderTaskInput = z.infer<typeof updateWorkOrderTaskSchema>;

// === Downtime ===

export const recordDowntimeSchema = z
  .object({
    workOrderId: z.string().trim().min(1),
    startedAt: z.coerce.date(),
    endedAt: z.coerce.date().optional(),
    reason: z.string().trim().max(500).optional(),
    planned: z.boolean().default(false),
    idempotencyKey: z.string().trim().min(1).optional(),
  })
  .refine((data) => !data.endedAt || data.endedAt >= data.startedAt, {
    message: 'endedAt cannot be before startedAt',
  });
export type RecordDowntimeInput = z.infer<typeof recordDowntimeSchema>;

export const endDowntimeSchema = z.object({
  endedAt: z.coerce.date().optional(),
});
export type EndDowntimeInput = z.infer<typeof endDowntimeSchema>;

// === Parts / Material Usage ===

export const recordPartUsageSchema = z.object({
  workOrderId: z.string().trim().min(1),
  productId: z.string().trim().min(1),
  quantity: z.coerce.number().positive(),
  usageType: z.enum(['CONSUMED', 'RETURNED']).default('CONSUMED'),
  notes: z.string().trim().max(1000).optional(),
  idempotencyKey: z.string().trim().min(1).optional(),
});
export type RecordPartUsageInput = z.infer<typeof recordPartUsageSchema>;

// === Costs ===

export const maintenanceCostCategorySchema = z.enum([
  'LABOUR',
  'PARTS',
  'SERVICE',
  'TRANSPORT',
  'OTHER',
]);
export type MaintenanceCostCategoryInput = z.infer<typeof maintenanceCostCategorySchema>;

export const recordMaintenanceCostSchema = z.object({
  workOrderId: z.string().trim().min(1),
  category: maintenanceCostCategorySchema,
  description: z.string().trim().max(500).optional(),
  quantity: z.coerce.number().positive().default(1),
  unitCost: z.coerce.number().nonnegative(),
  currency: z.string().trim().min(3).max(3).default('NGN'),
  supplierId: z.string().trim().min(1).optional(),
  costCentreId: z.string().trim().min(1).optional(),
  referenceType: z.string().trim().max(60).optional(),
  referenceId: z.string().trim().max(120).optional(),
  idempotencyKey: z.string().trim().min(1).optional(),
});
export type RecordMaintenanceCostInput = z.infer<typeof recordMaintenanceCostSchema>;

// === Documents ===

export const maintenanceDocumentEntityTypeSchema = z.enum(['REQUEST', 'WORK_ORDER']);
export type MaintenanceDocumentEntityTypeInput = z.infer<
  typeof maintenanceDocumentEntityTypeSchema
>;

export const maintenanceDocumentTypeSchema = z.enum([
  'BEFORE_PHOTO',
  'AFTER_PHOTO',
  'INVOICE',
  'REPORT',
  'OTHER',
]);
export type MaintenanceDocumentTypeInput = z.infer<typeof maintenanceDocumentTypeSchema>;

// === Sprint 22 — Maintenance Ecosystem Integration ===
// (docs/domains/maintenance-integration.md)

// === Parts / Material Usage — Inventory Integration ===

export const issuePartUsageSchema = z.object({
  locationId: z.string().trim().min(1),
  issueIdempotencyKey: z.string().trim().min(1).optional(),
});
export type IssuePartUsageInput = z.infer<typeof issuePartUsageSchema>;

export const cancelPartUsageSchema = z.object({});
export type CancelPartUsageInput = z.infer<typeof cancelPartUsageSchema>;

// === Procurement Requirements ===

export const createProcurementRequirementSchema = z.object({
  description: z.string().trim().min(1).max(1000),
  estimatedCost: z.coerce.number().nonnegative().optional(),
  supplierId: z.string().trim().min(1).optional(),
  idempotencyKey: z.string().trim().min(1).optional(),
});
export type CreateProcurementRequirementInput = z.infer<typeof createProcurementRequirementSchema>;

export const linkProcurementRequirementSchema = z.object({
  purchaseOrderId: z.string().trim().min(1),
});
export type LinkProcurementRequirementInput = z.infer<typeof linkProcurementRequirementSchema>;
