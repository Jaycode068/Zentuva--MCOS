import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { IdentityModule } from '../identity.module';
import { OrganisationController } from './organisation.controller';

/**
 * Organisation Management HTTP surface (Sprint 2.1). Imports IdentityModule for
 * OrganisationService/AuditService/RoleService (used by RolesGuard), and AuthModule for
 * the DI-managed JwtAuthGuard/RolesGuard instances it exports.
 */
@Module({
  imports: [IdentityModule, AuthModule],
  controllers: [OrganisationController],
})
export class OrganisationModule {}
