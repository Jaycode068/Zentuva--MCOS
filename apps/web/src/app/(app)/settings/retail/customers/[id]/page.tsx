'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  cn,
} from '@zentuva/ui';
import Link from 'next/link';

import { ApiError } from '@/lib/api-client';
import { formatCurrency } from '@/lib/format-currency';
import { getWorkspaceSettings } from '@/lib/settings';
import { ExportButton } from '@/components/reporting/export-button';
import { PeriodSelector } from '@/components/reporting/period-selector';
import { ReportError, ReportLoading, ReportEmpty } from '@/components/reporting/report-states';
import { ReportPagination } from '@/components/reporting/report-data-table';
import { SummaryCard } from '@/components/reporting/summary-card';
import {
  customerStatementExportPath,
  getCustomerAccountOverview,
  getCustomerOutstandingInvoices,
  getCustomerPaymentHistory,
  getCustomerStatement,
  getCustomerTransactionHistory,
  type ComparisonMode,
  type ReportingPeriodPreset,
} from '@/app/(app)/reports/api';
import { getCustomer, updateCustomerCredit } from '../../api';
import {
  CUSTOMER_STATUS_LABELS,
  CUSTOMER_STATUS_VARIANT,
  CUSTOMER_TYPE_LABELS,
} from '../../labels';

type TabId = 'overview' | 'transactions' | 'invoices' | 'payments' | 'statement' | 'credit';

const TABS: { id: TabId; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'transactions', label: 'Transaction History' },
  { id: 'invoices', label: 'Invoices' },
  { id: 'payments', label: 'Payments' },
  { id: 'statement', label: 'Statement' },
];

const CREDIT_STATUS_LABELS: Record<string, string> = {
  NO_LIMIT: 'No limit configured',
  WITHIN_LIMIT: 'Within limit',
  APPROACHING_LIMIT: 'Approaching limit',
  AT_OR_OVER_LIMIT: 'At or over limit',
};

const CREDIT_STATUS_VARIANT: Record<string, 'default' | 'success' | 'warning' | 'destructive'> = {
  NO_LIMIT: 'default',
  WITHIN_LIMIT: 'success',
  APPROACHING_LIMIT: 'warning',
  AT_OR_OVER_LIMIT: 'destructive',
};

/**
 * Customer Account page (Phase 1 — Customer Account Management, docs/customer-
 * account-inventory-audit.md §3 "Feature A"). Reachable from the Customers tab on
 * `/settings/retail` (a "View Account" row action). Every figure here is server-
 * composed by `CustomerAccountReportService`/`CustomerStatementReportService` —
 * this page performs NO calculation of its own beyond formatting, the same rule
 * every other report page in this codebase already follows.
 *
 * A `null` section (`summary`/`credit`) means the viewer lacks that section's own
 * existing Finance permission — rendered by omitting it, never a fabricated zero
 * or a 403 for the whole page (brief §8/§9).
 */
