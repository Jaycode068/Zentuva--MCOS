import { Module } from '@nestjs/common';

import { FinanceModule } from '../../finance/finance.module';
import { IdentityModule } from '../../identity/identity.module';
import { PaymentProviderModule } from '../../payments/infrastructure/payment-provider.module';
import { SalesModule } from '../../sales/sales.module';
import { ConsumerModule } from '../consumer/consumer.module';
import { CollectionPointFulfillmentModule } from '../fulfillment/collection-point-fulfillment.module';
import { D2CPaymentService } from './d2c-payment.service';

/**
 * Sprint 35 — D2C OPay Payment Integration (docs/domains/d2c.md). Imports
 * `PaymentProviderModule` (for the gateway-neutral `PAYMENT_PROVIDER` —
 * OPay today, never OPay-specific code past this boundary), `FinanceModule`
 * (for `PaymentService` — the EXISTING Payment aggregate, never a second
 * one), `SalesModule` (for `SalesOrderService` — the EXISTING D2C
 * `SalesOrder`, extended in Sprint 34, never a second order-creation
 * path), and `ConsumerModule` (for `ConsumerService` — the EXISTING
 * Sprint 32 Consumer, never converted into a `Customer`).
 *
 * No controller: this module has no public HTTP surface of its own. Its
 * two callers are `ConversationModule` (Sprint 33/34, "Pay Now") and
 * `PaymentsModule`'s webhook controller (the provider callback) — the
 * exact architecture this sprint's brief describes: `Conversation Layer ->
 * D2CPaymentService -> Existing Payment/Sales Order`.
 *
 * `CollectionPointFulfillmentModule` (Sprint 37) — added so a verified payment can
 * trigger best-effort Collection Point auto-assignment immediately after
 * `SalesOrderService.confirm()` succeeds (docs/domains/d2c.md "Order Assignment Model").
 * `D2CPaymentService` itself gained zero payment-architecture changes — see
 * docs/domains/d2c.md "Payment Boundary".
 */
@Module({
  imports: [
    PaymentProviderModule,
    FinanceModule,
    SalesModule,
    ConsumerModule,
    IdentityModule,
    CollectionPointFulfillmentModule,
  ],
  providers: [D2CPaymentService],
  exports: [D2CPaymentService],
})
export class D2CPaymentModule {}
