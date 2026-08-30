import { ReconciliationMatchType } from '@prisma/client';

import {
  BankReconciliationRepository,
  InvalidMatchTargetError,
  ReconciliationAlreadyInProgressError,
  ReconciliationIncompleteError,
  ReconciliationNotInProgressError,
} from './bank-reconciliation.repository';
import { PrismaService } from '../../prisma/prisma.service';

const ORG = 'org-1';
const CASH_ACCOUNT = {
  id: 'cash-acc-1',
  organisationId: ORG,
  linkedChartOfAccountId: 'coa-cash-acc',
};

interface BankTxnRow {
  id: string;
  organisationId: string;
  cashAccountId: string;
  transactionDate: Date;
  amount: number;
  matchStatus: string;
}

interface BookLineRow {
  id: string;
  accountId: string;
  debit: number;
  credit: number;
  journalEntry: {
    id: string;
    organisationId: string;
    status: string;
    date: Date;
    journalNumber: string;
  };
}

function makeFakeTx(seed: {
  reconciliations?: Record<string, unknown>[];
  bankTransactions?: BankTxnRow[];
  bookLines?: BookLineRow[];
}) {
  const reconciliations = new Map<string, Record<string, unknown>>(
    (seed.reconciliations ?? []).map((r) => [r.id as string, r]),
  );
  const bankTransactions = new Map<string, BankTxnRow>(
    (seed.bankTransactions ?? []).map((t) => [t.id, { ...t }]),
  );
  const bookLines = new Map<string, BookLineRow>(
    (seed.bookLines ?? []).map((l) => [l.id, { ...l }]),
  );
  const matches = new Map<string, Record<string, unknown>>();
  let matchSequence = 0;
  let reconSequence = 0;

  const matchByBookLine = () => {
    const set = new Set<string>();
    for (const match of matches.values()) set.add(match.journalEntryLineId as string);
    return set;
  };

  const tx = {
    bankReconciliation: {
      findUnique: jest.fn(async () => null),
      findFirst: jest.fn(
        async ({
          where,
        }: {
          where: { id?: string; organisationId?: string; cashAccountId?: string; status?: string };
        }) => {
          for (const recon of reconciliations.values()) {
            if (where.id && recon.id !== where.id) continue;
            if (where.organisationId && recon.organisationId !== where.organisationId) continue;
            if (where.cashAccountId && recon.cashAccountId !== where.cashAccountId) continue;
            if (where.status && recon.status !== where.status) continue;
            return recon;
          }
          return null;
        },
      ),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        reconSequence += 1;
        const id = `recon-${reconSequence}`;
        const recon = { id, status: 'IN_PROGRESS', ...data };
        reconciliations.set(id, recon);
        return recon;
      }),
      update: jest.fn(
        async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const existing = reconciliations.get(where.id)!;
          const updated = { ...existing, ...data };
          reconciliations.set(where.id, updated);
          return updated;
        },
      ),
    },
    cashAccount: {
      findFirst: jest.fn(async () => CASH_ACCOUNT),
      findFirstOrThrow: jest.fn(async () => CASH_ACCOUNT),
    },
    bankStatementTransaction: {
      findFirst: jest.fn(
        async ({
          where,
        }: {
          where: { id: string; organisationId: string; cashAccountId: string };
        }) => {
          const t = bankTransactions.get(where.id);
          if (!t) return null;
          if (t.organisationId !== where.organisationId || t.cashAccountId !== where.cashAccountId)
            return null;
          return t;
        },
      ),
      findMany: jest.fn(
        async ({
          where,
        }: {
          where: {
            organisationId: string;
            cashAccountId: string;
            matchStatus: string;
            transactionDate: { gte: Date; lte: Date };
          };
        }) =>
          [...bankTransactions.values()].filter(
            (t) =>
              t.organisationId === where.organisationId &&
              t.cashAccountId === where.cashAccountId &&
              t.matchStatus === where.matchStatus &&
              t.transactionDate >= where.transactionDate.gte &&
              t.transactionDate <= where.transactionDate.lte,
          ),
      ),
      count: jest.fn(
        async ({
          where,
        }: {
          where: {
            organisationId: string;
            cashAccountId: string;
            matchStatus: string;
            transactionDate: { gte: Date; lte: Date };
          };
        }) =>
          [...bankTransactions.values()].filter(
            (t) =>
              t.organisationId === where.organisationId &&
              t.cashAccountId === where.cashAccountId &&
              t.matchStatus === where.matchStatus &&
              t.transactionDate >= where.transactionDate.gte &&
              t.transactionDate <= where.transactionDate.lte,
          ).length,
      ),
      update: jest.fn(
        async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const existing = bankTransactions.get(where.id)!;
          Object.assign(existing, data);
          return existing;
        },
      ),
      updateMany: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: { in: string[] } };
          data: Record<string, unknown>;
        }) => {
          for (const id of where.id.in) {
            const existing = bankTransactions.get(id);
            if (existing) Object.assign(existing, data);
          }
          return { count: where.id.in.length };
        },
      ),
    },
    journalEntryLine: {
      findFirst: jest.fn(
        async ({
          where,
        }: {
          where: {
            id: string;
            accountId: string;
            journalEntry: { organisationId: string; status: string };
          };
        }) => {
          const line = bookLines.get(where.id);
          if (!line) return null;
          if (line.accountId !== where.accountId) return null;
          if (line.journalEntry.organisationId !== where.journalEntry.organisationId) return null;
          if (line.journalEntry.status !== where.journalEntry.status) return null;
          const alreadyMatched = matchByBookLine().has(line.id);
          return { ...line, reconciliationMatch: alreadyMatched ? {} : null };
        },
      ),
      findMany: jest.fn(
        async ({
          where,
        }: {
          where: {
            accountId: string;
            reconciliationMatch: null;
            journalEntry: {
              organisationId: string;
              status: string;
              date: { gte: Date; lte: Date };
            };
          };
        }) => {
          const matched = matchByBookLine();
          return [...bookLines.values()].filter(
            (line) =>
              line.accountId === where.accountId &&
              !matched.has(line.id) &&
              line.journalEntry.organisationId === where.journalEntry.organisationId &&
              line.journalEntry.status === where.journalEntry.status &&
              line.journalEntry.date >= where.journalEntry.date.gte &&
              line.journalEntry.date <= where.journalEntry.date.lte,
          );
        },
      ),
      count: jest.fn(
        async ({
          where,
        }: {
          where: {
            accountId: string;
            reconciliationMatch: null;
            journalEntry: {
              organisationId: string;
              status: string;
              date: { gte: Date; lte: Date };
            };
          };
        }) => {
          const matched = matchByBookLine();
          return [...bookLines.values()].filter(
            (line) =>
              line.accountId === where.accountId &&
              !matched.has(line.id) &&
              line.journalEntry.organisationId === where.journalEntry.organisationId &&
              line.journalEntry.status === where.journalEntry.status &&
              line.journalEntry.date >= where.journalEntry.date.gte &&
              line.journalEntry.date <= where.journalEntry.date.lte,
          ).length;
        },
      ),
    },
    reconciliationMatch: {
      findFirst: jest.fn(
        async ({
          where,
        }: {
          where: {
            bankStatementTransactionId?: string;
            journalEntryLineId?: string;
            id?: string;
            bankReconciliationId?: string;
          };
        }) => {
          for (const match of matches.values()) {
            if (
              where.bankStatementTransactionId !== undefined &&
              match.bankStatementTransactionId !== where.bankStatementTransactionId
            )
              continue;
            if (
              where.journalEntryLineId !== undefined &&
              match.journalEntryLineId !== where.journalEntryLineId
            )
              continue;
            if (where.id !== undefined && match.id !== where.id) continue;
            if (
              where.bankReconciliationId !== undefined &&
              match.bankReconciliationId !== where.bankReconciliationId
            )
              continue;
            return match;
          }
          return null;
        },
      ),
      findMany: jest.fn(async ({ where }: { where: { bankReconciliationId: string } }) =>
        [...matches.values()].filter((m) => m.bankReconciliationId === where.bankReconciliationId),
      ),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        matchSequence += 1;
        const id = `match-${matchSequence}`;
        const match = { id, matchedAt: new Date(), ...data };
        matches.set(id, match);
        return match;
      }),
      delete: jest.fn(async ({ where }: { where: { id: string } }) => {
        const match = matches.get(where.id)!;
        matches.delete(where.id);
        return match;
      }),
    },
  };

  return { tx, reconciliations, bankTransactions, bookLines, matches };
}

