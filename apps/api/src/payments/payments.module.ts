import { Module } from '@nestjs/common';

import { D2CPaymentModule } from '../d2c/payment/d2c-payment.module';
import { PaymentProviderModule } from './infrastructure/payment-provider.module';
import { PaymentWebhookController } from './payment-webhook.controller';

/**
 * Sprint 35 — D2C OPay Payment Integration. The public HTTP surface for
 * provider callbacks/return-URL status — `PaymentWebhookController` is the
 * ONLY controller here; `D2CPaymentModule` (which owns the actual business
 * logic) has none of its own, mirroring `D2COrderingModule`'s own
 * "no controller, consumed only through the Conversation Layer" shape
 * (Sprint 34) — this module exists purely because a provider callback and
 * a return-URL page redirect both need a real, public route, which nothing
 * under `d2c/` has ever needed before.
 *
 * Deliberately does NOT call `ThrottlerModule.forRoot(...)` again —
 * `RecruitmentModule` (Sprint 30) already registered it as a `@Global()`
 * module for `CareersController`'s own rate limiting; `ThrottlerGuard` is
 * therefore already available here. This controller's `@Throttle(...)`
 * decorators override the global default per-route regardless.
 */
@Module({
  imports: [D2CPaymentModule, PaymentProviderModule],
  controllers: [PaymentWebhookController],
})
export class PaymentsModule {}
