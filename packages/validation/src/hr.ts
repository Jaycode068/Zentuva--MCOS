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

// ---------------------------------------------------------------------------
// Sprint 24 — Work schedules
// ---------------------------------------------------------------------------

const timeOfDaySchema = z
  .string()
  .trim()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected 24-hour "HH:mm"');

export const createWorkScheduleSchema = z.object({
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).optional(),
  workDays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  expectedStartTime: timeOfDaySchema,
  expectedEndTime: timeOfDaySchema,
  gracePeriodMinutes: z.number().int().min(0).max(240).optional(),
});
export type CreateWorkScheduleInput = z.infer<typeof createWorkScheduleSchema>;

export const updateWorkScheduleSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  workDays: z.array(z.number().int().min(0).max(6)).min(1).max(7).optional(),
  expectedStartTime: timeOfDaySchema.optional(),
  expectedEndTime: timeOfDaySchema.optional(),
  gracePeriodMinutes: z.number().int().min(0).max(240).optional(),
});
export type UpdateWorkScheduleInput = z.infer<typeof updateWorkScheduleSchema>;

export const assignEmployeeWorkScheduleSchema = z.object({
  workScheduleId: z.string().trim().min(1).nullable(),
});
export type AssignEmployeeWorkScheduleInput = z.infer<typeof assignEmployeeWorkScheduleSchema>;

// ---------------------------------------------------------------------------
// Sprint 24 — Attendance
// ---------------------------------------------------------------------------

const locationCaptureSchema = z.object({
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  accuracyMeters: z.number().min(0).optional(),
  locationLabel: z.string().trim().max(200).optional(),
});

/** Self-service sign-in: no timestamp field — the server clock is
 *  authoritative. Location is optional and never fabricated client-side. */
export const signInSchema = z.object({
  location: locationCaptureSchema.optional(),
});
export type SignInInput = z.infer<typeof signInSchema>;

export const signOutSchema = z.object({
  location: locationCaptureSchema.optional(),
});
export type SignOutInput = z.infer<typeof signOutSchema>;

/** Administrative entry — an authorized administrator records attendance on
 *  behalf of an employee (e.g. no device/self-service available). Still no
 *  arbitrary sign-in/out timestamp field: the server clock applies here too,
 *  administrative status is conveyed only via `source`, not backdating. */
export const administrativeAttendanceSchema = z.object({
  employeeId: z.string().trim().min(1),
  attendanceDate: z.coerce.date(),
  signIn: z.boolean().optional(),
  signOut: z.boolean().optional(),
  notes: z.string().trim().max(1000).optional(),
});
export type AdministrativeAttendanceInput = z.infer<typeof administrativeAttendanceSchema>;

export const reviewAttendanceSchema = z.object({
  reviewStatus: z.enum(['APPROVED', 'REQUIRES_CORRECTION', 'REJECTED']),
  notes: z.string().trim().max(1000).optional(),
});
export type ReviewAttendanceInput = z.infer<typeof reviewAttendanceSchema>;

export const requestAttendanceCorrectionSchema = z.object({
  requestedSignInAt: z.coerce.date().optional(),
  requestedSignOutAt: z.coerce.date().optional(),
  reason: z.string().trim().min(1).max(1000),
});
export type RequestAttendanceCorrectionInput = z.infer<typeof requestAttendanceCorrectionSchema>;

export const reviewAttendanceCorrectionSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  reviewComment: z.string().trim().max(1000).optional(),
});
export type ReviewAttendanceCorrectionInput = z.infer<typeof reviewAttendanceCorrectionSchema>;

// ---------------------------------------------------------------------------
// Sprint 24 — Policies
// ---------------------------------------------------------------------------

export const policyScopeTypeSchema = z.enum(['ORGANISATION', 'DEPARTMENT']);

export const createPolicySchema = z.object({
  code: z.string().trim().min(1).max(40),
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(1000).optional(),
  scopeType: policyScopeTypeSchema.optional(),
  departmentId: z.string().trim().min(1).optional(),
  ownerDepartmentId: z.string().trim().min(1).optional(),
});
export type CreatePolicyInput = z.infer<typeof createPolicySchema>;

export const updatePolicySchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  scopeType: policyScopeTypeSchema.optional(),
  departmentId: z.string().trim().min(1).nullable().optional(),
  ownerDepartmentId: z.string().trim().min(1).nullable().optional(),
});
export type UpdatePolicyInput = z.infer<typeof updatePolicySchema>;

export const createPolicyVersionSchema = z.object({
  content: z.string().trim().min(1).max(20000),
  effectiveDate: z.coerce.date(),
  requiresAcknowledgement: z.boolean().optional(),
});
export type CreatePolicyVersionInput = z.infer<typeof createPolicyVersionSchema>;

export const acknowledgePolicySchema = z.object({
  employeeId: z.string().trim().min(1).optional(),
  notes: z.string().trim().max(500).optional(),
});
export type AcknowledgePolicyInput = z.infer<typeof acknowledgePolicySchema>;

// ---------------------------------------------------------------------------
// Sprint 24 — Training
// ---------------------------------------------------------------------------

export const trainingDeliveryModeSchema = z.enum(['IN_PERSON', 'ONLINE', 'BLENDED', 'SELF_STUDY']);

export const createTrainingCourseSchema = z.object({
  code: z.string().trim().min(1).max(40),
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(1000).optional(),
  provider: z.string().trim().max(160).optional(),
  deliveryMode: trainingDeliveryModeSchema,
  durationMinutes: z.number().int().min(1).optional(),
  validityPeriodDays: z.number().int().min(1).optional(),
});
export type CreateTrainingCourseInput = z.infer<typeof createTrainingCourseSchema>;

export const updateTrainingCourseSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  provider: z.string().trim().max(160).nullable().optional(),
  deliveryMode: trainingDeliveryModeSchema.optional(),
  durationMinutes: z.number().int().min(1).nullable().optional(),
  validityPeriodDays: z.number().int().min(1).nullable().optional(),
});
export type UpdateTrainingCourseInput = z.infer<typeof updateTrainingCourseSchema>;

export const assignTrainingSchema = z.object({
  employeeId: z.string().trim().min(1),
  dueDate: z.coerce.date().optional(),
});
export type AssignTrainingInput = z.infer<typeof assignTrainingSchema>;

export const updateEmployeeTrainingSchema = z.object({
  status: z.enum(['ASSIGNED', 'IN_PROGRESS', 'CANCELLED']).optional(),
  dueDate: z.coerce.date().nullable().optional(),
  completionNotes: z.string().trim().max(1000).nullable().optional(),
  certificateDocumentId: z.string().trim().min(1).nullable().optional(),
});
export type UpdateEmployeeTrainingInput = z.infer<typeof updateEmployeeTrainingSchema>;

export const completeEmployeeTrainingSchema = z.object({
  completionNotes: z.string().trim().max(1000).optional(),
  certificateDocumentId: z.string().trim().min(1).optional(),
});
export type CompleteEmployeeTrainingInput = z.infer<typeof completeEmployeeTrainingSchema>;
