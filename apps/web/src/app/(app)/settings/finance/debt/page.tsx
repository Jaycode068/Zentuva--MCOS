'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Badge, Card, CardContent, CardHeader, CardTitle } from '@zentuva/ui';

import { FinanceTabs } from '@/components/app/finance-tabs';
import { formatCurrency } from '@/lib/format-currency';

import { getDebtMetrics, listDebtFacilities } from '../api';
import { DEBT_FACILITY_STATUS_LABELS, DEBT_FACILITY_STATUS_VARIANT } from '../labels';

/**
 * Debt Overview dashboard (Sprint 17, docs/domains/debt-management.md
 * §25/§26) — composition-only, mirrors the Cash Dashboard's own shape.
 * Every figure here is derived live from the underlying schedule/drawdown/
 * repayment transactions, never a stored balance.
 */
export default function DebtOverviewPage() {
  const { data: metrics } = useQuery({
    queryKey: ['debt-metrics'],
    queryFn: () => getDebtMetrics(),
  });
  const { data: facilitiesData } = useQuery({
    queryKey: ['debt-facilities', 'live'],
    queryFn: () => listDebtFacilities(),
  });
  const facilities = (facilitiesData?.items ?? []).filter(
    (facility) => facility.status === 'ACTIVE' || facility.status === 'PARTIALLY_REPAID',
  );

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Finance</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Total debt, outstanding balances, and upcoming repayments across every active financing
          facility.
        </p>
      </div>

      <FinanceTabs />

      <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        <MetricCard title="Total Outstanding" value={metrics?.totalOutstanding ?? 0} />
        <MetricCard title="Outstanding Principal" value={metrics?.outstandingPrincipal ?? 0} />
        <MetricCard title="Outstanding Interest" value={metrics?.outstandingInterest ?? 0} />
        <MetricCard
          title="Upcoming Repayments (30d)"
          value={metrics?.upcomingRepayments30Days ?? 0}
        />
        <MetricCard title="Monthly Debt Service" value={metrics?.monthlyDebtService ?? 0} />
        <MetricCard title="Total Interest Scheduled" value={metrics?.totalInterestScheduled ?? 0} />
        <Card>
          <CardHeader>
            <CardTitle className="text-xs font-medium text-muted-foreground">
              Active Facilities
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-lg font-semibold">{metrics?.facilityCount ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-xs font-medium text-muted-foreground">
              Next Maturity
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-lg font-semibold">
              {metrics?.nextMaturity ? new Date(metrics.nextMaturity).toLocaleDateString() : '—'}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Active &amp; Partially Repaid Facilities
          </CardTitle>
        </CardHeader>
        <CardContent>
          {facilities.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No facilities currently drawn down — see Debt Facilities to create or approve one.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-left text-muted-foreground">
                  <tr>
                    <th className="py-1.5 pr-3 font-medium">Facility</th>
                    <th className="py-1.5 pr-3 text-right font-medium">Principal</th>
                    <th className="py-1.5 pr-3 font-medium">Maturity</th>
                    <th className="py-1.5 text-right font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {facilities.map((facility) => (
                    <tr key={facility.id} className="border-t border-border/60">
                      <td className="py-1.5 pr-3">
                        <Link
                          href={`/settings/finance/debt-facilities/${facility.id}`}
                          className="text-primary hover:underline"
                        >
                          {facility.name}
                        </Link>
                      </td>
                      <td className="py-1.5 pr-3 text-right">
                        {formatCurrency(facility.principalAmount, facility.currency)}
                      </td>
                      <td className="py-1.5 pr-3">
                        {new Date(facility.maturityDate).toLocaleDateString()}
                      </td>
                      <td className="py-1.5 text-right">
                        <Badge variant={DEBT_FACILITY_STATUS_VARIANT[facility.status]}>
                          {DEBT_FACILITY_STATUS_LABELS[facility.status]}
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
    </main>
  );
}

function MetricCard({ title, value }: { title: string; value: number }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xs font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-lg font-semibold">{formatCurrency(value, 'NGN')}</p>
      </CardContent>
    </Card>
  );
}
