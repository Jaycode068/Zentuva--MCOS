import { NotFoundException } from '@nestjs/common';
import { Role, UserRole, UserStatus } from '@prisma/client';
import { Request } from 'express';

import { AuditService } from '../audit/audit.service';
import { TokenPayload } from '../auth/ports/token.port';
import { USER_AUDIT_ACTIONS } from './user-audit-actions';
import { UserController } from './user.controller';
import { UserWithRoles } from './user.repository';
import { UserService } from './user.service';

describe('UserController', () => {
  const caller: TokenPayload = { sub: 'actor-1', organisationId: 'org-1', sessionId: 'session-1' };

  const role: Role = {
    id: 'role-admin',
    organisationId: 'org-1',
    name: 'Administrator',
    description: null,
    isSystem: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };

  const userRole: UserRole = {
    id: 'user-role-1',
    userId: 'user-1',
    roleId: 'role-admin',
    organisationId: 'org-1',
    assignedById: null,
    assignedAt: new Date('2026-01-01'),
  };

  const user: UserWithRoles = {
    id: 'user-1',
    organisationId: 'org-1',
    email: 'jane@bobybites.local',
    employeeCode: 'EMP-01',
    firstName: 'Jane',
    lastName: 'Doe',
    phoneNumber: null,
    passwordHash: 'hashed',
    status: UserStatus.ACTIVE,
    failedLoginAttempts: 0,
    mustChangePassword: false,
    passwordChangedAt: null,
    emailVerifiedAt: new Date('2026-01-01'),
    lastLoginAt: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-02'),
    userRoles: [{ ...userRole, role }],
  };

  function makeController() {
    const userService = {
      listWithRoles: jest.fn(),
      getByIdWithRoles: jest.fn(),
      createUser: jest.fn(),
      updateUser: jest.fn(),
    } as unknown as UserService;
    const auditService = { record: jest.fn() } as unknown as AuditService;
    const controller = new UserController(userService, auditService);
    return { controller, userService, auditService };
  }

  const req = { ip: '127.0.0.1', headers: { 'user-agent': 'jest' } } as unknown as Request;

  describe('list', () => {
    it('returns mapped users for the caller organisation', async () => {
      const { controller, userService } = makeController();
      (userService.listWithRoles as jest.Mock).mockResolvedValue([user]);

      const result = await controller.list(caller);

      expect(userService.listWithRoles).toHaveBeenCalledWith('org-1');
      expect(result.items).toEqual([
        {
          id: 'user-1',
          firstName: 'Jane',
          lastName: 'Doe',
          email: 'jane@bobybites.local',
          employeeCode: 'EMP-01',
          role: 'Administrator',
          status: 'ACTIVE',
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
        },
      ]);
    });
  });

  describe('getOne', () => {
    it('throws NotFoundException when the user does not exist in this organisation', async () => {
      const { controller, userService } = makeController();
      (userService.getByIdWithRoles as jest.Mock).mockResolvedValue(null);

      await expect(controller.getOne(caller, 'missing')).rejects.toThrow(NotFoundException);
    });

    it('returns the mapped user when found', async () => {
      const { controller, userService } = makeController();
      (userService.getByIdWithRoles as jest.Mock).mockResolvedValue(user);

      const result = await controller.getOne(caller, 'user-1');

      expect(userService.getByIdWithRoles).toHaveBeenCalledWith('org-1', 'user-1');
      expect(result.role).toBe('Administrator');
    });
  });

  describe('create', () => {
    it('creates a user and records a CREATED audit entry', async () => {
      const { controller, userService, auditService } = makeController();
      (userService.createUser as jest.Mock).mockResolvedValue(user);

      const result = await controller.create(
        {
          firstName: 'Jane',
          lastName: 'Doe',
          email: 'jane@bobybites.local',
          role: 'Administrator',
          temporaryPassword: 'temp12345',
        },
        caller,
        req,
      );

      expect(userService.createUser).toHaveBeenCalledWith(
        'org-1',
        expect.objectContaining({ email: 'jane@bobybites.local' }),
      );
      expect(auditService.record).toHaveBeenCalledWith({
        action: USER_AUDIT_ACTIONS.CREATED,
        entityType: 'User',
        entityId: 'user-1',
        organisationId: 'org-1',
        actorUserId: 'actor-1',
        ipAddress: '127.0.0.1',
        userAgent: 'jest',
      });
      expect(result.role).toBe('Administrator');
    });
  });

  describe('update', () => {
    it.each([
      ['ACTIVE', USER_AUDIT_ACTIONS.ACTIVATED],
      ['INACTIVE', USER_AUDIT_ACTIONS.DEACTIVATED],
      ['LOCKED', USER_AUDIT_ACTIONS.DEACTIVATED],
    ] as const)('records a status change to %s as %s', async (status, expectedAction) => {
      const { controller, userService, auditService } = makeController();
      (userService.updateUser as jest.Mock).mockResolvedValue(user);

      await controller.update('user-1', { status }, caller, req);

      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: expectedAction }),
      );
    });

    it('records a generic UPDATED action for non-status changes', async () => {
      const { controller, userService, auditService } = makeController();
      (userService.updateUser as jest.Mock).mockResolvedValue(user);

      await controller.update('user-1', { firstName: 'Janet' }, caller, req);

      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: USER_AUDIT_ACTIONS.UPDATED }),
      );
      expect(userService.updateUser).toHaveBeenCalledWith('org-1', 'user-1', {
        firstName: 'Janet',
      });
    });
  });
});
