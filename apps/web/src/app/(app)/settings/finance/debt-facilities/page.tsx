'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button } from '@zentuva/ui';

import { FinanceTabs } from '@/components/app/finance-tabs';
import { ApiError } from '@/lib/api-client';
import { formatCurrency } from '@/lib/format-currency';

import { listDebtFacilities, listLenders, type DebtFacility } from '../api';
import {
  DEBT_FACILITY_STATUS_LABELS,
  DEBT_FACILITY_STATUS_VARIANT,
  DEBT_TYPE_LABELS,
} from '../labels';
import { DebtFacilityDialog } from './debt-facility-dialog';

/**
 * Debt Facilities (Sprint 17, docs/domains/debt-management.md §6) — every
 * financing agreement, across every lifecycle stage. `PROPOSED` facilities
 * already carry a full generated schedule but contribute nothing to the
 * live Cashflow Forecast/GL/debt balance until a real drawdown activates
 * them — the facility itself doubles as the "financing scenario" concept.
 */
export default function DebtFacilitiesPage() {
  const [createOpen, setCreateOpen] = useState(false);
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['debt-facilities'],
    queryFn: () => listDebtFacilities(),
  });
  const facilities = useMemo(() => data?.items ?? [], [data]);

  const { data: lendersData } = useQuery({ queryKey: ['lenders'], queryFn: () => listLenders() });
  const lendersById = useMemo(
    () => new Map((lendersData?.items ?? []).map((lender) => [lender.id, lender])),
    [lendersData],
  );

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Finance</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Financing agreements — a facility must be actually drawn down before it affects cash,
            the General Ledger, or the Cashflow Forecast.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>Add Debt Facility</Button>
      </div>

      <FinanceTabs />

      {isLoading && (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading debt facilities…</p>
      )}
      {isError && (
        <p className="py-10 text-center text-sm text-destructive">
          {error instanceof ApiError ? error.message : 'Failed to load debt facilities.'}
        </p>
      )}
      {!isLoading && !isError && facilities.length === 0 && (
        <p className="py-10 text-center text-sm text-muted-foreground">
          No debt facilities yet — add one to start tracking a loan or credit line.
        </p>
      )}

      {!isLoading && !isError && facilities.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/50 text-left">
              <tr>
                <th className="px-4 py-3 font-medium">Facility</th>
                <th className="px-4 py-3 font-medium">Lender</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 text-right font-medium">Principal</th>
                <th className="px-4 py-3 text-right font-medium">Rate</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Open</th>
              </tr>
            </thead>
            <tbody>
              {facilities.map((facility: DebtFacility) => (
                <tr key={facility.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3">
                    <div className="font-medium">{facility.name}</div>
                    <div className="font-mono text-xs text-muted-foreground">
                      {facility.facilityCode}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {lendersById.get(facility.lenderId)?.name ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {DEBT_TYPE_LABELS[facility.debtType]}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {formatCurrency(facility.principalAmount, facility.currency)}
                  </td>
                  <td className="px-4 py-3 text-right">{facility.interestRatePercent}%</td>
                  <td className="px-4 py-3">
                    <Badge variant={DEBT_FACILITY_STATUS_VARIANT[facility.status]}>
                      {DEBT_FACILITY_STATUS_LABELS[facility.status]}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/settings/finance/debt-facilities/${facility.id}`}
                      className="text-xs text-primary hover:underline"
                    >
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {createOpen && (
        <DebtFacilityDialog
          onOpenChange={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false);
            refetch();
          }}
        />
      )}
    </main>
  );
}
