import { Module } from '@nestjs/common';

import { AuthModule } from '../../identity/auth/auth.module';
import { IdentityModule } from '../../identity/identity.module';
import { CustomerModule } from '../customer/customer.module';
import { NetworkRelationshipController } from './network-relationship.controller';
import { NetworkRelationshipRepository } from './network-relationship.repository';
import { NetworkRelationshipService } from './network-relationship.service';

/**
 * Distribution Network Relationship HTTP surface (Sprint 4.8,
 * docs/domains/retail-network.md). Imports `CustomerModule` so
 * `NetworkRelationshipService` can validate both endpoints of a relationship belong to
 * the caller's own organisation. Exports nothing — no other domain consumes network
 * relationships this sprint, and `SalesModule` deliberately does not import this module
 * (see docs/domains/retail-network.md "Capture the Market First").
 */
@Module({
  imports: [IdentityModule, AuthModule, CustomerModule],
  controllers: [NetworkRelationshipController],
  providers: [NetworkRelationshipRepository, NetworkRelationshipService],
})
export class NetworkRelationshipModule {}
