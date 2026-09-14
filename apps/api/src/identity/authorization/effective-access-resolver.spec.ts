import { EffectiveAccessResolver } from './effective-access-resolver';

const ORG = 'org-1';
const USER = 'user-1';

function makePermission(key: string, scopeType: 'NONE' | 'SCOPABLE') {
  return { id: `perm-${key}`, key, scopeType };
}

function makeRolePermission(
  roleId: string,
  roleName: string,
  permission: ReturnType<typeof makePermission>,
  scope?: string,
) {
  return {
    id: `rp-${roleId}-${permission.key}`,
    roleId,
    permissionId: permission.id,
    scope,
    permission,
    role: { id: roleId, name: roleName },
  };
}

function makeResolver(options: {
  user?: { status: string } | null;
  userRoles?: { role: { id: string; name: string; status: string } }[];
  rolePermissions?: ReturnType<typeof makeRolePermission>[];
}) {
  const user = options.user !== undefined ? options.user : { status: 'ACTIVE' };
  const userRoles = options.userRoles ?? [];
  const rolePermissions = options.rolePermissions ?? [];

  const roleRepository = {
    findUserRolesWithRole: jest.fn(async () => userRoles),
    findActiveRolePermissionsForUser: jest.fn(async () => rolePermissions),
  };
  const userService = {
    getById: jest.fn(async () => user),
  };

  const resolver = new EffectiveAccessResolver(roleRepository as never, userService as never);
  return { resolver, roleRepository };
}

describe('EffectiveAccessResolver — account status', () => {
  it('returns empty, inactive access when the user does not exist', async () => {
    const { resolver } = makeResolver({ user: null });
    const access = await resolver.resolve(ORG, USER);
    expect(access.userIsActive).toBe(false);
    expect(access.isOwnerBypass).toBe(false);
    expect(access.grants.size).toBe(0);
  });

  it('returns empty, inactive access for a SUSPENDED user', async () => {
    const { resolver } = makeResolver({ user: { status: 'SUSPENDED' } });
    const access = await resolver.resolve(ORG, USER);
    expect(access.userIsActive).toBe(false);
  });

  it('returns empty, inactive access for a DEACTIVATED user', async () => {
    const { resolver } = makeResolver({ user: { status: 'DEACTIVATED' } });
    const access = await resolver.resolve(ORG, USER);
    expect(access.userIsActive).toBe(false);
  });

  it('active user with zero role assignments has userIsActive true but no grants', async () => {
    const { resolver } = makeResolver({ userRoles: [] });
    const access = await resolver.resolve(ORG, USER);
    expect(access.userIsActive).toBe(true);
    expect(access.grants.size).toBe(0);
    expect(EffectiveAccessResolver.isGranted(access, 'finance.journal.post')).toBe(false);
  });
});

describe('EffectiveAccessResolver — Owner bypass', () => {
  it('a user with an active Owner role bypasses every permission check', async () => {
    const { resolver } = makeResolver({
      userRoles: [{ role: { id: 'role-owner', name: 'Owner', status: 'ACTIVE' } }],
    });
    const access = await resolver.resolve(ORG, USER);
    expect(access.isOwnerBypass).toBe(true);
    expect(EffectiveAccessResolver.isGranted(access, 'anything.at.all')).toBe(true);
    expect(
      EffectiveAccessResolver.isGrantedWithScope(access, 'anything.at.all', 'ASSIGNED_TERRITORY'),
    ).toBe(true);
  });

  it('an ARCHIVED Owner role does not bypass', async () => {
    const { resolver } = makeResolver({
      userRoles: [{ role: { id: 'role-owner', name: 'Owner', status: 'ARCHIVED' } }],
    });
    const access = await resolver.resolve(ORG, USER);
    expect(access.isOwnerBypass).toBe(false);
  });
});

describe('EffectiveAccessResolver — NONE-scopeType permissions', () => {
  it('is granted (organisation-wide) the moment the RolePermission row exists', async () => {
    const perm = makePermission('finance.journal.post', 'NONE');
    const { resolver } = makeResolver({
      userRoles: [{ role: { id: 'role-1', name: 'Head of Finance', status: 'ACTIVE' } }],
      rolePermissions: [makeRolePermission('role-1', 'Head of Finance', perm)],
    });
    const access = await resolver.resolve(ORG, USER);
    expect(EffectiveAccessResolver.isGranted(access, 'finance.journal.post')).toBe(true);
    expect(
      EffectiveAccessResolver.isGrantedWithScope(access, 'finance.journal.post', 'ORGANISATION'),
    ).toBe(true);
  });
});

