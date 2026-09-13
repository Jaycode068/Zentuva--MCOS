'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Badge, Button, Dialog, DialogHeader, DialogTitle, Input, Label } from '@zentuva/ui';

import { HrTabs } from '@/components/app/hr-tabs';
import { ApiError } from '@/lib/api-client';

import {
  WorkSchedule,
  activateWorkSchedule,
  createWorkSchedule,
  deactivateWorkSchedule,
  listWorkSchedules,
  updateWorkSchedule,
} from '../api';
import {
  WEEKDAY_LABELS,
  WORK_SCHEDULE_STATUS_LABELS,
  WORK_SCHEDULE_STATUS_VARIANT,
} from '../labels';

export default function SchedulesPage() {
  const [editing, setEditing] = useState<WorkSchedule | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['hr-work-schedules'],
    queryFn: () => listWorkSchedules(),
  });

  const schedules = data?.items ?? [];

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Human Resources</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Work schedules — expected hours used to derive on-time / late attendance.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>New Schedule</Button>
      </div>

      <HrTabs />

      {isLoading && (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading schedules…</p>
      )}
      {isError && (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <p className="text-sm text-destructive">
            {error instanceof ApiError ? error.message : 'Failed to load schedules.'}
          </p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      )}

      {!isLoading && !isError && schedules.length === 0 && (
        <p className="py-10 text-center text-sm text-muted-foreground">No work schedules yet.</p>
      )}

      {!isLoading && !isError && schedules.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Days</th>
                <th className="px-4 py-3">Hours</th>
                <th className="px-4 py-3">Grace</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {schedules.map((schedule) => (
                <tr key={schedule.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 font-mono text-xs">{schedule.code}</td>
                  <td className="px-4 py-3 font-medium">{schedule.name}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {schedule.workDays
                      .slice()
                      .sort()
                      .map((d) => WEEKDAY_LABELS[d])
                      .join(', ')}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {schedule.expectedStartTime}–{schedule.expectedEndTime}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {schedule.gracePeriodMinutes}m
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={WORK_SCHEDULE_STATUS_VARIANT[schedule.status]}>
                      {WORK_SCHEDULE_STATUS_LABELS[schedule.status]}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button size="sm" variant="outline" onClick={() => setEditing(schedule)}>
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
        <ScheduleDialog
          onClose={() => setCreateOpen(false)}
          onSaved={() => {
            setCreateOpen(false);
            refetch();
          }}
        />
      )}
      {editing && (
        <ScheduleDialog
          schedule={editing}
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

function ScheduleDialog({
  schedule,
  onClose,
  onSaved,
}: {
  schedule?: WorkSchedule;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [code, setCode] = useState(schedule?.code ?? '');
  const [name, setName] = useState(schedule?.name ?? '');
  const [description, setDescription] = useState(schedule?.description ?? '');
  const [workDays, setWorkDays] = useState<number[]>(schedule?.workDays ?? [1, 2, 3, 4, 5]);
  const [expectedStartTime, setExpectedStartTime] = useState(
    schedule?.expectedStartTime ?? '09:00',
  );
  const [expectedEndTime, setExpectedEndTime] = useState(schedule?.expectedEndTime ?? '17:00');
  const [gracePeriodMinutes, setGracePeriodMinutes] = useState(
    String(schedule?.gracePeriodMinutes ?? 10),
  );

  const activateMutation = useMutation({ mutationFn: () => activateWorkSchedule(schedule!.id) });
  const deactivateMutation = useMutation({
    mutationFn: () => deactivateWorkSchedule(schedule!.id),
  });

  const mutation = useMutation({
    mutationFn: () => {
      const payload = {
        code: code.trim(),
        name: name.trim(),
        description: description.trim() || undefined,
        workDays,
        expectedStartTime,
        expectedEndTime,
        gracePeriodMinutes: Number(gracePeriodMinutes) || 0,
      };
      return schedule ? updateWorkSchedule(schedule.id, payload) : createWorkSchedule(payload);
    },
    onSuccess: onSaved,
  });

  const canSubmit =
    code.trim().length > 0 &&
    name.trim().length > 0 &&
    workDays.length > 0 &&
    expectedStartTime !== expectedEndTime;

  function toggleDay(day: number) {
    setWorkDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort(),
    );
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogHeader>
        <DialogTitle>{schedule ? 'Edit Work Schedule' : 'New Work Schedule'}</DialogTitle>
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
            <Input value={code} onChange={(e) => setCode(e.target.value)} disabled={!!schedule} />
          </div>
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Description</Label>
          <Input value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Work Days</Label>
          <div className="flex flex-wrap gap-2">
            {WEEKDAY_LABELS.map((label, index) => (
              <button
                key={label}
                type="button"
                onClick={() => toggleDay(index)}
                className={`rounded-md border px-3 py-1.5 text-xs font-medium ${
                  workDays.includes(index)
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border text-muted-foreground'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <Label>Start Time</Label>
            <Input
              type="time"
              value={expectedStartTime}
              onChange={(e) => setExpectedStartTime(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>End Time</Label>
            <Input
              type="time"
              value={expectedEndTime}
              onChange={(e) => setExpectedEndTime(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Grace (minutes)</Label>
            <Input
              type="number"
              min={0}
              value={gracePeriodMinutes}
              onChange={(e) => setGracePeriodMinutes(e.target.value)}
            />
          </div>
        </div>
        {expectedStartTime === expectedEndTime && (
          <p className="text-sm text-destructive">Start and end time cannot be identical.</p>
        )}

        {mutation.isError && (
          <p className="text-sm text-destructive">
            {mutation.error instanceof ApiError
              ? mutation.error.message
              : 'Failed to save schedule.'}
          </p>
        )}

        <div className="flex items-center justify-between pt-2">
          <div>
            {schedule &&
              (schedule.status === 'ACTIVE' ? (
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
