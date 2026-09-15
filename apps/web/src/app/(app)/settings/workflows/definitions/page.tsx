'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Dialog,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Textarea,
} from '@zentuva/ui';

import { WorkflowTabs } from '@/components/app/workflow-tabs';
import { ApiError } from '@/lib/api-client';

import { createWorkflowDefinition, listWorkflowDefinitions, WorkflowStepInput } from '../api';
import { WORKFLOW_DEFINITION_STATUS_LABELS, WORKFLOW_DEFINITION_STATUS_VARIANT } from '../labels';
import { StepEditor } from '../step-editor';

export default function WorkflowDefinitionsPage() {
  const [createOpen, setCreateOpen] = useState(false);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['workflow-definitions'],
    queryFn: () => listWorkflowDefinitions(),
  });

  const definitions = data?.items ?? [];

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Workflow &amp; Approval</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Workflow Definitions — the configurable approval processes your organisation runs.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>New Workflow</Button>
      </div>

      <WorkflowTabs />

      {isLoading && (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading definitions…</p>
      )}
      {isError && (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <p className="text-sm text-destructive">
            {error instanceof ApiError ? error.message : 'Failed to load workflow definitions.'}
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
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Subject Type</th>
                <th className="px-4 py-3">Steps</th>
                <th className="px-4 py-3">Instances</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {definitions.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">
                    No workflow definitions yet.
                  </td>
                </tr>
              )}
              {definitions.map((def) => (
                <tr key={def.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 font-medium">{def.name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{def.code}</td>
                  <td className="px-4 py-3 text-muted-foreground">{def.subjectType}</td>
                  <td className="px-4 py-3">{def.steps.length}</td>
                  <td className="px-4 py-3">{def.instanceCount}</td>
                  <td className="px-4 py-3">
                    <Badge variant={WORKFLOW_DEFINITION_STATUS_VARIANT[def.status]}>
                      {WORKFLOW_DEFINITION_STATUS_LABELS[def.status]}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        window.location.href = `/settings/workflows/definitions/${def.id}`;
                      }}
                    >
                      View
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {createOpen && (
        <CreateWorkflowDefinitionDialog
          onClose={() => setCreateOpen(false)}
          onSaved={(id) => {
            setCreateOpen(false);
            window.location.href = `/settings/workflows/definitions/${id}`;
          }}
        />
      )}
    </main>
  );
}

function CreateWorkflowDefinitionDialog({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');
  const [subjectType, setSubjectType] = useState('PURCHASE_ORDER');
  const [steps, setSteps] = useState<WorkflowStepInput[]>([
    { name: '', code: '', sequence: 1, requiredPermission: '', requiredScope: 'ORGANISATION' },
  ]);

  const mutation = useMutation({
    mutationFn: () =>
      createWorkflowDefinition({
        name: name.trim(),
        code: code.trim(),
        description: description.trim() || undefined,
        subjectType: subjectType.trim(),
        steps,
      }),
    onSuccess: (definition) => onSaved(definition.id),
  });

  const canSubmit =
    name.trim().length > 0 &&
    code.trim().length > 0 &&
    subjectType.trim().length > 0 &&
    steps.length > 0 &&
    steps.every((s) => s.name.trim() && s.code.trim() && s.requiredPermission.trim());

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogHeader>
        <DialogTitle>New Workflow Definition</DialogTitle>
      </DialogHeader>
      <form
        className="max-h-[75vh] space-y-4 overflow-y-auto"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit) mutation.mutate();
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Purchase Order Approval"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Code</Label>
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="e.g. PURCHASE_ORDER_APPROVAL"
              className="font-mono text-xs"
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Description</Label>
          <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Subject type</Label>
          <Input
            value={subjectType}
            onChange={(e) => setSubjectType(e.target.value.toUpperCase())}
            placeholder="e.g. PURCHASE_ORDER"
          />
          <p className="text-xs text-muted-foreground">
            Currently supported: <span className="font-mono">PURCHASE_ORDER</span>.
          </p>
        </div>

        <div>
          <Label>Steps</Label>
          <p className="mb-2 text-xs text-muted-foreground">
            Sequential — Step 1 must be fully approved before Step 2 activates.
          </p>
          <StepEditor steps={steps} onChange={setSteps} />
        </div>

        {mutation.isError && (
          <p className="text-sm text-destructive">
            {mutation.error instanceof ApiError
              ? mutation.error.message
              : 'Failed to create workflow definition.'}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!canSubmit || mutation.isPending}>
            {mutation.isPending ? 'Creating…' : 'Create'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
