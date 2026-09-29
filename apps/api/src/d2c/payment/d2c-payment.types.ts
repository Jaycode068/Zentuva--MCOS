/**
 * Sprint 35 — D2C OPay Payment Integration (docs/domains/d2c.md "Payment
 * Architecture"). The channel-neutral contract between the Conversation
 * Layer and `D2CPaymentService` — a future WhatsApp adapter and the
 * Sprint 42 simulator both operate on exactly these shapes, never a raw
 * `Payment`/OPay response. Mirrors `d2c-ordering.types.ts`'s own
 * "server-constructed, plain TS types" convention exactly.
 */

export type D2CPaymentStatus = 'PENDING' | 'SUCCESS' | 'FAILED' | 'CLOSED';

/** Returned by `initiatePayment` — the client/conversation receives only
 *  what it needs to continue payment (brief "PAYMENT CREATION FLOW"),
 *  never a Secret Key, a Public Key, a raw internal id it doesn't need, or
 *  a provider authentication header. */
export interface D2CPaymentResult {
  paymentReference: string;
  orderReference: string;
  amount: number;
  currency: string;
  status: D2CPaymentStatus;
  /** Only set once the gateway has actually returned one (`status ===
   *  'PENDING'` on a fresh or reused attempt) — absent once a payment has
   *  already resolved to `SUCCESS`/`FAILED`/`CLOSED`. */
  checkoutUrl?: string;
}

/** Thrown when the order this payment is for isn't in a payable state
 *  (already confirmed/cancelled, or not a D2C order at all). */
export class OrderNotPayableError extends Error {}

/** Thrown when the configured payment gateway is temporarily unavailable
 *  or rejected the request for a reason the consumer can safely be told
 *  about in generic terms only (brief "ERROR HANDLING"). */
export class PaymentProviderError extends Error {}
