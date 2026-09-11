import { Injectable } from '@nestjs/common';
import { MaintenanceCostCategory } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

/** Thrown when a `costCentreId` doesn't resolve to a real, tenant-owned
 *  `CostCentre` row (Budgeting's own table, read-only from here — decision
 *  #10, docs/domains/maintenance-integration.md). */
export class CostCentreNotFoundError extends Error {}

/** ≥3 corrective work orders against the same asset within a rolling
 *  90-day window is flagged "repeat failure" — decision #14, documented in
 *  docs/domains/maintenance-integration.md "Risk Signal Thresholds". */
export const REPEAT_FAILURE_WINDOW_DAYS = 90;
export const REPEAT_FAILURE_THRESHOLD = 3;

/** An asset's own trailing-90-day maintenance cost exceeding 2× the median
 *  trailing-90-day cost of every other asset in the same `AssetCategory`
 *  is flagged "high cost" — decision #14, same doc. A category needs at
 *  least 2 assets with nonzero trailing cost before any flag can fire
 *  (a lone asset can never exceed 2× its own value). */
export const HIGH_COST_TRAILING_WINDOW_DAYS = 90;
export const HIGH_COST_MULTIPLIER = 2;

export interface CostVsBudgetResult {
  costCentreId: string;
  from: Date;
  to: Date;
  actual: number;
  laborAndOtherCost: number;
  partsCost: number;
  budget: number;
  variance: number;
  variancePercent: number | null;
  withinBudget: boolean;
}

export interface CostBreakdownRow {
  key: string;
  label: string;
  amount: number;
}

export interface CostBreakdownResult {
  from: Date;
  to: Date;
  total: number;
  byAsset: CostBreakdownRow[];
  byCategory: CostBreakdownRow[];
  byMaintenanceType: CostBreakdownRow[];
  byMonth: CostBreakdownRow[];
  byLocation: CostBreakdownRow[];
}

export interface OperationalMetricsResult {
  from: Date;
  to: Date;
  costPerAsset: CostBreakdownRow[];
  downtimeMinutesByAsset: { assetId: string; assetCode: string; name: string; minutes: number }[];
  failureCountsByAsset: { assetId: string; assetCode: string; name: string; count: number }[];
  preventiveCount: number;
  correctiveCount: number;
  preventiveToCorrectiveRatio: number | null;
  averageTimeToCompleteHours: number | null;
  workOrderCountByAsset: { assetId: string; assetCode: string; name: string; count: number }[];
}

export interface RiskSignal {
  type: 'REPEAT_FAILURE' | 'HIGH_COST';
  assetId: string;
  assetCode: string;
  name: string;
  detail: string;
}

interface CostRow {
  workOrderId: string;
  assetId: string;
  assetCode: string;
  assetName: string;
  categoryId: string;
  maintenanceTypeId: string;
  maintenanceTypeName: string;
  locationId: string | null;
  locationName: string | null;
  amount: number;
  date: Date;
  costCategory: string;
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function computeMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

function sumBy(
  rows: CostRow[],
  keyOf: (row: CostRow) => string,
  labelOf: (row: CostRow) => string,
): CostBreakdownRow[] {
  const totals = new Map<string, { label: string; amount: number }>();
  for (const row of rows) {
    const key = keyOf(row);
    const existing = totals.get(key);
    if (existing) {
      existing.amount += row.amount;
    } else {
      totals.set(key, { label: labelOf(row), amount: row.amount });
    }
  }
  return [...totals.entries()]
    .map(([key, v]) => ({ key, label: v.label, amount: roundCurrency(v.amount) }))
    .sort((a, b) => b.amount - a.amount);
}

/**
 * Reporting-only composition over Maintenance's own tables plus two
 * narrow, documented, read-only direct-Prisma reaches into Budgeting's
 * `CostCentre`/`BudgetLine` (Sprint 22, docs/domains/
 * maintenance-integration.md "Budget Integration" / "Risk Signals") — the
 * exact "narrow read reach into another domain's own table, no write,
 * documented" exception already established by `AssetRepository.
 * findCapitalProjectRef()` (Sprint 18/20) and
 * `MaintenanceProcurementRepository.getApSummaryForPurchaseOrder()`
 * (Sprint 22). Never imports `BudgetingModule`/`FinanceModule` — every
 * cross-domain read here is a plain `this.prisma.<table>.find/aggregate`
 * call. Every figure is derived live, never stored.
 */
@Injectable()
export class MaintenanceAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Called by `MaintenanceCostService.record()` before persisting a
   *  `costCentreId` — the validation this service's own schema doc
   *  comment names as its home. */
  async assertCostCentreExists(organisationId: string, costCentreId: string): Promise<void> {
    const costCentre = await this.prisma.costCentre.findFirst({
      where: { id: costCentreId, organisationId },
    });
    if (!costCentre) {
      throw new CostCentreNotFoundError('Cost centre not found');
    }
  }

