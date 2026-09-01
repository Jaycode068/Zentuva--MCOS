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
  createCapitalProject,
  listBudgetLines,
  listBudgets,
  listCapitalRequirements,
  listCostCentres,
  type CapitalProjectCategory,
} from '../api';

/**
 * "Add Capital Project" dialog (Sprint 18, docs/domains/
 * investment-projects.md §5) — the project header only. Planned Cost is
 * never entered here: it is always the server-computed sum of this
 * project's own cost lines, added afterward on the detail page.
 */
export function CapitalProjectDialog({
  onOpenChange,
  onCreated,
}: {
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [businessPurpose, setBusinessPurpose] = useState('');
  const [category, setCategory] = useState<CapitalProjectCategory>('PRODUCTION_EQUIPMENT');
  const [costCentreId, setCostCentreId] = useState('');
  const [capitalRequirementId, setCapitalRequirementId] = useState('');
  const [budgetId, setBudgetId] = useState('');
  const [budgetLineId, setBudgetLineId] = useState('');
  const [plannedStartDate, setPlannedStartDate] = useState('');
  const [plannedCompletionDate, setPlannedCompletionDate] = useState('');
  const [expectedAnnualRevenueImpact, setExpectedAnnualRevenueImpact] = useState('');
  const [expectedAnnualOperatingCostImpact, setExpectedAnnualOperatingCostImpact] = useState('');

  const { data: costCentresData } = useQuery({
    queryKey: ['cost-centres', 'ACTIVE'],
    queryFn: () => listCostCentres({ status: 'ACTIVE' }),
  });
  const costCentres = costCentresData?.items ?? [];

  const { data: requirementsData } = useQuery({
    queryKey: ['capital-requirements'],
    queryFn: () => listCapitalRequirements(),
  });
  const capitalRequirements = requirementsData?.items ?? [];

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

  const mutation = useMutation({
    mutationFn: () =>
      createCapitalProject({
        name,
        description: description || undefined,
        businessPurpose: businessPurpose || undefined,
        category,
        costCentreId: costCentreId || undefined,
        capitalRequirementId: capitalRequirementId || undefined,
        budgetId: budgetId || undefined,
        budgetLineId: budgetLineId || undefined,
        plannedStartDate,
        plannedCompletionDate,
        expectedAnnualRevenueImpact: expectedAnnualRevenueImpact
          ? Number(expectedAnnualRevenueImpact)
          : undefined,
        expectedAnnualOperatingCostImpact: expectedAnnualOperatingCostImpact
          ? Number(expectedAnnualOperatingCostImpact)
          : undefined,
        idempotencyKey,
      }),
    onSuccess: onCreated,
  });

  const canSubmit = name.trim().length > 0 && !!plannedStartDate && !!plannedCompletionDate;

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>Add Capital Project</DialogTitle>
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
            placeholder="e.g. Plantain Chips Production Line Expansion"
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

        <div className="space-y-1.5">
          <Label>Business Purpose (optional)</Label>
          <Input
            value={businessPurpose}
            onChange={(event) => setBusinessPurpose(event.target.value)}
            placeholder="e.g. Increase production capacity"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Category</Label>
            <Select
              value={category}
              onChange={(event) => setCategory(event.target.value as CapitalProjectCategory)}
            >
              <option value="PRODUCTION_EQUIPMENT">Production Equipment</option>
              <option value="FACTORY_EXPANSION">Factory Expansion</option>
              <option value="WAREHOUSE">Warehouse</option>
              <option value="VEHICLE">Vehicle</option>
              <option value="POWER_ENERGY">Power / Energy</option>
              <option value="TECHNOLOGY">Technology</option>
              <option value="INFRASTRUCTURE">Infrastructure</option>
              <option value="OTHER">Other</option>
            </Select>
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
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Planned Start</Label>
            <Input
              type="date"
              value={plannedStartDate}
              onChange={(event) => setPlannedStartDate(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Planned Completion</Label>
            <Input
              type="date"
              value={plannedCompletionDate}
              onChange={(event) => setPlannedCompletionDate(event.target.value)}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Capital Requirement (optional)</Label>
          <Select
            value={capitalRequirementId}
            onChange={(event) => setCapitalRequirementId(event.target.value)}
          >
            <option value="">None</option>
            {capitalRequirements.map((requirement) => (
              <option key={requirement.id} value={requirement.id}>
                {requirement.title}
              </option>
            ))}
          </Select>
          <p className="text-xs text-muted-foreground">
            A project need not originate from a Capital Requirement.
          </p>
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
            <option value="">None — no Budget Allocation shown</option>
            {budgets.map((budget) => (
              <option key={budget.id} value={budget.id}>
                {budget.budgetCode} — {budget.name}
              </option>
            ))}
          </Select>
          <p className="text-xs text-muted-foreground">
            Read-only reference — never modifies the budget itself.
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

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Expected Additional Annual Revenue (optional)</Label>
            <Input
              type="number"
              value={expectedAnnualRevenueImpact}
              onChange={(event) => setExpectedAnnualRevenueImpact(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Expected Additional Annual Operating Cost (optional)</Label>
            <Input
              type="number"
              value={expectedAnnualOperatingCostImpact}
              onChange={(event) => setExpectedAnnualOperatingCostImpact(event.target.value)}
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Planning assumptions only — not a calculated investment decision. See the Assumptions
          section on the project detail page for the full set.
        </p>

        {mutation.isError && (
          <p className="text-sm text-destructive">
            {mutation.error instanceof ApiError
              ? mutation.error.message
              : 'Failed to create capital project.'}
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={!canSubmit || mutation.isPending}>
            {mutation.isPending ? 'Creating…' : 'Add Capital Project'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
