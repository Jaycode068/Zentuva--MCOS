import { Injectable } from '@nestjs/common';
import { SalesOrderStatus } from '@prisma/client';

import { RevenueCogsService, RevenueReport } from '../../finance/reports/revenue-cogs.service';
import { PrismaService } from '../../prisma/prisma.service';
import { toLocalDateKey } from '../reporting-period.util';
import { ReportTableResult } from '../reporting.types';

export interface SalesOrderStatusCount {
  status: SalesOrderStatus;
  count: number;
}

export interface SalesPerformanceOrderRow {
  id: string;
  orderCode: string;
  customerId: string | null;
  customerName: string;
  status: SalesOrderStatus;
  orderDate: Date;
  total: number;
}

export interface SalesTrendPoint {
  /** The organisation-local calendar date (as a UTC day-bucket instant, matching the
   *  `reporting-period.util.ts` convention) this point summarizes. */
  date: Date;
  totalRevenue: number;
}

export interface SalesPerformanceReport {
  from: Date;
  to: Date;
  /** The GL-tied headline figures — never recomputed here, see this file's own doc
   *  comment on why order totals are not a substitute for recognized revenue. */
  revenue: RevenueReport;
  /** `null` when no comparison period was requested, OR when the comparison period
   *  had zero recognized revenue — the caller renders "No comparison data," never a
   *  misleading 0 (brief §9/§11). */
  comparisonRevenue: number | null;
  ordersByStatus: SalesOrderStatusCount[];
  table: ReportTableResult<SalesPerformanceOrderRow>;
}

/**
 * Sprint 45 — Reporting & Business Intelligence Foundation. Headline revenue/COGS
 * always comes from `RevenueCogsService` (itself GL-tied via
 * `FinancialStatementService`) — never recomputed from `SalesOrder.total` here,
 * matching `RevenueCogsService`'s own doc comment exactly ("the GL-tied headline
 * figure... the breakdowns below are a supplementary drill-down").
 *
 * The order-count/status breakdown and the row-level order table below have no
 * existing authoritative service (the audit found `dashboard.service.ts
 * .getOperational` does a similar but narrower, unfiltered-by-source count) — these
 * are genuinely new, narrow, read-only `SalesOrder` reads, the same "documented
 * direct-Prisma exception" shape Finance's own `reports/` files already use for
 * `InventoryStock` (see `reporting-independence.spec.ts`). **Deliberately filters
 * `source: B2B`** — D2C orders are reported separately via the existing D2C admin
 * dashboard (docs/domains/reporting.md "D2C"), so a B2B sales performance report
 * never double-counts a D2C order as if it were a second channel of the same figure.
 */
@Injectable()
export class SalesPerformanceReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly revenueCogsService: RevenueCogsService,
  ) {}

  async getReport(
    organisationId: string,
    params: {
      from: Date;
      to: Date;
      comparisonFrom?: Date;
      comparisonTo?: Date;
      customerId?: string;
      status?: SalesOrderStatus;
      page: number;
      pageSize: number;
    },
  ): Promise<SalesPerformanceReport> {
    const where = {
      organisationId,
      source: 'B2B' as const,
      orderDate: { gte: params.from, lt: params.to },
      ...(params.customerId ? { customerId: params.customerId } : {}),
      ...(params.status ? { status: params.status } : {}),
    };

    const [revenue, comparisonRevenueReport, statusGroups, total, orders] = await Promise.all([
      this.revenueCogsService.getRevenueReport(organisationId, {
        from: params.from,
        to: params.to,
      }),
      params.comparisonFrom && params.comparisonTo
        ? this.revenueCogsService.getRevenueReport(organisationId, {
            from: params.comparisonFrom,
            to: params.comparisonTo,
          })
        : Promise.resolve(null),
      this.prisma.salesOrder.groupBy({
        by: ['status'],
        where: { organisationId, source: 'B2B', orderDate: { gte: params.from, lt: params.to } },
        _count: true,
      }),
      this.prisma.salesOrder.count({ where }),
      this.prisma.salesOrder.findMany({
        where,
        select: {
          id: true,
          orderCode: true,
          customerId: true,
          status: true,
          orderDate: true,
          total: true,
          customer: { select: { customerName: true } },
        },
        orderBy: { orderDate: 'desc' },
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
      }),
    ]);

    return {
      from: params.from,
      to: params.to,
      revenue,
      comparisonRevenue:
        comparisonRevenueReport && comparisonRevenueReport.totalRevenue !== 0
          ? comparisonRevenueReport.totalRevenue
          : null,
      ordersByStatus: statusGroups.map((row) => ({ status: row.status, count: row._count })),
      table: {
        rows: orders.map((order) => ({
          id: order.id,
          orderCode: order.orderCode,
          customerId: order.customerId,
          customerName: order.customer?.customerName ?? '—',
          status: order.status,
          orderDate: order.orderDate,
          total: order.total,
        })),
        total,
        page: params.page,
        pageSize: params.pageSize,
      },
    };
  }

  /**
   * Sprint 46 — Executive & Management Dashboards (brief §5C "Sales or revenue over
   * time"). A REAL day-by-day trend, bucketed from actual `SalesOrder.orderDate`/
   * `total` rows within `[from, to)` — never a manufactured series from one current
   * total (brief's own explicit warning). Deliberately excludes `DRAFT` (not a real
   * commitment yet) and `CANCELLED` (reversed) — the same two statuses `revenue-cogs
   * .service.ts`'s own GL-tied figure effectively nets out via `SALES_RETURNS`/never
   * posting a draft. This is `SalesOrder.total`, not the GL-recognized figure the
   * headline "Net Revenue" card shows — labelled "Sales Order Value" wherever
   * rendered, precisely so the two numbers are never mistaken for the same thing
   * (brief §5A "if a metric uses a different date basis... document that
   * distinction"). Fetches only `orderDate`/`total` for rows already bounded by one
   * reporting period — never the full table (brief §9).
   */
  async getDailyTrend(
    organisationId: string,
    params: { from: Date; to: Date; timeZone: string },
  ): Promise<SalesTrendPoint[]> {
    const orders = await this.prisma.salesOrder.findMany({
      where: {
        organisationId,
        source: 'B2B',
        status: { notIn: ['DRAFT', 'CANCELLED'] },
        orderDate: { gte: params.from, lt: params.to },
      },
      select: { orderDate: true, total: true },
    });

    const totalsByDay = new Map<string, number>();
    for (const order of orders) {
      const key = toLocalDateKey(order.orderDate, params.timeZone);
      totalsByDay.set(key, (totalsByDay.get(key) ?? 0) + order.total);
    }

    return [...totalsByDay.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([dateKey, totalRevenue]) => ({
        date: new Date(`${dateKey}T00:00:00.000Z`),
        totalRevenue,
      }));
  }
}
