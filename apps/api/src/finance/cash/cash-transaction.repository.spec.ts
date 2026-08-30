import { CashTransactionType } from '@prisma/client';

import {
  CashTransactionRepository,
  InvalidCashAccountError,
  InvalidContraAccountError,
} from './cash-transaction.repository';
import { PrismaService } from '../../prisma/prisma.service';

/** Same deliberate exception/fake-tx technique as `cash-account.repository.spec.ts`. */
function makeFakeTx(options: {
  cashAccount?: Record<string, unknown> | null;
  contraAccount?: Record<string, unknown> | null;
}) {
  const cashTransactions = new Map<string, Record<string, unknown>>();
  const journalEntries = new Map<string, Record<string, unknown>>();
  let txSequence = 0;
  let journalSequence = 0;

  const tx = {
    cashTransaction: {
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
          for (const transaction of cashTransactions.values()) {
            if (
              transaction.cashAccountId === key.cashAccountId &&
              transaction.idempotencyKey === key.idempotencyKey
            ) {
              return transaction;
            }
          }
          return null;
        },
      ),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        txSequence += 1;
        const id = `cash-tx-${txSequence}`;
        const transaction = { id, ...data };
        cashTransactions.set(id, transaction);
        return transaction;
      }),
      update: jest.fn(
        async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const existing = cashTransactions.get(where.id)!;
          const updated = { ...existing, ...data };
          cashTransactions.set(where.id, updated);
          return updated;
        },
      ),
      findFirst: jest.fn(async ({ where }: { where: { id: string; organisationId?: string } }) => {
        const transaction = cashTransactions.get(where.id);
        if (!transaction) return null;
        if (where.organisationId && transaction.organisationId !== where.organisationId)
          return null;
        return transaction;
      }),
    },
    cashAccount: {
      findFirst: jest.fn(async () => options.cashAccount ?? null),
    },
    chartOfAccount: {
      findFirst: jest.fn(
        async ({
          where,
        }: {
          where: { id: string; organisationId: string; systemKey?: string };
        }) => {
          if (where.systemKey) return null;
          if (options.contraAccount && options.contraAccount.id === where.id) {
            return options.contraAccount;
          }
          if (options.cashAccount && options.cashAccount.linkedChartOfAccountId === where.id) {
            return { id: where.id, organisationId: where.organisationId };
          }
          return null;
        },
      ),
    },
    accountingPeriod: {
      findFirst: jest.fn(async () => ({ id: 'period-1', status: 'OPEN' })),
    },
    journalEntry: {
      findUnique: jest.fn(async () => null),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        journalSequence += 1;
        const id = `journal-${journalSequence}`;
        const entry = { id, ...data };
        journalEntries.set(id, entry);
        return entry;
      }),
    },
  };

  return { tx, cashTransactions, journalEntries };
}

function makeRepository(options: {
  cashAccount?: Record<string, unknown> | null;
  contraAccount?: Record<string, unknown> | null;
}) {
  const fake = makeFakeTx(options);
  const prisma = {
    $transaction: jest.fn(async (callback: (tx: unknown) => unknown) => callback(fake.tx)),
  } as unknown as PrismaService;
  return { repository: new CashTransactionRepository(prisma), ...fake };
}

const ORG = 'org-1';
const CASH_ACCOUNT = {
  id: 'cash-acc-1',
  organisationId: ORG,
  linkedChartOfAccountId: 'coa-cash-acc',
};
const CONTRA_ACCOUNT = {
  id: 'coa-contra',
  organisationId: ORG,
  isSystemAccount: false,
  type: 'EXPENSE',
};

