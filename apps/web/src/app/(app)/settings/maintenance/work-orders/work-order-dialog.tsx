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
  type MaintenancePriority,
  createWorkOrder,
  listMaintenanceTypes,
  listTechnicians,
} from '../api';

/** "New Work Order" dialog (Sprint 21, docs/domains/maintenance.md) — the
 *  header only. `workOrderCode` is always server-generated. */
export function WorkOrderDialog({
  onOpenChange,
  onCreated,
}: {
  onOpenChange: (open: boolean) => void;
  onCreated: (id: string) => void;
}) {
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [assetId, setAssetId] = useState('');
  const [maintenanceTypeId, setMaintenanceTypeId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<MaintenancePriority>('MEDIUM');
  const [assignedToId, setAssignedToId] = useState('');
  const [failureReason, setFailureReason] = useState('');

  const { data: assetsData } = useQuery({ queryKey: ['assets'], queryFn: () => listAssets() });
  const { data: typesData } = useQuery({
    queryKey: ['maintenance-types', 'ACTIVE'],
    queryFn: () => listMaintenanceTypes({ status: 'ACTIVE' }),
  });
  const { data: techniciansData } = useQuery({
    queryKey: ['maintenance-technicians'],
    queryFn: () => listTechnicians(),
  });

  const mutation = useMutation({
    mutationFn: () =>
      createWorkOrder({
        assetId,
        maintenanceTypeId,
        title,
        description: description || undefined,
        priority,
        assignedToId: assignedToId || undefined,
        failureReason: failureReason || undefined,
        idempotencyKey,
      }),
    onSuccess: (workOrder) => onCreated(workOrder.id),
  });

  const canSubmit = title.trim().length > 0 && !!assetId && !!maintenanceTypeId;

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>New Work Order</DialogTitle>
      </DialogHeader>
      <form
        className="max-h-[70vh] space-y-4 overflow-y-auto pr-1"
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate();
        }}
      >
        <div className="space-y-1.5">
          <Label>Title</Label>
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="e.g. Compressor pressure unstable"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
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
            <Label>Maintenance Type</Label>
            <Select
              value={maintenanceTypeId}
              onChange={(event) => setMaintenanceTypeId(event.target.value)}
            >
              <option value="">Select…</option>
              {(typesData?.items ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Description (optional)</Label>
          <Textarea
            rows={2}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label>Failure Reason (optional — for corrective/breakdown work)</Label>
          <Textarea
            rows={2}
            value={failureReason}
            onChange={(event) => setFailureReason(event.target.value)}
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
            <Label>Assign Technician (optional)</Label>
            <Select value={assignedToId} onChange={(event) => setAssignedToId(event.target.value)}>
              <option value="">Unassigned</option>
              {(techniciansData?.items ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.firstName} {t.lastName}
                </option>
              ))}
            </Select>
          </div>
        </div>

        {mutation.isError && (
          <p className="text-sm text-destructive">
            {mutation.error instanceof ApiError
              ? mutation.error.message
              : 'Failed to create work order.'}
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={!canSubmit || mutation.isPending}>
            {mutation.isPending ? 'Creating…' : 'Create Work Order'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
