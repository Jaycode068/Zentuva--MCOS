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

  /** Added Sprint 40.5 — the WhatsApp inbound adapter's only way to recover
   *  which `BUTTONS`/`LIST` options were last presented (its own outbound
   *  `ConversationOutboundResponse`, persisted verbatim as `payload` by
   *  `ConversationService.handleInboundMessage`), so a plain-text WhatsApp
   *  reply like "1" or "Register" can be translated back into the correct
   *  `{type:'BUTTON', value}` input — real WhatsApp text messages carry no
   *  structured option value on their own. */
  findLastOutbound(
    organisationId: string,
    conversationId: string,
  ): Promise<ConsumerConversationMessage | null> {
    return this.prisma.consumerConversationMessage.findFirst({
      where: { organisationId, conversationId, direction: 'OUTBOUND' },
      orderBy: { createdAt: 'desc' },
    });
  }
}
