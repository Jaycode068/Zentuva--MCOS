'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Select,
} from '@zentuva/ui';

import { FinanceTabs } from '@/components/app/finance-tabs';
import { ApiError } from '@/lib/api-client';
import { formatCurrency } from '@/lib/format-currency';

import {
  addCapitalProjectCostLine,
  addCapitalProjectFunding,
  getCapitalProject,
  getCapitalProjectBudgetAllocation,
  listCapitalProjectCostLines,
  listCapitalProjectFunding,
  listCashAccounts,
  listDebtFacilities,
  removeCapitalProjectCostLine,
  removeCapitalProjectFunding,
  transitionCapitalProject,
  type CapitalProjectFundingType,
  type CapitalProjectTransition,
  type CapitalProjectWithFinancials,
} from '../../api';
import {
  CAPITAL_PROJECT_CATEGORY_LABELS,
  CAPITAL_PROJECT_FUNDING_STATUS_LABELS,
  CAPITAL_PROJECT_FUNDING_STATUS_VARIANT,
  CAPITAL_PROJECT_FUNDING_TYPE_LABELS,
  CAPITAL_PROJECT_STATUS_LABELS,
  CAPITAL_PROJECT_STATUS_VARIANT,
} from '../../labels';

const TRANSITION_BUTTONS: Partial<
  Record<
    CapitalProjectWithFinancials['status'],
    { transition: CapitalProjectTransition; label: string }[]
  >
> = {
  DRAFT: [{ transition: 'submit', label: 'Submit' }],
  PROPOSED: [{ transition: 'start-review', label: 'Start Review' }],
  UNDER_REVIEW: [
    { transition: 'approve', label: 'Approve' },
    { transition: 'reject', label: 'Reject' },
  ],
  APPROVED: [{ transition: 'activate', label: 'Activate' }],
  ACTIVE: [
    { transition: 'hold', label: 'Place On Hold' },
    { transition: 'complete', label: 'Complete' },
  ],
  ON_HOLD: [
    { transition: 'resume', label: 'Resume' },
    { transition: 'cancel', label: 'Cancel' },
  ],
};

const CANCELLABLE_STATUSES = new Set(['DRAFT', 'PROPOSED', 'UNDER_REVIEW', 'APPROVED']);

/**
 * Capital Project detail (Sprint 18, docs/domains/investment-projects.md) —
 * Overview, Financial Plan, Funding, Budget, Spending/Actuals, Timeline, and
 * Assumptions. Every financial figure here is server-computed on read,
 * never entered or stored directly on this page.
 */
