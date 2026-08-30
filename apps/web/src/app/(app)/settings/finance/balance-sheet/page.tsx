'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button, Input } from '@zentuva/ui';

import { FinanceTabs } from '@/components/app/finance-tabs';
import { ApiError } from '@/lib/api-client';
import { formatCurrency } from '@/lib/format-currency';
import { toDateInputValue } from '@/lib/report-date-range';

import { AccountActivityDialog } from '../account-activity-dialog';
import { getBalanceSheet, getInventoryReconciliation, type FinancialStatementLine } from '../api';

/**
 * Balance Sheet (Sprint 13, docs/domains/accounting.md §16.1) — Assets/Liabilities/
 * recorded Equity derived from cumulative posted Journal Entries since inception;
 * "Retained Earnings (Undistributed)" is a *computed* line (all-time net profit
 * through `asOf`), never a posted account — see `FinancialStatementService`'s own
 * doc comment for why. `Assets = Liabilities + Equity` holds by construction; the
 * page surfaces the raw `difference` rather than assuming it's always zero.
 */
export default function BalanceSheetPage() {
  const [asOf, setAsOf] = useState(() => toDateInputValue(new Date()));
  const [activeAccount, setActiveAccount] = useState<string | null>(null);

  const {
    data: sheet,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['balance-sheet', asOf],
    queryFn: () => getBalanceSheet({ asOf }),
  });
  const { data: reconciliation } = useQuery({
    queryKey: ['inventory-reconciliation'],
    queryFn: () => getInventoryReconciliation(),
  });

  return (
    <main className="mx-auto max-w-5xl px-6 py-10 print:max-w-full print:px-0">
      <div className="mb-8 flex items-center justify-between print:hidden">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Finance</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            What the business owns, owes, and is worth as of a point in time.
          </p>
        </div>
        <Button variant="outline" onClick={() => window.print()}>
          Print
        </Button>
      </div>

      <div className="print:hidden">
        <FinanceTabs />
      </div>

      <div className="mb-4 flex items-center gap-3 print:hidden">
        <label className="text-sm text-muted-foreground">As of</label>
        <Input
          type="date"
          value={asOf}
          onChange={(event) => setAsOf(event.target.value)}
          className="max-w-[10rem]"
        />
      </div>

      {isLoading && <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>}
      {isError && (
        <p className="py-10 text-center text-sm text-destructive">
          {error instanceof ApiError ? error.message : 'Failed to load Balance Sheet.'}
        </p>
      )}

      {sheet && (
        <>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <tbody>
                <SectionHeader label="Assets" />
                {sheet.assetLines.map((line) => (
                  <LineRow
                    key={line.accountId}
                    line={line}
                    onSelect={() => setActiveAccount(line.accountId)}
                  />
                ))}
                <TotalRow label="Total Assets" value={sheet.assets} bold />

                <SectionHeader label="Liabilities" />
                {sheet.liabilityLines.map((line) => (
                  <LineRow
                    key={line.accountId}
                    line={line}
                    onSelect={() => setActiveAccount(line.accountId)}
                  />
                ))}
                <TotalRow label="Total Liabilities" value={sheet.liabilities} bold />

                <SectionHeader label="Equity" />
                {sheet.equityLines.map((line) => (
                  <LineRow
                    key={line.accountId}
                    line={line}
                    onSelect={() => setActiveAccount(line.accountId)}
                  />
                ))}
                <tr className="border-b border-border">
                  <td className="px-4 py-2 pl-8 text-muted-foreground" colSpan={2}>
                    Retained Earnings (Undistributed)
                  </td>
                  <td className="px-4 py-2 text-right">
                    {formatCurrency(sheet.retainedEarnings, 'NGN')}
                  </td>
                </tr>
                <TotalRow label="Total Equity" value={sheet.totalEquity} bold />

                <TotalRow
                  label="Total Liabilities + Equity"
                  value={sheet.liabilities + sheet.totalEquity}
                  bold
                />
              </tbody>
            </table>
          </div>

          <div
            className={`mt-4 rounded-md border p-3 text-sm ${
              sheet.balanced
                ? 'border-success/40 bg-success/10 text-success'
                : 'border-destructive/40 bg-destructive/10 text-destructive'
            }`}
          >
            {sheet.balanced
              ? 'Balanced — Assets = Liabilities + Equity.'
              : `Out of balance — difference of ${formatCurrency(sheet.difference, 'NGN')}.`}
          </div>
        </>
      )}

      {reconciliation && (
        <div className="mt-6 rounded-lg border border-dashed border-border p-4 print:hidden">
          <p className="mb-2 text-sm font-medium text-foreground">
            Inventory-to-Ledger Reconciliation
          </p>
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Inventory Subledger</p>
              <p className="font-medium">
                {formatCurrency(reconciliation.inventorySubledgerValue, 'NGN')}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">GL Inventory Balance</p>
              <p className="font-medium">
                {formatCurrency(reconciliation.glInventoryBalance, 'NGN')}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Difference</p>
              <p className={`font-medium ${reconciliation.reconciled ? '' : 'text-destructive'}`}>
                {formatCurrency(reconciliation.difference, 'NGN')}
              </p>
            </div>
          </div>
          {!reconciliation.reconciled && (
            <Badge variant="warning" className="mt-3">
              Requires investigation — figures are reported, never auto-corrected.
            </Badge>
          )}
        </div>
      )}

      {activeAccount && (
        <AccountActivityDialog
          accountId={activeAccount}
          to={asOf}
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

function TotalRow({ label, value, bold }: { label: string; value: number; bold?: boolean }) {
  return (
    <tr className={`border-b border-border ${bold ? 'font-semibold' : ''}`}>
      <td className="px-4 py-2" colSpan={2}>
        {label}
      </td>
      <td className="px-4 py-2 text-right">{formatCurrency(value, 'NGN')}</td>
    </tr>
  );
}
