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
  Select,
  Textarea,
  Label,
} from '@zentuva/ui';

import { HrTabs } from '@/components/app/hr-tabs';
import { ApiError } from '@/lib/api-client';

import { createPolicy, listDepartments, listPolicies } from '../api';
import { POLICY_STATUS_LABELS, POLICY_STATUS_VARIANT } from '../labels';

export default function PoliciesPage() {
  const [createOpen, setCreateOpen] = useState(false);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['hr-policies'],
    queryFn: () => listPolicies(),
  });

  const policies = data?.items ?? [];

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Human Resources</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Policy catalogue — versions, publishing, and employee acknowledgements.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>New Policy</Button>
      </div>

      <HrTabs />

      {isLoading && (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading policies…</p>
      )}
      {isError && (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <p className="text-sm text-destructive">
            {error instanceof ApiError ? error.message : 'Failed to load policies.'}
          </p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      )}

      {!isLoading && !isError && policies.length === 0 && (
        <p className="py-10 text-center text-sm text-muted-foreground">No policies yet.</p>
      )}

      {!isLoading && !isError && policies.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {policies.map((policy) => (
            <a
              key={policy.id}
              href={`/settings/hr/policies/${policy.id}`}
              className="rounded-lg border border-border p-4 hover:border-primary"
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs text-muted-foreground">{policy.code}</span>
                <Badge variant={POLICY_STATUS_VARIANT[policy.status]}>
                  {POLICY_STATUS_LABELS[policy.status]}
                </Badge>
              </div>
              <h3 className="mt-1 font-medium">{policy.title}</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                {policy.scopeType === 'ORGANISATION' ? 'Organisation-wide' : 'Department-scoped'}
              </p>
            </a>
          ))}
        </div>
      )}

      {createOpen && (
        <PolicyDialog
          onClose={() => setCreateOpen(false)}
          onSaved={() => {
            setCreateOpen(false);
            refetch();
          }}
        />
      )}
    </main>
  );
}

function PolicyDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [code, setCode] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [scopeType, setScopeType] = useState<'ORGANISATION' | 'DEPARTMENT'>('ORGANISATION');
  const [departmentId, setDepartmentId] = useState('');

  const { data: departmentsData } = useQuery({
    queryKey: ['hr-departments-lite'],
    queryFn: () => listDepartments(),
  });

  const mutation = useMutation({
    mutationFn: () =>
      createPolicy({
        code: code.trim(),
        title: title.trim(),
        description: description.trim() || undefined,
        scopeType,
        departmentId: scopeType === 'DEPARTMENT' ? departmentId || undefined : undefined,
      }),
    onSuccess: onSaved,
  });

  const canSubmit =
    code.trim().length > 0 &&
    title.trim().length > 0 &&
    (scopeType === 'ORGANISATION' || departmentId.length > 0);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogHeader>
        <DialogTitle>New Policy</DialogTitle>
      </DialogHeader>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit) mutation.mutate();
        }}
      >
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Code</Label>
            <Input value={code} onChange={(e) => setCode(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Description</Label>
          <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Scope</Label>
          <Select
            value={scopeType}
            onChange={(e) => setScopeType(e.target.value as 'ORGANISATION' | 'DEPARTMENT')}
          >
            <option value="ORGANISATION">Organisation-wide</option>
            <option value="DEPARTMENT">Department-scoped</option>
          </Select>
        </div>
        {scopeType === 'DEPARTMENT' && (
          <div className="space-y-1.5">
            <Label>Department</Label>
            <Select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
              <option value="">Select a department</option>
              {(departmentsData?.items ?? []).map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </Select>
          </div>
        )}

        {mutation.isError && (
          <p className="text-sm text-destructive">
            {mutation.error instanceof ApiError ? mutation.error.message : 'Failed to save policy.'}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!canSubmit || mutation.isPending}>
            {mutation.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
