import { Module } from '@nestjs/common';

import { AuthModule } from '../../identity/auth/auth.module';
import { IdentityModule } from '../../identity/identity.module';
import { ProductFamilyModule } from '../product-family/product-family.module';
import { ProductVariantController } from './product-variant.controller';
import { ProductVariantRepository } from './product-variant.repository';
import { ProductVariantService } from './product-variant.service';

/**
 * Product Variant HTTP surface (Sprint 4.7, docs/domains/catalogue.md). Imports
 * `ProductFamilyModule` so `ProductVariantService` can inject `ProductFamilyRepository`
 * to validate a variant's `productFamilyId` belongs to the caller's own organisation —
 * same "import the module, inject its exported repository" pattern used everywhere else
 * in this codebase (e.g. `ProcurementModule` importing `ProductModule`).
 *
 * Exports `ProductVariantRepository` so `ProductModule` can inject it to validate a
 * product's `productVariantId` at create/update time.
 */
@Module({
  imports: [IdentityModule, AuthModule, ProductFamilyModule],
  controllers: [ProductVariantController],
  providers: [ProductVariantRepository, ProductVariantService],
  exports: [ProductVariantRepository],
})
export class ProductVariantModule {}
