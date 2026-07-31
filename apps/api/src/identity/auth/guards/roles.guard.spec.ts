import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { RoleService } from '../../role/role.service';
import { TokenPayload } from '../ports/token.port';
import { RolesGuard } from './roles.guard';

describe('RolesGuard', () => {
  const user: TokenPayload = { sub: 'user-1', organisationId: 'org-1', sessionId: 'session-1' };

  function makeContext(requiredRoles: string[] | undefined, reqUser: TokenPayload | undefined) {
    const reflector = { get: jest.fn().mockReturnValue(requiredRoles) } as unknown as Reflector;
    const context = {
      getHandler: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => ({ user: reqUser }),
      }),
    } as unknown as ExecutionContext;
    return { reflector, context };
  }

  it('allows the request through when the route declares no required roles', async () => {
    const roleService = { getRoleNamesForUser: jest.fn() } as unknown as RoleService;
    const { reflector, context } = makeContext(undefined, user);
    const guard = new RolesGuard(reflector, roleService);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(roleService.getRoleNamesForUser).not.toHaveBeenCalled();
  });

  it('allows the request through when the caller holds one of the required roles', async () => {
    const roleService = {
      getRoleNamesForUser: jest.fn().mockResolvedValue(['Administrator']),
    } as unknown as RoleService;
    const { reflector, context } = makeContext(['Owner', 'Administrator'], user);
    const guard = new RolesGuard(reflector, roleService);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(roleService.getRoleNamesForUser).toHaveBeenCalledWith('org-1', 'user-1');
  });

  it('rejects with Forbidden when the caller holds none of the required roles', async () => {
    const roleService = {
      getRoleNamesForUser: jest.fn().mockResolvedValue(['Member']),
    } as unknown as RoleService;
    const { reflector, context } = makeContext(['Owner', 'Administrator'], user);
    const guard = new RolesGuard(reflector, roleService);

    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
  });

  it('rejects with Forbidden when no authenticated user is attached to the request', async () => {
    const roleService = { getRoleNamesForUser: jest.fn() } as unknown as RoleService;
    const { reflector, context } = makeContext(['Owner'], undefined);
    const guard = new RolesGuard(reflector, roleService);

    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
    expect(roleService.getRoleNamesForUser).not.toHaveBeenCalled();
  });
});
