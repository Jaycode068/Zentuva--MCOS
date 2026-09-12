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
  Select,
  Textarea,
} from '@zentuva/ui';

import { HrTabs } from '@/components/app/hr-tabs';
import { ApiError } from '@/lib/api-client';

import {
  Position,
  activatePosition,
  createPosition,
  deactivatePosition,
  listDepartments,
  listPositions,
  updatePosition,
} from '../api';
import { POSITION_STATUS_LABELS, POSITION_STATUS_VARIANT } from '../labels';

export default function PositionsPage() {
  const [editing, setEditing] = useState<Position | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['hr-positions-full'],
    queryFn: () => listPositions(),
  });
  const { data: departmentsData } = useQuery({
    queryKey: ['hr-departments'],
    queryFn: () => listDepartments(),
  });

  const positions = data?.items ?? [];
  const departmentsById = new Map((departmentsData?.items ?? []).map((d) => [d.id, d]));

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Human Resources</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Job titles — organisational roles, not application access roles.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>New Position</Button>
      </div>

      <HrTabs />

      {isLoading && (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading positions…</p>
      )}
      {isError && (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <p className="text-sm text-destructive">
            {error instanceof ApiError ? error.message : 'Failed to load positions.'}
          </p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      )}

      {!isLoading && !isError && positions.length === 0 && (
        <p className="py-10 text-center text-sm text-muted-foreground">No positions yet.</p>
      )}

      {!isLoading && !isError && positions.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Title</th>
                <th className="px-4 py-3">Department</th>
                <th className="px-4 py-3">Reports To</th>
                <th className="px-4 py-3">Employees</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {positions.map((position) => (
                <tr key={position.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 font-mono text-xs">{position.code}</td>
                  <td className="px-4 py-3 font-medium">{position.title}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {position.departmentId
                      ? (departmentsById.get(position.departmentId)?.name ?? '—')
                      : '—'}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {positions.find((p) => p.id === position.reportsToPositionId)?.title ?? '—'}
                  </td>
                  <td className="px-4 py-3">
                    <a
                      href={`/settings/hr/employees?positionId=${position.id}`}
                      className="text-primary"
                    >
                      {position.employeeCount ?? 0}
                    </a>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={POSITION_STATUS_VARIANT[position.status]}>
                      {POSITION_STATUS_LABELS[position.status]}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button size="sm" variant="outline" onClick={() => setEditing(position)}>
                      Edit
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {createOpen && (
        <PositionDialog
          positions={positions}
          departments={departmentsData?.items ?? []}
          onClose={() => setCreateOpen(false)}
          onSaved={() => {
            setCreateOpen(false);
            refetch();
          }}
        />
      )}
      {editing && (
        <PositionDialog
          position={editing}
          positions={positions}
          departments={departmentsData?.items ?? []}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refetch();
          }}
        />
      )}
    </main>
  );
}

function PositionDialog({
  position,
  positions,
  departments,
  onClose,
  onSaved,
}: {
  position?: Position;
  positions: Position[];
  departments: { id: string; name: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [code, setCode] = useState(position?.code ?? '');
  const [title, setTitle] = useState(position?.title ?? '');
  const [description, setDescription] = useState(position?.description ?? '');
  const [departmentId, setDepartmentId] = useState(position?.departmentId ?? '');
  const [reportsToPositionId, setReportsToPositionId] = useState(
    position?.reportsToPositionId ?? '',
  );

  const activateMutation = useMutation({ mutationFn: () => activatePosition(position!.id) });
  const deactivateMutation = useMutation({ mutationFn: () => deactivatePosition(position!.id) });

  const mutation = useMutation({
    mutationFn: () => {
      const payload = {
        code: code.trim(),
        title: title.trim(),
        description: description.trim() || undefined,
        departmentId: departmentId || undefined,
        reportsToPositionId: reportsToPositionId || undefined,
      };
      return position ? updatePosition(position.id, payload) : createPosition(payload);
    },
    onSuccess: onSaved,
  });

  const canSubmit = code.trim().length > 0 && title.trim().length > 0;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogHeader>
        <DialogTitle>{position ? 'Edit Position' : 'New Position'}</DialogTitle>
      </DialogHeader>
      <form
        className="max-h-[70vh] space-y-4 overflow-y-auto"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit) mutation.mutate();
        }}
      >
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Code</Label>
            <Input value={code} onChange={(e) => setCode(e.target.value)} disabled={!!position} />
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
          <Label>Department</Label>
          <Select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
            <option value="">None</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Reports To</Label>
          <Select
            value={reportsToPositionId}
            onChange={(e) => setReportsToPositionId(e.target.value)}
          >
            <option value="">None</option>
            {positions
              .filter((p) => p.id !== position?.id)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
          </Select>
        </div>

        {mutation.isError && (
          <p className="text-sm text-destructive">
            {mutation.error instanceof ApiError
              ? mutation.error.message
              : 'Failed to save position.'}
          </p>
        )}

        <div className="flex items-center justify-between pt-2">
          <div>
            {position &&
              (position.status === 'ACTIVE' ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={deactivateMutation.isPending}
                  onClick={() => deactivateMutation.mutate(undefined, { onSuccess: onSaved })}
                >
                  Deactivate
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={activateMutation.isPending}
                  onClick={() => activateMutation.mutate(undefined, { onSuccess: onSaved })}
                >
                  Activate
                </Button>
              ))}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit || mutation.isPending}>
              {mutation.isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}
