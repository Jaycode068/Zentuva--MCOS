'use client';

import { Suspense, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { Badge, Button } from '@zentuva/ui';

import { HrTabs } from '@/components/app/hr-tabs';
import { ApiError } from '@/lib/api-client';

import { ApplicationStatus, listApplications } from '../api';
import { APPLICATION_STATUS_LABELS, APPLICATION_STATUS_VARIANT } from '../labels';

export default function ApplicationsPage() {
  return (
    <Suspense fallback={null}>
      <ApplicationsPageContent />
    </Suspense>
  );
}

function ApplicationsPageContent() {
  const searchParams = useSearchParams();
  const vacancyId = searchParams.get('vacancyId') ?? undefined;
  const [statusFilter, setStatusFilter] = useState<'' | ApplicationStatus>('');

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['recruitment-applications', vacancyId, statusFilter],
    queryFn: () => listApplications({ vacancyId, status: statusFilter || undefined }),
  });

  const applications = data ?? [];

  return (
    <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Human Resources</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Applications — screen candidates and track their progress.
          {vacancyId && ' Filtered to one vacancy.'}
        </p>
      </div>

      <HrTabs />

      <div className="mb-4 flex flex-wrap gap-2">
        {(
          [
            '',
            'SUBMITTED',
            'SCREENING',
            'SHORTLISTED',
            'INTERVIEWING',
            'SELECTED',
            'REJECTED',
            'WITHDRAWN',
          ] as const
        ).map((status) => (
          <Button
            key={status || 'all'}
            size="sm"
            variant={statusFilter === status ? 'default' : 'outline'}
            onClick={() => setStatusFilter(status)}
          >
            {status ? APPLICATION_STATUS_LABELS[status] : 'All'}
          </Button>
        ))}
      </div>

      {isLoading && <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>}
      {isError && (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <p className="text-sm text-destructive">
            {error instanceof ApiError ? error.message : 'Failed to load applications.'}
          </p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      )}

      {!isLoading && !isError && (
        <div className="space-y-3">
          {applications.length === 0 && (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No applications match this filter.
            </p>
          )}
          {applications.map((application) => (
            <a
              key={application.id}
              href={`/settings/hr/recruitment/applications/${application.id}`}
              className="block rounded-lg border border-border p-4 hover:bg-secondary/50"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">
                  {application.candidate?.firstName} {application.candidate?.lastName}
                </span>
                <Badge variant={APPLICATION_STATUS_VARIANT[application.status]}>
                  {APPLICATION_STATUS_LABELS[application.status]}
                </Badge>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {application.vacancy?.title ?? application.vacancyId} ·{' '}
                {application.candidate?.email}
              </p>
            </a>
          ))}
        </div>
      )}
    </main>
  );
}