  async getCostVsBudget(
    organisationId: string,
    costCentreId: string,
    from: Date,
    to: Date,
  ): Promise<CostVsBudgetResult> {
    await this.assertCostCentreExists(organisationId, costCentreId);

    const taggedCosts = await this.prisma.maintenanceCost.findMany({
      where: { organisationId, costCentreId, createdAt: { gte: from, lte: to } },
      select: { workOrderId: true, totalCost: true },
    });
    const laborAndOtherCost = taggedCosts.reduce((sum, c) => sum + c.totalCost, 0);

    // Parts cost attributed to this cost centre = issued parts on exactly
    // the work orders that have at least one MaintenanceCost row tagged
    // to it — MaintenancePartUsage carries no costCentreId of its own
    // (decision #10 adds the field only to MaintenanceCost), so this is
    // the documented, derivable rule for attributing parts cost to a
    // cost centre without a schema change.
    const workOrderIds = [...new Set(taggedCosts.map((c) => c.workOrderId))];
    const partsAggregate = workOrderIds.length
      ? await this.prisma.maintenancePartUsage.aggregate({
          where: {
            organisationId,
            workOrderId: { in: workOrderIds },
            status: 'ISSUED',
            usageType: 'CONSUMED',
            issuedAt: { gte: from, lte: to },
          },
          _sum: { totalCost: true },
        })
      : { _sum: { totalCost: 0 as number | null } };
    const partsCost = partsAggregate._sum.totalCost ?? 0;
    const actual = roundCurrency(laborAndOtherCost + partsCost);

    const budgetAggregate = await this.prisma.budgetLine.aggregate({
      where: {
        costCentreId,
        lineType: 'OPERATING_EXPENSE',
        periodMonth: { gte: from, lte: to },
        budget: { organisationId, status: 'ACTIVE' },
      },
      _sum: { amount: true },
    });
    const budget = budgetAggregate._sum.amount ?? 0;
    const variance = roundCurrency(actual - budget);
    const variancePercent = budget === 0 ? null : roundCurrency((variance / budget) * 100);

    return {
      costCentreId,
      from,
      to,
      actual,
      laborAndOtherCost: roundCurrency(laborAndOtherCost),
      partsCost: roundCurrency(partsCost),
      budget,
      variance,
      variancePercent,
      withinBudget: actual <= budget,
    };
  }

  private async collectCostRows(organisationId: string, from: Date, to: Date): Promise<CostRow[]> {
    const [costs, partUsages] = await Promise.all([
      this.prisma.maintenanceCost.findMany({
        where: { organisationId, createdAt: { gte: from, lte: to } },
        select: {
          workOrderId: true,
          totalCost: true,
          category: true,
          createdAt: true,
          workOrder: {
            select: {
              assetId: true,
              maintenanceTypeId: true,
              maintenanceType: { select: { name: true } },
              asset: {
                select: {
                  assetCode: true,
                  name: true,
                  categoryId: true,
                  locationId: true,
                  location: { select: { name: true } },
                },
              },
            },
          },
        },
      }),
      this.prisma.maintenancePartUsage.findMany({
        where: {
          organisationId,
          status: 'ISSUED',
          usageType: 'CONSUMED',
          issuedAt: { gte: from, lte: to },
        },
        select: {
          workOrderId: true,
          totalCost: true,
          issuedAt: true,
          workOrder: {
            select: {
              assetId: true,
              maintenanceTypeId: true,
              maintenanceType: { select: { name: true } },
              asset: {
                select: {
                  assetCode: true,
                  name: true,
                  categoryId: true,
                  locationId: true,
                  location: { select: { name: true } },
                },
              },
            },
          },
        },
      }),
    ]);

    const rows: CostRow[] = [];
    for (const c of costs) {
      rows.push({
        workOrderId: c.workOrderId,
        assetId: c.workOrder.assetId,
        assetCode: c.workOrder.asset.assetCode,
        assetName: c.workOrder.asset.name,
        categoryId: c.workOrder.asset.categoryId,
        maintenanceTypeId: c.workOrder.maintenanceTypeId,
        maintenanceTypeName: c.workOrder.maintenanceType.name,
        locationId: c.workOrder.asset.locationId,
        locationName: c.workOrder.asset.location?.name ?? null,
        amount: c.totalCost,
        date: c.createdAt,
        costCategory: c.category as MaintenanceCostCategory,
      });
    }
    for (const p of partUsages) {
      rows.push({
        workOrderId: p.workOrderId,
        assetId: p.workOrder.assetId,
        assetCode: p.workOrder.asset.assetCode,
        assetName: p.workOrder.asset.name,
        categoryId: p.workOrder.asset.categoryId,
        maintenanceTypeId: p.workOrder.maintenanceTypeId,
        maintenanceTypeName: p.workOrder.maintenanceType.name,
        locationId: p.workOrder.asset.locationId,
        locationName: p.workOrder.asset.location?.name ?? null,
        amount: p.totalCost ?? 0,
        date: p.issuedAt ?? new Date(),
        costCategory: 'PARTS_ISSUED',
      });
    }
    return rows;
  }

