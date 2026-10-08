import { Inject, Injectable, Logger } from '@nestjs/common';
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

  /** Shared by the initial send above and `ConsumerCommunicationService.retry` — one
   *  place decides how a provider result maps onto the delivery row, so the two call
   *  sites can never drift. */
  async attemptSend(
    organisationId: string,
    delivery: ConsumerWhatsAppDelivery,
    toPhoneNumber: string,
    text: string,
    isFirstAttempt: boolean,
  ): Promise<ConsumerWhatsAppDelivery> {
    let result: WhatsAppSendResult;
    try {
      result = await this.provider.sendText({
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
