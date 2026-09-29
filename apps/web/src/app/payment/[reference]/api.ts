import { apiFetch } from '@/lib/api-client';

/**
 * Sprint 35 — D2C OPay Payment Integration (docs/domains/d2c.md "Return
 * URL"). Fully public — `apiFetch` works unauthenticated fine, exactly the
 * same precedent `apps/web/src/app/careers/api.ts` already established
 * (Sprint 30). The backend route (`GET /api/payments/opay/:reference/status`)
 * is gated only by knowledge of the unguessable `reference`, never a
 * session — a Consumer (Sprint 32) has none to present.
 */

export type PublicPaymentStatus = 'PENDING' | 'SUCCESS' | 'FAILED' | 'CLOSED';

export interface PublicPaymentResult {
  paymentReference: string;
  orderReference: string;
  amount: number;
  currency: string;
  status: PublicPaymentStatus;
}

export function getPublicPaymentStatus(reference: string) {
  return apiFetch<PublicPaymentResult>(`/payments/opay/${reference}/status`);
}
