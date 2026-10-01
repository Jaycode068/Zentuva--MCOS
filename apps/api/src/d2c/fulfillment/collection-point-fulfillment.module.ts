import { Module } from '@nestjs/common';

import { AuthModule } from '../../identity/auth/auth.module';
import { IdentityModule } from '../../identity/identity.module';
import { OutletModule } from '../../retail/outlet/outlet.module';
import { SalesModule } from '../../sales/sales.module';
import { ConsumerModule } from '../consumer/consumer.module';
import { CollectionPointFulfillmentController } from './collection-point-fulfillment.controller';
import { CollectionPointFulfillmentRepository } from './collection-point-fulfillment.repository';
import { CollectionPointFulfillmentService } from './collection-point-fulfillment.service';

/**
 * Sprint 37 — Collection Point Fulfillment (docs/domains/d2c.md). Imports `OutletModule`
 * (the Collection Point capability, Sprint 36) and `SalesModule` (the EXISTING
 * `SalesOrder`/`SalesFulfilmentService` this sprint connects to, never duplicates) and
 * `ConsumerModule` (territory-based assignment matching). `AuthModule` is imported
 * because the controller guards with `JwtAuthGuard`, which needs `TOKEN_SERVICE`
 * (provided by `AuthModule`, not `IdentityModule` — see `OutletModule`/`SalesModule` for
 * the same pattern). Exports the service so `D2CPaymentModule` can call `autoAssign()`
 * right after a verified payment.
 */
@Module({
  imports: [IdentityModule, AuthModule, OutletModule, SalesModule, ConsumerModule],
  controllers: [CollectionPointFulfillmentController],
  providers: [CollectionPointFulfillmentRepository, CollectionPointFulfillmentService],
  exports: [CollectionPointFulfillmentService],
})
export class CollectionPointFulfillmentModule {}
