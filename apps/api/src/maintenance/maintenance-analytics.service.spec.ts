import {
  CostCentreNotFoundError,
  HIGH_COST_MULTIPLIER,
  MaintenanceAnalyticsService,
  REPEAT_FAILURE_THRESHOLD,
} from './maintenance-analytics.service';
import { PrismaService } from '../prisma/prisma.service';

const ORG = 'org-1';

function makePrisma(overrides: Record<string, unknown>) {
  return {
    costCentre: { findFirst: jest.fn(async () => null) },
    maintenanceCost: { findMany: jest.fn(async () => []), aggregate: jest.fn() },
    maintenancePartUsage: {
      aggregate: jest.fn(async () => ({ _sum: { totalCost: 0 } })),
      findMany: jest.fn(async () => []),
    },
    budgetLine: { aggregate: jest.fn(async () => ({ _sum: { amount: 0 } })) },
    workOrder: { findMany: jest.fn(async () => []) },
    assetDowntime: { findMany: jest.fn(async () => []) },
    ...overrides,
  } as unknown as PrismaService;
}

describe('MaintenanceAnalyticsService.getCostVsBudget', () => {
  it('throws CostCentreNotFoundError for an unknown/cross-tenant cost centre', async () => {
    const prisma = makePrisma({ costCentre: { findFirst: jest.fn(async () => null) } });
    const service = new MaintenanceAnalyticsService(prisma);
    await expect(
      service.getCostVsBudget(ORG, 'cc-1', new Date('2026-01-01'), new Date('2026-01-31')),
    ).rejects.toThrow(CostCentreNotFoundError);
  });

  it('sums MaintenanceCost tagged to the cost centre + issued parts on the same work orders, compares against BudgetLine OPERATING_EXPENSE amount', async () => {
    const prisma = makePrisma({
      costCentre: { findFirst: jest.fn(async () => ({ id: 'cc-1', organisationId: ORG })) },
      maintenanceCost: {
        findMany: jest.fn(async () => [
          { workOrderId: 'wo-1', totalCost: 50_000 },
          { workOrderId: 'wo-1', totalCost: 20_000 },
        ]),
      },
      maintenancePartUsage: {
        aggregate: jest.fn(async () => ({ _sum: { totalCost: 30_000 } })),
      },
      budgetLine: {
        aggregate: jest.fn(async () => ({ _sum: { amount: 150_000 } })),
      },
    });
    const service = new MaintenanceAnalyticsService(prisma);

    const result = await service.getCostVsBudget(
      ORG,
      'cc-1',
      new Date('2026-01-01'),
      new Date('2026-01-31'),
    );

    expect(result.laborAndOtherCost).toBe(70_000);
    expect(result.partsCost).toBe(30_000);
    expect(result.actual).toBe(100_000);
    expect(result.budget).toBe(150_000);
    expect(result.variance).toBe(-50_000);
    expect(result.variancePercent).toBeCloseTo((-50_000 / 150_000) * 100);
    expect(result.withinBudget).toBe(true);
  });

  it('returns variancePercent: null and withinBudget: false when budget is zero but actual is positive', async () => {
    const prisma = makePrisma({
      costCentre: { findFirst: jest.fn(async () => ({ id: 'cc-1', organisationId: ORG })) },
      maintenanceCost: {
        findMany: jest.fn(async () => [{ workOrderId: 'wo-1', totalCost: 10_000 }]),
      },
      budgetLine: { aggregate: jest.fn(async () => ({ _sum: { amount: null } })) },
    });
    const service = new MaintenanceAnalyticsService(prisma);

    const result = await service.getCostVsBudget(
      ORG,
      'cc-1',
      new Date('2026-01-01'),
      new Date('2026-01-31'),
    );
    expect(result.budget).toBe(0);
    expect(result.variancePercent).toBeNull();
    expect(result.withinBudget).toBe(false);
  });
});

