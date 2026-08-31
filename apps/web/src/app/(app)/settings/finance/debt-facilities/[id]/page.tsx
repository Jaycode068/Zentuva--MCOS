'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Select,
} from '@zentuva/ui';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { FinanceTabs } from '@/components/app/finance-tabs';
import { ApiError } from '@/lib/api-client';
import { formatCurrency } from '@/lib/format-currency';

import {
  approveDebtFacility,
  cancelDebtFacility,
  createDebtDrawdown,
  createDebtRepayment,
  getDebtFacility,
  getDebtFacilitySchedule,
  listCashAccounts,
  listChartOfAccounts,
  markDebtFacilityDefaulted,
  previewFacilityImpact,
} from '../../api';
import {
  DEBT_FACILITY_STATUS_LABELS,
  DEBT_FACILITY_STATUS_VARIANT,
  DEBT_SCHEDULE_STATUS_LABELS,
  DEBT_SCHEDULE_STATUS_VARIANT,
  DEBT_TYPE_LABELS,
  REPAYMENT_FREQUENCY_LABELS,
  REPAYMENT_METHOD_LABELS,
} from '../../labels';

/**
 * Debt Facility detail (Sprint 17, docs/domains/debt-management.md) —
 * balance summary (always computed live, never stored), the repayment
 * schedule, drawdown/repayment recording forms, lifecycle actions, and —
 * for a not-yet-active `PROPOSED` facility — a Preview Cashflow Impact
 * panel. Every number here is a planning signal, never a recommendation
 * ("this loan is safe" is explicitly out of scope, §23).
 */
export default function DebtFacilityDetailPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const queryClient = useQueryClient();

  const { data: facility } = useQuery({
    queryKey: ['debt-facility', id],
    queryFn: () => getDebtFacility(id),
  });
  const { data: scheduleData } = useQuery({
    queryKey: ['debt-facility-schedule', id],
    queryFn: () => getDebtFacilitySchedule(id),
  });
  const schedule = scheduleData?.items ?? [];

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['debt-facility', id] });
    queryClient.invalidateQueries({ queryKey: ['debt-facility-schedule', id] });
    queryClient.invalidateQueries({ queryKey: ['debt-facilities'] });
  };

  const lifecycleMutation = useMutation({
    mutationFn: (action: 'approve' | 'cancel' | 'mark-defaulted') => {
      if (action === 'approve') return approveDebtFacility(id);
      if (action === 'cancel') return cancelDebtFacility(id);
      return markDebtFacilityDefaulted(id);
    },
    onSuccess: invalidateAll,
  });

  if (!facility) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-10">
        <p className="text-sm text-muted-foreground">Loading debt facility…</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{facility.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {facility.facilityCode} · {DEBT_TYPE_LABELS[facility.debtType]} ·{' '}
            {REPAYMENT_METHOD_LABELS[facility.repaymentMethod]} ·{' '}
            {REPAYMENT_FREQUENCY_LABELS[facility.repaymentFrequency]}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant={DEBT_FACILITY_STATUS_VARIANT[facility.status]}>
            {DEBT_FACILITY_STATUS_LABELS[facility.status]}
          </Badge>
          {facility.status === 'PROPOSED' && (
            <Button
              onClick={() => lifecycleMutation.mutate('approve')}
              disabled={lifecycleMutation.isPending}
            >
              Approve
            </Button>
          )}
          {(facility.status === 'PROPOSED' || facility.status === 'APPROVED') && (
            <Button
              variant="outline"
              onClick={() => lifecycleMutation.mutate('cancel')}
              disabled={lifecycleMutation.isPending}
            >
              Cancel
            </Button>
          )}
          {(facility.status === 'ACTIVE' || facility.status === 'PARTIALLY_REPAID') && (
            <Button
              variant="outline"
              onClick={() => lifecycleMutation.mutate('mark-defaulted')}
              disabled={lifecycleMutation.isPending}
            >
              Mark Defaulted
            </Button>
          )}
        </div>
      </div>

      <FinanceTabs />

      {lifecycleMutation.isError && (
        <p className="mb-6 text-sm text-destructive">
          {lifecycleMutation.error instanceof ApiError
            ? lifecycleMutation.error.message
            : 'Failed to update facility.'}
        </p>
      )}

      <BalanceSummary facility={facility} />

      <ScheduleTable schedule={schedule} currency={facility.currency} />

      {(facility.status === 'APPROVED' ||
        facility.status === 'ACTIVE' ||
        facility.status === 'PARTIALLY_REPAID') && (
        <div className="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
          {(facility.status === 'APPROVED' || facility.status === 'ACTIVE') && (
            <RecordDrawdownForm
              facilityId={id}
              facilityStatus={facility.status}
              principalAmount={facility.principalAmount}
              totalDrawn={facility.balance.totalDrawn}
              onSaved={invalidateAll}
            />
          )}
          {(facility.status === 'ACTIVE' || facility.status === 'PARTIALLY_REPAID') && (
            <RecordRepaymentForm facilityId={id} onSaved={invalidateAll} />
          )}
        </div>
      )}

      {facility.status === 'PROPOSED' && (
        <PreviewImpactPanel facilityId={id} currency={facility.currency} />
      )}
    </main>
  );
}

