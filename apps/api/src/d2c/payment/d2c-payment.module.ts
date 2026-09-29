import { Module } from '@nestjs/common';

import { FinanceModule } from '../../finance/finance.module';
import { IdentityModule } from '../../identity/identity.module';
import { PaymentProviderModule } from '../../payments/infrastructure/payment-provider.module';
import { SalesModule } from '../../sales/sales.module';
import { ConsumerModule } from '../consumer/consumer.module';
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
 */
@Module({
  imports: [PaymentProviderModule, FinanceModule, SalesModule, ConsumerModule, IdentityModule],
  providers: [D2CPaymentService],
  exports: [D2CPaymentService],
})
export class D2CPaymentModule {}
