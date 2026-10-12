import { ForbiddenException, Injectable } from '@nestjs/common';
import { ProductType, SalesOrderStatus } from '@prisma/client';

import { EffectiveAccessResolver } from '../identity/authorization/effective-access-resolver';
import { OrganisationService } from '../identity/organisation/organisation.service';
import { CatalogueResponse } from './reporting.types';
import { METRIC_REGISTRY } from './reporting-metric-registry';
import {
  ComparisonMode,
  resolveComparisonPeriod,
  resolveReportingPeriod,
  ReportingPeriodPreset,
} from './reporting-period.util';
import { REPORT_REGISTRY } from './reporting-report-registry';
import { InventoryPositionReportService } from './reports/inventory-position-report.service';
import {
  FailedNotificationCounts,
  OperationalExceptionsReportService,
  PendingApprovalRow,
} from './reports/operational-exceptions-report.service';
import { PayablesReportService } from './reports/payables-report.service';
import { ProductionPerformanceReportService } from './reports/production-performance-report.service';
import { ProcurementSummaryReportService } from './reports/procurement-summary-report.service';
import { ReceivablesReportService } from './reports/receivables-report.service';
import { SalesPerformanceReportService } from './reports/sales-performance-report.service';
import { WorkforceSummaryReportService } from './reports/workforce-summary-report.service';
import { ExecutiveDashboardService } from './reports/executive-dashboard.service';
import { CustomerAccountReportService } from './reports/customer-account-report.service';
import { CustomerStatementReportService } from './reports/customer-statement-report.service';

export interface PeriodRequest {
  preset: ReportingPeriodPreset;
  customFrom?: Date;
  customTo?: Date;
  comparison: ComparisonMode;
}

/**
 * Sprint 45 — Reporting & Business Intelligence Foundation (docs/domains/reporting.md
 * "Reporting Module"). Coordinates reporting requests (brief §5A): resolves the
 * caller's effective access once per request, filters the catalogue to what they can
 * see, resolves the organisation-timezone-aware reporting period, enforces each
 * report's own existing domain permission, and delegates to the one small, typed
 * report service that owns that report's actual query. This class deliberately
 * contains NO business-metric calculation of its own — every number comes from a
 * `reports/*.service.ts` file, which in turn either reuses an existing authoritative
 * domain service or performs a narrow, documented, read-only query.
 */
@Injectable()
export class ReportingService {
  constructor(
    private readonly organisationService: OrganisationService,
    private readonly effectiveAccessResolver: EffectiveAccessResolver,
    private readonly receivablesReportService: ReceivablesReportService,
    private readonly payablesReportService: PayablesReportService,
    private readonly inventoryPositionReportService: InventoryPositionReportService,
    private readonly salesPerformanceReportService: SalesPerformanceReportService,
    private readonly productionPerformanceReportService: ProductionPerformanceReportService,
    private readonly workforceSummaryReportService: WorkforceSummaryReportService,
    private readonly operationalExceptionsReportService: OperationalExceptionsReportService,
    private readonly procurementSummaryReportService: ProcurementSummaryReportService,
    private readonly executiveDashboardService: ExecutiveDashboardService,
    private readonly customerAccountReportService: CustomerAccountReportService,
    private readonly customerStatementReportService: CustomerStatementReportService,
  ) {}

  /** Brief §5A "expose report metadata for the frontend" — every metric/report whose
   *  `requiredPermission` the caller does not hold is omitted entirely, never returned
   *  with a "locked" flag; the catalogue itself must never reveal that a restricted
   *  report exists (brief §10 "avoid leaking protected data through... errors"). */
  async getCatalogue(organisationId: string, userId: string): Promise<CatalogueResponse> {
    const access = await this.effectiveAccessResolver.resolve(organisationId, userId);
    const hasPermission = (key: string) => access.isOwnerBypass || access.grants.has(key);

    return {
      metrics: METRIC_REGISTRY.filter((metric) => hasPermission(metric.requiredPermission)),
      reports: REPORT_REGISTRY.filter((report) => hasPermission(report.requiredPermission)),
    };
  }

  private async resolvePeriod(organisationId: string, request: PeriodRequest) {
    const organisation = await this.organisationService.getById(organisationId);
    const timeZone = organisation?.timeZone ?? 'UTC';
    const current = resolveReportingPeriod(
      request.preset,
      timeZone,
      new Date(),
      request.customFrom && request.customTo
        ? { from: request.customFrom, to: request.customTo }
        : undefined,
    );
    const previous = resolveComparisonPeriod(current, request.comparison, timeZone);
    return { current, previous, timeZone };
  }

