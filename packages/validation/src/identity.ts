import { z } from 'zod';

/**
 * Shared validation schemas for the Identity Domain, matching the API contract in
 * docs/domains/identity.md §10. Not yet wired into any controller or DTO (Sprint 1B.1 is
 * Database & Domain Layer only) — these exist for future use, per that sprint's brief.
 *
 * The enum schemas below intentionally mirror apps/api/prisma/schema.prisma's enums as
 * plain string literals rather than importing `@prisma/client` here — this package is
 * shared by apps/web too, which has no business depending on the generated Prisma client.
 * Keep them in sync by hand if the Prisma enums change.
 */

export const organisationStatusSchema = z.enum(['PENDING', 'ACTIVE', 'SUSPENDED', 'CLOSED']);
export type OrganisationStatusInput = z.infer<typeof organisationStatusSchema>;

export const userStatusSchema = z.enum(['INVITED', 'ACTIVE', 'LOCKED', 'SUSPENDED', 'DEACTIVATED']);
export type UserStatusInput = z.infer<typeof userStatusSchema>;

export const invitationStatusSchema = z.enum(['PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED']);
export type InvitationStatusInput = z.infer<typeof invitationStatusSchema>;

/** `POST /auth/register` (identity.md §3 Organisation Registration, §10). */
export const registerOrganisationSchema = z.object({
  organisationName: z.string().trim().min(1).max(200),
  businessEmail: z.string().trim().email(),
  country: z.string().trim().min(1).max(100),
  adminFirstName: z.string().trim().min(1).max(100),
  adminLastName: z.string().trim().min(1).max(100),
  adminEmail: z.string().trim().email(),
  password: z.string().min(8).max(200),
});
export type RegisterOrganisationInput = z.infer<typeof registerOrganisationSchema>;

/**
 * `PATCH /api/organisation/me` (Sprint 2.1 brief — MVP field set only; supersedes the
 * unused Sprint 1B.1 draft of this schema, which had no controller consumer yet). Field
 * names match the sprint's wire contract exactly (`organisationName`, `phoneNumber`,
 * `addressLine`, `timezone`) — the Organisation Controller maps these to their underlying
 * Prisma column names (`name`, `phone`, `addressLine1`, `timeZone`). Read-only fields
 * (`id`, `organisationCode`, `slug`, `createdAt`, `updatedAt`) are deliberately absent.
 */
export const updateOrganisationProfileSchema = z.object({
  organisationName: z.string().trim().min(1).max(200).optional(),
  displayName: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).optional(),
  email: z.string().trim().email().optional(),
  phoneNumber: z.string().trim().min(7).max(30).optional(),
  website: z.string().trim().url().optional(),
  country: z.string().trim().min(2).max(100).optional(),
  state: z.string().trim().min(2).max(100).optional(),
  city: z.string().trim().min(1).max(100).optional(),
  addressLine: z.string().trim().max(200).optional(),
  industry: z.string().trim().max(100).optional(),
  currency: z.string().trim().length(3).optional(),
  timezone: z.string().trim().min(1).max(100).optional(),
});
export type UpdateOrganisationProfileInput = z.infer<typeof updateOrganisationProfileSchema>;

/** `POST /auth/login` (identity.md §10). */
export const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof loginSchema>;

/** `POST /auth/refresh` (identity.md §10). */
export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1),
});
export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>;

/** `POST /auth/password/forgot` (identity.md §10). */
export const forgotPasswordSchema = z.object({
  email: z.string().trim().email(),
});
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

/** `POST /auth/password/reset` (identity.md §10). */
export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8).max(200),
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

/** `PATCH /users/:id` (identity.md §10, employeeCode added Sprint 1A.1). */
export const updateUserProfileSchema = z.object({
  firstName: z.string().trim().min(1).max(100).optional(),
  lastName: z.string().trim().min(1).max(100).optional(),
  employeeCode: z.string().trim().max(50).optional(),
});
export type UpdateUserProfileInput = z.infer<typeof updateUserProfileSchema>;

/** `PATCH /users/:id/status` (identity.md §10, LOCKED added Sprint 1A.1). `INVITED` is
 *  deliberately excluded — only reached via invitation acceptance, never set directly. */
export const updateUserStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'LOCKED', 'SUSPENDED', 'DEACTIVATED']),
});
export type UpdateUserStatusInput = z.infer<typeof updateUserStatusSchema>;

/** `POST /invitations` (identity.md §10). */
export const createInvitationSchema = z.object({
  email: z.string().trim().email(),
  roleId: z.string().min(1),
});
export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;

/** `POST /invitations/:token/accept` (identity.md §10). */
export const acceptInvitationSchema = z.object({
  password: z.string().min(8).max(200),
});
export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;

/**
 * `POST /auth/invitations/accept` (Sprint 1B.2 brief — flat endpoint, token in the body
 * rather than the URL). Extends {@link acceptInvitationSchema} rather than duplicating it.
 *
 * Adds `token` (identity.md's version took it from the URL path) and `firstName`/
 * `lastName`: identity.md's `Invitation` entity carries only `email` + `roleId`, with no
 * name fields, so the new User row (which requires them, §9) has nowhere else to get them
 * from — see docs/sprint-1B.2-completion-report.md "Deviations".
 */
export const acceptInvitationWithTokenSchema = acceptInvitationSchema.extend({
  token: z.string().min(1),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
});
export type AcceptInvitationWithTokenInput = z.infer<typeof acceptInvitationWithTokenSchema>;

/** `POST /roles` (identity.md §10). */
export const createRoleSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).optional(),
  permissionKeys: z.array(z.string()).default([]),
});
export type CreateRoleInput = z.infer<typeof createRoleSchema>;

/** `PATCH /roles/:id` (identity.md §10). */
export const updateRoleSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().trim().max(500).optional(),
  permissionKeys: z.array(z.string()).optional(),
});
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;

/** `POST /users/:id/roles` (identity.md §10). */
export const assignRoleSchema = z.object({
  roleId: z.string().min(1),
});
export type AssignRoleInput = z.infer<typeof assignRoleSchema>;
