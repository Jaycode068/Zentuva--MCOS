import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  Customer,
  CustomerStatus,
  Outlet,
  OutletPhoto,
  OutletStatus,
  Territory,
  TerritoryStatus,
} from '@prisma/client';

import { FileStorage } from '../../identity/organisation/ports/file-storage.port';
import { CustomerRepository } from '../customer/customer.repository';
import { TerritoryRepository } from '../territory/territory.repository';
import { OutletPhotoRepository } from './outlet-photo.repository';
import { OutletRepository, OutletWithRelations } from './outlet.repository';
import { OutletService } from './outlet.service';

describe('OutletService', () => {
  const customer: Customer = {
    id: 'customer-1',
    organisationId: 'org-1',
    customerCode: 'CUS-000001',
    customerType: 'SUPERMARKET',
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

  const outlet: Outlet = {
    id: 'outlet-1',
    organisationId: 'org-1',
    customerId: 'customer-1',
    outletCode: 'OUT-000001',
    outletType: 'SUPERMARKET',
    name: 'Bodija Supermart — Main Branch',
    contactPersonName: null,
    phoneNumber: null,
    address: null,
    city: null,
    state: null,
    country: null,
    territoryId: null,
    latitude: null,
    longitude: null,
    status: OutletStatus.ACTIVE,
    notes: null,
    createdById: 'user-1',
    updatedById: 'user-1',
    createdAt: new Date('2026-08-21'),
    updatedAt: new Date('2026-08-21'),
  };

  const outletWithRelations: OutletWithRelations = {
    ...outlet,
    customer: { id: 'customer-1', customerCode: 'CUS-000001', customerName: 'Bodija Supermart' },
    territory: null,
    photos: [],
  };

  function makeService() {
    const outletRepository = {
      create: jest.fn(),
      findById: jest.fn(),
      findByIdWithRelations: jest.fn(),
      findManyByOrganisation: jest.fn(),
      existsByCode: jest.fn().mockResolvedValue(false),
      update: jest.fn(),
    } as unknown as jest.Mocked<OutletRepository>;
    const outletPhotoRepository = {
      addPhoto: jest.fn(),
      listByOutlet: jest.fn(),
      removePhoto: jest.fn(),
    } as unknown as jest.Mocked<OutletPhotoRepository>;
    const customerRepository = {
      findById: jest.fn(),
    } as unknown as jest.Mocked<CustomerRepository>;
    const territoryRepository = {
      findById: jest.fn(),
    } as unknown as jest.Mocked<TerritoryRepository>;
    const fileStorage = {
      upload: jest.fn(),
      delete: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<FileStorage>;

    const service = new OutletService(
      outletRepository,
      outletPhotoRepository,
      customerRepository,
      territoryRepository,
      fileStorage,
    );
    return {
      service,
      outletRepository,
      outletPhotoRepository,
      customerRepository,
      territoryRepository,
      fileStorage,
    };
  }

  describe('create', () => {
    it('succeeds with no coordinates supplied — GPS is never required at onboarding', async () => {
      const { service, outletRepository, customerRepository } = makeService();
      customerRepository.findById.mockResolvedValue(customer);
      outletRepository.create.mockResolvedValue(outletWithRelations);

      await service.create(
        'org-1',
        {
          customerId: 'customer-1',
          outletType: 'SUPERMARKET',
          name: 'Bodija Supermart — Main Branch',
        },
        'user-1',
      );

      expect(outletRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ outletCode: 'OUT-000001', status: OutletStatus.ACTIVE }),
      );
    });

    it('rejects a cross-tenant customerId', async () => {
      const { service, customerRepository } = makeService();
      customerRepository.findById.mockResolvedValue(null);

      await expect(
        service.create(
          'org-1',
          { customerId: 'other-org-customer', outletType: 'SUPERMARKET', name: 'Some Outlet' },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("validates a supplied territoryId belongs to the caller's own organisation", async () => {
      const { service, outletRepository, customerRepository, territoryRepository } = makeService();
      customerRepository.findById.mockResolvedValue(customer);
      territoryRepository.findById.mockResolvedValue(territory);
      outletRepository.create.mockResolvedValue(outletWithRelations);

      await service.create(
        'org-1',
        {
          customerId: 'customer-1',
          outletType: 'SUPERMARKET',
          name: 'Bodija Supermart — Main Branch',
          territoryId: 'territory-1',
        },
        'user-1',
      );

      expect(territoryRepository.findById).toHaveBeenCalledWith('org-1', 'territory-1');
    });
  });

  describe('update', () => {
    it('never accepts customerId as part of the update payload', async () => {
      const { service, outletRepository } = makeService();
      outletRepository.findById.mockResolvedValue(outlet);
      outletRepository.update.mockResolvedValue(outletWithRelations);

      await service.update('org-1', 'outlet-1', { name: 'Renamed' }, 'user-1');

      const updateData = outletRepository.update.mock.calls[0]?.[2];
      expect(updateData).not.toHaveProperty('customerId');
      expect(updateData).not.toHaveProperty('customer');
    });
  });

  describe('addPhotos', () => {
    const photo1: OutletPhoto = {
      id: 'photo-1',
      organisationId: 'org-1',
      outletId: 'outlet-1',
      url: 'https://files/outlet-photos/1.jpg',
      key: 'outlet-photos/org-1/1.jpg',
      photoType: 'FRONT',
      caption: null,
      createdById: 'user-1',
      createdAt: new Date('2026-08-21'),
    };
    const photo2: OutletPhoto = { ...photo1, id: 'photo-2', key: 'outlet-photos/org-1/2.jpg' };
    const photo3: OutletPhoto = { ...photo1, id: 'photo-3', key: 'outlet-photos/org-1/3.jpg' };

    it('calls fileStorage.upload once per file and writes one row per result', async () => {
      const { service, outletRepository, outletPhotoRepository, fileStorage } = makeService();
      outletRepository.findById.mockResolvedValue(outlet);
      fileStorage.upload
        .mockResolvedValueOnce({ url: photo1.url, key: photo1.key })
        .mockResolvedValueOnce({ url: photo2.url, key: photo2.key })
        .mockResolvedValueOnce({ url: photo3.url, key: photo3.key });
      outletPhotoRepository.addPhoto
        .mockResolvedValueOnce(photo1)
        .mockResolvedValueOnce(photo2)
        .mockResolvedValueOnce(photo3);

      const files = [
        { mimeType: 'image/jpeg', buffer: Buffer.from('a') },
        { mimeType: 'image/jpeg', buffer: Buffer.from('b') },
        { mimeType: 'image/jpeg', buffer: Buffer.from('c') },
      ];
      const result = await service.addPhotos('org-1', 'outlet-1', files, {}, 'user-1');

      expect(fileStorage.upload).toHaveBeenCalledTimes(3);
      expect(outletPhotoRepository.addPhoto).toHaveBeenCalledTimes(3);
      expect(result).toHaveLength(3);
    });

    it('throws before uploading anything for a cross-tenant outlet', async () => {
      const { service, outletRepository, fileStorage } = makeService();
      outletRepository.findById.mockResolvedValue(null);

      await expect(
        service.addPhotos(
          'org-1',
          'other-org-outlet',
          [{ mimeType: 'image/jpeg', buffer: Buffer.from('a') }],
          {},
          'user-1',
        ),
      ).rejects.toThrow(NotFoundException);
      expect(fileStorage.upload).not.toHaveBeenCalled();
    });

    it('best-effort deletes already-uploaded files if a later upload in the batch fails', async () => {
      const { service, outletRepository, outletPhotoRepository, fileStorage } = makeService();
      outletRepository.findById.mockResolvedValue(outlet);
      fileStorage.upload
        .mockResolvedValueOnce({ url: photo1.url, key: photo1.key })
        .mockRejectedValueOnce(new Error('storage down'));
      outletPhotoRepository.addPhoto.mockResolvedValueOnce(photo1);
      fileStorage.delete.mockResolvedValue(undefined);

      const files = [
        { mimeType: 'image/jpeg', buffer: Buffer.from('a') },
        { mimeType: 'image/jpeg', buffer: Buffer.from('b') },
      ];

      await expect(service.addPhotos('org-1', 'outlet-1', files, {}, 'user-1')).rejects.toThrow(
        'storage down',
      );
      expect(fileStorage.delete).toHaveBeenCalledWith(photo1.key);
    });
  });

  describe('removePhoto', () => {
    it("calls fileStorage.delete with the removed photo's own key", async () => {
      const { service, outletPhotoRepository, fileStorage } = makeService();
      const photo: OutletPhoto = {
        id: 'photo-1',
        organisationId: 'org-1',
        outletId: 'outlet-1',
        url: 'https://files/outlet-photos/1.jpg',
        key: 'outlet-photos/org-1/1.jpg',
        photoType: null,
        caption: null,
        createdById: 'user-1',
        createdAt: new Date('2026-08-21'),
      };
      outletPhotoRepository.removePhoto.mockResolvedValue(photo);

      await service.removePhoto('org-1', 'outlet-1', 'photo-1');

      expect(fileStorage.delete).toHaveBeenCalledWith(photo.key);
    });

    it('throws NotFoundException and never calls delete for a photo not belonging to this tenant', async () => {
      const { service, outletPhotoRepository, fileStorage } = makeService();
      outletPhotoRepository.removePhoto.mockResolvedValue(null);

      await expect(service.removePhoto('org-1', 'outlet-1', 'photo-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(fileStorage.delete).not.toHaveBeenCalled();
    });
  });

  describe('activate / deactivate', () => {
    it('rejects deactivating an already-inactive outlet', async () => {
      const { service, outletRepository } = makeService();
      outletRepository.findById.mockResolvedValue({ ...outlet, status: OutletStatus.INACTIVE });

      await expect(service.deactivate('org-1', 'outlet-1', 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('tenant isolation', () => {
    it('getById returns null for an outlet belonging to another organisation', async () => {
      const { service, outletRepository } = makeService();
      outletRepository.findByIdWithRelations.mockResolvedValue(null);

      const result = await service.getById('org-2', 'outlet-1');

      expect(result).toBeNull();
      expect(outletRepository.findByIdWithRelations).toHaveBeenCalledWith('org-2', 'outlet-1');
    });
  });
});
