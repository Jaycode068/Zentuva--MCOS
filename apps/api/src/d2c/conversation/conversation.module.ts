import { Module } from '@nestjs/common';

import { AuthModule } from '../../identity/auth/auth.module';
import { IdentityModule } from '../../identity/identity.module';
import { LoyaltyModule } from '../../promotions/loyalty/loyalty.module';
import { TerritoryModule } from '../../retail/territory/territory.module';
import { ConsumerModule } from '../consumer/consumer.module';
import { D2COrderingModule } from '../ordering/d2c-ordering.module';
import { D2CPaymentModule } from '../payment/d2c-payment.module';
import { ConversationMessageRepository } from './conversation-message.repository';
import { ConversationController } from './conversation.controller';
import { ConversationRepository } from './conversation.repository';
import { ConversationService } from './conversation.service';

/**
 * Consumer Conversation module (Sprint 33, docs/domains/d2c.md). Imports
 * `ConsumerModule` to inject the exact, unchanged `ConsumerService` from
 * Sprint 32, and `TerritoryModule` for `TerritoryRepository` — the same
 * "import the module, inject its exported service/repository" pattern
 * every other domain in this codebase already uses. Deliberately does NOT
 * import `NotificationsModule`/`WorkflowModule`/any WhatsApp-related
 * module — see `d2c-independence.spec.ts`.
 *
 * Added Sprint 34 — `D2COrderingModule`, so `ConversationService` can inject
 * `D2COrderingService` to drive the Order Snacks flow, the exact
 * `Conversation Layer -> D2C Ordering Service -> Existing Sales Order`
 * architecture this sprint's brief describes.
 *
 * Added Sprint 35 — `D2CPaymentModule`, so `ConversationService` can inject
 * `D2CPaymentService` to drive "Pay Now" the exact same way: `Conversation
 * Layer -> D2CPaymentService -> Existing Payment/Sales Order`.
 *
 * Added Sprint 41 — `LoyaltyModule`, so the main menu's "My Rewards" option can inject
 * the EXISTING `LoyaltyService` (Sprint 40) read-only — never a second rewards read
 * path, never reward/promotion evaluation logic duplicated here.
 */
@Module({
  imports: [
    IdentityModule,
    AuthModule,
    TerritoryModule,
    ConsumerModule,
    D2COrderingModule,
    D2CPaymentModule,
    LoyaltyModule,
  ],
  controllers: [ConversationController],
  providers: [ConversationRepository, ConversationMessageRepository, ConversationService],
  // `ConversationMessageRepository`/`ConversationRepository` exported added Sprint
  // 40.5 — the WhatsApp inbound adapter's `findLastOutbound`/`findByExternalId`
  // lookups (see `WhatsAppInboundAdapterService`).
  exports: [ConversationService, ConversationMessageRepository, ConversationRepository],
})
export class ConversationModule {}