function makeRepository(seed: Parameters<typeof makeFakeTx>[0]) {
  const fake = makeFakeTx(seed);
  const prisma = {
    $transaction: jest.fn(async (callback: (tx: unknown) => unknown) => callback(fake.tx)),
  } as unknown as PrismaService;
  return { repository: new BankReconciliationRepository(prisma), ...fake };
}

function bankTxn(overrides: Partial<BankTxnRow> = {}): BankTxnRow {
  return {
    id: 'bank-txn-1',
    organisationId: ORG,
    cashAccountId: CASH_ACCOUNT.id,
    transactionDate: new Date('2026-08-10'),
    amount: 850_000,
    matchStatus: 'UNMATCHED',
    ...overrides,
  };
}

function bookLine(overrides: Partial<BookLineRow> = {}): BookLineRow {
  return {
    id: 'book-line-1',
    accountId: CASH_ACCOUNT.linkedChartOfAccountId,
    debit: 850_000,
    credit: 0,
    journalEntry: {
      id: 'je-1',
      organisationId: ORG,
      status: 'POSTED',
      date: new Date('2026-08-10'),
      journalNumber: 'JE-000001',
    },
    ...overrides,
  };
}

describe('BankReconciliationRepository.create', () => {
  it('rejects a second session while one is already IN_PROGRESS for the same cash account', async () => {
    const { repository } = makeRepository({
      reconciliations: [
        {
          id: 'recon-1',
          organisationId: ORG,
          cashAccountId: CASH_ACCOUNT.id,
          status: 'IN_PROGRESS',
        },
      ],
    });
    await expect(
      repository.create({
        organisationId: ORG,
        cashAccountId: CASH_ACCOUNT.id,
        periodStart: new Date('2026-08-01'),
        periodEnd: new Date('2026-08-31'),
        openingBankBalance: 0,
        closingBankBalance: 0,
        createdById: 'user-1',
      }),
    ).rejects.toBeInstanceOf(ReconciliationAlreadyInProgressError);
  });
});

