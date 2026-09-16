import { WorkflowDefinitionService } from './workflow-definition.service';
import { WorkflowEligibilityService } from './workflow-eligibility.service';
import { WorkflowEventRepository } from './workflow-event.repository';
import {
  ConflictingActiveInstanceError,
  WorkflowInstanceRepository,
} from './workflow-instance.repository';
import { WorkflowInstanceService } from './workflow-instance.service';
import { WorkflowSubjectHandler } from './workflow-subject-handler';

describe('WorkflowInstanceService', () => {
  const definition = {
    id: 'def-1',
    code: 'PO_APPROVAL',
    version: 1,
    status: 'ACTIVE',
    subjectType: 'PURCHASE_ORDER',
    allowSelfApproval: false,
    steps: [
      {
        id: 'step-1',
        name: 'Review',
        sequence: 1,
        requiredPermission: 'procurement.purchase_order.approve',
        requiredScope: 'ORGANISATION',
        assignedUserId: null,
      },
      {
        id: 'step-2',
        name: 'Final',
        sequence: 2,
        requiredPermission: 'procurement.purchase_order.approve',
        requiredScope: 'ORGANISATION',
        assignedUserId: 'final-approver',
      },
    ],
  };

  function makeInstance(overrides: Record<string, unknown> = {}) {
    return {
      id: 'instance-1',
      organisationId: 'org-1',
      workflowDefinitionId: 'def-1',
      workflowDefinitionVersion: 1,
      subjectType: 'PURCHASE_ORDER',
      subjectId: 'po-1',
      status: 'IN_PROGRESS',
      requestedById: 'requester-1',
      dueAt: null,
      resubmissionCount: 0,
      previousInstanceId: null,
      resubmittedAt: null,
      stepInstances: [
        {
          id: 'step-instance-1',
          sequence: 1,
          status: 'ACTIVE',
          requiredPermissionSnapshot: 'procurement.purchase_order.approve',
          requiredScopeSnapshot: 'ORGANISATION',
          assignedUserIdSnapshot: null,
        },
        {
          id: 'step-instance-2',
          sequence: 2,
          status: 'PENDING',
          requiredPermissionSnapshot: 'procurement.purchase_order.approve',
          requiredScopeSnapshot: 'ORGANISATION',
          assignedUserIdSnapshot: 'final-approver',
        },
      ],
      ...overrides,
    };
  }

  function makeHandler(
    overrides: Partial<WorkflowSubjectHandler> = {},
  ): jest.Mocked<WorkflowSubjectHandler> {
    return {
      subjectType: 'PURCHASE_ORDER',
      describe: jest.fn().mockResolvedValue('PO-000001'),
      validateForSubmission: jest.fn().mockResolvedValue({ ok: true }),
      onWorkflowSubmitted: jest.fn().mockResolvedValue(undefined),
      onWorkflowApproved: jest.fn().mockResolvedValue(undefined),
      onWorkflowExited: jest.fn().mockResolvedValue(undefined),
      ...overrides,
    } as jest.Mocked<WorkflowSubjectHandler>;
  }

  function makeService(handler = makeHandler()) {
    const repo = {
      findById: jest.fn(),
      findManyByOrganisation: jest.fn(),
      findActiveForSubject: jest.fn().mockResolvedValue(null),
      createWithSteps: jest.fn(),
      submit: jest.fn().mockResolvedValue(true),
      activateStep: jest.fn().mockResolvedValue(true),
      decideStep: jest.fn().mockResolvedValue(true),
      setInstanceStatus: jest.fn().mockResolvedValue(true),
      markCompleted: jest.fn().mockResolvedValue(true),
      expire: jest.fn().mockResolvedValue(true),
      claimForResubmission: jest.fn().mockResolvedValue(true),
      findDecisionsByInstance: jest.fn().mockResolvedValue([]),
      findActiveStepsByOrganisation: jest.fn(),
    } as unknown as jest.Mocked<WorkflowInstanceRepository>;

    const definitionService = {
      getByCode: jest.fn().mockResolvedValue(definition),
      getById: jest.fn().mockResolvedValue(definition),
      getByIdOrThrow: jest.fn().mockResolvedValue(definition),
    } as unknown as jest.Mocked<WorkflowDefinitionService>;

    const eligibilityService = {
      checkStepEligibility: jest.fn().mockResolvedValue({ eligible: true }),
      listEligibleApprovers: jest.fn(),
    } as unknown as jest.Mocked<WorkflowEligibilityService>;

    const eventRepository = {
      findManyByInstance: jest.fn().mockResolvedValue([]),
      findManyByOrganisation: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<WorkflowEventRepository>;

    const service = new WorkflowInstanceService(
      repo,
      definitionService,
      eligibilityService,
      [handler],
      eventRepository,
    );
    return { service, repo, definitionService, eligibilityService, eventRepository, handler };
  }

  describe('create', () => {
    it('rejects submission against an inactive definition', async () => {
      const { service, definitionService } = makeService();
      definitionService.getByCode.mockResolvedValue({ ...definition, status: 'INACTIVE' } as never);

      await expect(
        service.create(
          'org-1',
          {
            workflowDefinitionCode: 'PO_APPROVAL',
            subjectType: 'PURCHASE_ORDER',
            subjectId: 'po-1',
          },
          'requester-1',
        ),
      ).rejects.toThrow(/not active/);
    });

    it('rejects a subject the handler considers ineligible', async () => {
      const { service } = makeService(
        makeHandler({
          validateForSubmission: jest.fn().mockResolvedValue({ ok: false, reason: 'Not DRAFT' }),
        }),
      );

      await expect(
        service.create(
          'org-1',
          {
            workflowDefinitionCode: 'PO_APPROVAL',
            subjectType: 'PURCHASE_ORDER',
            subjectId: 'po-1',
          },
          'requester-1',
        ),
      ).rejects.toThrow('Not DRAFT');
    });

    it('rejects a subject that already has a conflicting active workflow instance', async () => {
      const { service, repo } = makeService();
      repo.findActiveForSubject.mockResolvedValue({ id: 'other-instance' } as never);

      await expect(
        service.create(
          'org-1',
          {
            workflowDefinitionCode: 'PO_APPROVAL',
            subjectType: 'PURCHASE_ORDER',
            subjectId: 'po-1',
          },
          'requester-1',
        ),
      ).rejects.toThrow(/already has an active workflow/);
    });

    it('creates the instance with every step pre-snapshotted', async () => {
      const { service, repo } = makeService();
      repo.createWithSteps.mockResolvedValue(makeInstance({ status: 'DRAFT' }) as never);

      await service.create(
        'org-1',
        { workflowDefinitionCode: 'PO_APPROVAL', subjectType: 'PURCHASE_ORDER', subjectId: 'po-1' },
        'requester-1',
      );

      expect(repo.createWithSteps).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'DRAFT',
          subjectId: 'po-1',
          requestedById: 'requester-1',
        }),
        expect.arrayContaining([
          expect.objectContaining({ sequence: 1, status: 'PENDING' }),
          expect.objectContaining({ sequence: 2, status: 'PENDING' }),
        ]),
      );
    });

    it('translates a database-level conflicting-active-instance race into 409', async () => {
      const { service, repo } = makeService();
      repo.createWithSteps.mockRejectedValue(new ConflictingActiveInstanceError());

      await expect(
        service.create(
          'org-1',
          {
            workflowDefinitionCode: 'PO_APPROVAL',
            subjectType: 'PURCHASE_ORDER',
            subjectId: 'po-1',
          },
          'requester-1',
        ),
      ).rejects.toThrow(/already has an active workflow/);
    });
  });

  describe('submit', () => {
    it('only the requester may submit', async () => {
      const { service, repo } = makeService();
      repo.findById.mockResolvedValue(makeInstance({ status: 'DRAFT' }) as never);

      await expect(service.submit('org-1', 'instance-1', 'someone-else')).rejects.toThrow(
        /Only the requester/,
      );
    });

    it('rejects double submission without calling the domain handler again', async () => {
      const { service, repo, handler } = makeService();
      repo.findById.mockResolvedValue(makeInstance({ status: 'SUBMITTED' }) as never);

      await expect(service.submit('org-1', 'instance-1', 'requester-1')).rejects.toThrow(
        /already been submitted/,
      );
      expect(handler.onWorkflowSubmitted).not.toHaveBeenCalled();
    });

    it('calls onWorkflowSubmitted BEFORE any workflow-side state change (atomicity fix)', async () => {
      const { service, repo, handler } = makeService();
      repo.findById.mockResolvedValue(makeInstance({ status: 'DRAFT' }) as never);
      const callOrder: string[] = [];
      handler.onWorkflowSubmitted.mockImplementation(async () => {
        callOrder.push('handler');
      });
      repo.submit.mockImplementation(async () => {
        callOrder.push('submit');
        return true;
      });

      await service.submit('org-1', 'instance-1', 'requester-1');

      expect(callOrder).toEqual(['handler', 'submit']);
    });

    it('leaves the instance untouched if the domain handler fails', async () => {
      const { service, repo, handler } = makeService();
      repo.findById.mockResolvedValue(makeInstance({ status: 'DRAFT' }) as never);
      handler.onWorkflowSubmitted.mockRejectedValue(new Error('PO service unavailable'));

      await expect(service.submit('org-1', 'instance-1', 'requester-1')).rejects.toThrow(
        'PO service unavailable',
      );
      expect(repo.submit).not.toHaveBeenCalled();
      expect(repo.activateStep).not.toHaveBeenCalled();
    });

    it('activates the first step and records a SUBMITTED + APPROVAL_REQUIRED event', async () => {
      const { service, repo, handler } = makeService();
      repo.findById.mockResolvedValue(makeInstance({ status: 'DRAFT' }) as never);

      await service.submit('org-1', 'instance-1', 'requester-1');

      expect(repo.activateStep).toHaveBeenCalledWith(
        'instance-1',
        'step-instance-1',
        expect.objectContaining({ eventType: 'APPROVAL_REQUIRED' }),
      );
      expect(repo.submit).toHaveBeenCalledWith(
        'org-1',
        'instance-1',
        expect.objectContaining({ eventType: 'SUBMITTED' }),
      );
      expect(handler.onWorkflowSubmitted).toHaveBeenCalledWith('org-1', 'po-1', 'requester-1');
    });
  });

  describe('approve', () => {
    it('rejects an ineligible actor', async () => {
      const { service, repo, eligibilityService } = makeService();
      repo.findById.mockResolvedValue(makeInstance() as never);
      eligibilityService.checkStepEligibility.mockResolvedValue({
        eligible: false,
        reason: 'Missing permission',
      });

      await expect(service.approve('org-1', 'instance-1', 'actor-1')).rejects.toThrow(
        'Missing permission',
      );
      expect(repo.decideStep).not.toHaveBeenCalled();
    });

    it('reports a conflict when the step was already decided by someone else (concurrency)', async () => {
      const { service, repo } = makeService();
      repo.findById.mockResolvedValue(makeInstance() as never);
      repo.decideStep.mockResolvedValue(false);

      await expect(service.approve('org-1', 'instance-1', 'actor-1')).rejects.toThrow(
        /already been decided/,
      );
    });

    it('advances to the next PENDING step without completing the instance', async () => {
      const { service, repo, handler } = makeService();
      repo.findById.mockResolvedValue(makeInstance() as never);

      await service.approve('org-1', 'instance-1', 'actor-1');

      expect(repo.activateStep).toHaveBeenCalledWith(
        'instance-1',
        'step-instance-2',
        expect.objectContaining({ eventType: 'APPROVAL_REQUIRED' }),
      );
      expect(repo.setInstanceStatus).not.toHaveBeenCalled();
      expect(handler.onWorkflowApproved).not.toHaveBeenCalled();
    });

    it('on the final step, calls onWorkflowApproved BEFORE marking the instance APPROVED (atomicity fix)', async () => {
      const { service, repo, handler } = makeService();
      repo.findById.mockResolvedValue(
        makeInstance({
          stepInstances: [
            {
              id: 'step-instance-1',
              sequence: 1,
              status: 'APPROVED',
              requiredPermissionSnapshot: 'procurement.purchase_order.approve',
              requiredScopeSnapshot: 'ORGANISATION',
              assignedUserIdSnapshot: null,
            },
            {
              id: 'step-instance-2',
              sequence: 2,
              status: 'ACTIVE',
              requiredPermissionSnapshot: 'procurement.purchase_order.approve',
              requiredScopeSnapshot: 'ORGANISATION',
              assignedUserIdSnapshot: 'final-approver',
            },
          ],
        }) as never,
      );
      const callOrder: string[] = [];
      handler.onWorkflowApproved.mockImplementation(async () => {
        callOrder.push('handler');
      });
      repo.setInstanceStatus.mockImplementation(async () => {
        callOrder.push('setInstanceStatus');
        return true;
      });

      await service.approve('org-1', 'instance-1', 'final-approver');

      expect(callOrder).toEqual(['handler', 'setInstanceStatus']);
      expect(repo.setInstanceStatus).toHaveBeenCalledWith(
        'org-1',
        'instance-1',
        'APPROVED',
        {},
        expect.objectContaining({ eventType: 'APPROVED' }),
      );
      expect(handler.onWorkflowApproved).toHaveBeenCalledWith('org-1', 'po-1', 'final-approver');
    });

    it('never marks the instance APPROVED if the domain integration fails', async () => {
      const { service, repo, handler } = makeService();
      repo.findById.mockResolvedValue(
        makeInstance({
          stepInstances: [
            {
              id: 'step-instance-1',
              sequence: 1,
              status: 'APPROVED',
              requiredPermissionSnapshot: 'x',
              requiredScopeSnapshot: null,
              assignedUserIdSnapshot: null,
            },
            {
              id: 'step-instance-2',
              sequence: 2,
              status: 'ACTIVE',
              requiredPermissionSnapshot: 'x',
              requiredScopeSnapshot: null,
              assignedUserIdSnapshot: null,
            },
          ],
        }) as never,
      );
      handler.onWorkflowApproved.mockRejectedValue(new Error('PO service unavailable'));

      await expect(service.approve('org-1', 'instance-1', 'final-approver')).rejects.toThrow(
        'PO service unavailable',
      );
      expect(repo.setInstanceStatus).not.toHaveBeenCalled();
    });

    it('recovery: retries finalization when every step is APPROVED but the instance never finalized', async () => {
      const { service, repo, handler } = makeService();
      repo.findById.mockResolvedValue(
        makeInstance({
          status: 'IN_PROGRESS',
          stepInstances: [
            {
              id: 'step-instance-1',
              sequence: 1,
              status: 'APPROVED',
              requiredPermissionSnapshot: 'x',
              requiredScopeSnapshot: null,
              assignedUserIdSnapshot: null,
            },
            {
              id: 'step-instance-2',
              sequence: 2,
              status: 'APPROVED',
              requiredPermissionSnapshot: 'x',
              requiredScopeSnapshot: null,
              assignedUserIdSnapshot: null,
            },
          ],
        }) as never,
      );
      repo.findDecisionsByInstance.mockResolvedValue([
        {
          workflowStepInstanceId: 'step-instance-2',
          decision: 'APPROVE',
          actorUserId: 'original-approver',
        },
      ] as never);

      await service.approve('org-1', 'instance-1', 'retry-caller');

      expect(repo.decideStep).not.toHaveBeenCalled();
      expect(handler.onWorkflowApproved).toHaveBeenCalledWith('org-1', 'po-1', 'original-approver');
      expect(repo.setInstanceStatus).toHaveBeenCalledWith(
        'org-1',
        'instance-1',
        'APPROVED',
        {},
        expect.objectContaining({ eventType: 'APPROVED' }),
      );
    });

    it('throws when there is no active step and not every step is approved (e.g. instance already terminal)', async () => {
      const { service, repo } = makeService();
      repo.findById.mockResolvedValue(
        makeInstance({
          stepInstances: [
            {
              id: 's1',
              sequence: 1,
              status: 'REJECTED',
              requiredPermissionSnapshot: 'x',
              requiredScopeSnapshot: null,
              assignedUserIdSnapshot: null,
            },
          ],
        }) as never,
      );

      await expect(service.approve('org-1', 'instance-1', 'actor-1')).rejects.toThrow(
        /no active step/,
      );
    });
  });

  describe('reject / return', () => {
    it('reject requires a non-empty comment', async () => {
      const { service, repo } = makeService();
      repo.findById.mockResolvedValue(makeInstance() as never);

      await expect(service.reject('org-1', 'instance-1', 'actor-1')).rejects.toThrow(
        /comment is required/,
      );
      await expect(service.reject('org-1', 'instance-1', 'actor-1', '   ')).rejects.toThrow(
        /comment is required/,
      );
      expect(repo.decideStep).not.toHaveBeenCalled();
    });

    it('return requires a non-empty comment', async () => {
      const { service, repo } = makeService();
      repo.findById.mockResolvedValue(makeInstance() as never);

      await expect(service.return_('org-1', 'instance-1', 'actor-1')).rejects.toThrow(
        /comment is required/,
      );
      expect(repo.decideStep).not.toHaveBeenCalled();
    });

    it('reject transitions the instance to REJECTED and calls onWorkflowExited', async () => {
      const { service, repo, handler } = makeService();
      repo.findById.mockResolvedValue(makeInstance() as never);

      await service.reject('org-1', 'instance-1', 'actor-1', 'Not justified');

      expect(repo.decideStep).toHaveBeenCalledWith(
        'step-instance-1',
        'instance-1',
        'REJECTED',
        expect.objectContaining({ comment: 'Not justified' }),
        expect.objectContaining({ eventType: 'REJECTED' }),
      );
      expect(repo.setInstanceStatus).toHaveBeenCalledWith('org-1', 'instance-1', 'REJECTED');
      expect(handler.onWorkflowExited).toHaveBeenCalledWith('org-1', 'po-1', 'actor-1');
    });

    it('return transitions the instance to RETURNED and calls onWorkflowExited', async () => {
      const { service, repo, handler } = makeService();
      repo.findById.mockResolvedValue(makeInstance() as never);

      await service.return_('org-1', 'instance-1', 'actor-1', 'Needs more detail');

      expect(repo.setInstanceStatus).toHaveBeenCalledWith('org-1', 'instance-1', 'RETURNED');
      expect(handler.onWorkflowExited).toHaveBeenCalledWith('org-1', 'po-1', 'actor-1');
    });
  });

  describe('resubmit', () => {
    function makeReturnedInstance(overrides: Record<string, unknown> = {}) {
      return makeInstance({
        status: 'RETURNED',
        resubmissionCount: 0,
        stepInstances: [
          {
            id: 'step-instance-1',
            sequence: 1,
            status: 'RETURNED',
            requiredPermissionSnapshot: 'x',
            requiredScopeSnapshot: null,
            assignedUserIdSnapshot: null,
          },
          {
            id: 'step-instance-2',
            sequence: 2,
            status: 'PENDING',
            requiredPermissionSnapshot: 'x',
          },
        ],
        ...overrides,
      });
    }

    it('only the original requester may resubmit', async () => {
      const { service, repo } = makeService();
      repo.findById.mockResolvedValue(makeReturnedInstance() as never);

      await expect(service.resubmit('org-1', 'instance-1', 'someone-else')).rejects.toThrow(
        /original requester/,
      );
      expect(repo.claimForResubmission).not.toHaveBeenCalled();
    });

    it('only a RETURNED instance can be resubmitted', async () => {
      const { service, repo } = makeService();
      repo.findById.mockResolvedValue(makeInstance({ status: 'IN_PROGRESS' }) as never);

      await expect(service.resubmit('org-1', 'instance-1', 'requester-1')).rejects.toThrow(
        /Only a RETURNED/,
      );
    });

    it('reports a conflict if the resubmission claim loses the race (concurrent resubmit)', async () => {
      const { service, repo } = makeService();
      repo.findById.mockResolvedValue(makeReturnedInstance() as never);
      repo.claimForResubmission.mockResolvedValue(false);

      await expect(service.resubmit('org-1', 'instance-1', 'requester-1')).rejects.toThrow(
        /already been resubmitted/,
      );
      expect(repo.createWithSteps).not.toHaveBeenCalled();
    });

    it('creates a new linked instance, restarts from step 1, and calls onWorkflowSubmitted', async () => {
      const { service, repo, handler } = makeService();
      repo.findById.mockResolvedValue(makeReturnedInstance() as never);
      repo.createWithSteps.mockResolvedValue(
        makeInstance({
          id: 'instance-2',
          status: 'SUBMITTED',
          previousInstanceId: 'instance-1',
          resubmissionCount: 1,
          stepInstances: [
            { id: 'new-step-1', sequence: 1, status: 'PENDING', requiredPermissionSnapshot: 'x' },
            { id: 'new-step-2', sequence: 2, status: 'PENDING', requiredPermissionSnapshot: 'x' },
          ],
        }) as never,
      );

      await service.resubmit('org-1', 'instance-1', 'requester-1');

      expect(handler.onWorkflowSubmitted).toHaveBeenCalledWith('org-1', 'po-1', 'requester-1');
      expect(repo.createWithSteps).toHaveBeenCalledWith(
        expect.objectContaining({
          previousInstanceId: 'instance-1',
          resubmissionCount: 1,
          status: 'SUBMITTED',
        }),
        expect.any(Array),
        expect.objectContaining({ eventType: 'RESUBMITTED' }),
      );
      expect(repo.activateStep).toHaveBeenCalledWith(
        'instance-2',
        'new-step-1',
        expect.objectContaining({ eventType: 'APPROVAL_REQUIRED' }),
      );
    });

    it('translates a database-level conflicting-active-instance race into 409', async () => {
      const { service, repo } = makeService();
      repo.findById.mockResolvedValue(makeReturnedInstance() as never);
      repo.createWithSteps.mockRejectedValue(new ConflictingActiveInstanceError());

      await expect(service.resubmit('org-1', 'instance-1', 'requester-1')).rejects.toThrow(
        /already has an active workflow/,
      );
    });
  });

  describe('expire', () => {
    it('reports a conflict when the instance cannot be expired (terminal, or not yet due)', async () => {
      const { service, repo } = makeService();
      repo.findById.mockResolvedValue(makeInstance() as never);
      repo.expire.mockResolvedValue(false);

      await expect(service.expire('org-1', 'instance-1', 'actor-1')).rejects.toThrow(
        /cannot be expired/,
      );
    });

    it('transitions to EXPIRED and records an event', async () => {
      const { service, repo } = makeService();
      repo.findById.mockResolvedValue(makeInstance() as never);

      await service.expire('org-1', 'instance-1', 'actor-1');

      expect(repo.expire).toHaveBeenCalledWith(
        'org-1',
        'instance-1',
        expect.objectContaining({ eventType: 'EXPIRED', actorUserId: 'actor-1' }),
      );
    });
  });

  describe('cancel', () => {
    it('cancels a non-terminal instance and calls onWorkflowExited when it had been submitted', async () => {
      const { service, repo, handler } = makeService();
      repo.findById.mockResolvedValue(makeInstance({ status: 'IN_PROGRESS' }) as never);

      await service.cancel('org-1', 'instance-1', 'actor-1');

      expect(repo.setInstanceStatus).toHaveBeenCalledWith(
        'org-1',
        'instance-1',
        'CANCELLED',
        expect.objectContaining({ cancelledAt: expect.any(Date) }),
        expect.objectContaining({ eventType: 'CANCELLED' }),
      );
      expect(handler.onWorkflowExited).toHaveBeenCalled();
    });

    it('does not call onWorkflowExited when cancelling a DRAFT (never submitted) instance', async () => {
      const { service, repo, handler } = makeService();
      repo.findById.mockResolvedValue(makeInstance({ status: 'DRAFT' }) as never);

      await service.cancel('org-1', 'instance-1', 'actor-1');

      expect(handler.onWorkflowExited).not.toHaveBeenCalled();
    });

    it('reports a conflict when already terminal', async () => {
      const { service, repo } = makeService();
      repo.findById.mockResolvedValue(makeInstance({ status: 'APPROVED' }) as never);
      repo.setInstanceStatus.mockResolvedValue(false);

      await expect(service.cancel('org-1', 'instance-1', 'actor-1')).rejects.toThrow(
        /already in a terminal state/,
      );
    });
  });

  describe('isOverdue (computed, never persisted)', () => {
    it('is false when there is no dueAt', async () => {
      const { service, repo } = makeService();
      repo.findById.mockResolvedValue(makeInstance({ dueAt: null }) as never);

      const result = await service.getByIdOrThrow('org-1', 'instance-1');

      expect(result.isOverdue).toBe(false);
    });

    it('is true when dueAt has passed and the instance is still non-terminal', async () => {
      const { service, repo } = makeService();
      repo.findById.mockResolvedValue(
        makeInstance({ status: 'IN_PROGRESS', dueAt: new Date(Date.now() - 1000 * 60) }) as never,
      );

      const result = await service.getByIdOrThrow('org-1', 'instance-1');

      expect(result.isOverdue).toBe(true);
    });

    it('is false once the instance is terminal, even with a past dueAt', async () => {
      const { service, repo } = makeService();
      repo.findById.mockResolvedValue(
        makeInstance({ status: 'APPROVED', dueAt: new Date(Date.now() - 1000 * 60) }) as never,
      );

      const result = await service.getByIdOrThrow('org-1', 'instance-1');

      expect(result.isOverdue).toBe(false);
    });

    it('is false when dueAt is in the future', async () => {
      const { service, repo } = makeService();
      repo.findById.mockResolvedValue(
        makeInstance({
          status: 'IN_PROGRESS',
          dueAt: new Date(Date.now() + 1000 * 60 * 60),
        }) as never,
      );

      const result = await service.getByIdOrThrow('org-1', 'instance-1');

      expect(result.isOverdue).toBe(false);
    });
  });

  describe('list', () => {
    it('passes the overdue filter through to the repository', async () => {
      const { service, repo } = makeService();
      repo.findManyByOrganisation.mockResolvedValue([]);

      await service.list('org-1', { overdue: true });

      expect(repo.findManyByOrganisation).toHaveBeenCalledWith(
        'org-1',
        expect.objectContaining({ overdue: true }),
      );
    });
  });

  describe('listMyApprovals', () => {
    it('returns only the steps the candidate is eligible for', async () => {
      const { service, repo, eligibilityService } = makeService();
      repo.findActiveStepsByOrganisation.mockResolvedValue([
        {
          id: 'step-a',
          requiredPermissionSnapshot: 'x',
          requiredScopeSnapshot: null,
          assignedUserIdSnapshot: null,
          workflowInstance: { workflowDefinitionId: 'def-1', requestedById: 'requester-1' },
        },
        {
          id: 'step-b',
          requiredPermissionSnapshot: 'x',
          requiredScopeSnapshot: null,
          assignedUserIdSnapshot: null,
          workflowInstance: { workflowDefinitionId: 'def-1', requestedById: 'requester-1' },
        },
      ] as never);
      eligibilityService.checkStepEligibility
        .mockResolvedValueOnce({ eligible: true })
        .mockResolvedValueOnce({ eligible: false, reason: 'no' });

      const result = await service.listMyApprovals('org-1', 'candidate-1');

      expect(result).toHaveLength(1);
      expect((result[0] as { id: string }).id).toBe('step-a');
    });
  });
});
