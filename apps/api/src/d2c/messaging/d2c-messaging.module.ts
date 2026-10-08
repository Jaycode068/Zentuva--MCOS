import { Module } from '@nestjs/common';

import { AuthModule } from '../../identity/auth/auth.module';
import { IdentityModule } from '../../identity/identity.module';
import { WhatsAppProviderModule } from '../../notifications/infrastructure/whatsapp-provider.module';
import { ConsumerModule } from '../consumer/consumer.module';
import { ConsumerCommunicationController } from './consumer-communication.controller';
import { ConsumerCommunicationService } from './consumer-communication.service';
import { CONSUMER_NOTIFICATION_PORT } from './consumer-notification.port';
import { ConsumerWhatsAppDeliveryRepository } from './consumer-whatsapp-delivery.repository';
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
 *
 * Sprint 43 — D2C Operations, Notifications & Production Hardening
 * (docs/domains/d2c.md "Consumer Communication Delivery Visibility"). Adds
 * `ConsumerWhatsAppDeliveryRepository` (the delivery-attempt record
 * `WhatsAppConsumerNotificationService` now writes), `ConsumerCommunicationService` (the
 * admin list/retry surface), and its controller. `IdentityModule`/`AuthModule` added for
 * `EffectiveAccessResolver`/`AuditService`/`JwtAuthGuard`'s `TOKEN_SERVICE` — the same
 * pair every other controller-bearing D2C module already imports. The repository is
 * exported so `D2CAdminModule`/`FieldD2COverviewModule` can read delivery history for
 * the dashboard, exceptions queue, and order timeline without a second query mechanism.
 */
@Module({
  imports: [WhatsAppProviderModule, ConsumerModule, IdentityModule, AuthModule],
  controllers: [ConsumerCommunicationController],
  providers: [
    ConsumerWhatsAppDeliveryRepository,
    WhatsAppConsumerNotificationService,
    { provide: CONSUMER_NOTIFICATION_PORT, useExisting: WhatsAppConsumerNotificationService },
    ConsumerCommunicationService,
  ],
  exports: [CONSUMER_NOTIFICATION_PORT, ConsumerWhatsAppDeliveryRepository],
})
export class D2CMessagingModule {}