describe('BankReconciliationRepository.match', () => {
  it('matches a bank transaction to a book line and flips the bank transaction to MATCHED', async () => {
    const { repository, bankTransactions } = makeRepository({
      reconciliations: [
        {
          id: 'recon-1',
          organisationId: ORG,
          cashAccountId: CASH_ACCOUNT.id,
          status: 'IN_PROGRESS',
        },
      ],
      bankTransactions: [bankTxn()],
      bookLines: [bookLine()],
    });

    const result = await repository.match({
      organisationId: ORG,
      bankReconciliationId: 'recon-1',
      bankStatementTransactionId: 'bank-txn-1',
      journalEntryLineId: 'book-line-1',
      matchType: ReconciliationMatchType.MANUAL,
      matchedById: 'user-1',
    });

    expect(result.wasCreated).toBe(true);
    expect(bankTransactions.get('bank-txn-1')!.matchStatus).toBe('MATCHED');
  });

  it('is idempotent — matching the exact same pair again returns the existing match', async () => {
    const { repository } = makeRepository({
      reconciliations: [
        {
          id: 'recon-1',
          organisationId: ORG,
          cashAccountId: CASH_ACCOUNT.id,
          status: 'IN_PROGRESS',
        },
      ],
      bankTransactions: [bankTxn()],
      bookLines: [bookLine()],
    });
    const matchInput = {
      organisationId: ORG,
      bankReconciliationId: 'recon-1',
      bankStatementTransactionId: 'bank-txn-1',
      journalEntryLineId: 'book-line-1',
      matchType: ReconciliationMatchType.MANUAL,
      matchedById: 'user-1',
    };
    const first = await repository.match(matchInput);
    const second = await repository.match(matchInput);

    expect(first.wasCreated).toBe(true);
    expect(second.wasCreated).toBe(false);
    expect(second.match.id).toBe(first.match.id);
  });

  it('rejects matching a bank transaction that is already matched to a different book line', async () => {
    const { repository } = makeRepository({
      reconciliations: [
        {
          id: 'recon-1',
          organisationId: ORG,
          cashAccountId: CASH_ACCOUNT.id,
          status: 'IN_PROGRESS',
        },
      ],
      bankTransactions: [bankTxn({ matchStatus: 'MATCHED' })],
      bookLines: [bookLine(), bookLine({ id: 'book-line-2' })],
    });

    await expect(
      repository.match({
        organisationId: ORG,
        bankReconciliationId: 'recon-1',
        bankStatementTransactionId: 'bank-txn-1',
        journalEntryLineId: 'book-line-2',
        matchType: ReconciliationMatchType.MANUAL,
        matchedById: 'user-1',
      }),
    ).rejects.toBeInstanceOf(InvalidMatchTargetError);
  });

  it('rejects matching once the session is COMPLETED', async () => {
    const { repository } = makeRepository({
      reconciliations: [
        { id: 'recon-1', organisationId: ORG, cashAccountId: CASH_ACCOUNT.id, status: 'COMPLETED' },
      ],
      bankTransactions: [bankTxn()],
      bookLines: [bookLine()],
    });

    await expect(
      repository.match({
        organisationId: ORG,
        bankReconciliationId: 'recon-1',
        bankStatementTransactionId: 'bank-txn-1',
        journalEntryLineId: 'book-line-1',
        matchType: ReconciliationMatchType.MANUAL,
        matchedById: 'user-1',
      }),
    ).rejects.toBeInstanceOf(ReconciliationNotInProgressError);
  });
});

