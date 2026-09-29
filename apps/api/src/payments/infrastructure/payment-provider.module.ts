import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { PAYMENT_PROVIDER } from '../ports/payment-provider.port';
import { OpayPaymentProvider } from './opay-payment-provider';

/**
 * Sprint 35 — D2C OPay Payment Integration. Provides {@link PAYMENT_PROVIDER},
 * mirroring `WhatsAppProviderModule`/`EmailProviderModule` exactly: a DI
 * token resolved once at app boot, so nothing downstream ever imports
 * `OpayPaymentProvider` directly. Unlike WhatsApp/Email (which have a safe
 * `local` mode for environments with no credentials configured), this
 * sprint's OPay integration has exactly one real implementation — the
 * same "fail loudly at boot with a clear message, never a route that
 * quietly no-ops" convention `MetaWhatsAppProvider` already established
 * (Sprint 29 §25) applies directly: if `OPAY_MERCHANT_ID`/`OPAY_PUBLIC_KEY`/
 * `OPAY_SECRET_KEY` are missing, the app refuses to start rather than
 * booting into a payment integration that would silently fail every real
 * attempt.
 */
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: PAYMENT_PROVIDER,
      useFactory: (config: ConfigService) => new OpayPaymentProvider(config),
      inject: [ConfigService],
    },
  ],
  exports: [PAYMENT_PROVIDER],
})
export class PaymentProviderModule {}
