import { randomUUID } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  WHATSAPP_PROVIDER,
  WhatsAppProvider,
} from '../../notifications/ports/whatsapp-provider.port';
import { ConsumerService } from '../consumer/consumer.service';
import { ConsumerNotificationPort } from './consumer-notification.port';

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
 */
@Injectable()
export class WhatsAppConsumerNotificationService implements ConsumerNotificationPort {
  private readonly logger = new Logger(WhatsAppConsumerNotificationService.name);

  constructor(
    @Inject(WHATSAPP_PROVIDER) private readonly provider: WhatsAppProvider,
    private readonly consumerService: ConsumerService,
  ) {}

  async notify(organisationId: string, consumerId: string, message: string): Promise<void> {
    try {
      const consumer = await this.consumerService.getById(organisationId, consumerId);
      if (!consumer) {
        this.logger.warn(`Cannot notify unknown consumer ${consumerId}`);
        return;
      }
      const result = await this.provider.sendText({
        toPhoneNumber: consumer.normalizedPhone,
        text: message,
        correlationId: randomUUID(),
      });
      if (result.outcome !== 'ACCEPTED') {
        this.logger.warn(
          `Consumer notification not accepted (${result.errorCode ?? 'unknown'}) for consumer ${consumerId}`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to send consumer notification for consumer ${consumerId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
