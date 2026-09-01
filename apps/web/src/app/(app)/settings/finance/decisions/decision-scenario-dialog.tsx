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
  Select,
} from '@zentuva/ui';

import { ApiError } from '@/lib/api-client';

import { createDecisionScenario, type DecisionScenarioType } from '../api';

/**
 * "Add Scenario" dialog (Sprint 19, docs/domains/financial-decision-
 * analysis.md) — raw planning assumptions only. ROI/NPV/IRR/payback are
 * never entered here; they are always computed live once the scenario
 * exists.
 */
export function DecisionScenarioDialog({
  analysisId,
  hasLinkedCapitalProject,
  hasLinkedDebtFacility,
  onOpenChange,
  onCreated,
}: {
  analysisId: string;
  hasLinkedCapitalProject: boolean;
  hasLinkedDebtFacility: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [name, setName] = useState('');
  const [scenarioType, setScenarioType] = useState<DecisionScenarioType>('CUSTOM');
  const [initialInvestment, setInitialInvestment] = useState('');
  const [additionalCapex, setAdditionalCapex] = useState('');
  const [additionalMonthlyRevenue, setAdditionalMonthlyRevenue] = useState('');
  const [annualRevenueGrowthPercent, setAnnualRevenueGrowthPercent] = useState('0');
  const [rampUpMonths, setRampUpMonths] = useState('0');
  const [additionalMonthlyOperatingCost, setAdditionalMonthlyOperatingCost] = useState('');
  const [cashFundingAmount, setCashFundingAmount] = useState('');
  const [debtFundingAmount, setDebtFundingAmount] = useState('');
  const [debtInterestRatePercent, setDebtInterestRatePercent] = useState('');
  const [debtTermMonths, setDebtTermMonths] = useState('');
  const [workingCapitalImpact, setWorkingCapitalImpact] = useState('0');

  const mutation = useMutation({
    mutationFn: () =>
      createDecisionScenario(analysisId, {
        name,
        scenarioType,
        initialInvestment: initialInvestment ? Number(initialInvestment) : undefined,
        additionalCapex: additionalCapex ? Number(additionalCapex) : undefined,
        additionalMonthlyRevenue: additionalMonthlyRevenue
          ? Number(additionalMonthlyRevenue)
          : undefined,
        annualRevenueGrowthPercent: Number(annualRevenueGrowthPercent),
        rampUpMonths: Number(rampUpMonths),
        additionalMonthlyOperatingCost: additionalMonthlyOperatingCost
          ? Number(additionalMonthlyOperatingCost)
          : undefined,
        cashFundingAmount: cashFundingAmount ? Number(cashFundingAmount) : undefined,
        debtFundingAmount: debtFundingAmount ? Number(debtFundingAmount) : undefined,
        debtInterestRatePercent:
          !hasLinkedDebtFacility && debtInterestRatePercent
            ? Number(debtInterestRatePercent)
            : undefined,
        debtTermMonths:
          !hasLinkedDebtFacility && debtTermMonths ? Number(debtTermMonths) : undefined,
        workingCapitalImpact: Number(workingCapitalImpact),
        idempotencyKey,
      }),
    onSuccess: onCreated,
  });

  const canSubmit = name.trim().length > 0 && (hasLinkedCapitalProject || !!initialInvestment);

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>Add Scenario</DialogTitle>
      </DialogHeader>
      <form
        className="max-h-[70vh] space-y-4 overflow-y-auto pr-1"
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate();
        }}
      >
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Base"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Scenario Type</Label>
            <Select
              value={scenarioType}
              onChange={(event) => setScenarioType(event.target.value as DecisionScenarioType)}
            >
              <option value="BASE">Base</option>
              <option value="OPTIMISTIC">Optimistic</option>
              <option value="PESSIMISTIC">Pessimistic</option>
              <option value="CUSTOM">Custom</option>
            </Select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>
            Initial Investment{' '}
            {hasLinkedCapitalProject
              ? '(optional — inherits the linked project’s Planned Cost)'
              : ''}
          </Label>
          <Input
            type="number"
            value={initialInvestment}
            onChange={(event) => setInitialInvestment(event.target.value)}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Cash Funding</Label>
            <Input
              type="number"
              value={cashFundingAmount}
              onChange={(event) => setCashFundingAmount(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Debt Funding</Label>
            <Input
              type="number"
              value={debtFundingAmount}
              onChange={(event) => setDebtFundingAmount(event.target.value)}
            />
          </div>
        </div>

        {!hasLinkedDebtFacility && Number(debtFundingAmount) > 0 && (
          <div className="grid grid-cols-2 gap-4 rounded-lg border border-border bg-muted/20 p-3">
            <div className="space-y-1.5">
              <Label>Hypothetical Interest Rate (%/yr)</Label>
              <Input
                type="number"
                value={debtInterestRatePercent}
                onChange={(event) => setDebtInterestRatePercent(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Hypothetical Term (months)</Label>
              <Input
                type="number"
                value={debtTermMonths}
                onChange={(event) => setDebtTermMonths(event.target.value)}
              />
            </div>
          </div>
        )}
        {hasLinkedDebtFacility && Number(debtFundingAmount) > 0 && (
          <p className="text-xs text-muted-foreground">
            Debt service uses the linked Debt Facility&apos;s own real interest rate/term/repayment
            method — never a guessed rate.
          </p>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Additional Monthly Revenue</Label>
            <Input
              type="number"
              value={additionalMonthlyRevenue}
              onChange={(event) => setAdditionalMonthlyRevenue(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Additional Monthly Operating Cost</Label>
            <Input
              type="number"
              value={additionalMonthlyOperatingCost}
              onChange={(event) => setAdditionalMonthlyOperatingCost(event.target.value)}
            />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <Label>Annual Revenue Growth (%)</Label>
            <Input
              type="number"
              value={annualRevenueGrowthPercent}
              onChange={(event) => setAnnualRevenueGrowthPercent(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Ramp-Up (months)</Label>
            <Input
              type="number"
              value={rampUpMonths}
              onChange={(event) => setRampUpMonths(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Additional CAPEX</Label>
            <Input
              type="number"
              value={additionalCapex}
              onChange={(event) => setAdditionalCapex(event.target.value)}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Working Capital Impact (optional)</Label>
          <Input
            type="number"
            value={workingCapitalImpact}
            onChange={(event) => setWorkingCapitalImpact(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            A one-time net cash impact at the start of the project (e.g. additional inventory tied
            up). Positive means cash is tied up.
          </p>
        </div>

        {mutation.isError && (
          <p className="text-sm text-destructive">
            {mutation.error instanceof ApiError
              ? mutation.error.message
              : 'Failed to add scenario.'}
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={!canSubmit || mutation.isPending}>
            {mutation.isPending ? 'Adding…' : 'Add Scenario'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
