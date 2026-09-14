import { Request } from 'express';

import { EmployeeService } from '../hr/employee.service';
import { AuditService } from '../identity/audit/audit.service';
import { TokenPayload } from '../identity/auth/ports/token.port';
import { EffectiveAccessResolver } from '../identity/authorization/effective-access-resolver';
import { ScopeEvaluator } from '../identity/authorization/scope-evaluator';
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

  function makeController(
    grantedScopes: string[] = ['ORGANISATION'],
    directReports: { id: string; user: { id: string } | null }[] = [],
  ) {
    const salesOrderService = {
      list: jest.fn().mockResolvedValue([]),
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
    const effectiveAccessResolver = {
      resolve: jest.fn().mockResolvedValue({}),
    } as unknown as jest.Mocked<EffectiveAccessResolver>;
    const scopeEvaluator = {
      grantedScopes: jest.fn().mockReturnValue(grantedScopes),
    } as unknown as jest.Mocked<ScopeEvaluator>;
    const employeeService = {
      getByUserId: jest.fn().mockResolvedValue({ id: 'employee-1' }),
      list: jest.fn().mockResolvedValue({ items: directReports, total: directReports.length }),
    } as unknown as jest.Mocked<EmployeeService>;

    const controller = new SalesOrderController(
      salesOrderService,
      salesFulfilmentService,
      auditService,
      effectiveAccessResolver,
      scopeEvaluator,
      employeeService,
    );
    return {
      controller,
      salesOrderService,
      salesFulfilmentService,
      auditService,
      effectiveAccessResolver,
      scopeEvaluator,
      employeeService,
    };
  }

  const req = { ip: '127.0.0.1', headers: { 'user-agent': 'jest' } } as unknown as Request;

  describe('list (Sprint 25.1 scope enforcement)', () => {
    it('applies no salesAgentId filter when granted ORGANISATION scope', async () => {
      const { controller, salesOrderService } = makeController(['ORGANISATION']);

      await controller.list(tokenUser, undefined, undefined, undefined, undefined);

      expect(salesOrderService.list).toHaveBeenCalledWith(
        'org-1',
        expect.objectContaining({ salesAgentId: undefined }),
      );
    });

    it('filters to the caller when granted only OWN_RECORDS scope', async () => {
      const { controller, salesOrderService } = makeController(['OWN_RECORDS']);

      await controller.list(tokenUser, undefined, undefined, undefined, undefined);

      expect(salesOrderService.list).toHaveBeenCalledWith(
        'org-1',
        expect.objectContaining({ salesAgentId: 'user-1' }),
      );
    });

    it("filters to direct reports' linked user ids when granted only OWN_TEAM", async () => {
      const { controller, salesOrderService } = makeController(
        ['OWN_TEAM'],
        [
          { id: 'report-1', user: { id: 'report-user-1' } },
          { id: 'report-2', user: { id: 'report-user-2' } },
          { id: 'report-3', user: null }, // unlinked Employee — excluded, never crashes
        ],
      );

      await controller.list(tokenUser, undefined, undefined, undefined, undefined);

      expect(salesOrderService.list).toHaveBeenCalledWith(
        'org-1',
        expect.objectContaining({ salesAgentIds: ['report-user-1', 'report-user-2'] }),
      );
    });

    it('returns an empty page when granted OWN_TEAM but the caller has no direct reports', async () => {
      const { controller, salesOrderService } = makeController(['OWN_TEAM'], []);

      const result = await controller.list(tokenUser, undefined, undefined, undefined, undefined);

      expect(result).toEqual({ items: [] });
      expect(salesOrderService.list).not.toHaveBeenCalled();
    });

    it('returns an empty page — never unrestricted access — when the only granted scope cannot be proven server-side (e.g. ASSIGNED_TERRITORY)', async () => {
      const { controller, salesOrderService } = makeController(['ASSIGNED_TERRITORY']);

      const result = await controller.list(tokenUser, undefined, undefined, undefined, undefined);

      expect(result).toEqual({ items: [] });
      expect(salesOrderService.list).not.toHaveBeenCalled();
    });

    it('returns an empty page when no scope is granted at all', async () => {
      const { controller, salesOrderService } = makeController([]);

      const result = await controller.list(tokenUser, undefined, undefined, undefined, undefined);

      expect(result).toEqual({ items: [] });
      expect(salesOrderService.list).not.toHaveBeenCalled();
    });
  });

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
