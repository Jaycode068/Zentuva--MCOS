import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Customer, CustomerStatus, NetworkRelationshipStatus } from '@prisma/client';

import { CustomerRepository } from '../customer/customer.repository';
import {
  NetworkRelationshipRepository,
  NetworkRelationshipWithCustomers,
} from './network-relationship.repository';
import { NetworkRelationshipService } from './network-relationship.service';

describe('NetworkRelationshipService', () => {
  function makeCustomer(id: string, overrides: Partial<Customer> = {}): Customer {
    return {
      id,
      organisationId: 'org-1',
      customerCode: `CUS-00000${id}`,
      customerType: 'DISTRIBUTOR',
      customerName: `Customer ${id}`,
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
      ...overrides,
    };
  }

  const source = makeCustomer('source-1');
  const target = makeCustomer('target-1', { customerType: 'RETAILER' });

  const relationship: NetworkRelationshipWithCustomers = {
    id: 'relationship-1',
    organisationId: 'org-1',
    sourceCustomerId: 'source-1',
    targetCustomerId: 'target-1',
    relationshipType: 'DISTRIBUTES_TO',
    effectiveFrom: new Date('2026-08-21'),
    effectiveTo: null,
    status: NetworkRelationshipStatus.ACTIVE,
    notes: null,
    createdById: 'user-1',
    updatedById: 'user-1',
    createdAt: new Date('2026-08-21'),
    updatedAt: new Date('2026-08-21'),
    sourceCustomer: {
      id: 'source-1',
      customerCode: source.customerCode,
      customerName: source.customerName,
      customerType: source.customerType,
    },
    targetCustomer: {
      id: 'target-1',
      customerCode: target.customerCode,
      customerName: target.customerName,
      customerType: target.customerType,
    },
  };

  function makeService() {
    const networkRelationshipRepository = {
      create: jest.fn(),
      findById: jest.fn(),
      findManyByOrganisation: jest.fn(),
      findActiveDuplicate: jest.fn().mockResolvedValue(null),
      update: jest.fn(),
    } as unknown as jest.Mocked<NetworkRelationshipRepository>;
    const customerRepository = {
      findById: jest.fn(),
    } as unknown as jest.Mocked<CustomerRepository>;

    const service = new NetworkRelationshipService(
      networkRelationshipRepository,
      customerRepository,
    );
    return { service, networkRelationshipRepository, customerRepository };
  }

  describe('create', () => {
    it('rejects a customer supplying itself', async () => {
      const { service } = makeService();

      await expect(
        service.create(
          'org-1',
          {
            sourceCustomerId: 'source-1',
            targetCustomerId: 'source-1',
            relationshipType: 'SUPPLIES',
          },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a cross-tenant source customer', async () => {
      const { service, customerRepository } = makeService();
      customerRepository.findById.mockResolvedValueOnce(null);

      await expect(
        service.create(
          'org-1',
          {
            sourceCustomerId: 'other-org',
            targetCustomerId: 'target-1',
            relationshipType: 'SUPPLIES',
          },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a cross-tenant target customer', async () => {
      const { service, customerRepository } = makeService();
      customerRepository.findById.mockResolvedValueOnce(source).mockResolvedValueOnce(null);

      await expect(
        service.create(
          'org-1',
          {
            sourceCustomerId: 'source-1',
            targetCustomerId: 'other-org',
            relationshipType: 'SUPPLIES',
          },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a duplicate already-ACTIVE relationship of the same shape', async () => {
      const { service, customerRepository, networkRelationshipRepository } = makeService();
      customerRepository.findById.mockResolvedValueOnce(source).mockResolvedValueOnce(target);
      networkRelationshipRepository.findActiveDuplicate.mockResolvedValue(relationship);

      await expect(
        service.create(
          'org-1',
          {
            sourceCustomerId: 'source-1',
            targetCustomerId: 'target-1',
            relationshipType: 'DISTRIBUTES_TO',
          },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('allows a new ACTIVE relationship when only an INACTIVE one of the same shape exists', async () => {
      const { service, customerRepository, networkRelationshipRepository } = makeService();
      customerRepository.findById.mockResolvedValueOnce(source).mockResolvedValueOnce(target);
      networkRelationshipRepository.findActiveDuplicate.mockResolvedValue(null);
      networkRelationshipRepository.create.mockResolvedValue(relationship);

      await service.create(
        'org-1',
        {
          sourceCustomerId: 'source-1',
          targetCustomerId: 'target-1',
          relationshipType: 'DISTRIBUTES_TO',
        },
        'user-1',
      );

      expect(networkRelationshipRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ status: NetworkRelationshipStatus.ACTIVE }),
      );
    });
  });

  describe('update', () => {
    it('never accepts sourceCustomerId/targetCustomerId/relationshipType in the update payload', async () => {
      const { service, networkRelationshipRepository } = makeService();
      networkRelationshipRepository.findById.mockResolvedValue(relationship);
      networkRelationshipRepository.update.mockResolvedValue(relationship);

      await service.update('org-1', 'relationship-1', { notes: 'Updated' }, 'user-1');

      const updateData = networkRelationshipRepository.update.mock.calls[0]?.[2];
      expect(updateData).not.toHaveProperty('sourceCustomerId');
      expect(updateData).not.toHaveProperty('targetCustomerId');
      expect(updateData).not.toHaveProperty('relationshipType');
    });

    it('throws NotFoundException for a relationship belonging to another organisation', async () => {
      const { service, networkRelationshipRepository } = makeService();
      networkRelationshipRepository.findById.mockResolvedValue(null);

      await expect(service.update('org-1', 'missing', { notes: 'x' }, 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('deactivate', () => {
    it('sets status INACTIVE and stamps effectiveTo when unset', async () => {
      const { service, networkRelationshipRepository } = makeService();
      networkRelationshipRepository.findById.mockResolvedValue(relationship);
      networkRelationshipRepository.update.mockResolvedValue({
        ...relationship,
        status: NetworkRelationshipStatus.INACTIVE,
      });

      await service.deactivate('org-1', 'relationship-1', 'user-1');

      const updateData = networkRelationshipRepository.update.mock.calls[0]?.[2] as Record<
        string,
        unknown
      >;
      expect(updateData.status).toBe(NetworkRelationshipStatus.INACTIVE);
      expect(updateData.effectiveTo).toBeInstanceOf(Date);
    });

    it('rejects deactivating an already-inactive relationship', async () => {
      const { service, networkRelationshipRepository } = makeService();
      networkRelationshipRepository.findById.mockResolvedValue({
        ...relationship,
        status: NetworkRelationshipStatus.INACTIVE,
      });

      await expect(service.deactivate('org-1', 'relationship-1', 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('every customer type is accepted as either endpoint', () => {
    const types = [
      'DISTRIBUTOR',
      'WHOLESALER',
      'RETAILER',
      'SUPERMARKET',
      'CORPORATE',
      'INSTITUTION',
      'RESTAURANT',
      'HOTEL',
      'OTHER',
    ] as const;

    it.each(types)('%s can be the source of a relationship', async (customerType) => {
      const { service, customerRepository, networkRelationshipRepository } = makeService();
      customerRepository.findById
        .mockResolvedValueOnce(makeCustomer('source-1', { customerType }))
        .mockResolvedValueOnce(target);
      networkRelationshipRepository.create.mockResolvedValue(relationship);

      await expect(
        service.create(
          'org-1',
          { sourceCustomerId: 'source-1', targetCustomerId: 'target-1', relationshipType: 'OTHER' },
          'user-1',
        ),
      ).resolves.toBeDefined();
    });
  });
});
