import { Prisma } from '@prisma/client';

import {
  MissingSystemAccountError,
  NoOpenPeriodError,
  UnbalancedPostingError,
  postSystemJournalEntry,
  resolveOpenPeriodId,
  resolveSystemAccountId,
} from './journal-posting';

/**
 * A deliberate exception to this codebase's "no repository-level unit tests for atomic
 * transactions" convention (see `payment.repository.spec.ts`'s own doc comment for the
 * full rationale) — `journal-posting.ts` is the plain-function equivalent of a
 * repository's atomic `create()`, so it gets the same in-memory fake `tx` treatment.
 */
function makeFakeTx(
  options: {
    accounts?: Record<string, string>; // systemKey -> accountId
    openPeriod?: { id: string; startDate: Date; endDate: Date } | null;
    journalEntries?: Map<string, Record<string, unknown>>;
  } = {},
) {
  const accounts = options.accounts ?? {
    AR: 'account-ar',
    SALES_REVENUE: 'account-revenue',
    SALES_RETURNS: 'account-returns',
    CASH: 'account-cash',
    BANK: 'account-bank',
  };
  // `??` would treat an explicit `openPeriod: null` (meaning "no open period exists")
  // the same as "not provided" — use an `in` check so callers can genuinely opt out
  // of the default open period.
  const openPeriod =
    'openPeriod' in options
      ? options.openPeriod
      : { id: 'period-1', startDate: new Date('2026-08-01'), endDate: new Date('2026-08-31') };
  const journalEntries = options.journalEntries ?? new Map<string, Record<string, unknown>>();
  let sequence = journalEntries.size;

  const tx = {
    chartOfAccount: {
      findFirst: jest.fn(async ({ where }: { where: { systemKey: string } }) => {
        const id = accounts[where.systemKey];
        return id ? { id, systemKey: where.systemKey } : null;
      }),
    },
    accountingPeriod: {
      findFirst: jest.fn(
        async ({ where }: { where: { startDate: { lte: Date }; endDate: { gte: Date } } }) => {
          if (!openPeriod) return null;
          if (where.startDate.lte < openPeriod.startDate) return null;
          if (where.endDate.gte > openPeriod.endDate) return null;
          return openPeriod;
        },
      ),
    },
    journalEntry: {
      findUnique: jest.fn(
        async ({
          where,
        }: {
          where: {
            organisationId_sourceType_sourceId?: {
              organisationId: string;
              sourceType: string;
              sourceId: string;
            };
            organisationId_journalNumber?: { organisationId: string; journalNumber: string };
          };
        }) => {
          if (where.organisationId_sourceType_sourceId) {
            const key = where.organisationId_sourceType_sourceId;
            for (const entry of journalEntries.values()) {
              if (
                entry.organisationId === key.organisationId &&
                entry.sourceType === key.sourceType &&
                entry.sourceId === key.sourceId
              ) {
                return entry;
              }
            }
            return null;
          }
          if (where.organisationId_journalNumber) {
            const key = where.organisationId_journalNumber;
            for (const entry of journalEntries.values()) {
              if (
                entry.organisationId === key.organisationId &&
                entry.journalNumber === key.journalNumber
              ) {
                return entry;
              }
            }
          }
          return null;
        },
      ),
      count: jest.fn(async () => journalEntries.size),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        sequence += 1;
        const entry = { id: `journal-${sequence}`, ...data };
        journalEntries.set(entry.id, entry);
        return entry;
      }),
    },
  };

  return { tx: tx as unknown as Prisma.TransactionClient, journalEntries };
}

