import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Product, ProductCategory, ProductStatus, ProductType } from '@prisma/client';
import { Request } from 'express';

import { AuditService } from '../../identity/audit/audit.service';
import { TokenPayload } from '../../identity/auth/ports/token.port';
import { PRODUCT_AUDIT_ACTIONS } from './product-audit-actions';
import { ProductController } from './product.controller';
import { ProductService } from './product.service';

describe('ProductController', () => {
  const tokenUser: TokenPayload = {
    sub: 'user-1',
    organisationId: 'org-1',
    sessionId: 'session-1',
  };

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

  /** `list`/`getOne` resolve to the hierarchy-enriched shape (Sprint 4.7) — every other
   *  method on `ProductService` still resolves to a plain `Product`. */
  const productWithHierarchy = { ...product, productVariant: null };

  function makeController() {
    const productService = {
      list: jest.fn(),
      getById: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      activate: jest.fn(),
      archive: jest.fn(),
      setImage: jest.fn(),
      removeImage: jest.fn(),
    } as unknown as jest.Mocked<ProductService>;
    const auditService = { record: jest.fn() } as unknown as jest.Mocked<AuditService>;
    const config = {
      get: jest.fn().mockReturnValue(2 * 1024 * 1024),
    } as unknown as ConfigService;

    const controller = new ProductController(productService, auditService, config);
    return { controller, productService, auditService };
  }

  const req = { ip: '127.0.0.1', headers: { 'user-agent': 'jest' } } as unknown as Request;

  describe('list', () => {
    it('passes the trimmed search query through', async () => {
      const { controller, productService } = makeController();
      productService.list.mockResolvedValue([productWithHierarchy]);

      const result = await controller.list(tokenUser, '  chips  ');

      expect(productService.list).toHaveBeenCalledWith('org-1', { search: 'chips' });
      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.code).toBe('PRD-000001');
      // Sprint 4.7 — read responses expose hierarchy context (null for a flat product).
      expect(result.items[0]).toHaveProperty('productVariantId', null);
      expect(result.items[0]).toHaveProperty('productVariant', null);
    });

    it('nests family context when the product has a variant (Sprint 4.7)', async () => {
      const { controller, productService } = makeController();
      productService.list.mockResolvedValue([
        {
          ...productWithHierarchy,
          productVariantId: 'variant-1',
          productVariant: {
            id: 'variant-1',
            organisationId: 'org-1',
            productFamilyId: 'family-1',
            code: 'VAR-000001',
            name: 'Sweet & Spicy — Ripe Plantain',
            description: null,
            status: 'ACTIVE',
            createdById: 'user-1',
            updatedById: 'user-1',
            createdAt: new Date('2026-08-15'),
            updatedAt: new Date('2026-08-15'),
            productFamily: {
              id: 'family-1',
              organisationId: 'org-1',
              code: 'FAM-000001',
              name: 'Plantain Chips',
              description: null,
              status: 'ACTIVE',
              createdById: 'user-1',
              updatedById: 'user-1',
              createdAt: new Date('2026-08-15'),
              updatedAt: new Date('2026-08-15'),
            },
          },
        } as never,
      ]);

      const result = await controller.list(tokenUser);

      expect(result.items[0]?.productVariant).toEqual(
        expect.objectContaining({
          id: 'variant-1',
          code: 'VAR-000001',
          name: 'Sweet & Spicy — Ripe Plantain',
          productFamily: expect.objectContaining({ id: 'family-1', code: 'FAM-000001' }),
        }),
      );
    });
  });

  describe('getOne', () => {
    it('throws NotFoundException for a missing product', async () => {
      const { controller, productService } = makeController();
      productService.getById.mockResolvedValue(null);

      await expect(controller.getOne(tokenUser, 'missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('creates the product and records an audit entry', async () => {
      const { controller, productService, auditService } = makeController();
      productService.create.mockResolvedValue(product);

      const result = await controller.create(
        { name: 'Plantain Chips', category: 'SNACKS', type: 'FINISHED_PRODUCT', unit: 'Pack' },
        tokenUser,
        req,
      );

      expect(productService.create).toHaveBeenCalledWith(
        'org-1',
        { name: 'Plantain Chips', category: 'SNACKS', type: 'FINISHED_PRODUCT', unit: 'Pack' },
        'user-1',
      );
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: PRODUCT_AUDIT_ACTIONS.CREATED, entityId: 'product-1' }),
      );
      expect(result.code).toBe('PRD-000001');
      // Sprint 4.7 regression — write endpoints keep returning the flat shape, never the
      // nested `productVariant` object `list`/`getOne` expose.
      expect(result).not.toHaveProperty('productVariant');
      expect(result).toHaveProperty('productVariantId', null);
    });
  });

  describe('update', () => {
    it('updates the product and records an audit entry', async () => {
      const { controller, productService, auditService } = makeController();
      productService.update.mockResolvedValue({ ...product, name: 'Updated' });

      await controller.update('product-1', { name: 'Updated' }, tokenUser, req);

      expect(productService.update).toHaveBeenCalledWith(
        'org-1',
        'product-1',
        { name: 'Updated' },
        'user-1',
      );
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: PRODUCT_AUDIT_ACTIONS.UPDATED }),
      );
    });
  });

  describe('activate', () => {
    it('activates the product and records an audit entry', async () => {
      const { controller, productService, auditService } = makeController();
      productService.activate.mockResolvedValue({ ...product, status: ProductStatus.ACTIVE });

      await controller.activate('product-1', tokenUser, req);

      expect(productService.activate).toHaveBeenCalledWith('org-1', 'product-1', 'user-1');
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: PRODUCT_AUDIT_ACTIONS.ACTIVATED }),
      );
    });
  });

  describe('archive', () => {
    it('archives the product and records an audit entry', async () => {
      const { controller, productService, auditService } = makeController();
      productService.archive.mockResolvedValue({ ...product, status: ProductStatus.ARCHIVED });

      await controller.archive('product-1', tokenUser, req);

      expect(productService.archive).toHaveBeenCalledWith('org-1', 'product-1', 'user-1');
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: PRODUCT_AUDIT_ACTIONS.ARCHIVED }),
      );
    });
  });

  describe('uploadImage', () => {
    it('throws BadRequestException when no file is attached', async () => {
      const { controller } = makeController();

      await expect(controller.uploadImage('product-1', undefined, tokenUser, req)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects an invalid mime type', async () => {
      const { controller } = makeController();
      const file = {
        mimetype: 'application/pdf',
        size: 100,
        buffer: Buffer.from('x'),
      } as unknown as Express.Multer.File;

      await expect(controller.uploadImage('product-1', file, tokenUser, req)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('uploads the image and records an audit entry', async () => {
      const { controller, productService, auditService } = makeController();
      const file = {
        mimetype: 'image/png',
        size: 100,
        buffer: Buffer.from('x'),
      } as unknown as Express.Multer.File;
      productService.setImage.mockResolvedValue({
        ...product,
        imageUrl: 'https://cdn.test/products/new.png',
      });

      const result = await controller.uploadImage('product-1', file, tokenUser, req);

      expect(productService.setImage).toHaveBeenCalledWith(
        'org-1',
        'product-1',
        { mimeType: 'image/png', buffer: file.buffer },
        'user-1',
      );
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: PRODUCT_AUDIT_ACTIONS.IMAGE_UPLOADED }),
      );
      expect(result.imageUrl).toBe('https://cdn.test/products/new.png');
    });
  });

  describe('deleteImage', () => {
    it('removes the image and records an audit entry', async () => {
      const { controller, productService, auditService } = makeController();
      productService.removeImage.mockResolvedValue(product);

      await controller.deleteImage('product-1', tokenUser, req);

      expect(productService.removeImage).toHaveBeenCalledWith('org-1', 'product-1', 'user-1');
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: PRODUCT_AUDIT_ACTIONS.IMAGE_REMOVED }),
      );
    });
  });
});