describe('EffectiveAccessResolver — SCOPABLE permissions', () => {
  it('a SCOPABLE permission granted with scope NONE is not "granted" for guard purposes', async () => {
    const perm = makePermission('finance.payment.create', 'SCOPABLE');
    const { resolver } = makeResolver({
      userRoles: [{ role: { id: 'role-1', name: 'Finance Staff', status: 'ACTIVE' } }],
      rolePermissions: [makeRolePermission('role-1', 'Finance Staff', perm, 'NONE')],
    });
    const access = await resolver.resolve(ORG, USER);
    expect(EffectiveAccessResolver.isGranted(access, 'finance.payment.create')).toBe(false);
  });

  it('a SCOPABLE permission with a real scope is granted', async () => {
    const perm = makePermission('sales.order.view', 'SCOPABLE');
    const { resolver } = makeResolver({
      userRoles: [{ role: { id: 'role-1', name: 'Field Sales Agent', status: 'ACTIVE' } }],
      rolePermissions: [
        makeRolePermission('role-1', 'Field Sales Agent', perm, 'ASSIGNED_RECORDS'),
      ],
    });
    const access = await resolver.resolve(ORG, USER);
    expect(EffectiveAccessResolver.isGranted(access, 'sales.order.view')).toBe(true);
    expect(
      EffectiveAccessResolver.isGrantedWithScope(access, 'sales.order.view', 'ASSIGNED_RECORDS'),
    ).toBe(true);
    expect(EffectiveAccessResolver.isGrantedWithScope(access, 'sales.order.view', 'OWN_TEAM')).toBe(
      false,
    );
  });

  it('a permission not granted by any role returns false for isGranted/isGrantedWithScope', async () => {
    const { resolver } = makeResolver({
      userRoles: [{ role: { id: 'role-1', name: 'Field Sales Agent', status: 'ACTIVE' } }],
      rolePermissions: [],
    });
    const access = await resolver.resolve(ORG, USER);
    expect(EffectiveAccessResolver.isGranted(access, 'finance.journal.post')).toBe(false);
    expect(
      EffectiveAccessResolver.isGrantedWithScope(access, 'finance.journal.post', 'ORGANISATION'),
    ).toBe(false);
  });
});

describe('EffectiveAccessResolver — multiple roles', () => {
  it('unions scopes across two roles granting the same permission at different scopes', async () => {
    const perm = makePermission('sales.order.view', 'SCOPABLE');
    const { resolver } = makeResolver({
      userRoles: [
        { role: { id: 'role-1', name: 'Sales Team Lead', status: 'ACTIVE' } },
        { role: { id: 'role-2', name: 'Field Sales Agent', status: 'ACTIVE' } },
      ],
      rolePermissions: [
        makeRolePermission('role-1', 'Sales Team Lead', perm, 'OWN_TEAM'),
        makeRolePermission('role-2', 'Field Sales Agent', perm, 'ASSIGNED_RECORDS'),
      ],
    });
    const access = await resolver.resolve(ORG, USER);
    const grant = access.grants.get('sales.order.view');
    expect(grant?.scopes.sort()).toEqual(['ASSIGNED_RECORDS', 'OWN_TEAM']);
    expect(grant?.sourceRoleNames.sort()).toEqual(['Field Sales Agent', 'Sales Team Lead']);
  });

  it('removing one role (simulated by omitting it) removes only that role’s grant', async () => {
    const perm = makePermission('maintenance.work_order.complete', 'SCOPABLE');
    const withBoth = makeResolver({
      userRoles: [{ role: { id: 'role-2', name: 'Maintenance Manager', status: 'ACTIVE' } }],
      rolePermissions: [makeRolePermission('role-2', 'Maintenance Manager', perm, 'ORGANISATION')],
    });
    const access = await withBoth.resolver.resolve(ORG, USER);
    expect(EffectiveAccessResolver.isGranted(access, 'maintenance.work_order.complete')).toBe(true);

    const withNeither = makeResolver({ userRoles: [], rolePermissions: [] });
    const accessAfterRemoval = await withNeither.resolver.resolve(ORG, USER);
    expect(
      EffectiveAccessResolver.isGranted(accessAfterRemoval, 'maintenance.work_order.complete'),
    ).toBe(false);
  });
});
