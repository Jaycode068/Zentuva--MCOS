import { Module } from '@nestjs/common';

import { AuthModule } from '../../identity/auth/auth.module';
import { IdentityModule } from '../../identity/identity.module';
import { FileStorageModule } from '../../identity/organisation/infrastructure/file-storage.module';
import { ProductController } from './product.controller';
import { ProductRepository } from './product.repository';
import { ProductService } from './product.service';

/**
 * Product Catalogue HTTP surface (Sprint 4.1). Imports `IdentityModule` for
 * `AuditService`/`RoleService` (the latter needed by `RolesGuard`) and `AuthModule` for
 * `JwtAuthGuard`/`RolesGuard` — same shape as `UserModule`/`SettingsModule`.
 * `FileStorageModule` is imported directly (not just transitively via `IdentityModule`,
 * which doesn't re-export it) so `ProductService` can inject `FILE_STORAGE` for product
 * image uploads, same as `IdentityModule` itself does for `OrganisationService`/
 * `UserService`.
 *
 * Exports `ProductRepository` so other domains can validate/read products without
 * duplicating Prisma access — first consumed by `ProcurementModule` (Sprint 4.3) to
 * enforce "only Raw Material/Packaging Material/Consumable products may be purchased."
 */
@Module({
  imports: [IdentityModule, AuthModule, FileStorageModule],
  controllers: [ProductController],
  providers: [ProductRepository, ProductService],
  exports: [ProductRepository],
})
export class ProductModule {}
