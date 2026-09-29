import { createHmac, timingSafeEqual } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  CallbackVerificationOutcome,
  CreateProviderPaymentRequest,
  CreateProviderPaymentResult,
  PaymentProvider,
  ProviderCallbackStatus,
} from '../ports/payment-provider.port';

export interface OpayConfig {
  apiBaseUrl: string;
  merchantId: string;
  publicKey: string;
  secretKey: string;
}

/** Thrown at construction time — never at request time — when a required
 *  OPay environment variable is missing. Same "fail loudly at boot, never
 *  a route that quietly no-ops" convention as `WhatsAppConfigurationError`
 *  (Sprint 29). Lists only WHICH variables are missing, never any value. */
export class OpayConfigurationError extends Error {}

export function loadOpayConfig(config: ConfigService): OpayConfig {
  const apiBaseUrl = config.get<string | undefined>('opay.apiBaseUrl');
  const merchantId = config.get<string | undefined>('opay.merchantId');
  const publicKey = config.get<string | undefined>('opay.publicKey');
  const secretKey = config.get<string | undefined>('opay.secretKey');

  const missing: string[] = [];
  if (!apiBaseUrl) missing.push('OPAY_API_BASE_URL');
  if (!merchantId) missing.push('OPAY_MERCHANT_ID');
  if (!publicKey) missing.push('OPAY_PUBLIC_KEY');
  if (!secretKey) missing.push('OPAY_SECRET_KEY');
  if (missing.length > 0) {
    throw new OpayConfigurationError(
      `OPay payment integration requires the following environment variable(s), which are missing or empty: ${missing.join(', ')}.`,
    );
  }

  return {
    apiBaseUrl: apiBaseUrl!,
    merchantId: merchantId!,
    publicKey: publicKey!,
    secretKey: secretKey!,
  };
}

/** OPay's own documented error codes (brief "ERROR HANDLING") mapped to a
 *  short, safe internal classification — never surfaced to a consumer
 *  verbatim. */
const OPAY_ERROR_CODES: Record<string, string> = {
  '02000': 'OPAY_AUTH_FAILED',
  '02001': 'OPAY_INVALID_PARAMS',
  '02002': 'OPAY_MERCHANT_NOT_CONFIGURED',
  '02003': 'OPAY_PAY_METHOD_NOT_SUPPORTED',
  '02004': 'OPAY_DUPLICATE_REFERENCE',
  '02007': 'OPAY_MERCHANT_UNAVAILABLE',
  '50003': 'OPAY_SERVICE_UNAVAILABLE',
};

/** OPay's own documented Cashier statuses (brief "PAYMENT STATES") mapped
 *  to the provider-neutral shape `PaymentProvider.verifyCallback` returns —
 *  the ONLY place this mapping lives; `D2CPaymentService` never sees an
 *  OPay status string. Anything not in this list is deliberately `UNKNOWN`,
 *  never silently treated as `SUCCESS` (brief "CALLBACK VALIDATION §6"). */
const OPAY_STATUS_MAP: Record<string, ProviderCallbackStatus> = {
  INITIAL: 'PENDING',
  PENDING: 'PENDING',
  SUCCESS: 'SUCCESS',
  FAIL: 'FAILED',
  CLOSE: 'CLOSED',
};

/**
 * Sprint 35 — D2C OPay Payment Integration (docs/domains/d2c.md "Payment
 * Architecture"). The one place OPay's wire format exists in this codebase —
 * mirrors `MetaWhatsAppProvider`'s exact shape (Sprint 29): construction-time
 * config validation, Node's built-in `fetch`, no OPay SDK, every error
 * mapped to a short safe code before it ever leaves this file.
 *
 * Security: never logs `OPAY_SECRET_KEY`/`OPAY_PUBLIC_KEY`, never includes
 * either in a thrown/returned error, never echoes a raw OPay response body.
 *
 * **Documented ambiguity (brief's own "OPay REQUEST AUTHENTICATION"
 * §)**: OPay's documentation discusses request signing generally but the
 * concrete Cashier-create header example it gives is `Authorization: Bearer
 * {PublicKey}` + `MerchantId: {MerchantId}` only — no per-request
 * `Signature` header on CREATE. This implementation follows that concrete
 * example; the CALLBACK, by contrast, IS signed (`verifyCallback` below).
 * This split was verified against real sandbox behaviour during this
 * sprint's live testing — see docs/sprint-35-completion-report.md "Live
 * Sandbox Verification."
 */
@Injectable()
export class OpayPaymentProvider implements PaymentProvider {
  readonly name = 'opay';
  private readonly logger = new Logger(OpayPaymentProvider.name);
  private readonly cfg: OpayConfig;

  constructor(config: ConfigService) {
    this.cfg = loadOpayConfig(config);
    this.logger.log(
      'OPay payment provider configured (base URL configured: yes, merchant id configured: yes, keys configured: yes).',
    );
  }

