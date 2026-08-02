import { NotFoundException } from '@nestjs/common';
import { Supplier, SupplierCategory, SupplierStatus } from '@prisma/client';

import { SupplierRepository } from './supplier.repository';
import { SupplierService } from './supplier.service';

describe('SupplierService', () => {
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

  function makeService() {
    const supplierRepository = {
      create: jest.fn(),
      findById: jest.fn(),
      findManyByOrganisation: jest.fn(),
      existsByCode: jest.fn().mockResolvedValue(false),
      update: jest.fn(),
    } as unknown as jest.Mocked<SupplierRepository>;
    const service = new SupplierService(supplierRepository);
    return { service, supplierRepository };
  }

  describe('create', () => {
    it('generates a supplier code and defaults status to ACTIVE (via the Prisma column default)', async () => {
      const { service, supplierRepository } = makeService();
      supplierRepository.create.mockResolvedValue(supplier);

      await service.create(
        'org-1',
        { supplierName: 'Fresh Farms Ltd', supplierCategory: 'RAW_MATERIAL' },
        'user-1',
      );

      expect(supplierRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          supplierCode: 'SUP-000001',
          supplierName: 'Fresh Farms Ltd',
          supplierCategory: 'RAW_MATERIAL',
          createdById: 'user-1',
          updatedById: 'user-1',
        }),
      );
      // status omitted entirely — the DB default (ACTIVE) applies, not an explicit value.
      expect(supplierRepository.create).not.toHaveBeenCalledWith(
        expect.objectContaining({ status: expect.anything() }),
      );
    });

    it('increments the code sequence on collision', async () => {
      const { service, supplierRepository } = makeService();
      supplierRepository.existsByCode
        .mockResolvedValueOnce(true) // SUP-000001 taken
        .mockResolvedValueOnce(false); // SUP-000002 free
      supplierRepository.create.mockResolvedValue(supplier);

      await service.create(
        'org-1',
        { supplierName: 'Fresh Farms Ltd', supplierCategory: 'RAW_MATERIAL' },
        'user-1',
      );

      expect(supplierRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ supplierCode: 'SUP-000002' }),
      );
    });

    it('accepts an explicit INACTIVE status on creation', async () => {
      const { service, supplierRepository } = makeService();
      supplierRepository.create.mockResolvedValue({ ...supplier, status: SupplierStatus.INACTIVE });

      await service.create(
        'org-1',
        { supplierName: 'Fresh Farms Ltd', supplierCategory: 'RAW_MATERIAL', status: 'INACTIVE' },
        'user-1',
      );

      expect(supplierRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'INACTIVE' }),
      );
    });
  });

  describe('update', () => {
    it('throws NotFoundException when the supplier does not exist in this organisation', async () => {
      const { service, supplierRepository } = makeService();
      supplierRepository.update.mockResolvedValue(null);

      await expect(
        service.update('org-1', 'missing', { supplierName: 'X' }, 'user-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('passes the partial update through, stamping updatedById', async () => {
      const { service, supplierRepository } = makeService();
      supplierRepository.update.mockResolvedValue({
        ...supplier,
        supplierName: 'Fresh Farms Nigeria Ltd',
      });

      await service.update(
        'org-1',
        'supplier-1',
        { supplierName: 'Fresh Farms Nigeria Ltd' },
        'user-2',
      );

      expect(supplierRepository.update).toHaveBeenCalledWith(
        'org-1',
        'supplier-1',
        expect.objectContaining({
          supplierName: 'Fresh Farms Nigeria Ltd',
          updatedById: 'user-2',
        }),
      );
    });

    it('deactivates a supplier via a plain status update', async () => {
      const { service, supplierRepository } = makeService();
      supplierRepository.update.mockResolvedValue({ ...supplier, status: SupplierStatus.INACTIVE });

      await service.update('org-1', 'supplier-1', { status: 'INACTIVE' }, 'user-2');

      expect(supplierRepository.update).toHaveBeenCalledWith(
        'org-1',
        'supplier-1',
        expect.objectContaining({ status: 'INACTIVE' }),
      );
    });

    it('clears an optional field when an empty string is submitted', async () => {
      const { service, supplierRepository } = makeService();
      supplierRepository.update.mockResolvedValue({ ...supplier, email: null });

      await service.update('org-1', 'supplier-1', { email: '' }, 'user-2');

      expect(supplierRepository.update).toHaveBeenCalledWith(
        'org-1',
        'supplier-1',
        expect.objectContaining({ email: null }),
      );
    });
  });
});
