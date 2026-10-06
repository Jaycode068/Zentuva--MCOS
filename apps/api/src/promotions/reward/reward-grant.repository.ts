import { Injectable } from '@nestjs/common';
import {
  ConsumerRewardGrant,
  Prisma,
  PromotionBenefitType,
  RewardGrantStatus,
} from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { applyLoyaltyDelta } from '../loyalty/loyalty-ledger-concurrency.util';

export interface CreateGrantData {
  organisationId: string;
  consumerId: string;
  promotionId: string;
  qualifyingSalesOrderId: string;
  promotionNameSnapshot: string;
  benefitTypeSnapshot: PromotionBenefitType;
  pointsAwardedSnapshot: number | null;
  freeProductIdSnapshot: string | null;
  freeProductQuantitySnapshot: number | null;
  conditionsSnapshot: Prisma.InputJsonValue;
}

export type ConsumerRewardGrantWithRelations = ConsumerRewardGrant & {
  consumer: { id: string; consumerCode: string; fullName: string };
  promotion: { id: string; name: string };
  qualifyingSalesOrder: { id: string; orderCode: string };
};

const RELATIONS_INCLUDE = {
  consumer: { select: { id: true, consumerCode: true, fullName: true } },
  promotion: { select: { id: true, name: true } },
  qualifyingSalesOrder: { select: { id: true, orderCode: true } },
};

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

/**
 * Thin Prisma access for the `ConsumerRewardGrant` aggregate (Sprint 40,
 * docs/domains/d2c.md). `createWithEarn` is the ONE write method here that matters for
 * correctness — see its own doc comment for the exact idempotency/concurrency
 * guarantee. Every other method is a plain tenant-scoped read.
 */
@Injectable()
export class RewardGrantRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The atomic "grant plus (for `BONUS_POINTS`) earn" write (docs/domains/d2c.md
   * "Idempotency and Duplicate Reward Prevention" / "Concurrency Requirements").
   *
   * The whole operation — the `ConsumerRewardGrant` insert AND, for a `BONUS_POINTS`
   * benefit, the `LoyaltyAccount.balance` increment and the paired `LoyaltyLedgerEntry`
   * insert — runs inside ONE `$transaction`, so it either all commits together or all
   * rolls back together; a `FREE_PRODUCT` grant is left `PENDING_FULFILLMENT` with no
   * further write this sprint.
   *
   * Idempotency/the "once per consumer per promotion" limit (docs/domains/d2c.md
   * "Reward Limits") are BOTH the `@@unique([organisationId, promotionId, consumerId])`
   * constraint on `ConsumerRewardGrant` — never a bare `if (!exists) create()`, which two
   * concurrent requests can both pass. A genuine race (two near-simultaneous qualifying
   * events for the same consumer+promotion) means ONE transaction's `create()` succeeds;
   * the other's throws a Postgres unique-violation, which ABORTS that transaction
   * (Postgres poisons a transaction after any real SQL error — this is why the
   * try/catch is OUTSIDE the `$transaction` call, not inside it: catching inside would
   * attempt further queries against an already-aborted transaction and fail again).
   * After the failed transaction rolls back cleanly (including any ledger entry it never
   * actually committed), this method re-fetches the winner OUTSIDE that transaction and
   * returns it with `wasCreated: false` — the same check-then-create-with-race-recovery
   * shape `ConsumerRepository.findOrCreate`/`PaymentRepository
   * .createPendingForConsumer` already establish, extended here to a genuinely
   * multi-table atomic write.
   */
  async createWithEarn(
    data: CreateGrantData,
  ): Promise<{ grant: ConsumerRewardGrantWithRelations; wasCreated: boolean }> {
    try {
      const grant = await this.prisma.$transaction(async (tx) => {
        const created = await tx.consumerRewardGrant.create({
          data: {
            organisationId: data.organisationId,
            consumerId: data.consumerId,
            promotionId: data.promotionId,
            qualifyingSalesOrderId: data.qualifyingSalesOrderId,
            promotionNameSnapshot: data.promotionNameSnapshot,
            benefitTypeSnapshot: data.benefitTypeSnapshot,
            pointsAwardedSnapshot: data.pointsAwardedSnapshot,
            freeProductIdSnapshot: data.freeProductIdSnapshot,
            freeProductQuantitySnapshot: data.freeProductQuantitySnapshot,
            conditionsSnapshot: data.conditionsSnapshot,
            status:
              data.benefitTypeSnapshot === PromotionBenefitType.FREE_PRODUCT
                ? RewardGrantStatus.PENDING_FULFILLMENT
                : RewardGrantStatus.GRANTED,
          },
        });

        if (
          data.benefitTypeSnapshot === PromotionBenefitType.BONUS_POINTS &&
          data.pointsAwardedSnapshot
        ) {
          const account = await applyLoyaltyDelta(
            tx,
            data.organisationId,
            data.consumerId,
            data.pointsAwardedSnapshot,
          );
          // `applyLoyaltyDelta` only ever returns `null` for a NEGATIVE delta guarded
          // against going below zero — a points EARN is always positive, so this is
          // unreachable in practice; narrowed defensively rather than asserted away.
          if (account) {
            await tx.loyaltyLedgerEntry.create({
              data: {
                organisationId: data.organisationId,
                loyaltyAccountId: account.id,
                consumerId: data.consumerId,
                type: 'EARN',
                amount: data.pointsAwardedSnapshot,
                balanceAfter: account.balance,
                rewardGrantId: created.id,
              },
            });
          }
        }

        return created;
      });

      const withRelations = await this.prisma.consumerRewardGrant.findUniqueOrThrow({
        where: { id: grant.id },
        include: RELATIONS_INCLUDE,
      });
      return { grant: withRelations, wasCreated: true };
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        const existing = await this.prisma.consumerRewardGrant.findUnique({
          where: {
            organisationId_promotionId_consumerId: {
              organisationId: data.organisationId,
              promotionId: data.promotionId,
              consumerId: data.consumerId,
            },
          },
          include: RELATIONS_INCLUDE,
        });
        if (existing) {
          return { grant: existing, wasCreated: false };
        }
      }
      throw error;
    }
  }

  findById(organisationId: string, id: string): Promise<ConsumerRewardGrantWithRelations | null> {
    return this.prisma.consumerRewardGrant.findFirst({
      where: { id, organisationId },
      include: RELATIONS_INCLUDE,
    });
  }

  async findManyByConsumer(
    organisationId: string,
    consumerId: string,
    params: { page: number; pageSize: number },
  ): Promise<{ items: ConsumerRewardGrantWithRelations[]; total: number }> {
    const where = { organisationId, consumerId };
    const [items, total] = await Promise.all([
      this.prisma.consumerRewardGrant.findMany({
        where,
        include: RELATIONS_INCLUDE,
        orderBy: { grantedAt: 'desc' },
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
      }),
      this.prisma.consumerRewardGrant.count({ where }),
    ]);
    return { items, total };
  }

  async findManyPaginated(
    organisationId: string,
    params: { promotionId?: string; page: number; pageSize: number },
  ): Promise<{ items: ConsumerRewardGrantWithRelations[]; total: number }> {
    const where = {
      organisationId,
      ...(params.promotionId ? { promotionId: params.promotionId } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.consumerRewardGrant.findMany({
        where,
        include: RELATIONS_INCLUDE,
        orderBy: { grantedAt: 'desc' },
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
      }),
      this.prisma.consumerRewardGrant.count({ where }),
    ]);
    return { items, total };
  }
}

function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === UNIQUE_CONSTRAINT_VIOLATION
  );
}