describe('BankReconciliationRepository.unmatch', () => {
  it('removes the match and resets the bank transaction back to UNMATCHED', async () => {
    const { repository, bankTransactions } = makeRepository({
      reconciliations: [
        {
          id: 'recon-1',
          organisationId: ORG,
          cashAccountId: CASH_ACCOUNT.id,
          status: 'IN_PROGRESS',
        },
      ],
      bankTransactions: [bankTxn()],
      bookLines: [bookLine()],
    });
    const { match } = await repository.match({
      organisationId: ORG,
      bankReconciliationId: 'recon-1',
      bankStatementTransactionId: 'bank-txn-1',
      journalEntryLineId: 'book-line-1',
      matchType: ReconciliationMatchType.MANUAL,
      matchedById: 'user-1',
    });

    await repository.unmatch(ORG, 'recon-1', match.id);
    expect(bankTransactions.get('bank-txn-1')!.matchStatus).toBe('UNMATCHED');
  });

  it('rejects unmatching once the session is COMPLETED', async () => {
    const { repository } = makeRepository({
      reconciliations: [
        { id: 'recon-1', organisationId: ORG, cashAccountId: CASH_ACCOUNT.id, status: 'COMPLETED' },
      ],
    });
    await expect(repository.unmatch(ORG, 'recon-1', 'match-1')).rejects.toBeInstanceOf(
      ReconciliationNotInProgressError,
    );
  });
});