  async getCostBreakdown(
    organisationId: string,
    from: Date,
    to: Date,
  ): Promise<CostBreakdownResult> {
    const rows = await this.collectCostRows(organisationId, from, to);
    const total = roundCurrency(rows.reduce((sum, r) => sum + r.amount, 0));

    return {
      from,
      to,
      total,
      byAsset: sumBy(
        rows,
        (r) => r.assetId,
        (r) => `${r.assetCode} — ${r.assetName}`,
      ),
      byCategory: sumBy(
        rows,
        (r) => r.costCategory,
        (r) => r.costCategory,
      ),
      byMaintenanceType: sumBy(
        rows,
        (r) => r.maintenanceTypeId,
        (r) => r.maintenanceTypeName,
      ),
      byMonth: sumBy(
        rows,
        (r) => monthKey(r.date),
        (r) => monthKey(r.date),
      ).sort((a, b) => (a.key < b.key ? -1 : 1)),
      byLocation: sumBy(
        rows,
        (r) => r.locationId ?? 'UNASSIGNED',
        (r) => r.locationName ?? 'Unassigned',
      ),
    };
  }

  async getOperationalMetrics(
    organisationId: string,
    from: Date,
    to: Date,
  ): Promise<OperationalMetricsResult> {
    const [costRows, downtimes, workOrders] = await Promise.all([
      this.collectCostRows(organisationId, from, to),
      this.prisma.assetDowntime.findMany({
        where: { organisationId, startedAt: { gte: from, lte: to } },
        select: {
          assetId: true,
          startedAt: true,
          endedAt: true,
          asset: { select: { assetCode: true, name: true } },
        },
      }),
      this.prisma.workOrder.findMany({
        where: { organisationId, createdAt: { gte: from, lte: to } },
        select: {
          assetId: true,
          maintenancePlanId: true,
          status: true,
          actualStartAt: true,
          completedAt: true,
          asset: { select: { assetCode: true, name: true } },
        },
      }),
    ]);

    const costPerAsset = sumBy(
      costRows,
      (r) => r.assetId,
      (r) => `${r.assetCode} — ${r.assetName}`,
    );

    const now = new Date();
    const downtimeByAsset = new Map<string, { assetCode: string; name: string; minutes: number }>();
    for (const d of downtimes) {
      const minutes = Math.max(0, ((d.endedAt ?? now).getTime() - d.startedAt.getTime()) / 60000);
      const existing = downtimeByAsset.get(d.assetId);
      if (existing) {
        existing.minutes += minutes;
      } else {
        downtimeByAsset.set(d.assetId, {
          assetCode: d.asset.assetCode,
          name: d.asset.name,
          minutes,
        });
      }
    }

    const correctiveWorkOrders = workOrders.filter((wo) => wo.maintenancePlanId === null);
    const preventiveCount = workOrders.length - correctiveWorkOrders.length;
    const correctiveCount = correctiveWorkOrders.length;

    const failureByAsset = new Map<string, { assetCode: string; name: string; count: number }>();
    for (const wo of correctiveWorkOrders) {
      const existing = failureByAsset.get(wo.assetId);
      if (existing) {
        existing.count += 1;
      } else {
        failureByAsset.set(wo.assetId, {
          assetCode: wo.asset.assetCode,
          name: wo.asset.name,
          count: 1,
        });
      }
    }

    const countByAsset = new Map<string, { assetCode: string; name: string; count: number }>();
    for (const wo of workOrders) {
      const existing = countByAsset.get(wo.assetId);
      if (existing) {
        existing.count += 1;
      } else {
        countByAsset.set(wo.assetId, {
          assetCode: wo.asset.assetCode,
          name: wo.asset.name,
          count: 1,
        });
      }
    }

    const completedDurations = workOrders
      .filter((wo) => wo.status === 'COMPLETED' && wo.actualStartAt && wo.completedAt)
      .map((wo) => (wo.completedAt!.getTime() - wo.actualStartAt!.getTime()) / (60 * 60 * 1000));
    const averageTimeToCompleteHours =
      completedDurations.length === 0
        ? null
        : roundCurrency(
            completedDurations.reduce((sum, h) => sum + h, 0) / completedDurations.length,
          );

    return {
      from,
      to,
      costPerAsset,
      downtimeMinutesByAsset: [...downtimeByAsset.entries()]
        .map(([assetId, v]) => ({ assetId, ...v, minutes: Math.round(v.minutes) }))
        .sort((a, b) => b.minutes - a.minutes),
      failureCountsByAsset: [...failureByAsset.entries()]
        .map(([assetId, v]) => ({ assetId, ...v }))
        .sort((a, b) => b.count - a.count),
      preventiveCount,
      correctiveCount,
      preventiveToCorrectiveRatio:
        correctiveCount === 0 ? null : roundCurrency(preventiveCount / correctiveCount),
      averageTimeToCompleteHours,
      workOrderCountByAsset: [...countByAsset.entries()]
        .map(([assetId, v]) => ({ assetId, ...v }))
        .sort((a, b) => b.count - a.count),
    };
  }

