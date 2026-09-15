import { PurchaseOrderRepository } from '../../procurement/purchase-order/purchase-order.repository';
import { PurchaseOrderWorkflowHandler } from './purchase-order-workflow.handler';

describe('PurchaseOrderWorkflowHandler', () => {
  function makeHandler() {
    const repo = {
      findById: jest.fn(),
      update: jest.fn(),
    } as unknown as jest.Mocked<PurchaseOrderRepository>;
    return { handler: new PurchaseOrderWorkflowHandler(repo), repo };
  }

  describe('validateForSubmission', () => {
    it('rejects a subject that does not exist', async () => {
      const { handler, repo } = makeHandler();
      repo.findById.mockResolvedValue(null);

      const result = await handler.validateForSubmission('org-1', 'po-1');

      expect(result).toEqual({ ok: false, reason: 'Purchase order not found' });
    });

    it('rejects a purchase order that is not DRAFT', async () => {
      const { handler, repo } = makeHandler();
      repo.findById.mockResolvedValue({ status: 'PENDING' } as never);

      const result = await handler.validateForSubmission('org-1', 'po-1');

      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/must be DRAFT/);
    });

    it('accepts a DRAFT purchase order', async () => {
      const { handler, repo } = makeHandler();
      repo.findById.mockResolvedValue({ status: 'DRAFT' } as never);

      const result = await handler.validateForSubmission('org-1', 'po-1');

      expect(result).toEqual({ ok: true });
    });
  });

  it('onWorkflowSubmitted transitions the PO to PENDING', async () => {
    const { handler, repo } = makeHandler();

    await handler.onWorkflowSubmitted('org-1', 'po-1', 'actor-1');

    expect(repo.update).toHaveBeenCalledWith('org-1', 'po-1', { status: 'PENDING' });
  });

  it('onWorkflowApproved transitions the PO to APPROVED and records the final approver', async () => {
    const { handler, repo } = makeHandler();

    await handler.onWorkflowApproved('org-1', 'po-1', 'approver-1');

    expect(repo.update).toHaveBeenCalledWith('org-1', 'po-1', {
      status: 'APPROVED',
      approvedById: 'approver-1',
    });
  });

  describe('onWorkflowExited', () => {
    it('reverts a PENDING purchase order back to DRAFT', async () => {
      const { handler, repo } = makeHandler();
      repo.findById.mockResolvedValue({ status: 'PENDING' } as never);

      await handler.onWorkflowExited('org-1', 'po-1', 'actor-1');

      expect(repo.update).toHaveBeenCalledWith('org-1', 'po-1', { status: 'DRAFT' });
    });

    it('does nothing to a purchase order that never left DRAFT (e.g. cancelled before submit)', async () => {
      const { handler, repo } = makeHandler();
      repo.findById.mockResolvedValue({ status: 'DRAFT' } as never);

      await handler.onWorkflowExited('org-1', 'po-1', 'actor-1');

      expect(repo.update).not.toHaveBeenCalled();
    });
  });
});
