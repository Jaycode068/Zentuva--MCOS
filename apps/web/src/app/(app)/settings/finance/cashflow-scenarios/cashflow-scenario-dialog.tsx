'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  Button,
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Textarea,
} from '@zentuva/ui';

import { ApiError } from '@/lib/api-client';

import { createCashflowScenario, updateCashflowScenario, type CashflowScenario } from '../api';

/**
 * Create/edit dialog for a `CashflowScenario` (Sprint 15, docs/domains/cashflow.md
 * §7) — four numeric knobs applied on top of the base forecast, never a rules
 * engine. Base behaves identically to no scenario selected (all knobs at their
 * identity values: 0 delay days, 1.0 multiplier).
 */
export function CashflowScenarioDialog({
  scenario,
  onOpenChange,
  onSaved,
}: {
  scenario?: CashflowScenario;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [name, setName] = useState(scenario?.name ?? '');
  const [description, setDescription] = useState(scenario?.description ?? '');
  const [inflowDelayDays, setInflowDelayDays] = useState(scenario?.inflowDelayDays ?? 0);
  const [inflowMultiplier, setInflowMultiplier] = useState(scenario?.inflowMultiplier ?? 1);
  const [outflowDelayDays, setOutflowDelayDays] = useState(scenario?.outflowDelayDays ?? 0);
  const [outflowMultiplier, setOutflowMultiplier] = useState(scenario?.outflowMultiplier ?? 1);

  const mutation = useMutation({
    mutationFn: () =>
      scenario
        ? updateCashflowScenario(scenario.id, {
            name,
            description: description || null,
            inflowDelayDays,
            inflowMultiplier,
            outflowDelayDays,
            outflowMultiplier,
          })
        : createCashflowScenario({
            name,
            description: description || undefined,
            inflowDelayDays,
            inflowMultiplier,
            outflowDelayDays,
            outflowMultiplier,
            idempotencyKey,
          }),
    onSuccess: onSaved,
  });

  const canSubmit = name.trim().length > 0;

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>{scenario ? 'Edit Scenario' : 'Add Scenario'}</DialogTitle>
      </DialogHeader>
      <form
        className="space-y-4"
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
            placeholder="e.g. Conservative"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Description (optional)</Label>
          <Textarea
            rows={2}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Inflow Delay (days)</Label>
            <Input
              type="number"
              min="0"
              value={inflowDelayDays}
              onChange={(event) => setInflowDelayDays(Number(event.target.value))}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Inflow Multiplier</Label>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={inflowMultiplier}
              onChange={(event) => setInflowMultiplier(Number(event.target.value))}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Outflow Delay (days)</Label>
            <Input
              type="number"
              min="0"
              value={outflowDelayDays}
              onChange={(event) => setOutflowDelayDays(Number(event.target.value))}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Outflow Multiplier</Label>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={outflowMultiplier}
              onChange={(event) => setOutflowMultiplier(Number(event.target.value))}
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Applied on top of every inflow/outflow item when this scenario is selected on the Cashflow
          dashboard — a configurable adjustment, not a prediction model.
        </p>

        {mutation.isError && (
          <p className="text-sm text-destructive">
            {mutation.error instanceof ApiError
              ? mutation.error.message
              : 'Failed to save scenario.'}
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={!canSubmit || mutation.isPending}>
            {mutation.isPending ? 'Saving…' : scenario ? 'Save Changes' : 'Add Scenario'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