describe('MaintenanceAnalyticsService.getRiskSignals', () => {
  it(`flags an asset with >= ${REPEAT_FAILURE_THRESHOLD} corrective work orders in the trailing window as REPEAT_FAILURE`, async () => {
    const prisma = makePrisma({
      workOrder: {
        findMany: jest.fn(async () => [
          { assetId: 'asset-1', asset: { assetCode: 'AST-1', name: 'Fryer' } },
          { assetId: 'asset-1', asset: { assetCode: 'AST-1', name: 'Fryer' } },
          { assetId: 'asset-1', asset: { assetCode: 'AST-1', name: 'Fryer' } },
        ]),
      },
      maintenanceCost: { findMany: jest.fn(async () => []) },
      maintenancePartUsage: { findMany: jest.fn(async () => []) },
    });
    const service = new MaintenanceAnalyticsService(prisma);

    const signals = await service.getRiskSignals(ORG);
    expect(signals).toContainEqual(
      expect.objectContaining({ type: 'REPEAT_FAILURE', assetId: 'asset-1' }),
    );
  });

  it(`flags an asset costing over ${HIGH_COST_MULTIPLIER}x its category's trailing median as HIGH_COST`, async () => {
    const assetBase = (id: string, categoryId: string, code: string) => ({
      assetId: id,
      assetCode: code,
      assetName: code,
      categoryId,
      maintenanceTypeId: 'mt-1',
      maintenanceTypeName: 'General',
      locationId: null,
      locationName: null,
      date: new Date(),
    });
    const prisma = makePrisma({
      workOrder: { findMany: jest.fn(async () => []) },
      maintenanceCost: {
        findMany: jest.fn(async () => [
          {
            workOrderId: 'wo-1',
            totalCost: 10_000,
            category: 'LABOUR',
            createdAt: new Date(),
            workOrder: {
              assetId: 'asset-1',
              maintenanceTypeId: 'mt-1',
              maintenanceType: { name: 'General' },
              asset: {
                assetCode: 'AST-1',
                name: 'Fryer',
                categoryId: 'cat-1',
                locationId: null,
                location: null,
              },
            },
          },
          {
            workOrderId: 'wo-2',
            totalCost: 12_000,
            category: 'LABOUR',
            createdAt: new Date(),
            workOrder: {
              assetId: 'asset-2',
              maintenanceTypeId: 'mt-1',
              maintenanceType: { name: 'General' },
              asset: {
                assetCode: 'AST-2',
                name: 'Oven',
                categoryId: 'cat-1',
                locationId: null,
                location: null,
              },
            },
          },
          {
            workOrderId: 'wo-3',
            totalCost: 100_000,
            category: 'LABOUR',
            createdAt: new Date(),
            workOrder: {
              assetId: 'asset-3',
              maintenanceTypeId: 'mt-1',
              maintenanceType: { name: 'General' },
              asset: {
                assetCode: 'AST-3',
                name: 'Compressor',
                categoryId: 'cat-1',
                locationId: null,
                location: null,
              },
            },
          },
        ]),
      },
      maintenancePartUsage: { findMany: jest.fn(async () => []) },
    });
    void assetBase;
    const service = new MaintenanceAnalyticsService(prisma);

    const signals = await service.getRiskSignals(ORG);
    const highCost = signals.filter((s) => s.type === 'HIGH_COST');
    expect(highCost).toHaveLength(1);
    expect(highCost[0]!.assetId).toBe('asset-3');
  });

  it('never flags a category with fewer than 2 costed assets', async () => {
    const prisma = makePrisma({
      workOrder: { findMany: jest.fn(async () => []) },
      maintenanceCost: {
        findMany: jest.fn(async () => [
          {
            workOrderId: 'wo-1',
            totalCost: 999_999,
            category: 'LABOUR',
            createdAt: new Date(),
            workOrder: {
              assetId: 'asset-1',
              maintenanceTypeId: 'mt-1',
              maintenanceType: { name: 'General' },
              asset: {
                assetCode: 'AST-1',
                name: 'Fryer',
                categoryId: 'cat-lonely',
                locationId: null,
                location: null,
              },
            },
          },
        ]),
      },
      maintenancePartUsage: { findMany: jest.fn(async () => []) },
    });
    const service = new MaintenanceAnalyticsService(prisma);

    const signals = await service.getRiskSignals(ORG);
    expect(signals.filter((s) => s.type === 'HIGH_COST')).toHaveLength(0);
  });
});
