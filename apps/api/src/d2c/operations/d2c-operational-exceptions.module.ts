import { Module } from '@nestjs/common';

import { OutletModule } from '../../retail/outlet/outlet.module';
import { SalesModule } from '../../sales/sales.module';
import { CollectionPointFulfillmentModule } from '../fulfillment/collection-point-fulfillment.module';
import { D2CMessagingModule } from '../messaging/d2c-messaging.module';
import { D2COperationalExceptionsService } from './d2c-operational-exceptions.service';

/**
 * Sprint 43 — D2C Operations, Notifications & Production Hardening
 * (docs/domains/d2c.md "Operational Exceptions"). Purely a read-aggregation layer — no
 * controller, no table of its own, same shape as `D2CAdminModule`/
 * `FieldD2COverviewModule`. Imports `SalesModule`/`CollectionPointFulfillmentModule`/
 * `OutletModule` (the existing read sources) and `D2CMessagingModule` (the Sprint 43
 * `ConsumerWhatsAppDeliveryRepository`, already exported). Exports the service so
 * `D2CAdminModule` (org-wide) and `FieldD2COverviewModule` (territory-scoped) can both
 * depend on the SAME exception-detection logic.
 */
@Module({
  imports: [SalesModule, CollectionPointFulfillmentModule, OutletModule, D2CMessagingModule],
  providers: [D2COperationalExceptionsService],
  exports: [D2COperationalExceptionsService],
})
export class D2COperationalExceptionsModule {}
