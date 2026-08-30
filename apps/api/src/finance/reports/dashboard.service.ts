import { Injectable } from '@nestjs/common';
import { SalesOrderStatus } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { AccountsPayableService, ApSummary } from '../accounts-payable.service';
import { AccountsReceivableService, ArSummary } from '../accounts-receivable.service';
import { InventoryValuationService } from './inventory-valuation.service';
import { FinancialStatementService, ProfitAndLossComparison } from './financial-statement.service';

export interface DashboardOperational {
  salesOrderCount: number;
  salesOrderTotal: number;
  productionOrdersCompleted: number;
}

export interface DashboardResult {
  from: Date | null;
  to: Date;
  pnl: ProfitAndLossComparison;
  ar: ArSummary;
  ap: ApSummary;
  inventoryValue: number;
  operational: DashboardOperational;
}

/**
 * Management Dashboard foundation (Sprint 13, docs/domains/accounting.md §16.5) —
 * composes existing reporting services, never recomputes a figure a more specific
 * report already owns. Deliberately small: "what is happening in my business right
 * now," not every metric this codebase could produce (brief §18). The Operational
 * section uses simple, direct, read-only `count`/`aggregate` queries against
 * `SalesOrder`/`ProductionOrder` — the same narrow, documented read-only-reach
 * pattern `InventoryValuationService` uses for `InventoryStock`, kept intentionally
 * tiny (two counts, not a second Sales/Production reporting surface).
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly financialStatementService: FinancialStatementService,
    private readonly accountsReceivableService: AccountsReceivableService,
    private readonly accountsPayableService: AccountsPayableService,
    private readonly inventoryValuationService: InventoryValuationService,
  ) {}

  async getDashboard(
    organisationId: string,
    params: { from?: Date; to: Date; compare?: boolean },
  ): Promise<DashboardResult> {
    const [pnl, ar, ap, valuation, operational] = await Promise.all([
      params.compare && params.from
        ? this.financialStatementService.getProfitAndLossComparison(organisationId, {
            from: params.from,
            to: params.to,
          })
        : this.financialStatementService
            .getProfitAndLoss(organisationId, params)
            .then((current) => ({ current, previous: null })),
      this.accountsReceivableService.getSummary(organisationId),
      this.accountsPayableService.getSummary(organisationId),
      this.inventoryValuationService.getValuation(organisationId),
      this.getOperational(organisationId, params),
    ]);

    return {
      from: params.from ?? null,
      to: params.to,
      pnl,
      ar,
      ap,
      inventoryValue: valuation.totals.grandTotal,
      operational,
    };
  }

  private async getOperational(
    organisationId: string,
    params: { from?: Date; to: Date },
  ): Promise<DashboardOperational> {
    const dateFilter = {
      ...(params.from ? { gte: params.from } : {}),
      lte: params.to,
    };
    const [salesOrders, productionOrdersCompleted] = await Promise.all([
      this.prisma.salesOrder.aggregate({
        where: {
          organisationId,
          status: { not: SalesOrderStatus.DRAFT },
          orderDate: dateFilter,
        },
        _count: true,
        _sum: { total: true },
      }),
      this.prisma.productionRun.count({
        where: { organisationId, completedAt: dateFilter },
      }),
    ]);
    return {
      salesOrderCount: salesOrders._count,
      salesOrderTotal: roundCurrency(salesOrders._sum.total ?? 0),
      productionOrdersCompleted,
    };
  }
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}
