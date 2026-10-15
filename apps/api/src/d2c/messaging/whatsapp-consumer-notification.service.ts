import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConsumerWhatsAppDelivery } from '@prisma/client';

import {
  WHATSAPP_PROVIDER,
  WhatsAppProvider,
  WhatsAppSendResult,
} from '../../notifications/ports/whatsapp-provider.port';
import { ConsumerService } from '../consumer/consumer.service';
import {
  ConsumerNotificationPort,
  ConsumerNotificationRequest,
} from './consumer-notification.port';
import { ConsumerWhatsAppDeliveryRepository } from './consumer-whatsapp-delivery.repository';
import { resolveD2CWhatsAppTemplate } from './d2c-whatsapp-template';
import { isWithinMessagingWindow } from './whatsapp-messaging-window';

/** Stage 5C.1 — distinct from every `errorCode` `MetaWhatsAppProvider` itself can
 *  produce (those all come from a real Meta API response); this one is produced
 *  entirely on the application side, BEFORE any provider call is attempted, so it
 *  needs its own code rather than borrowing `WHATSAPP_MESSAGING_WINDOW_EXPIRED`
 *  (which specifically means "Meta rejected this with error 131047"). */
const TEMPLATE_NOT_CONFIGURED_ERROR_CODE = 'WHATSAPP_TEMPLATE_NOT_CONFIGURED';

/** `ConsumerWhatsAppNotificationKind` values that are ever sent outside an active
 *  conversation turn — `CONVERSATION_REPLY` is always a reply to an inbound message,
 *  unconditionally inside Meta's messaging window by construction, so it never needs
 *  the window check below. */
const WINDOW_SENSITIVE_KINDS = new Set(['COLLECTION_READY', 'COLLECTION_CONFIRMED']);

/**
 * Sprint 42 — the one concrete implementation of {@link ConsumerNotificationPort},
 * reusing the SAME `WHATSAPP_PROVIDER` token Sprint 29/40.5 already established — never
 * a new WhatsApp sending mechanism (brief §16/§31). Resolves the Consumer's own
 * `normalizedPhone` (Sprint 32) internally so callers (`CollectionPointFulfillmentService`)
 * never handle a phone number at all — they only ever say "notify this consumer."
 *
 * Deliberately swallows every failure (unknown consumer, unreachable provider, Meta
 * rejection) — logged, never thrown — matching this port's own documented best-effort
 * contract; a fulfilment state transition must never be undone because a WhatsApp send
 * failed.
 *
 * Sprint 43 — D2C Operations, Notifications & Production Hardening (docs/domains/d2c.md
 * "Consumer Communication Delivery Visibility"). Every call now also writes a
 * `ConsumerWhatsAppDelivery` row BEFORE attempting the send, and finalizes it to
 * `SENT`/`FAILED` after — so a fulfilment event that triggers a notification is no
 * longer a complete black box to an operator. Persistence failures are swallowed the
 * same way send failures already were: this port's contract is "never throw past this
 * boundary," full stop.
 */
@Injectable()
export class WhatsAppConsumerNotificationService implements ConsumerNotificationPort {
  private readonly logger = new Logger(WhatsAppConsumerNotificationService.name);

  constructor(
    @Inject(WHATSAPP_PROVIDER) private readonly provider: WhatsAppProvider,
    private readonly consumerService: ConsumerService,
    private readonly repository: ConsumerWhatsAppDeliveryRepository,
    private readonly config: ConfigService,
  ) {}

