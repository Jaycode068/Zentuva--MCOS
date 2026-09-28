import { Injectable } from '@nestjs/common';
import { ConsumerConversationMessage, ConversationMessageDirection, Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

/**
 * Thin Prisma access for the `ConsumerConversationMessage` aggregate
 * (Sprint 33, docs/domains/d2c.md §"Conversation History"). No business
 * logic — see `ConversationService`. Append-only: no `update`/`delete`
 * method exists, matching the model's own "immutable debug trail" doc
 * comment.
 */
@Injectable()
export class ConversationMessageRepository {
  constructor(private readonly prisma: PrismaService) {}

  append(
    organisationId: string,
    conversationId: string,
    direction: ConversationMessageDirection,
    payload: unknown,
  ): Promise<ConsumerConversationMessage> {
    return this.prisma.consumerConversationMessage.create({
      data: {
        organisationId,
        conversationId,
        direction,
        payload: payload as Prisma.InputJsonValue,
      },
    });
  }

  listByConversation(
    organisationId: string,
    conversationId: string,
  ): Promise<ConsumerConversationMessage[]> {
    return this.prisma.consumerConversationMessage.findMany({
      where: { organisationId, conversationId },
      orderBy: { createdAt: 'asc' },
    });
  }
}
