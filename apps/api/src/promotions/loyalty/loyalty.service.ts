import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { LoyaltyLedgerEntry } from '@prisma/client';
import { LoyaltyAdjustmentInput } from '@zentuva/validation';

import { ConsumerService } from '../../d2c/consumer/consumer.service';
import { LoyaltyAccountRepository, LoyaltyAccountWithConsumer } from './loyalty-account.repository';
import { LoyaltyLedgerRepository } from './loyalty-ledger.repository';

/**
 * Sprint 40 — Configurable Promotions, Loyalty, Rewards & Consumer Incentives
 * (docs/domains/d2c.md). Loyalty points are ONE benefit type (`PromotionBenefitType
 * .BONUS_POINTS`), never the whole promotion architecture — this service's own job stays
 * narrow: read a consumer's account/ledger, and apply the one administrative mutation
 * (a reasoned adjustment). Earning points from a qualifying promotion is NOT a method
 * here — that atomic grant-plus-earn write lives on `RewardGrantRepository
 * .createWithEarn` (it must be transactionally atomic with the `ConsumerRewardGrant` row,
 * which this service has no reason to know about).
 */
@Injectable()
export class LoyaltyService {
  constructor(
    private readonly loyaltyAccountRepository: LoyaltyAccountRepository,
    private readonly loyaltyLedgerRepository: LoyaltyLedgerRepository,
    private readonly consumerService: ConsumerService,
  ) {}

  /** `null` is a normal, expected result — most consumers have never earned anything yet
   *  (an account is created lazily on first EARN, never at consumer registration). */
  getAccount(
    organisationId: string,
    consumerId: string,
  ): Promise<LoyaltyAccountWithConsumer | null> {
    return this.loyaltyAccountRepository.findByConsumerId(organisationId, consumerId);
  }

  listAccounts(
    organisationId: string,
    params: { search?: string; page: number; pageSize: number },
  ): Promise<{ items: LoyaltyAccountWithConsumer[]; total: number }> {
    return this.loyaltyAccountRepository.findManyPaginated(organisationId, params);
  }

  listLedger(
    organisationId: string,
    consumerId: string,
    params: { page: number; pageSize: number },
  ): Promise<{ items: LoyaltyLedgerEntry[]; total: number }> {
    return this.loyaltyLedgerRepository.findManyByConsumer(organisationId, consumerId, params);
  }

  /** `POST .../adjustments` — `reason` is required at the schema level already
   *  (`loyaltyAdjustmentSchema`); this method's own job is the business-rule check
   *  (consumer exists, tenant-scoped) and translating the repository's `null`
   *  (insufficient balance for a debit) into a specific, actionable error. */
  async adjust(
    organisationId: string,
    consumerId: string,
    input: LoyaltyAdjustmentInput,
    actorUserId: string,
  ): Promise<LoyaltyLedgerEntry> {
    const consumer = await this.consumerService.getById(organisationId, consumerId);
    if (!consumer) {
      throw new NotFoundException('Consumer not found');
    }
    const entry = await this.loyaltyLedgerRepository.applyAdjustment({
      organisationId,
      consumerId,
      amount: input.amount,
      reason: input.reason,
      actorUserId,
    });
    if (!entry) {
      throw new BadRequestException('This adjustment would take the consumer below a zero balance');
    }
    return entry;
  }
}
