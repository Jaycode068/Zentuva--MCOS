/**
 * Audit action strings for Sprint 18's Investment / Capital Project
 * Management Foundation (docs/domains/investment-projects.md) —
 * `CapitalProject`, `CapitalProjectCostLine`, `CapitalProjectFunding`. Same
 * `<entity>.<event>` naming convention as `debt-audit-actions.ts`.
 */
export const CAPITAL_PROJECT_AUDIT_ACTIONS = {
  CAPITAL_PROJECT_CREATED: 'capital-project.created',
  CAPITAL_PROJECT_UPDATED: 'capital-project.updated',
  CAPITAL_PROJECT_SUBMITTED: 'capital-project.submitted',
  CAPITAL_PROJECT_UNDER_REVIEW: 'capital-project.under-review',
  CAPITAL_PROJECT_APPROVED: 'capital-project.approved',
  CAPITAL_PROJECT_REJECTED: 'capital-project.rejected',
  CAPITAL_PROJECT_ACTIVATED: 'capital-project.activated',
  CAPITAL_PROJECT_ON_HOLD: 'capital-project.on-hold',
  CAPITAL_PROJECT_RESUMED: 'capital-project.resumed',
  CAPITAL_PROJECT_COMPLETED: 'capital-project.completed',
  CAPITAL_PROJECT_CANCELLED: 'capital-project.cancelled',
  CAPITAL_PROJECT_COST_LINE_ADDED: 'capital-project-cost-line.added',
  CAPITAL_PROJECT_COST_LINE_REMOVED: 'capital-project-cost-line.removed',
  CAPITAL_PROJECT_FUNDING_ADDED: 'capital-project-funding.added',
  CAPITAL_PROJECT_FUNDING_REMOVED: 'capital-project-funding.removed',
} as const;
