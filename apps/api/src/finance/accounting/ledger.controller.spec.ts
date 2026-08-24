import { TokenPayload } from '../../identity/auth/ports/token.port';
import { LedgerController } from './ledger.controller';
import { LedgerService } from './ledger.service';

describe('LedgerController', () => {
  const tokenUser: TokenPayload = {
    sub: 'user-1',
    organisationId: 'org-1',
    sessionId: 'session-1',
  };

  function makeController() {
    const ledgerService = {
      getLedger: jest.fn().mockResolvedValue([]),
      getTrialBalance: jest.fn().mockResolvedValue({ rows: [], totalDebit: 0, totalCredit: 0 }),
      getAccountActivity: jest.fn(),
    } as unknown as jest.Mocked<LedgerService>;

    const controller = new LedgerController(ledgerService);
    return { controller, ledgerService };
  }

  it('getLedger delegates with parsed date filters, scoped to the caller organisation', async () => {
    const { controller, ledgerService } = makeController();

    await controller.getLedger(tokenUser, 'account-1', '2026-08-01', '2026-08-31');

    expect(ledgerService.getLedger).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({
        accountId: 'account-1',
        from: new Date('2026-08-01'),
        to: new Date('2026-08-31'),
      }),
    );
  });

  it('getTrialBalance delegates scoped to the caller organisation', async () => {
    const { controller, ledgerService } = makeController();

    const result = await controller.getTrialBalance(tokenUser);

    expect(ledgerService.getTrialBalance).toHaveBeenCalledWith('org-1', expect.any(Object));
    expect(result.totalDebit).toBe(result.totalCredit);
  });

  it('getAccountActivity delegates the account id and caller organisation', async () => {
    const { controller, ledgerService } = makeController();
    ledgerService.getAccountActivity.mockResolvedValue({
      account: { id: 'account-1', code: '1110', name: 'Bank', type: 'ASSET' },
      openingBalance: 0,
      transactions: [],
      closingBalance: 0,
    });

    await controller.getAccountActivity(tokenUser, 'account-1');

    expect(ledgerService.getAccountActivity).toHaveBeenCalledWith(
      'org-1',
      'account-1',
      expect.any(Object),
    );
  });
});
