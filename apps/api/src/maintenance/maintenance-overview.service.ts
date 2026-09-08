import { Injectable } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { toDowntimeResponse } from './asset-downtime.service';

export interface MaintenanceOverview {
  openRequests: number;
  openWorkOrders: number;
  inProgress: number;
  overduePreventive: number;
  dueSoonPreventive: number;
  criticalWorkOrders: number;
  assetsUnderMaintenance: number;
  unplannedBreakdownsThisMonth: number;
  downtimeMinutesThisMonth: number;
  maintenanceCostThisMonth: number;
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
  constructor(private readonly prisma: PrismaService) {}

  async getOverview(organisationId: string): Promise<MaintenanceOverview> {
    const now = new Date();
    const dueSoonDate = new Date(now.getTime() + DUE_SOON_DAYS * 24 * 60 * 60 * 1000);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      openRequests,
      openWorkOrders,
      inProgress,
      overduePreventive,
      dueSoonPreventive,
      criticalWorkOrders,
      assetsUnderMaintenance,
      unplannedBreakdownsThisMonth,
      downtimeRows,
      costAggregate,
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
          status: { in: ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD'] },
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

    return {
      openRequests,
      openWorkOrders,
      inProgress,
      overduePreventive,
      dueSoonPreventive,
      criticalWorkOrders,
      assetsUnderMaintenance,
      unplannedBreakdownsThisMonth,
      downtimeMinutesThisMonth: Math.round(downtimeMinutesThisMonth),
      maintenanceCostThisMonth: costAggregate._sum.totalCost ?? 0,
      workOrdersByStatus,
      workOrdersByType,
    };
  }

  async getAssetHistory(organisationId: string, assetId: string) {
    const [workOrders, downtimes, costAggregate] = await Promise.all([
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
    ]);

    const lastCompleted = workOrders.find((wo) => wo.status === 'COMPLETED') ?? null;
    const upcomingSchedules = await this.prisma.maintenanceSchedule.findMany({
      where: { organisationId, assetId, status: 'ACTIVE' },
      orderBy: { nextDueDate: 'asc' },
    });

    return {
      workOrders,
      downtimes: downtimes.map(toDowntimeResponse),
      totalCost: costAggregate._sum.totalCost ?? 0,
      lastMaintenance: lastCompleted,
      upcomingSchedules,
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
