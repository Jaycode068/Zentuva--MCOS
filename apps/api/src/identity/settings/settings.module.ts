import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { IdentityModule } from '../identity.module';
import { SettingsController } from './settings.controller';

/**
 * Workspace Configuration surface (Sprint 3.4). Imports `IdentityModule` for
 * `OrganisationService`/`AuditService` and `AuthModule` for `JwtAuthGuard`/`RolesGuard` —
 * same shape as `OrganisationModule` (Sprint 2.1).
 */
@Module({
  imports: [IdentityModule, AuthModule],
  controllers: [SettingsController],
})
export class SettingsModule {}
