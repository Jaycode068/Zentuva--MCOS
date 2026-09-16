import { NotificationRecipientResolver } from './notification-recipient-resolver';
import { WorkflowDefinitionService } from '../workflow/workflow-definition.service';
import { WorkflowEligibilityService } from '../workflow/workflow-eligibility.service';

describe('NotificationRecipientResolver', () => {
  const instance = {
    id: 'instance-1',
    organisationId: 'org-1',
    workflowDefinitionId: 'def-1',
    requestedById: 'requester-1',
    previousInstanceId: null as string | null,
  };

  const twoSteps = [
    {
      id: 'step-1',
      sequence: 1,
      status: 'APPROVED',
      requiredPermissionSnapshot: 'p',
      requiredScopeSnapshot: null,
      assignedUserIdSnapshot: null,
    },
    {
      id: 'step-2',
      sequence: 2,
      status: 'ACTIVE',
      requiredPermissionSnapshot: 'p',
      requiredScopeSnapshot: null,
      assignedUserIdSnapshot: null,
    },
  ] as never;

  function makeResolver(overrides: { eligible?: { userId: string }[] } = {}) {
    const eligibilityService = {
      listEligibleApprovers: jest
        .fn()
        .mockResolvedValue(overrides.eligible ?? [{ userId: 'approver-1' }]),
    } as unknown as jest.Mocked<WorkflowEligibilityService>;
    const definitionService = {
      getById: jest.fn().mockResolvedValue({ allowSelfApproval: false }),
    } as unknown as jest.Mocked<WorkflowDefinitionService>;
    const prisma = {
      workflowDecision: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const resolver = new NotificationRecipientResolver(
      eligibilityService,
      definitionService,
      prisma as never,
    );
    return { resolver, eligibilityService, definitionService, prisma };
  }

  it('APPROVAL_REQUIRED resolves to the eligible approvers for the newly-active step', async () => {
    const { resolver } = makeResolver();
    const event = {
      eventType: 'APPROVAL_REQUIRED',
      workflowStepInstanceId: 'step-2',
      actorUserId: null,
    } as never;
    await expect(resolver.resolve(event, instance as never, twoSteps)).resolves.toEqual([
      'approver-1',
    ]);
  });

  it('STEP_APPROVED notifies the requester only when a next step exists (mid-chain)', async () => {
    const { resolver } = makeResolver();
    const event = {
      eventType: 'STEP_APPROVED',
      workflowStepInstanceId: 'step-1',
      actorUserId: null,
    } as never;
    await expect(resolver.resolve(event, instance as never, twoSteps)).resolves.toEqual([
      'requester-1',
    ]);
  });

  it('STEP_APPROVED on the LAST step notifies nobody (APPROVED event covers it instead)', async () => {
    const { resolver } = makeResolver();
    const event = {
      eventType: 'STEP_APPROVED',
      workflowStepInstanceId: 'step-2',
      actorUserId: null,
    } as never;
    await expect(resolver.resolve(event, instance as never, twoSteps)).resolves.toEqual([]);
  });

  it('APPROVED/REJECTED/RETURNED all notify only the requester', async () => {
    const { resolver } = makeResolver();
    for (const eventType of ['APPROVED', 'REJECTED', 'RETURNED']) {
      const event = {
        eventType,
        workflowStepInstanceId: null,
        actorUserId: 'someone-else',
      } as never;
      await expect(resolver.resolve(event, instance as never, twoSteps)).resolves.toEqual([
        'requester-1',
      ]);
    }
  });

  it('RESUBMITTED notifies whoever returned the previous instance', async () => {
    const { resolver, prisma } = makeResolver();
    prisma.workflowDecision.findFirst.mockResolvedValue({ actorUserId: 'returner-1' });
    const withPrevious = { ...instance, previousInstanceId: 'previous-instance-1' };
    const event = {
      eventType: 'RESUBMITTED',
      workflowStepInstanceId: null,
      actorUserId: null,
    } as never;

    await expect(resolver.resolve(event, withPrevious as never, twoSteps)).resolves.toEqual([
      'returner-1',
    ]);
    expect(prisma.workflowDecision.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workflowInstanceId: 'previous-instance-1', decision: 'RETURN' },
      }),
    );
  });

  it('RESUBMITTED with no previousInstanceId resolves to zero recipients', async () => {
    const { resolver } = makeResolver();
    const event = {
      eventType: 'RESUBMITTED',
      workflowStepInstanceId: null,
      actorUserId: null,
    } as never;
    await expect(resolver.resolve(event, instance as never, twoSteps)).resolves.toEqual([]);
  });

  it('CANCELLED skips notifying the requester about their OWN cancel action', async () => {
    const { resolver } = makeResolver();
    const event = {
      eventType: 'CANCELLED',
      workflowStepInstanceId: null,
      actorUserId: 'requester-1',
    } as never;
    await expect(resolver.resolve(event, instance as never, twoSteps)).resolves.toEqual([]);
  });

  it('CANCELLED notifies the requester when someone else cancelled it', async () => {
    const { resolver } = makeResolver();
    const event = {
      eventType: 'CANCELLED',
      workflowStepInstanceId: null,
      actorUserId: 'admin-1',
    } as never;
    await expect(resolver.resolve(event, instance as never, twoSteps)).resolves.toEqual([
      'requester-1',
    ]);
  });

  it('EXPIRED notifies the requester plus eligible approvers of the currently-active step', async () => {
    const { resolver } = makeResolver({ eligible: [{ userId: 'approver-2' }] });
    const event = {
      eventType: 'EXPIRED',
      workflowStepInstanceId: null,
      actorUserId: null,
    } as never;
    const recipients = await resolver.resolve(event, instance as never, twoSteps);
    expect(recipients).toEqual(expect.arrayContaining(['requester-1', 'approver-2']));
    expect(recipients).toHaveLength(2);
  });

  it('an unmapped event type (e.g. SUBMITTED) resolves to zero recipients, not an error', async () => {
    const { resolver } = makeResolver();
    const event = {
      eventType: 'SUBMITTED',
      workflowStepInstanceId: null,
      actorUserId: null,
    } as never;
    await expect(resolver.resolve(event, instance as never, twoSteps)).resolves.toEqual([]);
  });

  it('never notifies every organisation user — APPROVAL_REQUIRED with zero eligible approvers resolves to zero recipients', async () => {
    const { resolver } = makeResolver({ eligible: [] });
    const event = {
      eventType: 'APPROVAL_REQUIRED',
      workflowStepInstanceId: 'step-2',
      actorUserId: null,
    } as never;
    await expect(resolver.resolve(event, instance as never, twoSteps)).resolves.toEqual([]);
  });
});
