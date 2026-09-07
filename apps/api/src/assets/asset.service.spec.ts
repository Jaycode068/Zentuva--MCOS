import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AssetStatus } from '@prisma/client';

import { AssetService } from './asset.service';

const ORG = 'org-1';

function makeAsset(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'asset-1',
    organisationId: ORG,
    assetCode: 'AST-000001',
    name: 'Industrial Air Compressor',
    categoryId: 'category-1',
    status: 'DRAFT' as AssetStatus,
    condition: 'NEW',
    locationId: null,
    custodianId: null,
    parentAssetId: null,
    imageKey: null,
    ...overrides,
  };
}

function makeService(params: { asset?: Record<string, unknown> } = {}) {
  const asset = params.asset ?? makeAsset();

  const assetRepository = {
    findById: jest.fn(async (_org: string, id: string) => (id === asset.id ? asset : null)),
    create: jest.fn(async () => ({ asset, wasCreated: true })),
    update: jest.fn(async (_org: string, _id: string, data: Record<string, unknown>) => ({
      ...asset,
      ...data,
    })),
    setStatus: jest.fn(async (_org: string, _id: string, data: Record<string, unknown>) => ({
      ...asset,
      ...data,
    })),
    getParentId: jest.fn(async () => null),
    findCapitalProjectRef: jest.fn(async () => ({
      id: 'project-1',
      projectCode: 'CAP-000001',
      name: 'X',
    })),
    transfer: jest.fn(async () => ({ asset: { ...asset, locationId: 'loc-2' }, wasCreated: true })),
    findChildren: jest.fn(async () => []),
    findMovements: jest.fn(async () => []),
    setImage: jest.fn(
      async (_org: string, _id: string, imageUrl: string | null, imageKey: string | null) => ({
        ...asset,
        imageUrl,
        imageKey,
      }),
    ),
  };
  const assetCategoryRepository = { findById: jest.fn(async () => ({ id: 'category-1' })) };
  const assetLocationRepository = { findById: jest.fn(async () => ({ id: 'loc-1' })) };
  const supplierRepository = { findById: jest.fn(async () => ({ id: 'supplier-1' })) };
  const purchaseOrderRepository = { findById: jest.fn(async () => ({ id: 'po-1' })) };
  const userService = {
    getById: jest.fn(async () => ({ id: 'user-2' })),
    listByOrganisation: jest.fn(async () => []),
  };
  const fileStorage = {
    upload: jest.fn(async () => ({ url: 'http://x/y.png', key: 'assets/org-1/y.png' })),
    delete: jest.fn(async () => undefined),
  };

  const service = new AssetService(
    assetRepository as never,
    assetCategoryRepository as never,
    assetLocationRepository as never,
    supplierRepository as never,
    purchaseOrderRepository as never,
    userService as never,
    fileStorage as never,
  );

  return {
    service,
    assetRepository,
    assetCategoryRepository,
    assetLocationRepository,
    supplierRepository,
    purchaseOrderRepository,
    userService,
    asset,
  };
}

