'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button } from '@zentuva/ui';

import { ApiError } from '@/lib/api-client';

import {
  activateWorkflowDefinition,
  deactivateWorkflowDefinition,
  getWorkflowDefinition,
  updateWorkflowDefinition,
  WorkflowStepInput,
} from '../../api';
import {
  ACCESS_SCOPE_LABELS,
  WORKFLOW_DEFINITION_STATUS_LABELS,
  WORKFLOW_DEFINITION_STATUS_VARIANT,
} from '../../labels';
import { StepEditor } from '../../step-editor';

export default function WorkflowDefinitionDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const queryClient = useQueryClient();
  const [editingSteps, setEditingSteps] = useState(false);
  const [draftSteps, setDraftSteps] = useState<WorkflowStepInput[]>([]);

  const { data: definition, isLoading } = useQuery({
    queryKey: ['workflow-definition', id],
    queryFn: () => getWorkflowDefinition(id),
  });

  const activateMutation = useMutation({
    mutationFn: () => activateWorkflowDefinition(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['workflow-definition', id] }),
  });
  const deactivateMutation = useMutation({
    mutationFn: () => deactivateWorkflowDefinition(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['workflow-definition', id] }),
  });
  const saveStepsMutation = useMutation({
    mutationFn: (steps: WorkflowStepInput[]) => updateWorkflowDefinition(id, { steps }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-definition', id] });
      setEditingSteps(false);
    },
  });

  if (isLoading || !definition) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        <p className="text-center text-sm text-muted-foreground">Loading workflow…</p>
      </main>
    );
  }

  function startEditingSteps() {
    setDraftSteps(
      (definition?.steps ?? []).map((s) => ({
        name: s.name,
        code: s.code,
        sequence: s.sequence,
        requiredPermission: s.requiredPermission,
        requiredScope: s.requiredScope ?? undefined,
        assignedUserId: s.assignedUserId,
      })),
    );
    setEditingSteps(true);
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <a
        href="/settings/workflows/definitions"
        className="text-sm text-muted-foreground hover:underline"
      >
        ← Back to Workflow Definitions
      </a>

      <div className="mt-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{definition.name}</h1>
          {definition.description && (
            <p className="mt-1 text-sm text-muted-foreground">{definition.description}</p>
          )}
          <p className="mt-1 font-mono text-xs text-muted-foreground">
            {definition.code} · subject: {definition.subjectType} · version {definition.version}
          </p>
        </div>
        <Badge variant={WORKFLOW_DEFINITION_STATUS_VARIANT[definition.status]}>
          {WORKFLOW_DEFINITION_STATUS_LABELS[definition.status]}
        </Badge>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {definition.status === 'INACTIVE' && (
          <Button
            size="sm"
            disabled={activateMutation.isPending}
            onClick={() => activateMutation.mutate()}
          >
            Activate
          </Button>
        )}
        {definition.status === 'ACTIVE' && (
          <Button
            size="sm"
            variant="outline"
            disabled={deactivateMutation.isPending}
            onClick={() => deactivateMutation.mutate()}
          >
            Deactivate
          </Button>
        )}
        {!editingSteps && (
          <Button size="sm" variant="outline" onClick={startEditingSteps}>
            Edit Steps
          </Button>
        )}
      </div>
      {activateMutation.isError && (
        <p className="mt-2 text-sm text-destructive">
          {activateMutation.error instanceof ApiError
            ? activateMutation.error.message
            : 'Failed to activate.'}
        </p>
      )}

      <div className="mt-6 rounded-lg border border-border p-4">
        <h2 className="mb-3 text-sm font-semibold">
          {editingSteps ? 'Edit Steps' : `Steps (${definition.steps.length})`}
        </h2>
        <p className="mb-4 text-xs text-muted-foreground">
          Self-approval:{' '}
          {definition.allowSelfApproval
            ? 'the requester may approve their own request'
            : 'the requester cannot approve their own request'}
          . Sequential — Step 1 must be fully approved before Step 2 activates.
        </p>

        {!editingSteps && (
          <div className="space-y-2">
            {definition.steps
              .slice()
              .sort((a, b) => a.sequence - b.sequence)
              .map((step) => (
                <div key={step.id} className="rounded-md border border-border p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">
                      Step {step.sequence}: {step.name}
                    </span>
                    <span className="font-mono text-xs text-muted-foreground">{step.code}</span>
                  </div>
                  <p className="mt-1 font-mono text-xs text-muted-foreground">
                    {step.requiredPermission}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Scope:{' '}
                    {step.requiredScope
                      ? ACCESS_SCOPE_LABELS[step.requiredScope]
                      : 'any granted scope'}
                    {step.assignedUserId && (
                      <>
                        {' '}
                        · Explicit approver:{' '}
                        <span className="font-mono">{step.assignedUserId}</span>
                      </>
                    )}
                  </p>
                </div>
              ))}
          </div>
        )}

        {editingSteps && (
          <div className="space-y-4">
            <StepEditor steps={draftSteps} onChange={setDraftSteps} />
            {saveStepsMutation.isError && (
              <p className="text-sm text-destructive">
                {saveStepsMutation.error instanceof ApiError
                  ? saveStepsMutation.error.message
                  : 'Failed to save steps.'}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setEditingSteps(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                disabled={saveStepsMutation.isPending}
                onClick={() => saveStepsMutation.mutate(draftSteps)}
              >
                {saveStepsMutation.isPending ? 'Saving…' : 'Save Steps'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
