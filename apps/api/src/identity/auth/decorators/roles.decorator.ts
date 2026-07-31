import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';

/**
 * Declares which role names may access a route, checked by {@link RolesGuard}.
 *
 * Sprint 2.1 brief: "a simple role-name check is sufficient... do not build permission
 * decorators / a permission engine / policy evaluation." This is deliberately that: a
 * role-name check, not a permission-key lookup against the Permission/RolePermission
 * catalog (identity.md §6) — that remains a future sprint's job.
 */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
