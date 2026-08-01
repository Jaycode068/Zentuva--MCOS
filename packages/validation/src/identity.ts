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

/**
 * `POST /api/auth/register` (Sprint 3.2 brief) — rewritten to match this sprint's exact
 * two-section form (Organisation Information + Owner Account); supersedes the Sprint
 * 1B.1 draft, which had no controller consumer yet (`adminFirstName`/`adminEmail` etc.
 * are renamed to `firstName`/`email` to match the Owner Account section's field names).
 *
 * Only `organisationName` is required in the brief's Organisation Information section;
 * `country` is additionally treated as required here because `Organisation.country` is a
 * non-nullable DB column with no sensible default — see
 * docs/sprint-3.2-completion-report.md "Deviations from Design."
 *
 * `confirmPassword` only exists to validate equality with `password` (see `.refine` below)
 * — it is never persisted. `acceptTerms` is `.refine()`d as required-true, but there is no
 * `acceptTerms` column anywhere (no schema change) — it's checked here and then dropped.
 */
export const registerOrganisationSchema = z
  .object({
    organisationName: z.string().trim().min(1).max(200),
    displayName: z.string().trim().min(1).max(200).optional(),
    industry: z.string().trim().max(100).optional(),
    country: z.string().trim().min(2).max(100),
    state: z.string().trim().max(100).optional(),
    city: z.string().trim().max(100).optional(),
    phoneNumber: z.string().trim().min(7).max(30).optional(),
    businessEmail: z.string().trim().email().optional(),
    website: z.string().trim().url().optional(),
    firstName: z.string().trim().min(1).max(100),
    lastName: z.string().trim().min(1).max(100),
    email: z.string().trim().email(),
    password: z.string().min(8).max(200),
    confirmPassword: z.string().min(8).max(200),
    acceptTerms: z.boolean(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })
  .refine((data) => data.acceptTerms === true, {
    message: 'You must accept the terms to continue',
    path: ['acceptTerms'],
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

/**
 * Shared password-strength policy (Sprint 3.3 brief §2: minimum length, uppercase,
 * lowercase, number, special character). Applied to both `changePasswordSchema` below and
 * `resetPasswordSchema` — a user setting a new password should face the same policy
 * whichever flow they came through. Registration's `registerOrganisationSchema` (Sprint
 * 3.2) is deliberately left untouched here, per this sprint's "do not redesign already
 * implemented authentication" constraint.
 */
export const strongPasswordSchema = z
  .string()
  .min(8, 'Must be at least 8 characters')
  .max(200)
  .regex(/[a-z]/, 'Must contain a lowercase letter')
  .regex(/[A-Z]/, 'Must contain an uppercase letter')
  .regex(/[0-9]/, 'Must contain a number')
  .regex(/[^A-Za-z0-9]/, 'Must contain a special character');

/** `POST /auth/password/reset` (identity.md §10). `newPassword` upgraded to
 *  {@link strongPasswordSchema} in Sprint 3.3 — see the note above. */
export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: strongPasswordSchema,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

/** `POST /api/account/change-password` (Sprint 3.3 brief §2). */
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: strongPasswordSchema,
    confirmPassword: z.string().min(1, 'Please confirm your new password'),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

/** `PATCH /api/account/profile` (Sprint 3.3 brief §1) — the authenticated user editing
 *  their own name/phone. Employee code, email, role, and organisation are read-only per
 *  the brief and deliberately absent here. */
export const updateAccountProfileSchema = z.object({
  firstName: z.string().trim().min(1).max(100).optional(),
  lastName: z.string().trim().min(1).max(100).optional(),
  phoneNumber: z.string().trim().min(7).max(30).optional(),
});
export type UpdateAccountProfileInput = z.infer<typeof updateAccountProfileSchema>;

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

/** Wire-level status values for User Management (Sprint 2.2) — a simplified 3-value view
 *  over the DB's 5-value `UserStatus` enum. The controller maps `ACTIVE` -> `ACTIVE`,
 *  `INACTIVE` -> `SUSPENDED` (reversible deactivation — matches identity.md §4's
 *  `SUSPENDED` semantics, unlike `DEACTIVATED` which is documented as terminal/
 *  irreversible there), `LOCKED` -> `LOCKED`. `INVITED`/`DEACTIVATED` aren't reachable
 *  through this sprint's endpoints. */
export const userManagementStatusSchema = z.enum(['ACTIVE', 'INACTIVE', 'LOCKED']);
export type UserManagementStatusInput = z.infer<typeof userManagementStatusSchema>;

/** System role names assignable via User Management (Sprint 2.2). Custom roles are out of
 *  scope this sprint (no role-listing endpoint exists yet either), so `role` is
 *  constrained to the three seeded system roles rather than an arbitrary `roleId`. */
export const systemRoleNameSchema = z.enum(['Owner', 'Administrator', 'Member']);
export type SystemRoleNameInput = z.infer<typeof systemRoleNameSchema>;

/** `POST /api/users` (Sprint 2.2). */
export const createUserSchema = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  email: z.string().trim().email(),
  employeeCode: z.string().trim().max(50).optional(),
  role: systemRoleNameSchema,
  temporaryPassword: z.string().min(8).max(200),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

/**
 * `PATCH /api/users/:id` (Sprint 2.2) — one combined endpoint for profile, role, and
 * status, unlike identity.md §10's original two-endpoint sketch (`PATCH /users/:id` +
 * `PATCH /users/:id/status`). Immutable fields (`id`, `email`, `organisationId`) are
 * deliberately absent.
 */
export const updateUserSchema = z.object({
  firstName: z.string().trim().min(1).max(100).optional(),
  lastName: z.string().trim().min(1).max(100).optional(),
  employeeCode: z.string().trim().max(50).optional(),
  role: systemRoleNameSchema.optional(),
  status: userManagementStatusSchema.optional(),
});
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

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
