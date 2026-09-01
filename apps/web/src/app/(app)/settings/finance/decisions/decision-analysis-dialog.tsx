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
  createDecisionAnalysis,
  listCapitalProjects,
  listDebtFacilities,
  type DecisionType,
} from '../api';

/**
 * "New Decision Analysis" dialog (Sprint 19, docs/domains/financial-
 * decision-analysis.md) — the header only. Scenarios (Base/Optimistic/
 * Pessimistic/Custom, each with their own assumptions) are added afterward
 * on the detail page, never here.
 */
export function DecisionAnalysisDialog({
  onOpenChange,
  onCreated,
  defaultCapitalProjectId,
}: {
  onOpenChange: (open: boolean) => void;
  onCreated: (id: string) => void;
  defaultCapitalProjectId?: string;
}) {
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [decisionType, setDecisionType] = useState<DecisionType>('NEW_INVESTMENT');
  const [capitalProjectId, setCapitalProjectId] = useState(defaultCapitalProjectId ?? '');
  const [debtFacilityId, setDebtFacilityId] = useState('');
  const [analysisPeriodMonths, setAnalysisPeriodMonths] = useState('36');
  const [discountRatePercent, setDiscountRatePercent] = useState('15');
  const [maxAcceptablePaybackYears, setMaxAcceptablePaybackYears] = useState('3');

  const { data: projectsData } = useQuery({
    queryKey: ['capital-projects'],
    queryFn: () => listCapitalProjects(),
  });
  const projects = projectsData?.items ?? [];

  const { data: facilitiesData } = useQuery({
    queryKey: ['debt-facilities'],
    queryFn: () => listDebtFacilities(),
  });
  const facilities = facilitiesData?.items ?? [];

  const mutation = useMutation({
    mutationFn: () =>
      createDecisionAnalysis({
        name,
        description: description || undefined,
        decisionType,
        capitalProjectId: capitalProjectId || undefined,
        debtFacilityId: debtFacilityId || undefined,
        analysisPeriodMonths: Number(analysisPeriodMonths),
        discountRatePercent: Number(discountRatePercent),
        maxAcceptablePaybackYears: Number(maxAcceptablePaybackYears),
        idempotencyKey,
      }),
    onSuccess: (analysis) => onCreated(analysis.id),
  });

  const canSubmit = name.trim().length > 0;

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>New Decision Analysis</DialogTitle>
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
            placeholder="e.g. Plantain Chips Line — Investment Decision"
          />
        </div>

        <div className="space-y-1.5">
          <Label>Description (optional)</Label>
          <Textarea
            rows={2}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="What decision is being evaluated?"
          />
        </div>

        <div className="space-y-1.5">
          <Label>Decision Type</Label>
          <Select
            value={decisionType}
            onChange={(event) => setDecisionType(event.target.value as DecisionType)}
          >
            <option value="NEW_INVESTMENT">New Investment</option>
            <option value="EXPANSION">Expansion</option>
            <option value="EQUIPMENT_UPGRADE">Equipment Upgrade</option>
            <option value="COST_REDUCTION">Cost Reduction</option>
            <option value="OTHER">Other</option>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label>Capital Project (optional)</Label>
          <Select
            value={capitalProjectId}
            onChange={(event) => setCapitalProjectId(event.target.value)}
          >
            <option value="">None — enter investment amount per scenario</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.projectCode} — {project.name}
              </option>
            ))}
          </Select>
          <p className="text-xs text-muted-foreground">
            When linked, each scenario inherits the project&apos;s own live Planned Cost as its
            investment amount unless overridden.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label>Debt Facility (optional)</Label>
          <Select
            value={debtFacilityId}
            onChange={(event) => setDebtFacilityId(event.target.value)}
          >
            <option value="">None — scenarios use a hypothetical rate/term</option>
            {facilities.map((facility) => (
              <option key={facility.id} value={facility.id}>
                {facility.facilityCode} — {facility.name}
              </option>
            ))}
          </Select>
          <p className="text-xs text-muted-foreground">
            When linked, debt-funded scenarios use this facility&apos;s own real interest
            rate/term/repayment method — never a guessed rate.
          </p>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <Label>Analysis Period (months)</Label>
            <Input
              type="number"
              value={analysisPeriodMonths}
              onChange={(event) => setAnalysisPeriodMonths(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Discount Rate (%)</Label>
            <Input
              type="number"
              value={discountRatePercent}
              onChange={(event) => setDiscountRatePercent(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Max Acceptable Payback (years)</Label>
            <Input
              type="number"
              value={maxAcceptablePaybackYears}
              onChange={(event) => setMaxAcceptablePaybackYears(event.target.value)}
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          The discount rate and payback threshold drive every scenario&apos;s NPV and recommendation
          — shown here so they are never a hidden default.
        </p>

        {mutation.isError && (
          <p className="text-sm text-destructive">
            {mutation.error instanceof ApiError
              ? mutation.error.message
              : 'Failed to create decision analysis.'}
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={!canSubmit || mutation.isPending}>
            {mutation.isPending ? 'Creating…' : 'Create Decision Analysis'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
