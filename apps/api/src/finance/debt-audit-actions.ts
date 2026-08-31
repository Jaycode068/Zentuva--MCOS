/**
 * Audit action strings for Sprint 17's Capital & Debt Management Foundation
 * (docs/domains/debt-management.md) — `Lender`, `CapitalRequirement`,
 * `DebtFacility`, `DebtDrawdown`, `DebtRepayment`. Same `<entity>.<event>`
 * naming convention as `budgeting-audit-actions.ts`/`cashflow-audit-actions.ts`.
 */
export const DEBT_AUDIT_ACTIONS = {
  LENDER_CREATED: 'lender.created',
  LENDER_UPDATED: 'lender.updated',
  CAPITAL_REQUIREMENT_CREATED: 'capital-requirement.created',
  CAPITAL_REQUIREMENT_UPDATED: 'capital-requirement.updated',
  CAPITAL_REQUIREMENT_PROPOSED: 'capital-requirement.proposed',
  CAPITAL_REQUIREMENT_APPROVED: 'capital-requirement.approved',
  CAPITAL_REQUIREMENT_FUNDED: 'capital-requirement.funded',
  CAPITAL_REQUIREMENT_COMPLETED: 'capital-requirement.completed',
  CAPITAL_REQUIREMENT_CANCELLED: 'capital-requirement.cancelled',
  DEBT_FACILITY_CREATED: 'debt-facility.created',
  DEBT_FACILITY_APPROVED: 'debt-facility.approved',
  DEBT_FACILITY_ACTIVATED: 'debt-facility.activated',
  DEBT_FACILITY_DRAWN: 'debt-facility.drawn',
  DEBT_FACILITY_REPAID: 'debt-facility.repaid',
  DEBT_FACILITY_PAID_OFF: 'debt-facility.paid-off',
  DEBT_FACILITY_CANCELLED: 'debt-facility.cancelled',
  DEBT_FACILITY_DEFAULTED: 'debt-facility.defaulted',
} as const;