  async createPayment(request: CreateProviderPaymentRequest): Promise<CreateProviderPaymentResult> {
    if (request.currency !== 'NGN') {
      // OPay Cashier's `country: 'NG'` route (this integration's only
      // configured route) settles in NGN — never sent to OPay at all for
      // any other currency (brief "CURRENCY").
      return {
        outcome: 'REJECTED',
        errorCode: 'OPAY_UNSUPPORTED_CURRENCY',
        errorMessage: `OPay is only configured for NGN payments (requested: ${request.currency}).`,
      };
    }

    const url = `${this.cfg.apiBaseUrl}/api/v1/international/cashier/create`;
    const body = {
      country: 'NG',
      reference: request.reference,
      // Sprint 35 "PAYMENT AMOUNT" — OPay's own documentation states the
      // amount is in the currency's minor unit (kobo for NGN); this is the
      // ONE conversion boundary between Zentuva's major-unit Float and
      // OPay's minor-unit integer — see `toMinorUnits` below. Never done
      // anywhere else in this codebase.
      amount: { total: toMinorUnits(request.amount), currency: request.currency },
      returnUrl: request.returnUrl,
      callbackUrl: request.callbackUrl,
      cancelUrl: request.cancelUrl,
      displayName: request.displayName,
      customerVisitSource: 'WEB',
      userInfo: {
        userId: request.customer.reference,
        userName: request.customer.name,
        userMobile: request.customer.phoneNumber,
      },
      product: { name: request.productDescription, description: request.productDescription },
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.cfg.publicKey}`,
          MerchantId: this.cfg.merchantId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        code?: string;
        message?: string;
        data?: { reference?: string; orderNo?: string; cashierUrl?: string };
      };

      if (response.ok && payload.code === '00000' && payload.data?.cashierUrl) {
        this.logger.debug(`OPay cashier created for reference ${request.reference}`);
        return {
          outcome: 'CREATED',
          checkoutUrl: payload.data.cashierUrl,
          providerReference: payload.data.orderNo,
        };
      }

      return this.mapErrorResponse(response.status, payload.code, request.reference);
    } catch (error) {
      const name = error instanceof Error ? error.name : 'unknown';
      this.logger.warn(`OPay create-payment failed (network error): ${name}`);
      return {
        outcome: 'UNAVAILABLE',
        errorCode: 'OPAY_NETWORK',
        errorMessage: 'Network error contacting OPay.',
      };
    }
  }

  /**
   * Sprint 35 "CALLBACK SECURITY". OPay's documented callback body carries
   * the actual transaction data inside a `payload` object, alongside a
   * `sha512` field — the HMAC-SHA512 of that payload (JSON-serialized),
   * keyed with the merchant's Secret Key. Recomputed here and compared in
   * constant time; a callback that fails this check is NEVER handed to
   * business logic (brief: "A callback must pass authenticity and business
   * validation before changing financial state").
   *
   * **Documented for live verification**: the exact byte-for-byte
   * serialization OPay signed against (key order/whitespace) can only be
   * confirmed against a real sandbox callback — see
   * docs/sprint-35-completion-report.md "Live Sandbox Verification."
   */
  verifyCallback(
    rawBody: string,
    _headers: Record<string, string | undefined>,
  ): CallbackVerificationOutcome {
    let parsed: { payload?: Record<string, unknown>; sha512?: string };
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      return { valid: false, reason: 'Malformed callback body (not valid JSON).' };
    }

    if (!parsed.payload || typeof parsed.sha512 !== 'string') {
      return { valid: false, reason: 'Callback body is missing payload/sha512.' };
    }

    const expected = createHmac('sha512', this.cfg.secretKey)
      .update(JSON.stringify(parsed.payload))
      .digest('hex');
    if (!safeCompare(expected, parsed.sha512.toLowerCase())) {
      this.logger.warn('OPay callback signature verification failed');
      return { valid: false, reason: 'Signature verification failed.' };
    }

    const data = parsed.payload as {
      reference?: string;
      orderNo?: string;
      status?: string;
      amount?: { total?: number; currency?: string };
    };
    if (
      !data.reference ||
      !data.orderNo ||
      !data.amount?.currency ||
      typeof data.amount.total !== 'number'
    ) {
      return { valid: false, reason: 'Callback payload is missing required fields.' };
    }

    return {
      valid: true,
      callback: {
        reference: data.reference,
        providerReference: data.orderNo,
        amount: fromMinorUnits(data.amount.total),
        currency: data.amount.currency,
        status: OPAY_STATUS_MAP[data.status ?? ''] ?? 'UNKNOWN',
      },
    };
  }

  private mapErrorResponse(
    httpStatus: number,
    code: string | undefined,
    reference: string,
  ): CreateProviderPaymentResult {
    const errorCode = (code && OPAY_ERROR_CODES[code]) || 'OPAY_UNKNOWN';
    this.logger.warn(
      `OPay create-payment failed for reference ${reference}: category=${errorCode} httpStatus=${httpStatus} opayCode=${code ?? 'n/a'}`,
    );

    if (code === '02004') {
      return {
        outcome: 'DUPLICATE_REFERENCE',
        errorCode,
        errorMessage: 'This reference already exists.',
      };
    }
    if (code === '50003' || httpStatus >= 500) {
      return {
        outcome: 'UNAVAILABLE',
        errorCode,
        errorMessage: 'OPay is temporarily unavailable.',
      };
    }
    return {
      outcome: 'REJECTED',
      errorCode,
      errorMessage: 'OPay rejected the payment request.',
    };
  }
}

/** Sprint 35 "PAYMENT AMOUNT" — the one explicit conversion boundary
 *  between Zentuva's major-unit `Float` (e.g. `1500.5` = ₦1,500.50) and
 *  OPay's minor-unit integer (kobo). `Math.round` guards against
 *  floating-point representation error in the multiplication itself (e.g.
 *  `19.99 * 100` can yield `1998.9999999999998` in raw JS) — never trusted
 *  unrounded, the same defensive convention `roundCurrency` already uses
 *  throughout this codebase. */
export function toMinorUnits(majorUnitAmount: number): number {
  return Math.round(majorUnitAmount * 100);
}

/** The inverse of {@link toMinorUnits} — used to translate a callback's
 *  reported amount back into Zentuva's own major-unit representation for
 *  comparison against `Payment.amount`. */
export function fromMinorUnits(minorUnitAmount: number): number {
  return Math.round(minorUnitAmount) / 100;
}

function safeCompare(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'utf-8');
  const bufferB = Buffer.from(b, 'utf-8');
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}
