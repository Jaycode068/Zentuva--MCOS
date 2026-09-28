import { Module } from '@nestjs/common';

import { ProductModule } from '../../catalogue/product/product.module';
import { IdentityModule } from '../../identity/identity.module';
import { SalesModule } from '../../sales/sales.module';
import { ConsumerModule } from '../consumer/consumer.module';
import { D2COrderingService } from './d2c-ordering.service';

/**
 * Sprint 34 — D2C Consumer Ordering (docs/domains/d2c.md). Imports `ProductModule` (for
 * `ProductRepository` — browsing/validating SKUs, the EXISTING catalogue, never a second
 * one), `SalesModule` (for `SalesOrderService.createForConsumer` — the EXISTING Sales
 * Order domain, never a second order-creation path), `ConsumerModule` (for
 * `ConsumerService` — the EXISTING Sprint 32 Consumer, never converted into a
 * `Customer`), and `IdentityModule` (for `OrganisationService.currency`, the tenant's
 * own currency configuration — never a hardcoded "NGN").
 *
 * No controller: this module has no public HTTP surface of its own. The only caller is
 * `ConversationModule` (Sprint 33) — the architecture this sprint's brief itself
 * describes: `Conversation Layer -> D2C Ordering Service -> Existing Sales Order`. No
 * `WorkflowModule`/`NotificationsModule` import, and no import of anything WhatsApp-
 * specific — see `d2c-ordering-independence.spec.ts`.
 */
@Module({
  imports: [ProductModule, SalesModule, ConsumerModule, IdentityModule],
  providers: [D2COrderingService],
  exports: [D2COrderingService],
})
export class D2COrderingModule {}
