import { Injectable } from '@nestjs/common';

import { ConsumerRewardGrantWithRelations, RewardGrantRepository } from './reward-grant.repository';

/**
 * Sprint 40 — read-only admin access to `ConsumerRewardGrant` (docs/domains/d2c.md
 * "Consumer Transparency" / "Admin Experience"). The actual grant-creation write lives
 * entirely on `PromotionEvaluationService`/`RewardGrantRepository.createWithEarn` — this
 * service exists only so `RewardController` has a thin layer to call rather than
 * injecting the repository directly, matching every other controller in this codebase.
 */
@Injectable()
export class RewardGrantService {
  constructor(private readonly rewardGrantRepository: RewardGrantRepository) {}

  listForConsumer(
    organisationId: string,
    consumerId: string,
    params: { page: number; pageSize: number },
  ): Promise<{ items: ConsumerRewardGrantWithRelations[]; total: number }> {
    return this.rewardGrantRepository.findManyByConsumer(organisationId, consumerId, params);
  }

  list(
    organisationId: string,
    params: { promotionId?: string; page: number; pageSize: number },
  ): Promise<{ items: ConsumerRewardGrantWithRelations[]; total: number }> {
    return this.rewardGrantRepository.findManyPaginated(organisationId, params);
  }
}
