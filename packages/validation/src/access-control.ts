import { z } from 'zod';

/**
 * Sprint 25 — Configurable Access Control (docs/domains/access-control.md). Following
 * the exact `hr.ts` one-shared-file-per-domain convention: one Zod schema per write
 * endpoint, server always injects `organisationId`/actor ids, never trusts them from
 * the body.
 */

export const accessScopeSchema = z.enum([
  'ORGANISATION',
  'OWN_RECORDS',
  'OWN_TEAM',
  'DEPARTMENT',
  'ASSIGNED_RECORDS',
  'ASSIGNED_TERRITORY',
  'ASSIGNED_ASSETS',
  'NONE',
]);

export const rolePermissionGrantSchema = z.object({
  permissionKey: z.string().trim().min(1),
  scope: accessScopeSchema.optional(),
});

/** Named `AccessRole` (not `Role`) to avoid colliding with `identity.ts`'s
 *  pre-existing, never-wired `createRoleSchema`/`updateRoleSchema` (Sprint 1B.1 —
 *  dead code, no controller ever imported them). */
export const createAccessRoleSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).optional(),
  permissions: z.array(rolePermissionGrantSchema).optional(),
});
export type CreateAccessRoleInput = z.infer<typeof createAccessRoleSchema>;

export const updateAccessRoleSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(500).nullable().optional(),
});
export type UpdateAccessRoleInput = z.infer<typeof updateAccessRoleSchema>;

export const setRolePermissionsSchema = z.object({
  permissions: z.array(rolePermissionGrantSchema),
});
export type SetRolePermissionsInput = z.infer<typeof setRolePermissionsSchema>;

export const duplicateRoleSchema = z.object({
  name: z.string().trim().min(1).max(80),
});
export type DuplicateRoleInput = z.infer<typeof duplicateRoleSchema>;

export const assignUserRoleSchema = z.object({
  roleId: z.string().trim().min(1),
});
export type AssignUserRoleInput = z.infer<typeof assignUserRoleSchema>;

export const commonEmployeeAccessPolicySchema = z.object({
  selfSignIn: z.boolean().optional(),
  selfSignOut: z.boolean().optional(),
  viewOwnSchedule: z.boolean().optional(),
  viewOwnAttendance: z.boolean().optional(),
  submitAttendanceCorrection: z.boolean().optional(),
  viewAssignedTraining: z.boolean().optional(),
  completeAssignedTraining: z.boolean().optional(),
  viewApplicablePolicies: z.boolean().optional(),
  acknowledgePolicies: z.boolean().optional(),
  viewOwnProfile: z.boolean().optional(),
});
export type CommonEmployeeAccessPolicyInput = z.infer<typeof commonEmployeeAccessPolicySchema>;
