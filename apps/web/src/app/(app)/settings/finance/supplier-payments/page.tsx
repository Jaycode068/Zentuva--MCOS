'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button } from '@zentuva/ui';

import { FinanceTabs } from '@/components/app/finance-tabs';
import { ApiError } from '@/lib/api-client';
import { formatCurrency } from '@/lib/format-currency';

import { listSupplierPayments, voidSupplierPayment } from '../api';
import { PAYMENT_METHOD_LABELS } from '../labels';

/** Flat, read-only supplier payment ledger across every supplier invoice (Sprint 12,
 *  docs/domains/finance.md "Accounts Payable") — direct structural mirror of
 *  `payments/page.tsx`. "Record Payment" itself lives on the Supplier Invoice detail
 *  dialog, in context of a specific invoice, same convention as the customer side. */
export default function SupplierPaymentsPage() {
  const queryClient = useQueryClient();
  const [voidingId, setVoidingId] = useState<string | null>(null);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['supplier-payments'],
    queryFn: () => listSupplierPayments(),
  });
  const payments = useMemo(() => data?.items ?? [], [data]);

  const voidMutation = useMutation({
    mutationFn: (id: string) => voidSupplierPayment(id),
    onMutate: (id) => setVoidingId(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['supplier-payments'] });
      queryClient.invalidateQueries({ queryKey: ['supplier-invoices'] });
      queryClient.invalidateQueries({ queryKey: ['ap-summary'] });
      setVoidingId(null);
    },
    onError: () => setVoidingId(null),
  });

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Finance</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every payment recorded against a supplier invoice, across every supplier.
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
                  <th className="px-4 py-3 font-medium">Supplier</th>
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
                    <td className="px-4 py-3">{payment.supplier.supplierName}</td>
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
                          disabled={voidMutation.isPending && voidingId === payment.id}
                          onClick={() => voidMutation.mutate(payment.id)}
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
              <div key={payment.id} className="rounded-lg border border-border p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-foreground">
                    {payment.supplier.supplierName}
                  </span>
                  <Badge variant={payment.status === 'VOIDED' ? 'destructive' : 'success'}>
                    {payment.status === 'VOIDED' ? 'Voided' : 'Recorded'}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {new Date(payment.paymentDate).toLocaleDateString()} ·{' '}
                  {PAYMENT_METHOD_LABELS[payment.method]}
                </p>
                <p className="mt-1 font-medium">
                  {formatCurrency(payment.amount, payment.currency)}
                </p>
              </div>
            ))}
          </div>
        </>
      )}
    </main>
  );
}
