import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Territory, TerritoryStatus } from '@prisma/client';

import { TerritoryRepository } from './territory.repository';
import { TerritoryService } from './territory.service';

describe('TerritoryService', () => {
  const territory: Territory = {
    id: 'territory-1',
    organisationId: 'org-1',
    territoryCode: 'TER-000001',
    name: 'Oyo State',
    type: 'State',
    parentTerritoryId: null,
    status: TerritoryStatus.ACTIVE,
    description: null,
    createdById: 'user-1',
    updatedById: 'user-1',
    createdAt: new Date('2026-08-21'),
    updatedAt: new Date('2026-08-21'),
  };

  function makeService() {
    const territoryRepository = {
      create: jest.fn(),
      findById: jest.fn(),
      findManyByOrganisation: jest.fn(),
      existsByCode: jest.fn().mockResolvedValue(false),
      update: jest.fn(),
    } as unknown as jest.Mocked<TerritoryRepository>;

    const service = new TerritoryService(territoryRepository);
    return { service, territoryRepository };
  }

  describe('create', () => {
    it('generates a code and always starts the territory as ACTIVE', async () => {
      const { service, territoryRepository } = makeService();
      territoryRepository.create.mockResolvedValue(territory);

      await service.create('org-1', { name: 'Oyo State', type: 'State' }, 'user-1');

      expect(territoryRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ territoryCode: 'TER-000001', status: TerritoryStatus.ACTIVE }),
      );
    });

    it('increments the code sequence on collision', async () => {
      const { service, territoryRepository } = makeService();
      territoryRepository.existsByCode.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
      territoryRepository.create.mockResolvedValue(territory);

      await service.create('org-1', { name: 'Oyo State', type: 'State' }, 'user-1');

      expect(territoryRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ territoryCode: 'TER-000002' }),
      );
    });

    it('rejects a parent territory that does not exist in this organisation', async () => {
      const { service, territoryRepository } = makeService();
      territoryRepository.findById.mockResolvedValue(null);

      await expect(
        service.create(
          'org-1',
          { name: 'Ibadan', type: 'City', parentTerritoryId: 'missing' },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('update', () => {
    it('throws NotFoundException when the territory does not exist in this organisation', async () => {
      const { service, territoryRepository } = makeService();
      territoryRepository.findById.mockResolvedValue(null);

      await expect(service.update('org-1', 'missing', { name: 'x' }, 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('rejects a territory becoming its own parent', async () => {
      const { service, territoryRepository } = makeService();
      territoryRepository.findById.mockResolvedValueOnce(territory);

      await expect(
        service.update('org-1', 'territory-1', { parentTerritoryId: 'territory-1' }, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects re-parenting a territory to one of its own descendants (cycle)', async () => {
      const { service, territoryRepository } = makeService();
      const child: Territory = {
        ...territory,
        id: 'territory-2',
        parentTerritoryId: 'territory-1',
      };
      const grandchild: Territory = {
        ...territory,
        id: 'territory-3',
        parentTerritoryId: 'territory-2',
      };

      // Attempting: territory-1's new parent = territory-3 (its own grandchild).
      territoryRepository.findById
        .mockResolvedValueOnce(territory) // getByIdOrThrow(territory-1)
        .mockResolvedValueOnce(grandchild) // assertParentExists(territory-3)
        .mockResolvedValueOnce(grandchild) // assertNoCycle walk: current = territory-3
        .mockResolvedValueOnce(child); // assertNoCycle walk: current = territory-2

      await expect(
        service.update('org-1', 'territory-1', { parentTerritoryId: 'territory-3' }, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('allows re-parenting to an unrelated territory', async () => {
      const { service, territoryRepository } = makeService();
      const otherRoot: Territory = { ...territory, id: 'territory-9', parentTerritoryId: null };
      territoryRepository.findById
        .mockResolvedValueOnce(territory)
        .mockResolvedValueOnce(otherRoot)
        .mockResolvedValueOnce(otherRoot);
      territoryRepository.update.mockResolvedValue({
        ...territory,
        parentTerritoryId: 'territory-9',
      });

      const result = await service.update(
        'org-1',
        'territory-1',
        { parentTerritoryId: 'territory-9' },
        'user-1',
      );

      expect(result.parentTerritoryId).toBe('territory-9');
    });

    it('rejects a no-op status transition', async () => {
      const { service, territoryRepository } = makeService();
      territoryRepository.findById.mockResolvedValue(territory);

      await expect(
        service.update('org-1', 'territory-1', { status: TerritoryStatus.ACTIVE }, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('activate / deactivate', () => {
    it('rejects activating an already-active territory', async () => {
      const { service, territoryRepository } = makeService();
      territoryRepository.findById.mockResolvedValue(territory);

      await expect(service.activate('org-1', 'territory-1', 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('deactivates an active territory', async () => {
      const { service, territoryRepository } = makeService();
      territoryRepository.findById.mockResolvedValue(territory);
      territoryRepository.update.mockResolvedValue({
        ...territory,
        status: TerritoryStatus.INACTIVE,
      });

      const result = await service.deactivate('org-1', 'territory-1', 'user-1');

      expect(result.status).toBe(TerritoryStatus.INACTIVE);
    });
  });

  describe('tenant isolation', () => {
    it('getById returns null for a territory belonging to another organisation', async () => {
      const { service, territoryRepository } = makeService();
      territoryRepository.findById.mockResolvedValue(null);

      const result = await service.getById('org-2', 'territory-1');

      expect(result).toBeNull();
      expect(territoryRepository.findById).toHaveBeenCalledWith('org-2', 'territory-1');
    });
  });
});
