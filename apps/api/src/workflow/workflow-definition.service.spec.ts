import { User } from '@prisma/client';

import { UserService } from '../identity/user/user.service';
import { WorkflowDefinitionRepository } from './workflow-definition.repository';
import { WorkflowDefinitionService } from './workflow-definition.service';

describe('WorkflowDefinitionService', () => {
  function makeService() {
    const repo = {
      findById: jest.fn(),
      findByCode: jest.fn().mockResolvedValue(null),
      findManyByOrganisation: jest.fn(),
      createWithSteps: jest.fn(),
      update: jest.fn(),
      countInstances: jest.fn(),
      countActiveInstances: jest.fn().mockResolvedValue(0),
    } as unknown as jest.Mocked<WorkflowDefinitionRepository>;
    const userService = {
      getById: jest.fn().mockResolvedValue({ id: 'user-1' } as User),
    } as unknown as jest.Mocked<UserService>;
    return { service: new WorkflowDefinitionService(repo, userService), repo, userService };
  }

  const validStep = {
    name: 'Approve',
    code: 'APPROVE',
    sequence: 1,
    requiredPermission: 'procurement.purchase_order.approve',
  };

  describe('create', () => {
    it('creates a definition with valid steps', async () => {
      const { service, repo } = makeService();
      repo.createWithSteps.mockResolvedValue({ id: 'def-1' } as never);

      await service.create(
        'org-1',
        {
          name: 'PO Approval',
          code: 'PO_APPROVAL',
          subjectType: 'PURCHASE_ORDER',
          steps: [validStep],
        },
        'actor-1',
      );

      expect(repo.createWithSteps).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'PO_APPROVAL', organisationId: 'org-1' }),
        [validStep],
      );
    });

    it('rejects a definition with zero steps', async () => {
      const { service } = makeService();

      await expect(
        service.create(
          'org-1',
          { name: 'X', code: 'X', subjectType: 'PURCHASE_ORDER', steps: [] },
          'actor-1',
        ),
      ).rejects.toThrow('at least one step');
    });

    it('rejects duplicate step codes', async () => {
      const { service } = makeService();

      await expect(
        service.create(
          'org-1',
          {
            name: 'X',
            code: 'X',
            subjectType: 'PURCHASE_ORDER',
            steps: [
              { ...validStep, sequence: 1 },
              { ...validStep, sequence: 2 },
            ],
          },
          'actor-1',
        ),
      ).rejects.toThrow(/Duplicate step code/);
    });

    it('rejects duplicate step sequences', async () => {
      const { service } = makeService();

      await expect(
        service.create(
          'org-1',
          {
            name: 'X',
            code: 'X',
            subjectType: 'PURCHASE_ORDER',
            steps: [
              { ...validStep, code: 'A', sequence: 1 },
              { ...validStep, code: 'B', sequence: 1 },
            ],
          },
          'actor-1',
        ),
      ).rejects.toThrow(/Duplicate step sequence/);
    });

    it('rejects a step referencing a permission not in the catalogue', async () => {
      const { service } = makeService();

      await expect(
        service.create(
          'org-1',
          {
            name: 'X',
            code: 'X',
            subjectType: 'PURCHASE_ORDER',
            steps: [{ ...validStep, requiredPermission: 'not.a.real.permission' }],
          },
          'actor-1',
        ),
      ).rejects.toThrow(/not a permission in the catalogue/);
    });

    it('rejects an explicit approver who does not belong to this organisation', async () => {
      const { service, userService } = makeService();
      userService.getById.mockResolvedValue(null);

      await expect(
        service.create(
          'org-1',
          {
            name: 'X',
            code: 'X',
            subjectType: 'PURCHASE_ORDER',
            steps: [{ ...validStep, assignedUserId: 'cross-tenant-user' }],
          },
          'actor-1',
        ),
      ).rejects.toThrow(/does not belong to this organisation/);
    });

    it('accepts a same-tenant explicit approver', async () => {
      const { service, repo, userService } = makeService();
      repo.createWithSteps.mockResolvedValue({ id: 'def-1' } as never);
      userService.getById.mockResolvedValue({ id: 'user-1' } as User);

      await expect(
        service.create(
          'org-1',
          {
            name: 'X',
            code: 'X',
            subjectType: 'PURCHASE_ORDER',
            steps: [{ ...validStep, assignedUserId: 'user-1' }],
          },
          'actor-1',
        ),
      ).resolves.toBeDefined();
    });

    it('rejects a duplicate code within the organisation', async () => {
      const { service, repo } = makeService();
      repo.findByCode.mockResolvedValue({ id: 'existing' } as never);

      await expect(
        service.create(
          'org-1',
          { name: 'X', code: 'DUP', subjectType: 'PURCHASE_ORDER', steps: [validStep] },
          'actor-1',
        ),
      ).rejects.toThrow(/already exists/);
    });
  });

  describe('update', () => {
    it('blocks a step-list edit while non-terminal instances exist', async () => {
      const { service, repo } = makeService();
      repo.findById.mockResolvedValue({ id: 'def-1', version: 1, steps: [] } as never);
      repo.countActiveInstances.mockResolvedValue(2);

      await expect(
        service.update('org-1', 'def-1', { steps: [validStep] }, 'actor-1'),
      ).rejects.toThrow(/still in progress/);
    });

    it('allows a name/description edit even with active instances', async () => {
      const { service, repo } = makeService();
      repo.findById.mockResolvedValue({ id: 'def-1', version: 1, steps: [] } as never);
      repo.countActiveInstances.mockResolvedValue(2);
      repo.update.mockResolvedValue({ id: 'def-1' } as never);

      await expect(
        service.update('org-1', 'def-1', { name: 'New Name' }, 'actor-1'),
      ).resolves.toBeDefined();
      expect(repo.countActiveInstances).not.toHaveBeenCalled();
    });

    it('bumps the version when steps change on an already-active definition', async () => {
      const { service, repo } = makeService();
      repo.findById.mockResolvedValue({ id: 'def-1', version: 3, steps: [] } as never);
      repo.countActiveInstances.mockResolvedValue(0);
      repo.update.mockResolvedValue({ id: 'def-1', version: 4 } as never);

      await service.update('org-1', 'def-1', { steps: [validStep] }, 'actor-1');

      expect(repo.update).toHaveBeenCalledWith(
        'org-1',
        'def-1',
        expect.objectContaining({ version: 4 }),
        [validStep],
      );
    });
  });

  describe('activate', () => {
    it('rejects activating a definition with no steps', async () => {
      const { service, repo } = makeService();
      repo.findById.mockResolvedValue({ id: 'def-1', steps: [] } as never);

      await expect(service.activate('org-1', 'def-1', 'actor-1')).rejects.toThrow(/no steps/);
    });

    it('activates a definition with at least one step', async () => {
      const { service, repo } = makeService();
      repo.findById.mockResolvedValue({ id: 'def-1', steps: [validStep] } as never);
      repo.update.mockResolvedValue({ id: 'def-1', status: 'ACTIVE' } as never);

      await expect(service.activate('org-1', 'def-1', 'actor-1')).resolves.toBeDefined();
    });
  });
});