  private async assertPermission(
    organisationId: string,
    userId: string,
    permissionKey: string,
  ): Promise<void> {
    const access = await this.effectiveAccessResolver.resolve(organisationId, userId);
    if (!access.isOwnerBypass && !access.grants.has(permissionKey)) {
      throw new ForbiddenException(
        `You are not authorized to view this report (${permissionKey}).`,
      );
    }
  }

  async getSalesPerformance(
    organisationId: string,
    userId: string,
    period: PeriodRequest,
    filters: { customerId?: string; status?: SalesOrderStatus; page: number; pageSize: number },
  ) {
    await this.assertPermission(organisationId, userId, 'sales.dashboard.view');
    const { current, previous } = await this.resolvePeriod(organisationId, period);
    return this.salesPerformanceReportService.getReport(organisationId, {
      from: current.from,
      to: current.to,
      comparisonFrom: previous?.from,
      comparisonTo: previous?.to,
      ...filters,
    });
  }

  async getInventoryPosition(
    organisationId: string,
    userId: string,
    filters: { locationId?: string; productType?: ProductType; page: number; pageSize: number },
  ) {
    await this.assertPermission(organisationId, userId, 'finance.reports.view');
    return this.inventoryPositionReportService.getReport(organisationId, filters);
  }

  async getReceivables(organisationId: string, userId: string) {
    await this.assertPermission(organisationId, userId, 'finance.reports.view');
    return this.receivablesReportService.getReport(organisationId);
  }

  async getPayables(organisationId: string, userId: string) {
    await this.assertPermission(organisationId, userId, 'finance.reports.view');
    return this.payablesReportService.getReport(organisationId);
  }

  async getProductionPerformance(
    organisationId: string,
    userId: string,
    period: PeriodRequest,
    filters: { productId?: string; page: number; pageSize: number },
  ) {
    await this.assertPermission(organisationId, userId, 'production.order.view');
    const { current, previous } = await this.resolvePeriod(organisationId, period);
    return this.productionPerformanceReportService.getReport(organisationId, {
      from: current.from,
      to: current.to,
      comparisonFrom: previous?.from,
      comparisonTo: previous?.to,
      ...filters,
    });
  }

  async getWorkforceSummary(organisationId: string, userId: string, period: PeriodRequest) {
    await this.assertPermission(organisationId, userId, 'hr.employee.view');
    const { current } = await this.resolvePeriod(organisationId, period);
    return this.workforceSummaryReportService.getReport(organisationId, {
      from: current.from,
      to: current.to,
    });
  }

  /**
   * Brief §10 "do not grant broad visibility merely because a user can access a
   * general dashboard" — each of the three sections below is independently gated by
   * its OWN existing domain permission and simply omitted (`null`) when the caller
   * lacks it, never a 403 for the whole report (a caller might legitimately have
   * `workflow.instance.view` but not `maintenance.work_order.view`, and should still
   * see the approvals section).
   */
  async getOperationalExceptions(organisationId: string, userId: string) {
    const access = await this.effectiveAccessResolver.resolve(organisationId, userId);
    const hasPermission = (key: string) => access.isOwnerBypass || access.grants.has(key);

    const [pendingApprovals, overdueMaintenanceCount, failedNotifications] = await Promise.all([
      hasPermission('workflow.instance.view')
        ? this.operationalExceptionsReportService.getPendingApprovals(organisationId)
        : Promise.resolve<PendingApprovalRow[] | null>(null),
      hasPermission('maintenance.work_order.view')
        ? this.operationalExceptionsReportService.getOverdueMaintenanceCount(organisationId)
        : Promise.resolve<number | null>(null),
      hasPermission('notification.email.view') && hasPermission('notification.whatsapp.view')
        ? this.operationalExceptionsReportService.getFailedNotificationCounts(organisationId)
        : Promise.resolve<FailedNotificationCounts | null>(null),
    ]);

    return { pendingApprovals, overdueMaintenanceCount, failedNotifications };
  }

  async getProcurementSummary(organisationId: string, userId: string) {
    await this.assertPermission(organisationId, userId, 'procurement.purchase_order.view');
    return this.procurementSummaryReportService.getReport(organisationId);
  }

