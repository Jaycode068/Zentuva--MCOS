import { Module } from '@nestjs/common';

import { AuthModule } from '../../identity/auth/auth.module';
import { IdentityModule } from '../../identity/identity.module';
import { OutletModule } from '../../retail/outlet/outlet.module';
import { TerritoryModule } from '../../retail/territory/territory.module';
import { SalesModule } from '../../sales/sales.module';
import { ConsumerModule } from '../consumer/consumer.module';
import { CollectionPointFulfillmentModule } from '../fulfillment/collection-point-fulfillment.module';
import { D2CMessagingModule } from '../messaging/d2c-messaging.module';
import { D2COperationalExceptionsModule } from '../operations/d2c-operational-exceptions.module';
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
 *
 * Sprint 43 — D2C Operations, Notifications & Production Hardening. Adds
 * `D2COperationalExceptionsModule` (the shared exception-detection logic, extracted
 * from this module's own Sprint 39 `computeAttentionItems`) and `D2CMessagingModule`
 * (the Sprint 43 `ConsumerWhatsAppDeliveryRepository`, for the dashboard's
 * COMMUNICATIONS summary counts) — both already exported, no new provider duplicated
 * here.
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
    D2COperationalExceptionsModule,
    D2CMessagingModule,
  ],
  controllers: [D2CAdminController],
  providers: [D2CAdminService],
})
export class D2CAdminModule {}
