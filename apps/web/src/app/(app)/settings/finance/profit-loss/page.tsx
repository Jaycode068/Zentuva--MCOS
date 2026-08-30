'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Input, Select } from '@zentuva/ui';

import { FinanceTabs } from '@/components/app/finance-tabs';
import { ApiError } from '@/lib/api-client';
import { formatCurrency } from '@/lib/format-currency';
import {
  REPORT_PERIOD_PRESET_LABELS,
  resolveReportDateRange,
  toDateInputValue,
  type ReportPeriodPreset,
} from '@/lib/report-date-range';

import { AccountActivityDialog } from '../account-activity-dialog';
import { getProfitAndLoss, type FinancialStatementLine } from '../api';

/**
 * Profit & Loss (Sprint 13, docs/domains/accounting.md §16.1) — derived entirely
 * from posted Journal Entries via `FinancialStatementService`, never a second,
 * independently-computed total. Follows the Trial Balance/Ledger page shape
 * (filter row → table → print), see `trial-balance/page.tsx`.
 */
export default function ProfitAndLossPage() {
  const [preset, setPreset] = useState<ReportPeriodPreset>('this_month');
  const [customFrom, setCustomFrom] = useState(() => toDateInputValue(new Date()));
  const [customTo, setCustomTo] = useState(() => toDateInputValue(new Date()));
  const [compare, setCompare] = useState(false);
  const [activeAccount, setActiveAccount] = useState<string | null>(null);

  const { from, to } =
    preset === 'custom'
      ? { from: new Date(customFrom), to: new Date(customTo) }
      : resolveReportDateRange(preset);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['profit-loss', from.toISOString(), to.toISOString(), compare],
    queryFn: () =>
      getProfitAndLoss({
        from: toDateInputValue(from),
        to: toDateInputValue(to),
        compare,
      }),
  });

  const pnl = data?.current;
  const previous = data?.previous;

  return (
    <main className="mx-auto max-w-5xl px-6 py-10 print:max-w-full print:px-0">
      <div className="mb-8 flex items-center justify-between print:hidden">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Finance</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Revenue, Cost of Sales, and Operating Expenses — derived from posted journal entries,
            reconciling exactly to the General Ledger.
          </p>
        </div>
        <Button variant="outline" onClick={() => window.print()}>
          Print
        </Button>
      </div>

      <div className="print:hidden">
        <FinanceTabs />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3 print:hidden">
        <Select
          value={preset}
          onChange={(event) => setPreset(event.target.value as ReportPeriodPreset)}
          className="max-w-[10rem]"
        >
          {Object.entries(REPORT_PERIOD_PRESET_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
        {preset === 'custom' && (
          <>
            <Input
              type="date"
              value={customFrom}
              onChange={(event) => setCustomFrom(event.target.value)}
              className="max-w-[10rem]"
            />
            <span className="text-sm text-muted-foreground">to</span>
            <Input
              type="date"
              value={customTo}
              onChange={(event) => setCustomTo(event.target.value)}
              className="max-w-[10rem]"
            />
          </>
        )}
        <label className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={compare}
            onChange={(event) => setCompare(event.target.checked)}
          />
          Compare to previous period
        </label>
      </div>

      {isLoading && <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>}
      {isError && (
        <p className="py-10 text-center text-sm text-destructive">
          {error instanceof ApiError ? error.message : 'Failed to load Profit & Loss.'}
        </p>
      )}

      {pnl && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <tbody>
              <SectionHeader label="Revenue" />
              {pnl.revenueLines.map((line) => (
                <LineRow
                  key={line.accountId}
                  line={line}
                  onSelect={() => setActiveAccount(line.accountId)}
                />
              ))}
              <TotalRow label="Total Revenue" value={pnl.revenue} previous={previous?.revenue} />

              <SectionHeader label="Cost of Sales" />
              {pnl.costOfSalesLines.map((line) => (
                <LineRow
                  key={line.accountId}
                  line={line}
                  onSelect={() => setActiveAccount(line.accountId)}
                />
              ))}
              <TotalRow
                label="Total Cost of Sales"
                value={pnl.costOfSales}
                previous={previous?.costOfSales}
              />

              <TotalRow
                label="Gross Profit"
                value={pnl.grossProfit}
                previous={previous?.grossProfit}
                bold
              />
              <tr className="border-b border-border">
                <td className="px-4 py-2 text-muted-foreground" colSpan={2}>
                  Gross Margin
                </td>
                <td className="px-4 py-2 text-right">
                  {pnl.grossMarginPercent === null ? '—' : `${pnl.grossMarginPercent.toFixed(1)}%`}
                </td>
              </tr>

              <SectionHeader label="Operating Expenses" />
              {pnl.operatingExpenseLines.map((line) => (
                <LineRow
                  key={line.accountId}
                  line={line}
                  onSelect={() => setActiveAccount(line.accountId)}
                />
              ))}
              <TotalRow
                label="Total Operating Expenses"
                value={pnl.operatingExpenses}
                previous={previous?.operatingExpenses}
              />

              <TotalRow
                label="Net Profit"
                value={pnl.netProfit}
                previous={previous?.netProfit}
                bold
              />
            </tbody>
          </table>
        </div>
      )}

      {compare && data && !previous && (
        <p className="mt-4 text-sm text-muted-foreground">
          No comparison data — the previous period has no posted activity.
        </p>
      )}

      {activeAccount && (
        <AccountActivityDialog
          accountId={activeAccount}
          from={toDateInputValue(from)}
          to={toDateInputValue(to)}
          onOpenChange={() => setActiveAccount(null)}
        />
      )}
    </main>
  );
}

function SectionHeader({ label }: { label: string }) {
  return (
    <tr className="bg-muted/50">
      <td className="px-4 py-2 font-medium text-foreground" colSpan={3}>
        {label}
      </td>
    </tr>
  );
}

function LineRow({ line, onSelect }: { line: FinancialStatementLine; onSelect: () => void }) {
  return (
    <tr className="border-b border-border last:border-0">
      <td className="px-4 py-2 pl-8">
        <button type="button" onClick={onSelect} className="text-left hover:underline">
          <span className="font-mono text-xs text-muted-foreground">{line.code}</span> {line.name}
        </button>
      </td>
      <td />
      <td className="px-4 py-2 text-right">{formatCurrency(line.amount, 'NGN')}</td>
    </tr>
  );
}

function TotalRow({
  label,
  value,
  previous,
  bold,
}: {
  label: string;
  value: number;
  previous?: number;
  bold?: boolean;
}) {
  return (
    <tr className={`border-b border-border ${bold ? 'font-semibold' : ''}`}>
      <td className="px-4 py-2" colSpan={2}>
        {label}
      </td>
      <td className="px-4 py-2 text-right">
        {formatCurrency(value, 'NGN')}
        {previous !== undefined && (
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            (prev {formatCurrency(previous, 'NGN')})
          </span>
        )}
      </td>
    </tr>
  );
}