function BalanceSummary({
  facility,
}: {
  facility: {
    currency: string;
    principalAmount: number;
    balance: {
      totalDrawn: number;
      outstandingPrincipal: number;
      outstandingInterest: number;
      totalOutstanding: number;
    };
  };
}) {
  return (
    <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
      <SummaryCard
        title="Original Principal"
        value={facility.principalAmount}
        currency={facility.currency}
      />
      <SummaryCard
        title="Total Drawn"
        value={facility.balance.totalDrawn}
        currency={facility.currency}
      />
      <SummaryCard
        title="Outstanding Principal"
        value={facility.balance.outstandingPrincipal}
        currency={facility.currency}
      />
      <SummaryCard
        title="Total Outstanding"
        value={facility.balance.totalOutstanding}
        currency={facility.currency}
      />
    </div>
  );
}

function SummaryCard({
  title,
  value,
  currency,
}: {
  title: string;
  value: number;
  currency: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xs font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-lg font-semibold">{formatCurrency(value, currency)}</p>
      </CardContent>
    </Card>
  );
}

function ScheduleTable({
  schedule,
  currency,
}: {
  schedule: {
    id: string;
    installmentNumber: number;
    dueDate: string;
    principalDue: number;
    interestDue: number;
    totalDue: number;
    amountPaid: number;
    status: string;
  }[];
  currency: string;
}) {
  return (
    <Card className="mb-8">
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Repayment Schedule
        </CardTitle>
      </CardHeader>
      <CardContent>
        {schedule.length === 0 ? (
          <p className="text-sm text-muted-foreground">No schedule generated.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-1.5 pr-3 font-medium">#</th>
                  <th className="py-1.5 pr-3 font-medium">Due Date</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Principal</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Interest</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Total</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Paid</th>
                  <th className="py-1.5 text-right font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {schedule.map((row) => (
                  <tr key={row.id} className="border-t border-border/60">
                    <td className="py-1.5 pr-3">{row.installmentNumber}</td>
                    <td className="py-1.5 pr-3">{new Date(row.dueDate).toLocaleDateString()}</td>
                    <td className="py-1.5 pr-3 text-right">
                      {formatCurrency(row.principalDue, currency)}
                    </td>
                    <td className="py-1.5 pr-3 text-right">
                      {formatCurrency(row.interestDue, currency)}
                    </td>
                    <td className="py-1.5 pr-3 text-right font-medium">
                      {formatCurrency(row.totalDue, currency)}
                    </td>
                    <td className="py-1.5 pr-3 text-right">
                      {formatCurrency(row.amountPaid, currency)}
                    </td>
                    <td className="py-1.5 text-right">
                      <Badge
                        variant={
                          DEBT_SCHEDULE_STATUS_VARIANT[
                            row.status as keyof typeof DEBT_SCHEDULE_STATUS_VARIANT
                          ]
                        }
                      >
                        {
                          DEBT_SCHEDULE_STATUS_LABELS[
                            row.status as keyof typeof DEBT_SCHEDULE_STATUS_LABELS
                          ]
                        }
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RecordDrawdownForm({
  facilityId,
  facilityStatus,
  principalAmount,
  totalDrawn,
  onSaved,
}: {
  facilityId: string;
  facilityStatus: string;
  principalAmount: number;
  totalDrawn: number;
  onSaved: () => void;
}) {
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [cashAccountId, setCashAccountId] = useState('');
  const [amount, setAmount] = useState('');
  const [drawdownDate, setDrawdownDate] = useState('');
  const [reference, setReference] = useState('');

  const { data: cashAccountsData } = useQuery({
    queryKey: ['cash-accounts', 'ACTIVE'],
    queryFn: () => listCashAccounts({ status: 'ACTIVE' }),
  });
  const cashAccounts = cashAccountsData?.items ?? [];

  const remaining = Math.max(0, principalAmount - totalDrawn);

  const mutation = useMutation({
    mutationFn: () =>
      createDebtDrawdown(facilityId, {
        cashAccountId,
        amount: Number(amount),
        drawdownDate,
        reference: reference || undefined,
        idempotencyKey,
      }),
    onSuccess: () => {
      setAmount('');
      setReference('');
      setIdempotencyKey(crypto.randomUUID());
      onSaved();
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">Record Drawdown</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Approved does not mean received — record each actual disbursement separately. Remaining
          undrawn: {formatCurrency(remaining, 'NGN')}.
        </p>
        <div className="space-y-1.5">
          <Label>Cash Account</Label>
          <Select value={cashAccountId} onChange={(event) => setCashAccountId(event.target.value)}>
            <option value="">Select…</option>
            {cashAccounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Amount</Label>
            <Input
              type="number"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Date</Label>
            <Input
              type="date"
              value={drawdownDate}
              onChange={(event) => setDrawdownDate(event.target.value)}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Reference (optional)</Label>
          <Input value={reference} onChange={(event) => setReference(event.target.value)} />
        </div>
        {mutation.isError && (
          <p className="text-sm text-destructive">
            {mutation.error instanceof ApiError
              ? mutation.error.message
              : 'Failed to record drawdown.'}
          </p>
        )}
        <Button
          disabled={!cashAccountId || !amount || !drawdownDate || mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          {mutation.isPending
            ? 'Recording…'
            : facilityStatus === 'APPROVED'
              ? 'Record Drawdown (Activates Facility)'
              : 'Record Drawdown'}
        </Button>
      </CardContent>
    </Card>
  );
}

function RecordRepaymentForm({ facilityId, onSaved }: { facilityId: string; onSaved: () => void }) {
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [cashAccountId, setCashAccountId] = useState('');
  const [paymentDate, setPaymentDate] = useState('');
  const [principalAmount, setPrincipalAmount] = useState('');
  const [interestAmount, setInterestAmount] = useState('');
  const [feeAmount, setFeeAmount] = useState('');
  const [feeExpenseAccountId, setFeeExpenseAccountId] = useState('');
  const [reference, setReference] = useState('');

  const { data: cashAccountsData } = useQuery({
    queryKey: ['cash-accounts', 'ACTIVE'],
    queryFn: () => listCashAccounts({ status: 'ACTIVE' }),
  });
  const cashAccounts = cashAccountsData?.items ?? [];

  const { data: expenseAccountsData } = useQuery({
    queryKey: ['chart-of-accounts', 'EXPENSE'],
    queryFn: () => listChartOfAccounts({ type: 'EXPENSE', isActive: true }),
  });
  const expenseAccounts = (expenseAccountsData?.items ?? []).filter(
    (account) => !account.isSystemAccount,
  );

  const fee = Number(feeAmount) || 0;

  const mutation = useMutation({
    mutationFn: () =>
      createDebtRepayment(facilityId, {
        cashAccountId,
        paymentDate,
        principalAmount: Number(principalAmount) || 0,
        interestAmount: Number(interestAmount) || 0,
        feeAmount: fee,
        feeExpenseAccountId: fee > 0 ? feeExpenseAccountId : undefined,
        reference: reference || undefined,
        idempotencyKey,
      }),
    onSuccess: () => {
      setPrincipalAmount('');
      setInterestAmount('');
      setFeeAmount('');
      setReference('');
      setIdempotencyKey(crypto.randomUUID());
      onSaved();
    },
  });

  const canSubmit =
    !!cashAccountId &&
    !!paymentDate &&
    (Number(principalAmount) || 0) + (Number(interestAmount) || 0) + fee > 0 &&
    (fee === 0 || !!feeExpenseAccountId);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Record Repayment
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Principal, interest, and fees are always recorded separately — never one collapsed amount.
          A repayment beyond outstanding principal/interest is rejected server-side.
        </p>
        <div className="space-y-1.5">
          <Label>Cash Account</Label>
          <Select value={cashAccountId} onChange={(event) => setCashAccountId(event.target.value)}>
            <option value="">Select…</option>
            {cashAccounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Payment Date</Label>
          <Input
            type="date"
            value={paymentDate}
            onChange={(event) => setPaymentDate(event.target.value)}
          />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label>Principal</Label>
            <Input
              type="number"
              value={principalAmount}
              onChange={(event) => setPrincipalAmount(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Interest</Label>
            <Input
              type="number"
              value={interestAmount}
              onChange={(event) => setInterestAmount(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Fee</Label>
            <Input
              type="number"
              value={feeAmount}
              onChange={(event) => setFeeAmount(event.target.value)}
            />
          </div>
        </div>
        {fee > 0 && (
          <div className="space-y-1.5">
            <Label>Fee Expense Account</Label>
            <Select
              value={feeExpenseAccountId}
              onChange={(event) => setFeeExpenseAccountId(event.target.value)}
            >
              <option value="">Select…</option>
              {expenseAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.code} {account.name}
                </option>
              ))}
            </Select>
          </div>
        )}
        <div className="space-y-1.5">
          <Label>Reference (optional)</Label>
          <Input value={reference} onChange={(event) => setReference(event.target.value)} />
        </div>
        {mutation.isError && (
          <p className="text-sm text-destructive">
            {mutation.error instanceof ApiError
              ? mutation.error.message
              : 'Failed to record repayment.'}
          </p>
        )}
        <Button disabled={!canSubmit || mutation.isPending} onClick={() => mutation.mutate()}>
          {mutation.isPending ? 'Recording…' : 'Record Repayment'}
        </Button>
      </CardContent>
    </Card>
  );
}

function PreviewImpactPanel({ facilityId, currency }: { facilityId: string; currency: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['debt-facility-preview-impact', facilityId],
    queryFn: () => previewFacilityImpact(facilityId),
  });

  if (isLoading || isError || !data) {
    return null;
  }

  const chartData = data.periods.map((period) => ({
    name: period.label,
    'Projected Closing Cash': period.projectedClosingBalance,
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Preview Cashflow Impact
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-xs text-muted-foreground">
          A planning preview only — overlays this facility&apos;s own schedule onto the real
          Cashflow Forecast, reusing Sprint 15&apos;s engine unmodified. This is not a
          recommendation and does not state whether the business should take this loan.
        </p>
        {data.potentialCashflowPressure && (
          <p className="mb-3 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning-foreground">
            Potential cashflow pressure — projected cash would fall below the configured minimum
            reserve ({formatCurrency(data.minimumCashReserve, currency)}) in at least one period if
            this facility is activated.
          </p>
        )}
        <div className="mb-4 h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis
                tick={{ fontSize: 11 }}
                tickFormatter={(value) => formatCurrency(value, currency)}
                width={90}
              />
              <Tooltip formatter={(value) => formatCurrency(Number(value), currency)} />
              <Bar
                dataKey="Projected Closing Cash"
                fill="hsl(var(--primary))"
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="py-1.5 pr-3 font-medium">Period</th>
                <th className="py-1.5 pr-3 text-right font-medium">Base Closing</th>
                <th className="py-1.5 pr-3 text-right font-medium">Additional Debt Service</th>
                <th className="py-1.5 text-right font-medium">Projected Closing</th>
              </tr>
            </thead>
            <tbody>
              {data.periods.map((period) => (
                <tr key={period.label} className="border-t border-border/60">
                  <td className="py-1.5 pr-3">{period.label}</td>
                  <td className="py-1.5 pr-3 text-right">
                    {formatCurrency(period.baseClosingBalance, currency)}
                  </td>
                  <td className="py-1.5 pr-3 text-right">
                    {formatCurrency(period.additionalDebtService, currency)}
                  </td>
                  <td className="py-1.5 text-right">
                    {period.belowMinimumReserve ? (
                      <Badge variant="destructive">
                        {formatCurrency(period.projectedClosingBalance, currency)}
                      </Badge>
                    ) : (
                      formatCurrency(period.projectedClosingBalance, currency)
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
