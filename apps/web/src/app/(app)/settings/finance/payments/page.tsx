'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button } from '@zentuva/ui';

import { FinanceTabs } from '@/components/app/finance-tabs';
import { ApiError } from '@/lib/api-client';
import { formatCurrency } from '@/lib/format-currency';

import { listPayments, voidPayment } from '../api';
import { PAYMENT_METHOD_LABELS } from '../labels';

/** Flat, read-only payment ledger across every invoice (Sprint 6, docs/domains/
 *  finance.md) — the "Record Payment" action itself lives on the Invoice detail dialog,
 *  in context of a specific invoice, same convention as Distribution's "Record
 *  Delivery" living on the Dispatch detail dialog rather than a standalone create flow. */
export default function PaymentsPage() {
  const queryClient = useQueryClient();
  const [voidingId, setVoidingId] = useState<string | null>(null);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['payments'],
    queryFn: () => listPayments(),
  });
  const payments = useMemo(() => data?.items ?? [], [data]);

  const voidMutation = useMutation({
    mutationFn: (id: string) => voidPayment(id),
    onMutate: (id) => setVoidingId(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      setVoidingId(null);
    },
    onError: () => setVoidingId(null),
  });

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Finance</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every payment recorded against an invoice, across every customer.
        </p>
      </div>

      <FinanceTabs />

      {isLoading && (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading payments…</p>
      )}
      {isError && (
        <p className="py-10 text-center text-sm text-destructive">
          {error instanceof ApiError ? error.message : 'Failed to load payments.'}
        </p>
      )}
      {voidMutation.isError && (
        <p className="mb-4 text-sm text-destructive">
          {voidMutation.error instanceof ApiError
            ? voidMutation.error.message
            : 'Failed to void payment.'}
        </p>
      )}

      {!isLoading && !isError && payments.length === 0 && (
        <p className="py-10 text-center text-sm text-muted-foreground">No payments recorded yet.</p>
      )}

      {!isLoading && !isError && payments.length > 0 && (
        <>
          <div className="hidden overflow-x-auto rounded-lg border border-border md:block">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/50 text-left">
                <tr>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Customer</th>
                  <th className="px-4 py-3 font-medium">Method</th>
                  <th className="px-4 py-3 font-medium">Reference</th>
                  <th className="px-4 py-3 font-medium">Amount</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((payment) => (
                  <tr key={payment.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3">
                      {new Date(payment.paymentDate).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">{payment.customer.customerName}</td>
                    <td className="px-4 py-3">{PAYMENT_METHOD_LABELS[payment.method]}</td>
                    <td className="px-4 py-3 text-muted-foreground">{payment.reference ?? '—'}</td>
                    <td className="px-4 py-3">
                      {formatCurrency(payment.amount, payment.currency)}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={payment.status === 'VOIDED' ? 'destructive' : 'success'}>
                        {payment.status === 'VOIDED' ? 'Voided' : 'Recorded'}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {payment.status === 'RECORDED' && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => voidMutation.mutate(payment.id)}
                          disabled={voidMutation.isPending && voidingId === payment.id}
                        >
                          {voidMutation.isPending && voidingId === payment.id ? 'Voiding…' : 'Void'}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-2 md:hidden">
            {payments.map((payment) => (
              <div key={payment.id} className="rounded-lg border border-border p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    {new Date(payment.paymentDate).toLocaleDateString()} ·{' '}
                    {PAYMENT_METHOD_LABELS[payment.method]}
                  </span>
                  <Badge variant={payment.status === 'VOIDED' ? 'destructive' : 'success'}>
                    {payment.status === 'VOIDED' ? 'Voided' : 'Recorded'}
                  </Badge>
                </div>
                <p className="mt-1 text-sm font-medium">{payment.customer.customerName}</p>
                <div className="mt-1 flex items-center justify-between">
                  <span className="text-sm">
                    {formatCurrency(payment.amount, payment.currency)}
                  </span>
                  {payment.status === 'RECORDED' && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => voidMutation.mutate(payment.id)}
                      disabled={voidMutation.isPending && voidingId === payment.id}
                    >
                      {voidMutation.isPending && voidingId === payment.id ? 'Voiding…' : 'Void'}
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </main>
  );
}
