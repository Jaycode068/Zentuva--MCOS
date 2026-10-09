import { Injectable } from '@nestjs/common';

import { ProductionMaterialIssueRepository } from '../../production/production-material-issue.repository';
import { PrismaService } from '../../prisma/prisma.service';
import { ReportTableResult } from '../reporting.types';

export interface ProductionPerformanceRow {
  productionOrderId: string;
  productionOrderNumber: string;
  productId: string;
  productName: string;
  plannedQuantity: number;
  producedQuantity: number;
  acceptedQuantity: number;
  rejectedQuantity: number;
  /** `null` when `plannedQuantity` is 0 — never `Infinity`/`NaN` (brief §9/§19). */
  yieldPercent: number | null;
  materialCost: number;
  completedAt: Date;
}

export interface ProductionPerformanceReport {
  from: Date;
  to: Date;
  totalProduced: number;
  totalAccepted: number;
  totalRejected: number;
  totalMaterialCost: number;
  /** `null` when no comparison period was requested, or the comparison period had
   *  zero completed production (brief §9/§11 — never a misleading 0). */
  comparisonTotalAccepted: number | null;
  table: ReportTableResult<ProductionPerformanceRow>;
}

/**
 * Sprint 45 — Reporting & Business Intelligence Foundation. No existing authoritative
 * "planned vs actual" report service exists (confirmed by audit) — this is genuinely
 * new, but it introduces NO new calculation: `plannedQuantity` comes straight from
 * `ProductionOrder`, `produced/accepted/rejectedQuantity` straight from the existing
 * `ProductionRun` event row (Sprint 9/37), and material cost from
 * `ProductionMaterialIssueRepository.getTotalWipValue` — the SAME GL-sourced figure
 * `ProductionOrderService.completeProduction` already uses to value the run's own
 * journal entry (docs/domains/production.md). No labour/overhead costing exists in
 * this codebase, so `materialCost` is reported and named as exactly that — never
 * presented as a complete "production cost."
 *
 * Scoped to `status: COMPLETED` only, filtered by `productionRun.completedAt` — a
 * `DRAFT`/`PLANNED`/`IN_PROGRESS` order has no actual output yet, so "planned vs
 * actual" has nothing real to compare for it.
 */
@Injectable()
export class ProductionPerformanceReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly materialIssueRepository: ProductionMaterialIssueRepository,
  ) {}

  async getReport(
    organisationId: string,
    params: {
      from: Date;
      to: Date;
      comparisonFrom?: Date;
      comparisonTo?: Date;
      productId?: string;
      page: number;
      pageSize: number;
    },
  ): Promise<ProductionPerformanceReport> {
    const where = {
      organisationId,
      status: 'COMPLETED' as const,
      ...(params.productId ? { productId: params.productId } : {}),
      productionRun: { completedAt: { gte: params.from, lt: params.to } },
    };

    const [total, orders, comparisonAccepted] = await Promise.all([
      this.prisma.productionOrder.count({ where }),
      this.prisma.productionOrder.findMany({
        where,
        select: {
          id: true,
          productionOrderNumber: true,
          productId: true,
          plannedQuantity: true,
          product: { select: { name: true } },
          productionRun: {
            select: {
              producedQuantity: true,
              acceptedQuantity: true,
              rejectedQuantity: true,
              completedAt: true,
            },
          },
        },
        orderBy: { productionRun: { completedAt: 'desc' } },
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
      }),
      params.comparisonFrom && params.comparisonTo
        ? this.prisma.productionRun.aggregate({
            where: {
              organisationId,
              completedAt: { gte: params.comparisonFrom, lt: params.comparisonTo },
              productionOrder: params.productId ? { productId: params.productId } : undefined,
            },
            _sum: { acceptedQuantity: true },
          })
        : Promise.resolve(null),
    ]);

    const rows: ProductionPerformanceRow[] = await Promise.all(
      orders.map(async (order) => {
        const materialCost = await this.materialIssueRepository.getTotalWipValue(
          organisationId,
          order.id,
        );
        const run = order.productionRun!;
        return {
          productionOrderId: order.id,
          productionOrderNumber: order.productionOrderNumber,
          productId: order.productId,
          productName: order.product.name,
          plannedQuantity: order.plannedQuantity,
          producedQuantity: run.producedQuantity,
          acceptedQuantity: run.acceptedQuantity,
          rejectedQuantity: run.rejectedQuantity,
          yieldPercent:
            order.plannedQuantity === 0
              ? null
              : Math.round((run.acceptedQuantity / order.plannedQuantity) * 10000) / 100,
          materialCost,
          completedAt: run.completedAt,
        };
      }),
    );

    const totals = rows.reduce(
      (acc, row) => ({
        totalProduced: acc.totalProduced + row.producedQuantity,
        totalAccepted: acc.totalAccepted + row.acceptedQuantity,
        totalRejected: acc.totalRejected + row.rejectedQuantity,
        totalMaterialCost: acc.totalMaterialCost + row.materialCost,
      }),
      { totalProduced: 0, totalAccepted: 0, totalRejected: 0, totalMaterialCost: 0 },
    );

    const comparisonTotalAccepted = comparisonAccepted?._sum.acceptedQuantity ?? null;

    return {
      from: params.from,
      to: params.to,
      ...totals,
      comparisonTotalAccepted: comparisonTotalAccepted === 0 ? null : comparisonTotalAccepted,
      table: { rows, total, page: params.page, pageSize: params.pageSize },
    };
  }
}
