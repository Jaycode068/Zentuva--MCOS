'use client';

import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@zentuva/ui';

import { HrTabs } from '@/components/app/hr-tabs';
import { ApiError } from '@/lib/api-client';

import { getHrOverview } from './api';

/**
 * HR Overview (Sprint 23, docs/domains/hr.md) — a lightweight foundation
 * dashboard, the exact `MaintenanceOverviewPage` non-goal: no attendance,
 * payroll, performance, or recruitment metrics are fabricated. Every
 * figure is a plain read aggregate, computed live, never stored.
 */
export default function HrOverviewPage() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['hr-overview'],
    queryFn: () => getHrOverview(),
  });

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Human Resources</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Employees, departments, positions, and the organisation structure.
        </p>
      </div>

      <HrTabs />

      {isLoading && (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading overview…</p>
      )}
      {isError && (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <p className="text-sm text-destructive">
            {error instanceof ApiError ? error.message : 'Failed to load overview.'}
          </p>
          <button
            type="button"
            onClick={() => refetch()}
            className="rounded-md border border-border px-4 py-2 text-sm font-medium"
          >
            Retry
          </button>
        </div>
      )}

      {data && (
        <>
          <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <SummaryCard title="Total Employees" value={String(data.totalEmployees)} />
            <SummaryCard title="Active Employees" value={String(data.activeEmployees)} />
            <SummaryCard title="Onboarding" value={String(data.onboardingEmployees)} />
            <SummaryCard title="Without a Linked User" value={String(data.employeesWithoutUser)} />
            <SummaryCard title="Departments" value={String(data.departmentCount)} />
            <SummaryCard
              title="Open Onboarding Tasks"
              value={String(data.openOnboardingTasks)}
              destructive={data.openOnboardingTasks > 0}
            />
          </div>

          <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <SummaryCard title="Present Today" value={String(data.attendanceToday.present)} />
            <SummaryCard title="Late Today" value={String(data.attendanceToday.late)} />
            <SummaryCard
              title="Attendance Needing Review"
              value={String(data.attendanceRequiringReview)}
              destructive={data.attendanceRequiringReview > 0}
            />
            <SummaryCard
              title="Pending Policy Acknowledgements"
              value={String(data.pendingPolicyAcknowledgements)}
            />
            <SummaryCard
              title="Active Training Assignments"
              value={String(data.activeTrainingAssignments)}
            />
            <SummaryCard
              title="Overdue Training"
              value={String(data.overdueTrainingAssignments)}
              destructive={data.overdueTrainingAssignments > 0}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Recent Activity
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.recentActivity.length === 0 ? (
                <p className="text-sm text-muted-foreground">No recent HR activity.</p>
              ) : (
                <ul className="space-y-2">
                  {data.recentActivity.map((event) => (
                    <li key={event.id} className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">{formatAction(event.action)}</span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(event.createdAt).toLocaleString()}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </main>
  );
}

function formatAction(action: string): string {
  return action
    .replace('hr.', '')
    .split(/[._]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function SummaryCard({
  title,
  value,
  destructive,
}: {
  title: string;
  value: string;
  destructive?: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xs font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className={`text-lg font-semibold ${destructive ? 'text-destructive' : ''}`}>{value}</p>
      </CardContent>
    </Card>
  );
}
