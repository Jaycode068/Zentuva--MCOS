import { NotFoundException } from '@nestjs/common';
import { Supplier, SupplierCategory, SupplierStatus } from '@prisma/client';
import { Request } from 'express';

import { AuditService } from '../../identity/audit/audit.service';
import { TokenPayload } from '../../identity/auth/ports/token.port';
import { SUPPLIER_AUDIT_ACTIONS } from './supplier-audit-actions';
import { SupplierController } from './supplier.controller';
import { SupplierService } from './supplier.service';

describe('SupplierController', () => {
  const tokenUser: TokenPayload = {
    sub: 'user-1',
    organisationId: 'org-1',
    sessionId: 'session-1',
  };

  const supplier: Supplier = {
    id: 'supplier-1',
    organisationId: 'org-1',
    supplierCode: 'SUP-000001',
    supplierName: 'Fresh Farms Ltd',
    displayName: null,
    contactPerson: null,
    email: null,
    phoneNumber: null,
    website: null,
    country: null,
    state: null,
    city: null,
    address: null,
    taxIdentificationNumber: null,
    supplierCategory: SupplierCategory.RAW_MATERIAL,
    status: SupplierStatus.ACTIVE,
    notes: null,
    createdById: 'user-1',
    updatedById: 'user-1',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };

  function makeController() {
    const supplierService = {
      list: jest.fn(),
      getById: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    } as unknown as jest.Mocked<SupplierService>;
    const auditService = { record: jest.fn() } as unknown as jest.Mocked<AuditService>;

    const controller = new SupplierController(supplierService, auditService);
    return { controller, supplierService, auditService };
  }

  const req = { ip: '127.0.0.1', headers: { 'user-agent': 'jest' } } as unknown as Request;

  describe('list', () => {
    it('passes the trimmed search query and status/category filters through', async () => {
      const { controller, supplierService } = makeController();
      supplierService.list.mockResolvedValue([supplier]);

      const result = await controller.list(tokenUser, '  fresh  ', 'ACTIVE', 'RAW_MATERIAL');

      expect(supplierService.list).toHaveBeenCalledWith('org-1', {
        search: 'fresh',
        status: 'ACTIVE',
        category: 'RAW_MATERIAL',
      });
      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.supplierCode).toBe('SUP-000001');
    });
  });

  describe('getOne', () => {
    it('throws NotFoundException for a missing supplier', async () => {
      const { controller, supplierService } = makeController();
      supplierService.getById.mockResolvedValue(null);

      await expect(controller.getOne(tokenUser, 'missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('creates the supplier and records an audit entry', async () => {
      const { controller, supplierService, auditService } = makeController();
      supplierService.create.mockResolvedValue(supplier);

      const result = await controller.create(
        { supplierName: 'Fresh Farms Ltd', supplierCategory: 'RAW_MATERIAL' },
        tokenUser,
        req,
      );

      expect(supplierService.create).toHaveBeenCalledWith(
        'org-1',
        { supplierName: 'Fresh Farms Ltd', supplierCategory: 'RAW_MATERIAL' },
        'user-1',
      );
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: SUPPLIER_AUDIT_ACTIONS.CREATED,
          entityId: 'supplier-1',
        }),
      );
      expect(result.supplierCode).toBe('SUP-000001');
    });
  });

  describe('update', () => {
    it('updates the supplier and records a generic UPDATED audit entry for non-status fields', async () => {
      const { controller, supplierService, auditService } = makeController();
      supplierService.update.mockResolvedValue({ ...supplier, supplierName: 'Updated' });

      await controller.update('supplier-1', { supplierName: 'Updated' }, tokenUser, req);

      expect(supplierService.update).toHaveBeenCalledWith(
        'org-1',
        'supplier-1',
        { supplierName: 'Updated' },
        'user-1',
      );
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: SUPPLIER_AUDIT_ACTIONS.UPDATED }),
      );
    });

    it('records ACTIVATED when the update sets status to ACTIVE', async () => {
      const { controller, supplierService, auditService } = makeController();
      supplierService.update.mockResolvedValue({ ...supplier, status: SupplierStatus.ACTIVE });

      await controller.update('supplier-1', { status: 'ACTIVE' }, tokenUser, req);

      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: SUPPLIER_AUDIT_ACTIONS.ACTIVATED }),
      );
    });

    it('records DEACTIVATED when the update sets status to INACTIVE', async () => {
      const { controller, supplierService, auditService } = makeController();
      supplierService.update.mockResolvedValue({ ...supplier, status: SupplierStatus.INACTIVE });

      await controller.update('supplier-1', { status: 'INACTIVE' }, tokenUser, req);

      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: SUPPLIER_AUDIT_ACTIONS.DEACTIVATED }),
      );
    });

    it('prefers the status event when both status and other fields change', async () => {
      const { controller, supplierService, auditService } = makeController();
      supplierService.update.mockResolvedValue({
        ...supplier,
        status: SupplierStatus.INACTIVE,
        notes: 'Paused sourcing',
      });

      await controller.update(
        'supplier-1',
        { status: 'INACTIVE', notes: 'Paused sourcing' },
        tokenUser,
        req,
      );

      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: SUPPLIER_AUDIT_ACTIONS.DEACTIVATED }),
      );
    });
  });
});
