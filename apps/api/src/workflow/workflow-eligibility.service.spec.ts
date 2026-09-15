import {
  EffectiveAccess,
  EffectiveAccessResolver,
} from '../identity/authorization/effective-access-resolver';
import { ScopeEvaluator } from '../identity/authorization/scope-evaluator';
import { UserService } from '../identity/user/user.service';
import { StepEligibilityInput, WorkflowEligibilityService } from './workflow-eligibility.service';

describe('WorkflowEligibilityService', () => {
  const baseAccess: EffectiveAccess = {
    userId: 'candidate-1',
    organisationId: 'org-1',
    userIsActive: true,
    isOwnerBypass: false,
    roles: [],
    grants: new Map(),
  };

  function makeService(access: EffectiveAccess, users: { id: string; status: string }[] = []) {
    const effectiveAccessResolver = {
      resolve: jest.fn().mockResolvedValue(access),
    } as unknown as jest.Mocked<EffectiveAccessResolver>;
    const scopeEvaluator = {
      hasAny: jest.fn((a: EffectiveAccess, key: string) =>
        EffectiveAccessResolver.isGranted(a, key),
      ),
      hasScope: jest.fn((a: EffectiveAccess, key: string, scope: string) =>
        EffectiveAccessResolver.isGrantedWithScope(a, key, scope as never),
      ),
    } as unknown as jest.Mocked<ScopeEvaluator>;
    const userService = {
      listWithRoles: jest.fn().mockResolvedValue(users),
    } as unknown as jest.Mocked<UserService>;
    return new WorkflowEligibilityService(effectiveAccessResolver, scopeEvaluator, userService);
  }

  function baseInput(overrides: Partial<StepEligibilityInput> = {}): StepEligibilityInput {
    return {
      organisationId: 'org-1',
      requiredPermission: 'procurement.purchase_order.approve',
      requiredScope: null,
      assignedUserId: null,
      requestedById: 'requester-1',
      allowSelfApproval: false,
      candidateUserId: 'candidate-1',
      ...overrides,
    };
  }

  it('denies the requester approving their own request by default', async () => {
    const service = makeService(baseAccess);

    const result = await service.checkStepEligibility(
      baseInput({ candidateUserId: 'requester-1', requestedById: 'requester-1' }),
    );

    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/cannot approve their own/i);
  });

  it('allows self-approval when the definition explicitly permits it', async () => {
    const access: EffectiveAccess = {
      ...baseAccess,
      grants: new Map([
        [
          'procurement.purchase_order.approve',
          {
            permissionKey: 'procurement.purchase_order.approve',
            scopeType: 'NONE',
            scopes: [],
            sourceRoleNames: ['X'],
          },
        ],
      ]),
    };
    const service = makeService(access);

    const result = await service.checkStepEligibility(
      baseInput({
        candidateUserId: 'requester-1',
        requestedById: 'requester-1',
        allowSelfApproval: true,
      }),
    );

    expect(result.eligible).toBe(true);
  });

  it('denies a candidate lacking the required permission', async () => {
    const service = makeService(baseAccess);

    const result = await service.checkStepEligibility(baseInput());

    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/Missing/);
  });

  it('allows a candidate holding the required permission at NONE scopeType', async () => {
    const access: EffectiveAccess = {
      ...baseAccess,
      grants: new Map([
        [
          'procurement.purchase_order.approve',
          {
            permissionKey: 'procurement.purchase_order.approve',
            scopeType: 'NONE',
            scopes: [],
            sourceRoleNames: ['X'],
          },
        ],
      ]),
    };
    const service = makeService(access);

    const result = await service.checkStepEligibility(baseInput());

    expect(result.eligible).toBe(true);
  });

  it('denies a candidate whose granted scope does not match the required scope', async () => {
    const access: EffectiveAccess = {
      ...baseAccess,
      grants: new Map([
        [
          'procurement.purchase_order.approve',
          {
            permissionKey: 'procurement.purchase_order.approve',
            scopeType: 'SCOPABLE',
            scopes: ['OWN_TEAM'],
            sourceRoleNames: ['X'],
          },
        ],
      ]),
    };
    const service = makeService(access);

    const result = await service.checkStepEligibility(
      baseInput({ requiredScope: 'ORGANISATION' as never }),
    );

    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/scope/i);
  });

  it('allows a candidate whose granted scope matches the required scope exactly', async () => {
    const access: EffectiveAccess = {
      ...baseAccess,
      grants: new Map([
        [
          'procurement.purchase_order.approve',
          {
            permissionKey: 'procurement.purchase_order.approve',
            scopeType: 'SCOPABLE',
            scopes: ['ORGANISATION'],
            sourceRoleNames: ['X'],
          },
        ],
      ]),
    };
    const service = makeService(access);

    const result = await service.checkStepEligibility(
      baseInput({ requiredScope: 'ORGANISATION' as never }),
    );

    expect(result.eligible).toBe(true);
  });

  it("denies a candidate who is not the step's explicit assignee, even with the permission", async () => {
    const access: EffectiveAccess = {
      ...baseAccess,
      grants: new Map([
        [
          'procurement.purchase_order.approve',
          {
            permissionKey: 'procurement.purchase_order.approve',
            scopeType: 'NONE',
            scopes: [],
            sourceRoleNames: ['X'],
          },
        ],
      ]),
    };
    const service = makeService(access);

    const result = await service.checkStepEligibility(
      baseInput({ assignedUserId: 'someone-else' }),
    );

    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/assigned to a specific approver/i);
  });

  it('allows the explicit assignee when they also hold the required permission', async () => {
    const access: EffectiveAccess = {
      ...baseAccess,
      grants: new Map([
        [
          'procurement.purchase_order.approve',
          {
            permissionKey: 'procurement.purchase_order.approve',
            scopeType: 'NONE',
            scopes: [],
            sourceRoleNames: ['X'],
          },
        ],
      ]),
    };
    const service = makeService(access);

    const result = await service.checkStepEligibility(baseInput({ assignedUserId: 'candidate-1' }));

    expect(result.eligible).toBe(true);
  });

  it('denies the explicit assignee if they lack the required permission', async () => {
    const service = makeService(baseAccess);

    const result = await service.checkStepEligibility(baseInput({ assignedUserId: 'candidate-1' }));

    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/Missing/);
  });

  it('denies an inactive (suspended/deactivated) user even with the right permission on file', async () => {
    const access: EffectiveAccess = {
      ...baseAccess,
      userIsActive: false,
      grants: new Map([
        [
          'procurement.purchase_order.approve',
          {
            permissionKey: 'procurement.purchase_order.approve',
            scopeType: 'NONE',
            scopes: [],
            sourceRoleNames: ['X'],
          },
        ],
      ]),
    };
    const service = makeService(access);

    const result = await service.checkStepEligibility(baseInput());

    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/not active/i);
  });

  it('the Owner bypass is eligible regardless of granted permissions', async () => {
    const access: EffectiveAccess = { ...baseAccess, isOwnerBypass: true };
    const service = makeService(access);

    const result = await service.checkStepEligibility(
      baseInput({ requiredScope: 'DEPARTMENT' as never }),
    );

    expect(result.eligible).toBe(true);
  });

  describe('listEligibleApprovers', () => {
    it('filters organisation users down to only the eligible, active ones', async () => {
      const access: EffectiveAccess = {
        ...baseAccess,
        grants: new Map([
          [
            'procurement.purchase_order.approve',
            {
              permissionKey: 'procurement.purchase_order.approve',
              scopeType: 'NONE',
              scopes: [],
              sourceRoleNames: ['X'],
            },
          ],
        ]),
      };
      const users = [
        { id: 'candidate-1', status: 'ACTIVE', firstName: 'A', lastName: 'B', email: 'a@x.com' },
        { id: 'candidate-2', status: 'INACTIVE', firstName: 'C', lastName: 'D', email: 'c@x.com' },
      ];
      const effectiveAccessResolver = {
        resolve: jest
          .fn()
          .mockImplementation((_org: string, userId: string) =>
            Promise.resolve(userId === 'candidate-1' ? access : { ...baseAccess, userId }),
          ),
      } as unknown as jest.Mocked<EffectiveAccessResolver>;
      const scopeEvaluator = {
        hasAny: jest.fn((a: EffectiveAccess, key: string) =>
          EffectiveAccessResolver.isGranted(a, key),
        ),
        hasScope: jest.fn(),
      } as unknown as jest.Mocked<ScopeEvaluator>;
      const userService = {
        listWithRoles: jest.fn().mockResolvedValue(users),
      } as unknown as jest.Mocked<UserService>;
      const service = new WorkflowEligibilityService(
        effectiveAccessResolver,
        scopeEvaluator,
        userService,
      );

      const eligible = await service.listEligibleApprovers({
        organisationId: 'org-1',
        requiredPermission: 'procurement.purchase_order.approve',
        requiredScope: null,
        assignedUserId: null,
        requestedById: 'requester-1',
        allowSelfApproval: false,
      });

      expect(eligible).toEqual([
        { userId: 'candidate-1', firstName: 'A', lastName: 'B', email: 'a@x.com' },
      ]);
    });
  });
});
