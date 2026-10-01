import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CollectionPointStatus, OutletPhoto, OutletStatus } from '@prisma/client';
import { Request } from 'express';

import { AuditService } from '../../identity/audit/audit.service';
import { TokenPayload } from '../../identity/auth/ports/token.port';
import { UserService } from '../../identity/user/user.service';
import { OUTLET_AUDIT_ACTIONS } from './outlet-audit-actions';
import { OutletController } from './outlet.controller';
import { OutletWithRelations } from './outlet.repository';
import { OutletService } from './outlet.service';

describe('OutletController', () => {
  const tokenUser: TokenPayload = {
    sub: 'user-1',
    organisationId: 'org-1',
    sessionId: 'session-1',
  };

  const outlet: OutletWithRelations = {
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
    customer: { id: 'customer-1', customerCode: 'CUS-000001', customerName: 'Bodija Supermart' },
    territory: null,
    photos: [],
  };

  function makeController() {
    const outletService = {
      list: jest.fn(),
      getById: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      activate: jest.fn(),
      deactivate: jest.fn(),
      addPhotos: jest.fn(),
      removePhoto: jest.fn(),
      enableCollectionPoint: jest.fn(),
      disableCollectionPoint: jest.fn(),
      updateCollectionPointConfig: jest.fn(),
    } as unknown as jest.Mocked<OutletService>;
    const auditService = { record: jest.fn() } as unknown as jest.Mocked<AuditService>;
    const config = {
      get: jest.fn().mockReturnValue(2 * 1024 * 1024),
    } as unknown as jest.Mocked<ConfigService>;
    const userService = {
      listByOrganisation: jest.fn(),
    } as unknown as jest.Mocked<UserService>;

    const controller = new OutletController(outletService, auditService, config, userService);
    return { controller, outletService, auditService, userService };
  }

  const req = { ip: '127.0.0.1', headers: { 'user-agent': 'jest' } } as unknown as Request;

  function fakeFile(overrides: Partial<Express.Multer.File> = {}): Express.Multer.File {
    return {
      fieldname: 'files',
      originalname: 'photo.jpg',
      encoding: '7bit',
      mimetype: 'image/jpeg',
      size: 1024,
      buffer: Buffer.from('fake'),
      ...overrides,
    } as Express.Multer.File;
  }

  describe('create', () => {
    it('creates the outlet and records an audit entry', async () => {
      const { controller, outletService, auditService } = makeController();
      outletService.create.mockResolvedValue(outlet);

      const result = await controller.create(
        {
          customerId: 'customer-1',
          outletType: 'SUPERMARKET',
          name: 'Bodija Supermart — Main Branch',
        },
        tokenUser,
        req,
      );

      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: OUTLET_AUDIT_ACTIONS.CREATED, entityId: 'outlet-1' }),
      );
      expect(result.outletCode).toBe('OUT-000001');
    });
  });

  describe('addPhotos', () => {
    const photo: OutletPhoto = {
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

    it('records one photo_added audit entry per request with a count in metadata', async () => {
      const { controller, outletService, auditService } = makeController();
      outletService.addPhotos.mockResolvedValue([photo, photo]);

      await controller.addPhotos('outlet-1', [fakeFile(), fakeFile()], {}, tokenUser, req);

      expect(auditService.record).toHaveBeenCalledTimes(1);
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: OUTLET_AUDIT_ACTIONS.PHOTO_ADDED,
          metadata: { count: 2 },
        }),
      );
    });

    it('rejects an empty files array with a 400 before calling the service', async () => {
      const { controller, outletService } = makeController();

      await expect(controller.addPhotos('outlet-1', [], {}, tokenUser, req)).rejects.toThrow(
        BadRequestException,
      );
      expect(outletService.addPhotos).not.toHaveBeenCalled();
    });
  });

  describe('removePhoto', () => {
    it('records a photo_removed audit entry', async () => {
      const { controller, outletService, auditService } = makeController();
      outletService.removePhoto.mockResolvedValue(undefined);

      await controller.removePhoto('outlet-1', 'photo-1', tokenUser, req);

      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: OUTLET_AUDIT_ACTIONS.PHOTO_REMOVED }),
      );
    });
  });

  describe('activate / deactivate', () => {
    it('activates and records an audit entry', async () => {
      const { controller, outletService, auditService } = makeController();
      outletService.activate.mockResolvedValue(outlet);

      await controller.activate('outlet-1', tokenUser, req);

      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: OUTLET_AUDIT_ACTIONS.ACTIVATED }),
      );
    });

    it('deactivates and records an audit entry', async () => {
      const { controller, outletService, auditService } = makeController();
      outletService.deactivate.mockResolvedValue({ ...outlet, status: OutletStatus.INACTIVE });

      await controller.deactivate('outlet-1', tokenUser, req);

      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: OUTLET_AUDIT_ACTIONS.DEACTIVATED }),
      );
    });
  });

  describe('collection point', () => {
    it('enables and records an audit entry', async () => {
      const { controller, outletService, auditService } = makeController();
      outletService.enableCollectionPoint.mockResolvedValue({
        ...outlet,
        collectionPointStatus: CollectionPointStatus.ENABLED,
      });

      const result = await controller.enableCollectionPoint('outlet-1', tokenUser, req);

      expect(outletService.enableCollectionPoint).toHaveBeenCalledWith(
        'org-1',
        'outlet-1',
        'user-1',
      );
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: OUTLET_AUDIT_ACTIONS.COLLECTION_POINT_ENABLED }),
      );
      expect(result.collectionPointStatus).toBe('ENABLED');
    });

    it('disables and records an audit entry', async () => {
      const { controller, outletService, auditService } = makeController();
      outletService.disableCollectionPoint.mockResolvedValue(outlet);

      await controller.disableCollectionPoint('outlet-1', tokenUser, req);

      expect(outletService.disableCollectionPoint).toHaveBeenCalledWith(
        'org-1',
        'outlet-1',
        'user-1',
      );
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: OUTLET_AUDIT_ACTIONS.COLLECTION_POINT_DISABLED }),
      );
    });

    it('updates configuration, records an audit entry with before/after metadata, and never leaks the responsible-user id as a raw relation', async () => {
      const { controller, outletService, auditService } = makeController();
      outletService.getById.mockResolvedValue(outlet);
      outletService.updateCollectionPointConfig.mockResolvedValue({
        ...outlet,
        collectionPointResponsibleUserId: 'user-2',
        collectionPointOperatingHours: 'Mon-Sat 9am-6pm',
      });

      const result = await controller.updateCollectionPointConfig(
        'outlet-1',
        { responsibleUserId: 'user-2', operatingHours: 'Mon-Sat 9am-6pm' },
        tokenUser,
        req,
      );

      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: OUTLET_AUDIT_ACTIONS.COLLECTION_POINT_CONFIG_UPDATED,
          metadata: expect.objectContaining({
            fields: ['responsibleUserId', 'operatingHours'],
            before: {
              collectionPointResponsibleUserId: null,
              collectionPointOperatingHours: null,
              inventoryLocationId: null,
            },
          }),
        }),
      );
      expect(result.collectionPointResponsibleUserId).toBe('user-2');
      expect(result.collectionPointOperatingHours).toBe('Mon-Sat 9am-6pm');
    });
  });

  describe('listRepresentatives', () => {
    it('lists only ACTIVE users as candidate responsible representatives', async () => {
      const { controller, userService } = makeController();
      userService.listByOrganisation.mockResolvedValue([
        {
          id: 'user-2',
          firstName: 'Ada',
          lastName: 'Okafor',
          email: 'ada@example.com',
        } as never,
      ]);

      const result = await controller.listRepresentatives(tokenUser);

      expect(userService.listByOrganisation).toHaveBeenCalledWith('org-1', { status: 'ACTIVE' });
      expect(result.items).toEqual([{ id: 'user-2', firstName: 'Ada', lastName: 'Okafor' }]);
    });
  });
});
