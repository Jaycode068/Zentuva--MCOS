import { Module } from '@nestjs/common';

import { AuthModule } from '../../identity/auth/auth.module';
import { IdentityModule } from '../../identity/identity.module';
import { TerritoryModule } from '../../retail/territory/territory.module';
import { ConsumerLocationRequestRepository } from './consumer-location-request.repository';
import { ConsumerController } from './consumer.controller';
import { ConsumerRepository } from './consumer.repository';
import { ConsumerService } from './consumer.service';

/**
 * Consumer (D2C) HTTP surface (Sprint 32, docs/domains/d2c.md). Imports
 * `TerritoryModule` so `ConsumerService` can inject `TerritoryRepository` to
 * validate a consumer's optional `territoryId` — the EXACT same "import the
 * module, inject its exported repository" pattern `CustomerModule` already
 * establishes, reusing the same Territory hierarchy rather than
 * introducing a second one. Imports `IdentityModule` for `AuditService`
 * (the controller) and `OrganisationService` (the service, to read
 * `Organisation.country` for phone normalization).
 *
 * Deliberately does NOT import `NotificationsModule`, `WorkflowModule`, or
 * any WhatsApp-related module — see `d2c-independence.spec.ts`.
 */
@Module({
  imports: [IdentityModule, AuthModule, TerritoryModule],
  controllers: [ConsumerController],
  providers: [ConsumerRepository, ConsumerLocationRequestRepository, ConsumerService],
  exports: [ConsumerRepository, ConsumerService],
})
export class ConsumerModule {}
