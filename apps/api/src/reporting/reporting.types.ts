import { ComparisonMode, ReportingPeriodPreset } from './reporting-period.util';

/**
 * Sprint 45 — Reporting & Business Intelligence Foundation (docs/domains/reporting.md).
 * Shared, typed vocabulary for the Metric Registry / Report Registry / report query
 * services — deliberately a closed set of string unions, never a free-text/arbitrary
 * field name, so every report/metric definition is discoverable and type-checked
 * rather than an "unstructured collection of strings" (brief §5B/§5C).
 */

export type ReportDomain = 'SALES' | 'INVENTORY' | 'FINANCE' | 'PRODUCTION' | 'HR' | 'OPERATIONS';

export type MetricUnit = 'CURRENCY' | 'COUNT' | 'PERCENT' | 'DAYS';

export type MetricAggregation = 'SUM' | 'COUNT' | 'POINT_IN_TIME' | 'DERIVED';

export type MetricAvailability = 'AVAILABLE' | 'BLOCKED_DATA_GAP' | 'DEFERRED';

/** The closed set of filter dimensions this sprint's reports actually support — a
 *  report definition's own `supportedFilters` is a subset of this list, never an
 *  arbitrary string (brief §5E: "a global filter contract must not imply that every
 *  report supports every dimension"). */
export type ReportFilterKey =
  | 'period'
  | 'comparison'
  | 'productId'
  | 'customerId'
  | 'supplierId'
  | 'locationId'
  | 'departmentId'
  | 'employmentStatus'
  | 'status';

export interface ReportPeriodInput {
  preset: ReportingPeriodPreset;
  /** Required only when `preset === 'custom'`; validated upstream. */
  customFrom?: Date;
  customTo?: Date;
  comparison: ComparisonMode;
}

export interface MetricDefinition {
  /** Stable, kebab-case, globally unique — e.g. `'finance.gross-profit'`. Never
   *  renamed once shipped; a display-name change must never change this id. */
  id: string;
  displayName: string;
  description: string;
  domain: ReportDomain;
  unit: MetricUnit;
  aggregation: MetricAggregation;
  /** Human-readable citation of the authoritative service/table this metric defers
   *  to — never a second, independently-recomputed formula (brief §4). */
  authoritativeSource: string;
  timeBasis: 'PERIOD' | 'POINT_IN_TIME' | 'NONE';
  supportedFilters: ReportFilterKey[];
  /** The exact existing permission key this metric reuses — never a new parallel
   *  authorization system (brief §10). */
  requiredPermission: string;
  /** The report id a summary card showing this metric should link to, if any. */
  drillDownReportId?: string;
  availability: MetricAvailability;
  /** Present only when `availability !== 'AVAILABLE'` — why, in plain language. */
  limitation?: string;
}

export type ReportColumnType = 'STRING' | 'CURRENCY' | 'NUMBER' | 'DATE' | 'PERCENT' | 'ENUM';

export interface ReportColumnDefinition {
  key: string;
  label: string;
  type: ReportColumnType;
  /** Present when this column's value, if non-empty, should render as a link to an
   *  existing operational record (brief §11) — never a raw string the frontend has to
   *  guess a route for. */
  drillDown?: {
    kind: 'SALES_ORDER' | 'INVOICE' | 'SUPPLIER_INVOICE' | 'PRODUCTION_ORDER' | 'WORKFLOW_INSTANCE';
  };
}

export interface ReportDefinition {
  id: string;
  displayName: string;
  description: string;
  domain: ReportDomain;
  columns: ReportColumnDefinition[];
  supportedFilters: ReportFilterKey[];
  sortableFields: string[];
  requiredPermission: string;
  exportEligible: boolean;
  availability: MetricAvailability;
  limitation?: string;
}

export interface ReportTableResult<Row> {
  rows: Row[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CatalogueResponse {
  metrics: MetricDefinition[];
  reports: ReportDefinition[];
}
