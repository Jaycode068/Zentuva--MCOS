import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Product, ProductCategory, ProductStatus, ProductType } from '@prisma/client';

import { FileStorage } from '../../identity/organisation/ports/file-storage.port';
import { ProductVariantRepository } from '../product-variant/product-variant.repository';
import { ProductRepository } from './product.repository';
import { ProductService } from './product.service';

describe('ProductService', () => {
  const product: Product = {
    id: 'product-1',
    organisationId: 'org-1',
    code: 'PRD-000001',
    name: 'Plantain Chips',
    displayName: null,
    slug: 'plantain-chips',
    category: ProductCategory.SNACKS,
    type: ProductType.FINISHED_PRODUCT,
    shortDescription: null,
    longDescription: null,
    unit: 'Pack',
    imageUrl: null,
    imageKey: null,
    status: ProductStatus.DRAFT,
    createdById: 'user-1',
    updatedById: 'user-1',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    productVariantId: null,
  };

  function makeService() {
    const productRepository = {
      create: jest.fn(),
      findById: jest.fn(),
      findManyByOrganisation: jest.fn(),
      findByIdWithHierarchy: jest.fn(),
      findManyByOrganisationWithHierarchy: jest.fn(),
      existsByCode: jest.fn().mockResolvedValue(false),
      existsBySlug: jest.fn().mockResolvedValue(false),
      update: jest.fn(),
    } as unknown as jest.Mocked<ProductRepository>;
    const productVariantRepository = {
      findById: jest.fn(),
    } as unknown as jest.Mocked<ProductVariantRepository>;
    const fileStorage = {
      upload: jest.fn(),
      delete: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<FileStorage>;
    const service = new ProductService(productRepository, productVariantRepository, fileStorage);
    return { service, productRepository, productVariantRepository, fileStorage };
  }

  describe('create', () => {
    it('generates a code and slug, and always starts the product as DRAFT', async () => {
      const { service, productRepository } = makeService();
      productRepository.create.mockResolvedValue(product);

      await service.create(
        'org-1',
        {
          name: 'Plantain Chips',
          category: 'SNACKS',
          type: 'FINISHED_PRODUCT',
          unit: 'Pack',
        },
        'user-1',
      );

      expect(productRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'PRD-000001',
          slug: 'plantain-chips',
          status: ProductStatus.DRAFT,
          createdById: 'user-1',
          updatedById: 'user-1',
        }),
      );
    });

    it('increments the code sequence on collision', async () => {
      const { service, productRepository } = makeService();
      productRepository.existsByCode
        .mockResolvedValueOnce(true) // PRD-000001 taken
        .mockResolvedValueOnce(false); // PRD-000002 free
      productRepository.create.mockResolvedValue(product);

      await service.create(
        'org-1',
        { name: 'Plantain Chips', category: 'SNACKS', type: 'FINISHED_PRODUCT', unit: 'Pack' },
        'user-1',
      );

      expect(productRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'PRD-000002' }),
      );
    });

    it('appends a numeric suffix to the slug on collision within the organisation', async () => {
      const { service, productRepository } = makeService();
      productRepository.existsBySlug
        .mockResolvedValueOnce(true) // "plantain-chips" taken
        .mockResolvedValueOnce(false); // "plantain-chips-2" free
      productRepository.create.mockResolvedValue(product);

      await service.create(
        'org-1',
        { name: 'Plantain Chips', category: 'SNACKS', type: 'FINISHED_PRODUCT', unit: 'Pack' },
        'user-1',
      );

      expect(productRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ slug: 'plantain-chips-2' }),
      );
    });

    it('attaches a valid productVariantId (Sprint 4.7)', async () => {
      const { service, productRepository, productVariantRepository } = makeService();
      productVariantRepository.findById.mockResolvedValue({ id: 'variant-1' } as never);
      productRepository.create.mockResolvedValue(product);

      await service.create(
        'org-1',
        {
          name: 'Plantain Chips',
          category: 'SNACKS',
          type: 'FINISHED_PRODUCT',
          unit: 'Pack',
          productVariantId: 'variant-1',
        },
        'user-1',
      );

      expect(productVariantRepository.findById).toHaveBeenCalledWith('org-1', 'variant-1');
      expect(productRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ productVariant: { connect: { id: 'variant-1' } } }),
      );
    });

    it('rejects a productVariantId that does not exist in this organisation (Sprint 4.7)', async () => {
      const { service, productVariantRepository } = makeService();
      productVariantRepository.findById.mockResolvedValue(null);

      await expect(
        service.create(
          'org-1',
          {
            name: 'Plantain Chips',
            category: 'SNACKS',
            type: 'FINISHED_PRODUCT',
            unit: 'Pack',
            productVariantId: 'missing',
          },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('omitting productVariantId never touches ProductVariantRepository (regression)', async () => {
      const { service, productRepository, productVariantRepository } = makeService();
      productRepository.create.mockResolvedValue(product);

      await service.create(
        'org-1',
        { name: 'Plantain Chips', category: 'SNACKS', type: 'FINISHED_PRODUCT', unit: 'Pack' },
        'user-1',
      );

      expect(productVariantRepository.findById).not.toHaveBeenCalled();
      expect(productRepository.create.mock.calls[0]?.[0]).not.toHaveProperty('productVariant');
    });
  });

  describe('update', () => {
    it('throws NotFoundException when the product does not exist in this organisation', async () => {
      const { service, productRepository } = makeService();
      productRepository.findById.mockResolvedValue(null);

      await expect(service.update('org-1', 'missing', { name: 'X' }, 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('passes the partial update through, stamping updatedById', async () => {
      const { service, productRepository } = makeService();
      productRepository.findById.mockResolvedValue(product);
      productRepository.update.mockResolvedValue({ ...product, name: 'Plantain Chips XL' });

      await service.update('org-1', 'product-1', { name: 'Plantain Chips XL' }, 'user-2');

      expect(productRepository.update).toHaveBeenCalledWith('org-1', 'product-1', {
        name: 'Plantain Chips XL',
        displayName: undefined,
        category: undefined,
        type: undefined,
        unit: undefined,
        shortDescription: undefined,
        longDescription: undefined,
        updatedById: 'user-2',
      });
    });
  });

  describe('activate', () => {
    it('transitions DRAFT to ACTIVE', async () => {
      const { service, productRepository } = makeService();
      productRepository.findById.mockResolvedValue(product);
      productRepository.update.mockResolvedValue({ ...product, status: ProductStatus.ACTIVE });

      await service.activate('org-1', 'product-1', 'user-2');

      expect(productRepository.update).toHaveBeenCalledWith('org-1', 'product-1', {
        status: ProductStatus.ACTIVE,
        updatedById: 'user-2',
      });
    });

    it('transitions ARCHIVED back to ACTIVE', async () => {
      const { service, productRepository } = makeService();
      productRepository.findById.mockResolvedValue({ ...product, status: ProductStatus.ARCHIVED });
      productRepository.update.mockResolvedValue({ ...product, status: ProductStatus.ACTIVE });

      await expect(service.activate('org-1', 'product-1', 'user-2')).resolves.toBeDefined();
    });

    it('rejects activating an already-active product', async () => {
      const { service, productRepository } = makeService();
      productRepository.findById.mockResolvedValue({ ...product, status: ProductStatus.ACTIVE });

      await expect(service.activate('org-1', 'product-1', 'user-2')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('archive', () => {
    it('transitions ACTIVE to ARCHIVED', async () => {
      const { service, productRepository } = makeService();
      productRepository.findById.mockResolvedValue({ ...product, status: ProductStatus.ACTIVE });
      productRepository.update.mockResolvedValue({ ...product, status: ProductStatus.ARCHIVED });

      await service.archive('org-1', 'product-1', 'user-2');

      expect(productRepository.update).toHaveBeenCalledWith('org-1', 'product-1', {
        status: ProductStatus.ARCHIVED,
        updatedById: 'user-2',
      });
    });

    it('rejects archiving an already-archived product', async () => {
      const { service, productRepository } = makeService();
      productRepository.findById.mockResolvedValue({ ...product, status: ProductStatus.ARCHIVED });

      await expect(service.archive('org-1', 'product-1', 'user-2')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('setImage', () => {
    it('uploads the file and stores the URL/key', async () => {
      const { service, productRepository, fileStorage } = makeService();
      productRepository.findById.mockResolvedValue(product);
      fileStorage.upload.mockResolvedValue({
        url: 'https://cdn.test/products/new.png',
        key: 'products/org-1/new.png',
      });
      productRepository.update.mockResolvedValue({
        ...product,
        imageUrl: 'https://cdn.test/products/new.png',
        imageKey: 'products/org-1/new.png',
      });

      await service.setImage(
        'org-1',
        'product-1',
        { mimeType: 'image/png', buffer: Buffer.from('x') },
        'user-1',
      );

      expect(fileStorage.upload).toHaveBeenCalledWith({
        organisationId: 'org-1',
        folder: 'products',
        mimeType: 'image/png',
        buffer: Buffer.from('x'),
      });
      expect(productRepository.update).toHaveBeenCalledWith('org-1', 'product-1', {
        imageUrl: 'https://cdn.test/products/new.png',
        imageKey: 'products/org-1/new.png',
        updatedById: 'user-1',
      });
    });

    it('deletes the previous image after a successful replacement', async () => {
      const { service, productRepository, fileStorage } = makeService();
      productRepository.findById.mockResolvedValue({
        ...product,
        imageUrl: 'https://cdn.test/products/old.png',
        imageKey: 'products/org-1/old.png',
      });
      fileStorage.upload.mockResolvedValue({
        url: 'https://cdn.test/products/new.png',
        key: 'products/org-1/new.png',
      });
      productRepository.update.mockResolvedValue(product);

      await service.setImage(
        'org-1',
        'product-1',
        { mimeType: 'image/png', buffer: Buffer.from('x') },
        'user-1',
      );

      expect(fileStorage.delete).toHaveBeenCalledWith('products/org-1/old.png');
    });
  });

  describe('removeImage', () => {
    it('clears the URL/key and deletes the file', async () => {
      const { service, productRepository, fileStorage } = makeService();
      productRepository.findById.mockResolvedValue({
        ...product,
        imageUrl: 'https://cdn.test/products/old.png',
        imageKey: 'products/org-1/old.png',
      });
      productRepository.update.mockResolvedValue(product);

      await service.removeImage('org-1', 'product-1', 'user-1');

      expect(productRepository.update).toHaveBeenCalledWith('org-1', 'product-1', {
        imageUrl: null,
        imageKey: null,
        updatedById: 'user-1',
      });
      expect(fileStorage.delete).toHaveBeenCalledWith('products/org-1/old.png');
    });

    it('is a no-op delete when no image was ever uploaded', async () => {
      const { service, productRepository, fileStorage } = makeService();
      productRepository.findById.mockResolvedValue(product);
      productRepository.update.mockResolvedValue(product);

      await service.removeImage('org-1', 'product-1', 'user-1');

      expect(fileStorage.delete).not.toHaveBeenCalled();
    });
  });

  describe('getById / list — hierarchy context (Sprint 4.7)', () => {
    it('getById delegates to findByIdWithHierarchy, not the plain findById', async () => {
      const { service, productRepository } = makeService();
      const withHierarchy = { ...product, productVariant: null };
      productRepository.findByIdWithHierarchy.mockResolvedValue(withHierarchy);

      const result = await service.getById('org-1', 'product-1');

      expect(productRepository.findByIdWithHierarchy).toHaveBeenCalledWith('org-1', 'product-1');
      expect(productRepository.findById).not.toHaveBeenCalled();
      expect(result?.productVariant).toBeNull();
    });

    it('list delegates to findManyByOrganisationWithHierarchy', async () => {
      const { service, productRepository } = makeService();
      productRepository.findManyByOrganisationWithHierarchy.mockResolvedValue([
        { ...product, productVariant: null },
      ]);

      const result = await service.list('org-1');

      expect(productRepository.findManyByOrganisationWithHierarchy).toHaveBeenCalledWith(
        'org-1',
        undefined,
      );
      expect(result).toHaveLength(1);
    });
  });
});
