/**
 * Audit action strings for Sprint 19's Financial Decision & Scenario
 * Analysis (docs/domains/financial-decision-analysis.md) —
 * `DecisionAnalysis`, `DecisionScenario`. Same `<entity>.<event>` naming
 * convention as `debt-audit-actions.ts`/`capital-project-audit-actions.ts`.
 * Deliberately does not audit any read/calculation endpoint (results,
 * sensitivity, cashflow-impact, budget-impact, debt-impact, recommendation,
 * funding-comparison) — those are ephemeral calculation requests, not state
 * changes, per the brief's own explicit instruction.
 */
export const DECISION_ANALYSIS_AUDIT_ACTIONS = {
  DECISION_ANALYSIS_CREATED: 'decision-analysis.created',
  DECISION_ANALYSIS_UPDATED: 'decision-analysis.updated',
  DECISION_ANALYSIS_SUBMITTED: 'decision-analysis.submitted',
  DECISION_ANALYSIS_APPROVED: 'decision-analysis.approved',
  DECISION_ANALYSIS_REJECTED: 'decision-analysis.rejected',
  DECISION_SCENARIO_CREATED: 'decision-scenario.created',
  DECISION_SCENARIO_UPDATED: 'decision-scenario.updated',
  DECISION_SCENARIO_REMOVED: 'decision-scenario.removed',
} as const;
