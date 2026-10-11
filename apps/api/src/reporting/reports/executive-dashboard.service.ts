import { Injectable } from '@nestjs/common';

import { AccountsPayableService } from '../../finance/accounts-payable.service';
import { AccountsReceivableService } from '../../finance/accounts-receivable.service';
import { FinancialStatementService } from '../../finance/reports/financial-statement.service';
import { InventoryValuationService } from '../../finance/reports/inventory-valuation.service';
import { EmployeeService } from '../../hr/employee.service';
import { AuditService } from '../../identity/audit/audit.service';
import { EffectiveAccessResolver } from '../../identity/authorization/effective-access-resolver';
import { PrismaService } from '../../prisma/prisma.service';
import { calculatePercentChange } from '../reporting-period.util';
import { OperationalExceptionsReportService } from './operational-exceptions-report.service';
import {
  ProductionPerformanceReportService,
  ProductionTrendPoint,
} from './production-performance-report.service';
import { SalesPerformanceReportService, SalesTrendPoint } from './sales-performance-report.service';

export interface MetricWithComparison {
  value: number;
  /** `null` whenever no comparison was requested, or the comparison baseline was
   *  zero/absent — the frontend must render "No comparison data," never a misleading
   *  0% (brief §5B "comparison rules"). */
  percentChange: number | null;
}

export interface FinanceSection {
  netRevenue: MetricWithComparison;
  grossProfit: MetricWithComparison;
  /** `null` when revenue is zero for the period — never a divide-by-zero artifact. */
  grossMarginPercent: number | null;
  receivablesOutstanding: number;
  receivablesOverdue: number;
  payablesOutstanding: number;
  payablesOverdue: number;
}

export interface InventorySection {
  value: number;
}

export interface SalesSection {
  orderCount: MetricWithComparison;
  trend: SalesTrendPoint[];
}

export interface ProductionSection {
  acceptedOutput: MetricWithComparison;
  trend: ProductionTrendPoint[];
}

export interface WorkforceSection {
  activeHeadcount: number;
}

export interface ExceptionsSection {
  /** Each independently `null` only when the viewer lacks that section's own
   *  permission (brief §8 "a dashboard may contain a mixture of accessible and
   *  inaccessible domains") — never fabricated as `0` in that case. A real `0` means
   *  "checked, found none." */
  pendingApprovalsCount: number | null;
  overdueMaintenanceCount: number | null;
  failedNotificationsCount: number | null;
}

export interface RecentActivityRow {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  createdAt: Date;
}

export interface ExecutiveDashboardResult {
  from: Date;
  to: Date;
  comparisonFrom: Date | null;
  comparisonTo: Date | null;
  finance: FinanceSection | null;
  inventory: InventorySection | null;
  sales: SalesSection | null;
  production: ProductionSection | null;
  workforce: WorkforceSection | null;
  exceptions: ExceptionsSection;
  recentActivity: RecentActivityRow[] | null;
}

const FINANCE_PERMISSION = 'finance.reports.view';
const SALES_PERMISSION = 'sales.dashboard.view';
const PRODUCTION_PERMISSION = 'production.order.view';
const HR_PERMISSION = 'hr.employee.view';
const WORKFLOW_PERMISSION = 'workflow.instance.view';
const MAINTENANCE_PERMISSION = 'maintenance.work_order.view';
const NOTIFICATION_EMAIL_PERMISSION = 'notification.email.view';
const NOTIFICATION_WHATSAPP_PERMISSION = 'notification.whatsapp.view';
const AUDIT_LOG_PERMISSION = 'identity.audit-logs.read';

