import { NotFoundException } from '@nestjs/common';
import { ProductFamily, ProductFamilyStatus } from '@prisma/client';
import { Request } from 'express';

import { AuditService } from '../../identity/audit/audit.service';
import { TokenPayload } from '../../identity/auth/ports/token.port';
import { PRODUCT_FAMILY_AUDIT_ACTIONS } from './product-family-audit-actions';
import { ProductFamilyController } from './product-family.controller';
import { ProductFamilyService } from './product-family.service';

describe('ProductFamilyController', () => {
  const tokenUser: TokenPayload = {
    sub: 'user-1',
    organisationId: 'org-1',
    sessionId: 'session-1',
  };

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

  function makeController() {
    const productFamilyService = {
      list: jest.fn(),
      getById: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    } as unknown as jest.Mocked<ProductFamilyService>;
    const auditService = { record: jest.fn() } as unknown as jest.Mocked<AuditService>;

    const controller = new ProductFamilyController(productFamilyService, auditService);
    return { controller, productFamilyService, auditService };
  }

  const req = { ip: '127.0.0.1', headers: { 'user-agent': 'jest' } } as unknown as Request;

  describe('list', () => {
    it('passes the trimmed search query and status filter through', async () => {
      const { controller, productFamilyService } = makeController();
      productFamilyService.list.mockResolvedValue([family]);

      const result = await controller.list(tokenUser, '  chips  ', 'ACTIVE');

      expect(productFamilyService.list).toHaveBeenCalledWith('org-1', {
        search: 'chips',
        status: 'ACTIVE',
      });
      expect(result.items[0]?.code).toBe('FAM-000001');
    });
  });

  describe('getOne', () => {
    it('throws NotFoundException for a missing family', async () => {
      const { controller, productFamilyService } = makeController();
      productFamilyService.getById.mockResolvedValue(null);

      await expect(controller.getOne(tokenUser, 'missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('creates the family and records an audit entry (Owner/Administrator only, RolesGuard enforced at the route level)', async () => {
      const { controller, productFamilyService, auditService } = makeController();
      productFamilyService.create.mockResolvedValue(family);

      const result = await controller.create({ name: 'Plantain Chips' }, tokenUser, req);

      expect(productFamilyService.create).toHaveBeenCalledWith(
        'org-1',
        expect.objectContaining({ name: 'Plantain Chips' }),
        'user-1',
      );
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: PRODUCT_FAMILY_AUDIT_ACTIONS.CREATED,
          entityId: 'family-1',
        }),
      );
      expect(result.code).toBe('FAM-000001');
    });
  });

  describe('update', () => {
    it('updates the family and records an audit entry', async () => {
      const { controller, productFamilyService, auditService } = makeController();
      productFamilyService.update.mockResolvedValue({ ...family, name: 'Updated' });

      await controller.update('family-1', { name: 'Updated' }, tokenUser, req);

      expect(productFamilyService.update).toHaveBeenCalledWith(
        'org-1',
        'family-1',
        { name: 'Updated' },
        'user-1',
      );
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: PRODUCT_FAMILY_AUDIT_ACTIONS.UPDATED }),
      );
    });
  });
});
