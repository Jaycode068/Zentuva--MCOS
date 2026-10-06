import { Module } from '@nestjs/common';

import { ConsumerModule } from '../../d2c/consumer/consumer.module';
import { AuthModule } from '../../identity/auth/auth.module';
import { IdentityModule } from '../../identity/identity.module';
import { LoyaltyAccountRepository } from './loyalty-account.repository';
import { LoyaltyLedgerRepository } from './loyalty-ledger.repository';
import { LoyaltyController } from './loyalty.controller';
import { LoyaltyService } from './loyalty.service';

/**
 * Sprint 40 — Configurable Promotions, Loyalty, Rewards & Consumer Incentives
 * (docs/domains/d2c.md). Imports `ConsumerModule` (existence-checking a consumer before
 * an adjustment — the EXISTING `Consumer`, never a parallel identity). `AuthModule` for
 * `JwtAuthGuard`'s `TOKEN_SERVICE`, matching every other controller-bearing module.
 * Exports both repositories (never the raw Prisma client) so `RewardModule` can read
 * ledger/account state read-only, and so `applyLoyaltyDelta`
 * (`loyalty-ledger-concurrency.util.ts`) can be imported directly as a plain function by
 * `RewardGrantRepository` — a shared primitive, not a cross-module service call, the
 * exact same shape `inventory-stock-concurrency.util.ts`'s exports already establish.
 */
@Module({
  imports: [IdentityModule, AuthModule, ConsumerModule],
  controllers: [LoyaltyController],
  providers: [LoyaltyAccountRepository, LoyaltyLedgerRepository, LoyaltyService],
  exports: [LoyaltyAccountRepository, LoyaltyLedgerRepository, LoyaltyService],
})
export class LoyaltyModule {}
