import { Request } from 'express';

import { AuditService } from '../identity/audit/audit.service';
import { TokenPayload } from '../identity/auth/ports/token.port';
import { SALES_AUDIT_ACTIONS } from './sales-audit-actions';
import { SalesOrderWithRelations } from './sales-order.repository';
import { SalesOrderController } from './sales-order.controller';
import { SalesOrderService } from './sales-order.service';

describe('SalesOrderController', () => {
  const tokenUser: TokenPayload = {
    sub: 'user-1',
    organisationId: 'org-1',
    sessionId: 'session-1',
  };

  const order: SalesOrderWithRelations = {
    id: 'order-1',
    organisationId: 'org-1',
    orderCode: 'SO-000001',
    customerId: 'customer-1',
    outletId: 'outlet-1',
    salesAgentId: 'user-1',
    status: 'DRAFT',
    orderDate: new Date('2026-08-21'),
    notes: null,
    subtotal: 500,
    discount: 0,
    total: 500,
    createdById: 'user-1',
    updatedById: 'user-1',
    createdAt: new Date('2026-08-21'),
    updatedAt: new Date('2026-08-21'),
    customer: { id: 'customer-1', customerCode: 'CUS-000001', customerName: 'Bodija Supermart' },
    outlet: { id: 'outlet-1', outletCode: 'OUT-000001', name: 'Bodija Supermart — Main Branch' },
    items: [
      {
        id: 'item-1',
        productId: 'product-1',
        quantity: 2,
        unitPrice: 250,
        lineTotal: 500,
        product: {
          id: 'product-1',
          code: 'PRD-000030',
          name: 'Plantain Chips Sweet & Spicy 30g',
          unit: 'Pack',
        },
      },
    ],
  };

  function makeController() {
    const salesOrderService = {
      list: jest.fn(),
      getById: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      confirm: jest.fn(),
      cancel: jest.fn(),
    } as unknown as jest.Mocked<SalesOrderService>;
    const auditService = { record: jest.fn() } as unknown as jest.Mocked<AuditService>;

    const controller = new SalesOrderController(salesOrderService, auditService);
    return { controller, salesOrderService, auditService };
  }

  const req = { ip: '127.0.0.1', headers: { 'user-agent': 'jest' } } as unknown as Request;

  describe('create', () => {
    it('creates the order and records an audit entry', async () => {
      const { controller, salesOrderService, auditService } = makeController();
      salesOrderService.create.mockResolvedValue(order);

      const result = await controller.create(
        {
          customerId: 'customer-1',
          outletId: 'outlet-1',
          orderDate: new Date('2026-08-21'),
          discount: 0,
          items: [{ productId: 'product-1', quantity: 2, unitPrice: 250 }],
        },
        tokenUser,
        req,
      );

      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: SALES_AUDIT_ACTIONS.ORDER_CREATED, entityId: 'order-1' }),
      );
      expect(result.orderCode).toBe('SO-000001');
    });
  });

  describe('update', () => {
    it('updates the order and records an audit entry', async () => {
      const { controller, salesOrderService, auditService } = makeController();
      salesOrderService.update.mockResolvedValue({ ...order, notes: 'Updated' });

      await controller.update('order-1', { notes: 'Updated' }, tokenUser, req);

      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: SALES_AUDIT_ACTIONS.ORDER_UPDATED }),
      );
    });
  });

  describe('confirm / cancel', () => {
    it('confirms and records an audit entry', async () => {
      const { controller, salesOrderService, auditService } = makeController();
      salesOrderService.confirm.mockResolvedValue({ ...order, status: 'CONFIRMED' });

      await controller.confirm('order-1', tokenUser, req);

      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: SALES_AUDIT_ACTIONS.ORDER_CONFIRMED }),
      );
    });

    it('cancels and records an audit entry', async () => {
      const { controller, salesOrderService, auditService } = makeController();
      salesOrderService.cancel.mockResolvedValue({ ...order, status: 'CANCELLED' });

      await controller.cancel('order-1', tokenUser, req);

      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: SALES_AUDIT_ACTIONS.ORDER_CANCELLED }),
      );
    });
  });
});
