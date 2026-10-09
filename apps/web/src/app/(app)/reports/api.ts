import { apiFetch, getAccessToken } from '@/lib/api-client';
import { env } from '@/lib/env';

/**
 * Sprint 45 — Reporting & Business Intelligence Foundation. The reporting domain's own
 * API client, kept separate from every other settings area's `api.ts` — the
 * established "each area owns its own client" convention this codebase already uses.
 */

export type ReportDomain = 'SALES' | 'INVENTORY' | 'FINANCE' | 'PRODUCTION' | 'HR' | 'OPERATIONS';
export type MetricUnit = 'CURRENCY' | 'COUNT' | 'PERCENT' | 'DAYS';
export type MetricAvailability = 'AVAILABLE' | 'BLOCKED_DATA_GAP' | 'DEFERRED';
export type ReportColumnType = 'STRING' | 'CURRENCY' | 'NUMBER' | 'DATE' | 'PERCENT' | 'ENUM';
export type ReportingPeriodPreset =
  | 'today'
  | 'yesterday'
  | 'this_week'
  | 'last_week'
  | 'this_month'
  | 'last_month'
  | 'this_quarter'
  | 'last_quarter'
  | 'this_year'
  | 'last_year'
  | 'custom';
export type ComparisonMode = 'none' | 'previous_period' | 'previous_year';

export const REPORTING_PERIOD_PRESET_LABELS: Record<ReportingPeriodPreset, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  this_week: 'This Week',
  last_week: 'Last Week',
  this_month: 'This Month',
  last_month: 'Last Month',
  this_quarter: 'This Quarter',
  last_quarter: 'Last Quarter',
  this_year: 'This Year',
  last_year: 'Last Year',
  custom: 'Custom Range',
};

export interface MetricDefinition {
  id: string;
  displayName: string;
  description: string;
  domain: ReportDomain;
  unit: MetricUnit;
  requiredPermission: string;
  drillDownReportId?: string;
  availability: MetricAvailability;
  limitation?: string;
}

export interface ReportColumnDefinition {
  key: string;
  label: string;
  type: ReportColumnType;
}

export interface ReportDefinition {
  id: string;
  displayName: string;
  description: string;
  domain: ReportDomain;
  columns: ReportColumnDefinition[];
  requiredPermission: string;
  exportEligible: boolean;
  availability: MetricAvailability;
  limitation?: string;
}

export interface CatalogueResponse {
  metrics: MetricDefinition[];
  reports: ReportDefinition[];
}

export interface PeriodParams {
  preset: ReportingPeriodPreset;
  customFrom?: string;
  customTo?: string;
  comparison?: ComparisonMode;
}

function periodToQuery(period: PeriodParams): Record<string, string> {
  const query: Record<string, string> = { preset: period.preset };
  if (period.customFrom) query.customFrom = period.customFrom;
  if (period.customTo) query.customTo = period.customTo;
  if (period.comparison) query.comparison = period.comparison;
  return query;
}

export function getCatalogue(): Promise<CatalogueResponse> {
  return apiFetch<CatalogueResponse>('/reporting/catalogue');
}

export interface ReportTableResult<Row> {
  rows: Row[];
  total: number;
  page: number;
  pageSize: number;
}

export interface SalesPerformanceReport {
  from: string;
  to: string;
  revenue: {
    totalRevenue: number;
    byProduct: { productId: string | null; productName: string; totalRevenue: number }[];
    byCustomer: { customerId: string; customerName: string; totalRevenue: number }[];
  };
  comparisonRevenue: number | null;
  ordersByStatus: { status: string; count: number }[];
  table: ReportTableResult<{
    id: string;
    orderCode: string;
    customerId: string | null;
    customerName: string;
    status: string;
    orderDate: string;
    total: number;
  }>;
}

export function getSalesPerformanceReport(
  period: PeriodParams,
  filters: { customerId?: string; status?: string; page: number; pageSize: number },
): Promise<SalesPerformanceReport> {
  const params = new URLSearchParams({
    ...periodToQuery(period),
    page: String(filters.page),
    pageSize: String(filters.pageSize),
    ...(filters.customerId ? { customerId: filters.customerId } : {}),
    ...(filters.status ? { status: filters.status } : {}),
  });
  return apiFetch<SalesPerformanceReport>(`/reporting/reports/sales-performance?${params}`);
}

