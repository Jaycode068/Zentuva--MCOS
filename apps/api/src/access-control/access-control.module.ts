import { Module } from '@nestjs/common';

import { AuthModule } from '../identity/auth/auth.module';
import { IdentityModule } from '../identity/identity.module';
import { HrModule } from '../hr/hr.module';
import { AccessAuditLogController } from './access-audit-log.controller';
import { AccessCommonPolicyController } from './access-common-policy.controller';
import { AccessOverviewController } from './access-overview.controller';
import { AccessRoleController } from './access-role.controller';
import { AccessUserController } from './access-user.controller';
import { AccessUserService } from './access-user.service';

/**
 * Access Control domain module (Sprint 25, docs/domains/access-control.md) — the
 * `assets/`/`maintenance/`/`hr/` "one umbrella module per top-level directory"
 * convention, applied to the administration layer over Identity's Role/Permission/
 * UserRole aggregate and the new `EffectiveAccessResolver`/`ScopeEvaluator`.
 *
 * Imports `IdentityModule` (`RoleService`, `UserService`, `OrganisationService`,
 * `AuditService`) and `AuthModule` (guards — `PermissionsGuard` itself, plus its
 * `EffectiveAccessResolver`/`ScopeEvaluator` dependencies, re-exported by AuthModule for
 * exactly this reason). Also imports `HrModule` — the one deliberate, documented
 * exception to "no domain imports HR" (see hr.module.ts's own doc comment): this
 * module's administration UI needs to display an employee's department/position/
 * manager/employment-status alongside their access, per the brief's explicit
 * requirement (access-control.md §8). Read-only — this module never writes to any
 * `hr_*` table; every write here targets `roles`/`role_permissions`/`user_roles`/
 * `permissions` (Identity's own tables) or `Organisation.settings` (the common-access
 * policy), proven by `access-control-independence.spec.ts`.
 *
 * `EffectiveAccessResolver`/`ScopeEvaluator`/`PermissionsGuard`/`RoleService`/
 * `UserService`/`OrganisationService`/`AuditService` are all already providers of
 * `IdentityModule`/`AuthModule` — this module declares no repositories of its own; it is
 * pure composition over the existing Identity domain layer plus one small new service
 * (`AccessUserService`) for the User Access admin view.
 */
@Module({
  imports: [IdentityModule, AuthModule, HrModule],
  controllers: [
    AccessOverviewController,
    AccessRoleController,
    AccessUserController,
    AccessCommonPolicyController,
    AccessAuditLogController,
  ],
  providers: [AccessUserService],
})
export class AccessControlModule {}
