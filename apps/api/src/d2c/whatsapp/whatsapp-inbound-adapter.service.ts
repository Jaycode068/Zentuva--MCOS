import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConversationInput } from '@zentuva/validation';

import { AuditService } from '../../identity/audit/audit.service';
import { normalizePhoneNumber } from '../../notifications/phone-number-normalizer';
import {
  WHATSAPP_PROVIDER,
  WhatsAppProvider,
  WhatsAppSendResult,
} from '../../notifications/ports/whatsapp-provider.port';
import { ConversationMessageRepository } from '../conversation/conversation-message.repository';
import { ConversationRepository } from '../conversation/conversation.repository';
import { ConversationService } from '../conversation/conversation.service';
import {
  ConversationOption,
  ConversationOutboundMessage,
  ConversationOutboundResponse,
} from '../conversation/conversation.types';
import { WHATSAPP_AUDIT_ACTIONS } from './whatsapp-audit-actions';
import { WhatsAppOrganisationResolverService } from './whatsapp-organisation-resolver.service';
import { WhatsAppWebhookEventRepository } from './whatsapp-webhook-event.repository';
import { MetaWebhookMessage, MetaWebhookPayload, MetaWebhookStatus } from './whatsapp.types';

/**
 * Sprint 40.5 — Real Meta WhatsApp Cloud API Foundation (docs/domains/whatsapp.md
 * "Channel Adapter"). The ONLY bridge between the real Meta webhook and the
 * channel-neutral `ConversationService` (Sprint 33) — never a second chatbot engine,
 * never a reimplementation of any conversational state (brief "Do NOT build another
 * chatbot"). Every inbound message is normalized into the exact
 * `SendConversationMessageInput` shape `ConversationController`'s own internal tester
 * already uses (its doc comment names this file as the expected future replicator),
 * and every outbound `ConversationOutboundResponse` is translated back into real
 * `WhatsAppProvider.sendText` calls — `ConversationService` itself never imports
 * anything from this file or knows WhatsApp exists.
 *
 * Deliberately renders `BUTTONS`/`LIST` as numbered plain text (never Meta's real
 * interactive button/list JSON) — proving the full round trip end-to-end was this
 * sprint's bar, not a pixel-perfect WhatsApp UI (brief "keep Sprint 40.5 focused");
 * seeded consumer-side replies are matched back against the LAST presented options by
 * number or label (see `resolveConversationInput`) so a multi-turn conversation still
 * works over plain text. A real interactive-message upgrade is a documented future
 * step, not a defect — see docs/sprint-40.5-completion-report.md "Limitations."
 *
 * Sprint 41 — WhatsApp D2C Ordering & Commerce Conversation. A single `handleInboundMessage`
 * response can legitimately contain TWO option-bearing messages at once (e.g.
 * `ConversationService.renderBrowsing`'s product `LIST` plus a "View Cart & Checkout"
 * `BUTTONS` message, once the cart is non-empty) — `sendOutboundResponse` now numbers
 * options GLOBALLY across the whole batch (never restarting at 1 per message, which
 * would make a numeric reply ambiguous between two separately-numbered WhatsApp bubbles),
 * and `lastPresentedOptions` flattens every option-bearing message from the last batch
 * into that SAME combined, order-preserving list so a reply's global index always
 * resolves to the one option the consumer actually meant. Also added: a `TEXT` message
 * carrying an optional `imageUrl` (Sprint 41 brief §18, e.g. a product photo at
 * selection time) is sent via `WhatsAppProvider.sendImage` with the text as caption,
 * falling back to a plain `sendText` of the same caption if the image send fails —
 * never blocking the conversation on an image problem.
 */
@Injectable()
export class WhatsAppInboundAdapterService {
  private readonly logger = new Logger(WhatsAppInboundAdapterService.name);

  constructor(
    private readonly conversationService: ConversationService,
    private readonly conversationRepository: ConversationRepository,
    private readonly messageRepository: ConversationMessageRepository,
    private readonly organisationResolver: WhatsAppOrganisationResolverService,
    private readonly webhookEventRepository: WhatsAppWebhookEventRepository,
    private readonly auditService: AuditService,
    @Inject(WHATSAPP_PROVIDER) private readonly provider: WhatsAppProvider,
  ) {}