export default function CapitalProjectDetailPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: project } = useQuery({
    queryKey: ['capital-project', id],
    queryFn: () => getCapitalProject(id),
  });
  const { data: budgetAllocation } = useQuery({
    queryKey: ['capital-project-budget-allocation', id],
    queryFn: () => getCapitalProjectBudgetAllocation(id),
    enabled: !!project?.budgetId,
  });

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['capital-project', id] });
    queryClient.invalidateQueries({ queryKey: ['capital-project-budget-allocation', id] });
    queryClient.invalidateQueries({ queryKey: ['capital-projects'] });
  };

  const transitionMutation = useMutation({
    mutationFn: (transition: CapitalProjectTransition) => transitionCapitalProject(id, transition),
    onSuccess: invalidateAll,
  });

  if (!project) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-10">
        <p className="text-sm text-muted-foreground">Loading capital project…</p>
      </main>
    );
  }

  const transitions = TRANSITION_BUTTONS[project.status] ?? [];
  const canCancel = CANCELLABLE_STATUSES.has(project.status);

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {project.projectCode} · {CAPITAL_PROJECT_CATEGORY_LABELS[project.category]}
          </p>
          {project.businessPurpose && (
            <p className="mt-2 text-sm text-muted-foreground">{project.businessPurpose}</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant={CAPITAL_PROJECT_STATUS_VARIANT[project.status]}>
            {CAPITAL_PROJECT_STATUS_LABELS[project.status]}
          </Badge>
          <Button
            variant="outline"
            onClick={() =>
              router.push(`/settings/finance/decisions?capitalProjectId=${project.id}`)
            }
          >
            Create Decision Analysis
          </Button>
          {transitions.map((action) => (
            <Button
              key={action.transition}
              variant={action.transition === 'reject' ? 'outline' : undefined}
              onClick={() => transitionMutation.mutate(action.transition)}
              disabled={transitionMutation.isPending}
            >
              {action.label}
            </Button>
          ))}
          {canCancel && (
            <Button
              variant="outline"
              onClick={() => transitionMutation.mutate('cancel')}
              disabled={transitionMutation.isPending}
            >
              Cancel
            </Button>
          )}
        </div>
      </div>

      <FinanceTabs />

      {transitionMutation.isError && (
        <p className="mb-6 text-sm text-destructive">
          {transitionMutation.error instanceof ApiError
            ? transitionMutation.error.message
            : 'Failed to update project.'}
        </p>
      )}

      <FinancialSummary project={project} />

      <FinancialPlanSection
        projectId={id}
        currency={project.currency}
        isDraft={project.status === 'DRAFT'}
        onSaved={invalidateAll}
      />

      <FundingSection
        projectId={id}
        currency={project.currency}
        status={project.status}
        onSaved={invalidateAll}
      />

      {project.budgetId && budgetAllocation && (
        <BudgetSection allocation={budgetAllocation} currency={project.currency} />
      )}

      <TimelineSection project={project} />

      <AssumptionsSection project={project} />
    </main>
  );
}

function FinancialSummary({ project }: { project: CapitalProjectWithFinancials }) {
  const { financials } = project;
  return (
    <div className="mb-8 space-y-4">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <SummaryCard
          title="Planned Cost"
          value={financials.plannedCost}
          currency={project.currency}
        />
        <SummaryCard
          title="Total Funding"
          value={financials.totalFunding}
          currency={project.currency}
        />
        <SummaryCard
          title="Funding Gap"
          value={financials.fundingGap}
          currency={project.currency}
        />
        <SummaryCard
          title="Committed Cost"
          value={financials.committedCost}
          currency={project.currency}
        />
        <SummaryCard
          title="Actual Cost"
          value={financials.actualCost}
          currency={project.currency}
        />
        <SummaryCard
          title="Remaining Cost"
          value={financials.remainingCost}
          currency={project.currency}
        />
      </div>
      <Badge variant={CAPITAL_PROJECT_FUNDING_STATUS_VARIANT[financials.fundingStatus]}>
        {CAPITAL_PROJECT_FUNDING_STATUS_LABELS[financials.fundingStatus]}
      </Badge>
    </div>
  );
}

function SummaryCard({
  title,
  value,
  currency,
}: {
  title: string;
  value: number;
  currency: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xs font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-lg font-semibold">{formatCurrency(value, currency)}</p>
      </CardContent>
    </Card>
  );
}

