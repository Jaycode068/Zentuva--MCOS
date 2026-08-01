import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Organisation } from '@prisma/client';
import { Request } from 'express';

import { AuditService } from '../audit/audit.service';
import { TokenPayload } from '../auth/ports/token.port';
import { OrganisationService } from '../organisation/organisation.service';
import { WORKSPACE_AUDIT_ACTIONS } from '../organisation/workspace-audit-actions';
import { SettingsController } from './settings.controller';

describe('SettingsController', () => {
  const user: TokenPayload = { sub: 'user-1', organisationId: 'org-1', sessionId: 'session-1' };

  const organisation: Organisation = {
    id: 'org-1',
    name: 'Sahara Textiles Ltd',
    slug: 'sahara-textiles-ltd',
    organisationCode: 'SAH-0001',
    businessEmail: 'hello@saharatextiles.com',
    country: 'Nigeria',
    status: 'ACTIVE',
    displayName: 'Sahara',
    logoUrl: null,
    darkLogoUrl: null,
    description: null,
    industry: null,
    businessType: null,
    phone: null,
    website: null,
    supportEmail: null,
    addressLine1: null,
    addressLine2: null,
    city: null,
    state: null,
    postalCode: null,
    currency: 'USD',
    timeZone: 'UTC',
    fiscalYearStart: 1,
    dateFormat: 'YYYY-MM-DD',
    timeFormat: 'HH:mm',
    numberFormat: '1,234.56',
    primaryColor: null,
    accentColor: null,
    registrationNumber: null,
    taxId: null,
    employeeCount: null,
    settings: { theme: 'system' },
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };

  function makeController() {
    const organisationService = {
      getById: jest.fn(),
      updateWorkspaceSettings: jest.fn(),
      setLogo: jest.fn(),
      removeLogo: jest.fn(),
    } as unknown as jest.Mocked<OrganisationService>;
    const auditService = { record: jest.fn() } as unknown as jest.Mocked<AuditService>;
    const config = {
      get: jest.fn().mockReturnValue(2 * 1024 * 1024),
    } as unknown as ConfigService;

    const controller = new SettingsController(organisationService, auditService, config);
    return { controller, organisationService, auditService };
  }

  describe('getWorkspace', () => {
    it('returns the mapped workspace settings, merging defaulted theme/preferences', async () => {
      const { controller, organisationService } = makeController();
      organisationService.getById.mockResolvedValue(organisation);

      const result = await controller.getWorkspace(user);

      expect(organisationService.getById).toHaveBeenCalledWith('org-1');
      expect(result.organisationName).toBe('Sahara Textiles Ltd');
      expect(result.theme).toBe('system');
      expect(result.preferences).toEqual(
        expect.objectContaining({ animationsEnabled: true, aiFeatures: false }),
      );
    });

    it('throws NotFoundException when the organisation no longer exists', async () => {
      const { controller, organisationService } = makeController();
      organisationService.getById.mockResolvedValue(null);

      await expect(controller.getWorkspace(user)).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateWorkspace', () => {
    it('maps wire field names to domain field names, updates, and records an audit entry', async () => {
      const { controller, organisationService, auditService } = makeController();
      const updated = { ...organisation, businessType: 'Textile Manufacturing' };
      organisationService.updateWorkspaceSettings.mockResolvedValue(updated);
      const req = { ip: '127.0.0.1', headers: { 'user-agent': 'jest' } } as unknown as Request;

      const result = await controller.updateWorkspace(
        { manufacturingSector: 'Textile Manufacturing', theme: 'dark' },
        user,
        req,
      );

      expect(organisationService.updateWorkspaceSettings).toHaveBeenCalledWith('org-1', {
        businessType: 'Textile Manufacturing',
        theme: 'dark',
      });
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: WORKSPACE_AUDIT_ACTIONS.UPDATED,
          organisationId: 'org-1',
          actorUserId: 'user-1',
        }),
      );
      expect(result.manufacturingSector).toBe('Textile Manufacturing');
    });
  });

  describe('uploadLogo', () => {
    it('rejects a disallowed mime type without calling the service', async () => {
      const { controller, organisationService } = makeController();
      const file = { mimetype: 'image/gif', size: 1000 } as Express.Multer.File;
      const req = { ip: '127.0.0.1', headers: {} } as unknown as Request;

      await expect(controller.uploadLogo(file, 'light', user, req)).rejects.toThrow(
        BadRequestException,
      );
      expect(organisationService.setLogo).not.toHaveBeenCalled();
    });

    it('rejects a file over the configured max size', async () => {
      const { controller } = makeController();
      const file = { mimetype: 'image/png', size: 10 * 1024 * 1024 } as Express.Multer.File;
      const req = { ip: '127.0.0.1', headers: {} } as unknown as Request;

      await expect(controller.uploadLogo(file, 'light', user, req)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects a missing file', async () => {
      const { controller } = makeController();
      const req = { ip: '127.0.0.1', headers: {} } as unknown as Request;

      await expect(controller.uploadLogo(undefined, 'light', user, req)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects an invalid variant', async () => {
      const { controller } = makeController();
      const file = { mimetype: 'image/png', size: 1000 } as Express.Multer.File;
      const req = { ip: '127.0.0.1', headers: {} } as unknown as Request;

      await expect(controller.uploadLogo(file, 'sepia', user, req)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('uploads a valid file and records an audit entry', async () => {
      const { controller, organisationService, auditService } = makeController();
      const updated = { ...organisation, logoUrl: 'https://cdn.test/logo.png' };
      organisationService.setLogo.mockResolvedValue(updated);
      const file = {
        mimetype: 'image/png',
        size: 1000,
        buffer: Buffer.from('x'),
      } as Express.Multer.File;
      const req = { ip: '127.0.0.1', headers: { 'user-agent': 'jest' } } as unknown as Request;

      const result = await controller.uploadLogo(file, 'light', user, req);

      expect(organisationService.setLogo).toHaveBeenCalledWith('org-1', 'light', {
        mimeType: 'image/png',
        buffer: file.buffer,
      });
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: WORKSPACE_AUDIT_ACTIONS.LOGO_UPLOADED }),
      );
      expect(result.logoUrl).toBe('https://cdn.test/logo.png');
    });
  });

  describe('deleteLogo', () => {
    it('removes the logo and records an audit entry', async () => {
      const { controller, organisationService, auditService } = makeController();
      organisationService.removeLogo.mockResolvedValue(organisation);
      const req = { ip: '127.0.0.1', headers: { 'user-agent': 'jest' } } as unknown as Request;

      await controller.deleteLogo('dark', user, req);

      expect(organisationService.removeLogo).toHaveBeenCalledWith('org-1', 'dark');
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: WORKSPACE_AUDIT_ACTIONS.LOGO_REMOVED }),
      );
    });
  });
});
