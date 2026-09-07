import { BadRequestException, NotFoundException } from '@nestjs/common';

import { AssetLocationService } from './asset-location.service';

const ORG = 'org-1';

function makeLocation(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'loc-1',
    organisationId: ORG,
    name: 'Ibadan Factory',
    parentLocationId: null,
    ...overrides,
  };
}

function makeService(location = makeLocation()) {
  const assetLocationRepository = {
    findById: jest.fn(async (_org: string, id: string) => (id === location.id ? location : null)),
    getParentId: jest.fn(async () => null),
    create: jest.fn(async () => ({ assetLocation: location, wasCreated: true })),
    update: jest.fn(async (_org: string, _id: string, data: Record<string, unknown>) => ({
      ...location,
      ...data,
    })),
  };
  const service = new AssetLocationService(assetLocationRepository as never);
  return { service, assetLocationRepository, location };
}

describe('AssetLocationService', () => {
  it('rejects a parent location that does not belong to this organisation', async () => {
    const { service, assetLocationRepository } = makeService();
    assetLocationRepository.findById.mockImplementation(async (_org: string, id: string) =>
      id === 'loc-1' ? makeLocation() : null,
    );
    await expect(
      service.create(ORG, { name: 'X', parentLocationId: 'other-org-loc' } as never, 'user-1'),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a location being assigned as its own parent on update', async () => {
    const { service } = makeService();
    await expect(
      service.update(ORG, 'loc-1', { parentLocationId: 'loc-1' } as never),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws NotFoundException for a location in another organisation', async () => {
    const { service, assetLocationRepository } = makeService();
    assetLocationRepository.findById.mockResolvedValueOnce(null as never);
    await expect(service.getById('other-org', 'loc-1')).rejects.toThrow(NotFoundException);
  });
});