/**
 * Sprint 46 — Executive & Management Dashboards (docs/domains/reporting.md "Executive
 * Dashboard"). Composes already-authoritative domain services and Sprint 45's own
 * report services into ONE response — justified under brief §9 ("combine requests
 * only where a useful, secure aggregation endpoint is justified": six-plus separate
 * frontend calls for one page load is exactly that case) and brief §5A ("if
 * additional aggregation is needed, add it through the existing reporting
 * architecture"). This class performs NO independent KPI calculation of its own —
 * every figure is either a verbatim pass-through (receivables/payables summaries,
 * inventory valuation, headcount) or a plain two-call comparison built from the exact
 * same `FinancialStatementService.getProfitAndLoss()` the Finance reports already use
 * (never `getProfitAndLossComparison()`'s own internal "previous equal-length
 * period" logic, since that method cannot honour a caller-selected `previous_year`
 * comparison mode — this class always resolves both windows itself from the
 * `ReportingService`-supplied period, so whichever comparison mode the user actually
 * picked is respected exactly).
 *
 * Each of the five business-domain sections (finance, inventory, sales, production,
 * workforce) and the three sub-parts of `exceptions` is independently permission-
 * gated and set to `null` when the caller lacks that ONE domain's existing
 * permission — mirroring `OperationalExceptionsReportService`'s own established
 * per-section pattern (brief §8 "do not fail the entire dashboard merely because a
 * user lacks access to one domain"). No new permission is introduced anywhere in
 * this file.
 */
