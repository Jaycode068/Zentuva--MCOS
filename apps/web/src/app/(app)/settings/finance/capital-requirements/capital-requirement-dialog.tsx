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

import {
  createCapitalRequirement,
  listBudgetLines,
  listBudgets,
  listCostCentres,
  type CapitalRequirementPriority,
  type CapitalRequirementType,
} from '../api';

/**
 * "Add Capital Requirement" dialog (Sprint 17, docs/domains/
 * debt-management.md §3) — the business reason for financing, optionally
 * linked to a Budget/BudgetLine for a live Budget Coverage % — never a
 * `DebtFacility` itself, and never mutates the budget it references.
 */
export function CapitalRequirementDialog({
  onOpenChange,
  onCreated,
}: {
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [requiredAmount, setRequiredAmount] = useState('');
  const [requiredDate, setRequiredDate] = useState('');
  const [type, setType] = useState<CapitalRequirementType>('EQUIPMENT');
  const [priority, setPriority] = useState<CapitalRequirementPriority>('MEDIUM');
  const [budgetId, setBudgetId] = useState('');
  const [budgetLineId, setBudgetLineId] = useState('');
  const [costCentreId, setCostCentreId] = useState('');

  const { data: budgetsData } = useQuery({
    queryKey: ['budgets', 'ACTIVE'],
    queryFn: () => listBudgets({ status: 'ACTIVE' }),
  });
  const budgets = budgetsData?.items ?? [];

  const { data: linesData } = useQuery({
    queryKey: ['budget-lines', budgetId],
    queryFn: () => listBudgetLines(budgetId),
    enabled: !!budgetId,
  });
  const capexLines = (linesData?.items ?? []).filter((line) => line.lineType === 'CAPEX');

  const { data: costCentresData } = useQuery({
    queryKey: ['cost-centres', 'ACTIVE'],
    queryFn: () => listCostCentres({ status: 'ACTIVE' }),
  });
  const costCentres = costCentresData?.items ?? [];

  const mutation = useMutation({
    mutationFn: () =>
      createCapitalRequirement({
        title,
        description: description || undefined,
        requiredAmount: Number(requiredAmount),
        requiredDate,
        type,
        priority,
        budgetId: budgetId || undefined,
        budgetLineId: budgetLineId || undefined,
        costCentreId: costCentreId || undefined,
        idempotencyKey,
      }),
    onSuccess: onCreated,
  });

  const canSubmit = title.trim().length > 0 && Number(requiredAmount) > 0 && !!requiredDate;

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>Add Capital Requirement</DialogTitle>
      </DialogHeader>
      <form
        className="space-y-4"
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
            placeholder="e.g. Packaging Machine Expansion"
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
            <Label>Required Amount</Label>
            <Input
              type="number"
              value={requiredAmount}
              onChange={(event) => setRequiredAmount(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Required By</Label>
            <Input
              type="date"
              value={requiredDate}
              onChange={(event) => setRequiredDate(event.target.value)}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Type</Label>
            <Select
              value={type}
              onChange={(event) => setType(event.target.value as CapitalRequirementType)}
            >
              <option value="CAPEX">CAPEX</option>
              <option value="WORKING_CAPITAL">Working Capital</option>
              <option value="EXPANSION">Expansion</option>
              <option value="EQUIPMENT">Equipment</option>
              <option value="OTHER">Other</option>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Priority</Label>
            <Select
              value={priority}
              onChange={(event) => setPriority(event.target.value as CapitalRequirementPriority)}
            >
              <option value="LOW">Low</option>
              <option value="MEDIUM">Medium</option>
              <option value="HIGH">High</option>
              <option value="CRITICAL">Critical</option>
            </Select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Cost Centre (optional)</Label>
          <Select value={costCentreId} onChange={(event) => setCostCentreId(event.target.value)}>
            <option value="">None</option>
            {costCentres.map((cc) => (
              <option key={cc.id} value={cc.id}>
                {cc.name}
              </option>
            ))}
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label>Budget (optional)</Label>
          <Select
            value={budgetId}
            onChange={(event) => {
              setBudgetId(event.target.value);
              setBudgetLineId('');
            }}
          >
            <option value="">None — no Budget Coverage shown</option>
            {budgets.map((budget) => (
              <option key={budget.id} value={budget.id}>
                {budget.budgetCode} — {budget.name}
              </option>
            ))}
          </Select>
          <p className="text-xs text-muted-foreground">
            Read-only reference for Budget Coverage % — never modifies the budget itself.
          </p>
        </div>

        {budgetId && capexLines.length > 0 && (
          <div className="space-y-1.5">
            <Label>Budget Line (optional)</Label>
            <Select value={budgetLineId} onChange={(event) => setBudgetLineId(event.target.value)}>
              <option value="">None — sum every CAPEX line in the budget</option>
              {capexLines.map((line) => (
                <option key={line.id} value={line.id}>
                  {line.description ?? line.id}
                </option>
              ))}
            </Select>
          </div>
        )}

        {mutation.isError && (
          <p className="text-sm text-destructive">
            {mutation.error instanceof ApiError
              ? mutation.error.message
              : 'Failed to create capital requirement.'}
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={!canSubmit || mutation.isPending}>
            {mutation.isPending ? 'Creating…' : 'Add Capital Requirement'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
