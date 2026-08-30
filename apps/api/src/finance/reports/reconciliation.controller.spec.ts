import { TokenPayload } from '../../identity/auth/ports/token.port';
import { ReconciliationController } from './reconciliation.controller';
import { ReconciliationService } from './reconciliation.service';

function makeUser(organisationId: string): TokenPayload {
  return { sub: 'user-1', organisationId, sessionId: 'session-1' };
}

describe('ReconciliationController', () => {
  function makeController() {
    const reconciliationService = {
      getInventoryReconciliation: jest.fn().mockResolvedValue({ reconciled: true }),
    } as unknown as jest.Mocked<ReconciliationService>;
    return {
      controller: new ReconciliationController(reconciliationService),
      reconciliationService,
    };
  }

  it('tenant isolation: each caller organisation is scoped independently', async () => {
    const { controller, reconciliationService } = makeController();

    await controller.getReconciliation(makeUser('org-1'));
    await controller.getReconciliation(makeUser('org-2'));

    expect(reconciliationService.getInventoryReconciliation).toHaveBeenNthCalledWith(1, 'org-1');
    expect(reconciliationService.getInventoryReconciliation).toHaveBeenNthCalledWith(2, 'org-2');
  });
});
