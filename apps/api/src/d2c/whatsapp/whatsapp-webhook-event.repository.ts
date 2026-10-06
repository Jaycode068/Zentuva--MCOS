import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

/**
 * Thin Prisma access for the `WhatsAppWebhookEvent` dedup ledger (Sprint 40.5,
 * docs/domains/whatsapp.md). `tryClaim` is the ONLY mutation — a bare INSERT guarded by
 * the model's own unique constraint, never a bare "if not exists, create" pre-check
 * (which cannot survive two genuinely concurrent redeliveries of the same webhook) —
 * the exact `ConsumerRewardGrant`/`ConsumerRepository.findOrCreate` idempotency recipe
 * already established in Sprint 40/30, applied to a pure dedup ledger with no other
 * business row to roll back alongside it.
 */
@Injectable()
export class WhatsAppWebhookEventRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Returns `true` the first time this `externalMessageId` (Meta's WAMID) is seen,
   *  `false` on every redelivery of the same id — the caller treats `false` as
   *  "already processed, skip the business logic, still return 200." */
  async tryClaim(externalMessageId: string, kind: string): Promise<boolean> {
    try {
      await this.prisma.whatsAppWebhookEvent.create({ data: { externalMessageId, kind } });
      return true;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === UNIQUE_CONSTRAINT_VIOLATION
      ) {
        return false;
      }
      throw error;
    }
  }
}
