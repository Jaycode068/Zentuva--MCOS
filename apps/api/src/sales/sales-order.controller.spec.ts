import { Request } from 'express';

import { AuditService } from '../identity/audit/audit.service';
import { TokenPayload } from '../identity/auth/ports/token.port';
import { SALES_AUDIT_ACTIONS } from './sales-audit-actions';
import { SalesFulfilmentService } from './sales-fulfilment.service';
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
        quantityFulfilled: 0,
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
    const salesFulfilmentService = {
      getAvailability: jest.fn(),
      listFulfilments: jest.fn(),
      findJournalEntriesForFulfilments: jest.fn().mockResolvedValue(new Map()),
      fulfil: jest.fn(),
    } as unknown as jest.Mocked<SalesFulfilmentService>;
    const auditService = { record: jest.fn() } as unknown as jest.Mocked<AuditService>;

    const controller = new SalesOrderController(
      salesOrderService,
      salesFulfilmentService,
      auditService,
    );
    return { controller, salesOrderService, salesFulfilmentService, auditService };
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

  describe('availability / fulfilments / fulfil (Sprint 4.9)', () => {
    it('returns availability rows from the fulfilment service', async () => {
      const { controller, salesFulfilmentService } = makeController();
      const rows = [
        {
          salesOrderItemId: 'item-1',
          productId: 'product-1',
          product: { id: 'product-1', code: 'PRD-000030', name: 'Plantain Chips', unit: 'Pack' },
          ordered: 100,
          fulfilled: 0,
          remaining: 100,
          availableStock: 72,
          shortfall: 28,
        },
      ];
      salesFulfilmentService.getAvailability.mockResolvedValue(rows);

      const result = await controller.getAvailability(tokenUser, 'order-1', undefined);

      expect(salesFulfilmentService.getAvailability).toHaveBeenCalledWith(
        'org-1',
        'order-1',
        undefined,
      );
      expect(result).toEqual({ items: rows });
    });

    it('lists fulfilment history from the fulfilment service', async () => {
      const { controller, salesFulfilmentService } = makeController();
      salesFulfilmentService.listFulfilments.mockResolvedValue([]);

      const result = await controller.listFulfilments(tokenUser, 'order-1');

      expect(salesFulfilmentService.listFulfilments).toHaveBeenCalledWith('org-1', 'order-1');
      expect(result).toEqual({ items: [] });
    });

    it('records an audit entry when a new fulfilment is created', async () => {
      const { controller, salesFulfilmentService, auditService } = makeController();
      const fulfilledOrder = { ...order, status: 'PARTIALLY_FULFILLED' } as SalesOrderWithRelations;
      salesFulfilmentService.fulfil.mockResolvedValue({
        fulfilment: { id: 'fulfilment-1', items: [{}] } as never,
        order: fulfilledOrder,
        journalEntry: null,
        wasCreated: true,
      });

      await controller.fulfil(
        'order-1',
        {
          locationId: 'location-1',
          fulfilmentDate: new Date('2026-08-21'),
          items: [{ salesOrderItemId: 'item-1', quantity: 1 }],
        },
        tokenUser,
        req,
      );

      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: SALES_AUDIT_ACTIONS.ORDER_FULFILLED,
          entityId: 'order-1',
        }),
      );
    });

    it('does NOT record a second audit entry when a replayed idempotent request returns an existing fulfilment', async () => {
      const { controller, salesFulfilmentService, auditService } = makeController();
      salesFulfilmentService.fulfil.mockResolvedValue({
        fulfilment: { id: 'fulfilment-1', items: [{}] } as never,
        order,
        journalEntry: null,
        wasCreated: false,
      });

      await controller.fulfil(
        'order-1',
        {
          locationId: 'location-1',
          fulfilmentDate: new Date('2026-08-21'),
          items: [{ salesOrderItemId: 'item-1', quantity: 1 }],
        },
        tokenUser,
        req,
      );

      expect(auditService.record).not.toHaveBeenCalled();
    });
  });
});
