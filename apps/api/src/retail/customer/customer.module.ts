import { Module } from '@nestjs/common';

import { AuthModule } from '../../identity/auth/auth.module';
import { IdentityModule } from '../../identity/identity.module';
import { TerritoryModule } from '../territory/territory.module';
import { CustomerController } from './customer.controller';
import { CustomerRepository } from './customer.repository';
import { CustomerService } from './customer.service';

/**
 * Customer HTTP surface (Sprint 4.8, docs/domains/customers.md). Imports `TerritoryModule`
 * so `CustomerService` can inject `TerritoryRepository` to validate a customer's optional
 * `territoryId`. Exports `CustomerRepository` so `OutletModule`, `NetworkRelationshipModule`,
 * and `SalesModule` can each inject it to validate their own references to a customer
 * belong to the caller's own organisation.
 */
@Module({
  imports: [IdentityModule, AuthModule, TerritoryModule],
  controllers: [CustomerController],
  providers: [CustomerRepository, CustomerService],
  exports: [CustomerRepository],
})
export class CustomerModule {}
