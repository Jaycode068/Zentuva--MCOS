import { HiringRequestRepository } from '../../hr/recruitment/hiring-request.repository';
import { HiringRequestWorkflowHandler } from './hiring-request-workflow.handler';

describe('HiringRequestWorkflowHandler', () => {
  function makeHandler() {
    const repo = {
      findById: jest.fn(),
      findByIdWithRelations: jest.fn(),
      submit: jest.fn(),
      approve: jest.fn(),
      revertToDraft: jest.fn(),
    } as unknown as jest.Mocked<HiringRequestRepository>;
    return { handler: new HiringRequestWorkflowHandler(repo), repo };
  }

  describe('describe', () => {
    it('returns null when the hiring request does not exist', async () => {
      const { handler, repo } = makeHandler();
      repo.findByIdWithRelations.mockResolvedValue(null);

      expect(await handler.describe('org-1', 'hr-1')).toBeNull();
    });

    it('builds a human-readable label from the position and department', async () => {
      const { handler, repo } = makeHandler();
      repo.findByIdWithRelations.mockResolvedValue({
        position: { title: 'Cashier' },
        department: { name: 'Finance' },
      } as never);

      expect(await handler.describe('org-1', 'hr-1')).toBe('Hiring Request — Cashier (Finance)');
    });
  });

  describe('validateForSubmission', () => {
    it('rejects a subject that does not exist', async () => {
      const { handler, repo } = makeHandler();
      repo.findById.mockResolvedValue(null);

      expect(await handler.validateForSubmission('org-1', 'hr-1')).toEqual({
        ok: false,
        reason: 'Hiring request not found',
      });
    });

    it.each(['DRAFT', 'SUBMITTED'])('accepts a %s hiring request', async (status) => {
      const { handler, repo } = makeHandler();
      repo.findById.mockResolvedValue({ status } as never);

      expect(await handler.validateForSubmission('org-1', 'hr-1')).toEqual({ ok: true });
    });

    it('rejects an already-decided hiring request', async () => {
      const { handler, repo } = makeHandler();
      repo.findById.mockResolvedValue({ status: 'APPROVED' } as never);

      const result = await handler.validateForSubmission('org-1', 'hr-1');
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/must be DRAFT or SUBMITTED/);
    });
  });

  it('onWorkflowSubmitted performs the DRAFT/SUBMITTED -> SUBMITTED transition', async () => {
    const { handler, repo } = makeHandler();

    await handler.onWorkflowSubmitted('org-1', 'hr-1', 'actor-1');

    expect(repo.submit).toHaveBeenCalledWith('org-1', 'hr-1');
  });

  it('onWorkflowApproved approves the hiring request', async () => {
    const { handler, repo } = makeHandler();

    await handler.onWorkflowApproved('org-1', 'hr-1', 'approver-1');

    expect(repo.approve).toHaveBeenCalledWith('org-1', 'hr-1');
  });

  describe('onWorkflowExited', () => {
    it('reverts a SUBMITTED hiring request back to DRAFT', async () => {
      const { handler, repo } = makeHandler();
      repo.findById.mockResolvedValue({ status: 'SUBMITTED' } as never);

      await handler.onWorkflowExited('org-1', 'hr-1', 'actor-1');

      expect(repo.revertToDraft).toHaveBeenCalledWith('org-1', 'hr-1');
    });

    it('does nothing to a request that never left DRAFT', async () => {
      const { handler, repo } = makeHandler();
      repo.findById.mockResolvedValue({ status: 'DRAFT' } as never);

      await handler.onWorkflowExited('org-1', 'hr-1', 'actor-1');

      expect(repo.revertToDraft).not.toHaveBeenCalled();
    });
  });
});
