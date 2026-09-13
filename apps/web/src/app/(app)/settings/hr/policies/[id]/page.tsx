'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Dialog,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  Textarea,
} from '@zentuva/ui';

import { ApiError } from '@/lib/api-client';

import {
  acknowledgePolicyVersion,
  archivePolicy,
  createPolicyVersion,
  getPolicy,
  listEmployees,
  listPolicyVersions,
  publishPolicyVersion,
} from '../../api';
import {
  POLICY_STATUS_LABELS,
  POLICY_STATUS_VARIANT,
  POLICY_VERSION_STATUS_LABELS,
  POLICY_VERSION_STATUS_VARIANT,
} from '../../labels';

export default function PolicyDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const queryClient = useQueryClient();
  const [newVersionOpen, setNewVersionOpen] = useState(false);
  const [acknowledgeVersionId, setAcknowledgeVersionId] = useState<string | null>(null);

  const { data: policy, isLoading: policyLoading } = useQuery({
    queryKey: ['hr-policy', id],
    queryFn: () => getPolicy(id),
  });
  const { data: versionsData, refetch: refetchVersions } = useQuery({
    queryKey: ['hr-policy-versions', id],
    queryFn: () => listPolicyVersions(id),
  });

  const archiveMutation = useMutation({
    mutationFn: () => archivePolicy(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['hr-policy', id] }),
  });

  const publishMutation = useMutation({
    mutationFn: (versionId: string) => publishPolicyVersion(id, versionId),
    onSuccess: () => {
      refetchVersions();
      queryClient.invalidateQueries({ queryKey: ['hr-policy', id] });
    },
  });

  const versions = versionsData?.items ?? [];

  if (policyLoading || !policy) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <p className="text-center text-sm text-muted-foreground">Loading policy…</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <a href="/settings/hr/policies" className="text-sm text-muted-foreground hover:underline">
        ← Back to Policies
      </a>

      <div className="mt-4 flex items-center justify-between">
        <div>
          <p className="font-mono text-xs text-muted-foreground">{policy.code}</p>
          <h1 className="text-2xl font-semibold tracking-tight">{policy.title}</h1>
        </div>
        <Badge variant={POLICY_STATUS_VARIANT[policy.status]}>
          {POLICY_STATUS_LABELS[policy.status]}
        </Badge>
      </div>
      {policy.description && (
        <p className="mt-2 text-sm text-muted-foreground">{policy.description}</p>
      )}

      <div className="mt-4 flex gap-2">
        <Button size="sm" onClick={() => setNewVersionOpen(true)}>
          New Version
        </Button>
        {policy.status !== 'ARCHIVED' && (
          <Button
            size="sm"
            variant="outline"
            disabled={archiveMutation.isPending}
            onClick={() => archiveMutation.mutate()}
          >
            Archive Policy
          </Button>
        )}
      </div>

      <div className="mt-6 rounded-lg border border-border p-4">
        <h2 className="mb-3 text-sm font-semibold">Versions</h2>
        {versions.length === 0 && <p className="text-sm text-muted-foreground">No versions yet.</p>}
        <div className="space-y-3">
          {versions.map((version) => (
            <div key={version.id} className="rounded-lg border border-border p-3">
              <div className="flex items-center justify-between">
                <span className="font-medium">Version {version.versionNumber}</span>
                <Badge variant={POLICY_VERSION_STATUS_VARIANT[version.status]}>
                  {POLICY_VERSION_STATUS_LABELS[version.status]}
                </Badge>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm">{version.content}</p>
              <p className="mt-2 text-xs text-muted-foreground">
                Effective {new Date(version.effectiveDate).toLocaleDateString()} ·{' '}
                {version.requiresAcknowledgement
                  ? 'Requires acknowledgement'
                  : 'Informational only'}
              </p>
              <div className="mt-3 flex gap-2">
                {version.status === 'DRAFT' && (
                  <Button
                    size="sm"
                    disabled={publishMutation.isPending}
                    onClick={() => publishMutation.mutate(version.id)}
                  >
                    Publish
                  </Button>
                )}
                {version.status === 'PUBLISHED' && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setAcknowledgeVersionId(version.id)}
                  >
                    Record Acknowledgement
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
        {publishMutation.isError && (
          <p className="mt-2 text-sm text-destructive">
            {publishMutation.error instanceof ApiError
              ? publishMutation.error.message
              : 'Failed to publish version.'}
          </p>
        )}
      </div>

      {newVersionOpen && (
        <NewVersionDialog
          policyId={id}
          onClose={() => setNewVersionOpen(false)}
          onSaved={() => {
            setNewVersionOpen(false);
            refetchVersions();
          }}
        />
      )}
      {acknowledgeVersionId && (
        <AcknowledgeDialog
          policyId={id}
          versionId={acknowledgeVersionId}
          onClose={() => setAcknowledgeVersionId(null)}
          onSaved={() => setAcknowledgeVersionId(null)}
        />
      )}
    </main>
  );
}

function NewVersionDialog({
  policyId,
  onClose,
  onSaved,
}: {
  policyId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [content, setContent] = useState('');
  const [effectiveDate, setEffectiveDate] = useState(new Date().toISOString().slice(0, 10));
  const [requiresAcknowledgement, setRequiresAcknowledgement] = useState(true);

  const mutation = useMutation({
    mutationFn: () =>
      createPolicyVersion(policyId, {
        content: content.trim(),
        effectiveDate,
        requiresAcknowledgement,
      }),
    onSuccess: onSaved,
  });

  const canSubmit = content.trim().length > 0 && effectiveDate.length > 0;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogHeader>
        <DialogTitle>New Policy Version</DialogTitle>
      </DialogHeader>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit) mutation.mutate();
        }}
      >
        <div className="space-y-1.5">
          <Label>Content</Label>
          <Textarea rows={6} value={content} onChange={(e) => setContent(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Effective Date</Label>
          <Input
            type="date"
            value={effectiveDate}
            onChange={(e) => setEffectiveDate(e.target.value)}
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={requiresAcknowledgement}
            onChange={(e) => setRequiresAcknowledgement(e.target.checked)}
          />
          Requires employee acknowledgement
        </label>

        {mutation.isError && (
          <p className="text-sm text-destructive">
            {mutation.error instanceof ApiError
              ? mutation.error.message
              : 'Failed to save version.'}
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

function AcknowledgeDialog({
  policyId,
  versionId,
  onClose,
  onSaved,
}: {
  policyId: string;
  versionId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [employeeId, setEmployeeId] = useState('');

  const { data: employeesData } = useQuery({
    queryKey: ['hr-employees', 'for-ack'],
    queryFn: () => listEmployees({ pageSize: 100 }),
  });

  const mutation = useMutation({
    mutationFn: () => acknowledgePolicyVersion(policyId, versionId, { employeeId }),
    onSuccess: onSaved,
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogHeader>
        <DialogTitle>Record Acknowledgement</DialogTitle>
      </DialogHeader>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (employeeId) mutation.mutate();
        }}
      >
        <p className="text-sm text-muted-foreground">
          Employee self-service acknowledgement is not available yet this sprint — record it on
          their behalf here.
        </p>
        <div className="space-y-1.5">
          <Label>Employee</Label>
          <Select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
            <option value="">Select an employee</option>
            {(employeesData?.items ?? []).map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.employeeCode} — {employee.firstName} {employee.lastName}
              </option>
            ))}
          </Select>
        </div>

        {mutation.isError && (
          <p className="text-sm text-destructive">
            {mutation.error instanceof ApiError
              ? mutation.error.message
              : 'Failed to record acknowledgement.'}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!employeeId || mutation.isPending}>
            {mutation.isPending ? 'Saving…' : 'Record'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