@Injectable()
export class ExecutiveDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly effectiveAccessResolver: EffectiveAccessResolver,
    private readonly financialStatementService: FinancialStatementService,
    private readonly accountsReceivableService: AccountsReceivableService,
    private readonly accountsPayableService: AccountsPayableService,
    private readonly inventoryValuationService: InventoryValuationService,
    private readonly salesPerformanceReportService: SalesPerformanceReportService,
    private readonly productionPerformanceReportService: ProductionPerformanceReportService,
    private readonly employeeService: EmployeeService,
    private readonly operationalExceptionsReportService: OperationalExceptionsReportService,
    private readonly auditService: AuditService,
  ) {}

  async getDashboard(
    organisationId: string,
    userId: string,
    params: {
      from: Date;
      to: Date;
      comparisonFrom?: Date;
      comparisonTo?: Date;
      timeZone: string;
    },
  ): Promise<ExecutiveDashboardResult> {
    const access = await this.effectiveAccessResolver.resolve(organisationId, userId);
    const can = (key: string) => access.isOwnerBypass || access.grants.has(key);
    const hasComparison = Boolean(params.comparisonFrom && params.comparisonTo);

    const [finance, inventory, sales, production, workforce, exceptions, recentActivity] =
      await Promise.all([
        can(FINANCE_PERMISSION)
          ? this.getFinanceSection(organisationId, params)
          : Promise.resolve(null),
        can(FINANCE_PERMISSION)
          ? this.inventoryValuationService
              .getValuation(organisationId)
              .then((v) => ({ value: v.totals.grandTotal }))
          : Promise.resolve(null),
        can(SALES_PERMISSION)
          ? this.getSalesSection(organisationId, params)
          : Promise.resolve(null),
        can(PRODUCTION_PERMISSION)
          ? this.getProductionSection(organisationId, params)
          : Promise.resolve(null),
        can(HR_PERMISSION)
          ? this.employeeService.getHeadcountByStatus(organisationId).then((rows) => ({
              activeHeadcount: rows.find((r) => r.employmentStatus === 'ACTIVE')?.count ?? 0,
            }))
          : Promise.resolve(null),
        this.getExceptionsSection(organisationId, can),
        can(AUDIT_LOG_PERMISSION) ? this.getRecentActivity(organisationId) : Promise.resolve(null),
      ]);

    return {
      from: params.from,
      to: params.to,
      comparisonFrom: hasComparison ? params.comparisonFrom! : null,
      comparisonTo: hasComparison ? params.comparisonTo! : null,
      finance,
      inventory,
      sales,
      production,
      workforce,
      exceptions,
      recentActivity,
    };
  }

  private async getFinanceSection(
    organisationId: string,
    params: { from: Date; to: Date; comparisonFrom?: Date; comparisonTo?: Date },
  ): Promise<FinanceSection> {
    const [current, previous, arSummary, apSummary] = await Promise.all([
      this.financialStatementService.getProfitAndLoss(organisationId, {
        from: params.from,
        to: params.to,
      }),
      params.comparisonFrom && params.comparisonTo
        ? this.financialStatementService.getProfitAndLoss(organisationId, {
            from: params.comparisonFrom,
            to: params.comparisonTo,
          })
        : Promise.resolve(null),
      this.accountsReceivableService.getSummary(organisationId),
      this.accountsPayableService.getSummary(organisationId),
    ]);

    return {
      netRevenue: {
        value: current.revenue,
        percentChange: calculatePercentChange(current.revenue, previous?.revenue),
      },
      grossProfit: {
        value: current.grossProfit,
        percentChange: calculatePercentChange(current.grossProfit, previous?.grossProfit),
      },
      grossMarginPercent: current.grossMarginPercent,
      receivablesOutstanding: arSummary.totalOutstanding,
      receivablesOverdue: arSummary.totalOverdue,
      payablesOutstanding: apSummary.totalOutstanding,
      payablesOverdue: apSummary.totalOverdue,
    };
  }

  private async getSalesSection(
    organisationId: string,
    params: { from: Date; to: Date; comparisonFrom?: Date; comparisonTo?: Date; timeZone: string },
  ): Promise<SalesSection> {
    const countWhere = (from: Date, to: Date) => ({
      organisationId,
      source: 'B2B' as const,
      status: { notIn: ['DRAFT' as const] },
      orderDate: { gte: from, lt: to },
    });

    const [orderCount, comparisonOrderCount, trend] = await Promise.all([
      this.prisma.salesOrder.count({ where: countWhere(params.from, params.to) }),
      params.comparisonFrom && params.comparisonTo
        ? this.prisma.salesOrder.count({
            where: countWhere(params.comparisonFrom, params.comparisonTo),
          })
        : Promise.resolve(null),
      this.salesPerformanceReportService.getDailyTrend(organisationId, params),
    ]);

    return {
      orderCount: {
        value: orderCount,
        percentChange: calculatePercentChange(orderCount, comparisonOrderCount),
      },
      trend,
    };
  }

  private async getProductionSection(
    organisationId: string,
    params: { from: Date; to: Date; comparisonFrom?: Date; comparisonTo?: Date; timeZone: string },
  ): Promise<ProductionSection> {
    const [trend, comparisonAggregate] = await Promise.all([
      this.productionPerformanceReportService.getDailyTrend(organisationId, params),
      params.comparisonFrom && params.comparisonTo
        ? this.prisma.productionRun.aggregate({
            where: {
              organisationId,
              completedAt: { gte: params.comparisonFrom, lt: params.comparisonTo },
            },
            _sum: { acceptedQuantity: true },
          })
        : Promise.resolve(null),
    ]);

    const acceptedOutput = trend.reduce((sum, point) => sum + point.acceptedQuantity, 0);
    const comparisonAcceptedOutput = comparisonAggregate?._sum.acceptedQuantity ?? null;

    return {
      acceptedOutput: {
        value: acceptedOutput,
        percentChange: calculatePercentChange(acceptedOutput, comparisonAcceptedOutput),
      },
      trend,
    };
  }

  private async getExceptionsSection(
    organisationId: string,
    can: (key: string) => boolean,
  ): Promise<ExceptionsSection> {
    const [pendingApprovals, overdueMaintenanceCount, failedNotifications] = await Promise.all([
      can(WORKFLOW_PERMISSION)
        ? this.operationalExceptionsReportService.getPendingApprovals(organisationId)
        : Promise.resolve(null),
      can(MAINTENANCE_PERMISSION)
        ? this.operationalExceptionsReportService.getOverdueMaintenanceCount(organisationId)
        : Promise.resolve(null),
      can(NOTIFICATION_EMAIL_PERMISSION) && can(NOTIFICATION_WHATSAPP_PERMISSION)
        ? this.operationalExceptionsReportService.getFailedNotificationCounts(organisationId)
        : Promise.resolve(null),
    ]);

    return {
      pendingApprovalsCount: pendingApprovals ? pendingApprovals.length : null,
      overdueMaintenanceCount,
      failedNotificationsCount: failedNotifications
        ? failedNotifications.email + failedNotifications.whatsapp
        : null,
    };
  }

  private async getRecentActivity(organisationId: string): Promise<RecentActivityRow[]> {
    const logs = await this.auditService.listByOrganisation(organisationId, { take: 10 });
    return logs.map((log) => ({
      id: log.id,
      action: log.action,
      entityType: log.entityType,
      entityId: log.entityId,
      createdAt: log.createdAt,
    }));
  }
}
