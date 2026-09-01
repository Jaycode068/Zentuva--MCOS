'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, cn } from '@zentuva/ui';

import { FinanceTabs } from '@/components/app/finance-tabs';
import { ApiError } from '@/lib/api-client';
import { formatCurrency } from '@/lib/format-currency';

import {
  approveDecisionAnalysis,
  getDecisionAnalysis,
  getDecisionAuditHistory,
  getDecisionFundingComparison,
  getDecisionScenarioBudgetImpact,
  getDecisionScenarioCashflowImpact,
  getDecisionScenarioDebtImpact,
  getDecisionScenarioRecommendation,
  getDecisionScenarioResults,
  getDecisionScenarioSensitivity,
  listDecisionScenarios,
  rejectDecisionAnalysis,
  removeDecisionScenario,
  submitDecisionAnalysis,
  type DecisionAnalysis,
  type DecisionFundingComparisonRow,
  type DecisionScenario,
} from '../../api';
import {
  DECISION_ANALYSIS_STATUS_LABELS,
  DECISION_ANALYSIS_STATUS_VARIANT,
  DECISION_RECOMMENDATION_LABELS,
  DECISION_RECOMMENDATION_VARIANT,
  DECISION_SCENARIO_TYPE_LABELS,
  DECISION_TYPE_LABELS,
} from '../../labels';
import { DecisionScenarioDialog } from '../decision-scenario-dialog';

const SENSITIVITY_VARIABLE_LABELS: Record<string, string> = {
  revenueGrowth: 'Revenue Growth',
  interestRate: 'Interest Rate',
  operatingCost: 'Operating Cost',
  initialInvestment: 'Initial Investment',
};

/**
 * Decision Analysis detail (Sprint 19, docs/domains/financial-decision-
 * analysis.md) — the 12-section drill-down: Overview, Investment, Funding,
 * Revenue Assumptions, Cost Assumptions, Cashflow, Budget Impact, Debt
 * Impact, Scenario Comparison, Sensitivity Analysis, Recommendation, Audit
 * History. Every calculated figure below is computed live on the server on
 * every read — nothing here is entered or stored as a "result."
 */
export default function DecisionAnalysisDetailPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const queryClient = useQueryClient();
  const [addScenarioOpen, setAddScenarioOpen] = useState(false);
  const [selectedScenarioId, setSelectedScenarioId] = useState<string | null>(null);

  const { data: analysis } = useQuery({
    queryKey: ['decision-analysis', id],
    queryFn: () => getDecisionAnalysis(id),
  });
  const { data: scenariosData } = useQuery({
    queryKey: ['decision-scenarios', id],
    queryFn: () => listDecisionScenarios(id),
  });
  const scenarios = useMemo(() => scenariosData?.items ?? [], [scenariosData]);
  const selectedScenario =
    scenarios.find((s) => s.id === selectedScenarioId) ?? scenarios[0] ?? null;

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['decision-analysis', id] });
    queryClient.invalidateQueries({ queryKey: ['decision-scenarios', id] });
    queryClient.invalidateQueries({ queryKey: ['decision-analyses'] });
  };

  const submitMutation = useMutation({
    mutationFn: () => submitDecisionAnalysis(id),
    onSuccess: invalidateAll,
  });
  const approveMutation = useMutation({
    mutationFn: () => approveDecisionAnalysis(id),
    onSuccess: invalidateAll,
  });
  const rejectMutation = useMutation({
    mutationFn: () => rejectDecisionAnalysis(id),
    onSuccess: invalidateAll,
  });

  if (!analysis) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-10">
        <p className="text-sm text-muted-foreground">Loading decision analysis…</p>
      </main>
    );
  }

  const editable = analysis.status === 'DRAFT' || analysis.status === 'UNDER_REVIEW';
  const pendingMutation =
    submitMutation.isPending || approveMutation.isPending || rejectMutation.isPending;
  const mutationError = submitMutation.error ?? approveMutation.error ?? rejectMutation.error;

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{analysis.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {DECISION_TYPE_LABELS[analysis.decisionType]}
          </p>
          {analysis.description && (
            <p className="mt-2 text-sm text-muted-foreground">{analysis.description}</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant={DECISION_ANALYSIS_STATUS_VARIANT[analysis.status]}>
            {DECISION_ANALYSIS_STATUS_LABELS[analysis.status]}
          </Badge>
          {analysis.status === 'DRAFT' && (
            <Button onClick={() => submitMutation.mutate()} disabled={pendingMutation}>
              Submit for Review
            </Button>
          )}
          {analysis.status === 'UNDER_REVIEW' && (
            <>
              <Button onClick={() => approveMutation.mutate()} disabled={pendingMutation}>
                Approve
              </Button>
              <Button
                variant="outline"
                onClick={() => rejectMutation.mutate()}
                disabled={pendingMutation}
              >
                Reject
              </Button>
            </>
          )}
        </div>
      </div>

      <FinanceTabs />

      {mutationError && (
        <p className="mb-6 text-sm text-destructive">
          {mutationError instanceof ApiError
            ? mutationError.message
            : 'Failed to update decision analysis.'}
        </p>
      )}

      <OverviewSection analysis={analysis} />

      <Card className="mb-8">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-sm font-medium text-muted-foreground">Scenarios</CardTitle>
          {editable && (
            <Button size="sm" onClick={() => setAddScenarioOpen(true)}>
              Add Scenario
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {scenarios.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No scenarios yet — add a Base scenario to start evaluating this decision.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {scenarios.map((scenario) => (
                <button
                  key={scenario.id}
                  type="button"
                  onClick={() => setSelectedScenarioId(scenario.id)}
                  className={cn(
                    'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                    selectedScenario?.id === scenario.id
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground hover:text-foreground',
                  )}
                >
                  {scenario.name}
                  <span className="ml-1.5 text-[10px] text-muted-foreground">
                    {DECISION_SCENARIO_TYPE_LABELS[scenario.scenarioType]}
                  </span>
                </button>
              ))}
              {editable && (
                <button
                  type="button"
                  onClick={() => {
                    if (!selectedScenario) return;
                    removeDecisionScenario(id, selectedScenario.id).then(invalidateAll);
                  }}
                  disabled={!selectedScenario}
                  className="text-xs text-muted-foreground hover:text-destructive"
                >
                  Remove selected
                </button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {selectedScenario && (
        <>
          <InvestmentSection
            analysisId={id}
            scenario={selectedScenario}
            currency={analysis.currency}
          />
          <FundingSection
            scenario={selectedScenario}
            currency={analysis.currency}
            hasLinkedFacility={!!analysis.debtFacilityId}
          />
          <RevenueAssumptionsSection scenario={selectedScenario} currency={analysis.currency} />
          <CostAssumptionsSection scenario={selectedScenario} currency={analysis.currency} />
          <CashflowSection
            analysisId={id}
            scenarioId={selectedScenario.id}
            currency={analysis.currency}
          />
          <BudgetImpactSection
            analysisId={id}
            scenarioId={selectedScenario.id}
            currency={analysis.currency}
          />
          <DebtImpactSection
            analysisId={id}
            scenarioId={selectedScenario.id}
            currency={analysis.currency}
          />
        </>
      )}

      <ScenarioComparisonSection
        analysisId={id}
        scenarios={scenarios}
        currency={analysis.currency}
      />

      {selectedScenario && (
        <>
          <SensitivitySection
            analysisId={id}
            scenarioId={selectedScenario.id}
            currency={analysis.currency}
          />
          <RecommendationSection analysisId={id} scenarioId={selectedScenario.id} />
        </>
      )}

      <AuditHistorySection analysisId={id} />

      {addScenarioOpen && (
        <DecisionScenarioDialog
          analysisId={id}
          hasLinkedCapitalProject={!!analysis.capitalProjectId}
          hasLinkedDebtFacility={!!analysis.debtFacilityId}
          onOpenChange={() => setAddScenarioOpen(false)}
          onCreated={() => {
            setAddScenarioOpen(false);
            invalidateAll();
          }}
        />
      )}
    </main>
  );
}

function OverviewSection({ analysis }: { analysis: DecisionAnalysis }) {
  return (
    <Card className="mb-8">
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">Overview</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          <Field label="Analysis Period" value={`${analysis.analysisPeriodMonths} months`} />
          <Field label="Discount Rate" value={`${analysis.discountRatePercent}%`} />
          <Field
            label="Max Acceptable Payback"
            value={`${analysis.maxAcceptablePaybackYears} yrs`}
          />
          <Field label="Currency" value={analysis.currency} />
          <Field label="Linked Capital Project" value={analysis.capitalProjectId ? 'Yes' : 'No'} />
          <Field label="Linked Debt Facility" value={analysis.debtFacilityId ? 'Yes' : 'No'} />
          <Field
            label="Submitted"
            value={analysis.submittedAt ? new Date(analysis.submittedAt).toLocaleDateString() : '—'}
          />
          <Field
            label="Approved"
            value={analysis.approvedAt ? new Date(analysis.approvedAt).toLocaleDateString() : '—'}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-medium">{value}</p>
    </div>
  );
}

function InvestmentSection({
  analysisId,
  scenario,
  currency,
}: {
  analysisId: string;
  scenario: DecisionScenario;
  currency: string;
}) {
  const { data: results } = useQuery({
    queryKey: ['decision-scenario-results', analysisId, scenario.id],
    queryFn: () => getDecisionScenarioResults(analysisId, scenario.id),
  });

  return (
    <Card className="mb-8">
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Investment — {scenario.name}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          <SummaryCard
            title="Initial Investment"
            value={results ? formatCurrency(results.initialInvestment, currency) : '—'}
          />
          <SummaryCard title="NPV" value={results ? formatCurrency(results.npv, currency) : '—'} />
          <SummaryCard
            title="IRR"
            value={results ? (results.irr === null ? 'Unavailable' : `${results.irr}%`) : '—'}
          />
          <SummaryCard
            title="ROI"
            value={results ? (results.roi === null ? '—' : `${results.roi}%`) : '—'}
          />
          <SummaryCard
            title="Payback"
            value={
              results
                ? results.payback.status === 'RECOVERED'
                  ? `${results.payback.years} yrs`
                  : 'Not Recovered'
                : '—'
            }
          />
          <SummaryCard
            title="Net Benefit"
            value={results ? formatCurrency(results.netBenefit, currency) : '—'}
          />
          <SummaryCard
            title="Break-Even Monthly Revenue"
            value={
              results
                ? formatCurrency(results.breakEven.requiredAdditionalMonthlyRevenue, currency)
                : '—'
            }
          />
          <SummaryCard
            title="Break-Even Utilisation"
            value={
              results
                ? results.breakEven.requiredUtilisationPercent === null
                  ? '—'
                  : `${results.breakEven.requiredUtilisationPercent}%`
                : '—'
            }
          />
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Additional CAPEX {formatCurrency(scenario.additionalCapex, currency)} · Working Capital
          Impact {formatCurrency(scenario.workingCapitalImpact, currency)}
        </p>
      </CardContent>
    </Card>
  );
}

function SummaryCard({ title, value }: { title: string; value: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xs font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-lg font-semibold">{value}</p>
      </CardContent>
    </Card>
  );
}

function FundingSection({
  scenario,
  currency,
  hasLinkedFacility,
}: {
  scenario: DecisionScenario;
  currency: string;
  hasLinkedFacility: boolean;
}) {
  return (
    <Card className="mb-8">
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Funding — {scenario.name}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          <Field
            label="Cash Funding"
            value={formatCurrency(scenario.cashFundingAmount, currency)}
          />
          <Field
            label="Debt Funding"
            value={formatCurrency(scenario.debtFundingAmount, currency)}
          />
          <Field
            label="Financing Source"
            value={
              scenario.debtFundingAmount <= 0
                ? '—'
                : hasLinkedFacility
                  ? 'Linked Debt Facility (real terms)'
                  : 'Hypothetical'
            }
          />
          {!hasLinkedFacility && scenario.debtFundingAmount > 0 && (
            <Field
              label="Hypothetical Rate / Term"
              value={`${scenario.debtInterestRatePercent ?? '—'}% / ${scenario.debtTermMonths ?? '—'} mo`}
            />
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function RevenueAssumptionsSection({
  scenario,
  currency,
}: {
  scenario: DecisionScenario;
  currency: string;
}) {
  return (
    <Card className="mb-8">
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Revenue Assumptions — {scenario.name}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
          <Field
            label="Additional Monthly Revenue"
            value={formatCurrency(scenario.additionalMonthlyRevenue, currency)}
          />
          <Field label="Annual Growth" value={`${scenario.annualRevenueGrowthPercent}%`} />
          <Field label="Ramp-Up" value={`${scenario.rampUpMonths} months`} />
        </div>
      </CardContent>
    </Card>
  );
}

function CostAssumptionsSection({
  scenario,
  currency,
}: {
  scenario: DecisionScenario;
  currency: string;
}) {
  return (
    <Card className="mb-8">
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Cost Assumptions — {scenario.name}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
          <Field
            label="Operating Cost"
            value={formatCurrency(scenario.additionalMonthlyOperatingCost, currency)}
          />
          <Field
            label="Maintenance"
            value={formatCurrency(scenario.additionalMonthlyMaintenanceCost, currency)}
          />
          <Field
            label="Labour"
            value={formatCurrency(scenario.additionalMonthlyLabourCost, currency)}
          />
          <Field
            label="Utilities"
            value={formatCurrency(scenario.additionalMonthlyUtilitiesCost, currency)}
          />
          <Field
            label="Logistics"
            value={formatCurrency(scenario.additionalMonthlyLogisticsCost, currency)}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function CashflowSection({
  analysisId,
  scenarioId,
  currency,
}: {
  analysisId: string;
  scenarioId: string;
  currency: string;
}) {
  const { data } = useQuery({
    queryKey: ['decision-scenario-cashflow-impact', analysisId, scenarioId],
    queryFn: () => getDecisionScenarioCashflowImpact(analysisId, scenarioId),
  });

  return (
    <Card className="mb-8">
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">Cashflow Impact</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-xs text-muted-foreground">
          A read-only overlay on the real Cashflow Forecast — this preview never writes a forecast
          row, and running it changes nothing else in Finance.
        </p>
        {!data ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <>
            <div className="mb-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
              <Field
                label="Minimum Cash Reserve"
                value={formatCurrency(data.minimumCashReserve, currency)}
              />
              <Field
                label="Minimum Projected Cash"
                value={formatCurrency(data.minCashPosition, currency)}
              />
              <Field
                label="Shortfall Months"
                value={
                  data.shortfallMonths === 0
                    ? 'None'
                    : `${data.shortfallMonths}${data.recoveryMonth ? ` (recovers month ${data.recoveryMonth})` : ''}`
                }
              />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-left text-muted-foreground">
                  <tr>
                    <th className="py-1.5 pr-3 font-medium">Month</th>
                    <th className="py-1.5 pr-3 text-right font-medium">Base Closing</th>
                    <th className="py-1.5 pr-3 text-right font-medium">Scenario Impact</th>
                    <th className="py-1.5 pr-3 text-right font-medium">Scenario Closing</th>
                  </tr>
                </thead>
                <tbody>
                  {data.periods.slice(0, 24).map((period) => (
                    <tr
                      key={period.periodStart}
                      className={cn(
                        'border-t border-border/60',
                        period.belowMinimumReserve && 'bg-destructive/5',
                      )}
                    >
                      <td className="py-1.5 pr-3">{period.label}</td>
                      <td className="py-1.5 pr-3 text-right">
                        {formatCurrency(period.baseClosingBalance, currency)}
                      </td>
                      <td className="py-1.5 pr-3 text-right">
                        {formatCurrency(period.scenarioImpact, currency)}
                      </td>
                      <td className="py-1.5 pr-3 text-right font-medium">
                        {formatCurrency(period.scenarioClosingBalance, currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function BudgetImpactSection({
  analysisId,
  scenarioId,
  currency,
}: {
  analysisId: string;
  scenarioId: string;
  currency: string;
}) {
  const { data } = useQuery({
    queryKey: ['decision-scenario-budget-impact', analysisId, scenarioId],
    queryFn: () => getDecisionScenarioBudgetImpact(analysisId, scenarioId),
  });

  return (
    <Card className="mb-8">
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">Budget Impact</CardTitle>
      </CardHeader>
      <CardContent>
        {!data || !data.applicable ? (
          <p className="text-sm text-muted-foreground">
            {data?.reason ?? 'Not applicable — no linked capital project with a budget allocation.'}
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
            <Field
              label="Current Budget"
              value={formatCurrency(data.budgetedAmount ?? 0, currency)}
            />
            <Field label="Planned Cost" value={formatCurrency(data.plannedCost ?? 0, currency)} />
            <Field
              label="Scenario Impact"
              value={formatCurrency(data.scenarioImpact ?? 0, currency)}
            />
            <Field label="Status" value={data.withinBudget ? 'Within Budget' : 'Over Budget'} />
          </div>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          Read-only — never modifies the referenced budget.
        </p>
      </CardContent>
    </Card>
  );
}

function DebtImpactSection({
  analysisId,
  scenarioId,
  currency,
}: {
  analysisId: string;
  scenarioId: string;
  currency: string;
}) {
  const { data } = useQuery({
    queryKey: ['decision-scenario-debt-impact', analysisId, scenarioId],
    queryFn: () => getDecisionScenarioDebtImpact(analysisId, scenarioId),
  });

  return (
    <Card className="mb-8">
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">Debt Impact</CardTitle>
      </CardHeader>
      <CardContent>
        {!data || !data.applicable ? (
          <p className="text-sm text-muted-foreground">
            {data?.reason ?? 'This scenario has no debt funding.'}
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
            <Field
              label="Initial Cash Requirement"
              value={formatCurrency(data.initialCashRequirement, currency)}
            />
            <Field
              label="Monthly Debt Service"
              value={formatCurrency(data.monthlyDebtService, currency)}
            />
            <Field label="Total Interest" value={formatCurrency(data.totalInterest, currency)} />
            <Field
              label="Total Debt Service"
              value={formatCurrency(data.totalDebtService, currency)}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ScenarioComparisonSection({
  analysisId,
  scenarios,
  currency,
}: {
  analysisId: string;
  scenarios: DecisionScenario[];
  currency: string;
}) {
  const scenarioIds = scenarios.map((s) => s.id);
  const { data } = useQuery({
    queryKey: ['decision-funding-comparison', analysisId, scenarioIds],
    queryFn: () => getDecisionFundingComparison(analysisId, scenarioIds),
    enabled: scenarioIds.length > 0,
  });
  const rows = data ?? [];

  return (
    <Card className="mb-8">
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Scenario Comparison
        </CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Add at least one scenario to compare.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-1.5 pr-3 font-medium">Scenario</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Investment</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Cash</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Debt</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Monthly Debt Service</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Total Interest</th>
                  <th className="py-1.5 pr-3 text-right font-medium">NPV</th>
                  <th className="py-1.5 pr-3 text-right font-medium">IRR</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Payback</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Min Cash</th>
                  <th className="py-1.5 pr-3 font-medium">Recommendation</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row: DecisionFundingComparisonRow) => (
                  <tr key={row.scenarioId} className="border-t border-border/60">
                    <td className="py-1.5 pr-3 font-medium">{row.name}</td>
                    <td className="py-1.5 pr-3 text-right">
                      {formatCurrency(row.initialInvestment, currency)}
                    </td>
                    <td className="py-1.5 pr-3 text-right">
                      {formatCurrency(row.cashFundingAmount, currency)}
                    </td>
                    <td className="py-1.5 pr-3 text-right">
                      {formatCurrency(row.debtFundingAmount, currency)}
                    </td>
                    <td className="py-1.5 pr-3 text-right">
                      {formatCurrency(row.monthlyDebtService, currency)}
                    </td>
                    <td className="py-1.5 pr-3 text-right">
                      {formatCurrency(row.totalInterest, currency)}
                    </td>
                    <td className="py-1.5 pr-3 text-right font-medium">
                      {formatCurrency(row.npv, currency)}
                    </td>
                    <td className="py-1.5 pr-3 text-right">
                      {row.irr === null ? '—' : `${row.irr}%`}
                    </td>
                    <td className="py-1.5 pr-3 text-right">
                      {row.paybackStatus === 'RECOVERED'
                        ? `${row.paybackYears} yrs`
                        : 'Not Recovered'}
                    </td>
                    <td className="py-1.5 pr-3 text-right">
                      {formatCurrency(row.minCashPosition, currency)}
                    </td>
                    <td className="py-1.5 pr-3">
                      <Badge variant={DECISION_RECOMMENDATION_VARIANT[row.recommendation]}>
                        {DECISION_RECOMMENDATION_LABELS[row.recommendation]}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SensitivitySection({
  analysisId,
  scenarioId,
  currency,
}: {
  analysisId: string;
  scenarioId: string;
  currency: string;
}) {
  const { data } = useQuery({
    queryKey: ['decision-scenario-sensitivity', analysisId, scenarioId],
    queryFn: () => getDecisionScenarioSensitivity(analysisId, scenarioId),
  });
  const rows = data ?? [];
  const grouped = rows.reduce<Record<string, typeof rows>>((acc, row) => {
    (acc[row.variable] ??= []).push(row);
    return acc;
  }, {});

  return (
    <Card className="mb-8">
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Sensitivity Analysis
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-xs text-muted-foreground">
          One variable at a time — each row perturbs a single assumption by ±10%/±20% and recomputes
          NPV/ROI/Payback. Never a multi-variable matrix.
        </p>
        {Object.entries(grouped).map(([variable, variableRows]) => (
          <div key={variable} className="mb-4 overflow-x-auto">
            <p className="mb-1 text-xs font-medium">
              {SENSITIVITY_VARIABLE_LABELS[variable] ?? variable}
            </p>
            <table className="w-full text-xs">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-1 pr-3 font-medium">Delta</th>
                  <th className="py-1 pr-3 text-right font-medium">NPV</th>
                  <th className="py-1 pr-3 text-right font-medium">ROI</th>
                  <th className="py-1 pr-3 text-right font-medium">Payback</th>
                </tr>
              </thead>
              <tbody>
                {variableRows
                  .sort((a, b) => a.deltaPercent - b.deltaPercent)
                  .map((row) => (
                    <tr
                      key={row.deltaPercent}
                      className={cn(
                        'border-t border-border/60',
                        row.deltaPercent === 0 && 'font-medium',
                      )}
                    >
                      <td className="py-1 pr-3">
                        {row.deltaPercent === 0
                          ? 'Base'
                          : `${row.deltaPercent > 0 ? '+' : ''}${row.deltaPercent}%`}
                      </td>
                      <td className="py-1 pr-3 text-right">{formatCurrency(row.npv, currency)}</td>
                      <td className="py-1 pr-3 text-right">
                        {row.roi === null ? '—' : `${row.roi}%`}
                      </td>
                      <td className="py-1 pr-3 text-right">
                        {row.paybackYears === null ? 'Not Recovered' : `${row.paybackYears} yrs`}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function RecommendationSection({
  analysisId,
  scenarioId,
}: {
  analysisId: string;
  scenarioId: string;
}) {
  const { data } = useQuery({
    queryKey: ['decision-scenario-recommendation', analysisId, scenarioId],
    queryFn: () => getDecisionScenarioRecommendation(analysisId, scenarioId),
  });

  return (
    <Card className="mb-8">
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">Recommendation</CardTitle>
      </CardHeader>
      <CardContent>
        {!data ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <>
            <Badge variant={DECISION_RECOMMENDATION_VARIANT[data.recommendation]} className="mb-3">
              {DECISION_RECOMMENDATION_LABELS[data.recommendation]}
            </Badge>
            <p className="mb-3 text-xs text-muted-foreground">
              Rule-based and transparent — not an AI judgement. NPV &gt; 0 and Payback within{' '}
              {data.maxAcceptablePaybackYears} years and no downside cash shortfall → Attractive.
            </p>
            <ul className="space-y-1 text-sm">
              <li>{data.npvPositive ? '✓' : '✗'} NPV is positive</li>
              <li>
                {data.paybackRecovered ? '✓' : '✗'} Investment is recovered within the analysis
                period
              </li>
              <li>
                {data.paybackWithinThreshold ? '✓' : '✗'} Payback ({data.paybackYears ?? '—'} yrs)
                is within the {data.maxAcceptablePaybackYears}-year threshold
              </li>
              {data.downsideChecked && (
                <li>
                  {data.downsideOk ? '✓' : '✗'} The Pessimistic scenario shows no real cash
                  shortfall
                </li>
              )}
              {!data.downsideChecked && (
                <li className="text-muted-foreground">
                  No Pessimistic sibling scenario exists yet — downside risk not yet checked
                </li>
              )}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function AuditHistorySection({ analysisId }: { analysisId: string }) {
  const { data } = useQuery({
    queryKey: ['decision-audit-history', analysisId],
    queryFn: () => getDecisionAuditHistory(analysisId),
  });
  const items = data?.items ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">Audit History</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No state-changing actions recorded yet.</p>
        ) : (
          <ul className="space-y-2 text-xs">
            {items.map((event) => (
              <li
                key={event.id}
                className="flex items-center justify-between border-t border-border/60 pt-2"
              >
                <span className="font-medium">{event.action}</span>
                <span className="text-muted-foreground">
                  {new Date(event.createdAt).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
