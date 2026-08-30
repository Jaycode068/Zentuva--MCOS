import { TokenPayload } from '../identity/auth/ports/token.port';
import { AccountsReceivableController } from './accounts-receivable.controller';
import { AccountsReceivableService } from './accounts-receivable.service';

function makeUser(organisationId: string): TokenPayload {
  return { sub: 'user-1', organisationId, sessionId: 'session-1' };
}

describe('AccountsReceivableController', () => {
  function makeController() {
    const accountsReceivableService = {
      getSummary: jest.fn().mockResolvedValue({ totalOutstanding: 0 }),
      listByCustomer: jest.fn().mockResolvedValue([]),
      getCustomerBalance: jest.fn().mockResolvedValue({}),
      getAgingReport: jest.fn().mockResolvedValue({ totalOutstanding: 0, byCustomer: [] }),
    } as unknown as jest.Mocked<AccountsReceivableService>;
    return {
      controller: new AccountsReceivableController(accountsReceivableService),
      accountsReceivableService,
    };
  }

  it('aging scopes to the caller organisation and parses an optional asOf date', async () => {
    const { controller, accountsReceivableService } = makeController();

    await controller.aging(makeUser('org-1'), '2026-08-29');

    expect(accountsReceivableService.getAgingReport).toHaveBeenCalledWith(
      'org-1',
      new Date('2026-08-29'),
    );
  });

  it('aging defaults asOf to undefined (service defaults to now) when omitted', async () => {
    const { controller, accountsReceivableService } = makeController();

    await controller.aging(makeUser('org-1'));

    expect(accountsReceivableService.getAgingReport).toHaveBeenCalledWith('org-1', undefined);
  });

  it('tenant isolation: every route is scoped by the caller organisation', async () => {
    const { controller, accountsReceivableService } = makeController();

    await controller.summary(makeUser('org-2'));
    await controller.byCustomer(makeUser('org-2'));
    await controller.aging(makeUser('org-2'));

    expect(accountsReceivableService.getSummary).toHaveBeenCalledWith('org-2');
    expect(accountsReceivableService.listByCustomer).toHaveBeenCalledWith('org-2');
    expect(accountsReceivableService.getAgingReport).toHaveBeenCalledWith('org-2', undefined);
  });
});
