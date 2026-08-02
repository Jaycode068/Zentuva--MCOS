import { NotFoundException } from '@nestjs/common';
import { PurchaseOrderStatus } from '@prisma/client';
import { Request } from 'express';

import { AuditService } from '../../identity/audit/audit.service';
import { TokenPayload } from '../../identity/auth/ports/token.port';
import { PURCHASE_ORDER_AUDIT_ACTIONS } from './purchase-order-audit-actions';
import { PurchaseOrderWithRelations } from './purchase-order.repository';
import { PurchaseOrderController } from './purchase-order.controller';
import { PurchaseOrderService } from './purchase-order.service';

describe('PurchaseOrderController', () => {
  const tokenUser: TokenPayload = {
    sub: 'user-1',
    organisationId: 'org-1',
    sessionId: 'session-1',
  };

  const purchaseOrder: PurchaseOrderWithRelations = {
    id: 'po-1',
    organisationId: 'org-1',
    purchaseOrderNumber: 'PO-000001',
    supplierId: 'supplier-1',
    orderDate: new Date('2026-08-01'),
    expectedDeliveryDate: null,
    status: PurchaseOrderStatus.DRAFT,
    remarks: null,
    subtotal: 700000,
    total: 700000,
    createdById: 'user-1',
    updatedById: 'user-1',
    approvedById: null,
    createdAt: new Date('2026-08-01'),
    updatedAt: new Date('2026-08-01'),
    items: [
      {
        id: 'item-1',
        purchaseOrderId: 'po-1',
        productId: 'product-1',
        quantity: 2000,
        unitPrice: 350,
        lineTotal: 700000,
        createdAt: new Date('2026-08-01'),
        updatedAt: new Date('2026-08-01'),
        product: { id: 'product-1', code: 'PRD-000006', name: 'Plantain', unit: 'Kilogram' },
      },
    ],
    supplier: { id: 'supplier-1', supplierCode: 'SUP-000001', supplierName: 'Fresh Farms Ltd' },
  };

  function makeController() {
    const purchaseOrderService = {
      list: jest.fn(),
      getById: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      cancel: jest.fn(),
    } as unknown as jest.Mocked<PurchaseOrderService>;
    const auditService = { record: jest.fn() } as unknown as jest.Mocked<AuditService>;

    const controller = new PurchaseOrderController(purchaseOrderService, auditService);
    return { controller, purchaseOrderService, auditService };
  }

  const req = { ip: '127.0.0.1', headers: { 'user-agent': 'jest' } } as unknown as Request;

  describe('list', () => {
    it('passes the trimmed search query and status/supplier filters through', async () => {
      const { controller, purchaseOrderService } = makeController();
      purchaseOrderService.list.mockResolvedValue([purchaseOrder]);

      const result = await controller.list(tokenUser, '  fresh  ', 'DRAFT', 'supplier-1');

      expect(purchaseOrderService.list).toHaveBeenCalledWith('org-1', {
        search: 'fresh',
        status: 'DRAFT',
        supplierId: 'supplier-1',
      });
      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.purchaseOrderNumber).toBe('PO-000001');
    });
  });

  describe('getOne', () => {
    it('throws NotFoundException for a missing purchase order', async () => {
      const { controller, purchaseOrderService } = makeController();
      purchaseOrderService.getById.mockResolvedValue(null);

      await expect(controller.getOne(tokenUser, 'missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('creates the purchase order and records an audit entry', async () => {
      const { controller, purchaseOrderService, auditService } = makeController();
      purchaseOrderService.create.mockResolvedValue(purchaseOrder);

      const result = await controller.create(
        {
          supplierId: 'supplier-1',
          orderDate: new Date('2026-08-01'),
          items: [{ productId: 'product-1', quantity: 2000, unitPrice: 350 }],
        },
        tokenUser,
        req,
      );

      expect(purchaseOrderService.create).toHaveBeenCalledWith(
        'org-1',
        expect.objectContaining({ supplierId: 'supplier-1' }),
        'user-1',
      );
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: PURCHASE_ORDER_AUDIT_ACTIONS.CREATED,
          entityId: 'po-1',
        }),
      );
      expect(result.purchaseOrderNumber).toBe('PO-000001');
      expect(result.items[0]?.product.name).toBe('Plantain');
    });
  });

  describe('update', () => {
    it('updates the purchase order and records an audit entry', async () => {
      const { controller, purchaseOrderService, auditService } = makeController();
      purchaseOrderService.update.mockResolvedValue({ ...purchaseOrder, remarks: 'Urgent' });

      await controller.update('po-1', { remarks: 'Urgent' }, tokenUser, req);

      expect(purchaseOrderService.update).toHaveBeenCalledWith(
        'org-1',
        'po-1',
        { remarks: 'Urgent' },
        'user-1',
      );
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: PURCHASE_ORDER_AUDIT_ACTIONS.UPDATED }),
      );
    });
  });

  describe('cancel', () => {
    it('cancels the purchase order and records an audit entry', async () => {
      const { controller, purchaseOrderService, auditService } = makeController();
      purchaseOrderService.cancel.mockResolvedValue({
        ...purchaseOrder,
        status: PurchaseOrderStatus.CANCELLED,
      });

      await controller.cancel('po-1', tokenUser, req);

      expect(purchaseOrderService.cancel).toHaveBeenCalledWith('org-1', 'po-1', 'user-1');
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: PURCHASE_ORDER_AUDIT_ACTIONS.CANCELLED }),
      );
    });
  });
});
