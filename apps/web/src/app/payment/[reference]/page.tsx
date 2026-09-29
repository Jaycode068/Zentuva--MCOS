'use client';

import { useQuery } from '@tanstack/react-query';

import { ApiError } from '@/lib/api-client';

import { getPublicPaymentStatus } from './api';

/**
 * Sprint 35 — D2C OPay Payment Integration (docs/domains/d2c.md "Return
 * URL"). OPay's `returnUrl`/`cancelUrl` both point here. Deliberately NOT
 * proof of payment on its own — arriving at this page means only that the
 * consumer left the OPay Cashier, nothing about whether they actually
 * paid; every render re-fetches the REAL, verified Zentuva payment state
 * (`GET /api/payments/opay/:reference/status`, which reflects only what a
 * verified provider callback has actually confirmed) and displays exactly
 * that. Deliberately small — this is a status page, not the Sprint 42
 * consumer-facing simulator and not an embedded payment form (OPay's own
 * Cashier already handled checkout).
 */
export default function PaymentStatusPage({ params }: { params: { reference: string } }) {
  const { reference } = params;

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['public-payment-status', reference],
    queryFn: () => getPublicPaymentStatus(reference),
    // A PENDING payment may still be resolving on OPay's own side — poll
    // gently rather than asking the consumer to keep refreshing the page.
    refetchInterval: (query) => (query.state.data?.status === 'PENDING' ? 4000 : false),
  });

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-xl font-semibold">Payment Status</h1>

      {isLoading && <p className="text-muted-foreground">Checking your payment…</p>}

      {isError && (
        <p className="text-destructive">
          {error instanceof ApiError && error.status === 404
            ? "We couldn't find this payment."
            : 'Something went wrong checking your payment. Please try again shortly.'}
        </p>
      )}

      {data && (
        <div className="w-full space-y-2 rounded-lg border border-border p-4">
          <p className="text-sm text-muted-foreground">Order {data.orderReference}</p>
          <p className="text-2xl font-semibold">
            {data.currency} {data.amount.toLocaleString()}
          </p>

          {data.status === 'SUCCESS' && (
            <p className="font-medium text-emerald-600">
              Payment successful. Your order {data.orderReference} has been paid.
            </p>
          )}
          {data.status === 'PENDING' && (
            <>
              <p className="font-medium text-amber-600">Your payment is still being confirmed.</p>
              <p className="text-sm text-muted-foreground">
                We will update your order once payment is confirmed. This page refreshes
                automatically{isFetching ? '…' : '.'}
              </p>
            </>
          )}
          {data.status === 'FAILED' && (
            <p className="font-medium text-destructive">
              Your payment was not successful. Please contact support to complete this order.
            </p>
          )}
          {data.status === 'CLOSED' && (
            <p className="font-medium text-destructive">
              Your payment session has closed. Please contact support to complete this order.
            </p>
          )}
        </div>
      )}

      {data?.status === 'PENDING' && (
        <button
          type="button"
          onClick={() => refetch()}
          className="text-sm text-primary underline underline-offset-2"
        >
          Check again now
        </button>
      )}
    </main>
  );
}
