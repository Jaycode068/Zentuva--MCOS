import { z } from 'zod';

/**
 * Sprint 23 — HR Employee Lifecycle Foundation (docs/domains/hr.md).
 * Following the exact `maintenance.ts` one-shared-file-per-domain
 * convention: one Zod schema per write endpoint, server always injects
 * `organisationId`/actor ids, never trusts them from the body.
 */

// ---------------------------------------------------------------------------
// Department
// ---------------------------------------------------------------------------

export const createDepartmentSchema = z.object({
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).optional(),
  parentDepartmentId: z.string().trim().min(1).optional(),
  departmentHeadEmployeeId: z.string().trim().min(1).optional(),
});
export type CreateDepartmentInput = z.infer<typeof createDepartmentSchema>;

export const updateDepartmentSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  parentDepartmentId: z.string().trim().min(1).nullable().optional(),
  departmentHeadEmployeeId: z.string().trim().min(1).nullable().optional(),
});
export type UpdateDepartmentInput = z.infer<typeof updateDepartmentSchema>;

// ---------------------------------------------------------------------------
// Position
// ---------------------------------------------------------------------------

export const createPositionSchema = z.object({
  code: z.string().trim().min(1).max(40),
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).optional(),
  departmentId: z.string().trim().min(1).optional(),
  reportsToPositionId: z.string().trim().min(1).optional(),
});
export type CreatePositionInput = z.infer<typeof createPositionSchema>;

export const updatePositionSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  departmentId: z.string().trim().min(1).nullable().optional(),
  reportsToPositionId: z.string().trim().min(1).nullable().optional(),
});
export type UpdatePositionInput = z.infer<typeof updatePositionSchema>;

// ---------------------------------------------------------------------------
// Employee
// ---------------------------------------------------------------------------

export const employmentTypeSchema = z.enum([
  'FULL_TIME',
  'PART_TIME',
  'CONTRACT',
  'TEMPORARY',
  'INTERN',
  'CASUAL',
  'VOLUNTEER',
]);

export const genderSchema = z.enum(['MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY']);

const employeePersonalFields = {
  firstName: z.string().trim().min(1).max(80),
  middleName: z.string().trim().max(80).optional(),
  lastName: z.string().trim().min(1).max(80),
  preferredName: z.string().trim().max(80).optional(),
  workEmail: z.string().trim().email().max(160).optional(),
  personalEmail: z.string().trim().email().max(160).optional(),
  phoneNumber: z.string().trim().max(30).optional(),
  alternatePhoneNumber: z.string().trim().max(30).optional(),
  dateOfBirth: z.coerce.date().optional(),
  gender: genderSchema.optional(),
  nationality: z.string().trim().max(80).optional(),
  address: z.string().trim().max(500).optional(),
  emergencyContactName: z.string().trim().max(120).optional(),
  emergencyContactPhone: z.string().trim().max(30).optional(),
  emergencyContactRelationship: z.string().trim().max(80).optional(),
  notes: z.string().trim().max(2000).optional(),
};

export const createEmployeeSchema = z.object({
  ...employeePersonalFields,
  departmentId: z.string().trim().min(1).optional(),
  positionId: z.string().trim().min(1).optional(),
  managerEmployeeId: z.string().trim().min(1).optional(),
  employmentType: employmentTypeSchema,
  hireDate: z.coerce.date(),
  probationEndDate: z.coerce.date().optional(),
});
export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;

export const updateEmployeeSchema = z.object({
  firstName: z.string().trim().min(1).max(80).optional(),
  middleName: z.string().trim().max(80).nullable().optional(),
  lastName: z.string().trim().min(1).max(80).optional(),
  preferredName: z.string().trim().max(80).nullable().optional(),
  workEmail: z.string().trim().email().max(160).nullable().optional(),
  personalEmail: z.string().trim().email().max(160).nullable().optional(),
  phoneNumber: z.string().trim().max(30).nullable().optional(),
  alternatePhoneNumber: z.string().trim().max(30).nullable().optional(),
  dateOfBirth: z.coerce.date().nullable().optional(),
  gender: genderSchema.nullable().optional(),
  nationality: z.string().trim().max(80).nullable().optional(),
  address: z.string().trim().max(500).nullable().optional(),
  emergencyContactName: z.string().trim().max(120).nullable().optional(),
  emergencyContactPhone: z.string().trim().max(30).nullable().optional(),
  emergencyContactRelationship: z.string().trim().max(80).nullable().optional(),
  employmentType: employmentTypeSchema.optional(),
  hireDate: z.coerce.date().optional(),
  probationEndDate: z.coerce.date().nullable().optional(),
  confirmationDate: z.coerce.date().nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});
export type UpdateEmployeeInput = z.infer<typeof updateEmployeeSchema>;

export const assignEmployeeDepartmentSchema = z.object({
  departmentId: z.string().trim().min(1).nullable(),
});
export type AssignEmployeeDepartmentInput = z.infer<typeof assignEmployeeDepartmentSchema>;

export const assignEmployeePositionSchema = z.object({
  positionId: z.string().trim().min(1).nullable(),
});
export type AssignEmployeePositionInput = z.infer<typeof assignEmployeePositionSchema>;

export const assignEmployeeManagerSchema = z.object({
  managerEmployeeId: z.string().trim().min(1).nullable(),
});
export type AssignEmployeeManagerInput = z.infer<typeof assignEmployeeManagerSchema>;

export const linkEmployeeUserSchema = z.object({
  userId: z.string().trim().min(1),
});
export type LinkEmployeeUserInput = z.infer<typeof linkEmployeeUserSchema>;

export const suspendEmployeeSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});
export type SuspendEmployeeInput = z.infer<typeof suspendEmployeeSchema>;

export const separateEmployeeSchema = z.object({
  separationDate: z.coerce.date(),
  separationReason: z.string().trim().max(500).optional(),
});
export type SeparateEmployeeInput = z.infer<typeof separateEmployeeSchema>;

// ---------------------------------------------------------------------------
// Employee documents (metadata; file itself arrives as multipart, read via
// individual @Body() fields on the controller — the exact
// `MaintenanceDocument`/`AssetDocument` convention, no Zod pipe on that
// endpoint since it's FormData, not JSON)
// ---------------------------------------------------------------------------

export const employeeDocumentTypeSchema = z.enum([
  'EMPLOYMENT_CONTRACT',
  'IDENTIFICATION',
  'QUALIFICATION',
  'CERTIFICATION',
  'POLICY_ACKNOWLEDGEMENT',
  'ONBOARDING_DOCUMENT',
  'OTHER',
]);

export const updateEmployeeDocumentSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  issuedDate: z.coerce.date().nullable().optional(),
  expiryDate: z.coerce.date().nullable().optional(),
  status: z.enum(['ACTIVE', 'ARCHIVED']).optional(),
});
export type UpdateEmployeeDocumentInput = z.infer<typeof updateEmployeeDocumentSchema>;

// ---------------------------------------------------------------------------
// Onboarding
// ---------------------------------------------------------------------------

export const startOnboardingSchema = z.object({
  targetCompletionDate: z.coerce.date().optional(),
});
export type StartOnboardingInput = z.infer<typeof startOnboardingSchema>;

export const completeOnboardingSchema = z.object({
  notes: z.string().trim().max(2000).optional(),
});
export type CompleteOnboardingInput = z.infer<typeof completeOnboardingSchema>;
