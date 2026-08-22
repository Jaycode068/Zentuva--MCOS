import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Customer, CustomerStatus, Territory, TerritoryStatus } from '@prisma/client';

import { TerritoryRepository } from '../territory/territory.repository';
import { CustomerRepository } from './customer.repository';
import { CustomerService } from './customer.service';

describe('CustomerService', () => {
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

  const territory: Territory = {
    id: 'territory-1',
    organisationId: 'org-1',
    territoryCode: 'TER-000001',
    name: 'Bodija',
    type: 'Area',
    parentTerritoryId: null,
    status: TerritoryStatus.ACTIVE,
    description: null,
    createdById: 'user-1',
    updatedById: 'user-1',
    createdAt: new Date('2026-08-21'),
    updatedAt: new Date('2026-08-21'),
  };

  function makeService() {
    const customerRepository = {
      create: jest.fn(),
      findById: jest.fn(),
      findManyByOrganisation: jest.fn(),
      existsByCode: jest.fn().mockResolvedValue(false),
      update: jest.fn(),
    } as unknown as jest.Mocked<CustomerRepository>;
    const territoryRepository = {
      findById: jest.fn(),
    } as unknown as jest.Mocked<TerritoryRepository>;

    const service = new CustomerService(customerRepository, territoryRepository);
    return { service, customerRepository, territoryRepository };
  }

  describe('create', () => {
    it('succeeds with only customerType/customerName/phoneNumber — the minimum onboarding fields', async () => {
      const { service, customerRepository, territoryRepository } = makeService();
      customerRepository.create.mockResolvedValue(customer);

      await service.create(
        'org-1',
        {
          customerType: 'RETAILER',
          customerName: 'Bodija Supermart',
          phoneNumber: '+2348030000001',
        },
        'user-1',
      );

      expect(territoryRepository.findById).not.toHaveBeenCalled();
      expect(customerRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          customerCode: 'CUS-000001',
          customerType: 'RETAILER',
          customerName: 'Bodija Supermart',
          phoneNumber: '+2348030000001',
          status: CustomerStatus.ACTIVE,
        }),
      );
      // No `territory` connect key at all when territoryId isn't supplied.
      expect(customerRepository.create.mock.calls[0]?.[0]).not.toHaveProperty('territory');
    });

    it("validates a supplied territoryId belongs to the caller's own organisation", async () => {
      const { service, customerRepository, territoryRepository } = makeService();
      territoryRepository.findById.mockResolvedValue(territory);
      customerRepository.create.mockResolvedValue(customer);

      await service.create(
        'org-1',
        {
          customerType: 'RETAILER',
          customerName: 'Bodija Supermart',
          phoneNumber: '+2348030000001',
          territoryId: 'territory-1',
        },
        'user-1',
      );

      expect(territoryRepository.findById).toHaveBeenCalledWith('org-1', 'territory-1');
    });

    it('rejects a cross-tenant territoryId', async () => {
      const { service, territoryRepository } = makeService();
      territoryRepository.findById.mockResolvedValue(null);

      await expect(
        service.create(
          'org-1',
          {
            customerType: 'RETAILER',
            customerName: 'Bodija Supermart',
            phoneNumber: '+2348030000001',
            territoryId: 'other-org-territory',
          },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('increments the code sequence on collision', async () => {
      const { service, customerRepository } = makeService();
      customerRepository.existsByCode.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
      customerRepository.create.mockResolvedValue(customer);

      await service.create(
        'org-1',
        {
          customerType: 'RETAILER',
          customerName: 'Bodija Supermart',
          phoneNumber: '+2348030000001',
        },
        'user-1',
      );

      expect(customerRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ customerCode: 'CUS-000002' }),
      );
    });
  });

  describe('update', () => {
    it('throws NotFoundException for a customer belonging to another organisation', async () => {
      const { service, customerRepository } = makeService();
      customerRepository.findById.mockResolvedValue(null);

      await expect(
        service.update('org-1', 'missing', { customerName: 'x' }, 'user-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('never accepts customerCode as part of the update payload', async () => {
      const { service, customerRepository } = makeService();
      customerRepository.findById.mockResolvedValue(customer);
      customerRepository.update.mockResolvedValue({ ...customer, customerName: 'Renamed' });

      await service.update('org-1', 'customer-1', { customerName: 'Renamed' }, 'user-1');

      const updateData = customerRepository.update.mock.calls[0]?.[2];
      expect(updateData).not.toHaveProperty('customerCode');
    });
  });

  describe('activate / deactivate', () => {
    it('rejects activating an already-active customer', async () => {
      const { service, customerRepository } = makeService();
      customerRepository.findById.mockResolvedValue(customer);

      await expect(service.activate('org-1', 'customer-1', 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('deactivates an active customer', async () => {
      const { service, customerRepository } = makeService();
      customerRepository.findById.mockResolvedValue(customer);
      customerRepository.update.mockResolvedValue({ ...customer, status: CustomerStatus.INACTIVE });

      const result = await service.deactivate('org-1', 'customer-1', 'user-1');

      expect(result.status).toBe(CustomerStatus.INACTIVE);
    });
  });

  describe('tenant isolation', () => {
    it('getById returns null for a customer belonging to another organisation', async () => {
      const { service, customerRepository } = makeService();
      customerRepository.findById.mockResolvedValue(null);

      const result = await service.getById('org-2', 'customer-1');

      expect(result).toBeNull();
      expect(customerRepository.findById).toHaveBeenCalledWith('org-2', 'customer-1');
    });
  });
});
