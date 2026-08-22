import { NotFoundException } from '@nestjs/common';
import { ProductVariant, ProductVariantStatus } from '@prisma/client';
import { Request } from 'express';

import { AuditService } from '../../identity/audit/audit.service';
import { TokenPayload } from '../../identity/auth/ports/token.port';
import { PRODUCT_VARIANT_AUDIT_ACTIONS } from './product-variant-audit-actions';
import { ProductVariantController } from './product-variant.controller';
import { ProductVariantService } from './product-variant.service';

describe('ProductVariantController', () => {
  const tokenUser: TokenPayload = {
    sub: 'user-1',
    organisationId: 'org-1',
    sessionId: 'session-1',
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

  function makeController() {
    const productVariantService = {
      list: jest.fn(),
      getById: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    } as unknown as jest.Mocked<ProductVariantService>;
    const auditService = { record: jest.fn() } as unknown as jest.Mocked<AuditService>;

    const controller = new ProductVariantController(productVariantService, auditService);
    return { controller, productVariantService, auditService };
  }

  const req = { ip: '127.0.0.1', headers: { 'user-agent': 'jest' } } as unknown as Request;

  describe('list', () => {
    it('passes the productFamilyId filter through', async () => {
      const { controller, productVariantService } = makeController();
      productVariantService.list.mockResolvedValue([variant]);

      const result = await controller.list(tokenUser, 'family-1');

      expect(productVariantService.list).toHaveBeenCalledWith('org-1', {
        productFamilyId: 'family-1',
        search: undefined,
        status: undefined,
      });
      expect(result.items[0]?.code).toBe('VAR-000001');
    });
  });

  describe('getOne', () => {
    it('throws NotFoundException for a missing variant', async () => {
      const { controller, productVariantService } = makeController();
      productVariantService.getById.mockResolvedValue(null);

      await expect(controller.getOne(tokenUser, 'missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('creates the variant and records an audit entry', async () => {
      const { controller, productVariantService, auditService } = makeController();
      productVariantService.create.mockResolvedValue(variant);

      const result = await controller.create(
        { productFamilyId: 'family-1', name: 'Sweet & Spicy — Ripe Plantain' },
        tokenUser,
        req,
      );

      expect(productVariantService.create).toHaveBeenCalledWith(
        'org-1',
        expect.objectContaining({ productFamilyId: 'family-1' }),
        'user-1',
      );
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: PRODUCT_VARIANT_AUDIT_ACTIONS.CREATED,
          entityId: 'variant-1',
        }),
      );
      expect(result.code).toBe('VAR-000001');
    });
  });

  describe('update', () => {
    it('updates the variant and records an audit entry', async () => {
      const { controller, productVariantService, auditService } = makeController();
      productVariantService.update.mockResolvedValue({ ...variant, name: 'Updated' });

      await controller.update('variant-1', { name: 'Updated' }, tokenUser, req);

      expect(productVariantService.update).toHaveBeenCalledWith(
        'org-1',
        'variant-1',
        { name: 'Updated' },
        'user-1',
      );
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: PRODUCT_VARIANT_AUDIT_ACTIONS.UPDATED }),
      );
    });
  });
});
