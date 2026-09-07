import { BadRequestException, NotFoundException } from '@nestjs/common';

import { AssetCategoryService } from './asset-category.service';

const ORG = 'org-1';

function makeCategory(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'cat-1',
    organisationId: ORG,
    code: 'PROD',
    name: 'Production Machinery',
    parentCategoryId: null,
    ...overrides,
  };
}

function makeService(category = makeCategory()) {
  const assetCategoryRepository = {
    findById: jest.fn(async (_org: string, id: string) => (id === category.id ? category : null)),
    getParentId: jest.fn(async () => null),
    create: jest.fn(async () => ({ assetCategory: category, wasCreated: true })),
    update: jest.fn(async (_org: string, _id: string, data: Record<string, unknown>) => ({
      ...category,
      ...data,
    })),
  };
  const service = new AssetCategoryService(assetCategoryRepository as never);
  return { service, assetCategoryRepository, category };
}

describe('AssetCategoryService', () => {
  it('rejects a parent category that does not belong to this organisation', async () => {
    const { service, assetCategoryRepository } = makeService();
    assetCategoryRepository.findById.mockImplementation(async (_org: string, id: string) =>
      id === 'cat-1' ? makeCategory() : null,
    );
    await expect(
      service.create(
        ORG,
        { code: 'X', name: 'X', parentCategoryId: 'other-org-cat' } as never,
        'user-1',
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a category being assigned as its own parent on update', async () => {
    const { service } = makeService();
    await expect(
      service.update(ORG, 'cat-1', { parentCategoryId: 'cat-1' } as never),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws NotFoundException for a category in another organisation', async () => {
    const { service, assetCategoryRepository } = makeService();
    assetCategoryRepository.findById.mockResolvedValueOnce(null as never);
    await expect(service.getById('other-org', 'cat-1')).rejects.toThrow(NotFoundException);
  });
});
