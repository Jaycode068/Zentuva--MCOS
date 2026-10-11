'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { getWorkforceSummaryReport } from '../../reports/api';
import type { ComparisonMode, ReportingPeriodPreset } from '../../reports/api';
import { PeriodSelector } from '@/components/reporting/period-selector';
import { ReportError, ReportLoading } from '@/components/reporting/report-states';
import { ReportPageHeader } from '@/components/reporting/report-page-header';
import { SummaryCard } from '@/components/reporting/summary-card';

/**
 * Sprint 46 — Management Dashboards (brief §6F "Workforce Dashboard"). Reuses
 * `workforce-summary` verbatim. **No leave data is shown** — the Sprint 45 audit
 * confirmed no Leave/LeaveRequest model exists anywhere in this codebase; displaying
 * a leave metric here would be exactly the fabrication the brief explicitly
 * prohibits ("do not display leave balances or leave analytics unless the necessary
 * authoritative data has since been implemented").
 */
export default function WorkforceDashboardPage() {
  const [preset, setPreset] = useState<ReportingPeriodPreset>('this_month');
  const [comparison] = useState<ComparisonMode>('none');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['dashboard-workforce', preset],
    queryFn: () => getWorkforceSummaryReport({ preset, comparison }),
  });

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <ReportPageHeader
        title="Workforce Dashboard"
        description="Headcount by status and department, and attendance for the selected period. Leave is not shown — no Leave model exists in this codebase yet (known data gap)."
        backHref="/dashboard"
        backLabel="← Executive Dashboard"
        actions={
          <PeriodSelector
            preset={preset}
            comparison="none"
            showComparison={false}
            onChange={(p) => setPreset(p)}
          />
        }
      />

      {isLoading && <ReportLoading />}
      {isError && <ReportError message="Failed to load the workforce dashboard." />}

      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <SummaryCard
              label="Total Headcount"
              value={data.totalHeadcount.toLocaleString('en-NG')}
              favorableDirection="neutral"
              href="/reports/workforce-summary"
            />
            <SummaryCard
              label="Active Employees"
              value={data.activeHeadcount.toLocaleString('en-NG')}
              favorableDirection="neutral"
              href="/reports/workforce-summary"
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-lg border border-border p-4">
              <h3 className="mb-2 text-sm font-medium text-muted-foreground">By Department</h3>
              <ul className="space-y-1 text-sm">
                {data.byDepartment.map((row) => (
                  <li key={row.departmentId ?? 'unassigned'} className="flex justify-between">
                    <span>{row.departmentName}</span>
                    <span className="font-medium">{row.count}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-lg border border-border p-4">
              <h3 className="mb-2 text-sm font-medium text-muted-foreground">
                Attendance This Period
              </h3>
              {data.attendanceByStatus.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No attendance records for this period.
                </p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {data.attendanceByStatus.map((row) => (
                    <li key={row.status} className="flex justify-between">
                      <span>{row.status}</span>
                      <span className="font-medium">{row.count}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
