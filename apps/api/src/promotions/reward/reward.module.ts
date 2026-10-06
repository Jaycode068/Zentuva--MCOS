import { Module } from '@nestjs/common';

import { ConsumerModule } from '../../d2c/consumer/consumer.module';
import { AuthModule } from '../../identity/auth/auth.module';
import { IdentityModule } from '../../identity/identity.module';
import { SalesModule } from '../../sales/sales.module';
import { LoyaltyModule } from '../loyalty/loyalty.module';
import { PromotionModule } from '../promotion/promotion.module';
import { PromotionEvaluationService } from './promotion-evaluation.service';
import { RewardController } from './reward.controller';
import { RewardGrantRepository } from './reward-grant.repository';
import { RewardGrantService } from './reward-grant.service';

/**
 * Sprint 40 — Configurable Promotions, Loyalty, Rewards & Consumer Incentives
 * (docs/domains/d2c.md). The module that ties Promotion (what qualifies) and Loyalty
 * (what a BONUS_POINTS benefit actually does) together — imports `PromotionModule`
 * (`PromotionRepository`, read-only, for evaluation), `LoyaltyModule` (so
 * `RewardGrantRepository` can import the plain `applyLoyaltyDelta` utility function —
 * never the Loyalty module's own injected service, since the loyalty write must
 * participate in THIS module's own transaction), `SalesModule`
 * (`SalesOrderService` — the EXISTING D2C order, the qualifying-event source), and
 * `ConsumerModule` (`ConsumerService`). Exports `PromotionEvaluationService` so
 * `D2CPaymentModule` can call it right alongside `CollectionPointFulfillmentService
 * .autoAssign()` — the exact same "best-effort, never fails the webhook" integration
 * shape.
 */
@Module({
  imports: [
    IdentityModule,
    AuthModule,
    PromotionModule,
    LoyaltyModule,
    SalesModule,
    ConsumerModule,
  ],
  controllers: [RewardController],
  providers: [RewardGrantRepository, RewardGrantService, PromotionEvaluationService],
  exports: [PromotionEvaluationService, RewardGrantRepository, RewardGrantService],
})
export class RewardModule {}
