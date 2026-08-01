import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { IdentityModule } from '../identity.module';
import { AccountController } from './account.controller';

/**
 * The "My Account" surface (Sprint 3.3): profile, change-password, and session
 * management for the authenticated caller's own account. Imports `AuthModule` for
 * `AuthService`/`JwtAuthGuard` and `IdentityModule` for `UserService`/`OrganisationService`/
 * `AuditService` — no new repositories or Prisma access of its own, per the brief's "reuse
 * existing services" constraint.
 */
@Module({
  imports: [AuthModule, IdentityModule],
  controllers: [AccountController],
})
export class AccountModule {}
