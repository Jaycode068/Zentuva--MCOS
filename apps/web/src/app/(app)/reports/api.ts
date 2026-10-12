import { apiFetch, getAccessToken } from '@/lib/api-client';
import { env } from '@/lib/env';

/**
 * Sprint 45 — Reporting & Business Intelligence Foundation. The reporting domain's own
 * API client, kept separate from every other settings area's `api.ts` — the
 * established "each area owns its own client" convention this codebase already uses.
 */

export type ReportDomain =
  'SALES' | 'INVENTORY' | 'FINANCE' | 'PRODUCTION' | 'PROCUREMENT' | 'HR' | 'OPERATIONS';
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

/**
 * Sprint 46 — Executive & Management Dashboards (brief §5B "comparison rules — never
 * calculate a different KPI formula in the frontend"). The ONE shared percent-change
 * formula every report/dashboard page uses — mirrors the backend's own
 * `reporting-period.util.ts` `calculatePercentChange` exactly (null when the baseline
 * is zero/absent, never `NaN`/`Infinity`). Previously duplicated verbatim inside
 * `sales-performance/page.tsx` and `production-performance/page.tsx` — both now
 * import this instead.
 */
export function calculatePercentChange(
  current: number,
  previous: number | null | undefined,
): number | null {
  if (previous == null || previous === 0) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
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

export interface ProcurementSummaryReport {
  openPurchaseOrderCount: number;
  openPurchaseOrderValue: number;
  openPurchaseOrders: {
    id: string;
    purchaseOrderNumber: string;
    supplierId: string;
    supplierName: string;
    status: string;
    total: number;
    orderDate: string;
  }[];
  payables: { totalOutstanding: number; totalOverdue: number };
  discrepancyCount: number;
}

export function getProcurementSummaryReport(): Promise<ProcurementSummaryReport> {
  return apiFetch<ProcurementSummaryReport>('/reporting/reports/procurement-summary');
}

/**
 * Sprint 46 — Executive & Management Dashboards. One composed response for the
 * `/dashboard` page — see `ExecutiveDashboardService`'s own backend doc comment for
 * why this single endpoint exists and how per-section permission omission works.
 * Every `| null` field below means "the viewer lacks that section's own domain
 * permission" — never render it as a zero-value card (brief §11).
 */
export interface MetricWithComparison {
  value: number;
  percentChange: number | null;
}

export interface ExecutiveDashboard {
  from: string;
  to: string;
  comparisonFrom: string | null;
  comparisonTo: string | null;
  finance: {
    netRevenue: MetricWithComparison;
    grossProfit: MetricWithComparison;
    grossMarginPercent: number | null;
    receivablesOutstanding: number;
    receivablesOverdue: number;
    payablesOutstanding: number;
    payablesOverdue: number;
  } | null;
  inventory: { value: number } | null;
  sales: {
    orderCount: MetricWithComparison;
    trend: { date: string; totalRevenue: number }[];
  } | null;
  production: {
    acceptedOutput: MetricWithComparison;
    trend: { date: string; acceptedQuantity: number }[];
  } | null;
  workforce: { activeHeadcount: number } | null;
  exceptions: {
    pendingApprovalsCount: number | null;
    overdueMaintenanceCount: number | null;
    failedNotificationsCount: number | null;
  };
  recentActivity:
    | {
        id: string;
        action: string;
        entityType: string;
        entityId: string | null;
        createdAt: string;
      }[]
    | null;
}

export function getExecutiveDashboard(period: PeriodParams): Promise<ExecutiveDashboard> {
  const params = new URLSearchParams(periodToQuery(period));
  return apiFetch<ExecutiveDashboard>(`/reporting/dashboard/executive?${params}`);
}

// ---------------------------------------------------------------------
// Phase 1 — Customer Account Management (docs/customer-account-inventory-audit.md
// §5.2/§5.4). Every function below composes data for exactly ONE customer — never
// an org-wide listing, unlike every report above.
// ---------------------------------------------------------------------

export type CreditExposureStatus =
  'NO_LIMIT' | 'WITHIN_LIMIT' | 'APPROACHING_LIMIT' | 'AT_OR_OVER_LIMIT';

export interface CustomerCreditExposure {
  creditLimit: number | null;
  totalOutstanding: number;
  availableCredit: number | null;
  status: CreditExposureStatus;
  approachingThresholdRatio: number;
  canManageCredit: boolean;
}

export interface CustomerAccountSummary {
  totalInvoicedInPeriod: number;
  totalPaymentsReceivedInPeriod: number;
  currentOutstandingReceivable: number;
  overdueReceivable: number;
  outstandingInvoiceCount: number;
  overdueInvoiceCount: number;
  pendingSalesOrderCount: number | null;
  unfulfilledSalesOrderValue: number | null;
}

export interface CustomerAccountOverview {
  profile: {
    id: string;
    customerCode: string;
    customerName: string;
    customerType: string;
    status: string;
    contactPersonName: string | null;
    phoneNumber: string;
    alternatePhoneNumber: string | null;
    email: string | null;
    address: string | null;
    city: string | null;
    state: string | null;
    country: string | null;
    territoryId: string | null;
    notes: string | null;
    createdAt: string;
    updatedAt: string;
    outlets: { id: string; outletCode: string; name: string; outletType: string; status: string }[];
  };
  /** `null` when the caller lacks `finance.invoice.view` AND `finance.payment.view`. */
  summary: CustomerAccountSummary | null;
  /** `null` under the same condition as `summary`. */
  credit: CustomerCreditExposure | null;
}

export function getCustomerAccountOverview(
  customerId: string,
  period: PeriodParams,
): Promise<CustomerAccountOverview | null> {
  const params = new URLSearchParams({ customerId, ...periodToQuery(period) });
  return apiFetch<CustomerAccountOverview | null>(`/reporting/reports/customer-account?${params}`);
}

export interface CustomerTransactionRow {
  type: 'SALES_ORDER' | 'INVOICE' | 'PAYMENT' | 'CREDIT_NOTE' | 'RETURN';
  id: string;
  reference: string;
  date: string;
  description: string;
  status: string;
  amount: number | null;
}

export function getCustomerTransactionHistory(
  customerId: string,
  filters: {
    type?: string;
    status?: string;
    from?: string;
    to?: string;
    page: number;
    pageSize: number;
  },
): Promise<ReportTableResult<CustomerTransactionRow>> {
  const params = new URLSearchParams({
    customerId,
    page: String(filters.page),
    pageSize: String(filters.pageSize),
    ...(filters.type ? { type: filters.type } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.from ? { from: filters.from } : {}),
    ...(filters.to ? { to: filters.to } : {}),
  });
  return apiFetch<ReportTableResult<CustomerTransactionRow>>(
    `/reporting/reports/customer-account/transactions?${params}`,
  );
}

export interface CustomerOutstandingInvoiceRow {
  id: string;
  invoiceCode: string;
  invoiceDate: string;
  dueDate: string;
  total: number;
  amountPaid: number;
  amountCredited: number;
  amountOutstanding: number;
  status: string;
  isOverdue: boolean;
}

/** `null` when the caller lacks `finance.invoice.view` — distinct from `[]` (no
 *  outstanding invoices), which the page must render differently. */
export function getCustomerOutstandingInvoices(
  customerId: string,
): Promise<CustomerOutstandingInvoiceRow[] | null> {
  return apiFetch<CustomerOutstandingInvoiceRow[] | null>(
    `/reporting/reports/customer-account/invoices?customerId=${customerId}`,
  );
}

export interface CustomerPaymentHistoryRow {
  id: string;
  paymentDate: string;
  amount: number;
  method: string;
  reference: string | null;
  status: string;
  allocations: { invoiceId: string; amount: number }[];
  allocatedAmount: number;
  unallocatedAmount: number;
  isFullyAllocated: boolean;
}

/** `null` when the caller lacks `finance.payment.view`. */
export function getCustomerPaymentHistory(
  customerId: string,
): Promise<CustomerPaymentHistoryRow[] | null> {
  return apiFetch<CustomerPaymentHistoryRow[] | null>(
    `/reporting/reports/customer-account/payments?customerId=${customerId}`,
  );
}

export interface CustomerStatementLine {
  type: 'INVOICE' | 'PAYMENT' | 'CREDIT_NOTE';
  id: string;
  date: string;
  reference: string;
  description: string;
  debit: number;
  credit: number;
  runningBalance: number;
  dueDate?: string;
}

export interface CustomerStatement {
  customerId: string;
  customerCode: string;
  customerName: string;
  periodFrom: string;
  periodTo: string;
  openingBalance: number;
  lines: CustomerStatementLine[];
  closingBalance: number;
  reconciliation: { lineBasedClosingBalance: number; authoritativeClosingBalance: number };
}

export function getCustomerStatement(
  customerId: string,
  period: PeriodParams,
): Promise<CustomerStatement | null> {
  const params = new URLSearchParams({ customerId, ...periodToQuery(period) });
  return apiFetch<CustomerStatement | null>(`/reporting/reports/customer-statement?${params}`);
}

export function customerStatementExportPath(customerId: string, period: PeriodParams): string {
  const params = new URLSearchParams({ customerId, ...periodToQuery(period) });
  return `/reporting/reports/customer-statement/export?${params}`;
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
