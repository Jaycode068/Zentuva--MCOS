'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Button,
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  Textarea,
} from '@zentuva/ui';

import { listAssets } from '@/app/(app)/settings/assets/api';
import { ApiError } from '@/lib/api-client';

import {
  type MaintenanceIssueType,
  type MaintenancePriority,
  createMaintenanceRequest,
} from '../api';
import { MAINTENANCE_ISSUE_TYPE_LABELS } from '../labels';

/** "Report a Problem" dialog (Sprint 21, docs/domains/maintenance.md) —
 *  `requestCode` is always server-generated. */
export function RequestDialog({
  onOpenChange,
  onCreated,
}: {
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [assetId, setAssetId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<MaintenancePriority>('MEDIUM');
  const [issueType, setIssueType] = useState<MaintenanceIssueType | ''>('');

  const { data: assetsData } = useQuery({ queryKey: ['assets'], queryFn: () => listAssets() });

  const mutation = useMutation({
    mutationFn: () =>
      createMaintenanceRequest({
        assetId,
        title,
        description: description || undefined,
        priority,
        issueType: issueType || undefined,
        idempotencyKey,
      }),
    onSuccess: onCreated,
  });

  const canSubmit = title.trim().length > 0 && !!assetId;

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>Report a Problem</DialogTitle>
      </DialogHeader>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate();
        }}
      >
        <div className="space-y-1.5">
          <Label>Asset</Label>
          <Select value={assetId} onChange={(event) => setAssetId(event.target.value)}>
            <option value="">Select…</option>
            {(assetsData?.items ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label>Title</Label>
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="e.g. Compressor pressure unstable"
          />
        </div>

        <div className="space-y-1.5">
          <Label>Description (optional)</Label>
          <Textarea
            rows={3}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Priority</Label>
            <Select
              value={priority}
              onChange={(event) => setPriority(event.target.value as MaintenancePriority)}
            >
              <option value="LOW">Low</option>
              <option value="MEDIUM">Medium</option>
              <option value="HIGH">High</option>
              <option value="CRITICAL">Critical</option>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Issue Type (optional)</Label>
            <Select
              value={issueType}
              onChange={(event) => setIssueType(event.target.value as MaintenanceIssueType)}
            >
              <option value="">Select…</option>
              {Object.entries(MAINTENANCE_ISSUE_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
        </div>

        {mutation.isError && (
          <p className="text-sm text-destructive">
            {mutation.error instanceof ApiError
              ? mutation.error.message
              : 'Failed to create request.'}
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={!canSubmit || mutation.isPending}>
            {mutation.isPending ? 'Submitting…' : 'Submit Request'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
