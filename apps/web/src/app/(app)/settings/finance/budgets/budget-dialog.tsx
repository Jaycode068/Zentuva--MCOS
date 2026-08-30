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

import { ApiError } from '@/lib/api-client';

import { createBudget, listCashflowScenarios } from '../api';

/**
 * "Add Budget" dialog (Sprint 16, docs/domains/budgeting.md §11) —
 * `startDate`/`endDate` are never entered here: the API derives them from
 * `fiscalYear` and the organisation's own `fiscalYearStart`, so nothing here
 * can disagree with the org's own configuration.
 */
export function BudgetDialog({
  onOpenChange,
  onCreated,
}: {
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [budgetCode, setBudgetCode] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [fiscalYear, setFiscalYear] = useState(new Date().getFullYear());
  const [scenarioName, setScenarioName] = useState('Base');
  const [cashflowScenarioId, setCashflowScenarioId] = useState('');
  const [currency, setCurrency] = useState('NGN');

  const { data: scenariosData } = useQuery({
    queryKey: ['cashflow-scenarios', 'ACTIVE'],
    queryFn: () => listCashflowScenarios({ status: 'ACTIVE' }),
  });
  const cashflowScenarios = scenariosData?.items ?? [];

  const mutation = useMutation({
    mutationFn: () =>
      createBudget({
        budgetCode,
        name,
        description: description || undefined,
        fiscalYear,
        scenarioName,
        cashflowScenarioId: cashflowScenarioId || undefined,
        currency,
        idempotencyKey,
      }),
    onSuccess: onCreated,
  });

  const canSubmit = budgetCode.trim().length > 0 && name.trim().length > 0;

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>Add Budget</DialogTitle>
      </DialogHeader>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate();
        }}
      >
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Budget Code</Label>
            <Input
              value={budgetCode}
              onChange={(event) => setBudgetCode(event.target.value.toUpperCase())}
              placeholder="e.g. BUD-2026-OPS"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Fiscal Year</Label>
            <Input
              type="number"
              value={fiscalYear}
              onChange={(event) => setFiscalYear(Number(event.target.value))}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Name</Label>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. 2026 Operating Budget"
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
            <Label>Scenario Name</Label>
            <Input
              value={scenarioName}
              onChange={(event) => setScenarioName(event.target.value)}
              placeholder="Base"
            />
            <p className="text-xs text-muted-foreground">
              A different name creates an independent what-if sibling budget (e.g.
              &quot;Growth&quot;), never a modification of an existing one.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label>Currency</Label>
            <Input value={currency} onChange={(event) => setCurrency(event.target.value)} />
          </div>
        </div>

        {cashflowScenarios.length > 0 && (
          <div className="space-y-1.5">
            <Label>Cashflow Scenario (optional)</Label>
            <Select
              value={cashflowScenarioId}
              onChange={(event) => setCashflowScenarioId(event.target.value)}
            >
              <option value="">None — use the Base forecast</option>
              {cashflowScenarios.map((scenario) => (
                <option key={scenario.id} value={scenario.id}>
                  {scenario.name}
                </option>
              ))}
            </Select>
            <p className="text-xs text-muted-foreground">
              Applied when comparing this budget against the Cashflow Forecast — reuses Sprint
              15&apos;s own scenario, never a second engine.
            </p>
          </div>
        )}

        {mutation.isError && (
          <p className="text-sm text-destructive">
            {mutation.error instanceof ApiError
              ? mutation.error.message
              : 'Failed to create budget.'}
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={!canSubmit || mutation.isPending}>
            {mutation.isPending ? 'Creating…' : 'Add Budget'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
