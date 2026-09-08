import { BadRequestException } from '@nestjs/common';

import { MaintenancePlanService } from './maintenance-plan.service';

const ORG = 'org-1';

function makeService() {
  const maintenancePlanRepository = {
    create: jest.fn(async () => ({
      maintenancePlan: { id: 'plan-1', name: 'Compressor Monthly Service', tasks: [] },
      wasCreated: true,
    })),
    findById: jest.fn(async () => ({ id: 'plan-1', tasks: [] })),
    update: jest.fn(async () => ({ id: 'plan-1' })),
    activate: jest.fn(async () => ({ id: 'plan-1', status: 'ACTIVE' })),
    deactivate: jest.fn(async () => ({ id: 'plan-1', status: 'INACTIVE' })),
  };
  const maintenanceTypeRepository = { findById: jest.fn(async () => ({ id: 'type-1' })) };
  const assetRepository = { findById: jest.fn(async () => ({ id: 'asset-1' })) };
  const assetCategoryRepository = { findById: jest.fn(async () => ({ id: 'category-1' })) };

  const service = new MaintenancePlanService(
    maintenancePlanRepository as never,
    maintenanceTypeRepository as never,
    assetRepository as never,
    assetCategoryRepository as never,
  );

  return { service, maintenancePlanRepository, assetRepository, assetCategoryRepository };
}

const baseInput = {
  name: 'Compressor Monthly Service',
  maintenanceTypeId: 'type-1',
  priority: 'MEDIUM' as const,
  tasks: [],
};

describe('MaintenancePlanService — asset/category XOR rule', () => {
  it('rejects a plan targeting neither an asset nor a category', async () => {
    const { service } = makeService();
    await expect(service.create(ORG, { ...baseInput } as never, 'user-1')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects a plan targeting both an asset and a category', async () => {
    const { service } = makeService();
    await expect(
      service.create(
        ORG,
        { ...baseInput, assetId: 'asset-1', assetCategoryId: 'category-1' } as never,
        'user-1',
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('accepts a plan targeting only a specific asset', async () => {
    const { service, maintenancePlanRepository } = makeService();
    await service.create(ORG, { ...baseInput, assetId: 'asset-1' } as never, 'user-1');
    expect(maintenancePlanRepository.create).toHaveBeenCalled();
  });

  it('accepts a plan targeting only an asset category', async () => {
    const { service, maintenancePlanRepository } = makeService();
    await service.create(ORG, { ...baseInput, assetCategoryId: 'category-1' } as never, 'user-1');
    expect(maintenancePlanRepository.create).toHaveBeenCalled();
  });

  it('rejects a plan referencing an asset that does not belong to this organisation', async () => {
    const { service, assetRepository } = makeService();
    assetRepository.findById.mockResolvedValue(null as never);
    await expect(
      service.create(ORG, { ...baseInput, assetId: 'cross-tenant-asset' } as never, 'user-1'),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a plan referencing a maintenance type that does not belong to this organisation', async () => {
    const { service } = makeService();
    const maintenanceTypeRepository = { findById: jest.fn(async () => null) };
    const badService = new MaintenancePlanService(
      { create: jest.fn() } as never,
      maintenanceTypeRepository as never,
      { findById: jest.fn(async () => ({ id: 'asset-1' })) } as never,
      { findById: jest.fn() } as never,
    );
    await expect(
      badService.create(ORG, { ...baseInput, assetId: 'asset-1' } as never, 'user-1'),
    ).rejects.toThrow(BadRequestException);
    void service;
  });
});
