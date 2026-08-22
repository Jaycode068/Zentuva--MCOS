import { ProductionOrderStatus } from '@prisma/client';
import { Request } from 'express';

import { AuditService } from '../identity/audit/audit.service';
import { TokenPayload } from '../identity/auth/ports/token.port';
import { ProductionMaterialIssueWithItems } from './production-material-issue.repository';
import { ProductionOrderWithRelations } from './production-order.repository';
import { ProductionOrderController } from './production-order.controller';
import { ProductionOrderService } from './production-order.service';
import { PRODUCTION_AUDIT_ACTIONS } from './production-audit-actions';

describe('ProductionOrderController', () => {
  const tokenUser: TokenPayload = {
    sub: 'user-1',
    organisationId: 'org-1',
    sessionId: 'session-1',
  };

  const order: ProductionOrderWithRelations = {
    id: 'order-1',
    organisationId: 'org-1',
    productionOrderNumber: 'PROD-000001',
    productId: 'product-finished',
    billOfMaterialId: 'bom-1',
    plannedQuantity: 500,
    locationId: 'location-1',
    status: ProductionOrderStatus.DRAFT,
    notes: null,
    createdById: 'user-1',
    updatedById: 'user-1',
    createdAt: new Date('2026-08-01'),
    updatedAt: new Date('2026-08-01'),
    product: { id: 'product-finished', code: 'PRD-000001', name: 'Plantain Chips', unit: 'Pack' },
    billOfMaterial: { id: 'bom-1', bomNumber: 'BOM-000001' },
    location: { id: 'location-1', name: 'Main Warehouse' },
    items: [
      {
        id: 'poi-1',
        componentProductId: 'product-raw',
        requiredQuantity: 250,
        unitOfMeasure: 'Kilogram',
        componentProduct: {
          id: 'product-raw',
          code: 'PRD-000002',
          name: 'Plantain',
          unit: 'Kilogram',
        },
      },
    ],
    productionRun: null,
  };

  const materialIssue: ProductionMaterialIssueWithItems = {
    id: 'issue-1',
    organisationId: 'org-1',
    productionOrderId: 'order-1',
    issuedDate: new Date('2026-08-05'),
    issuedById: 'user-1',
    notes: null,
    createdAt: new Date('2026-08-05'),
    items: [
      {
        id: 'issue-item-1',
        componentProductId: 'product-raw',
        quantityIssued: 100,
        componentProduct: {
          id: 'product-raw',
          code: 'PRD-000002',
          name: 'Plantain',
          unit: 'Kilogram',
        },
      },
    ],
  };

  function makeController() {
    const productionOrderService = {
      list: jest.fn(),
      getById: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      plan: jest.fn(),
      cancel: jest.fn(),
      getAvailability: jest.fn(),
      listMaterialIssues: jest.fn(),
      issueMaterial: jest.fn(),
      getProductionRun: jest.fn(),
      completeProduction: jest.fn(),
    } as unknown as jest.Mocked<ProductionOrderService>;
    const auditService = { record: jest.fn() } as unknown as jest.Mocked<AuditService>;

    const controller = new ProductionOrderController(productionOrderService, auditService);
    return { controller, productionOrderService, auditService };
  }

  const req = { ip: '127.0.0.1', headers: { 'user-agent': 'jest' } } as unknown as Request;

  describe('list', () => {
    it('passes filters through', async () => {
      const { controller, productionOrderService } = makeController();
      productionOrderService.list.mockResolvedValue([order]);

      const result = await controller.list(tokenUser, 'PLANNED', 'product-finished', '  chips  ');

      expect(productionOrderService.list).toHaveBeenCalledWith('org-1', {
        status: 'PLANNED',
        productId: 'product-finished',
        search: 'chips',
      });
      expect(result.items[0]?.productionOrderNumber).toBe('PROD-000001');
    });
  });

  describe('create', () => {
    it('creates the order and records an audit entry', async () => {
      const { controller, productionOrderService, auditService } = makeController();
      productionOrderService.create.mockResolvedValue(order);

      const result = await controller.create(
        { billOfMaterialId: 'bom-1', plannedQuantity: 500, locationId: 'location-1' },
        tokenUser,
        req,
      );

      expect(productionOrderService.create).toHaveBeenCalledWith(
        'org-1',
        expect.objectContaining({ billOfMaterialId: 'bom-1' }),
        'user-1',
      );
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: PRODUCTION_AUDIT_ACTIONS.ORDER_CREATED,
          entityId: 'order-1',
        }),
      );
      expect(result.productionOrderNumber).toBe('PROD-000001');
    });
  });

  describe('plan', () => {
    it('plans the order and records an audit entry', async () => {
      const { controller, productionOrderService, auditService } = makeController();
      productionOrderService.plan.mockResolvedValue({
        ...order,
        status: ProductionOrderStatus.PLANNED,
      });

      const result = await controller.plan('order-1', tokenUser, req);

      expect(productionOrderService.plan).toHaveBeenCalledWith('org-1', 'order-1', 'user-1');
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: PRODUCTION_AUDIT_ACTIONS.ORDER_PLANNED }),
      );
      expect(result.status).toBe(ProductionOrderStatus.PLANNED);
    });
  });

  describe('cancel', () => {
    it('cancels the order and records an audit entry', async () => {
      const { controller, productionOrderService, auditService } = makeController();
      productionOrderService.cancel.mockResolvedValue({
        ...order,
        status: ProductionOrderStatus.CANCELLED,
      });

      await controller.cancel('order-1', tokenUser, req);

      expect(productionOrderService.cancel).toHaveBeenCalledWith('org-1', 'order-1', 'user-1');
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: PRODUCTION_AUDIT_ACTIONS.ORDER_CANCELLED }),
      );
    });
  });

  describe('getAvailability', () => {
    it('delegates to the service without recording an audit entry (read-only, informational)', async () => {
      const { controller, productionOrderService, auditService } = makeController();
      productionOrderService.getAvailability.mockResolvedValue([
        {
          componentProductId: 'product-raw',
          product: { id: 'product-raw', code: 'PRD-000002', name: 'Plantain', unit: 'Kilogram' },
          requiredQuantity: 250,
          unitOfMeasure: 'Kilogram',
          availableQuantity: 100,
          shortfall: 150,
        },
      ]);

      const result = await controller.getAvailability(tokenUser, 'order-1');

      expect(result.items[0]?.shortfall).toBe(150);
      expect(auditService.record).not.toHaveBeenCalled();
    });
  });

  describe('issueMaterial', () => {
    it('issues material, always records material-issued, and conditionally records order-started', async () => {
      const { controller, productionOrderService, auditService } = makeController();
      productionOrderService.issueMaterial.mockResolvedValue({
        materialIssue,
        transitionedToInProgress: true,
      });

      const result = await controller.issueMaterial(
        'order-1',
        {
          issuedDate: new Date('2026-08-05'),
          items: [{ componentProductId: 'product-raw', quantity: 100 }],
        },
        tokenUser,
        req,
      );

      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: PRODUCTION_AUDIT_ACTIONS.MATERIAL_ISSUED }),
      );
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: PRODUCTION_AUDIT_ACTIONS.ORDER_STARTED }),
      );
      expect(auditService.record).toHaveBeenCalledTimes(2);
      expect(result.id).toBe('issue-1');
    });

    it('does not record order-started for a later partial issue that keeps the order IN_PROGRESS', async () => {
      const { controller, productionOrderService, auditService } = makeController();
      productionOrderService.issueMaterial.mockResolvedValue({
        materialIssue,
        transitionedToInProgress: false,
      });

      await controller.issueMaterial(
        'order-1',
        {
          issuedDate: new Date('2026-08-06'),
          items: [{ componentProductId: 'product-raw', quantity: 50 }],
        },
        tokenUser,
        req,
      );

      expect(auditService.record).toHaveBeenCalledTimes(1);
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: PRODUCTION_AUDIT_ACTIONS.MATERIAL_ISSUED }),
      );
    });
  });

  describe('complete', () => {
    it('records completed and finished-goods-received when acceptedQuantity > 0', async () => {
      const { controller, productionOrderService, auditService } = makeController();
      productionOrderService.completeProduction.mockResolvedValue({
        productionOrder: { ...order, status: ProductionOrderStatus.COMPLETED },
        productionRun: {
          id: 'run-1',
          organisationId: 'org-1',
          productionOrderId: 'order-1',
          producedQuantity: 480,
          rejectedQuantity: 30,
          acceptedQuantity: 450,
          rejectionReason: 'BURNT',
          rejectionNotes: 'edges burnt',
          completedById: 'user-1',
          completedAt: new Date('2026-08-10'),
        } as never,
      });

      await controller.complete(
        'order-1',
        { producedQuantity: 480, rejectedQuantity: 30 },
        tokenUser,
        req,
      );

      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: PRODUCTION_AUDIT_ACTIONS.COMPLETED }),
      );
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: PRODUCTION_AUDIT_ACTIONS.FINISHED_GOODS_RECEIVED }),
      );
      expect(auditService.record).toHaveBeenCalledTimes(2);
    });

    it('does not record finished-goods-received when everything produced was rejected', async () => {
      const { controller, productionOrderService, auditService } = makeController();
      productionOrderService.completeProduction.mockResolvedValue({
        productionOrder: { ...order, status: ProductionOrderStatus.COMPLETED },
        productionRun: {
          id: 'run-1',
          organisationId: 'org-1',
          productionOrderId: 'order-1',
          producedQuantity: 50,
          rejectedQuantity: 50,
          acceptedQuantity: 0,
          rejectionReason: 'BURNT',
          rejectionNotes: null,
          completedById: 'user-1',
          completedAt: new Date('2026-08-10'),
        } as never,
      });

      await controller.complete(
        'order-1',
        { producedQuantity: 50, rejectedQuantity: 50 },
        tokenUser,
        req,
      );

      expect(auditService.record).toHaveBeenCalledTimes(1);
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: PRODUCTION_AUDIT_ACTIONS.COMPLETED }),
      );
    });
  });
});
