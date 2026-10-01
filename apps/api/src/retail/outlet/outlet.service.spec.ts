import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  CollectionPointStatus,
  Customer,
  CustomerStatus,
  Outlet,
  OutletPhoto,
  OutletStatus,
  Territory,
  TerritoryStatus,
  User,
  UserStatus,
} from '@prisma/client';

import { FileStorage } from '../../identity/organisation/ports/file-storage.port';
import { UserService } from '../../identity/user/user.service';
import { InventoryLocationRepository } from '../../inventory/inventory-location.repository';
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
    collectionPointStatus: CollectionPointStatus.DISABLED,
    collectionPointResponsibleUserId: null,
    collectionPointOperatingHours: null,
    inventoryLocationId: null,
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

  /** A Collection-Point-eligible outlet: ACTIVE + a territory assigned. */
  const eligibleOutlet: Outlet = { ...outlet, territoryId: 'territory-1' };
  const eligibleOutletWithRelations: OutletWithRelations = {
    ...outletWithRelations,
    territoryId: 'territory-1',
    territory: { id: 'territory-1', name: 'Bodija' },
  };

  const responsibleUser: User = {
    id: 'user-2',
    organisationId: 'org-1',
    email: 'ada@example.com',
    employeeCode: null,
    firstName: 'Ada',
    lastName: 'Okafor',
    phoneNumber: null,
    avatarUrl: null,
    avatarKey: null,
    passwordHash: 'hash',
    status: UserStatus.ACTIVE,
    mustChangePassword: false,
    passwordChangedAt: null,
    failedLoginAttempts: 0,
    emailVerifiedAt: null,
    lastLoginAt: null,
    createdAt: new Date('2026-08-21'),
    updatedAt: new Date('2026-08-21'),
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
    const userService = {
      getById: jest.fn(),
    } as unknown as jest.Mocked<UserService>;
    const inventoryLocationRepository = {
      findById: jest.fn(),
    } as unknown as jest.Mocked<InventoryLocationRepository>;
    const fileStorage = {
      upload: jest.fn(),
      delete: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<FileStorage>;

    const service = new OutletService(
      outletRepository,
      outletPhotoRepository,
      customerRepository,
      territoryRepository,
      userService,
      inventoryLocationRepository,
      fileStorage,
    );
    return {
      service,
      outletRepository,
      outletPhotoRepository,
      customerRepository,
      territoryRepository,
      userService,
      inventoryLocationRepository,
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

  describe('enableCollectionPoint (Sprint 36)', () => {
    it('enables a valid, active, territory-assigned outlet', async () => {
      const { service, outletRepository } = makeService();
      outletRepository.findById.mockResolvedValue(eligibleOutlet);
      outletRepository.update.mockResolvedValue({
        ...eligibleOutletWithRelations,
        collectionPointStatus: CollectionPointStatus.ENABLED,
      });

      const result = await service.enableCollectionPoint('org-1', 'outlet-1', 'user-1');

      expect(outletRepository.update).toHaveBeenCalledWith(
        'org-1',
        'outlet-1',
        expect.objectContaining({ collectionPointStatus: CollectionPointStatus.ENABLED }),
      );
      expect(result.collectionPointStatus).toBe(CollectionPointStatus.ENABLED);
    });

    it('rejects an inactive outlet', async () => {
      const { service, outletRepository } = makeService();
      outletRepository.findById.mockResolvedValue({
        ...eligibleOutlet,
        status: OutletStatus.INACTIVE,
      });

      await expect(service.enableCollectionPoint('org-1', 'outlet-1', 'user-1')).rejects.toThrow(
        BadRequestException,
      );
      expect(outletRepository.update).not.toHaveBeenCalled();
    });

    it('rejects an outlet with no territory assigned', async () => {
      const { service, outletRepository } = makeService();
      outletRepository.findById.mockResolvedValue(outlet); // territoryId: null

      await expect(service.enableCollectionPoint('org-1', 'outlet-1', 'user-1')).rejects.toThrow(
        BadRequestException,
      );
      expect(outletRepository.update).not.toHaveBeenCalled();
    });

    it('rejects a cross-tenant outlet with NotFoundException (never revealing existence)', async () => {
      const { service, outletRepository } = makeService();
      outletRepository.findById.mockResolvedValue(null);

      await expect(service.enableCollectionPoint('org-2', 'outlet-1', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('rejects enabling an already-enabled Collection Point', async () => {
      const { service, outletRepository } = makeService();
      outletRepository.findById.mockResolvedValue({
        ...eligibleOutlet,
        collectionPointStatus: CollectionPointStatus.ENABLED,
      });

      await expect(service.enableCollectionPoint('org-1', 'outlet-1', 'user-1')).rejects.toThrow(
        BadRequestException,
      );
      expect(outletRepository.update).not.toHaveBeenCalled();
    });

    it('enabling never touches outletType, customerId, or any other B2B field', async () => {
      const { service, outletRepository } = makeService();
      outletRepository.findById.mockResolvedValue(eligibleOutlet);
      outletRepository.update.mockResolvedValue(eligibleOutletWithRelations);

      await service.enableCollectionPoint('org-1', 'outlet-1', 'user-1');

      const updateData = outletRepository.update.mock.calls[0]?.[2];
      expect(updateData).not.toHaveProperty('outletType');
      expect(updateData).not.toHaveProperty('customerId');
      expect(updateData).not.toHaveProperty('status');
    });

    it('final state is deterministic under concurrent enable calls', async () => {
      const { service, outletRepository } = makeService();
      outletRepository.findById.mockResolvedValue(eligibleOutlet);
      outletRepository.update.mockResolvedValue({
        ...eligibleOutletWithRelations,
        collectionPointStatus: CollectionPointStatus.ENABLED,
      });

      const results = await Promise.allSettled([
        service.enableCollectionPoint('org-1', 'outlet-1', 'user-1'),
        service.enableCollectionPoint('org-1', 'outlet-1', 'user-1'),
        service.enableCollectionPoint('org-1', 'outlet-1', 'user-1'),
        service.enableCollectionPoint('org-1', 'outlet-1', 'user-1'),
        service.enableCollectionPoint('org-1', 'outlet-1', 'user-1'),
      ]);

      // Every settled call that actually wrote agrees on the same final status — no
      // torn/inconsistent state, regardless of how many raced past the read-check.
      for (const result of results) {
        if (result.status === 'fulfilled') {
          expect(result.value.collectionPointStatus).toBe(CollectionPointStatus.ENABLED);
        }
      }
      expect(
        outletRepository.update.mock.calls.every(
          (call) => call[2].collectionPointStatus === CollectionPointStatus.ENABLED,
        ),
      ).toBe(true);
    });
  });

  describe('disableCollectionPoint (Sprint 36)', () => {
    it('disables an enabled Collection Point', async () => {
      const { service, outletRepository } = makeService();
      const enabledOutlet = {
        ...eligibleOutlet,
        collectionPointStatus: CollectionPointStatus.ENABLED,
      };
      outletRepository.findById.mockResolvedValue(enabledOutlet);
      outletRepository.update.mockResolvedValue({
        ...eligibleOutletWithRelations,
        collectionPointStatus: CollectionPointStatus.DISABLED,
      });

      const result = await service.disableCollectionPoint('org-1', 'outlet-1', 'user-1');

      expect(result.collectionPointStatus).toBe(CollectionPointStatus.DISABLED);
    });

    it('rejects disabling an already-disabled Collection Point', async () => {
      const { service, outletRepository } = makeService();
      outletRepository.findById.mockResolvedValue(eligibleOutlet);

      await expect(service.disableCollectionPoint('org-1', 'outlet-1', 'user-1')).rejects.toThrow(
        BadRequestException,
      );
      expect(outletRepository.update).not.toHaveBeenCalled();
    });

    it('never destroys collectionPointResponsibleUserId/OperatingHours configuration — only the status flips', async () => {
      const { service, outletRepository } = makeService();
      const enabledConfigured = {
        ...eligibleOutlet,
        collectionPointStatus: CollectionPointStatus.ENABLED,
        collectionPointResponsibleUserId: 'user-2',
        collectionPointOperatingHours: 'Mon-Sat 9am-6pm',
      };
      outletRepository.findById.mockResolvedValue(enabledConfigured);
      outletRepository.update.mockResolvedValue({
        ...eligibleOutletWithRelations,
        ...enabledConfigured,
        collectionPointStatus: CollectionPointStatus.DISABLED,
      });

      await service.disableCollectionPoint('org-1', 'outlet-1', 'user-1');

      const updateData = outletRepository.update.mock.calls[0]?.[2];
      expect(updateData).not.toHaveProperty('collectionPointResponsibleUserId');
      expect(updateData).not.toHaveProperty('collectionPointOperatingHours');
    });

    it('is safe under repeated disable calls (deterministic final state, no corruption)', async () => {
      const { service, outletRepository } = makeService();
      const enabledOutlet = {
        ...eligibleOutlet,
        collectionPointStatus: CollectionPointStatus.ENABLED,
      };
      outletRepository.findById
        .mockResolvedValueOnce(enabledOutlet)
        .mockResolvedValue(eligibleOutlet);
      outletRepository.update.mockResolvedValue({
        ...eligibleOutletWithRelations,
        collectionPointStatus: CollectionPointStatus.DISABLED,
      });

      await service.disableCollectionPoint('org-1', 'outlet-1', 'user-1');
      await expect(service.disableCollectionPoint('org-1', 'outlet-1', 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('updateCollectionPointConfig (Sprint 36)', () => {
    it('updates responsibleUserId and operatingHours after validating the user', async () => {
      const { service, outletRepository, userService } = makeService();
      outletRepository.findById.mockResolvedValue(eligibleOutlet);
      userService.getById.mockResolvedValue(responsibleUser);
      outletRepository.update.mockResolvedValue({
        ...eligibleOutletWithRelations,
        collectionPointResponsibleUserId: 'user-2',
        collectionPointOperatingHours: 'Mon-Sat 9am-6pm',
      });

      const result = await service.updateCollectionPointConfig(
        'org-1',
        'outlet-1',
        { responsibleUserId: 'user-2', operatingHours: 'Mon-Sat 9am-6pm' },
        'user-1',
      );

      expect(userService.getById).toHaveBeenCalledWith('org-1', 'user-2');
      expect(result.collectionPointResponsibleUserId).toBe('user-2');
    });

    it('rejects a cross-tenant responsibleUserId', async () => {
      const { service, outletRepository, userService } = makeService();
      outletRepository.findById.mockResolvedValue(eligibleOutlet);
      userService.getById.mockResolvedValue(null);

      await expect(
        service.updateCollectionPointConfig(
          'org-1',
          'outlet-1',
          { responsibleUserId: 'other-org-user' },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(outletRepository.update).not.toHaveBeenCalled();
    });

    it('rejects an inactive/suspended responsibleUserId', async () => {
      const { service, outletRepository, userService } = makeService();
      outletRepository.findById.mockResolvedValue(eligibleOutlet);
      userService.getById.mockResolvedValue({ ...responsibleUser, status: UserStatus.SUSPENDED });

      await expect(
        service.updateCollectionPointConfig(
          'org-1',
          'outlet-1',
          { responsibleUserId: 'user-2' },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(outletRepository.update).not.toHaveBeenCalled();
    });

    it('allows explicitly clearing responsibleUserId via null', async () => {
      const { service, outletRepository, userService } = makeService();
      outletRepository.findById.mockResolvedValue(eligibleOutlet);
      outletRepository.update.mockResolvedValue({
        ...eligibleOutletWithRelations,
        collectionPointResponsibleUserId: null,
      });

      await service.updateCollectionPointConfig(
        'org-1',
        'outlet-1',
        { responsibleUserId: null },
        'user-1',
      );

      expect(userService.getById).not.toHaveBeenCalled();
      expect(outletRepository.update).toHaveBeenCalledWith(
        'org-1',
        'outlet-1',
        expect.objectContaining({ collectionPointResponsibleUserId: null }),
      );
    });

    it('rejects a cross-tenant outlet', async () => {
      const { service, outletRepository } = makeService();
      outletRepository.findById.mockResolvedValue(null);

      await expect(
        service.updateCollectionPointConfig('org-2', 'outlet-1', { operatingHours: 'x' }, 'user-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('is safe under concurrent configuration updates (deterministic final state)', async () => {
      const { service, outletRepository, userService } = makeService();
      outletRepository.findById.mockResolvedValue(eligibleOutlet);
      userService.getById.mockResolvedValue(responsibleUser);
      outletRepository.update.mockResolvedValue({
        ...eligibleOutletWithRelations,
        collectionPointOperatingHours: 'Mon-Sat 9am-6pm',
      });

      const results = await Promise.all([
        service.updateCollectionPointConfig(
          'org-1',
          'outlet-1',
          { operatingHours: 'Mon-Sat 9am-6pm' },
          'user-1',
        ),
        service.updateCollectionPointConfig(
          'org-1',
          'outlet-1',
          { operatingHours: 'Mon-Sat 9am-6pm' },
          'user-1',
        ),
      ]);

      expect(results).toHaveLength(2);
      expect(outletRepository.update).toHaveBeenCalledTimes(2);
    });
  });

  describe('B2B regression — enabling Collection Point does not change existing behaviour', () => {
    it('create() is entirely unaffected by the Collection Point capability', async () => {
      const { service, outletRepository, customerRepository } = makeService();
      customerRepository.findById.mockResolvedValue(customer);
      outletRepository.create.mockResolvedValue(outletWithRelations);

      await service.create(
        'org-1',
        { customerId: 'customer-1', outletType: 'SUPERMARKET', name: 'Bodija Supermart' },
        'user-1',
      );

      const createData = outletRepository.create.mock.calls[0]?.[0];
      expect(createData).not.toHaveProperty('collectionPointStatus');
    });

    it('activate()/deactivate() remain unaffected by Collection Point status', async () => {
      const { service, outletRepository } = makeService();
      const enabledInactiveCandidate = {
        ...eligibleOutlet,
        status: OutletStatus.INACTIVE,
        collectionPointStatus: CollectionPointStatus.ENABLED,
      };
      outletRepository.findById.mockResolvedValue(enabledInactiveCandidate);
      outletRepository.update.mockResolvedValue({
        ...eligibleOutletWithRelations,
        status: OutletStatus.ACTIVE,
        collectionPointStatus: CollectionPointStatus.ENABLED,
      });

      // Reactivating an outlet whose Collection Point happens to be ENABLED must still
      // succeed exactly as before — Collection Point status is never a gate on
      // activate()/deactivate() (brief: enabling/disabling must not change existing
      // outlet lifecycle behaviour).
      const result = await service.activate('org-1', 'outlet-1', 'user-1');
      expect(result.status).toBe(OutletStatus.ACTIVE);
      const updateData = outletRepository.update.mock.calls[0]?.[2];
      expect(updateData).not.toHaveProperty('collectionPointStatus');
    });
  });
});
