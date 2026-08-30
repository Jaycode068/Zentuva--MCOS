import { CashTransactionType } from '@prisma/client';

import { TokenPayload } from '../../identity/auth/ports/token.port';
import { CashTransactionController } from './cash-transaction.controller';
import { CashTransactionService } from './cash-transaction.service';

function makeUser(organisationId: string): TokenPayload {
  return { sub: 'user-1', organisationId, sessionId: 'session-1' };
}

const CASH_TRANSACTION = {
  id: 'ct-1',
  organisationId: 'org-1',
  cashAccountId: 'ca-1',
  cashAccount: { id: 'ca-1', accountCode: 'CASH-001', name: 'GTBank' },
  transactionType: CashTransactionType.RECEIPT,
  transactionDate: new Date(),
  amount: 5000,
  description: 'Misc receipt',
  reference: null,
  contraAccountId: 'coa-1',
  contraAccount: { id: 'coa-1', code: '4900', name: 'Other Income' },
  status: 'RECORDED' as const,
  idempotencyKey: null,
  createdById: 'user-1',
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('CashTransactionController', () => {
  function makeController() {
    const cashTransactionService = {
      list: jest.fn().mockResolvedValue([CASH_TRANSACTION]),
      getById: jest.fn().mockResolvedValue(CASH_TRANSACTION),
      create: jest.fn().mockResolvedValue({ cashTransaction: CASH_TRANSACTION, wasCreated: true }),
      void: jest.fn().mockResolvedValue({ ...CASH_TRANSACTION, status: 'VOIDED' }),
    } as unknown as jest.Mocked<CashTransactionService>;
    const auditService = { record: jest.fn() };
    return {
      controller: new CashTransactionController(cashTransactionService, auditService as never),
      cashTransactionService,
      auditService,
    };
  }

  it('tenant isolation: every route is scoped by the caller organisation', async () => {
    const { controller, cashTransactionService } = makeController();
    await controller.list(makeUser('org-2'));
    await controller.getOne(makeUser('org-2'), 'ct-1');

    expect(cashTransactionService.list).toHaveBeenCalledWith('org-2', expect.anything());
    expect(cashTransactionService.getById).toHaveBeenCalledWith('org-2', 'ct-1');
  });

  it('only emits the audit event when the service reports wasCreated: true', async () => {
    const { controller, cashTransactionService, auditService } = makeController();
    cashTransactionService.create.mockResolvedValueOnce({
      cashTransaction: CASH_TRANSACTION,
      wasCreated: false,
    });

    await controller.create(
      {
        cashAccountId: 'ca-1',
        transactionType: CashTransactionType.RECEIPT,
        transactionDate: new Date(),
        amount: 5000,
        description: 'Misc receipt',
        contraAccountId: 'coa-1',
      },
      makeUser('org-1'),
      { ip: '', headers: {} } as never,
    );

    expect(auditService.record).not.toHaveBeenCalled();
  });
});
