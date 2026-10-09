'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@zentuva/ui';

import { getWorkforceSummaryReport } from '../api';
import type { ReportingPeriodPreset } from '../api';
import { PeriodSelector } from '@/components/reporting/period-selector';
import { ReportDataTable } from '@/components/reporting/report-data-table';
import { ReportPageHeader } from '@/components/reporting/report-page-header';
import { ReportEmpty, ReportError, ReportLoading } from '@/components/reporting/report-states';
import { SummaryCard } from '@/components/reporting/summary-card';

const STATUS_COLUMNS = [
  { key: 'employmentStatus', label: 'Status', type: 'ENUM' as const },
  { key: 'count', label: 'Count', type: 'NUMBER' as const },
];

const DEPARTMENT_COLUMNS = [
  { key: 'departmentName', label: 'Department', type: 'STRING' as const },
  { key: 'count', label: 'Active Headcount', type: 'NUMBER' as const },
];

const ATTENDANCE_COLUMNS = [
  { key: 'status', label: 'Attendance Status', type: 'ENUM' as const },
  { key: 'count', label: 'Count', type: 'NUMBER' as const },
];

export default function WorkforceSummaryPage() {
  const [preset, setPreset] = useState<ReportingPeriodPreset>('this_month');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['reporting-workforce-summary', preset],
    queryFn: () => getWorkforceSummaryReport({ preset, comparison: 'none' }),
  });

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <ReportPageHeader
        title="Workforce Summary"
        description="Current headcount by status and department, and attendance-status counts for the selected period. Leave is not reportable — no Leave model exists in this codebase yet."
        actions={
          <PeriodSelector
            preset={preset}
            comparison="none"
            onChange={(p) => setPreset(p)}
            showComparison={false}
          />
        }
      />

      {isLoading && <ReportLoading />}
      {isError && <ReportError message="Failed to load the workforce summary report." />}

      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <SummaryCard label="Active Headcount" value={String(data.activeHeadcount)} />
            <SummaryCard
              label="Total Headcount (all statuses)"
              value={String(data.totalHeadcount)}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Headcount by Status</CardTitle>
            </CardHeader>
            <CardContent>
              <ReportDataTable columns={STATUS_COLUMNS} rows={data.byStatus} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Active Headcount by Department</CardTitle>
            </CardHeader>
            <CardContent>
              <ReportDataTable columns={DEPARTMENT_COLUMNS} rows={data.byDepartment} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Attendance, Selected Period</CardTitle>
            </CardHeader>
            <CardContent>
              {data.attendanceByStatus.length === 0 ? (
                <ReportEmpty message="No attendance records in this period." />
              ) : (
                <ReportDataTable columns={ATTENDANCE_COLUMNS} rows={data.attendanceByStatus} />
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
