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

import { listAssetCategories, listAssets } from '@/app/(app)/settings/assets/api';
import { ApiError } from '@/lib/api-client';

import { type MaintenancePriority, createMaintenancePlan, listMaintenanceTypes } from '../api';

/** "New Maintenance Plan" dialog (Sprint 21, docs/domains/maintenance.md)
 *  — targets exactly one of a specific Asset or an Asset Category, with
 *  an inline checklist editor. */
export function PlanDialog({
  onOpenChange,
  onCreated,
}: {
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [maintenanceTypeId, setMaintenanceTypeId] = useState('');
  const [targetKind, setTargetKind] = useState<'asset' | 'category'>('asset');
  const [assetId, setAssetId] = useState('');
  const [assetCategoryId, setAssetCategoryId] = useState('');
  const [priority, setPriority] = useState<MaintenancePriority>('MEDIUM');
  const [instructions, setInstructions] = useState('');
  const [tasks, setTasks] = useState<string[]>(['']);

  const { data: assetsData } = useQuery({ queryKey: ['assets'], queryFn: () => listAssets() });
  const { data: categoriesData } = useQuery({
    queryKey: ['asset-categories'],
    queryFn: () => listAssetCategories(),
  });
  const { data: typesData } = useQuery({
    queryKey: ['maintenance-types', 'ACTIVE'],
    queryFn: () => listMaintenanceTypes({ status: 'ACTIVE' }),
  });

  const mutation = useMutation({
    mutationFn: () =>
      createMaintenancePlan({
        name,
        description: description || undefined,
        maintenanceTypeId,
        assetId: targetKind === 'asset' ? assetId : undefined,
        assetCategoryId: targetKind === 'category' ? assetCategoryId : undefined,
        priority,
        instructions: instructions || undefined,
        tasks: tasks
          .filter((t) => t.trim().length > 0)
          .map((title) => ({ title, mandatory: true })),
        idempotencyKey,
      }),
    onSuccess: onCreated,
  });

  const canSubmit =
    name.trim().length > 0 &&
    !!maintenanceTypeId &&
    (targetKind === 'asset' ? !!assetId : !!assetCategoryId);

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>New Maintenance Plan</DialogTitle>
      </DialogHeader>
      <form
        className="max-h-[70vh] space-y-4 overflow-y-auto pr-1"
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate();
        }}
      >
        <div className="space-y-1.5">
          <Label>Name</Label>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Compressor Monthly Service"
          />
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

        <div className="space-y-1.5">
          <Label>Applies To</Label>
          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                checked={targetKind === 'asset'}
                onChange={() => setTargetKind('asset')}
              />
              A specific asset
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                checked={targetKind === 'category'}
                onChange={() => setTargetKind('category')}
              />
              An asset category
            </label>
          </div>
          {targetKind === 'asset' ? (
            <Select
              value={assetId}
              onChange={(event) => setAssetId(event.target.value)}
              className="mt-2"
            >
              <option value="">Select asset…</option>
              {(assetsData?.items ?? []).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          ) : (
            <Select
              value={assetCategoryId}
              onChange={(event) => setAssetCategoryId(event.target.value)}
              className="mt-2"
            >
              <option value="">Select category…</option>
              {(categoriesData?.items ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          )}
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
          <Label>Instructions (optional)</Label>
          <Textarea
            rows={2}
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
          />
        </div>

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
          <Label>Checklist Tasks</Label>
          {tasks.map((task, index) => (
            <div key={index} className="flex gap-2">
              <Input
                value={task}
                onChange={(event) => {
                  const next = [...tasks];
                  next[index] = event.target.value;
                  setTasks(next);
                }}
                placeholder={`Step ${index + 1}`}
              />
              {tasks.length > 1 && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setTasks(tasks.filter((_, i) => i !== index))}
                >
                  ✕
                </Button>
              )}
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setTasks([...tasks, ''])}
          >
            Add Step
          </Button>
        </div>

        {mutation.isError && (
          <p className="text-sm text-destructive">
            {mutation.error instanceof ApiError ? mutation.error.message : 'Failed to create plan.'}
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={!canSubmit || mutation.isPending}>
            {mutation.isPending ? 'Creating…' : 'Create Plan'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