  async getRiskSignals(organisationId: string): Promise<RiskSignal[]> {
    const now = new Date();
    const repeatFailureWindowStart = new Date(
      now.getTime() - REPEAT_FAILURE_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    );
    const highCostWindowStart = new Date(
      now.getTime() - HIGH_COST_TRAILING_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    );

    const [correctiveWorkOrders, costRows] = await Promise.all([
      this.prisma.workOrder.findMany({
        where: {
          organisationId,
          maintenancePlanId: null,
          createdAt: { gte: repeatFailureWindowStart },
        },
        select: { assetId: true, asset: { select: { assetCode: true, name: true } } },
      }),
      this.collectCostRows(organisationId, highCostWindowStart, now),
    ]);

    const signals: RiskSignal[] = [];

    const failureCountByAsset = new Map<
      string,
      { assetCode: string; name: string; count: number }
    >();
    for (const wo of correctiveWorkOrders) {
      const existing = failureCountByAsset.get(wo.assetId);
      if (existing) {
        existing.count += 1;
      } else {
        failureCountByAsset.set(wo.assetId, {
          assetCode: wo.asset.assetCode,
          name: wo.asset.name,
          count: 1,
        });
      }
    }
    for (const [assetId, v] of failureCountByAsset.entries()) {
      if (v.count >= REPEAT_FAILURE_THRESHOLD) {
        signals.push({
          type: 'REPEAT_FAILURE',
          assetId,
          assetCode: v.assetCode,
          name: v.name,
          detail: `${v.count} corrective work orders in the last ${REPEAT_FAILURE_WINDOW_DAYS} days`,
        });
      }
    }

    // High cost: group each asset's trailing-window total cost by its own
    // AssetCategory, compute the category's median, flag anything over
    // HIGH_COST_MULTIPLIER × that median. A category with fewer than 2
    // assets carrying nonzero cost has no meaningful median to compare
    // against and is skipped — documented, not a bug.
    const costByAsset = new Map<
      string,
      { assetCode: string; name: string; categoryId: string; amount: number }
    >();
    for (const row of costRows) {
      const existing = costByAsset.get(row.assetId);
      if (existing) {
        existing.amount += row.amount;
      } else {
        costByAsset.set(row.assetId, {
          assetCode: row.assetCode,
          name: row.assetName,
          categoryId: row.categoryId,
          amount: row.amount,
        });
      }
    }
    const byCategory = new Map<
      string,
      { assetId: string; assetCode: string; name: string; amount: number }[]
    >();
    for (const [assetId, v] of costByAsset.entries()) {
      const list = byCategory.get(v.categoryId) ?? [];
      list.push({ assetId, assetCode: v.assetCode, name: v.name, amount: v.amount });
      byCategory.set(v.categoryId, list);
    }
    for (const assets of byCategory.values()) {
      if (assets.length < 2) continue;
      const median = computeMedian(assets.map((a) => a.amount));
      if (median <= 0) continue;
      for (const asset of assets) {
        if (asset.amount > HIGH_COST_MULTIPLIER * median) {
          signals.push({
            type: 'HIGH_COST',
            assetId: asset.assetId,
            assetCode: asset.assetCode,
            name: asset.name,
            detail: `₦${roundCurrency(asset.amount).toLocaleString()} in the last ${HIGH_COST_TRAILING_WINDOW_DAYS} days — over ${HIGH_COST_MULTIPLIER}× the category median of ₦${roundCurrency(median).toLocaleString()}`,
          });
        }
      }
    }

    return signals;
  }
}
