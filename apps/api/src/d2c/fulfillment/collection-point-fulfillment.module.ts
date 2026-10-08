import { Module } from '@nestjs/common';

import { AuthModule } from '../../identity/auth/auth.module';
import { IdentityModule } from '../../identity/identity.module';
import { InventoryModule } from '../../inventory/inventory.module';
import { OutletModule } from '../../retail/outlet/outlet.module';
import { SalesModule } from '../../sales/sales.module';
import { ConsumerModule } from '../consumer/consumer.module';
import { D2CConversationConfigModule } from '../conversation-config/d2c-conversation-config.module';
import { D2CMessagingModule } from '../messaging/d2c-messaging.module';
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
 * the same pattern). `InventoryModule` is added Sprint 38 — the Field Collection Point
 * inventory view (`getInventoryViewForOutlet`) reads via the EXISTING
 * `InventoryStockRepository`, never a new stock-reading mechanism; `OutletModule`
 * already imports `InventoryModule` itself but does not re-export it, so this module
 * needs its own direct import to inject the same repository. Exports the service so
 * `D2CPaymentModule` can call `autoAssign()` right after a verified payment.
 *
 * `D2CMessagingModule` added Sprint 42 — the channel-neutral `CONSUMER_NOTIFICATION_PORT`
 * (docs/domains/d2c.md "Fulfilment Notifications") this service calls at
 * READY_FOR_COLLECTION/COLLECTED, never importing anything WhatsApp-specific itself —
 * see `collection-point-fulfillment-independence.spec.ts`.
 *
 * `D2CConversationConfigModule` added Sprint 44 — `notifyReady`/`notifyCollected` now
 * resolve their message TEXT from the same tenant configuration resolver
 * `ConversationService` uses (docs/domains/d2c.md "Tenant Conversation Configuration"),
 * replacing the hardcoded strings those two methods used to build directly.
 */
@Module({
  imports: [
    IdentityModule,
    AuthModule,
    OutletModule,
    SalesModule,
    ConsumerModule,
    InventoryModule,
    D2CMessagingModule,
    D2CConversationConfigModule,
  ],
  controllers: [CollectionPointFulfillmentController],
  providers: [CollectionPointFulfillmentRepository, CollectionPointFulfillmentService],
  // Sprint 38 — the repository is also exported (alongside the service) so
  // `FieldD2COverviewService` can batch-read fulfilment status for a territory-scoped
  // list of orders via `findManyBySalesOrderIds`, mirroring how `SalesOrderRepository`/
  // `SalesFulfilmentRepository` are already both exported from `SalesModule` for the
  // exact same reason — a read-only, cross-cutting query need, never a second business
  // logic layer.
  exports: [CollectionPointFulfillmentService, CollectionPointFulfillmentRepository],
})
export class CollectionPointFulfillmentModule {}
