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
} from '@zentuva/ui';

import { listAssetMeters, listAssets } from '@/app/(app)/settings/assets/api';
import { ApiError } from '@/lib/api-client';

import {
  type MaintenanceFrequencyUnit,
  type MaintenanceScheduleType,
  createMaintenanceSchedule,
  listMaintenancePlans,
} from '../api';

/** "New Schedule" dialog (Sprint 21, docs/domains/maintenance.md) — a
 *  concrete, per-asset recurrence of a plan, date-based or meter-based. */
export function ScheduleDialog({
  onOpenChange,
  onCreated,
}: {
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [maintenancePlanId, setMaintenancePlanId] = useState('');
  const [assetId, setAssetId] = useState('');
  const [scheduleType, setScheduleType] = useState<MaintenanceScheduleType>('DATE_BASED');
  const [frequencyValue, setFrequencyValue] = useState('30');
  const [frequencyUnit, setFrequencyUnit] = useState<MaintenanceFrequencyUnit>('DAYS');
  const [nextDueDate, setNextDueDate] = useState('');
  const [meterInterval, setMeterInterval] = useState('500');
  const [nextDueMeterReading, setNextDueMeterReading] = useState('');

  const { data: plansData } = useQuery({
    queryKey: ['maintenance-plans'],
    queryFn: () => listMaintenancePlans(),
  });
  const { data: assetsData } = useQuery({ queryKey: ['assets'], queryFn: () => listAssets() });
  const { data: metersData } = useQuery({
    queryKey: ['asset-meters', assetId],
    queryFn: () => listAssetMeters(assetId),
    enabled: !!assetId && scheduleType === 'METER_BASED',
  });
  const meterType = metersData?.items?.[0]?.meterType;

  const mutation = useMutation({
    mutationFn: () =>
      createMaintenanceSchedule({
        maintenancePlanId,
        assetId,
        scheduleType,
        frequencyValue: scheduleType === 'DATE_BASED' ? Number(frequencyValue) : undefined,
        frequencyUnit: scheduleType === 'DATE_BASED' ? frequencyUnit : undefined,
        nextDueDate: scheduleType === 'DATE_BASED' ? nextDueDate : undefined,
        meterType: scheduleType === 'METER_BASED' ? meterType : undefined,
        meterInterval: scheduleType === 'METER_BASED' ? Number(meterInterval) : undefined,
        nextDueMeterReading:
          scheduleType === 'METER_BASED' ? Number(nextDueMeterReading) : undefined,
        idempotencyKey,
      }),
    onSuccess: onCreated,
  });

  const canSubmit =
    !!maintenancePlanId &&
    !!assetId &&
    (scheduleType === 'DATE_BASED' ? !!nextDueDate : !!meterType && !!nextDueMeterReading);

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>New Maintenance Schedule</DialogTitle>
      </DialogHeader>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate();
        }}
      >
        <div className="space-y-1.5">
          <Label>Plan</Label>
          <Select
            value={maintenancePlanId}
            onChange={(event) => setMaintenancePlanId(event.target.value)}
          >
            <option value="">Select…</option>
            {(plansData?.items ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>

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
          <Label>Trigger</Label>
          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                checked={scheduleType === 'DATE_BASED'}
                onChange={() => setScheduleType('DATE_BASED')}
              />
              Date-based
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                checked={scheduleType === 'METER_BASED'}
                onChange={() => setScheduleType('METER_BASED')}
              />
              Meter-based
            </label>
          </div>
        </div>

        {scheduleType === 'DATE_BASED' ? (
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Every</Label>
              <div className="flex gap-2">
                <Input
                  type="number"
                  min="1"
                  value={frequencyValue}
                  onChange={(event) => setFrequencyValue(event.target.value)}
                />
                <Select
                  value={frequencyUnit}
                  onChange={(event) =>
                    setFrequencyUnit(event.target.value as MaintenanceFrequencyUnit)
                  }
                >
                  <option value="DAYS">Days</option>
                  <option value="WEEKS">Weeks</option>
                  <option value="MONTHS">Months</option>
                  <option value="YEARS">Years</option>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Next Due Date</Label>
              <Input
                type="date"
                value={nextDueDate}
                onChange={(event) => setNextDueDate(event.target.value)}
              />
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {assetId && !meterType && (
              <p className="text-xs text-destructive">
                This asset has no meter yet — add one on the asset page first.
              </p>
            )}
            <div className="space-y-1.5">
              <Label>Every (interval)</Label>
              <Input
                type="number"
                min="1"
                value={meterInterval}
                onChange={(event) => setMeterInterval(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Next Due Reading</Label>
              <Input
                type="number"
                value={nextDueMeterReading}
                onChange={(event) => setNextDueMeterReading(event.target.value)}
              />
            </div>
          </div>
        )}

        {mutation.isError && (
          <p className="text-sm text-destructive">
            {mutation.error instanceof ApiError
              ? mutation.error.message
              : 'Failed to create schedule.'}
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={!canSubmit || mutation.isPending}>
            {mutation.isPending ? 'Creating…' : 'Create Schedule'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
