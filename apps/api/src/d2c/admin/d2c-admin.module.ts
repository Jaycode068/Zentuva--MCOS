import { Module } from '@nestjs/common';

import { AuthModule } from '../../identity/auth/auth.module';
import { IdentityModule } from '../../identity/identity.module';
import { OutletModule } from '../../retail/outlet/outlet.module';
import { TerritoryModule } from '../../retail/territory/territory.module';
import { SalesModule } from '../../sales/sales.module';
import { ConsumerModule } from '../consumer/consumer.module';
import { CollectionPointFulfillmentModule } from '../fulfillment/collection-point-fulfillment.module';
import { D2CAdminController } from './d2c-admin.controller';
import { D2CAdminService } from './d2c-admin.service';

/**
 * Sprint 39 — D2C Sales Administration & Operations Dashboard (docs/domains/d2c.md).
 * Purely a read-aggregation layer — no providers beyond the service, no repository, no
 * table of its own, same shape as `FieldD2COverviewModule` (Sprint 38). Imports
 * `SalesModule` (`SalesOrderService`/`SalesOrderRepository`'s read methods),
 * `ConsumerModule` (`ConsumerService`), `CollectionPointFulfillmentModule`
 * (`CollectionPointFulfillmentService`/`Repository`, both already exported),
 * `OutletModule` (`OutletRepository`), and `TerritoryModule` (`TerritoryRepository`).
 * `AuthModule` for `JwtAuthGuard`'s `TOKEN_SERVICE`, matching every other
 * controller-bearing D2C module.
 */
@Module({
  imports: [
    IdentityModule,
    AuthModule,
    SalesModule,
    ConsumerModule,
    CollectionPointFulfillmentModule,
    OutletModule,
    TerritoryModule,
  ],
  controllers: [D2CAdminController],
  providers: [D2CAdminService],
})
export class D2CAdminModule {}
