import { TokenPayload } from '../../identity/auth/ports/token.port';
import { ReconciliationController } from './reconciliation.controller';
import { ReconciliationService } from './reconciliation.service';
import { PayablesReconciliationService } from './payables-reconciliation.service';

function makeUser(organisationId: string): TokenPayload {
  return { sub: 'user-1', organisationId, sessionId: 'session-1' };
}

describe('ReconciliationController', () => {
  function makeController() {
    const reconciliationService = {
      getInventoryReconciliation: jest.fn().mockResolvedValue({ reconciled: true }),
    } as unknown as jest.Mocked<ReconciliationService>;
    const payablesReconciliationService = {
      getPayablesReconciliation: jest.fn().mockResolvedValue({ reconciled: true }),
    } as unknown as jest.Mocked<PayablesReconciliationService>;
    return {
      controller: new ReconciliationController(
        reconciliationService,
        payablesReconciliationService,
      ),
      reconciliationService,
      payablesReconciliationService,
    };
  }

  it('tenant isolation: each caller organisation is scoped independently', async () => {
    const { controller, reconciliationService } = makeController();

    await controller.getReconciliation(makeUser('org-1'));
    await controller.getReconciliation(makeUser('org-2'));

    expect(reconciliationService.getInventoryReconciliation).toHaveBeenNthCalledWith(1, 'org-1');
    expect(reconciliationService.getInventoryReconciliation).toHaveBeenNthCalledWith(2, 'org-2');
  });

  it('payables reconciliation: tenant isolation, each caller organisation is scoped independently', async () => {
    const { controller, payablesReconciliationService } = makeController();

    await controller.getPayablesReconciliation(makeUser('org-1'));
    await controller.getPayablesReconciliation(makeUser('org-2'));

    expect(payablesReconciliationService.getPayablesReconciliation).toHaveBeenNthCalledWith(
      1,
      'org-1',
    );
    expect(payablesReconciliationService.getPayablesReconciliation).toHaveBeenNthCalledWith(
      2,
      'org-2',
    );
  });

  it('payables reconciliation: returns exactly what the service resolves, unmodified', async () => {
    const { controller, payablesReconciliationService } = makeController();
    const result = {
      asOf: new Date('2026-10-15'),
      glAccountsPayableBalance: 6_430_000,
      supplierInvoiceOutstandingBalance: 5_000_000,
      difference: 1_430_000,
      unmatchedGoodsReceiptLiability: 1_430_000,
      unexplainedResidual: 0,
      reconciled: false,
    };
    payablesReconciliationService.getPayablesReconciliation.mockResolvedValue(result);

    await expect(controller.getPayablesReconciliation(makeUser('org-1'))).resolves.toBe(result);
  });
});
