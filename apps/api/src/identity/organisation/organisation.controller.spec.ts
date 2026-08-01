import { NotFoundException } from '@nestjs/common';
import { Organisation } from '@prisma/client';
import { Request } from 'express';

import { AuditService } from '../audit/audit.service';
import { TokenPayload } from '../auth/ports/token.port';
import { ORGANISATION_AUDIT_ACTIONS } from './organisation-audit-actions';
import { OrganisationController } from './organisation.controller';
import { OrganisationService } from './organisation.service';

describe('OrganisationController', () => {
  const user: TokenPayload = { sub: 'user-1', organisationId: 'org-1', sessionId: 'session-1' };

  const organisation: Organisation = {
    id: 'org-1',
    name: 'Boby Bites',
    slug: 'boby-bites',
    organisationCode: 'BBT-0001',
    businessEmail: 'admin@bobybites.com',
    country: 'Nigeria',
    status: 'ACTIVE',
    displayName: 'Boby Bites Ltd',
    logoUrl: null,
    darkLogoUrl: null,
    description: 'Snacks manufacturer',
    industry: 'Food & Beverage',
    businessType: null,
    phone: '+2348012345678',
    website: 'https://bobybites.com',
    supportEmail: null,
    addressLine1: '12 Marina Road',
    addressLine2: null,
    city: 'Lagos',
    state: 'Lagos',
    postalCode: null,
    currency: 'NGN',
    timeZone: 'Africa/Lagos',
    fiscalYearStart: 1,
    dateFormat: 'YYYY-MM-DD',
    timeFormat: 'HH:mm',
    numberFormat: '1,234.56',
    primaryColor: null,
    accentColor: null,
    registrationNumber: null,
    taxId: null,
    employeeCount: null,
    settings: {},
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  };

  function makeController() {
    const organisationService = {
      getById: jest.fn(),
      updateProfile: jest.fn(),
    } as unknown as OrganisationService;
    const auditService = { record: jest.fn() } as unknown as AuditService;
    const controller = new OrganisationController(organisationService, auditService);
    return { controller, organisationService, auditService };
  }

  describe('getMe', () => {
    it('returns the mapped profile for the authenticated organisation', async () => {
      const { controller, organisationService } = makeController();
      (organisationService.getById as jest.Mock).mockResolvedValue(organisation);

      const result = await controller.getMe(user);

      expect(organisationService.getById).toHaveBeenCalledWith('org-1');
      expect(result).toEqual({
        id: 'org-1',
        organisationCode: 'BBT-0001',
        slug: 'boby-bites',
        createdAt: organisation.createdAt,
        updatedAt: organisation.updatedAt,
        organisationName: 'Boby Bites',
        displayName: 'Boby Bites Ltd',
        description: 'Snacks manufacturer',
        email: 'admin@bobybites.com',
        phoneNumber: '+2348012345678',
        website: 'https://bobybites.com',
        country: 'Nigeria',
        state: 'Lagos',
        city: 'Lagos',
        addressLine: '12 Marina Road',
        industry: 'Food & Beverage',
        currency: 'NGN',
        timezone: 'Africa/Lagos',
      });
    });

    it('throws NotFoundException when the organisation no longer exists', async () => {
      const { controller, organisationService } = makeController();
      (organisationService.getById as jest.Mock).mockResolvedValue(null);

      await expect(controller.getMe(user)).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateMe', () => {
    it('maps wire field names to domain field names, updates, and records an audit entry', async () => {
      const { controller, organisationService, auditService } = makeController();
      const updated = { ...organisation, name: 'New Name' };
      (organisationService.updateProfile as jest.Mock).mockResolvedValue(updated);
      const req = { ip: '127.0.0.1', headers: { 'user-agent': 'jest' } } as unknown as Request;

      const result = await controller.updateMe(
        {
          organisationName: 'New Name',
          phoneNumber: '+2348000000000',
          addressLine: '1 New Street',
        },
        user,
        req,
      );

      expect(organisationService.updateProfile).toHaveBeenCalledWith('org-1', {
        name: 'New Name',
        phone: '+2348000000000',
        addressLine1: '1 New Street',
      });
      expect(auditService.record).toHaveBeenCalledWith({
        action: ORGANISATION_AUDIT_ACTIONS.UPDATED,
        entityType: 'Organisation',
        entityId: 'org-1',
        organisationId: 'org-1',
        actorUserId: 'user-1',
        ipAddress: '127.0.0.1',
        userAgent: 'jest',
      });
      expect(result.organisationName).toBe('New Name');
    });
  });
});