export default function CustomerAccountPage({ params }: { params: { id: string } }) {
  const customerId = params.id;
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [preset, setPreset] = useState<ReportingPeriodPreset>('this_month');
  const [comparison, setComparison] = useState<ComparisonMode>('none');

  const { data: workspace } = useQuery({
    queryKey: ['workspace-settings-for-customer-account'],
    queryFn: getWorkspaceSettings,
    staleTime: 5 * 60 * 1000,
  });
  const currency = workspace?.currency ?? 'NGN';
  const money = (value: number) => formatCurrency(value, currency);

  const { data: customer } = useQuery({
    queryKey: ['customer', customerId],
    queryFn: () => getCustomer(customerId),
  });

  const {
    data: overview,
    isLoading: overviewLoading,
    isError: overviewError,
  } = useQuery({
    queryKey: ['customer-account-overview', customerId, preset, comparison],
    queryFn: () => getCustomerAccountOverview(customerId, { preset, comparison }),
  });

  const canManageCredit = overview?.credit?.canManageCredit ?? false;
  const tabs = canManageCredit
    ? [...TABS, { id: 'credit' as const, label: 'Credit Settings' }]
    : TABS;

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-6 space-y-2">
        <Link href="/settings/retail" className="text-xs text-muted-foreground hover:underline">
          ← Retail Network
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold">
                {customer?.customerName ?? 'Customer Account'}
              </h1>
              {customer && (
                <Badge variant={CUSTOMER_STATUS_VARIANT[customer.status]}>
                  {CUSTOMER_STATUS_LABELS[customer.status]}
                </Badge>
              )}
            </div>
            {customer && (
              <p className="text-sm text-muted-foreground">
                {customer.customerCode} · {CUSTOMER_TYPE_LABELS[customer.customerType]}
              </p>
            )}
          </div>
          <PeriodSelector
            preset={preset}
            comparison={comparison}
            onChange={(p, c) => {
              setPreset(p);
              setComparison(c);
            }}
            showComparison={false}
          />
        </div>
      </div>

      <div className="mb-6 flex gap-1 border-b border-border">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              activeTab === tab.id
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
            aria-current={activeTab === tab.id ? 'page' : undefined}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {overviewLoading && <ReportLoading />}
      {overviewError && <ReportError message="Failed to load this customer's account." />}

      {overview && (
        <>
          {activeTab === 'overview' && <OverviewTab overview={overview} money={money} />}
          {activeTab === 'transactions' && (
            <TransactionsTab customerId={customerId} money={money} />
          )}
          {activeTab === 'invoices' && <InvoicesTab customerId={customerId} money={money} />}
          {activeTab === 'payments' && <PaymentsTab customerId={customerId} money={money} />}
          {activeTab === 'statement' && (
            <StatementTab customerId={customerId} money={money} preset={preset} />
          )}
          {activeTab === 'credit' && canManageCredit && (
            <CreditSettingsTab
              customerId={customerId}
              currentLimit={overview.credit?.creditLimit ?? null}
            />
          )}
        </>
      )}
    </main>
  );
}

