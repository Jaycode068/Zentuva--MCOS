import { TokenPayload } from '../../identity/auth/ports/token.port';
import { BankReconciliationController } from './bank-reconciliation.controller';
import { BankReconciliationService } from './bank-reconciliation.service';

function makeUser(organisationId: string): TokenPayload {
  return { sub: 'user-1', organisationId, sessionId: 'session-1' };
}

const RECONCILIATION = {
  id: 'recon-1',
  organisationId: 'org-1',
  cashAccountId: 'ca-1',
  periodStart: new Date('2026-08-01'),
  periodEnd: new Date('2026-08-31'),
  openingBankBalance: 10_000_000,
  closingBankBalance: 12_500_000,
  status: 'IN_PROGRESS',
  reconciledById: null,
  reconciledAt: null,
  idempotencyKey: null,
  createdById: 'user-1',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const DETAIL = {
  reconciliation: RECONCILIATION,
  matches: [],
  unmatchedBank: [],
  unmatchedBook: [],
  bookBalance: 12_500_000,
  difference: 0,
};

describe('BankReconciliationController', () => {
  function makeController() {
    const bankReconciliationService = {
      list: jest.fn().mockResolvedValue([RECONCILIATION]),
      getDetail: jest.fn().mockResolvedValue(DETAIL),
      create: jest.fn().mockResolvedValue({ bankReconciliation: RECONCILIATION, wasCreated: true }),
      autoMatch: jest.fn().mockResolvedValue({ matchedCount: 2 }),
      match: jest.fn().mockResolvedValue({ match: { id: 'match-1' }, wasCreated: true }),
      unmatch: jest.fn().mockResolvedValue(undefined),
      complete: jest.fn().mockResolvedValue({ ...RECONCILIATION, status: 'COMPLETED' }),
    } as unknown as jest.Mocked<BankReconciliationService>;
    const auditService = { record: jest.fn() };
    return {
      controller: new BankReconciliationController(
        bankReconciliationService,
        auditService as never,
      ),
      bankReconciliationService,
      auditService,
    };
  }

  it('tenant isolation: every route is scoped by the caller organisation', async () => {
    const { controller, bankReconciliationService } = makeController();
    await controller.list(makeUser('org-2'));
    await controller.getOne(makeUser('org-2'), 'recon-1');

    expect(bankReconciliationService.list).toHaveBeenCalledWith('org-2', undefined);
    expect(bankReconciliationService.getDetail).toHaveBeenCalledWith('org-2', 'recon-1');
  });

  it('only emits a match audit event when the service reports wasCreated: true', async () => {
    const { controller, bankReconciliationService, auditService } = makeController();
    bankReconciliationService.match.mockResolvedValueOnce({
      match: { id: 'match-1' } as never,
      wasCreated: false,
    });

    await controller.match(
      'recon-1',
      { bankStatementTransactionId: 'bank-1', journalEntryLineId: 'line-1' },
      makeUser('org-1'),
      { ip: '', headers: {} } as never,
    );

    expect(auditService.record).not.toHaveBeenCalled();
  });

  it('only emits an auto-match audit event when at least one pair was matched', async () => {
    const { controller, bankReconciliationService, auditService } = makeController();
    bankReconciliationService.autoMatch.mockResolvedValueOnce({ matchedCount: 0 });

    await controller.autoMatch('recon-1', makeUser('org-1'), { ip: '', headers: {} } as never);

    expect(auditService.record).not.toHaveBeenCalled();
  });

  it('does not re-emit a completed audit event when the reconciliation was already completed', async () => {
    const { controller, bankReconciliationService, auditService } = makeController();
    bankReconciliationService.getDetail.mockResolvedValueOnce({
      ...DETAIL,
      reconciliation: { ...RECONCILIATION, status: 'COMPLETED' },
    });

    await controller.complete('recon-1', makeUser('org-1'), { ip: '', headers: {} } as never);

    expect(auditService.record).not.toHaveBeenCalled();
  });
});
