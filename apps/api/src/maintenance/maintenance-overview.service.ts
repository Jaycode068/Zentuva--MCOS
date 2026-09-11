import { Injectable } from '@nestjs/common';

import { AssetRepository } from '../assets/asset.repository';
import { PrismaService } from '../prisma/prisma.service';
import { toDowntimeResponse } from './asset-downtime.service';

export interface MaintenanceOverview {
  openRequests: number;
  openWorkOrders: number;
  inProgress: number;
  /** Work orders not yet `COMPLETED`/`CANCELLED` whose `plannedEndAt` has
   *  already passed — distinct from `overduePreventive` (a schedule
   *  concept), added Sprint 22 per the brief's own KPI list. */
  overdueWorkOrders: number;
  overduePreventive: number;
  dueSoonPreventive: number;
  criticalWorkOrders: number;
  assetsUnderMaintenance: number;
  unplannedBreakdownsThisMonth: number;
  downtimeMinutesThisMonth: number;
  /** Sum of `MaintenanceCost.totalCost` + issued `MaintenancePartUsage.
   *  totalCost` for the current month — decision #6, docs/domains/
   *  maintenance-integration.md: parts cost is always derived from
   *  issued part usages, never hand-entered a second time. */
  maintenanceCostThisMonth: number;
  partsCostThisMonth: number;
  partsIssuedCountThisMonth: number;
  workOrdersByStatus: Record<string, number>;
  workOrdersByType: { maintenanceTypeId: string; name: string; count: number }[];
}

const DUE_SOON_DAYS = 7;

/**
 * Composes operational summary metrics for the Maintenance Overview
 * dashboard and per-asset maintenance history (Sprint 21, docs/domains/
 * maintenance.md) — plain, direct read aggregates, never a new
 * intelligence/analytics layer (brief's own explicit non-goal). Every
 * figure here is derived live, never stored.
 */