function OverviewTab({
  overview,
  money,
}: {
  overview: NonNullable<Awaited<ReturnType<typeof getCustomerAccountOverview>>>;
  money: (value: number) => string;
}) {
  const { profile, summary, credit } = overview;

  return (
    <div className="space-y-6">
      {credit && credit.status !== 'NO_LIMIT' && credit.status !== 'WITHIN_LIMIT' && (
        <div
          className={cn(
            'rounded-md border px-4 py-3 text-sm',
            credit.status === 'AT_OR_OVER_LIMIT'
              ? 'border-destructive/50 bg-destructive/10 text-destructive'
              : 'border-amber-500/50 bg-amber-500/10 text-amber-700',
          )}
        >
          <strong>{CREDIT_STATUS_LABELS[credit.status]}.</strong> Outstanding balance{' '}
          {money(credit.totalOutstanding)} against a configured limit of{' '}
          {money(credit.creditLimit!)}. This is a warning only — it does not block orders, invoices,
          or payments.
        </div>
      )}

      {summary && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <SummaryCard label="Invoiced This Period" value={money(summary.totalInvoicedInPeriod)} />
          <SummaryCard
            label="Payments Received"
            value={money(summary.totalPaymentsReceivedInPeriod)}
          />
          <SummaryCard
            label="Current Outstanding"
            value={money(summary.currentOutstandingReceivable)}
          />
          <SummaryCard
            label="Overdue"
            value={money(summary.overdueReceivable)}
            favorableDirection="down"
          />
          <SummaryCard
            label="Outstanding Invoices"
            value={String(summary.outstandingInvoiceCount)}
          />
          <SummaryCard
            label="Overdue Invoices"
            value={String(summary.overdueInvoiceCount)}
            favorableDirection="down"
          />
          {summary.pendingSalesOrderCount !== null && (
            <SummaryCard label="Pending Orders" value={String(summary.pendingSalesOrderCount)} />
          )}
          {summary.unfulfilledSalesOrderValue !== null && (
            <SummaryCard
              label="Unfulfilled Order Value"
              value={money(summary.unfulfilledSalesOrderValue)}
            />
          )}
        </div>
      )}

      {credit && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Credit Exposure
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div>
              <p className="text-xs text-muted-foreground">Credit Limit</p>
              <p className="text-lg font-semibold">
                {credit.creditLimit === null ? 'Not configured' : money(credit.creditLimit)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Available Credit</p>
              <p className="text-lg font-semibold">
                {credit.availableCredit === null ? '—' : money(credit.availableCredit)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Status</p>
              <Badge variant={CREDIT_STATUS_VARIANT[credit.status]}>
                {CREDIT_STATUS_LABELS[credit.status]}
              </Badge>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">Profile</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
          <Field label="Contact Person" value={profile.contactPersonName} />
          <Field label="Phone" value={profile.phoneNumber} />
          <Field label="Alternate Phone" value={profile.alternatePhoneNumber} />
          <Field label="Email" value={profile.email} />
          <Field
            label="Address"
            value={
              [profile.address, profile.city, profile.state, profile.country]
                .filter(Boolean)
                .join(', ') || null
            }
          />
          <Field label="Notes" value={profile.notes} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Outlets ({profile.outlets.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {profile.outlets.length === 0 ? (
            <ReportEmpty message="No outlets recorded for this customer." />
          ) : (
            <ul className="space-y-2">
              {profile.outlets.map((outlet) => (
                <li
                  key={outlet.id}
                  className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm"
                >
                  <span>
                    {outlet.name}{' '}
                    <span className="text-muted-foreground">({outlet.outletCode})</span>
                  </span>
                  <Badge variant={outlet.status === 'ACTIVE' ? 'success' : 'default'}>
                    {outlet.status}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p>{value ?? '—'}</p>
    </div>
  );
}

const TRANSACTION_TYPE_LABELS: Record<string, string> = {
  SALES_ORDER: 'Sales Order',
  INVOICE: 'Invoice',
  PAYMENT: 'Payment',
  CREDIT_NOTE: 'Credit Note',
  RETURN: 'Return',
};

function TransactionsTab({
  customerId,
  money,
}: {
  customerId: string;
  money: (value: number) => string;
}) {
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 25;

  const { data, isLoading, isError } = useQuery({
    queryKey: ['customer-transaction-history', customerId, type, page],
    queryFn: () =>
      getCustomerTransactionHistory(customerId, { type: type || undefined, page, pageSize }),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Transaction History
        </CardTitle>
        <select
          value={type}
          onChange={(e) => {
            setType(e.target.value);
            setPage(1);
          }}
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
        >
          <option value="">All types</option>
          {Object.entries(TRANSACTION_TYPE_LABELS).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </CardHeader>
      <CardContent>
        {isLoading && <ReportLoading />}
        {isError && <ReportError message="Failed to load transaction history." />}
        {data && data.rows.length === 0 && <ReportEmpty />}
        {data && data.rows.length > 0 && (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th className="px-3 py-2 font-medium">Date</th>
                    <th className="px-3 py-2 font-medium">Type</th>
                    <th className="px-3 py-2 font-medium">Reference</th>
                    <th className="px-3 py-2 font-medium">Description</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row) => (
                    <tr key={`${row.type}-${row.id}`} className="border-b border-border/50">
                      <td className="px-3 py-2">
                        {new Date(row.date).toLocaleDateString('en-NG')}
                      </td>
                      <td className="px-3 py-2">{TRANSACTION_TYPE_LABELS[row.type] ?? row.type}</td>
                      <td className="px-3 py-2">{row.reference}</td>
                      <td className="px-3 py-2">{row.description}</td>
                      <td className="px-3 py-2">
                        <Badge variant="default">{row.status}</Badge>
                      </td>
                      <td className="px-3 py-2 text-right">
                        {row.amount === null ? '—' : money(row.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ReportPagination
              page={data.page}
              pageSize={data.pageSize}
              total={data.total}
              onPageChange={setPage}
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}

function InvoicesTab({
  customerId,
  money,
}: {
  customerId: string;
  money: (value: number) => string;
}) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['customer-outstanding-invoices', customerId],
    queryFn: () => getCustomerOutstandingInvoices(customerId),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Outstanding Invoices
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading && <ReportLoading />}
        {isError && <ReportError message="Failed to load invoices." />}
        {data === null && (
          <ReportEmpty message="You do not have permission to view this customer's invoices." />
        )}
        {data && data.length === 0 && <ReportEmpty message="No outstanding invoices." />}
        {data && data.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Invoice</th>
                  <th className="px-3 py-2 font-medium">Invoice Date</th>
                  <th className="px-3 py-2 font-medium">Due Date</th>
                  <th className="px-3 py-2 text-right font-medium">Total</th>
                  <th className="px-3 py-2 text-right font-medium">Paid</th>
                  <th className="px-3 py-2 text-right font-medium">Credited</th>
                  <th className="px-3 py-2 text-right font-medium">Outstanding</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.map((invoice) => (
                  <tr key={invoice.id} className="border-b border-border/50">
                    <td className="px-3 py-2">
                      <Link
                        href={`/settings/finance/invoices?open=${invoice.id}`}
                        className="text-primary hover:underline"
                      >
                        {invoice.invoiceCode}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      {new Date(invoice.invoiceDate).toLocaleDateString('en-NG')}
                    </td>
                    <td className="px-3 py-2">
                      {new Date(invoice.dueDate).toLocaleDateString('en-NG')}
                    </td>
                    <td className="px-3 py-2 text-right">{money(invoice.total)}</td>
                    <td className="px-3 py-2 text-right">{money(invoice.amountPaid)}</td>
                    <td className="px-3 py-2 text-right">{money(invoice.amountCredited)}</td>
                    <td className="px-3 py-2 text-right font-medium">
                      {money(invoice.amountOutstanding)}
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant={invoice.isOverdue ? 'destructive' : 'default'}>
                        {invoice.status}
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

function PaymentsTab({
  customerId,
  money,
}: {
  customerId: string;
  money: (value: number) => string;
}) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['customer-payment-history', customerId],
    queryFn: () => getCustomerPaymentHistory(customerId),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">Payment History</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading && <ReportLoading />}
        {isError && <ReportError message="Failed to load payments." />}
        {data === null && (
          <ReportEmpty message="You do not have permission to view this customer's payments." />
        )}
        {data && data.length === 0 && <ReportEmpty message="No payments recorded." />}
        {data && data.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium">Reference</th>
                  <th className="px-3 py-2 font-medium">Method</th>
                  <th className="px-3 py-2 text-right font-medium">Amount</th>
                  <th className="px-3 py-2 font-medium">Applied To</th>
                  <th className="px-3 py-2 text-right font-medium">Unallocated</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.map((payment) => (
                  <tr key={payment.id} className="border-b border-border/50">
                    <td className="px-3 py-2">
                      {new Date(payment.paymentDate).toLocaleDateString('en-NG')}
                    </td>
                    <td className="px-3 py-2">
                      {/* The Payments ledger is a flat, read-only list with no per-row
                          detail dialog (unlike Invoices/Credit Notes) — linking to the
                          general list page is the most this page's own architecture
                          supports today. */}
                      <Link
                        href="/settings/finance/payments"
                        className="text-primary hover:underline"
                      >
                        {payment.reference ?? payment.id.slice(0, 8)}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{payment.method}</td>
                    <td className="px-3 py-2 text-right">{money(payment.amount)}</td>
                    <td className="px-3 py-2">
                      {payment.allocations.length === 0
                        ? '—'
                        : payment.allocations.length === 1
                          ? `1 invoice (${money(payment.allocations[0]!.amount)})`
                          : `${payment.allocations.length} invoices`}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {payment.isFullyAllocated ? (
                        '—'
                      ) : (
                        <span className="font-medium text-amber-600">
                          {money(payment.unallocatedAmount)}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant={payment.status === 'VOIDED' ? 'destructive' : 'success'}>
                        {payment.status}
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

function StatementTab({
  customerId,
  money,
  preset,
}: {
  customerId: string;
  money: (value: number) => string;
  preset: ReportingPeriodPreset;
}) {
  const [statementPreset, setStatementPreset] = useState<ReportingPeriodPreset>(preset);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['customer-statement', customerId, statementPreset],
    queryFn: () =>
      getCustomerStatement(customerId, { preset: statementPreset, comparison: 'none' }),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Customer Statement
        </CardTitle>
        <div className="flex items-center gap-2">
          <PeriodSelector
            preset={statementPreset}
            comparison="none"
            onChange={(p) => setStatementPreset(p)}
            showComparison={false}
          />
          <ExportButton
            path={customerStatementExportPath(customerId, {
              preset: statementPreset,
              comparison: 'none',
            })}
            filename="customer-statement.csv"
          />
        </div>
      </CardHeader>
      <CardContent>
        {isLoading && <ReportLoading />}
        {isError && <ReportError message="Failed to load the statement." />}
        {data === null && (
          <ReportEmpty message="You do not have permission to view this customer's statement." />
        )}
        {data && (
          <>
            <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-2">
              <SummaryCard label="Opening Balance" value={money(data.openingBalance)} />
              <SummaryCard label="Closing Balance" value={money(data.closingBalance)} />
            </div>
            {data.lines.length === 0 ? (
              <ReportEmpty message="No transactions in this period." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-muted-foreground">
                      <th className="px-3 py-2 font-medium">Date</th>
                      <th className="px-3 py-2 font-medium">Type</th>
                      <th className="px-3 py-2 font-medium">Reference</th>
                      <th className="px-3 py-2 font-medium">Description</th>
                      <th className="px-3 py-2 text-right font-medium">Debit</th>
                      <th className="px-3 py-2 text-right font-medium">Credit</th>
                      <th className="px-3 py-2 text-right font-medium">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-border/50 bg-muted/30">
                      <td className="px-3 py-2" colSpan={6}>
                        Opening balance
                      </td>
                      <td className="px-3 py-2 text-right font-medium">
                        {money(data.openingBalance)}
                      </td>
                    </tr>
                    {data.lines.map((line, i) => (
                      <tr
                        key={`${line.type}-${line.id}-${i}`}
                        className="border-b border-border/50"
                      >
                        <td className="px-3 py-2">
                          {new Date(line.date).toLocaleDateString('en-NG')}
                        </td>
                        <td className="px-3 py-2">
                          {TRANSACTION_TYPE_LABELS[line.type] ?? line.type}
                        </td>
                        <td className="px-3 py-2">{line.reference}</td>
                        <td className="px-3 py-2">{line.description}</td>
                        <td className="px-3 py-2 text-right">
                          {line.debit > 0 ? money(line.debit) : '—'}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {line.credit > 0 ? money(line.credit) : '—'}
                        </td>
                        <td className="px-3 py-2 text-right font-medium">
                          {money(line.runningBalance)}
                        </td>
                      </tr>
                    ))}
                    <tr className="bg-muted/30">
                      <td className="px-3 py-2 font-medium" colSpan={6}>
                        Closing balance
                      </td>
                      <td className="px-3 py-2 text-right font-semibold">
                        {money(data.closingBalance)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function CreditSettingsTab({
  customerId,
  currentLimit,
}: {
  customerId: string;
  currentLimit: number | null;
}) {
  const queryClient = useQueryClient();
  const [hasLimit, setHasLimit] = useState(currentLimit !== null);
  const [value, setValue] = useState(currentLimit !== null ? String(currentLimit) : '0');
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setState('saving');
    setError(null);
    try {
      const creditLimit = hasLimit ? Number(value) : null;
      if (hasLimit && (!Number.isFinite(creditLimit) || creditLimit! < 0)) {
        throw new Error('Enter a valid, non-negative credit limit.');
      }
      await updateCustomerCredit(customerId, creditLimit);
      await queryClient.invalidateQueries({ queryKey: ['customer-account-overview', customerId] });
      setState('saved');
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Failed to save.',
      );
      setState('error');
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">Credit Settings</CardTitle>
      </CardHeader>
      <CardContent className="max-w-md space-y-4">
        <p className="text-sm text-muted-foreground">
          Warning-only: a configured limit never blocks orders, invoices, or payments. It only
          drives the exposure warning shown on this customer&apos;s Overview tab.
        </p>
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="has-limit"
            checked={hasLimit}
            onChange={(e) => setHasLimit(e.target.checked)}
          />
          <Label htmlFor="has-limit">Configure a credit limit for this customer</Label>
        </div>
        {hasLimit && (
          <div className="space-y-1.5">
            <Label>Credit Limit</Label>
            <Input
              type="number"
              min={0}
              step="0.01"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </div>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        {state === 'saved' && <p className="text-sm text-primary">Saved.</p>}
        <Button onClick={handleSave} disabled={state === 'saving'}>
          {state === 'saving' ? 'Saving…' : 'Save Credit Limit'}
        </Button>
      </CardContent>
    </Card>
  );
}