  async notify(request: ConsumerNotificationRequest): Promise<void> {
    const { organisationId, consumerId, salesOrderId, kind, message } = request;
    try {
      const consumer = await this.consumerService.getById(organisationId, consumerId);
      if (!consumer) {
        this.logger.warn(`Cannot notify unknown consumer ${consumerId}`);
        return;
      }

      const delivery = await this.repository.create({
        organisationId,
        consumerId,
        salesOrderId,
        kind,
        recipientPhoneSnapshot: consumer.normalizedPhone,
        messageSnapshot: message,
      });

      await this.attemptSend(organisationId, delivery, consumer.normalizedPhone, message, true);
    } catch (error) {
      this.logger.error(
        `Failed to send consumer notification for consumer ${consumerId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /**
   * Shared by the initial send above and `ConsumerCommunicationService.retry` — one
   * place decides how a provider result maps onto the delivery row, so the two call
   * sites can never drift. Also the one place that decides TEXT vs. TEMPLATE —
   * re-derived fresh on every call (including every retry), from `delivery.kind` and
   * the consumer's CURRENT last-inbound-message time, never trusted from whatever was
   * true at the original attempt. This matters for retry specifically: a retry can
   * happen hours after the original attempt, by which point the window may have
   * closed (the original free-form attempt should no longer be blindly repeated) or
   * re-opened (the consumer messaged back in since) — re-deriving the decision every
   * time is what makes both directions correct automatically.
   *
   * Stage 5C.1 — for `COLLECTION_READY`/`COLLECTION_CONFIRMED` outside the messaging
   * window: never falls back to `sendText` (that free-form send is exactly what Meta
   * rejects with error 131047 outside the window — see
   * `meta-whatsapp-provider.ts:mapErrorResponse`). If an approved template is
   * configured (`resolveD2CWhatsAppTemplate`), sends it instead, passing the already-
   * rendered consumer-facing text as the template's one body parameter — the
   * simplest, smallest-footprint assumption about an eventual approved template's
   * shape, not a verified fact (same "assumption, not verified" framing
   * `APPROVAL_TEMPLATE_PARAMETER_ORDER`'s own doc comment already uses for the
   * identical situation). If NO template is configured, fails closed immediately —
   * no provider call is attempted at all — recording a distinct, operator-visible
   * `WHATSAPP_TEMPLATE_NOT_CONFIGURED` error rather than silently sending a free-form
   * message that cannot succeed.
   */
  async attemptSend(
    organisationId: string,
    delivery: ConsumerWhatsAppDelivery,
    toPhoneNumber: string,
    text: string,
    isFirstAttempt: boolean,
  ): Promise<ConsumerWhatsAppDelivery> {
    let useTemplate: { name: string; language: string } | undefined;
    if (WINDOW_SENSITIVE_KINDS.has(delivery.kind) && delivery.consumerId) {
      const lastInboundAt = await this.consumerService.getLastInboundMessageAt(
        organisationId,
        delivery.consumerId,
      );
      if (!isWithinMessagingWindow(lastInboundAt, new Date())) {
        const template = resolveD2CWhatsAppTemplate(this.config, delivery.kind);
        if (!template) {
          this.logger.warn(
            `Consumer delivery ${delivery.id} (${delivery.kind}) is outside the 24h messaging ` +
              'window and no approved template is configured for this notification type — ' +
              'refusing to send a free-form message that Meta would reject.',
          );
          return this.repository.markFailed(organisationId, delivery.id, {
            providerName: this.provider.name,
            errorCode: TEMPLATE_NOT_CONFIGURED_ERROR_CODE,
            errorMessage:
              'Outside the 24-hour WhatsApp messaging window and no approved template is ' +
              'configured for this notification type.',
            isFirstAttempt,
          });
        }
        useTemplate = template;
      }
    }

    let result: WhatsAppSendResult;
    try {
      result = useTemplate
        ? await this.provider.sendTemplate({
            toPhoneNumber,
            templateName: useTemplate.name,
            templateLanguage: useTemplate.language,
            bodyParameters: [text],
            correlationId: delivery.id,
          })
        : await this.provider.sendText({
            toPhoneNumber,
            text,
            correlationId: delivery.id,
          });
    } catch (error) {
      this.logger.error(
        `WhatsApp send threw for consumer delivery ${delivery.id}`,
        error instanceof Error ? error.stack : String(error),
      );
      return this.repository.markFailed(organisationId, delivery.id, {
        providerName: this.provider.name,
        errorCode: 'WHATSAPP_UNEXPECTED',
        errorMessage: 'Unexpected error contacting the WhatsApp provider.',
        isFirstAttempt,
      });
    }

    if (result.outcome === 'ACCEPTED') {
      // Meta ACCEPTING the API call is not the same as the consumer having received
      // the message — `markSent` records exactly that: the send request was accepted,
      // never "delivered" or "read" (those are separate, unmodelled Meta status
      // callbacks this stage does not add). `ConsumerWhatsAppDelivery.status: SENT`
      // already carried this meaning before this stage; unchanged here, stated
      // explicitly because it is easy to misread.
      return this.repository.markSent(organisationId, delivery.id, {
        providerName: this.provider.name,
        providerMessageId: result.providerMessageId,
        isFirstAttempt,
      });
    }

    this.logger.warn(
      `Consumer notification not accepted (${result.errorCode ?? 'unknown'}) for delivery ${delivery.id}`,
    );
    return this.repository.markFailed(organisationId, delivery.id, {
      providerName: this.provider.name,
      errorCode: result.errorCode,
      errorMessage: result.errorMessage,
      isFirstAttempt,
    });
  }
}