describe('CashTransactionRepository.create', () => {
  it('posts DR cash account / CR contra account for a RECEIPT', async () => {
    const { repository, journalEntries } = makeRepository({
      cashAccount: CASH_ACCOUNT,
      contraAccount: CONTRA_ACCOUNT,
    });

    await repository.create({
      organisationId: ORG,
      cashAccountId: CASH_ACCOUNT.id,
      transactionType: CashTransactionType.RECEIPT,
      transactionDate: new Date('2026-08-01'),
      amount: 5000,
      description: 'Misc receipt',
      contraAccountId: CONTRA_ACCOUNT.id,
      createdById: 'user-1',
    });

    const [entry] = journalEntries.values();
    const lines = entry!.lines as {
      create: { accountId: string; debit: number; credit: number }[];
    };
    expect(lines.create[0]).toMatchObject({ accountId: 'coa-cash-acc', debit: 5000 });
    expect(lines.create[1]).toMatchObject({ accountId: 'coa-contra', credit: 5000 });
  });

  it('posts DR contra account / CR cash account for a PAYMENT', async () => {
    const { repository, journalEntries } = makeRepository({
      cashAccount: CASH_ACCOUNT,
      contraAccount: CONTRA_ACCOUNT,
    });

    await repository.create({
      organisationId: ORG,
      cashAccountId: CASH_ACCOUNT.id,
      transactionType: CashTransactionType.PAYMENT,
      transactionDate: new Date('2026-08-01'),
      amount: 5000,
      description: 'Bank charge',
      contraAccountId: CONTRA_ACCOUNT.id,
      createdById: 'user-1',
    });

    const [entry] = journalEntries.values();
    const lines = entry!.lines as {
      create: { accountId: string; debit: number; credit: number }[];
    };
    expect(lines.create[0]).toMatchObject({ accountId: 'coa-contra', debit: 5000 });
    expect(lines.create[1]).toMatchObject({ accountId: 'coa-cash-acc', credit: 5000 });
  });

  it('rejects when the cash account does not belong to this organisation', async () => {
    const { repository } = makeRepository({ cashAccount: null, contraAccount: CONTRA_ACCOUNT });
    await expect(
      repository.create({
        organisationId: ORG,
        cashAccountId: 'missing',
        transactionType: CashTransactionType.RECEIPT,
        transactionDate: new Date(),
        amount: 100,
        description: 'x',
        contraAccountId: CONTRA_ACCOUNT.id,
        createdById: 'user-1',
      }),
    ).rejects.toBeInstanceOf(InvalidCashAccountError);
  });

  it('rejects a system-reserved contra account', async () => {
    const { repository } = makeRepository({
      cashAccount: CASH_ACCOUNT,
      contraAccount: { id: 'coa-cash', organisationId: ORG, isSystemAccount: true, type: 'ASSET' },
    });
    await expect(
      repository.create({
        organisationId: ORG,
        cashAccountId: CASH_ACCOUNT.id,
        transactionType: CashTransactionType.RECEIPT,
        transactionDate: new Date(),
        amount: 100,
        description: 'x',
        contraAccountId: 'coa-cash',
        createdById: 'user-1',
      }),
    ).rejects.toBeInstanceOf(InvalidContraAccountError);
  });

  it('is idempotent — a replayed idempotencyKey returns the original result without posting twice', async () => {
    const { repository, journalEntries } = makeRepository({
      cashAccount: CASH_ACCOUNT,
      contraAccount: CONTRA_ACCOUNT,
    });

    const first = await repository.create({
      organisationId: ORG,
      cashAccountId: CASH_ACCOUNT.id,
      transactionType: CashTransactionType.RECEIPT,
      transactionDate: new Date('2026-08-01'),
      amount: 5000,
      description: 'Misc receipt',
      contraAccountId: CONTRA_ACCOUNT.id,
      idempotencyKey: 'key-1',
      createdById: 'user-1',
    });
    const second = await repository.create({
      organisationId: ORG,
      cashAccountId: CASH_ACCOUNT.id,
      transactionType: CashTransactionType.RECEIPT,
      transactionDate: new Date('2026-08-01'),
      amount: 5000,
      description: 'Misc receipt',
      contraAccountId: CONTRA_ACCOUNT.id,
      idempotencyKey: 'key-1',
      createdById: 'user-1',
    });

    expect(first.wasCreated).toBe(true);
    expect(second.wasCreated).toBe(false);
    expect(second.cashTransaction.id).toBe(first.cashTransaction.id);
    expect(journalEntries.size).toBe(1);
  });
});
