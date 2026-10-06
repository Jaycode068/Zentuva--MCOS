import { Injectable } from '@nestjs/common';
import { LoyaltyAccount } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

const CONSUMER_SELECT = { id: true, consumerCode: true, fullName: true };

export type LoyaltyAccountWithConsumer = LoyaltyAccount & {
  consumer: { id: string; consumerCode: string; fullName: string };
};

/**
 * Thin Prisma access for the `LoyaltyAccount` aggregate (Sprint 40, docs/domains/d2c.md).
 * No business logic, no balance mutation here — a balance change ALWAYS happens via
 * `applyLoyaltyDelta` (`loyalty-ledger-concurrency.util.ts`) inside the SAME transaction
 * as the `LoyaltyLedgerEntry` it pairs with, never as a standalone write on this
 * repository — see `RewardGrantRepository.createWithEarn`/`LoyaltyLedgerRepository
 * .applyAdjustment`.
 *
 * Tenant-safety convention (matches every other repository in this codebase): every
 * method that reads a specific account takes `organisationId` and includes it in the
 * query.
 */
@Injectable()
export class LoyaltyAccountRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByConsumerId(
    organisationId: string,
    consumerId: string,
  ): Promise<LoyaltyAccountWithConsumer | null> {
    return this.prisma.loyaltyAccount.findFirst({
      where: { organisationId, consumerId },
      include: { consumer: { select: CONSUMER_SELECT } },
    });
  }

  async findManyPaginated(
    organisationId: string,
    params: { search?: string; page: number; pageSize: number },
  ): Promise<{ items: LoyaltyAccountWithConsumer[]; total: number }> {
    const where = {
      organisationId,
      ...(params.search
        ? {
            consumer: {
              OR: [
                { fullName: { contains: params.search, mode: 'insensitive' as const } },
                { consumerCode: { contains: params.search, mode: 'insensitive' as const } },
              ],
            },
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.loyaltyAccount.findMany({
        where,
        include: { consumer: { select: CONSUMER_SELECT } },
        orderBy: { balance: 'desc' },
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
      }),
      this.prisma.loyaltyAccount.count({ where }),
    ]);
    return { items, total };
  }
}
