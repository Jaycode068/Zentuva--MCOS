import { ForbiddenException } from '@nestjs/common';

import { CommonAccessGuard } from './common-access.guard';

const ORG = 'org-1';

function makeContext(capability: string | undefined, hasUser = true) {
  const reflector = { get: jest.fn(() => capability) };
  const request = { user: hasUser ? { sub: 'user-1', organisationId: ORG } : undefined };
  const context = {
    getHandler: () => ({}),
    switchToHttp: () => ({ getRequest: () => request }),
  };
  return { reflector, context };
}

describe('CommonAccessGuard', () => {
  it('allows a route with no @RequireCommonAccess metadata', async () => {
    const { reflector, context } = makeContext(undefined);
    const organisationService = { getById: jest.fn() };
    const guard = new CommonAccessGuard(reflector as never, organisationService as never);
    await expect(guard.canActivate(context as never)).resolves.toBe(true);
    expect(organisationService.getById).not.toHaveBeenCalled();
  });

  it('rejects when there is no authenticated user', async () => {
    const { reflector, context } = makeContext('selfSignIn', false);
    const organisationService = { getById: jest.fn() };
    const guard = new CommonAccessGuard(reflector as never, organisationService as never);
    await expect(guard.canActivate(context as never)).rejects.toThrow(ForbiddenException);
  });

  it('allows when the capability is enabled (default policy)', async () => {
    const { reflector, context } = makeContext('selfSignIn');
    const organisationService = { getById: jest.fn(async () => ({ settings: {} })) };
    const guard = new CommonAccessGuard(reflector as never, organisationService as never);
    await expect(guard.canActivate(context as never)).resolves.toBe(true);
  });

  it('rejects when the organisation has disabled the capability', async () => {
    const { reflector, context } = makeContext('selfSignIn');
    const organisationService = {
      getById: jest.fn(async () => ({
        settings: { commonEmployeeAccess: { selfSignIn: false } },
      })),
    };
    const guard = new CommonAccessGuard(reflector as never, organisationService as never);
    await expect(guard.canActivate(context as never)).rejects.toThrow(ForbiddenException);
  });
});
