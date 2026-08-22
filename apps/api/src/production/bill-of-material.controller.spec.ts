import { BillOfMaterialStatus, ProductType } from '@prisma/client';
import { Request } from 'express';

import { AuditService } from '../identity/audit/audit.service';
import { TokenPayload } from '../identity/auth/ports/token.port';
import { BillOfMaterialWithRelations } from './bill-of-material.repository';
import { BillOfMaterialController } from './bill-of-material.controller';
import { BillOfMaterialService } from './bill-of-material.service';
import { PRODUCTION_AUDIT_ACTIONS } from './production-audit-actions';

describe('BillOfMaterialController', () => {
  const tokenUser: TokenPayload = {
    sub: 'user-1',
    organisationId: 'org-1',
    sessionId: 'session-1',
  };

  const bom: BillOfMaterialWithRelations = {
    id: 'bom-1',
    organisationId: 'org-1',
    bomNumber: 'BOM-000001',
    productId: 'product-finished',
    name: 'Plantain Chips v1',
    status: BillOfMaterialStatus.DRAFT,
    yieldQuantity: 1000,
    notes: null,
    createdById: 'user-1',
    updatedById: 'user-1',
    createdAt: new Date('2026-08-01'),
    updatedAt: new Date('2026-08-01'),
    product: {
      id: 'product-finished',
      code: 'PRD-000001',
      name: 'Plantain Chips',
      type: ProductType.FINISHED_PRODUCT,
      unit: 'Pack',
    },
    items: [
      {
        id: 'item-1',
        componentProductId: 'product-raw',
        quantity: 500,
        unitOfMeasure: 'Kilogram',
        notes: null,
        componentProduct: {
          id: 'product-raw',
          code: 'PRD-000002',
          name: 'Plantain',
          type: ProductType.RAW_MATERIAL,
          unit: 'Kilogram',
        },
      },
    ],
  };

  function makeController() {
    const billOfMaterialService = {
      list: jest.fn(),
      getById: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      activate: jest.fn(),
      deactivate: jest.fn(),
    } as unknown as jest.Mocked<BillOfMaterialService>;
    const auditService = { record: jest.fn() } as unknown as jest.Mocked<AuditService>;

    const controller = new BillOfMaterialController(billOfMaterialService, auditService);
    return { controller, billOfMaterialService, auditService };
  }

  const req = { ip: '127.0.0.1', headers: { 'user-agent': 'jest' } } as unknown as Request;

  describe('list', () => {
    it('passes the trimmed search query and filters through', async () => {
      const { controller, billOfMaterialService } = makeController();
      billOfMaterialService.list.mockResolvedValue([bom]);

      const result = await controller.list(tokenUser, 'product-finished', 'DRAFT', '  chips  ');

      expect(billOfMaterialService.list).toHaveBeenCalledWith('org-1', {
        productId: 'product-finished',
        status: 'DRAFT',
        search: 'chips',
      });
      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.bomNumber).toBe('BOM-000001');
    });
  });

  describe('create', () => {
    it('creates the bom and records an audit entry', async () => {
      const { controller, billOfMaterialService, auditService } = makeController();
      billOfMaterialService.create.mockResolvedValue(bom);

      const result = await controller.create(
        {
          productId: 'product-finished',
          yieldQuantity: 1000,
          items: [{ componentProductId: 'product-raw', quantity: 500, unitOfMeasure: 'Kilogram' }],
        },
        tokenUser,
        req,
      );

      expect(billOfMaterialService.create).toHaveBeenCalledWith(
        'org-1',
        expect.objectContaining({ productId: 'product-finished' }),
        'user-1',
      );
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: PRODUCTION_AUDIT_ACTIONS.BOM_CREATED,
          entityId: 'bom-1',
        }),
      );
      expect(result.bomNumber).toBe('BOM-000001');
    });
  });

  describe('activate', () => {
    it('activates the bom and records an audit entry', async () => {
      const { controller, billOfMaterialService, auditService } = makeController();
      billOfMaterialService.activate.mockResolvedValue({
        ...bom,
        status: BillOfMaterialStatus.ACTIVE,
      });

      const result = await controller.activate('bom-1', tokenUser, req);

      expect(billOfMaterialService.activate).toHaveBeenCalledWith('org-1', 'bom-1', 'user-1');
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: PRODUCTION_AUDIT_ACTIONS.BOM_ACTIVATED }),
      );
      expect(result.status).toBe(BillOfMaterialStatus.ACTIVE);
    });
  });

  describe('deactivate', () => {
    it('deactivates the bom and records an audit entry', async () => {
      const { controller, billOfMaterialService, auditService } = makeController();
      billOfMaterialService.deactivate.mockResolvedValue({
        ...bom,
        status: BillOfMaterialStatus.INACTIVE,
      });

      const result = await controller.deactivate('bom-1', tokenUser, req);

      expect(billOfMaterialService.deactivate).toHaveBeenCalledWith('org-1', 'bom-1', 'user-1');
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: PRODUCTION_AUDIT_ACTIONS.BOM_DEACTIVATED }),
      );
      expect(result.status).toBe(BillOfMaterialStatus.INACTIVE);
    });
  });
});
