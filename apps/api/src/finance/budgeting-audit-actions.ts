/**
 * Audit action strings for Sprint 16's Budgeting & Financial Planning
 * Foundation (docs/domains/budgeting.md) — `Budget`, `BudgetLine`,
 * `CostCentre`. Same `<entity>.<event>` naming convention as
 * `cashflow-audit-actions.ts`/`cash-bank-audit-actions.ts`. Budget vs Actual
 * and Budget vs Forecast (`GET .../vs-actual`, `GET .../vs-forecast`) are pure
 * reads and are never audited — only the entities that shape a plan.
 */
export const BUDGETING_AUDIT_ACTIONS = {
  BUDGET_CREATED: 'budget.created',
  BUDGET_UPDATED: 'budget.updated',
  BUDGET_APPROVED: 'budget.approved',
  BUDGET_ACTIVATED: 'budget.activated',
  BUDGET_REVISED: 'budget.revised',
  BUDGET_CLOSED: 'budget.closed',
  BUDGET_LINE_CREATED: 'budget-line.created',
  BUDGET_LINE_UPDATED: 'budget-line.updated',
  COST_CENTRE_CREATED: 'cost-centre.created',
  COST_CENTRE_UPDATED: 'cost-centre.updated',
  COST_CENTRE_DEACTIVATED: 'cost-centre.deactivated',
  COST_CENTRE_ACTIVATED: 'cost-centre.activated',
} as const;
