import { TokenPayload } from '../../identity/auth/ports/token.port';
import { BankStatementController } from './bank-statement.controller';
import { BankStatementService } from './bank-statement.service';

function makeUser(organisationId: string): TokenPayload {
  return { sub: 'user-1', organisationId, sessionId: 'session-1' };
}

const IMPORT_RECORD = {
  id: 'import-1',
  organisationId: 'org-1',
  cashAccountId: 'ca-1',
  filename: 'august.csv',
  importedById: 'user-1',
  importedAt: new Date(),
  idempotencyKey: null,
  totalRows: 3,
  importedRows: 3,
  duplicateRows: 0,
  errorRows: 0,
};

describe('BankStatementController', () => {
  function makeController() {
    const bankStatementService = {
      list: jest.fn().mockResolvedValue([]),
      listImports: jest.fn().mockResolvedValue([IMPORT_RECORD]),
      getImportById: jest.fn().mockResolvedValue(IMPORT_RECORD),
      import: jest.fn().mockResolvedValue({ bankStatementImport: IMPORT_RECORD, wasCreated: true }),
    } as unknown as jest.Mocked<BankStatementService>;
    const auditService = { record: jest.fn() };
    return {
      controller: new BankStatementController(bankStatementService, auditService as never),
      bankStatementService,
      auditService,
    };
  }

  it('tenant isolation: every route is scoped by the caller organisation', async () => {
    const { controller, bankStatementService } = makeController();
    await controller.listImports(makeUser('org-2'));
    await controller.listTransactions(makeUser('org-2'));

    expect(bankStatementService.listImports).toHaveBeenCalledWith('org-2', undefined);
    expect(bankStatementService.list).toHaveBeenCalledWith('org-2', expect.anything());
  });

  it('rejects a single import batch larger than 5000 rows before calling the service', async () => {
    const { controller, bankStatementService } = makeController();
    const rows = Array.from({ length: 5001 }, () => ({
      transactionDate: new Date(),
      description: 'x',
      debit: 0,
      credit: 1,
    }));

    await expect(
      controller.import('ca-1', { filename: 'huge.csv', rows } as never, makeUser('org-1'), {
        ip: '',
        headers: {},
      } as never),
    ).rejects.toThrow();
    expect(bankStatementService.import).not.toHaveBeenCalled();
  });

  it('only emits the audit event when the service reports wasCreated: true', async () => {
    const { controller, bankStatementService, auditService } = makeController();
    bankStatementService.import.mockResolvedValueOnce({
      bankStatementImport: IMPORT_RECORD,
      wasCreated: false,
    });

    await controller.import(
      'ca-1',
      {
        filename: 'august.csv',
        rows: [{ transactionDate: new Date(), description: 'x', debit: 0, credit: 1 }],
      } as never,
      makeUser('org-1'),
      { ip: '', headers: {} } as never,
    );

    expect(auditService.record).not.toHaveBeenCalled();
  });
});
