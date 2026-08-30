/**
 * Audit action strings for Sprint 15's Cashflow Management & Forecasting
 * (docs/domains/cashflow.md) — `CashflowForecastItem`, `CashflowScenario`,
 * `CashflowForecastAdjustment`, `CashflowSettings`. Same `<entity>.<event>`
 * naming convention as `cash-bank-audit-actions.ts`/`accounts-payable-audit-
actions.ts`. The forecast computation itself (`GET .../forecast`) is a pure read
 * and is never audited — only the entities that shape it.
 */
export const CASHFLOW_AUDIT_ACTIONS = {
  FORECAST_ITEM_CREATED: 'cashflow.forecast-item.created',
  FORECAST_ITEM_UPDATED: 'cashflow.forecast-item.updated',
  FORECAST_ITEM_DEACTIVATED: 'cashflow.forecast-item.deactivated',
  FORECAST_ITEM_ACTIVATED: 'cashflow.forecast-item.activated',
  SCENARIO_CREATED: 'cashflow.scenario.created',
  SCENARIO_UPDATED: 'cashflow.scenario.updated',
  SCENARIO_DEACTIVATED: 'cashflow.scenario.deactivated',
  FORECAST_ADJUSTMENT_CREATED: 'cashflow.forecast-adjustment.created',
  FORECAST_ADJUSTMENT_UPDATED: 'cashflow.forecast-adjustment.updated',
  SETTINGS_UPDATED: 'cashflow.settings.updated',
} as const;
