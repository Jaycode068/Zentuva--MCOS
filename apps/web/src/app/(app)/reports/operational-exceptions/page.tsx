'use client';

import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@zentuva/ui';

import { getOperationalExceptionsReport } from '../api';
import { ReportDataTable } from '@/components/reporting/report-data-table';
import { ReportPageHeader } from '@/components/reporting/report-page-header';
import { ReportEmpty, ReportError, ReportLoading } from '@/components/reporting/report-states';
import { SummaryCard } from '@/components/reporting/summary-card';

const APPROVAL_COLUMNS = [
  { key: 'subjectType', label: 'Type', type: 'STRING' as const },
  { key: 'stepName', label: 'Step', type: 'STRING' as const },
  { key: 'ageDays', label: 'Age (days)', type: 'NUMBER' as const },
];

/**
 * Sprint 45 — Operational Exceptions. Each section renders only when the backend
 * actually returned it (non-null) — a `null` section means the viewer lacks that
 * section's own domain permission (brief §10), rendered here as the section simply
 * not appearing, never an error or a visible "you don't have access" message that
 * would itself leak that the section exists.
 */
export default function OperationalExceptionsPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['reporting-operational-exceptions'],
    queryFn: getOperationalExceptionsReport,
  });

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <ReportPageHeader
        title="Operational Exceptions"
        description="Pending approvals, overdue maintenance, and failed notifications — each section shown only if you hold that section's own permission."
      />

      {isLoading && <ReportLoading />}
      {isError && <ReportError message="Failed to load operational exceptions." />}

      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            {data.pendingApprovals !== null && (
              <SummaryCard label="Pending Approvals" value={String(data.pendingApprovals.length)} />
            )}
            {data.overdueMaintenanceCount !== null && (
              <SummaryCard
                label="Overdue Work Orders"
                value={String(data.overdueMaintenanceCount)}
              />
            )}
            {data.failedNotifications !== null && (
              <SummaryCard
                label="Failed Notifications"
                value={String(data.failedNotifications.email + data.failedNotifications.whatsapp)}
              />
            )}
          </div>

          {data.pendingApprovals !== null && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Pending Approvals</CardTitle>
              </CardHeader>
              <CardContent>
                {data.pendingApprovals.length === 0 ? (
                  <ReportEmpty message="No pending approvals." />
                ) : (
                  <ReportDataTable columns={APPROVAL_COLUMNS} rows={data.pendingApprovals} />
                )}
              </CardContent>
            </Card>
          )}

          {data.pendingApprovals === null &&
            data.overdueMaintenanceCount === null &&
            data.failedNotifications === null && (
              <ReportEmpty message="You do not have access to any operational exception section." />
            )}
        </>
      )}
    </div>
  );
}
