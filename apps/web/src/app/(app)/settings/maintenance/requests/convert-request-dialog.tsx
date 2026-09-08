'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Button,
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  Select,
} from '@zentuva/ui';

import { ApiError } from '@/lib/api-client';

import { convertMaintenanceRequest, listMaintenanceTypes, listTechnicians } from '../api';

/** "Convert to Work Order" dialog — picks the maintenance type and,
 *  optionally, a technician to assign immediately. */
export function ConvertRequestDialog({
  requestId,
  onOpenChange,
  onConverted,
}: {
  requestId: string;
  onOpenChange: (open: boolean) => void;
  onConverted: (workOrderId: string) => void;
}) {
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [maintenanceTypeId, setMaintenanceTypeId] = useState('');
  const [assignedToId, setAssignedToId] = useState('');

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
      convertMaintenanceRequest(requestId, {
        maintenanceTypeId,
        assignedToId: assignedToId || undefined,
        idempotencyKey,
      }),
    onSuccess: ({ workOrder }) => onConverted(workOrder.id),
  });

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>Convert to Work Order</DialogTitle>
      </DialogHeader>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate();
        }}
      >
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

        {mutation.isError && (
          <p className="text-sm text-destructive">
            {mutation.error instanceof ApiError
              ? mutation.error.message
              : 'Failed to convert request.'}
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={!maintenanceTypeId || mutation.isPending}>
            {mutation.isPending ? 'Converting…' : 'Convert'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
