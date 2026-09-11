import { MaintenanceOverviewService } from './maintenance-overview.service';
import { AssetRepository } from '../assets/asset.repository';
import { PrismaService } from '../prisma/prisma.service';

const ORG = 'org-1';

describe('MaintenanceOverviewService.getActiveDowntime', () => {
  it('returns only open downtime windows (endedAt: null), shaped with a live-computed duration', async () => {
    const startedAt = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago
    const findMany = jest.fn(async () => [
      {
        id: 'dt-1',
        asset: { id: 'asset-1', assetCode: 'AST-1', name: 'Fryer' },
        workOrder: { id: 'wo-1', workOrderCode: 'WO-1', title: 'Fix fryer', priority: 'HIGH' },
        startedAt,
        reason: 'Breakdown',
        planned: false,
      },
    ]);
    const prisma = {
      assetDowntime: { findMany },
    } as unknown as PrismaService;
    const assetRepository = {} as AssetRepository;
    const service = new MaintenanceOverviewService(prisma, assetRepository);

    const result = await service.getActiveDowntime(ORG);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organisationId: ORG, endedAt: null } }),
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.durationMinutesSoFar).toBeGreaterThanOrEqual(59);
    expect(result.items[0]!.durationMinutesSoFar).toBeLessThanOrEqual(61);
  });
});

describe('MaintenanceOverviewService.getAssetHistory', () => {
  it('attaches the linked Capital Project ref only when the asset has a capitalProjectId', async () => {
    const findCapitalProjectRef = jest.fn(async () => ({
      id: 'cp-1',
      projectCode: 'CAP-000001',
      name: 'Line Expansion',
    }));
    const prisma = {
      workOrder: { findMany: jest.fn(async () => []) },
      assetDowntime: { findMany: jest.fn(async () => []) },
      maintenanceCost: { aggregate: jest.fn(async () => ({ _sum: { totalCost: 0 } })) },
      maintenancePartUsage: {
        aggregate: jest.fn(async () => ({ _sum: { totalCost: 0 }, _count: { _all: 0 } })),
        findMany: jest.fn(async () => []),
      },
      asset: { findFirst: jest.fn(async () => ({ id: 'asset-1', capitalProjectId: 'cp-1' })) },
      maintenanceSchedule: { findMany: jest.fn(async () => []) },
    } as unknown as PrismaService;
    const assetRepository = { findCapitalProjectRef } as unknown as AssetRepository;
    const service = new MaintenanceOverviewService(prisma, assetRepository);

    const result = await service.getAssetHistory(ORG, 'asset-1');

    expect(findCapitalProjectRef).toHaveBeenCalledWith(ORG, 'cp-1');
    expect(result.capitalProject).toEqual({
      id: 'cp-1',
      projectCode: 'CAP-000001',
      name: 'Line Expansion',
    });
  });

  it('never calls findCapitalProjectRef when the asset has no capitalProjectId', async () => {
    const findCapitalProjectRef = jest.fn();
    const prisma = {
      workOrder: { findMany: jest.fn(async () => []) },
      assetDowntime: { findMany: jest.fn(async () => []) },
      maintenanceCost: { aggregate: jest.fn(async () => ({ _sum: { totalCost: 0 } })) },
      maintenancePartUsage: {
        aggregate: jest.fn(async () => ({ _sum: { totalCost: 0 }, _count: { _all: 0 } })),
        findMany: jest.fn(async () => []),
      },
      asset: { findFirst: jest.fn(async () => ({ id: 'asset-1', capitalProjectId: null })) },
      maintenanceSchedule: { findMany: jest.fn(async () => []) },
    } as unknown as PrismaService;
    const assetRepository = { findCapitalProjectRef } as unknown as AssetRepository;
    const service = new MaintenanceOverviewService(prisma, assetRepository);

    const result = await service.getAssetHistory(ORG, 'asset-1');

    expect(findCapitalProjectRef).not.toHaveBeenCalled();
    expect(result.capitalProject).toBeNull();
  });
});