  /**
   * Sprint 46 — Executive & Management Dashboards (docs/domains/reporting.md
   * "Executive Dashboard"). Deliberately has NO single `assertPermission` call — the
   * route itself is gated only by the controller's own `reporting.catalogue.view`
   * (the same "can you see the reporting area at all" check every report shares);
   * which of the five business-domain sections actually come back populated is
   * decided entirely inside `ExecutiveDashboardService`, per-section, against each
   * section's own existing domain permission (brief §8 "a dashboard may contain a
   * mixture of accessible and inaccessible domains").
   */
  async getExecutiveDashboard(organisationId: string, userId: string, period: PeriodRequest) {
    const { current, previous, timeZone } = await this.resolvePeriod(organisationId, period);
    return this.executiveDashboardService.getDashboard(organisationId, userId, {
      from: current.from,
      to: current.to,
      comparisonFrom: previous?.from,
      comparisonTo: previous?.to,
      timeZone,
    });
  }

  // ---------------------------------------------------------------------
  // Phase 1 — Customer Account Management (docs/customer-account-inventory-audit.md
  // §5.2). `sales.customer.view` is the one BASE permission every method below
  // requires — "may you open this customer's account page at all." Each finance/
  // sales-order/credit-note/return SECTION inside the composed response is then
  // independently gated against its own existing domain permission (never a new
  // parallel authorization system), same per-section-omission convention
  // `ExecutiveDashboardService`/`getOperationalExceptions` already established.
  // ---------------------------------------------------------------------

  private async resolveCustomerAccountAccess(organisationId: string, userId: string) {
    const access = await this.effectiveAccessResolver.resolve(organisationId, userId);
    const has = (key: string) => access.isOwnerBypass || access.grants.has(key);
    if (!has('sales.customer.view')) {
      throw new ForbiddenException('You are not authorized to view customer accounts.');
    }
    return {
      canViewSalesOrders: has('sales.order.view'),
      canViewFinance: has('finance.invoice.view') && has('finance.payment.view'),
      canViewInvoices: has('finance.invoice.view'),
      canViewPayments: has('finance.payment.view'),
      canViewCreditNotes: has('finance.credit_note.view'),
      canViewReturns: has('sales.customer_return.manage'),
      canManageCredit: has('finance.customer_credit.manage'),
    };
  }

  async getCustomerAccountOverview(
    organisationId: string,
    userId: string,
    customerId: string,
    period: PeriodRequest,
  ) {
    const access = await this.resolveCustomerAccountAccess(organisationId, userId);
    const { current } = await this.resolvePeriod(organisationId, period);
    return this.customerAccountReportService.getOverview(organisationId, customerId, access, {
      from: current.from,
      to: current.to,
    });
  }

  async getCustomerTransactionHistory(
    organisationId: string,
    userId: string,
    customerId: string,
    filters: {
      type?: string;
      status?: string;
      from?: Date;
      to?: Date;
      page: number;
      pageSize: number;
    },
  ) {
    const access = await this.resolveCustomerAccountAccess(organisationId, userId);
    return this.customerAccountReportService.getTransactionHistory(
      organisationId,
      customerId,
      access,
      filters,
    );
  }

  async getCustomerOutstandingInvoices(organisationId: string, userId: string, customerId: string) {
    const access = await this.resolveCustomerAccountAccess(organisationId, userId);
    if (!access.canViewInvoices) {
      return null;
    }
    return this.customerAccountReportService.getOutstandingInvoices(organisationId, customerId);
  }

  async getCustomerPaymentHistory(organisationId: string, userId: string, customerId: string) {
    const access = await this.resolveCustomerAccountAccess(organisationId, userId);
    if (!access.canViewPayments) {
      return null;
    }
    return this.customerAccountReportService.getPaymentHistory(organisationId, customerId);
  }

  async getCustomerStatement(
    organisationId: string,
    userId: string,
    customerId: string,
    period: PeriodRequest,
  ) {
    const access = await this.resolveCustomerAccountAccess(organisationId, userId);
    if (!access.canViewFinance) {
      throw new ForbiddenException('You are not authorized to view this customer statement.');
    }
    const { current } = await this.resolvePeriod(organisationId, period);
    return this.customerStatementReportService.getStatement(organisationId, customerId, {
      from: current.from,
      to: current.to,
    });
  }
}