describe('BankReconciliationRepository.autoMatch', () => {
  it('matches unambiguous same-date same-amount pairs only', async () => {
    const { repository, bankTransactions } = makeRepository({
      reconciliations: [
        {
          id: 'recon-1',
          organisationId: ORG,
          cashAccountId: CASH_ACCOUNT.id,
          status: 'IN_PROGRESS',
          periodStart: new Date('2026-08-01'),
          periodEnd: new Date('2026-08-31'),
        },
      ],
      bankTransactions: [
        bankTxn({ id: 'unambiguous', amount: 850_000 }),
        bankTxn({ id: 'ambiguous-1', amount: 5000, transactionDate: new Date('2026-08-12') }),
        bankTxn({ id: 'ambiguous-2', amount: 5000, transactionDate: new Date('2026-08-12') }),
      ],
      bookLines: [
        bookLine({ id: 'unambiguous-book', debit: 850_000, credit: 0 }),
        bookLine({
          id: 'ambiguous-book',
          debit: 5000,
          credit: 0,
          journalEntry: {
            id: 'je-2',
            organisationId: ORG,
            status: 'POSTED',
            date: new Date('2026-08-12'),
            journalNumber: 'JE-000002',
          },
        }),
      ],
    });

    const result = await repository.autoMatch(ORG, 'recon-1', 'user-1');

    expect(result.matchedCount).toBe(1);
    expect(bankTransactions.get('unambiguous')!.matchStatus).toBe('MATCHED');
    expect(bankTransactions.get('ambiguous-1')!.matchStatus).toBe('UNMATCHED');
    expect(bankTransactions.get('ambiguous-2')!.matchStatus).toBe('UNMATCHED');
  });
});

describe('BankReconciliationRepository.complete', () => {
  it('rejects completion while unmatched bank/book items remain', async () => {
    const { repository } = makeRepository({
      reconciliations: [
        {
          id: 'recon-1',
          organisationId: ORG,
          cashAccountId: CASH_ACCOUNT.id,
          status: 'IN_PROGRESS',
          periodStart: new Date('2026-08-01'),
          periodEnd: new Date('2026-08-31'),
        },
      ],
      bankTransactions: [bankTxn()],
      bookLines: [bookLine()],
    });

    await expect(repository.complete(ORG, 'recon-1', 'user-1')).rejects.toBeInstanceOf(
      ReconciliationIncompleteError,
    );
  });

  it('completes once everything is matched, flipping matched bank transactions to RECONCILED', async () => {
    const { repository, bankTransactions, reconciliations } = makeRepository({
      reconciliations: [
        {
          id: 'recon-1',
          organisationId: ORG,
          cashAccountId: CASH_ACCOUNT.id,
          status: 'IN_PROGRESS',
          periodStart: new Date('2026-08-01'),
          periodEnd: new Date('2026-08-31'),
          closingBankBalance: 850_000,
        },
      ],
      bankTransactions: [bankTxn()],
      bookLines: [bookLine()],
    });
    await repository.match({
      organisationId: ORG,
      bankReconciliationId: 'recon-1',
      bankStatementTransactionId: 'bank-txn-1',
      journalEntryLineId: 'book-line-1',
      matchType: ReconciliationMatchType.MANUAL,
      matchedById: 'user-1',
    });

    const completed = await repository.complete(ORG, 'recon-1', 'user-1');

    expect(completed.status).toBe('COMPLETED');
    expect(completed.reconciledById).toBe('user-1');
    expect(bankTransactions.get('bank-txn-1')!.matchStatus).toBe('RECONCILED');
    expect(reconciliations.get('recon-1')!.status).toBe('COMPLETED');
  });

  it('is idempotent — completing an already-COMPLETED session returns it unchanged', async () => {
    const { repository } = makeRepository({
      reconciliations: [
        {
          id: 'recon-1',
          organisationId: ORG,
          cashAccountId: CASH_ACCOUNT.id,
          status: 'COMPLETED',
          reconciledById: 'user-1',
        },
      ],
    });
    const result = await repository.complete(ORG, 'recon-1', 'someone-else');
    expect(result.reconciledById).toBe('user-1');
  });
});