  /** The webhook controller's one call per inbound `POST` — already past signature
   *  verification, never anything else. Every entry/change/message/status is deduped
   *  independently via `WhatsAppWebhookEventRepository.tryClaim` (brief "Idempotency
   *  and Repeated Messages" — Meta redelivers the WHOLE payload on any non-2xx/timeout
   *  response, not just one message at a time). */
  async handleWebhookPayload(payload: MetaWebhookPayload): Promise<void> {
    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value;
        for (const message of value.messages ?? []) {
          const claimed = await this.webhookEventRepository.tryClaim(message.id, 'INBOUND_MESSAGE');
          if (!claimed) {
            this.logger.debug(`Skipping already-processed inbound WhatsApp message ${message.id}`);
            continue;
          }
          await this.processInboundMessage(message);
        }
        for (const status of value.statuses ?? []) {
          // Composite key — Meta sends multiple GENUINELY DIFFERENT status events
          // (sent, delivered, read) for the SAME message id; only an exact repeat of
          // the same id+status pair is a true redelivery.
          const claimed = await this.webhookEventRepository.tryClaim(
            `${status.id}:${status.status}`,
            'STATUS_UPDATE',
          );
          if (!claimed) continue;
          await this.processStatusUpdate(status);
        }
      }
    }
  }

  private async processInboundMessage(message: MetaWebhookMessage): Promise<void> {
    // Meta's `from` is already fully international, digits-only, no leading `+` — the
    // `+`-prefixed branch of `normalizePhoneNumber` validates this shape without
    // needing an organisation country (country only matters for AMBIGUOUS local-format
    // numbers, which Meta never sends).
    const { normalized } = normalizePhoneNumber(`+${message.from}`, null);
    if (!normalized) {
      this.logger.warn(`Could not normalize inbound WhatsApp sender ${redactPhone(message.from)}`);
      return;
    }

    const organisationId = await this.organisationResolver.resolveOrganisationId(normalized);
    if (!organisationId) {
      await this.auditService.record({
        action: WHATSAPP_AUDIT_ACTIONS.ORGANISATION_UNRESOLVED,
        entityType: 'WhatsAppInboundMessage',
        metadata: { messageId: message.id },
      });
      return;
    }

    const input = await this.resolveConversationInput(organisationId, normalized, message);

    const response = await this.conversationService.handleInboundMessage(organisationId, {
      channel: 'WHATSAPP',
      externalConversationId: normalized,
      input,
    });

    await this.auditService.record({
      action: WHATSAPP_AUDIT_ACTIONS.INBOUND_MESSAGE_RECEIVED,
      entityType: 'ConsumerConversation',
      entityId: response.conversationId,
      organisationId,
      metadata: { messageId: message.id },
    });

    await this.sendOutboundResponse(normalized, response);
  }

  /** Real WhatsApp interactive-message replies (`type==='interactive'`) carry their own
   *  stable `id` — used directly, no guessing. A plain-text reply is matched against
   *  whichever `BUTTONS`/`LIST` options this conversation last presented (by number or
   *  exact label), falling back to free `TEXT` input otherwise — see this class's own
   *  doc comment. */
  private async resolveConversationInput(
    organisationId: string,
    normalizedPhone: string,
    message: MetaWebhookMessage,
  ): Promise<ConversationInput> {
    const interactiveReplyId =
      message.interactive?.button_reply?.id ?? message.interactive?.list_reply?.id;
    if (interactiveReplyId) {
      return { type: 'BUTTON', value: interactiveReplyId };
    }

    const rawText = (message.text?.body ?? message.button?.text ?? '').trim();
    if (!rawText) {
      return { type: 'TEXT', text: '(empty message)' };
    }

    const options = await this.lastPresentedOptions(organisationId, normalizedPhone);
    if (options) {
      const asNumber = Number.parseInt(rawText, 10);
      if (
        String(asNumber) === rawText &&
        Number.isInteger(asNumber) &&
        asNumber >= 1 &&
        asNumber <= options.length
      ) {
        return { type: 'BUTTON', value: options[asNumber - 1]!.value };
      }
      const byLabel = options.find((o) => o.label.toLowerCase() === rawText.toLowerCase());
      if (byLabel) {
        return { type: 'BUTTON', value: byLabel.value };
      }
    }

    return { type: 'TEXT', text: rawText };
  }

  private async lastPresentedOptions(
    organisationId: string,
    normalizedPhone: string,
  ): Promise<ConversationOption[] | null> {
    const conversation = await this.conversationRepository.findByExternalId(
      organisationId,
      'WHATSAPP',
      normalizedPhone,
    );
    if (!conversation) return null;

    const lastOutbound = await this.messageRepository.findLastOutbound(
      organisationId,
      conversation.id,
    );
    if (!lastOutbound) return null;

    const messages = lastOutbound.payload as unknown as ConversationOutboundMessage[];
    // Flattened in rendering order — must match `sendOutboundResponse`'s GLOBAL
    // numbering exactly, since a reply's index is resolved against this same list.
    const options = messages.flatMap((candidate) =>
      candidate.type === 'BUTTONS' || candidate.type === 'LIST' ? candidate.options : [],
    );
    return options.length > 0 ? options : null;
  }

  private async sendOutboundResponse(
    toPhoneNumber: string,
    response: ConversationOutboundResponse,
  ): Promise<void> {
    // Global, running option counter — see this class's own doc comment on why option
    // numbering must never restart at 1 per message.
    let optionOffset = 0;
    for (const [index, message] of response.messages.entries()) {
      const part = renderOutboundMessagePart(message, optionOffset);
      optionOffset += part.optionCount;
      if (!part.text) continue;

      const correlationId = `${response.conversationId}-${index}`;
      const result = part.imageUrl
        ? await this.sendTextOrImageFallback(toPhoneNumber, part.text, part.imageUrl, correlationId)
        : await this.provider.sendText({ toPhoneNumber, text: part.text, correlationId });

      if (result.outcome !== 'ACCEPTED') {
        this.logger.warn(
          `Failed to deliver a conversation reply over WhatsApp: ${result.errorCode ?? 'unknown'}`,
        );
      }
    }
  }

  /** Sprint 41 brief §18 — "do not block ordering because an image is unavailable": a
   *  failed image send (invalid/unreachable URL, provider error) falls back to a plain
   *  text send of the SAME caption rather than silently dropping the message. */
  private async sendTextOrImageFallback(
    toPhoneNumber: string,
    caption: string,
    imageUrl: string,
    correlationId: string,
  ): Promise<WhatsAppSendResult> {
    const result = await this.provider.sendImage({
      toPhoneNumber,
      imageUrl,
      caption,
      correlationId,
    });
    if (result.outcome === 'ACCEPTED') {
      return result;
    }
    this.logger.warn(
      `Product image send failed (${result.errorCode ?? 'unknown'}) — falling back to text.`,
    );
    return this.provider.sendText({
      toPhoneNumber,
      text: caption,
      correlationId: `${correlationId}-img-fallback`,
    });
  }

  private async processStatusUpdate(status: MetaWebhookStatus): Promise<void> {
    await this.auditService.record({
      action: WHATSAPP_AUDIT_ACTIONS.DELIVERY_STATUS_RECEIVED,
      entityType: 'WhatsAppMessage',
      entityId: status.id,
      metadata: { status: status.status, recipientPhone: redactPhone(status.recipient_id) },
    });
  }
}

