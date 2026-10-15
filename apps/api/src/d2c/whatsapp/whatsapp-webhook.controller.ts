import { createHmac, timingSafeEqual } from 'node:crypto';

import {
  Controller,
  Get,
  HttpCode,
  Logger,
  Post,
  Query,
  RawBodyRequest,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Request, Response } from 'express';

import { assertWebhookSignatureConfigured } from '../../notifications/infrastructure/meta-whatsapp-provider';
import { WhatsAppInboundAdapterService } from './whatsapp-inbound-adapter.service';
import { MetaWebhookPayload } from './whatsapp.types';

/**
 * Sprint 40.5 — Real Meta WhatsApp Cloud API Foundation (docs/domains/whatsapp.md
 * "Webhook"). Route is the brief's own EXACT literal path — `GET`/`POST
 * /api/whatsapp/webhook` — rather than nested under `d2c/*`, since this is almost
 * certainly already entered verbatim as the Callback URL in the Meta App Dashboard
 * (the brief explicitly references a template "already tested manually from the Meta
 * dashboard").
 *
 * Deliberately NO `@UseGuards(JwtAuthGuard)` — the exact `PaymentWebhookController`
 * precedent (Sprint 35): Meta's servers have no Zentuva session. Authenticity for the
 * `GET` handshake is `hub.verify_token`; for `POST` deliveries it is Meta's own
 * `X-Hub-Signature-256` HMAC (computed with the Meta APP SECRET — a different
 * credential from `WHATSAPP_TOKEN`). Stage 5C.1 — this is now fail-closed for any
 * deployment that claims to talk to real Meta (`WHATSAPP_PROVIDER_MODE=meta`): the
 * constructor's `assertWebhookSignatureConfigured` call refuses to let the app even
 * start without `WHATSAPP_APP_SECRET` configured in that mode. The local/development
 * provider mode keeps a safe, explicitly-logged bypass — see `verifySignature`'s own
 * doc comment.
 *
 * `POST` always returns `200` once past signature verification, even when business
 * logic inside `WhatsAppInboundAdapterService` fails for an individual message — the
 * same "never let a webhook provider's retry logic hammer a call that can never
 * succeed" reasoning `PaymentWebhookController.webhook` already documents, now with
 * most of the hard work (idempotency, tenant resolution) happening per-message so one
 * bad message in a batch never sinks the rest.
 */
@Controller('whatsapp')
export class WhatsAppWebhookController {
  private readonly logger = new Logger(WhatsAppWebhookController.name);

  constructor(
    private readonly config: ConfigService,
    private readonly inboundAdapter: WhatsAppInboundAdapterService,
  ) {
    // Stage 5C.1 — fail the whole app at boot, never a request, if this deployment
    // claims to talk to real Meta (`WHATSAPP_PROVIDER_MODE=meta`) without the one
    // credential that makes inbound webhook verification possible. See
    // `assertWebhookSignatureConfigured`'s own doc comment for the full rationale.
    assertWebhookSignatureConfigured(config);
  }

  /** Meta's one-time (and re-verifiable any time the Callback URL is re-saved in the
   *  dashboard) subscription handshake. Must echo back `hub.challenge` as the EXACT,
   *  unquoted raw response body — `@Res()` bypasses Nest's default JSON serialization,
   *  which would otherwise double-quote a returned string. */
  @Get('webhook')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  verify(
    @Query('hub.mode') mode: string | undefined,
    @Query('hub.verify_token') verifyToken: string | undefined,
    @Query('hub.challenge') challenge: string | undefined,
    @Res() res: Response,
  ): void {
    const expected = this.config.get<string | undefined>('whatsapp.webhookVerifyToken');
    if (mode === 'subscribe' && expected && verifyToken === expected) {
      res.status(200).send(challenge ?? '');
      return;
    }
    this.logger.warn('Rejected a WhatsApp webhook verification attempt (mode/token mismatch)');
    res.status(403).send('Forbidden');
  }

  @Post('webhook')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async receive(@Req() req: RawBodyRequest<Request>, @Res() res: Response): Promise<void> {
    const rawBody = req.rawBody?.toString('utf-8') ?? JSON.stringify(req.body ?? {});
    const signatureHeader = req.headers['x-hub-signature-256'];
    const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;

    if (!this.verifySignature(rawBody, signature)) {
      this.logger.warn('Rejected a WhatsApp webhook delivery with an invalid signature');
      res.status(403).send({ received: false });
      return;
    }

    try {
      const payload = req.body as MetaWebhookPayload;
      await this.inboundAdapter.handleWebhookPayload(payload);
    } catch (error) {
      // Never let a processing error surface as a non-200 — Meta would otherwise
      // redeliver the exact same payload indefinitely (brief "receive text/delivery-
      // status/read-receipts" — never a route that can get the whole tenant's webhook
      // stuck retrying forever because of one bad message).
      this.logger.error(
        'Unhandled error processing a WhatsApp webhook delivery',
        error instanceof Error ? error.stack : String(error),
      );
    }
    res.status(200).send({ received: true });
  }

  /** Verifies Meta's `X-Hub-Signature-256` (`sha256=<hex hmac>` over the raw body,
   *  keyed by the Meta APP SECRET).
   *
   *  Stage 5C.1 — fail-closed when no secret is configured: the constructor's
   *  `assertWebhookSignatureConfigured` call already guarantees a secret exists
   *  whenever `WHATSAPP_PROVIDER_MODE=meta` (the app would have failed to start
   *  otherwise), so reaching this branch with mode `meta` should be unreachable in
   *  practice — but this method never trusts that invariant blindly; it re-checks the
   *  mode itself and REJECTS rather than accepts if it is ever somehow still true.
   *  The bypass below is reachable ONLY when `WHATSAPP_PROVIDER_MODE=local` (the safe
   *  development provider, which can never receive genuine Meta traffic in the first
   *  place) — explicitly logged as such every time, never silent. */
  private verifySignature(rawBody: string, signatureHeader: string | undefined): boolean {
    const appSecret = this.config.get<string | undefined>('whatsapp.appSecret');
    if (!appSecret) {
      const mode = this.config.get<'local' | 'meta'>('whatsapp.providerMode') ?? 'local';
      if (mode === 'meta') {
        // Defensive — should be unreachable; the constructor already fails the app at
        // boot in this exact configuration. Fail closed anyway, never accept.
        this.logger.error(
          'WHATSAPP_APP_SECRET is missing while WHATSAPP_PROVIDER_MODE=meta — rejecting this webhook delivery. This should be impossible; the app should have failed to start.',
        );
        return false;
      }
      this.logger.warn(
        'WHATSAPP_APP_SECRET is not configured — webhook signature verification is DISABLED for this delivery. This is safe only because WHATSAPP_PROVIDER_MODE=local (the development provider, never reachable by real Meta traffic). Set WHATSAPP_APP_SECRET before switching WHATSAPP_PROVIDER_MODE=meta.',
      );
      return true;
    }
    if (!signatureHeader?.startsWith('sha256=')) {
      return false;
    }
    const expected = createHmac('sha256', appSecret).update(rawBody, 'utf-8').digest('hex');
    const provided = signatureHeader.slice('sha256='.length);
    if (expected.length !== provided.length) {
      return false;
    }
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(provided, 'hex'));
  }
}
