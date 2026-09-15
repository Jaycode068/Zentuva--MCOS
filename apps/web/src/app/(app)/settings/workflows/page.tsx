'use client';

import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@zentuva/ui';

import { WorkflowTabs } from '@/components/app/workflow-tabs';
import { ApiError } from '@/lib/api-client';

import { listWorkflowDefinitions, listWorkflowInstances } from './api';

/**
 * Workflow & Approval Overview (Sprint 26, docs/domains/workflow.md) — plain read
 * aggregates over Definitions/Instances, computed client-side from the list endpoints
 * (no dedicated `/workflows/overview` endpoint — this domain's scale doesn't warrant
 * one yet, unlike Access Control's Roles/UserRole aggregate).
 */
export default function WorkflowOverviewPage() {
  const { data: definitions, isLoading: definitionsLoading } = useQuery({
    queryKey: ['workflow-definitions'],
    queryFn: () => listWorkflowDefinitions(),
  });
  const {
    data: instances,
    isLoading: instancesLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['workflow-instances'],
    queryFn: () => listWorkflowInstances(),
  });

  const isLoading = definitionsLoading || instancesLoading;
  const defItems = definitions?.items ?? [];
  const instItems = instances?.items ?? [];
  const activeCount = instItems.filter((i) =>
    ['DRAFT', 'SUBMITTED', 'IN_PROGRESS'].includes(i.status),
  ).length;
  const approvedCount = instItems.filter(
    (i) => i.status === 'APPROVED' || i.status === 'COMPLETED',
  ).length;
  const rejectedOrReturnedCount = instItems.filter(
    (i) => i.status === 'REJECTED' || i.status === 'RETURNED',
  ).length;

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Workflow &amp; Approval</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure how work requiring approval moves through your organisation, and track requests
          currently in progress.
        </p>
      </div>

      <WorkflowTabs />

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

      {!isLoading && !isError && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <SummaryCard title="Workflow Definitions" value={String(defItems.length)} />
          <SummaryCard
            title="Active Definitions"
            value={String(defItems.filter((d) => d.status === 'ACTIVE').length)}
          />
          <SummaryCard title="In Progress" value={String(activeCount)} />
          <SummaryCard title="Approved / Completed" value={String(approvedCount)} />
          <SummaryCard
            title="Rejected / Returned"
            value={String(rejectedOrReturnedCount)}
            destructive={rejectedOrReturnedCount > 0}
          />
          <SummaryCard title="Total Instances" value={String(instItems.length)} />
        </div>
      )}
    </main>
  );
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