@Injectable()
export class MaintenanceOverviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly assetRepository: AssetRepository,
  ) {}

  async getOverview(organisationId: string): Promise<MaintenanceOverview> {
    const now = new Date();
    const dueSoonDate = new Date(now.getTime() + DUE_SOON_DAYS * 24 * 60 * 60 * 1000);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const openNonTerminal = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD'] as const;

    const [
      openRequests,
      openWorkOrders,
      inProgress,
      overdueWorkOrders,
      overduePreventive,
      dueSoonPreventive,
      criticalWorkOrders,
      assetsUnderMaintenance,
      unplannedBreakdownsThisMonth,
      downtimeRows,
      costAggregate,
      partsAggregate,
      statusGroups,
      workOrders,
      maintenanceTypes,
    ] = await Promise.all([
      this.prisma.maintenanceRequest.count({
        where: { organisationId, status: { in: ['OPEN', 'UNDER_REVIEW'] } },
      }),
      this.prisma.workOrder.count({
        where: { organisationId, status: { in: ['OPEN', 'ASSIGNED'] } },
      }),
      this.prisma.workOrder.count({ where: { organisationId, status: 'IN_PROGRESS' } }),
      this.prisma.workOrder.count({
        where: {
          organisationId,
          status: { in: [...openNonTerminal] },
          plannedEndAt: { lt: now },
        },
      }),
      this.prisma.maintenanceSchedule.count({
        where: {
          organisationId,
          status: 'ACTIVE',
          scheduleType: 'DATE_BASED',
          nextDueDate: { lt: now },
        },
      }),
      this.prisma.maintenanceSchedule.count({
        where: {
          organisationId,
          status: 'ACTIVE',
          scheduleType: 'DATE_BASED',
          nextDueDate: { gte: now, lte: dueSoonDate },
        },
      }),
      this.prisma.workOrder.count({
        where: {
          organisationId,
          priority: 'CRITICAL',
          status: { in: [...openNonTerminal] },
        },
      }),
      this.prisma.asset.count({ where: { organisationId, status: 'UNDER_MAINTENANCE' } }),
      this.prisma.workOrder.count({
        where: {
          organisationId,
          maintenancePlanId: null,
          createdAt: { gte: monthStart },
        },
      }),
      this.prisma.assetDowntime.findMany({
        where: { organisationId, startedAt: { gte: monthStart } },
        select: { startedAt: true, endedAt: true },
      }),
      this.prisma.maintenanceCost.aggregate({
        where: { organisationId, createdAt: { gte: monthStart } },
        _sum: { totalCost: true },
      }),
      this.prisma.maintenancePartUsage.aggregate({
        where: {
          organisationId,
          status: 'ISSUED',
          usageType: 'CONSUMED',
          issuedAt: { gte: monthStart },
        },
        _sum: { totalCost: true },
        _count: { _all: true },
      }),
      this.prisma.workOrder.groupBy({
        by: ['status'],
        where: { organisationId },
        _count: { _all: true },
      }),
      this.prisma.workOrder.groupBy({
        by: ['maintenanceTypeId'],
        where: { organisationId },
        _count: { _all: true },
      }),
      this.prisma.maintenanceType.findMany({ where: { organisationId } }),
    ]);

    const downtimeMinutesThisMonth = downtimeRows.reduce((sum, row) => {
      const end = row.endedAt ?? now;
      return sum + Math.max(0, (end.getTime() - row.startedAt.getTime()) / 60000);
    }, 0);

    const workOrdersByStatus: Record<string, number> = {};
    for (const group of statusGroups) {
      workOrdersByStatus[group.status] = group._count._all;
    }

    const typeNameById = new Map(maintenanceTypes.map((t) => [t.id, t.name]));
    const workOrdersByType = workOrders.map((group) => ({
      maintenanceTypeId: group.maintenanceTypeId,
      name: typeNameById.get(group.maintenanceTypeId) ?? 'Unknown',
      count: group._count._all,
    }));

    const partsCostThisMonth = partsAggregate._sum.totalCost ?? 0;

    return {
      openRequests,
      openWorkOrders,
      inProgress,
      overdueWorkOrders,
      overduePreventive,
      dueSoonPreventive,
      criticalWorkOrders,
      assetsUnderMaintenance,
      unplannedBreakdownsThisMonth,
      downtimeMinutesThisMonth: Math.round(downtimeMinutesThisMonth),
      maintenanceCostThisMonth: (costAggregate._sum.totalCost ?? 0) + partsCostThisMonth,
      partsCostThisMonth,
      partsIssuedCountThisMonth: partsAggregate._count._all,
      workOrdersByStatus,
      workOrdersByType,
    };
  }

  /** Every currently-open `AssetDowntime` window, shaped for external
   *  (eventually Production) consumption — Sprint 22, docs/domains/
   *  maintenance-integration.md "Production Integration". Read-only;
   *  never mutates anything, never imports `ProductionModule` (which
   *  exports nothing to import anyway — Production has no Asset/
   *  equipment concept yet to key off, so this is deliberately the whole
   *  boundary until Production grows one). */
  async getActiveDowntime(organisationId: string) {
    const now = new Date();
    const downtimes = await this.prisma.assetDowntime.findMany({
      where: { organisationId, endedAt: null },
      include: {
        asset: { select: { id: true, assetCode: true, name: true } },
        workOrder: { select: { id: true, workOrderCode: true, title: true, priority: true } },
      },
      orderBy: { startedAt: 'asc' },
    });
    return {
      items: downtimes.map((d) => ({
        id: d.id,
        asset: d.asset,
        workOrder: d.workOrder,
        startedAt: d.startedAt,
        reason: d.reason,
        planned: d.planned,
        durationMinutesSoFar: Math.round((now.getTime() - d.startedAt.getTime()) / 60000),
      })),
    };
  }

  async getAssetHistory(organisationId: string, assetId: string) {
    const [workOrders, downtimes, costAggregate, partsAggregate, asset] = await Promise.all([
      this.prisma.workOrder.findMany({
        where: { organisationId, assetId },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.assetDowntime.findMany({
        where: { organisationId, assetId },
        orderBy: { startedAt: 'desc' },
      }),
      this.prisma.maintenanceCost.aggregate({
        where: { organisationId, workOrder: { assetId } },
        _sum: { totalCost: true },
      }),
      this.prisma.maintenancePartUsage.aggregate({
        where: {
          organisationId,
          status: 'ISSUED',
          usageType: 'CONSUMED',
          workOrder: { assetId },
        },
        _sum: { totalCost: true },
        _count: { _all: true },
      }),
      this.prisma.asset.findFirst({ where: { id: assetId, organisationId } }),
    ]);

    const partsUsed = await this.prisma.maintenancePartUsage.findMany({
      where: { organisationId, status: 'ISSUED', workOrder: { assetId } },
      include: { product: { select: { id: true, code: true, name: true } } },
      orderBy: { issuedAt: 'desc' },
      take: 20,
    });

    const lastCompleted = workOrders.find((wo) => wo.status === 'COMPLETED') ?? null;
    const upcomingSchedules = await this.prisma.maintenanceSchedule.findMany({
      where: { organisationId, assetId, status: 'ACTIVE' },
      orderBy: { nextDueDate: 'asc' },
    });

    const capitalProject = asset?.capitalProjectId
      ? await this.assetRepository.findCapitalProjectRef(organisationId, asset.capitalProjectId)
      : null;

    return {
      workOrders,
      downtimes: downtimes.map(toDowntimeResponse),
      totalCost: (costAggregate._sum.totalCost ?? 0) + (partsAggregate._sum.totalCost ?? 0),
      laborAndOtherCost: costAggregate._sum.totalCost ?? 0,
      partsCost: partsAggregate._sum.totalCost ?? 0,
      partsIssuedCount: partsAggregate._count._all,
      partsUsed,
      lastMaintenance: lastCompleted,
      upcomingSchedules,
      nextScheduledMaintenance: upcomingSchedules[0] ?? null,
      capitalProject,
    };
  }

  getAssetOpenWork(organisationId: string, assetId: string) {
    return this.prisma.workOrder.findMany({
      where: {
        organisationId,
        assetId,
        status: { in: ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD'] },
      },
      orderBy: { priority: 'desc' },
    });
  }
}
