import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Organisation, Role, UserRole, UserStatus } from '@prisma/client';
import { Request } from 'express';

import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { TokenPayload } from '../auth/ports/token.port';
import { OrganisationService } from '../organisation/organisation.service';
import { UserWithRoles } from '../user/user.repository';
import { UserService } from '../user/user.service';
import { ACCOUNT_AUDIT_ACTIONS } from './account-audit-actions';
import { AccountController } from './account.controller';

describe('AccountController', () => {
  const tokenUser: TokenPayload = {
    sub: 'user-1',
    organisationId: 'org-1',
    sessionId: 'session-1',
  };

  const role: Role = {
    id: 'role-owner',
    organisationId: 'org-1',
    name: 'Owner',
    description: null,
    isSystem: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };

  const userRole: UserRole = {
    id: 'user-role-1',
    userId: 'user-1',
    roleId: 'role-owner',
    organisationId: 'org-1',
    assignedById: null,
    assignedAt: new Date('2026-01-01'),
  };

  const account: UserWithRoles = {
    id: 'user-1',
    organisationId: 'org-1',
    email: 'amina@saharatextiles.com',
    employeeCode: 'EMP-01',
    firstName: 'Amina',
    lastName: 'Yusuf',
    phoneNumber: '+2348012345678',
    avatarUrl: null,
    avatarKey: null,
    passwordHash: 'hashed',
    status: UserStatus.ACTIVE,
    failedLoginAttempts: 0,
    mustChangePassword: false,
    passwordChangedAt: new Date('2026-01-05'),
    emailVerifiedAt: new Date('2026-01-01'),
    lastLoginAt: new Date('2026-01-10'),
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-05'),
    userRoles: [{ ...userRole, role }],
  };

  const organisation: Organisation = {
    id: 'org-1',
    name: 'Sahara Textiles Ltd',
    slug: 'sahara-textiles-ltd',
    organisationCode: 'SAH-0001',
    businessEmail: 'hello@saharatextiles.com',
    country: 'Nigeria',
    status: 'ACTIVE',
    displayName: null,
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
    settings: {},
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };

  function makeController() {
    const userService = {
      getByIdWithRoles: jest.fn(),
      updateProfile: jest.fn(),
      setAvatar: jest.fn(),
      removeAvatar: jest.fn(),
    } as unknown as jest.Mocked<UserService>;
    const organisationService = {
      getById: jest.fn(),
    } as unknown as jest.Mocked<OrganisationService>;
    const authService = {
      changePassword: jest.fn(),
      listSessions: jest.fn(),
      revokeSession: jest.fn(),
    } as unknown as jest.Mocked<AuthService>;
    const auditService = { record: jest.fn() } as unknown as jest.Mocked<AuditService>;
    const config = {
      get: jest.fn().mockReturnValue(2 * 1024 * 1024),
    } as unknown as ConfigService;

    const controller = new AccountController(
      userService,
      organisationService,
      authService,
      auditService,
      config,
    );
    return { controller, userService, organisationService, authService, auditService };
  }

  describe('getProfile', () => {
    it('combines the user, its role, and its organisation into one response', async () => {
      const { controller, userService, organisationService } = makeController();
      userService.getByIdWithRoles.mockResolvedValue(account);
      organisationService.getById.mockResolvedValue(organisation);

      const result = await controller.getProfile(tokenUser);

      expect(userService.getByIdWithRoles).toHaveBeenCalledWith('org-1', 'user-1');
      expect(result).toEqual({
        id: 'user-1',
        firstName: 'Amina',
        lastName: 'Yusuf',
        phoneNumber: '+2348012345678',
        avatarUrl: null,
        employeeCode: 'EMP-01',
        email: 'amina@saharatextiles.com',
        role: 'Owner',
        organisation: { id: 'org-1', name: 'Sahara Textiles Ltd', organisationCode: 'SAH-0001' },
        status: UserStatus.ACTIVE,
        joinedAt: account.createdAt,
        lastLoginAt: account.lastLoginAt,
        failedLoginAttempts: 0,
        passwordChangedAt: account.passwordChangedAt,
        mustChangePassword: false,
      });
    });

    it('throws NotFoundException when the user no longer exists', async () => {
      const { controller, userService } = makeController();
      userService.getByIdWithRoles.mockResolvedValue(null);

      await expect(controller.getProfile(tokenUser)).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateProfile', () => {
    it('updates the profile and records an audit entry', async () => {
      const { controller, userService, organisationService, auditService } = makeController();
      userService.getByIdWithRoles.mockResolvedValue(account);
      organisationService.getById.mockResolvedValue(organisation);
      const req = { ip: '127.0.0.1', headers: { 'user-agent': 'jest' } } as unknown as Request;

      const result = await controller.updateProfile(
        { firstName: 'Amina', lastName: 'Bello', phoneNumber: '+2348099999999' },
        tokenUser,
        req,
      );

      expect(userService.updateProfile).toHaveBeenCalledWith('org-1', 'user-1', {
        firstName: 'Amina',
        lastName: 'Bello',
        phoneNumber: '+2348099999999',
      });
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: ACCOUNT_AUDIT_ACTIONS.PROFILE_UPDATED,
          actorUserId: 'user-1',
          organisationId: 'org-1',
        }),
      );
      expect(result.role).toBe('Owner');
    });
  });

  describe('changePassword', () => {
    it('delegates to AuthService.changePassword with the current session id', async () => {
      const { controller, authService } = makeController();
      const req = { ip: '127.0.0.1', headers: { 'user-agent': 'jest' } } as unknown as Request;

      await controller.changePassword(
        { currentPassword: 'OldPass1!', newPassword: 'NewPass1!', confirmPassword: 'NewPass1!' },
        tokenUser,
        req,
      );

      expect(authService.changePassword).toHaveBeenCalledWith(
        'org-1',
        'user-1',
        'session-1',
        'OldPass1!',
        'NewPass1!',
        { ipAddress: '127.0.0.1', userAgent: 'jest' },
      );
    });
  });

  describe('listSessions', () => {
    it('maps sessions and flags the current one', async () => {
      const { controller, authService } = makeController();
      authService.listSessions.mockResolvedValue([
        {
          id: 'session-1',
          userId: 'user-1',
          organisationId: 'org-1',
          userAgent: 'jest',
          ipAddress: '127.0.0.1',
          createdAt: new Date('2026-01-01'),
          lastUsedAt: new Date('2026-01-02'),
          revokedAt: null,
        },
        {
          id: 'session-2',
          userId: 'user-1',
          organisationId: 'org-1',
          userAgent: 'other-device',
          ipAddress: '10.0.0.1',
          createdAt: new Date('2026-01-01'),
          lastUsedAt: new Date('2026-01-01'),
          revokedAt: null,
        },
      ]);

      const result = await controller.listSessions(tokenUser);

      expect(result.items).toHaveLength(2);
      expect(result.items[0]).toMatchObject({ id: 'session-1', isCurrent: true });
      expect(result.items[1]).toMatchObject({ id: 'session-2', isCurrent: false });
    });
  });

  describe('revokeSession', () => {
    it('reports wasCurrentSession accurately', async () => {
      const { controller, authService } = makeController();

      const currentResult = await controller.revokeSession('session-1', tokenUser);
      expect(authService.revokeSession).toHaveBeenCalledWith('org-1', 'user-1', 'session-1');
      expect(currentResult).toEqual({ revoked: true, wasCurrentSession: true });

      const otherResult = await controller.revokeSession('session-2', tokenUser);
      expect(otherResult).toEqual({ revoked: true, wasCurrentSession: false });
    });
  });

  describe('uploadAvatar', () => {
    it('rejects a missing file', async () => {
      const { controller } = makeController();
      const req = { ip: '127.0.0.1', headers: {} } as unknown as Request;

      await expect(controller.uploadAvatar(undefined, tokenUser, req)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects a disallowed mime type without calling the service', async () => {
      const { controller, userService } = makeController();
      const file = { mimetype: 'image/gif', size: 1000 } as Express.Multer.File;
      const req = { ip: '127.0.0.1', headers: {} } as unknown as Request;

      await expect(controller.uploadAvatar(file, tokenUser, req)).rejects.toThrow(
        BadRequestException,
      );
      expect(userService.setAvatar).not.toHaveBeenCalled();
    });

    it('uploads a valid file and records an audit entry', async () => {
      const { controller, userService, organisationService, auditService } = makeController();
      userService.setAvatar.mockResolvedValue({ ...account, avatarUrl: 'https://cdn.test/a.png' });
      userService.getByIdWithRoles.mockResolvedValue({
        ...account,
        avatarUrl: 'https://cdn.test/a.png',
      });
      organisationService.getById.mockResolvedValue(organisation);
      const file = {
        mimetype: 'image/png',
        size: 1000,
        buffer: Buffer.from('x'),
      } as Express.Multer.File;
      const req = { ip: '127.0.0.1', headers: { 'user-agent': 'jest' } } as unknown as Request;

      const result = await controller.uploadAvatar(file, tokenUser, req);

      expect(userService.setAvatar).toHaveBeenCalledWith('org-1', 'user-1', {
        mimeType: 'image/png',
        buffer: file.buffer,
      });
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: ACCOUNT_AUDIT_ACTIONS.AVATAR_UPLOADED }),
      );
      expect(result.avatarUrl).toBe('https://cdn.test/a.png');
    });
  });

  describe('deleteAvatar', () => {
    it('removes the avatar and records an audit entry', async () => {
      const { controller, userService, organisationService, auditService } = makeController();
      userService.removeAvatar.mockResolvedValue(account);
      userService.getByIdWithRoles.mockResolvedValue(account);
      organisationService.getById.mockResolvedValue(organisation);
      const req = { ip: '127.0.0.1', headers: { 'user-agent': 'jest' } } as unknown as Request;

      await controller.deleteAvatar(tokenUser, req);

      expect(userService.removeAvatar).toHaveBeenCalledWith('org-1', 'user-1');
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: ACCOUNT_AUDIT_ACTIONS.AVATAR_REMOVED }),
      );
    });
  });
});
