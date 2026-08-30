import { TokenPayload } from '../../identity/auth/ports/token.port';
import { FinancialStatementController } from './financial-statement.controller';
import { FinancialStatementService } from './financial-statement.service';

describe('FinancialStatementController', () => {
  const tokenUser: TokenPayload = {
    sub: 'user-1',
    organisationId: 'org-1',
    sessionId: 'session-1',
  };

  function makeController() {
    const financialStatementService = {
      getProfitAndLoss: jest.fn().mockResolvedValue({ revenue: 0 }),
      getProfitAndLossComparison: jest
        .fn()
        .mockResolvedValue({ current: { revenue: 0 }, previous: null }),
      getBalanceSheet: jest.fn().mockResolvedValue({ balanced: true }),
    } as unknown as jest.Mocked<FinancialStatementService>;
    const controller = new FinancialStatementController(financialStatementService);
    return { controller, financialStatementService };
  }

  it('getProfitAndLoss scopes to the caller organisation and wraps a plain result as { current, previous: null }', async () => {
    const { controller, financialStatementService } = makeController();

    const result = await controller.getProfitAndLoss(tokenUser, '2026-08-01', '2026-08-31');

    expect(financialStatementService.getProfitAndLoss).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({ from: new Date('2026-08-01'), to: new Date('2026-08-31') }),
    );
    expect(result).toEqual({ current: { revenue: 0 }, previous: null });
  });

  it('requests a comparison only when compare=previous_period and a from date are both present', async () => {
    const { controller, financialStatementService } = makeController();

    await controller.getProfitAndLoss(
      tokenUser,
      '2026-08-01',
      '2026-08-31',
      undefined,
      'previous_period',
    );

    expect(financialStatementService.getProfitAndLossComparison).toHaveBeenCalledWith('org-1', {
      from: new Date('2026-08-01'),
      to: new Date('2026-08-31'),
    });
    expect(financialStatementService.getProfitAndLoss).not.toHaveBeenCalled();
  });

  it('ignores compare=previous_period when no from date is given', async () => {
    const { controller, financialStatementService } = makeController();

    await controller.getProfitAndLoss(
      tokenUser,
      undefined,
      '2026-08-31',
      undefined,
      'previous_period',
    );

    expect(financialStatementService.getProfitAndLossComparison).not.toHaveBeenCalled();
    expect(financialStatementService.getProfitAndLoss).toHaveBeenCalled();
  });

  it('getBalanceSheet scopes to the caller organisation', async () => {
    const { controller, financialStatementService } = makeController();

    await controller.getBalanceSheet(tokenUser, '2026-08-31');

    expect(financialStatementService.getBalanceSheet).toHaveBeenCalledWith('org-1', {
      asOf: new Date('2026-08-31'),
    });
  });

  it('tenant isolation: a different caller organisation is passed through, never hardcoded', async () => {
    const { controller, financialStatementService } = makeController();
    const otherOrgUser: TokenPayload = {
      sub: 'user-2',
      organisationId: 'org-2',
      sessionId: 'session-2',
    };

    await controller.getBalanceSheet(otherOrgUser);

    expect(financialStatementService.getBalanceSheet).toHaveBeenCalledWith(
      'org-2',
      expect.any(Object),
    );
  });
});
