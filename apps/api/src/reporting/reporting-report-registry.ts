import { ReportDefinition } from './reporting.types';

/**
 * Sprint 45 — Reporting & Business Intelligence Foundation (docs/domains/reporting.md
 * "Report Registry"). Typed, discoverable report definitions — metadata only; each
 * report's actual query logic lives in its own `reports/*.service.ts` file. Exposed
 * via `GET /reporting/catalogue`, filtered per-caller by `requiredPermission`
 * (brief §5A "expose report metadata for the frontend").
 */
export const REPORT_REGISTRY: ReportDefinition[] = [
  {
    id: 'sales-performance',
    displayName: 'Sales Performance',
    description:
      'B2B sales order activity for the selected period — order counts by status, and GL-tied net revenue/COGS with product and customer breakdowns.',
    domain: 'SALES',
    columns: [
      { key: 'orderCode', label: 'Order', type: 'STRING', drillDown: { kind: 'SALES_ORDER' } },
      { key: 'customerName', label: 'Customer', type: 'STRING' },
      { key: 'status', label: 'Status', type: 'ENUM' },
      { key: 'orderDate', label: 'Order Date', type: 'DATE' },
      { key: 'total', label: 'Total', type: 'CURRENCY' },
    ],
    supportedFilters: ['period', 'comparison', 'customerId', 'status'],
    sortableFields: ['orderDate', 'total'],
    requiredPermission: 'sales.dashboard.view',
    exportEligible: true,
    availability: 'AVAILABLE',
  },
  {
    id: 'inventory-position',
    displayName: 'Inventory Position',
    description:
      'Stock on hand and value by product and location, using the existing moving-weighted-average valuation — the same figure the Finance Inventory Valuation report shows.',
    domain: 'INVENTORY',
    columns: [
      { key: 'productCode', label: 'Product Code', type: 'STRING' },
      { key: 'productName', label: 'Product', type: 'STRING' },
      { key: 'locationName', label: 'Location', type: 'STRING' },
      { key: 'quantityOnHand', label: 'Quantity on Hand', type: 'NUMBER' },
      { key: 'averageUnitCost', label: 'Avg Unit Cost', type: 'CURRENCY' },
      { key: 'inventoryValue', label: 'Inventory Value', type: 'CURRENCY' },
    ],
    supportedFilters: ['locationId'],
    sortableFields: ['inventoryValue', 'quantityOnHand'],
    requiredPermission: 'finance.reports.view',
    exportEligible: true,
    availability: 'AVAILABLE',
    limitation:
      'Low-stock/reorder indicators are not included — no reorder-point field exists on Product (data gap, see KPI dictionary).',
  },
  {
    id: 'receivables',
    displayName: 'Receivables Aging',
    description:
      'Outstanding customer invoice balances, split into standard aging buckets, using the existing Finance Accounts Receivable methodology.',
    domain: 'FINANCE',
    columns: [
      { key: 'customerCode', label: 'Customer Code', type: 'STRING' },
      { key: 'customerName', label: 'Customer', type: 'STRING' },
      { key: 'current', label: 'Current', type: 'CURRENCY' },
      { key: 'days1To30', label: '1-30 Days', type: 'CURRENCY' },
      { key: 'days31To60', label: '31-60 Days', type: 'CURRENCY' },
      { key: 'days61To90', label: '61-90 Days', type: 'CURRENCY' },
      { key: 'days90Plus', label: '90+ Days', type: 'CURRENCY' },
      { key: 'totalOutstanding', label: 'Total Outstanding', type: 'CURRENCY' },
    ],
    supportedFilters: ['customerId'],
    sortableFields: ['totalOutstanding'],
    requiredPermission: 'finance.reports.view',
    exportEligible: true,
    availability: 'AVAILABLE',
  },
  {
    id: 'payables',
    displayName: 'Payables Aging',
    description:
      'Outstanding supplier invoice obligations, split into standard aging buckets, using the existing Finance Accounts Payable methodology.',
    domain: 'FINANCE',
    columns: [
      { key: 'supplierCode', label: 'Supplier Code', type: 'STRING' },
      { key: 'supplierName', label: 'Supplier', type: 'STRING' },
      { key: 'current', label: 'Current', type: 'CURRENCY' },
      { key: 'days1To30', label: '1-30 Days', type: 'CURRENCY' },
      { key: 'days31To60', label: '31-60 Days', type: 'CURRENCY' },
      { key: 'days61To90', label: '61-90 Days', type: 'CURRENCY' },
      { key: 'days90Plus', label: '90+ Days', type: 'CURRENCY' },
      { key: 'totalOutstanding', label: 'Total Outstanding', type: 'CURRENCY' },
    ],
    supportedFilters: ['supplierId'],
    sortableFields: ['totalOutstanding'],
    requiredPermission: 'finance.reports.view',
    exportEligible: true,
    availability: 'AVAILABLE',
  },
  {
    id: 'production-performance',
    displayName: 'Production Performance',
    description:
      'Planned versus actual output for completed production orders in the selected period, with material cost from the GL-sourced WIP valuation. Materials only — no labour/overhead costing exists yet.',
    domain: 'PRODUCTION',
    columns: [
      {
        key: 'productionOrderNumber',
        label: 'Order',
        type: 'STRING',
        drillDown: { kind: 'PRODUCTION_ORDER' },
      },
      { key: 'productName', label: 'Product', type: 'STRING' },
      { key: 'plannedQuantity', label: 'Planned Qty', type: 'NUMBER' },
      { key: 'producedQuantity', label: 'Produced Qty', type: 'NUMBER' },
      { key: 'acceptedQuantity', label: 'Accepted Qty', type: 'NUMBER' },
      { key: 'rejectedQuantity', label: 'Rejected Qty', type: 'NUMBER' },
      { key: 'yieldPercent', label: 'Yield %', type: 'PERCENT' },
      { key: 'materialCost', label: 'Material Cost', type: 'CURRENCY' },
      { key: 'completedAt', label: 'Completed', type: 'DATE' },
    ],
    supportedFilters: ['period', 'comparison', 'productId'],
    sortableFields: ['completedAt', 'yieldPercent', 'materialCost'],
    requiredPermission: 'production.order.view',
    exportEligible: true,
    availability: 'AVAILABLE',
    limitation:
      'Material cost only (no labour/overhead costing exists in this codebase yet). Rejected output never enters inventory, so it is reported from the production run record, not a stock movement.',
  },
  {
    id: 'workforce-summary',
    displayName: 'Workforce Summary',
    description:
      'Current headcount by employment status and department, and a daily attendance-status breakdown for the selected period.',
    domain: 'HR',
    columns: [
      { key: 'label', label: 'Group', type: 'STRING' },
      { key: 'count', label: 'Count', type: 'NUMBER' },
    ],
    supportedFilters: ['period', 'departmentId', 'employmentStatus'],
    sortableFields: ['count'],
    requiredPermission: 'hr.employee.view',
    // Deliberately false — this report is three separate tables (status, department,
    // attendance), not one tabular dataset; a single CSV export was judged more
    // confusing than useful and is deferred rather than built awkwardly this sprint
    // (brief §14 "document the decision rather than expanding the sprint
    // unnecessarily").
    exportEligible: false,
    availability: 'AVAILABLE',
    limitation:
      'Leave is not reportable — no Leave model exists in this codebase (data gap). EmploymentStatus.ON_LEAVE is never written by any code path, so it is excluded from the status breakdown rather than shown as a permanently-zero row. Not exportable this sprint — see "Export" above.',
  },
  {
    id: 'operational-exceptions',
    displayName: 'Operational Exceptions',
    description:
      "Pending workflow approvals (with ageing), overdue maintenance work orders, and failed notification deliveries — each section shown only if the viewer holds that section's own existing domain permission.",
    domain: 'OPERATIONS',
    columns: [
      { key: 'category', label: 'Category', type: 'STRING' },
      { key: 'description', label: 'Description', type: 'STRING' },
      { key: 'ageDays', label: 'Age (days)', type: 'NUMBER' },
      {
        key: 'reference',
        label: 'Reference',
        type: 'STRING',
        drillDown: { kind: 'WORKFLOW_INSTANCE' },
      },
    ],
    supportedFilters: [],
    sortableFields: ['ageDays'],
    // The composite's own catalogue-visibility gate; each section is independently
    // re-checked against its own permission inside the service (brief §10).
    requiredPermission: 'reporting.catalogue.view',
    exportEligible: false,
    availability: 'AVAILABLE',
    limitation:
      'Not a single permission — each section (approvals/maintenance/notifications) is independently gated by its own existing domain permission and simply omitted, never rejected, when the viewer lacks it.',
  },
];

export function getReportDefinition(reportId: string): ReportDefinition | undefined {
  return REPORT_REGISTRY.find((report) => report.id === reportId);
}
