import { CashAccountType } from '@prisma/client';

import { TokenPayload } from '../../identity/auth/ports/token.port';
import { CashAccountController } from './cash-account.controller';
import { CashAccountService } from './cash-account.service';

function makeUser(organisationId: string): TokenPayload {
  return { sub: 'user-1', organisationId, sessionId: 'session-1' };
}

const CASH_ACCOUNT = {
  id: 'ca-1',
  organisationId: 'org-1',
  accountCode: 'CASH-001',
  name: 'GTBank',
  accountType: CashAccountType.BANK,
  currency: 'NGN',
  bankName: 'GTBank',
  accountNumber: '0123456789',
  accountName: 'Boby Bites Ltd',
  description: null,
  status: 'ACTIVE' as const,
  linkedChartOfAccountId: 'coa-1',
  openingBalance: 0,
  openingBalanceDate: null,
  idempotencyKey: null,
  createdById: 'user-1',
  updatedById: 'user-1',
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('CashAccountController', () => {
  function makeController() {
    const cashAccountService = {
      list: jest.fn().mockResolvedValue([CASH_ACCOUNT]),
      getById: jest.fn().mockResolvedValue(CASH_ACCOUNT),
      getAccountNumber: jest.fn().mockResolvedValue(CASH_ACCOUNT.accountNumber),
      create: jest.fn().mockResolvedValue({ cashAccount: CASH_ACCOUNT, wasCreated: true }),
      update: jest.fn().mockResolvedValue(CASH_ACCOUNT),
      deactivate: jest.fn().mockResolvedValue({ ...CASH_ACCOUNT, status: 'INACTIVE' }),
      activate: jest.fn().mockResolvedValue(CASH_ACCOUNT),
    } as unknown as jest.Mocked<CashAccountService>;
    const auditService = { record: jest.fn() };
    return {
      controller: new CashAccountController(cashAccountService, auditService as never),
      cashAccountService,
      auditService,
    };
  }

  it('masks the account number on list/get responses, never returning the full value', async () => {
    const { controller } = makeController();
    const listResult = await controller.list(makeUser('org-1'));
    expect(listResult.items[0]!.accountNumberMasked).toBe('••••6789');
    expect(listResult.items[0]!).not.toHaveProperty('accountNumber');

    const getOneResult = await controller.getOne(makeUser('org-1'), 'ca-1');
    expect(getOneResult.accountNumberMasked).toBe('••••6789');
  });

  it('the reveal endpoint returns the full account number and records an audit event with no metadata payload', async () => {
    const { controller, cashAccountService, auditService } = makeController();
    const req = { ip: '127.0.0.1', headers: {} } as never;
    const result = await controller.getAccountNumber('ca-1', makeUser('org-1'), req);

    expect(result.accountNumber).toBe('0123456789');
    expect(cashAccountService.getAccountNumber).toHaveBeenCalledWith('org-1', 'ca-1');
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'cash-account.number-revealed',
        entityId: 'ca-1',
        organisationId: 'org-1',
      }),
    );
    expect(auditService.record.mock.calls[0]![0]).not.toHaveProperty('metadata');
  });

  it('tenant isolation: every route is scoped by the caller organisation', async () => {
    const { controller, cashAccountService } = makeController();
    await controller.list(makeUser('org-2'));
    await controller.getOne(makeUser('org-2'), 'ca-1');
    await controller.update('ca-1', { name: 'Renamed' }, makeUser('org-2'), {
      ip: '',
      headers: {},
    } as never);
    await controller.deactivate('ca-1', makeUser('org-2'), { ip: '', headers: {} } as never);

    expect(cashAccountService.list).toHaveBeenCalledWith('org-2', expect.anything());
    expect(cashAccountService.getById).toHaveBeenCalledWith('org-2', 'ca-1');
    expect(cashAccountService.update).toHaveBeenCalledWith(
      'org-2',
      'ca-1',
      expect.anything(),
      'user-1',
    );
    expect(cashAccountService.deactivate).toHaveBeenCalledWith('org-2', 'ca-1', 'user-1');
  });

  it('only emits the audit event when the service reports wasCreated: true', async () => {
    const { controller, cashAccountService, auditService } = makeController();
    cashAccountService.create.mockResolvedValueOnce({
      cashAccount: CASH_ACCOUNT,
      wasCreated: false,
    });

    await controller.create(
      {
        accountCode: 'CASH-001',
        name: 'GTBank',
        accountType: CashAccountType.BANK,
        currency: 'NGN',
      },
      makeUser('org-1'),
      { ip: '', headers: {} } as never,
    );

    expect(auditService.record).not.toHaveBeenCalled();
  });
});
