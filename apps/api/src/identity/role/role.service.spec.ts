import { AppError } from '@zentuva/utils';

import { RoleService } from './role.service';

const ORG = 'org-1';

function makePermission(key: string, scopeType: 'NONE' | 'SCOPABLE' = 'NONE') {
  return { id: `perm-${key}`, key, scopeType, domain: key.split('.')[0] };
}

function makeRepository(options?: {
  roles?: Record<string, Record<string, unknown>>;
  permissions?: Record<string, ReturnType<typeof makePermission>>;
}) {
  const roles: Record<string, Record<string, unknown>> = options?.roles ?? {
    'role-1': {
      id: 'role-1',
      organisationId: ORG,
      name: 'Finance Staff',
      isSystem: false,
      status: 'ACTIVE',
    },
  };
  const permissions: Record<string, ReturnType<typeof makePermission>> = options?.permissions ?? {
    'finance.trial_balance.view': makePermission('finance.trial_balance.view', 'NONE'),
    'finance.payment.create': makePermission('finance.payment.create', 'SCOPABLE'),
  };

  const setPermissionsCalls: unknown[] = [];

  const repository = {
    findById: jest.fn(async (org: string, id: string) => {
      const r = roles[id];
      return r && r.organisationId === org ? r : null;
    }),
    findByName: jest.fn(async () => null),
    create: jest.fn(async (data: Record<string, unknown>) => {
      const id = `role-${Object.keys(roles).length + 1}`;
      const created = { id, status: 'ACTIVE', isSystem: false, ...data };
      roles[id] = created;
      return created;
    }),
    setStatus: jest.fn(async (org: string, id: string, status: string) => {
      const r = roles[id];
      if (!r || r.organisationId !== org) throw new AppError('not found', 404, 'ROLE_NOT_FOUND');
      if (r.isSystem) throw new AppError('System roles cannot be archived', 403, 'ROLE_IS_SYSTEM');
      roles[id] = { ...r, status };
      return roles[id];
    }),
    setPermissions: jest.fn(async (roleId: string, grants: unknown[]) => {
      setPermissionsCalls.push({ roleId, grants });
      return { count: grants.length };
    }),
    findPermissionsByKeys: jest.fn(async (keys: string[]) =>
      keys.map((k) => permissions[k]).filter(Boolean),
    ),
    findRolePermissionsForRole: jest.fn(async (roleId: string) => [
      {
        roleId,
        permissionId: 'perm-finance.trial_balance.view',
        scope: null,
        permission: permissions['finance.trial_balance.view'],
      },
    ]),
  };

  const service = new RoleService(repository as never);
  return { service, repository, setPermissionsCalls };
}

describe('RoleService — scope-aware permission grants', () => {
  it('rejects granting a SCOPABLE permission without an explicit scope', async () => {
    const { service } = makeRepository();
    await expect(
      service.setRolePermissions(ORG, 'role-1', [{ permissionKey: 'finance.payment.create' }]),
    ).rejects.toThrow('requires an explicit scope');
  });

  it('rejects supplying a scope for a NONE-scopeType permission', async () => {
    const { service } = makeRepository();
    await expect(
      service.setRolePermissions(ORG, 'role-1', [
        { permissionKey: 'finance.trial_balance.view', scope: 'ORGANISATION' as never },
      ]),
    ).rejects.toThrow('cannot be scoped');
  });

  it('accepts a SCOPABLE permission with an explicit scope', async () => {
    const { service, setPermissionsCalls } = makeRepository();
    await service.setRolePermissions(ORG, 'role-1', [
      { permissionKey: 'finance.payment.create', scope: 'NONE' as never },
    ]);
    expect(setPermissionsCalls).toHaveLength(1);
  });

  it('rejects editing permissions on a system role', async () => {
    const { service } = makeRepository({
      roles: {
        'role-1': {
          id: 'role-1',
          organisationId: ORG,
          name: 'Owner',
          isSystem: true,
          status: 'ACTIVE',
        },
      },
    });
    await expect(
      service.setRolePermissions(ORG, 'role-1', [{ permissionKey: 'finance.trial_balance.view' }]),
    ).rejects.toThrow('System roles cannot have their permissions edited');
  });

  it('rejects an unknown permission key', async () => {
    const { service } = makeRepository();
    await expect(
      service.setRolePermissions(ORG, 'role-1', [{ permissionKey: 'not.a.real.permission' }]),
    ).rejects.toThrow('Unknown permission');
  });
});

describe('RoleService — archive/restore', () => {
  it('archiving a custom role sets status to ARCHIVED', async () => {
    const { service } = makeRepository();
    const archived = await service.archiveRole(ORG, 'role-1');
    expect(archived.status).toBe('ARCHIVED');
  });

  it('rejects archiving a system role', async () => {
    const { service } = makeRepository({
      roles: {
        'role-1': {
          id: 'role-1',
          organisationId: ORG,
          name: 'Administrator',
          isSystem: true,
          status: 'ACTIVE',
        },
      },
    });
    await expect(service.archiveRole(ORG, 'role-1')).rejects.toThrow(
      'System roles cannot be archived',
    );
  });

  it('restoring a role sets status back to ACTIVE', async () => {
    const { service } = makeRepository({
      roles: {
        'role-1': {
          id: 'role-1',
          organisationId: ORG,
          name: 'Finance Staff',
          isSystem: false,
          status: 'ARCHIVED',
        },
      },
    });
    const restored = await service.restoreRole(ORG, 'role-1');
    expect(restored.status).toBe('ACTIVE');
  });
});

describe('RoleService — duplicateRole', () => {
  it('copies the source role’s permission grants (with scope) into a new custom role', async () => {
    const { service, repository } = makeRepository();
    const duplicate = await service.duplicateRole(ORG, 'role-1', 'Finance Staff (copy)');
    expect(duplicate.name).toBe('Finance Staff (copy)');
    expect(duplicate.isSystem).toBe(false);
    expect(repository.setPermissions).toHaveBeenCalledWith(
      duplicate.id,
      expect.arrayContaining([
        expect.objectContaining({ permissionId: 'perm-finance.trial_balance.view' }),
      ]),
    );
  });

  it('rejects duplicating into a name that already exists', async () => {
    const { service, repository } = makeRepository();
    repository.findByName = jest.fn(async () => ({ id: 'existing' }) as never);
    await expect(service.duplicateRole(ORG, 'role-1', 'Finance Staff')).rejects.toThrow(
      'already exists',
    );
  });
});
