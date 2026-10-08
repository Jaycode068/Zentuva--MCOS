import { Module } from '@nestjs/common';

import { AuthModule } from '../../identity/auth/auth.module';
import { IdentityModule } from '../../identity/identity.module';
import { D2CConversationCapabilityRepository } from './d2c-conversation-capability.repository';
import { D2CConversationConfigController } from './d2c-conversation-config.controller';
import { D2CConversationConfigService } from './d2c-conversation-config.service';
import { D2CConversationMessageRepository } from './d2c-conversation-message.repository';
import { D2CConversationProfileRepository } from './d2c-conversation-profile.repository';

/**
 * Sprint 44 — Tenant D2C Conversation Configuration (docs/domains/d2c.md "Tenant
 * Conversation Configuration"). Provides `D2CConversationConfigService` — the single
 * place tenant D2C conversation configuration is resolved and administered. Imports
 * `IdentityModule`/`AuthModule` for `OrganisationService`/`EffectiveAccessResolver`/
 * `AuditService`/`JwtAuthGuard`'s `TOKEN_SERVICE`, the same pair every other
 * controller-bearing D2C module already imports — never a new identity/auth mechanism.
 * Deliberately its OWN small module (not folded into `d2c/conversation/`) so the
 * channel-neutral `ConversationModule`'s own existing, tested import allowlist
 * (`conversation-independence.spec.ts`) only needs ONE new, clearly-named addition
 * rather than this module's repositories/controller living inside it directly.
 */
@Module({
  imports: [IdentityModule, AuthModule],
  controllers: [D2CConversationConfigController],
  providers: [
    D2CConversationCapabilityRepository,
    D2CConversationMessageRepository,
    D2CConversationProfileRepository,
    D2CConversationConfigService,
  ],
  exports: [D2CConversationConfigService],
})
export class D2CConversationConfigModule {}
