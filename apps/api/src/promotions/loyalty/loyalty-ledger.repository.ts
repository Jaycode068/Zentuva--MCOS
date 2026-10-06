import { Injectable } from '@nestjs/common';
import { LoyaltyLedgerEntry } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { applyLoyaltyDelta } from './loyalty-ledger-concurrency.util';

export interface ApplyAdjustmentData {
  organisationId: string;
  consumerId: string;
  /** Signed — positive credits, negative debits. */
  amount: number;
  reason: string;
  actorUserId: string;
}

/**
 * Thin Prisma access for the `LoyaltyLedgerEntry` aggregate (Sprint 40,
 * docs/domains/d2c.md). Append-only — no update/delete method exists anywhere in this
 * file or its service, enforced structurally by `promotions-independence.spec.ts`. The
 * `EARN` write path lives on `RewardGrantRepository.createWithEarn` instead (it must be
 * atomic with the `ConsumerRewardGrant` row it pairs with); this repository owns only the
 * `ADJUSTMENT` path and read access.
 */
@Injectable()
export class LoyaltyLedgerRepository {
  constructor(private readonly prisma: PrismaService) {}

  findManyByConsumer(
    organisationId: string,
    consumerId: string,
    params: { page: number; pageSize: number },
  ): Promise<{ items: LoyaltyLedgerEntry[]; total: number }> {
    const where = { organisationId, consumerId };
    return Promise.all([
      this.prisma.loyaltyLedgerEntry.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
      }),
      this.prisma.loyaltyLedgerEntry.count({ where }),
    ]).then(([items, total]) => ({ items, total }));
  }

  /**
   * The one administrative mutation on the ledger (brief §20) — `reason`/`actorUserId`
   * are always required at the type level (never optional, unlike the system-triggered
   * `EARN` path). Returns `null` when a negative `amount` would take the balance below
   * zero (`applyLoyaltyDelta`'s own guard) — the caller turns that into a 400, never
   * silently clamping or overwriting the balance.
   */
  async applyAdjustment(data: ApplyAdjustmentData): Promise<LoyaltyLedgerEntry | null> {
    return this.prisma.$transaction(async (tx) => {
      const account = await applyLoyaltyDelta(
        tx,
        data.organisationId,
        data.consumerId,
        data.amount,
      );
      if (!account) {
        return null;
      }
      return tx.loyaltyLedgerEntry.create({
        data: {
          organisationId: data.organisationId,
          loyaltyAccountId: account.id,
          consumerId: data.consumerId,
          type: 'ADJUSTMENT',
          amount: data.amount,
          balanceAfter: account.balance,
          reason: data.reason,
          actorUserId: data.actorUserId,
        },
      });
    });
  }
}
