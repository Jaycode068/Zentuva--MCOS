import { ForbiddenException } from '@nestjs/common';

import { PermissionsGuard } from './permissions.guard';

const ORG = 'org-1';
const USER = 'user-1';

function makeContext(
  requiredPermission: string | undefined,
  user?: { sub: string; organisationId: string },
) {
  const reflector = { get: jest.fn(() => requiredPermission) };
  const request = { user };
  const context = {
    getHandler: () => ({}),
    switchToHttp: () => ({ getRequest: () => request }),
  };
  return { reflector, context };
}

describe('PermissionsGuard', () => {
  it('allows a route with no @RequirePermission metadata', async () => {
    const { reflector, context } = makeContext(undefined);
    const resolver = { resolve: jest.fn() };
    const guard = new PermissionsGuard(reflector as never, resolver as never);
    await expect(guard.canActivate(context as never)).resolves.toBe(true);
    expect(resolver.resolve).not.toHaveBeenCalled();
  });

  it('rejects when there is no authenticated user on the request', async () => {
    const { reflector, context } = makeContext('finance.journal.post', undefined);
    const resolver = { resolve: jest.fn() };
    const guard = new PermissionsGuard(reflector as never, resolver as never);
    await expect(guard.canActivate(context as never)).rejects.toThrow(ForbiddenException);
  });

  it('allows when the resolved access grants the required permission', async () => {
    const { reflector, context } = makeContext('finance.journal.post', {
      sub: USER,
      organisationId: ORG,
    });
    const resolver = {
      resolve: jest.fn(async () => ({ isOwnerBypass: true, grants: new Map() })),
    };
    const guard = new PermissionsGuard(reflector as never, resolver as never);
    await expect(guard.canActivate(context as never)).resolves.toBe(true);
  });

  it('rejects when the resolved access does not grant the required permission', async () => {
    const { reflector, context } = makeContext('finance.journal.post', {
      sub: USER,
      organisationId: ORG,
    });
    const resolver = {
      resolve: jest.fn(async () => ({ isOwnerBypass: false, grants: new Map() })),
    };
    const guard = new PermissionsGuard(reflector as never, resolver as never);
    await expect(guard.canActivate(context as never)).rejects.toThrow(ForbiddenException);
  });
});
