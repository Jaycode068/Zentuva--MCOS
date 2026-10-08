import { Controller, Get, NotFoundException, Param, Post, Body, UseGuards } from '@nestjs/common';
import { ConsumerConversation, ConsumerConversationMessage } from '@prisma/client';
import { SendConversationMessageInput, sendConversationMessageSchema } from '@zentuva/validation';

import { ZodValidationPipe } from '../../identity/auth/common/zod-validation.pipe';
import { CurrentUser } from '../../identity/auth/decorators/current-user.decorator';
import { RequirePermission } from '../../identity/auth/decorators/require-permission.decorator';
import { JwtAuthGuard } from '../../identity/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../identity/auth/guards/permissions.guard';
import { TokenPayload } from '../../identity/auth/ports/token.port';
import { ConversationMessageRepository } from './conversation-message.repository';
import { ConversationRepository } from './conversation.repository';
import { ConversationService } from './conversation.service';

/**
 * Consumer Conversation HTTP surface (Sprint 33, docs/domains/d2c.md
 * §"Public Security"). Deliberately INTERNAL/AUTHENTICATED ONLY — brief §22
 * explicitly prefers this over an ordinary unauthenticated public endpoint
 * when no real channel adapter exists yet to receive one. This IS the
 * internal test harness surface (docs/domains/d2c.md §"Internal Test
 * Interface"), not a public webhook — there is no real WhatsApp webhook in
 * this sprint, so there is nothing yet that needs to call this
 * unauthenticated.
 *
 * Reuses the EXISTING `d2c.consumer.*` permissions rather than introducing
 * a new `d2c.conversation.*` pair — driving a conversation ultimately
 * reads/mutates `Consumer` data, the same administrative capability
 * `ConsumerController` already gates, so a second permission pair would be
 * redundant, not "genuinely required" (Sprint 32's own bar for adding one).
 *
 * `organisationId` is ALWAYS taken from the authenticated caller's own
 * token — never accepted in the request body — matching every other
 * internal controller in this codebase and directly satisfying brief §22's
 * "do not trust organisationId from an arbitrary client."
 */
@Controller('d2c/conversations')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ConversationController {
  constructor(
    private readonly conversationService: ConversationService,
    private readonly conversationRepository: ConversationRepository,
    private readonly messageRepository: ConversationMessageRepository,
  ) {}

  @Get()
  @RequirePermission('d2c.consumer.view')
  async list(@CurrentUser() user: TokenPayload) {
    const conversations = await this.conversationRepository.list(user.organisationId);
    return { items: conversations.map(toConversationResponse) };
  }

  @Get(':id')
  @RequirePermission('d2c.consumer.view')
  async getOne(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    const conversation = await this.conversationRepository.findById(user.organisationId, id);
    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }
    const messages = await this.messageRepository.listByConversation(user.organisationId, id);
    return {
      conversation: toConversationResponse(conversation),
      messages: messages.map(toMessageResponse),
    };
  }

  /**
   * The one mutating route — the exact call shape a future WhatsApp
   * adapter (translating an inbound WhatsApp message) and the Sprint 42
   * simulator are both expected to make against `ConversationService`
   * directly instead, once each exists. Today it is this sprint's own test
   * harness's only way to drive a conversation.
   */
  @Post('messages')
  @RequirePermission('d2c.consumer.manage')
  async sendMessage(
    @Body(new ZodValidationPipe(sendConversationMessageSchema)) body: SendConversationMessageInput,
    @CurrentUser() user: TokenPayload,
  ) {
    return this.conversationService.handleInboundMessage(user.organisationId, body);
  }
}

function toConversationResponse(conversation: ConsumerConversation) {
  return {
    id: conversation.id,
    channel: conversation.channel,
    externalConversationId: conversation.externalConversationId,
    consumerId: conversation.consumerId,
    state: conversation.state,
    status: conversation.status,
    lastInteractionAt: conversation.lastInteractionAt,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
  };
}

function toMessageResponse(message: ConsumerConversationMessage) {
  return {
    id: message.id,
    direction: message.direction,
    payload: message.payload,
    createdAt: message.createdAt,
    // Added Sprint 43.5 — the real channel message id for an INBOUND row (Meta's own
    // WAMID), `null` for OUTBOUND rows and non-WhatsApp callers — see this field's own
    // schema doc comment.
    externalMessageId: message.externalMessageId,
  };
}