describe('AssetService — create() reference validation', () => {
  it('rejects when the category does not belong to this organisation', async () => {
    const { service, assetCategoryRepository } = makeService();
    assetCategoryRepository.findById.mockResolvedValueOnce(null as never);
    await expect(
      service.create(ORG, { name: 'X', categoryId: 'bad-cat' } as never, 'user-1'),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects when the supplier does not belong to this organisation (cross-tenant)', async () => {
    const { service, supplierRepository } = makeService();
    supplierRepository.findById.mockResolvedValueOnce(null as never);
    await expect(
      service.create(
        ORG,
        { name: 'X', categoryId: 'category-1', supplierId: 'other-org-supplier' } as never,
        'user-1',
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects when the purchase order does not belong to this organisation (cross-tenant)', async () => {
    const { service, purchaseOrderRepository } = makeService();
    purchaseOrderRepository.findById.mockResolvedValueOnce(null as never);
    await expect(
      service.create(
        ORG,
        { name: 'X', categoryId: 'category-1', purchaseOrderId: 'other-org-po' } as never,
        'user-1',
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects when the capital project does not belong to this organisation (cross-tenant)', async () => {
    const { service, assetRepository } = makeService();
    assetRepository.findCapitalProjectRef.mockResolvedValueOnce(null as never);
    await expect(
      service.create(
        ORG,
        { name: 'X', categoryId: 'category-1', capitalProjectId: 'other-org-project' } as never,
        'user-1',
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects when the custodian is not a user in this organisation', async () => {
    const { service, userService } = makeService();
    userService.getById.mockResolvedValueOnce(null as never);
    await expect(
      service.create(
        ORG,
        { name: 'X', categoryId: 'category-1', custodianId: 'other-org-user' } as never,
        'user-1',
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('succeeds when every reference resolves', async () => {
    const { service } = makeService();
    await expect(
      service.create(ORG, { name: 'X', categoryId: 'category-1' } as never, 'user-1'),
    ).resolves.toBeDefined();
  });
});

describe('AssetService — hierarchy', () => {
  it('rejects an asset being assigned as its own parent on update', async () => {
    const { service } = makeService();
    await expect(
      service.update(ORG, 'asset-1', { parentAssetId: 'asset-1' } as never),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a parent asset that does not belong to this organisation', async () => {
    const { service, assetRepository } = makeService();
    assetRepository.findById.mockImplementation(async (_org: string, id: string) =>
      id === 'asset-1' ? makeAsset() : null,
    );
    await expect(
      service.update(ORG, 'asset-1', { parentAssetId: 'other-org-asset' } as never),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('AssetService — lifecycle', () => {
  it('activate() moves DRAFT to ACTIVE', async () => {
    const { service } = makeService();
    const result = await service.activate(ORG, 'asset-1');
    expect(result.transitioned).toBe(true);
    expect(result.asset.status).toBe('ACTIVE');
  });

  it('commission() rejects a DRAFT asset (must be ACTIVE first)', async () => {
    const { service } = makeService();
    await expect(service.commission(ORG, 'asset-1')).rejects.toThrow(BadRequestException);
  });

  it('soft idempotency: activating an already-ACTIVE asset returns unchanged, no error', async () => {
    const { service, assetRepository } = makeService({ asset: makeAsset({ status: 'ACTIVE' }) });
    const result = await service.activate(ORG, 'asset-1');
    expect(result.transitioned).toBe(false);
    expect(assetRepository.setStatus).not.toHaveBeenCalled();
  });

  it('dispose() is reachable from IN_SERVICE', async () => {
    const { service } = makeService({ asset: makeAsset({ status: 'IN_SERVICE' }) });
    const result = await service.dispose(ORG, 'asset-1');
    expect(result.transitioned).toBe(true);
    expect(result.asset.status).toBe('DISPOSED');
  });

  it('hard-terminal: disposing an already-disposed asset throws, never silently succeeds', async () => {
    const { service } = makeService({ asset: makeAsset({ status: 'DISPOSED' }) });
    await expect(service.dispose(ORG, 'asset-1')).rejects.toThrow(BadRequestException);
  });

  it('hard-terminal: any transition attempt on a retired asset throws', async () => {
    const { service } = makeService({ asset: makeAsset({ status: 'RETIRED' }) });
    await expect(service.commission(ORG, 'asset-1')).rejects.toThrow(BadRequestException);
  });

  it('update() rejects modifying a disposed asset — its record is frozen', async () => {
    const { service } = makeService({ asset: makeAsset({ status: 'DISPOSED' }) });
    await expect(service.update(ORG, 'asset-1', { name: 'New Name' } as never)).rejects.toThrow(
      BadRequestException,
    );
  });
});

describe('AssetService — transfer', () => {
  it('rejects transferring a disposed asset', async () => {
    const { service } = makeService({ asset: makeAsset({ status: 'DISPOSED' }) });
    await expect(
      service.transfer(ORG, 'asset-1', { newLocationId: 'loc-2' } as never, 'user-1'),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a target location that does not belong to this organisation', async () => {
    const { service, assetLocationRepository } = makeService({
      asset: makeAsset({ status: 'ACTIVE' }),
    });
    assetLocationRepository.findById.mockResolvedValueOnce(null as never);
    await expect(
      service.transfer(ORG, 'asset-1', { newLocationId: 'other-org-loc' } as never, 'user-1'),
    ).rejects.toThrow(BadRequestException);
  });

  it('succeeds for a non-terminal asset with a valid target location', async () => {
    const { service } = makeService({ asset: makeAsset({ status: 'ACTIVE' }) });
    const result = await service.transfer(
      ORG,
      'asset-1',
      { newLocationId: 'loc-2' } as never,
      'user-1',
    );
    expect(result.asset.locationId).toBe('loc-2');
  });
});

describe('AssetService — tenant isolation', () => {
  it('throws NotFoundException for an asset in another organisation', async () => {
    const { service, assetRepository } = makeService();
    assetRepository.findById.mockResolvedValueOnce(null as never);
    await expect(service.getById('other-org', 'asset-1')).rejects.toThrow(NotFoundException);
  });
});
