import { TokenPayload } from '../identity/auth/ports/token.port';
import { AccountsPayableController } from './accounts-payable.controller';
import { AccountsPayableService } from './accounts-payable.service';

function makeUser(organisationId: string): TokenPayload {
  return { sub: 'user-1', organisationId, sessionId: 'session-1' };
}

describe('AccountsPayableController', () => {
  function makeController() {
    const accountsPayableService = {
      getSummary: jest.fn().mockResolvedValue({ totalOutstanding: 0 }),
      listBySupplier: jest.fn().mockResolvedValue([]),
      getAgingReport: jest.fn().mockResolvedValue({ totalOutstanding: 0, bySupplier: [] }),
    } as unknown as jest.Mocked<AccountsPayableService>;
    return {
      controller: new AccountsPayableController(accountsPayableService),
      accountsPayableService,
    };
  }

  it('aging scopes to the caller organisation and parses an optional asOf date', async () => {
    const { controller, accountsPayableService } = makeController();

    await controller.aging(makeUser('org-1'), '2026-08-29');

    expect(accountsPayableService.getAgingReport).toHaveBeenCalledWith(
      'org-1',
      new Date('2026-08-29'),
    );
  });

  it('tenant isolation: every route is scoped by the caller organisation', async () => {
    const { controller, accountsPayableService } = makeController();

    await controller.summary(makeUser('org-2'));
    await controller.bySupplier(makeUser('org-2'));
    await controller.aging(makeUser('org-2'));

    expect(accountsPayableService.getSummary).toHaveBeenCalledWith('org-2');
    expect(accountsPayableService.listBySupplier).toHaveBeenCalledWith('org-2');
    expect(accountsPayableService.getAgingReport).toHaveBeenCalledWith('org-2', undefined);
  });
});
