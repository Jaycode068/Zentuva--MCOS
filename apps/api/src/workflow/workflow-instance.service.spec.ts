import { WorkflowDefinitionService } from './workflow-definition.service';
import { WorkflowEligibilityService } from './workflow-eligibility.service';
import { WorkflowInstanceRepository } from './workflow-instance.repository';
import { WorkflowInstanceService } from './workflow-instance.service';
import { WorkflowSubjectHandler } from './workflow-subject-handler';

describe('WorkflowInstanceService', () => {
  const definition = {
    id: 'def-1',
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
      subjectType: 'PURCHASE_ORDER',
      subjectId: 'po-1',
      status: 'IN_PROGRESS',
      requestedById: 'requester-1',
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
      findDecisionsByInstance: jest.fn(),
      findActiveStepsByOrganisation: jest.fn(),
    } as unknown as jest.Mocked<WorkflowInstanceRepository>;

    const definitionService = {
      getByCode: jest.fn().mockResolvedValue(definition),
      getById: jest.fn().mockResolvedValue(definition),
    } as unknown as jest.Mocked<WorkflowDefinitionService>;

    const eligibilityService = {
      checkStepEligibility: jest.fn().mockResolvedValue({ eligible: true }),
      listEligibleApprovers: jest.fn(),
    } as unknown as jest.Mocked<WorkflowEligibilityService>;

    const service = new WorkflowInstanceService(repo, definitionService, eligibilityService, [
      handler,
    ]);
    return { service, repo, definitionService, eligibilityService, handler };
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
  });

  describe('submit', () => {
    it('only the requester may submit', async () => {
      const { service, repo } = makeService();
      repo.findById.mockResolvedValue(makeInstance({ status: 'DRAFT' }) as never);

      await expect(service.submit('org-1', 'instance-1', 'someone-else')).rejects.toThrow(
        /Only the requester/,
      );
    });

    it('rejects double submission', async () => {
      const { service, repo } = makeService();
      repo.findById.mockResolvedValue(makeInstance({ status: 'DRAFT' }) as never);
      repo.submit.mockResolvedValue(false);

      await expect(service.submit('org-1', 'instance-1', 'requester-1')).rejects.toThrow(
        /already been submitted/,
      );
    });

    it('activates the first step and calls onWorkflowSubmitted', async () => {
      const { service, repo, handler } = makeService();
      repo.findById.mockResolvedValue(makeInstance({ status: 'DRAFT' }) as never);

      await service.submit('org-1', 'instance-1', 'requester-1');

      expect(repo.activateStep).toHaveBeenCalledWith('instance-1', 'step-instance-1');
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

      expect(repo.activateStep).toHaveBeenCalledWith('instance-1', 'step-instance-2');
      expect(repo.setInstanceStatus).not.toHaveBeenCalled();
      expect(handler.onWorkflowApproved).not.toHaveBeenCalled();
    });

    it('on the final step, marks the instance APPROVED and calls onWorkflowApproved', async () => {
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

      await service.approve('org-1', 'instance-1', 'final-approver');

      expect(repo.setInstanceStatus).toHaveBeenCalledWith('org-1', 'instance-1', 'APPROVED');
      expect(handler.onWorkflowApproved).toHaveBeenCalledWith('org-1', 'po-1', 'final-approver');
    });

    it('throws when there is no active step (e.g. instance already terminal)', async () => {
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
    it('reject transitions the instance to REJECTED and calls onWorkflowExited', async () => {
      const { service, repo, handler } = makeService();
      repo.findById.mockResolvedValue(makeInstance() as never);

      await service.reject('org-1', 'instance-1', 'actor-1', 'Not justified');

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
