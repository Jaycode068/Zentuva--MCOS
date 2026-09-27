'use client';

import { useQuery } from '@tanstack/react-query';
import { Badge } from '@zentuva/ui';

import { ApiError } from '@/lib/api-client';

import { listMyEvaluations } from './api';

/**
 * Sprint 30 — Recruitment & Candidate Interview Management Foundation
 * (recruitment.md §"Mobile"). Self-scoped "my evaluations" surface — the
 * page a Notification's `actionUrl` points to. No `HrTabs`/settings chrome:
 * this is reachable by ANY authenticated user, not just HR staff, so it
 * deliberately lives outside `/settings`.
 */
export default function MyEvaluationsPage() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['my-interview-evaluations'],
    queryFn: () => listMyEvaluations(),
  });

  const interviews = data ?? [];

  return (
    <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">My Interview Evaluations</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Interviews you have been assigned to evaluate.
        </p>
      </div>

      {isLoading && <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>}
      {isError && (
        <div className="py-10 text-center">
          <p className="text-sm text-destructive">
            {error instanceof ApiError ? error.message : 'Failed to load your interviews.'}
          </p>
          <button
            className="mt-3 rounded-md border border-border px-3 py-1.5 text-sm"
            onClick={() => refetch()}
          >
            Retry
          </button>
        </div>
      )}

      {!isLoading && !isError && (
        <div className="space-y-3">
          {interviews.length === 0 && (
            <p className="py-10 text-center text-sm text-muted-foreground">
              You have no assigned interviews right now.
            </p>
          )}
          {interviews.map((interview) => {
            const submitted = interview.evaluations.length > 0;
            return (
              <a
                key={interview.id}
                href={`/hr-interviews/${interview.id}`}
                className="block rounded-lg border border-border p-4 active:bg-secondary/50"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">
                    {interview.application.candidate.firstName}{' '}
                    {interview.application.candidate.lastName}
                  </span>
                  <Badge variant={submitted ? 'success' : 'warning'}>
                    {submitted ? 'Submitted' : 'Action needed'}
                  </Badge>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {interview.application.vacancy.title} · {interview.interviewStage.name}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {interview.scheduledAt
                    ? new Date(interview.scheduledAt).toLocaleString()
                    : 'Not yet scheduled'}
                </p>
              </a>
            );
          })}
        </div>
      )}
    </main>
  );
}
