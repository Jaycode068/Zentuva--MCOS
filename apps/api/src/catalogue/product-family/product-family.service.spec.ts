import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ProductFamily, ProductFamilyStatus } from '@prisma/client';

import { ProductFamilyRepository } from './product-family.repository';
import { ProductFamilyService } from './product-family.service';

describe('ProductFamilyService', () => {
  const family: ProductFamily = {
    id: 'family-1',
    organisationId: 'org-1',
    code: 'FAM-000001',
    name: 'Plantain Chips',
    description: null,
    status: ProductFamilyStatus.ACTIVE,
    createdById: 'user-1',
    updatedById: 'user-1',
    createdAt: new Date('2026-08-15'),
    updatedAt: new Date('2026-08-15'),
  };

  function makeService() {
    const productFamilyRepository = {
      create: jest.fn(),
      findById: jest.fn(),
      findManyByOrganisation: jest.fn(),
      existsByCode: jest.fn().mockResolvedValue(false),
      update: jest.fn(),
    } as unknown as jest.Mocked<ProductFamilyRepository>;

    const service = new ProductFamilyService(productFamilyRepository);
    return { service, productFamilyRepository };
  }

  describe('create', () => {
    it('generates a code and always starts the family as ACTIVE', async () => {
      const { service, productFamilyRepository } = makeService();
      productFamilyRepository.create.mockResolvedValue(family);

      await service.create('org-1', { name: 'Plantain Chips' }, 'user-1');

      expect(productFamilyRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'FAM-000001', status: ProductFamilyStatus.ACTIVE }),
      );
    });

    it('increments the code sequence on collision', async () => {
      const { service, productFamilyRepository } = makeService();
      productFamilyRepository.existsByCode.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
      productFamilyRepository.create.mockResolvedValue(family);

      await service.create('org-1', { name: 'Plantain Chips' }, 'user-1');

      expect(productFamilyRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'FAM-000002' }),
      );
    });
  });

  describe('update', () => {
    it('throws NotFoundException when the family does not exist in this organisation', async () => {
      const { service, productFamilyRepository } = makeService();
      productFamilyRepository.findById.mockResolvedValue(null);

      await expect(service.update('org-1', 'missing', { name: 'x' }, 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('updates name/description', async () => {
      const { service, productFamilyRepository } = makeService();
      productFamilyRepository.findById.mockResolvedValue(family);
      productFamilyRepository.update.mockResolvedValue({ ...family, name: 'Updated' });

      await service.update('org-1', 'family-1', { name: 'Updated' }, 'user-1');

      expect(productFamilyRepository.update).toHaveBeenCalledWith(
        'org-1',
        'family-1',
        expect.objectContaining({ name: 'Updated', updatedById: 'user-1' }),
      );
    });

    it('transitions ACTIVE to INACTIVE', async () => {
      const { service, productFamilyRepository } = makeService();
      productFamilyRepository.findById.mockResolvedValue(family);
      productFamilyRepository.update.mockResolvedValue({
        ...family,
        status: ProductFamilyStatus.INACTIVE,
      });

      const result = await service.update(
        'org-1',
        'family-1',
        { status: ProductFamilyStatus.INACTIVE },
        'user-1',
      );

      expect(result.status).toBe(ProductFamilyStatus.INACTIVE);
    });

    it('rejects a no-op status transition', async () => {
      const { service, productFamilyRepository } = makeService();
      productFamilyRepository.findById.mockResolvedValue(family);

      await expect(
        service.update('org-1', 'family-1', { status: ProductFamilyStatus.ACTIVE }, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('tenant isolation', () => {
    it('getById throws nothing but returns null for a family belonging to another organisation', async () => {
      const { service, productFamilyRepository } = makeService();
      productFamilyRepository.findById.mockResolvedValue(null);

      const result = await service.getById('org-2', 'family-1');

      expect(result).toBeNull();
      expect(productFamilyRepository.findById).toHaveBeenCalledWith('org-2', 'family-1');
    });
  });
});