interface RenderedMessagePart {
  text: string;
  imageUrl?: string;
  /** How many options this part numbered — the caller accumulates this across the
   *  whole outbound batch so a SECOND option-bearing message in the same response
   *  continues the sequence rather than restarting at 1 (see this class's own doc
   *  comment). Always `0` for `TEXT`/`PAYMENT_REQUIRED`. */
  optionCount: number;
}

/** Numbered plain text — see this class's own doc comment for why this is a
 *  deliberate, documented scope cut rather than Meta's real interactive JSON.
 *  `optionOffset` is the count of options already numbered by EARLIER messages in the
 *  same outbound batch, so this message's own options continue that global sequence. */
function renderOutboundMessagePart(
  message: ConversationOutboundMessage,
  optionOffset: number,
): RenderedMessagePart {
  switch (message.type) {
    case 'TEXT':
      return { text: message.text, imageUrl: message.imageUrl, optionCount: 0 };
    case 'BUTTONS':
    case 'LIST':
      return {
        text: [
          message.text,
          '',
          ...message.options.map((option, index) => `${optionOffset + index + 1}. ${option.label}`),
          '',
          'Reply with the number of your choice.',
        ].join('\n'),
        optionCount: message.options.length,
      };
    case 'PAYMENT_REQUIRED':
      return {
        text: [
          message.text,
          '',
          `Amount: ${message.currency} ${message.amount}`,
          `Pay here: ${message.checkoutUrl}`,
        ].join('\n'),
        optionCount: 0,
      };
    default:
      return { text: '', optionCount: 0 };
  }
}

/** Same redaction convention as `meta-whatsapp-provider.ts`'s own `redactPhone`. */
function redactPhone(phone: string): string {
  if (phone.length <= 6) return '***';
  return `${phone.slice(0, 4)}***${phone.slice(-2)}`;
}
