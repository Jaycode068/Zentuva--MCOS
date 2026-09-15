'use client';

import { useQuery } from '@tanstack/react-query';
import { Badge, Button } from '@zentuva/ui';

import { WorkflowTabs } from '@/components/app/workflow-tabs';
import { ApiError } from '@/lib/api-client';

import { listWorkflowInstances } from '../api';
import { WORKFLOW_INSTANCE_STATUS_LABELS, WORKFLOW_INSTANCE_STATUS_VARIANT } from '../labels';

export default function WorkflowInstancesPage() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['workflow-instances'],
    queryFn: () => listWorkflowInstances(),
  });

  const instances = data?.items ?? [];

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Workflow &amp; Approval</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Workflow Instances — every approval request raised in this organisation.
        </p>
      </div>

      <WorkflowTabs />

      {isLoading && (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading instances…</p>
      )}
      {isError && (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <p className="text-sm text-destructive">
            {error instanceof ApiError ? error.message : 'Failed to load workflow instances.'}
          </p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      )}

      {!isLoading && !isError && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Subject</th>
                <th className="px-4 py-3">Current Step</th>
                <th className="px-4 py-3">Submitted</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {instances.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
                    No workflow instances yet.
                  </td>
                </tr>
              )}
              {instances.map((instance) => {
                const currentStep = instance.stepInstances.find((s) => s.status === 'ACTIVE');
                return (
                  <tr key={instance.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs">{instance.subjectType}</span>
                      <span className="ml-2 text-muted-foreground">{instance.subjectId}</span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {currentStep ? currentStep.stepNameSnapshot : '—'}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {instance.submittedAt
                        ? new Date(instance.submittedAt).toLocaleDateString()
                        : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={WORKFLOW_INSTANCE_STATUS_VARIANT[instance.status]}>
                        {WORKFLOW_INSTANCE_STATUS_LABELS[instance.status]}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          window.location.href = `/settings/workflows/instances/${instance.id}`;
                        }}
                      >
                        View
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