describe('journal-posting', () => {
  describe('resolveSystemAccountId', () => {
    it('resolves a configured system account', async () => {
      const { tx } = makeFakeTx();
      const id = await resolveSystemAccountId(tx, 'org-1', 'AR');
      expect(id).toBe('account-ar');
    });

    it('throws MissingSystemAccountError when unconfigured', async () => {
      const { tx } = makeFakeTx({ accounts: {} });
      await expect(resolveSystemAccountId(tx, 'org-1', 'AR')).rejects.toThrow(
        MissingSystemAccountError,
      );
    });
  });

  describe('resolveOpenPeriodId', () => {
    it('resolves the open period covering a date', async () => {
      const { tx } = makeFakeTx();
      const id = await resolveOpenPeriodId(tx, 'org-1', new Date('2026-08-15'));
      expect(id).toBe('period-1');
    });

    it('throws NoOpenPeriodError when no period covers the date', async () => {
      const { tx } = makeFakeTx();
      await expect(resolveOpenPeriodId(tx, 'org-1', new Date('2026-07-15'))).rejects.toThrow(
        NoOpenPeriodError,
      );
    });

    it('throws NoOpenPeriodError when the covering period exists but is not open', async () => {
      const { tx } = makeFakeTx({ openPeriod: null });
      await expect(resolveOpenPeriodId(tx, 'org-1', new Date('2026-08-15'))).rejects.toThrow(
        NoOpenPeriodError,
      );
    });
  });

  describe('postSystemJournalEntry', () => {
    const baseInput = {
      organisationId: 'org-1',
      date: new Date('2026-08-20'),
      description: 'Invoice INV-000001 issued',
      sourceType: 'INVOICE',
      sourceId: 'invoice-1',
      lines: [
        { systemKey: 'AR', debit: 500_000 },
        { systemKey: 'SALES_REVENUE', credit: 500_000 },
      ],
    };

    it('posts a balanced entry directly as POSTED', async () => {
      const { tx } = makeFakeTx();
      const result = await postSystemJournalEntry(tx, baseInput);

      expect(result.wasCreated).toBe(true);
      expect(result.journalEntry.status).toBe('POSTED');
      expect(result.journalEntry.postedAt).toBeInstanceOf(Date);
    });

    it('is idempotent on (organisationId, sourceType, sourceId) — a duplicate call never creates a second journal', async () => {
      const { tx, journalEntries } = makeFakeTx();

      const first = await postSystemJournalEntry(tx, baseInput);
      const second = await postSystemJournalEntry(tx, baseInput);

      expect(first.wasCreated).toBe(true);
      expect(second.wasCreated).toBe(false);
      expect(second.journalEntry.id).toBe(first.journalEntry.id);
      expect(journalEntries.size).toBe(1);
    });

    it('a different sourceId for the same sourceType posts a genuinely new entry', async () => {
      const { tx, journalEntries } = makeFakeTx();

      await postSystemJournalEntry(tx, baseInput);
      await postSystemJournalEntry(tx, { ...baseInput, sourceId: 'invoice-2' });

      expect(journalEntries.size).toBe(2);
    });

    it('throws MissingSystemAccountError when a line references an unconfigured system account', async () => {
      const { tx } = makeFakeTx({ accounts: { AR: 'account-ar' } }); // SALES_REVENUE missing
      await expect(postSystemJournalEntry(tx, baseInput)).rejects.toThrow(
        MissingSystemAccountError,
      );
    });

    it('throws NoOpenPeriodError when the date falls outside every open period', async () => {
      const { tx } = makeFakeTx();
      await expect(
        postSystemJournalEntry(tx, { ...baseInput, date: new Date('2026-09-01') }),
      ).rejects.toThrow(NoOpenPeriodError);
    });

    it('throws UnbalancedPostingError when the lines do not balance', async () => {
      const { tx } = makeFakeTx();
      await expect(
        postSystemJournalEntry(tx, {
          ...baseInput,
          lines: [
            { systemKey: 'AR', debit: 500_000 },
            { systemKey: 'SALES_REVENUE', credit: 400_000 },
          ],
        }),
      ).rejects.toThrow(UnbalancedPostingError);
    });
  });
});
