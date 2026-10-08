import { Module } from '@nestjs/common';

import { HrModule } from '../../hr/hr.module';
import { AuthModule } from '../../identity/auth/auth.module';
import { IdentityModule } from '../../identity/identity.module';
import { OutletModule } from '../../retail/outlet/outlet.module';
import { SalesModule } from '../../sales/sales.module';
import { CollectionPointFulfillmentModule } from '../fulfillment/collection-point-fulfillment.module';
import { D2COperationalExceptionsModule } from '../operations/d2c-operational-exceptions.module';
import { FieldD2COverviewController } from './field-d2c-overview.controller';
import { FieldD2COverviewService } from './field-d2c-overview.service';

/**
 * Sprint 38 — Field Operations & Collection Point Mobile Experience
 * (docs/domains/d2c.md). Purely a read-aggregation layer — no providers of its own
 * beyond the service, no repository, no table. Imports `SalesModule` (`SalesOrderRepository`),
 * `CollectionPointFulfillmentModule` (`CollectionPointFulfillmentRepository`, exported
 * Sprint 38 for exactly this), `OutletModule` (`OutletRepository`), and `HrModule`
 * (`EmployeeService`, the SAME narrow, read-only cross-domain exception `SalesModule`
 * already established in Sprint 25.1 for `OWN_TEAM` scope resolution — never a
 * repository, never a write). `AuthModule` for `JwtAuthGuard`'s `TOKEN_SERVICE`,
 * matching every other controller-bearing D2C module.
 */
@Module({
  imports: [
    IdentityModule,
    AuthModule,
    SalesModule,
    CollectionPointFulfillmentModule,
    OutletModule,
    HrModule,
    D2COperationalExceptionsModule,
  ],
  controllers: [FieldD2COverviewController],
  providers: [FieldD2COverviewService],
})
export class FieldD2COverviewModule {}
