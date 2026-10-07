import { Module } from '@nestjs/common';

import { WhatsAppProviderModule } from '../../notifications/infrastructure/whatsapp-provider.module';
import { ConsumerModule } from '../consumer/consumer.module';
import { CONSUMER_NOTIFICATION_PORT } from './consumer-notification.port';
import { WhatsAppConsumerNotificationService } from './whatsapp-consumer-notification.service';

/**
 * Sprint 42 — D2C Collection Point Fulfilment & Order Completion. Provides
 * {@link CONSUMER_NOTIFICATION_PORT}, exactly mirroring `WhatsAppProviderModule`'s own
 * "provide the token, export it, nothing else" shape. Imports `WhatsAppProviderModule`
 * for the EXISTING `WHATSAPP_PROVIDER` token (Sprint 29/40.5 — never duplicated) and
 * `ConsumerModule` for `ConsumerService` (phone resolution). Deliberately its own small
 * module, not folded into `d2c/whatsapp/` (the webhook/adapter/test-controller surface)
 * — a business domain needing to notify a consumer should depend on this narrow port
 * only, never on the webhook/Conversation-Layer-adapter machinery.
 */
@Module({
  imports: [WhatsAppProviderModule, ConsumerModule],
  providers: [
    WhatsAppConsumerNotificationService,
    { provide: CONSUMER_NOTIFICATION_PORT, useExisting: WhatsAppConsumerNotificationService },
  ],
  exports: [CONSUMER_NOTIFICATION_PORT],
})
export class D2CMessagingModule {}
