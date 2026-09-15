'use client';

import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button } from '@zentuva/ui';

import { ApiError } from '@/lib/api-client';

import { cancelWorkflowInstance, getWorkflowInstance, getWorkflowInstanceHistory } from '../../api';
import {
  WORKFLOW_INSTANCE_STATUS_LABELS,
  WORKFLOW_INSTANCE_STATUS_VARIANT,
  WORKFLOW_STEP_STATUS_LABELS,
} from '../../labels';

const NON_TERMINAL = new Set(['DRAFT', 'SUBMITTED', 'IN_PROGRESS']);

export default function WorkflowInstanceDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const queryClient = useQueryClient();

  const { data: instance, isLoading } = useQuery({
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

  if (isLoading || !instance) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        <p className="text-center text-sm text-muted-foreground">Loading workflow instance…</p>
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

      <div className="mt-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {instance.subjectType} — {instance.subjectId}
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Requested by <span className="font-mono">{instance.requestedById}</span>
            {instance.submittedAt &&
              ` · submitted ${new Date(instance.submittedAt).toLocaleString()}`}
          </p>
        </div>
        <Badge variant={WORKFLOW_INSTANCE_STATUS_VARIANT[instance.status]}>
          {WORKFLOW_INSTANCE_STATUS_LABELS[instance.status]}
        </Badge>
      </div>

      {NON_TERMINAL.has(instance.status) && (
        <div className="mt-4">
          <Button
            size="sm"
            variant="outline"
            disabled={cancelMutation.isPending}
            onClick={() => cancelMutation.mutate()}
          >
            Cancel Workflow
          </Button>
          {cancelMutation.isError && (
            <p className="mt-2 text-sm text-destructive">
              {cancelMutation.error instanceof ApiError
                ? cancelMutation.error.message
                : 'Failed to cancel.'}
            </p>
          )}
        </div>
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