function FinancialPlanSection({
  projectId,
  currency,
  isDraft,
  onSaved,
}: {
  projectId: string;
  currency: string;
  isDraft: boolean;
  onSaved: () => void;
}) {
  const queryClient = useQueryClient();
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [plannedAmount, setPlannedAmount] = useState('');
  const [plannedMonth, setPlannedMonth] = useState('');

  const invalidateCostLines = () => {
    queryClient.invalidateQueries({ queryKey: ['capital-project-cost-lines', projectId] });
    onSaved();
  };

  const removeMutation = useMutation({
    mutationFn: (costLineId: string) => removeCapitalProjectCostLine(projectId, costLineId),
    onSuccess: invalidateCostLines,
  });
  const addMutation = useMutation({
    mutationFn: () =>
      addCapitalProjectCostLine(projectId, {
        description,
        category: category || undefined,
        plannedAmount: Number(plannedAmount),
        plannedMonth,
      }),
    onSuccess: () => {
      setDescription('');
      setCategory('');
      setPlannedAmount('');
      setPlannedMonth('');
      invalidateCostLines();
    },
  });

  return (
    <Card className="mb-8">
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">Financial Plan</CardTitle>
      </CardHeader>
      <CardContent>
        <CostLineRows
          projectId={projectId}
          currency={currency}
          isDraft={isDraft}
          onRemove={(id) => removeMutation.mutate(id)}
        />

        {isDraft && (
          <div className="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-border bg-muted/20 p-3">
            <div className="space-y-1">
              <label className="text-[10px] text-muted-foreground">Description</label>
              <Input
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                className="h-8 w-40"
                placeholder="e.g. Machine"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] text-muted-foreground">Category</label>
              <Input
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                className="h-8 w-32"
                placeholder="e.g. Equipment"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] text-muted-foreground">Amount</label>
              <Input
                type="number"
                value={plannedAmount}
                onChange={(event) => setPlannedAmount(event.target.value)}
                className="h-8 w-32"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] text-muted-foreground">Planned Month</label>
              <Input
                type="date"
                value={plannedMonth}
                onChange={(event) => setPlannedMonth(event.target.value)}
                className="h-8"
              />
            </div>
            <Button
              size="sm"
              disabled={!description || !plannedAmount || !plannedMonth || addMutation.isPending}
              onClick={() => addMutation.mutate()}
            >
              {addMutation.isPending ? 'Adding…' : 'Add Cost Line'}
            </Button>
          </div>
        )}
        {!isDraft && (
          <p className="mt-3 text-xs text-muted-foreground">
            Cost lines are editable only while the project is still a Draft.
          </p>
        )}
        {addMutation.isError && (
          <p className="mt-2 text-sm text-destructive">
            {addMutation.error instanceof ApiError
              ? addMutation.error.message
              : 'Failed to add cost line.'}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function CostLineRows({
  projectId,
  currency,
  isDraft,
  onRemove,
}: {
  projectId: string;
  currency: string;
  isDraft: boolean;
  onRemove: (costLineId: string) => void;
}) {
  const { data } = useQuery({
    queryKey: ['capital-project-cost-lines', projectId],
    queryFn: () => listCapitalProjectCostLines(projectId),
  });
  const lines = data?.items ?? [];
  const total = lines.reduce((sum, line) => sum + line.plannedAmount, 0);

  if (lines.length === 0) {
    return <p className="text-sm text-muted-foreground">No cost lines yet.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="text-left text-muted-foreground">
          <tr>
            <th className="py-1.5 pr-3 font-medium">Description</th>
            <th className="py-1.5 pr-3 font-medium">Category</th>
            <th className="py-1.5 pr-3 font-medium">Month</th>
            <th className="py-1.5 pr-3 text-right font-medium">Amount</th>
            {isDraft && <th className="py-1.5 text-right font-medium">Actions</th>}
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.id} className="border-t border-border/60">
              <td className="py-1.5 pr-3">{line.description}</td>
              <td className="py-1.5 pr-3 text-muted-foreground">{line.category ?? '—'}</td>
              <td className="py-1.5 pr-3">{new Date(line.plannedMonth).toLocaleDateString()}</td>
              <td className="py-1.5 pr-3 text-right font-medium">
                {formatCurrency(line.plannedAmount, currency)}
              </td>
              {isDraft && (
                <td className="py-1.5 text-right">
                  <button
                    type="button"
                    onClick={() => onRemove(line.id)}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    Remove
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-border font-medium">
            <td className="py-1.5 pr-3" colSpan={3}>
              Total
            </td>
            <td className="py-1.5 pr-3 text-right">{formatCurrency(total, currency)}</td>
            {isDraft && <td />}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function FundingSection({
  projectId,
  currency,
  status,
  onSaved,
}: {
  projectId: string;
  currency: string;
  status: CapitalProjectWithFinancials['status'];
  onSaved: () => void;
}) {
  const editable = status !== 'COMPLETED' && status !== 'CANCELLED';
  const queryClient = useQueryClient();

  const [fundingType, setFundingType] = useState<CapitalProjectFundingType>('CASH');
  const [amount, setAmount] = useState('');
  const [debtFacilityId, setDebtFacilityId] = useState('');
  const [cashAccountId, setCashAccountId] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  const { data: fundingData } = useQuery({
    queryKey: ['capital-project-funding', projectId],
    queryFn: () => listCapitalProjectFunding(projectId),
  });
  const rows = fundingData?.items ?? [];

  const { data: debtFacilitiesData } = useQuery({
    queryKey: ['debt-facilities'],
    queryFn: () => listDebtFacilities(),
  });
  const debtFacilities = debtFacilitiesData?.items ?? [];

  const { data: cashAccountsData } = useQuery({
    queryKey: ['cash-accounts', 'ACTIVE'],
    queryFn: () => listCashAccounts({ status: 'ACTIVE' }),
  });
  const cashAccounts = cashAccountsData?.items ?? [];

  const invalidateFunding = () => {
    queryClient.invalidateQueries({ queryKey: ['capital-project-funding', projectId] });
    onSaved();
  };

  const addMutation = useMutation({
    mutationFn: () =>
      addCapitalProjectFunding(projectId, {
        fundingType,
        amount: Number(amount),
        debtFacilityId: fundingType === 'DEBT' ? debtFacilityId : undefined,
        cashAccountId: fundingType === 'CASH' ? cashAccountId || undefined : undefined,
        idempotencyKey,
      }),
    onSuccess: () => {
      setAmount('');
      setIdempotencyKey(crypto.randomUUID());
      invalidateFunding();
    },
  });
  const removeMutation = useMutation({
    mutationFn: (fundingId: string) => removeCapitalProjectFunding(projectId, fundingId),
    onSuccess: invalidateFunding,
  });

  return (
    <Card className="mb-8">
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">Funding</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No funding sources yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-1.5 pr-3 font-medium">Type</th>
                  <th className="py-1.5 pr-3 font-medium">Description</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Amount</th>
                  {editable && <th className="py-1.5 text-right font-medium">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-t border-border/60">
                    <td className="py-1.5 pr-3">
                      {CAPITAL_PROJECT_FUNDING_TYPE_LABELS[row.fundingType]}
                    </td>
                    <td className="py-1.5 pr-3 text-muted-foreground">{row.description ?? '—'}</td>
                    <td className="py-1.5 pr-3 text-right font-medium">
                      {formatCurrency(row.amount, currency)}
                    </td>
                    {editable && (
                      <td className="py-1.5 text-right">
                        <button
                          type="button"
                          onClick={() => removeMutation.mutate(row.id)}
                          className="text-muted-foreground hover:text-destructive"
                        >
                          Remove
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {editable && (
          <div className="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-border bg-muted/20 p-3">
            <div className="space-y-1">
              <label className="text-[10px] text-muted-foreground">Type</label>
              <Select
                value={fundingType}
                onChange={(event) =>
                  setFundingType(event.target.value as CapitalProjectFundingType)
                }
                className="h-8"
              >
                <option value="CASH">Cash</option>
                <option value="DEBT">Debt</option>
                <option value="OTHER">Other</option>
              </Select>
            </div>
            {fundingType === 'DEBT' && (
              <div className="space-y-1">
                <label className="text-[10px] text-muted-foreground">Debt Facility</label>
                <Select
                  value={debtFacilityId}
                  onChange={(event) => setDebtFacilityId(event.target.value)}
                  className="h-8"
                >
                  <option value="">Select…</option>
                  {debtFacilities.map((facility) => (
                    <option key={facility.id} value={facility.id}>
                      {facility.name}
                    </option>
                  ))}
                </Select>
              </div>
            )}
            {fundingType === 'CASH' && (
              <div className="space-y-1">
                <label className="text-[10px] text-muted-foreground">Cash Account (optional)</label>
                <Select
                  value={cashAccountId}
                  onChange={(event) => setCashAccountId(event.target.value)}
                  className="h-8"
                >
                  <option value="">None</option>
                  {cashAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                    </option>
                  ))}
                </Select>
              </div>
            )}
            <div className="space-y-1">
              <label className="text-[10px] text-muted-foreground">Amount</label>
              <Input
                type="number"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                className="h-8 w-32"
              />
            </div>
            <Button
              size="sm"
              disabled={
                !amount || (fundingType === 'DEBT' && !debtFacilityId) || addMutation.isPending
              }
              onClick={() => addMutation.mutate()}
            >
              {addMutation.isPending ? 'Adding…' : 'Add Funding'}
            </Button>
          </div>
        )}
        {addMutation.isError && (
          <p className="mt-2 text-sm text-destructive">
            {addMutation.error instanceof ApiError
              ? addMutation.error.message
              : 'Failed to add funding.'}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function BudgetSection({
  allocation,
  currency,
}: {
  allocation: { budgetedAmount: number; plannedCost: number; allocationPercent: number | null };
  currency: string;
}) {
  return (
    <Card className="mb-8">
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">Budget</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-xs text-muted-foreground">
          Read-only — never modifies the referenced budget.
        </p>
        <div className="grid grid-cols-3 gap-4 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">Budgeted Amount</p>
            <p className="font-semibold">{formatCurrency(allocation.budgetedAmount, currency)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Planned Cost</p>
            <p className="font-semibold">{formatCurrency(allocation.plannedCost, currency)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Allocation</p>
            <p className="font-semibold">
              {allocation.allocationPercent === null
                ? '—'
                : `${allocation.allocationPercent.toFixed(1)}%`}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function TimelineSection({ project }: { project: CapitalProjectWithFinancials }) {
  return (
    <Card className="mb-8">
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">Timeline</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          <div>
            <p className="text-xs text-muted-foreground">Planned Start</p>
            <p className="font-medium">{new Date(project.plannedStartDate).toLocaleDateString()}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Planned Completion</p>
            <p className="font-medium">
              {new Date(project.plannedCompletionDate).toLocaleDateString()}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Actual Start</p>
            <p className="font-medium">
              {project.actualStartDate
                ? new Date(project.actualStartDate).toLocaleDateString()
                : '—'}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Actual Completion</p>
            <p className="font-medium">
              {project.actualCompletionDate
                ? new Date(project.actualCompletionDate).toLocaleDateString()
                : '—'}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function AssumptionsSection({ project }: { project: CapitalProjectWithFinancials }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">Assumptions</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-xs text-muted-foreground">
          Planning assumptions only — not a calculated investment decision (ROI/NPV/IRR/payback
          require the future decision-analysis engine).
        </p>
        <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
          <Assumption
            label="Expected Additional Annual Revenue"
            value={
              project.expectedAnnualRevenueImpact === null
                ? null
                : formatCurrency(project.expectedAnnualRevenueImpact, project.currency)
            }
          />
          <Assumption
            label="Expected Additional Annual Operating Cost"
            value={
              project.expectedAnnualOperatingCostImpact === null
                ? null
                : formatCurrency(project.expectedAnnualOperatingCostImpact, project.currency)
            }
          />
          <Assumption
            label="Expected Annual Savings"
            value={
              project.expectedAnnualSavings === null
                ? null
                : formatCurrency(project.expectedAnnualSavings, project.currency)
            }
          />
          <Assumption
            label="Useful Life (years)"
            value={project.usefulLifeYears?.toString() ?? null}
          />
          <Assumption
            label="Current Capacity (units/day)"
            value={project.currentCapacityUnitsPerDay?.toLocaleString() ?? null}
          />
          <Assumption
            label="Expected Capacity (units/day)"
            value={project.expectedCapacityUnitsPerDay?.toLocaleString() ?? null}
          />
          <Assumption
            label="Expected Commissioning Date"
            value={
              project.expectedCommissioningDate
                ? new Date(project.expectedCommissioningDate).toLocaleDateString()
                : null
            }
          />
        </div>
      </CardContent>
    </Card>
  );
}

function Assumption({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-medium">{value ?? '—'}</p>
    </div>
  );
}
