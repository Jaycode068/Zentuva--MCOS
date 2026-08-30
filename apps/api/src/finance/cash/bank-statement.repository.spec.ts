import { BankStatementRepository, InvalidCashAccountError } from './bank-statement.repository';
import { PrismaService } from '../../prisma/prisma.service';

function makeFakeTx(cashAccount: Record<string, unknown> | null) {
  const imports = new Map<string, Record<string, unknown>>();
  const transactions = new Map<string, Record<string, unknown>>();
  let importSequence = 0;
  let transactionSequence = 0;

  const tx = {
    bankStatementImport: {
      findUnique: jest.fn(
        async ({
          where,
        }: {
          where: {
            cashAccountId_idempotencyKey?: { cashAccountId: string; idempotencyKey: string };
          };
        }) => {
          const key = where.cashAccountId_idempotencyKey;
          if (!key) return null;
          for (const record of imports.values()) {
            if (
              record.cashAccountId === key.cashAccountId &&
              record.idempotencyKey === key.idempotencyKey
            ) {
              return record;
            }
          }
          return null;
        },
      ),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        importSequence += 1;
        const id = `import-${importSequence}`;
        const record = { id, ...data };
        imports.set(id, record);
        return record;
      }),
    },
    cashAccount: {
      findFirst: jest.fn(async () => cashAccount),
    },
    bankStatementTransaction: {
      findFirst: jest.fn(
        async ({ where }: { where: { cashAccountId: string; OR: Record<string, unknown>[] } }) => {
          for (const transaction of transactions.values()) {
            if (transaction.cashAccountId !== where.cashAccountId) continue;
            const matches = where.OR.some((clause) =>
              Object.entries(clause).every(([field, value]) => transaction[field] === value),
            );
            if (matches) return transaction;
          }
          return null;
        },
      ),
      createMany: jest.fn(async ({ data }: { data: Record<string, unknown>[] }) => {
        for (const row of data) {
          transactionSequence += 1;
          transactions.set(`bank-txn-${transactionSequence}`, {
            id: `bank-txn-${transactionSequence}`,
            ...row,
          });
        }
        return { count: data.length };
      }),
    },
  };

  return { tx, imports, transactions };
}

function makeRepository(cashAccount: Record<string, unknown> | null) {
  const fake = makeFakeTx(cashAccount);
  const prisma = {
    $transaction: jest.fn(async (callback: (tx: unknown) => unknown) => callback(fake.tx)),
  } as unknown as PrismaService;
  return { repository: new BankStatementRepository(prisma), ...fake };
}

const ORG = 'org-1';
const CASH_ACCOUNT = { id: 'cash-acc-1', organisationId: ORG };

function row(
  overrides: Partial<Parameters<BankStatementRepository['import']>[0]['rows'][number]> = {},
) {
  return {
    transactionDate: new Date('2026-08-03'),
    description: 'POS Settlement',
    reference: 'REF-1',
    debit: 0,
    credit: 850_000,
    ...overrides,
  };
}

describe('BankStatementRepository.import', () => {
  it('imports valid rows and counts them', async () => {
    const { repository, transactions } = makeRepository(CASH_ACCOUNT);
    const result = await repository.import({
      organisationId: ORG,
      cashAccountId: CASH_ACCOUNT.id,
      filename: 'august.csv',
      rows: [
        row(),
        row({ description: 'Bank Charge', debit: 5000, credit: 0, reference: 'REF-2' }),
      ],
      importedById: 'user-1',
    });

    expect(result.bankStatementImport.totalRows).toBe(2);
    expect(result.bankStatementImport.importedRows).toBe(2);
    expect(result.bankStatementImport.duplicateRows).toBe(0);
    expect(transactions.size).toBe(2);
  });

  it('skips a row that duplicates an already-imported dedupeHash', async () => {
    const { repository } = makeRepository(CASH_ACCOUNT);
    await repository.import({
      organisationId: ORG,
      cashAccountId: CASH_ACCOUNT.id,
      filename: 'august.csv',
      rows: [row()],
      importedById: 'user-1',
    });
    const second = await repository.import({
      organisationId: ORG,
      cashAccountId: CASH_ACCOUNT.id,
      filename: 'august-again.csv',
      rows: [row()],
      importedById: 'user-1',
    });

    expect(second.bankStatementImport.importedRows).toBe(0);
    expect(second.bankStatementImport.duplicateRows).toBe(1);
  });

  it('skips within-batch duplicates (two identical rows in the same CSV)', async () => {
    const { repository } = makeRepository(CASH_ACCOUNT);
    const result = await repository.import({
      organisationId: ORG,
      cashAccountId: CASH_ACCOUNT.id,
      filename: 'august.csv',
      rows: [row(), row()],
      importedById: 'user-1',
    });

    expect(result.bankStatementImport.importedRows).toBe(1);
    expect(result.bankStatementImport.duplicateRows).toBe(1);
  });

  it('detects a duplicate via externalReference even when the description differs', async () => {
    const { repository } = makeRepository(CASH_ACCOUNT);
    await repository.import({
      organisationId: ORG,
      cashAccountId: CASH_ACCOUNT.id,
      filename: 'august.csv',
      rows: [row({ externalReference: 'EXT-1' })],
      importedById: 'user-1',
    });
    const second = await repository.import({
      organisationId: ORG,
      cashAccountId: CASH_ACCOUNT.id,
      filename: 'august-corrected.csv',
      rows: [row({ description: 'POS Settlement (corrected)', externalReference: 'EXT-1' })],
      importedById: 'user-1',
    });

    expect(second.bankStatementImport.duplicateRows).toBe(1);
  });

  it('rejects when the cash account does not belong to this organisation', async () => {
    const { repository } = makeRepository(null);
    await expect(
      repository.import({
        organisationId: ORG,
        cashAccountId: 'missing',
        filename: 'august.csv',
        rows: [row()],
        importedById: 'user-1',
      }),
    ).rejects.toBeInstanceOf(InvalidCashAccountError);
  });

  it('is idempotent — a replayed idempotencyKey returns the original result without re-importing', async () => {
    const { repository, transactions } = makeRepository(CASH_ACCOUNT);
    const first = await repository.import({
      organisationId: ORG,
      cashAccountId: CASH_ACCOUNT.id,
      filename: 'august.csv',
      rows: [row()],
      idempotencyKey: 'key-1',
      importedById: 'user-1',
    });
    const second = await repository.import({
      organisationId: ORG,
      cashAccountId: CASH_ACCOUNT.id,
      filename: 'august.csv',
      rows: [row()],
      idempotencyKey: 'key-1',
      importedById: 'user-1',
    });

    expect(first.wasCreated).toBe(true);
    expect(second.wasCreated).toBe(false);
    expect(second.bankStatementImport.id).toBe(first.bankStatementImport.id);
    expect(transactions.size).toBe(1);
  });
});
