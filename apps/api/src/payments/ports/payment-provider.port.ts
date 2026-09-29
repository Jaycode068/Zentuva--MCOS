/**
 * Sprint 35 — D2C OPay Payment Integration (docs/domains/d2c.md "Payment
 * Architecture"). Mirrors `WhatsAppProvider`/`EmailProvider` exactly: an
 * interface + a DI token, so `D2CPaymentService` never knows or cares
 * whether it's talking to OPay or a future second gateway — selected once,
 * in `payment-provider.module.ts`. The contract carries only what
 * `D2CPaymentService` actually needs; no OPay-specific JSON shape leaks
 * past this file (brief: "The Finance domain should not become tightly
 * coupled to OPay-specific JSON structures").
 */

/** A request to create a payment attempt. `amount` is ALWAYS the
 *  server-authoritative major-unit amount (e.g. `1500` for ₦1,500) — the
 *  provider implementation owns the one conversion boundary into whatever
 *  minor-unit/integer representation the gateway itself expects
 *  (docs/domains/d2c.md "Money Representation"). `reference` is Zentuva's
 *  own deterministic `merchantReference`, never regenerated per attempt. */
export interface CreateProviderPaymentRequest {
  reference: string;
  amount: number;
  currency: string;
  returnUrl: string;
  callbackUrl: string;
  cancelUrl: string;
  displayName: string;
  customer: {
    /** Never a real login identity — Sprint 32's Consumer has none. A
     *  stable, non-sensitive id the provider can echo back, nothing more. */
    reference: string;
    name: string;
    /** Already-normalized E.164 (Sprint 29's `normalizePhoneNumber`) —
     *  this port never receives a raw, unnormalized number. */
    phoneNumber: string;
  };
  productDescription: string;
}

export type ProviderPaymentOutcome = 'CREATED' | 'DUPLICATE_REFERENCE' | 'REJECTED' | 'UNAVAILABLE';

export interface CreateProviderPaymentResult {
  outcome: ProviderPaymentOutcome;
  /** Only set when `outcome === 'CREATED'`. OPay's own `cashierUrl` —
   *  never a URL Zentuva constructs itself (brief "CHECKOUT URL"). */
  checkoutUrl?: string;
  /** Only set when `outcome === 'CREATED'`. The gateway's own identifier
   *  (OPay's `orderNo`). */
  providerReference?: string;
  /** A short, safe classification — never a raw provider error object,
   *  never a credential. */
  errorCode?: string;
  errorMessage?: string;
}

export type ProviderCallbackStatus = 'PENDING' | 'SUCCESS' | 'FAILED' | 'CLOSED' | 'UNKNOWN';

/** The provider-neutral shape `D2CPaymentService` reasons about once a
 *  callback's signature has already been verified — never the raw OPay
 *  payload past this point. */
export interface VerifiedProviderCallback {
  reference: string;
  providerReference: string;
  amount: number;
  currency: string;
  status: ProviderCallbackStatus;
}

export type CallbackVerificationOutcome =
  { valid: true; callback: VerifiedProviderCallback } | { valid: false; reason: string };

export interface PaymentProvider {
  /** Which gateway this is (`'opay'`) — stored on `Payment.provider`,
   *  never used for branching logic outside this file. */
  readonly name: string;
  createPayment(request: CreateProviderPaymentRequest): Promise<CreateProviderPaymentResult>;
  /** Verifies an inbound webhook's authenticity (signature) and parses it
   *  into a neutral shape — a callback that fails verification is never
   *  handed to business logic at all (brief "CALLBACK SECURITY"). */
  verifyCallback(
    rawBody: string,
    headers: Record<string, string | undefined>,
  ): CallbackVerificationOutcome;
}

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');
