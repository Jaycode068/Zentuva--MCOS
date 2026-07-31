import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { IdentityModule } from '../identity.module';
import { UserController } from './user.controller';

/**
 * User Management HTTP surface (Sprint 2.2). Imports IdentityModule for UserService/
 * RoleService/AuditService, and AuthModule for the DI-managed JwtAuthGuard/RolesGuard
 * instances it exports — same pattern as OrganisationModule (Sprint 2.1).
 */
@Module({
  imports: [IdentityModule, AuthModule],
  controllers: [UserController],
})
export class UserModule {}
