'use client';

import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button } from '@zentuva/ui';

import { ApiError } from '@/lib/api-client';

import {
  cancelWorkflowInstance,
  getWorkflowInstance,
  getWorkflowInstanceHistory,
  resubmitWorkflowInstance,
} from '../../api';
import {
  NON_TERMINAL_INSTANCE_STATUSES,
  WORKFLOW_INSTANCE_STATUS_LABELS,
  WORKFLOW_INSTANCE_STATUS_VARIANT,
  WORKFLOW_STEP_STATUS_LABELS,
} from '../../labels';

const NON_TERMINAL = new Set(NON_TERMINAL_INSTANCE_STATUSES);

export default function WorkflowInstanceDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const queryClient = useQueryClient();

  const {
    data: instance,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['workflow-instance', id],
    queryFn: () => getWorkflowInstance(id),
  });
  const { data: history } = useQuery({
    queryKey: ['workflow-instance-history', id],
    queryFn: () => getWorkflowInstanceHistory(id),
  });

  const cancelMutation = useMutation({
    mutationFn: () => cancelWorkflowInstance(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['workflow-instance', id] }),
  });

  const resubmitMutation = useMutation({
    mutationFn: () => resubmitWorkflowInstance(id),
    onSuccess: (newInstance) => {
      queryClient.invalidateQueries({ queryKey: ['workflow-instance', id] });
      window.location.href = `/settings/workflows/instances/${newInstance.id}`;
    },
  });

  if (isLoading || !instance) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        <p className="text-center text-sm text-muted-foreground">Loading workflow instance…</p>
      </main>
    );
  }

  if (isError) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <p className="text-sm text-destructive">
            {error instanceof ApiError ? error.message : 'Failed to load this workflow instance.'}
          </p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <a
        href="/settings/workflows/instances"
        className="text-sm text-muted-foreground hover:underline"
      >
        ← Back to Workflow Instances
      </a>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {instance.subjectType} — {instance.subjectId}
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Requested by <span className="font-mono">{instance.requestedById}</span> · definition v
            {instance.workflowDefinitionVersion}
            {instance.submittedAt &&
              ` · submitted ${new Date(instance.submittedAt).toLocaleString()}`}
            {instance.resubmissionCount > 0 && ` · resubmission #${instance.resubmissionCount}`}
          </p>
          {instance.previousInstanceId && (
            <a
              href={`/settings/workflows/instances/${instance.previousInstanceId}`}
              className="mt-1 inline-block text-xs text-muted-foreground hover:underline"
            >
              ← Resubmitted from a previous, returned instance
            </a>
          )}
        </div>
        <div className="flex items-center gap-2">
          {instance.isOverdue && <Badge variant="destructive">Overdue</Badge>}
          <Badge variant={WORKFLOW_INSTANCE_STATUS_VARIANT[instance.status]}>
            {WORKFLOW_INSTANCE_STATUS_LABELS[instance.status]}
          </Badge>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {NON_TERMINAL.has(instance.status) && (
          <Button
            size="sm"
            variant="outline"
            disabled={cancelMutation.isPending}
            onClick={() => cancelMutation.mutate()}
          >
            Cancel Workflow
          </Button>
        )}
        {instance.status === 'RETURNED' && !instance.resubmittedAt && (
          <Button
            size="sm"
            disabled={resubmitMutation.isPending}
            onClick={() => resubmitMutation.mutate()}
          >
            {resubmitMutation.isPending ? 'Resubmitting…' : 'Resubmit'}
          </Button>
        )}
      </div>
      {cancelMutation.isError && (
        <p className="mt-2 text-sm text-destructive">
          {cancelMutation.error instanceof ApiError
            ? cancelMutation.error.message
            : 'Failed to cancel.'}
        </p>
      )}
      {resubmitMutation.isError && (
        <p className="mt-2 text-sm text-destructive">
          {resubmitMutation.error instanceof ApiError
            ? resubmitMutation.error.message
            : 'Failed to resubmit.'}
        </p>
      )}
      {instance.status === 'RETURNED' && !instance.resubmittedAt && (
        <p className="mt-2 text-xs text-muted-foreground">
          This workflow was returned for correction. Edit the source record, then resubmit — a new
          linked workflow instance will restart approval from step 1.
        </p>
      )}

      <div className="mt-6 rounded-lg border border-border p-4">
        <h2 className="mb-3 text-sm font-semibold">Steps</h2>
        <div className="space-y-2">
          {instance.stepInstances
            .slice()
            .sort((a, b) => a.sequence - b.sequence)
            .map((step) => (
              <div
                key={step.id}
                className="flex items-center justify-between rounded-md border border-border px-3 py-2"
              >
                <div>
                  <span className="text-sm font-medium">
                    Step {step.sequence}: {step.stepNameSnapshot}
                  </span>
                  <p className="font-mono text-xs text-muted-foreground">
                    {step.requiredPermissionSnapshot}
                  </p>
                </div>
                <Badge
                  variant={
                    step.status === 'APPROVED'
                      ? 'success'
                      : step.status === 'REJECTED' || step.status === 'RETURNED'
                        ? 'destructive'
                        : 'default'
                  }
                >
                  {WORKFLOW_STEP_STATUS_LABELS[step.status]}
                </Badge>
              </div>
            ))}
        </div>
      </div>

      <div className="mt-6 rounded-lg border border-border p-4">
        <h2 className="mb-3 text-sm font-semibold">History</h2>
        {(!history || history.items.length === 0) && (
          <p className="text-sm text-muted-foreground">No decisions recorded yet.</p>
        )}
        <div className="space-y-2">
          {history?.items.map((decision) => (
            <div key={decision.id} className="rounded-md border border-border px-3 py-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-medium">{decision.decision}</span>
                <span className="text-xs text-muted-foreground">
                  {new Date(decision.createdAt).toLocaleString()}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                by <span className="font-mono">{decision.actorUserId}</span>
              </p>
              {decision.comment && <p className="mt-1 text-xs">{decision.comment}</p>}
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
