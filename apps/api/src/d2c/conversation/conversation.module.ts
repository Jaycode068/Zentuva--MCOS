import { Module } from '@nestjs/common';

import { AuthModule } from '../../identity/auth/auth.module';
import { IdentityModule } from '../../identity/identity.module';
import { TerritoryModule } from '../../retail/territory/territory.module';
import { ConsumerModule } from '../consumer/consumer.module';
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
 */
@Module({
  imports: [IdentityModule, AuthModule, TerritoryModule, ConsumerModule],
  controllers: [ConversationController],
  providers: [ConversationRepository, ConversationMessageRepository, ConversationService],
  exports: [ConversationService],
})
export class ConversationModule {}