export interface InventoryPositionReport {
  totals: {
    grandTotal: number;
    byLocation: { label: string; value: number }[];
    byProductType: { label: string; value: number }[];
  };
  table: ReportTableResult<{
    productId: string;
    productCode: string;
    productName: string;
    locationName: string;
    quantityOnHand: number;
    averageUnitCost: number;
    inventoryValue: number;
  }>;
}

export function getInventoryPositionReport(filters: {
  locationId?: string;
  page: number;
  pageSize: number;
}): Promise<InventoryPositionReport> {
  const params = new URLSearchParams({
    page: String(filters.page),
    pageSize: String(filters.pageSize),
    ...(filters.locationId ? { locationId: filters.locationId } : {}),
  });
  return apiFetch<InventoryPositionReport>(`/reporting/reports/inventory-position?${params}`);
}

export interface AgingReport {
  asOf: string;
  current: number;
  days1To30: number;
  days31To60: number;
  days61To90: number;
  days90Plus: number;
  totalOutstanding: number;
}

export interface ReceivablesReport extends AgingReport {
  byCustomer: (AgingReport & { customerId: string; customerCode: string; customerName: string })[];
}

export interface PayablesReport extends AgingReport {
  bySupplier: (AgingReport & { supplierId: string; supplierCode: string; supplierName: string })[];
}

export function getReceivablesReport(): Promise<ReceivablesReport> {
  return apiFetch<ReceivablesReport>('/reporting/reports/receivables');
}

export function getPayablesReport(): Promise<PayablesReport> {
  return apiFetch<PayablesReport>('/reporting/reports/payables');
}

export interface ProductionPerformanceReport {
  from: string;
  to: string;
  totalProduced: number;
  totalAccepted: number;
  totalRejected: number;
  totalMaterialCost: number;
  comparisonTotalAccepted: number | null;
  table: ReportTableResult<{
    productionOrderId: string;
    productionOrderNumber: string;
    productName: string;
    plannedQuantity: number;
    producedQuantity: number;
    acceptedQuantity: number;
    rejectedQuantity: number;
    yieldPercent: number | null;
    materialCost: number;
    completedAt: string;
  }>;
}

export function getProductionPerformanceReport(
  period: PeriodParams,
  filters: { productId?: string; page: number; pageSize: number },
): Promise<ProductionPerformanceReport> {
  const params = new URLSearchParams({
    ...periodToQuery(period),
    page: String(filters.page),
    pageSize: String(filters.pageSize),
    ...(filters.productId ? { productId: filters.productId } : {}),
  });
  return apiFetch<ProductionPerformanceReport>(
    `/reporting/reports/production-performance?${params}`,
  );
}

export interface WorkforceSummaryReport {
  from: string;
  to: string;
  totalHeadcount: number;
  activeHeadcount: number;
  byStatus: { employmentStatus: string; count: number }[];
  byDepartment: { departmentId: string | null; departmentName: string; count: number }[];
  attendanceByStatus: { status: string; count: number }[];
}

export function getWorkforceSummaryReport(period: PeriodParams): Promise<WorkforceSummaryReport> {
  const params = new URLSearchParams(periodToQuery(period));
  return apiFetch<WorkforceSummaryReport>(`/reporting/reports/workforce-summary?${params}`);
}

export interface PendingApprovalRow {
  workflowInstanceId: string;
  subjectType: string;
  subjectId: string;
  stepName: string;
  startedAt: string | null;
  ageDays: number;
  dueAt: string | null;
  isOverdue: boolean;
}

export interface OperationalExceptionsReport {
  pendingApprovals: PendingApprovalRow[] | null;
  overdueMaintenanceCount: number | null;
  failedNotifications: { email: number; whatsapp: number } | null;
}

export function getOperationalExceptionsReport(): Promise<OperationalExceptionsReport> {
  return apiFetch<OperationalExceptionsReport>('/reporting/reports/operational-exceptions');
}

/** CSV export bypasses {@link apiFetch} (which always parses JSON) — fetches the raw
 *  text response directly and triggers a browser download via a throwaway object URL.
 *  Applies the exact same auth header/permission/tenant constraints as the interactive
 *  report (brief §14): the server-side export route re-runs the same permission check,
 *  this just downloads what it returns. */
export async function downloadReportExport(path: string, filename: string): Promise<void> {
  const token = getAccessToken();
  const response = await fetch(`${env.NEXT_PUBLIC_API_URL}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) {
    throw new Error(`Export failed (${response.status})`);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
