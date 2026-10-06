import { Module } from '@nestjs/common';

import { AuthModule } from '../../identity/auth/auth.module';
import { IdentityModule } from '../../identity/identity.module';
import { WhatsAppProviderModule } from '../../notifications/infrastructure/whatsapp-provider.module';
import { ConsumerModule } from '../consumer/consumer.module';
import { ConversationModule } from '../conversation/conversation.module';
import { WhatsAppInboundAdapterService } from './whatsapp-inbound-adapter.service';
import { WhatsAppOrganisationResolverService } from './whatsapp-organisation-resolver.service';
import { WhatsAppTestController } from './whatsapp-test.controller';
import { WhatsAppWebhookEventRepository } from './whatsapp-webhook-event.repository';
import { WhatsAppWebhookController } from './whatsapp-webhook.controller';

/**
 * Sprint 40.5 — Real Meta WhatsApp Cloud API Foundation (docs/domains/whatsapp.md).
 * Imports `WhatsAppProviderModule` to inject the SAME `WHATSAPP_PROVIDER` token Sprint
 * 29's notification pipeline already uses — never a second, duplicate provider wiring.
 * Imports `ConversationModule` (for `ConversationService`/`ConversationRepository`/
 * `ConversationMessageRepository`, all exported from there) so the inbound adapter
 * drives the EXISTING channel-neutral Conversation Layer rather than reimplementing
 * any of its state. Imports `ConsumerModule` for `ConsumerRepository` (the
 * organisation resolver's cross-tenant phone lookup). `IdentityModule`/`AuthModule` for
 * the admin test controller's guards and `OrganisationService`.
 */
@Module({
  imports: [IdentityModule, AuthModule, WhatsAppProviderModule, ConversationModule, ConsumerModule],
  controllers: [WhatsAppWebhookController, WhatsAppTestController],
  providers: [
    WhatsAppWebhookEventRepository,
    WhatsAppOrganisationResolverService,
    WhatsAppInboundAdapterService,
  ],
})
export class WhatsAppModule {}
