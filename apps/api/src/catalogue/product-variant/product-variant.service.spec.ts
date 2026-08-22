import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  ProductFamily,
  ProductFamilyStatus,
  ProductVariant,
  ProductVariantStatus,
} from '@prisma/client';

import { ProductFamilyRepository } from '../product-family/product-family.repository';
import { ProductVariantRepository } from './product-variant.repository';
import { ProductVariantService } from './product-variant.service';

describe('ProductVariantService', () => {
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

  const variant: ProductVariant = {
    id: 'variant-1',
    organisationId: 'org-1',
    productFamilyId: 'family-1',
    code: 'VAR-000001',
    name: 'Sweet & Spicy — Ripe Plantain',
    description: null,
    status: ProductVariantStatus.ACTIVE,
    createdById: 'user-1',
    updatedById: 'user-1',
    createdAt: new Date('2026-08-15'),
    updatedAt: new Date('2026-08-15'),
  };

  function makeService() {
    const productVariantRepository = {
      create: jest.fn(),
      findById: jest.fn(),
      findManyByOrganisation: jest.fn(),
      existsByCode: jest.fn().mockResolvedValue(false),
      update: jest.fn(),
    } as unknown as jest.Mocked<ProductVariantRepository>;
    const productFamilyRepository = {
      findById: jest.fn(),
    } as unknown as jest.Mocked<ProductFamilyRepository>;

    const service = new ProductVariantService(productVariantRepository, productFamilyRepository);
    return { service, productVariantRepository, productFamilyRepository };
  }

  describe('create', () => {
    it('generates a code and always starts the variant as ACTIVE', async () => {
      const { service, productVariantRepository, productFamilyRepository } = makeService();
      productFamilyRepository.findById.mockResolvedValue(family);
      productVariantRepository.create.mockResolvedValue(variant);

      await service.create(
        'org-1',
        { productFamilyId: 'family-1', name: 'Sweet & Spicy — Ripe Plantain' },
        'user-1',
      );

      expect(productVariantRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'VAR-000001', status: ProductVariantStatus.ACTIVE }),
      );
    });

    it('rejects a productFamilyId that does not exist in this organisation', async () => {
      const { service, productFamilyRepository } = makeService();
      productFamilyRepository.findById.mockResolvedValue(null);

      await expect(
        service.create('org-1', { productFamilyId: 'missing', name: 'x' }, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a productFamilyId belonging to another organisation', async () => {
      const { service, productFamilyRepository } = makeService();
      // A cross-tenant lookup always resolves null — the repository itself is
      // tenant-scoped, so this is indistinguishable from "doesn't exist."
      productFamilyRepository.findById.mockResolvedValue(null);

      await expect(
        service.create('org-2', { productFamilyId: 'family-1', name: 'x' }, 'user-1'),
      ).rejects.toThrow(BadRequestException);
      expect(productFamilyRepository.findById).toHaveBeenCalledWith('org-2', 'family-1');
    });
  });

  describe('update', () => {
    it('throws NotFoundException when the variant does not exist in this organisation', async () => {
      const { service, productVariantRepository } = makeService();
      productVariantRepository.findById.mockResolvedValue(null);

      await expect(service.update('org-1', 'missing', { name: 'x' }, 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('updates name/description without touching productFamilyId', async () => {
      const { service, productVariantRepository } = makeService();
      productVariantRepository.findById.mockResolvedValue(variant);
      productVariantRepository.update.mockResolvedValue({ ...variant, name: 'Updated' });

      await service.update('org-1', 'variant-1', { name: 'Updated' }, 'user-1');

      expect(productVariantRepository.update).toHaveBeenCalledWith(
        'org-1',
        'variant-1',
        expect.objectContaining({ name: 'Updated' }),
      );
      expect(productVariantRepository.update.mock.calls[0]?.[2]).not.toHaveProperty(
        'productFamilyId',
      );
    });

    it('rejects a no-op status transition', async () => {
      const { service, productVariantRepository } = makeService();
      productVariantRepository.findById.mockResolvedValue(variant);

      await expect(
        service.update('org-1', 'variant-1', { status: ProductVariantStatus.ACTIVE }, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('list', () => {
    it('filters by productFamilyId', async () => {
      const { service, productVariantRepository } = makeService();
      productVariantRepository.findManyByOrganisation.mockResolvedValue([variant]);

      await service.list('org-1', { productFamilyId: 'family-1' });

      expect(productVariantRepository.findManyByOrganisation).toHaveBeenCalledWith('org-1', {
        productFamilyId: 'family-1',
      });
    });
  });
});
