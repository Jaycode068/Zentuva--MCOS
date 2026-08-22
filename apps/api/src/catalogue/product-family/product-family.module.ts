import { Module } from '@nestjs/common';

import { AuthModule } from '../../identity/auth/auth.module';
import { IdentityModule } from '../../identity/identity.module';
import { ProductFamilyController } from './product-family.controller';
import { ProductFamilyRepository } from './product-family.repository';
import { ProductFamilyService } from './product-family.service';

/**
 * Product Family HTTP surface (Sprint 4.7, docs/domains/catalogue.md). Imports
 * `IdentityModule` for `AuditService`/`RoleService` (the latter needed by `RolesGuard`)
 * and `AuthModule` for `JwtAuthGuard`/`RolesGuard` — same shape as `ProductModule`.
 *
 * Exports `ProductFamilyRepository` so `ProductVariantModule` can validate a variant's
 * `productFamilyId` without duplicating Prisma access.
 */
@Module({
  imports: [IdentityModule, AuthModule],
  controllers: [ProductFamilyController],
  providers: [ProductFamilyRepository, ProductFamilyService],
  exports: [ProductFamilyRepository],
})
export class ProductFamilyModule {}
