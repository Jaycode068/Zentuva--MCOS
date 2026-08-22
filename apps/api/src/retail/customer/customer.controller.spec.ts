import { NotFoundException } from '@nestjs/common';
import { Customer, CustomerStatus } from '@prisma/client';
import { Request } from 'express';

import { AuditService } from '../../identity/audit/audit.service';
import { TokenPayload } from '../../identity/auth/ports/token.port';
import { CUSTOMER_AUDIT_ACTIONS } from './customer-audit-actions';
import { CustomerController } from './customer.controller';
import { CustomerService } from './customer.service';

describe('CustomerController', () => {
  const tokenUser: TokenPayload = {
    sub: 'user-1',
    organisationId: 'org-1',
    sessionId: 'session-1',
  };

  const customer: Customer = {
    id: 'customer-1',
    organisationId: 'org-1',
    customerCode: 'CUS-000001',
    customerType: 'RETAILER',
    customerName: 'Bodija Supermart',
    contactPersonName: null,
    phoneNumber: '+2348030000001',
    alternatePhoneNumber: null,
    email: null,
    address: null,
    city: null,
    state: null,
    country: null,
    territoryId: null,
    status: CustomerStatus.ACTIVE,
    notes: null,
    createdById: 'user-1',
    updatedById: 'user-1',
    createdAt: new Date('2026-08-21'),
    updatedAt: new Date('2026-08-21'),
  };

  function makeController() {
    const customerService = {
      list: jest.fn(),
      getById: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      activate: jest.fn(),
      deactivate: jest.fn(),
    } as unknown as jest.Mocked<CustomerService>;
    const auditService = { record: jest.fn() } as unknown as jest.Mocked<AuditService>;

    const controller = new CustomerController(customerService, auditService);
    return { controller, customerService, auditService };
  }

  const req = { ip: '127.0.0.1', headers: { 'user-agent': 'jest' } } as unknown as Request;

  describe('getOne', () => {
    it('throws NotFoundException for a missing customer', async () => {
      const { controller, customerService } = makeController();
      customerService.getById.mockResolvedValue(null);

      await expect(controller.getOne(tokenUser, 'missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('creates the customer and records an audit entry', async () => {
      const { controller, customerService, auditService } = makeController();
      customerService.create.mockResolvedValue(customer);

      const result = await controller.create(
        {
          customerType: 'RETAILER',
          customerName: 'Bodija Supermart',
          phoneNumber: '+2348030000001',
        },
        tokenUser,
        req,
      );

      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: CUSTOMER_AUDIT_ACTIONS.CREATED, entityId: 'customer-1' }),
      );
      expect(result.customerCode).toBe('CUS-000001');
    });
  });

  describe('update', () => {
    it('updates the customer and records an audit entry', async () => {
      const { controller, customerService, auditService } = makeController();
      customerService.update.mockResolvedValue({ ...customer, customerName: 'Updated' });

      await controller.update('customer-1', { customerName: 'Updated' }, tokenUser, req);

      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: CUSTOMER_AUDIT_ACTIONS.UPDATED }),
      );
    });
  });

  describe('activate / deactivate', () => {
    it('activates and records an audit entry', async () => {
      const { controller, customerService, auditService } = makeController();
      customerService.activate.mockResolvedValue(customer);

      await controller.activate('customer-1', tokenUser, req);

      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: CUSTOMER_AUDIT_ACTIONS.ACTIVATED }),
      );
    });

    it('deactivates and records an audit entry', async () => {
      const { controller, customerService, auditService } = makeController();
      customerService.deactivate.mockResolvedValue({
        ...customer,
        status: CustomerStatus.INACTIVE,
      });

      await controller.deactivate('customer-1', tokenUser, req);

      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: CUSTOMER_AUDIT_ACTIONS.DEACTIVATED }),
      );
    });
  });
});
