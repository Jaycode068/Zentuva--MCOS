import { Module } from '@nestjs/common';

import { AuthModule } from '../../identity/auth/auth.module';
import { IdentityModule } from '../../identity/identity.module';
import { SupplierController } from './supplier.controller';
import { SupplierRepository } from './supplier.repository';
import { SupplierService } from './supplier.service';

/**
 * Supplier Management HTTP surface (Sprint 4.2). Imports `IdentityModule` for
 * `AuditService`/`RoleService` (the latter needed by `RolesGuard`) and `AuthModule` for
 * `JwtAuthGuard`/`RolesGuard` — same shape as `ProductModule`, minus `FileStorageModule`
 * since Supplier has no image/file field.
 */
@Module({
  imports: [IdentityModule, AuthModule],
  controllers: [SupplierController],
  providers: [SupplierRepository, SupplierService],
})
export class SupplierModule {}
