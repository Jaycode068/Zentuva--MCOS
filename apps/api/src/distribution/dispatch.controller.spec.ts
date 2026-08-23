import { ConfigService } from '@nestjs/config';
import { DispatchStatus } from '@prisma/client';
import { Request } from 'express';

import { AuditService } from '../identity/audit/audit.service';
import { TokenPayload } from '../identity/auth/ports/token.port';
import { DISTRIBUTION_AUDIT_ACTIONS } from './distribution-audit-actions';
import { DeliveryService } from './delivery.service';
import { DispatchController } from './dispatch.controller';
import { DispatchWithRelations } from './dispatch.repository';
import { DispatchService } from './dispatch.service';

describe('DispatchController', () => {
  const tokenUser: TokenPayload = {
    sub: 'user-1',
    organisationId: 'org-1',
    sessionId: 'session-1',
  };
  const req = { ip: '127.0.0.1', headers: { 'user-agent': 'jest' } } as unknown as Request;

  const dispatch = {
    id: 'dispatch-1',
    dispatchCode: 'DSP-000001',
    salesFulfilmentId: 'fulfilment-1',
    salesOrder: { id: 'order-1', orderCode: 'SO-000010' },
    customerId: 'customer-1',
    customer: {
      id: 'customer-1',
      customerCode: 'CUS-000010',
      customerName: 'Mama Nkechi Stores',
      territoryId: 'territory-1',
    },
    outlet: null,
    sourceLocation: { id: 'location-1', name: 'Main Warehouse' },
    dispatchDate: new Date('2026-08-22'),
    status: DispatchStatus.READY,
    notes: null,
    items: [],
    createdAt: new Date('2026-08-22'),
    updatedAt: new Date('2026-08-22'),
  } as unknown as DispatchWithRelations;

  function makeController() {
    const dispatchService = {
      list: jest.fn(),
      getById: jest.fn(),
      create: jest.fn(),
      dispatch: jest.fn(),
      markInTransit: jest.fn(),
      cancel: jest.fn(),
      fail: jest.fn(),
      getDispatchAvailability: jest.fn(),
    } as unknown as jest.Mocked<DispatchService>;
    const deliveryService = {
      listByDispatch: jest.fn(),
      create: jest.fn(),
      setPhoto: jest.fn(),
    } as unknown as jest.Mocked<DeliveryService>;
    const auditService = { record: jest.fn() } as unknown as jest.Mocked<AuditService>;
    const config = { get: jest.fn() } as unknown as jest.Mocked<ConfigService>;

    const controller = new DispatchController(
      dispatchService,
      deliveryService,
      auditService,
      config,
    );
    return { controller, dispatchService, deliveryService, auditService };
  }

  describe('create', () => {
    it('creates the dispatch and records an audit entry when wasCreated is true', async () => {
      const { controller, dispatchService, auditService } = makeController();
      dispatchService.create.mockResolvedValue({ dispatch, wasCreated: true });

      await controller.create(
        {
          salesFulfilmentId: 'fulfilment-1',
          sourceLocationId: 'location-1',
          dispatchDate: new Date('2026-08-22'),
          items: [{ salesFulfilmentItemId: 'fulfilment-item-1', quantity: 500 }],
        },
        tokenUser,
        req,
      );

      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: DISTRIBUTION_AUDIT_ACTIONS.DISPATCH_CREATED,
          entityId: 'dispatch-1',
        }),
      );
    });

    it('does NOT record an audit entry on an idempotent replay (wasCreated: false)', async () => {
      const { controller, dispatchService, auditService } = makeController();
      dispatchService.create.mockResolvedValue({ dispatch, wasCreated: false });

      await controller.create(
        {
          salesFulfilmentId: 'fulfilment-1',
          sourceLocationId: 'location-1',
          dispatchDate: new Date('2026-08-22'),
          items: [{ salesFulfilmentItemId: 'fulfilment-item-1', quantity: 500 }],
        },
        tokenUser,
        req,
      );

      expect(auditService.record).not.toHaveBeenCalled();
    });
  });

  describe('lifecycle transitions', () => {
    it('dispatches and records an audit entry', async () => {
      const { controller, dispatchService, auditService } = makeController();
      dispatchService.dispatch.mockResolvedValue({
        ...dispatch,
        status: DispatchStatus.DISPATCHED,
      });

      await controller.dispatchOut('dispatch-1', tokenUser, req);

      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: DISTRIBUTION_AUDIT_ACTIONS.DISPATCH_DISPATCHED }),
      );
    });

    it('marks in transit and records an audit entry', async () => {
      const { controller, dispatchService, auditService } = makeController();
      dispatchService.markInTransit.mockResolvedValue({
        ...dispatch,
        status: DispatchStatus.IN_TRANSIT,
      });

      await controller.markInTransit('dispatch-1', tokenUser, req);

      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: DISTRIBUTION_AUDIT_ACTIONS.DISPATCH_IN_TRANSIT }),
      );
    });

    it('cancels and records an audit entry', async () => {
      const { controller, dispatchService, auditService } = makeController();
      dispatchService.cancel.mockResolvedValue({ ...dispatch, status: DispatchStatus.CANCELLED });

      await controller.cancel('dispatch-1', tokenUser, req);

      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: DISTRIBUTION_AUDIT_ACTIONS.DISPATCH_CANCELLED }),
      );
    });

    it('fails and records an audit entry', async () => {
      const { controller, dispatchService, auditService } = makeController();
      dispatchService.fail.mockResolvedValue({
        ...dispatch,
        status: DispatchStatus.FAILED,
        notes: 'reason',
      });

      await controller.fail('dispatch-1', { notes: 'reason' }, tokenUser, req);

      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: DISTRIBUTION_AUDIT_ACTIONS.DISPATCH_FAILED }),
      );
    });
  });

  describe('deliveries', () => {
    it('records an audit entry when a new delivery is created', async () => {
      const { controller, deliveryService, auditService } = makeController();
      deliveryService.create.mockResolvedValue({
        delivery: { id: 'delivery-1', items: [{}] } as never,
        dispatch: { ...dispatch, status: DispatchStatus.PARTIALLY_DELIVERED },
        wasCreated: true,
      });

      await controller.createDelivery(
        'dispatch-1',
        {
          deliveryDate: new Date('2026-08-23'),
          items: [{ dispatchItemId: 'dispatch-item-1', quantity: 470 }],
        },
        tokenUser,
        req,
      );

      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: DISTRIBUTION_AUDIT_ACTIONS.DELIVERY_RECORDED,
          entityId: 'dispatch-1',
        }),
      );
    });

    it('does NOT record a second audit entry when a replayed idempotent request returns an existing delivery', async () => {
      const { controller, deliveryService, auditService } = makeController();
      deliveryService.create.mockResolvedValue({
        delivery: { id: 'delivery-1', items: [{}] } as never,
        dispatch,
        wasCreated: false,
      });

      await controller.createDelivery(
        'dispatch-1',
        {
          deliveryDate: new Date('2026-08-23'),
          items: [{ dispatchItemId: 'dispatch-item-1', quantity: 470 }],
        },
        tokenUser,
        req,
      );

      expect(auditService.record).not.toHaveBeenCalled();
    });
  });

  describe('dispatch-availability', () => {
    it('returns availability rows from the dispatch service', async () => {
      const { controller, dispatchService } = makeController();
      const rows = [
        {
          salesFulfilmentItemId: 'fulfilment-item-1',
          productId: 'product-1',
          product: {
            id: 'product-1',
            code: 'PRD-000027',
            name: 'Plantain Chips 500g',
            unit: 'Pack',
          },
          fulfilled: 500,
          dispatched: 0,
          remaining: 500,
        },
      ];
      dispatchService.getDispatchAvailability.mockResolvedValue(rows);

      const result = await controller.getDispatchAvailability(tokenUser, 'fulfilment-1');

      expect(dispatchService.getDispatchAvailability).toHaveBeenCalledWith('org-1', 'fulfilment-1');
      expect(result).toEqual({ items: rows });
    });
  });
});
