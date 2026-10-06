import { Module } from '@nestjs/common';

import { ProductModule } from '../../catalogue/product/product.module';
import { AuthModule } from '../../identity/auth/auth.module';
import { IdentityModule } from '../../identity/identity.module';
import { TerritoryModule } from '../../retail/territory/territory.module';
import { PromotionController } from './promotion.controller';
import { PromotionRepository } from './promotion.repository';
import { PromotionService } from './promotion.service';

/**
 * Sprint 40 — Configurable Promotions, Loyalty, Rewards & Consumer Incentives
 * (docs/domains/d2c.md). Imports `ProductModule` (validating a `PRODUCT_QUANTITY`
 * condition's/`FREE_PRODUCT` benefit's `productId` belongs to this tenant — the EXISTING
 * catalogue SKU, never a parallel product reference) and `TerritoryModule` (validating a
 * `TERRITORY` condition's `territoryId` — the EXISTING hierarchy, Sprint 4.8/32). Exports
 * `PromotionRepository` (read-only) so `RewardModule` can read active/effective
 * promotions for evaluation without a second query mechanism.
 */
@Module({
  imports: [IdentityModule, AuthModule, ProductModule, TerritoryModule],
  controllers: [PromotionController],
  providers: [PromotionRepository, PromotionService],
  exports: [PromotionRepository, PromotionService],
})
export class PromotionModule {}
