import { Injectable } from '@nestjs/common';
import {
  ConsumerConversation,
  ConversationChannel,
  ConversationState,
  Prisma,
} from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

/**
 * Thin Prisma access for the `ConsumerConversation` aggregate (Sprint 33,
 * docs/domains/d2c.md). No business logic — see `ConversationService`.
 *
 * Tenant-safety convention (matches every other repository in this
 * codebase): every method that reads or writes a specific conversation
 * takes `organisationId` and includes it in the query.
 */
@Injectable()
export class ConversationRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(organisationId: string, id: string): Promise<ConsumerConversation | null> {
    return this.prisma.consumerConversation.findFirst({ where: { id, organisationId } });
  }

  findByExternalId(
    organisationId: string,
    channel: ConversationChannel,
    externalConversationId: string,
  ): Promise<ConsumerConversation | null> {
    return this.prisma.consumerConversation.findFirst({
      where: { organisationId, channel, externalConversationId },
    });
  }

  /** Idempotent find-or-create by `[organisationId, channel,
   *  externalConversationId]` — the exact `ConsumerRepository.findOrCreate`/
   *  `CandidateRepository.findOrCreate` recipe (Sprint 30/32): check, then
   *  create, and on a `P2002` race, re-fetch and return the winner. Two
   *  genuinely simultaneous first messages from the same phone number
   *  converge on exactly one `ConsumerConversation` row, never a duplicate
   *  (brief §19 "Idempotency and Repeated Messages"). */
  async findOrCreate(
    organisationId: string,
    channel: ConversationChannel,
    externalConversationId: string,
  ): Promise<{ conversation: ConsumerConversation; created: boolean }> {
    const existing = await this.findByExternalId(organisationId, channel, externalConversationId);
    if (existing) {
      return { conversation: existing, created: false };
    }
    try {
      const conversation = await this.prisma.consumerConversation.create({
        data: { organisationId, channel, externalConversationId },
      });
      return { conversation, created: true };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === UNIQUE_CONSTRAINT_VIOLATION
      ) {
        const raced = await this.findByExternalId(organisationId, channel, externalConversationId);
        if (raced) {
          return { conversation: raced, created: false };
        }
      }
      throw error;
    }
  }

  list(organisationId: string, params: { status?: string } = {}): Promise<ConsumerConversation[]> {
    return this.prisma.consumerConversation.findMany({
      where: {
        organisationId,
        ...(params.status ? { status: params.status as never } : {}),
      },
      orderBy: { lastInteractionAt: 'desc' },
      take: 50,
    });
  }

  async update(
    organisationId: string,
    id: string,
    data: Prisma.ConsumerConversationUncheckedUpdateInput,
  ): Promise<ConsumerConversation | null> {
    const result = await this.prisma.consumerConversation.updateMany({
      where: { id, organisationId },
      data: { ...data, lastInteractionAt: new Date() },
    });
    if (result.count === 0) {
      return null;
    }
    return this.prisma.consumerConversation.findUniqueOrThrow({ where: { id } });
  }

  /** Resets an existing conversation back to a clean interaction state
   *  without losing its identity/consumer link (brief §20 "Session
   *  Expiration / Reset" — `MENU`/`START OVER`). */
  async reset(
    organisationId: string,
    id: string,
    state: ConversationState,
  ): Promise<ConsumerConversation | null> {
    return this.update(organisationId, id, { state, context: Prisma.JsonNull });
  }
}
