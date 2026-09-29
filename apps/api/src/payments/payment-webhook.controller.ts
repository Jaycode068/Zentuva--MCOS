import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  Inject,
  Logger,
  Param,
  Post,
  RawBodyRequest,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Request } from 'express';

import { D2CPaymentService } from '../d2c/payment/d2c-payment.service';
import { PAYMENT_PROVIDER, PaymentProvider } from './ports/payment-provider.port';

/**
 * Sprint 35 — D2C OPay Payment Integration (docs/domains/d2c.md "Webhook").
 * Deliberately NO `@UseGuards(JwtAuthGuard)` anywhere on this controller —
 * fully public, the exact `CareersController` precedent (Sprint 30): OPay's
 * servers have no Zentuva session, and the return-URL page has no consumer
 * login to present either (Sprint 32's Consumer has none). Both routes are
 * safe without authentication because:
 *  - the webhook is authenticated by its own HMAC signature instead (never
 *    trusted on `status === SUCCESS` alone — see `D2CPaymentService
 *    .handleProviderCallback`), and
 *  - the status route only ever returns already-non-sensitive fields,
 *    gated by knowledge of an unguessable, globally-unique reference — the
 *    same "public but only reachable via an opaque id" shape the public
 *    careers page already established.
 *
 * Rate-limited via the SAME `@nestjs/throttler` mechanism `CareersController
 * .apply` already introduced (Sprint 30) — no new rate-limiting
 * infrastructure.
 */
@Controller('payments/opay')
export class PaymentWebhookController {
  private readonly logger = new Logger(PaymentWebhookController.name);

  constructor(
    @Inject(PAYMENT_PROVIDER) private readonly paymentProvider: PaymentProvider,
    private readonly d2cPaymentService: D2CPaymentService,
  ) {}

  /**
   * `POST /api/payments/opay/webhook`. Verifies the callback's signature
   * BEFORE any business logic runs (brief "CALLBACK SECURITY") — an
   * invalid signature is rejected here, in the transport layer, and never
   * reaches `D2CPaymentService` at all. A signature-valid callback that
   * fails a later business check (unknown reference, amount/currency
   * mismatch, already-resolved payment) still returns `200` — OPay's own
   * retry behaviour would otherwise keep re-sending a callback that can
   * never succeed, and the rejection is already safely logged/audited by
   * `handleProviderCallback` itself.
   */
  @Post('webhook')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async webhook(@Req() req: RawBodyRequest<Request>): Promise<{ received: boolean }> {
    const rawBody = req.rawBody?.toString('utf-8') ?? JSON.stringify(req.body ?? {});
    const headers: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      headers[key] = Array.isArray(value) ? value[0] : value;
    }

    const outcome = this.paymentProvider.verifyCallback(rawBody, headers);
    if (!outcome.valid) {
      // Never echo the reason back to the caller — it's already logged
      // server-side by `verifyCallback`/the caller below.
      this.logger.warn('Rejected an OPay callback with an invalid signature or malformed body');
      throw new BadRequestException('Invalid callback');
    }

    await this.d2cPaymentService.handleProviderCallback(outcome);
    return { received: true };
  }

  /**
   * `GET /api/payments/opay/:reference/status` — the return-URL page's own
   * query (brief "RETURN URL"). Returns only what a consumer's own browser
   * already implicitly knows from having just been on the OPay checkout
   * page: the order/payment reference, amount, currency, and CURRENT
   * verified status — never anything that would let this route double as
   * an account/order browser.
   */
  @Get(':reference/status')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  status(@Param('reference') reference: string) {
    return this.d2cPaymentService.getPublicPaymentStatus(reference);
  }
}
