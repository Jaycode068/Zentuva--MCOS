import { AccountType, ChartOfAccount } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { ChartOfAccountRepository } from './chart-of-account.repository';
import { LedgerService } from './ledger.service';

describe('LedgerService', () => {
  const bankAccount: ChartOfAccount = {
    id: 'account-bank',
    organisationId: 'org-1',
    code: '1110',
    name: 'Bank',
    type: AccountType.ASSET,
    parentId: null,
    description: null,
    isActive: true,
    isSystemAccount: true,
    systemKey: 'BANK',
    createdById: 'user-1',
    updatedById: 'user-1',
    createdAt: new Date('2026-08-01'),
    updatedAt: new Date('2026-08-01'),
  };
  const revenueAccount: ChartOfAccount = {
    ...bankAccount,
    id: 'account-revenue',
    code: '4100',
    name: 'Product Sales',
    type: AccountType.REVENUE,
    systemKey: 'SALES_REVENUE',
  };

  function makeService(
    overrides: {
      findMany?: jest.Mock;
      groupBy?: jest.Mock;
      aggregate?: jest.Mock;
    } = {},
  ) {
    const prisma = {
      journalEntryLine: {
        findMany: overrides.findMany ?? jest.fn().mockResolvedValue([]),
        groupBy: overrides.groupBy ?? jest.fn().mockResolvedValue([]),
        aggregate:
          overrides.aggregate ?? jest.fn().mockResolvedValue({ _sum: { debit: 0, credit: 0 } }),
      },
    } as unknown as PrismaService;

    const chartOfAccountRepository = {
      findById: jest.fn(async (_org: string, id: string) =>
        id === bankAccount.id ? bankAccount : id === revenueAccount.id ? revenueAccount : null,
      ),
    } as unknown as jest.Mocked<ChartOfAccountRepository>;

    return {
      service: new LedgerService(prisma, chartOfAccountRepository),
      prisma,
      chartOfAccountRepository,
    };
  }

  describe('getLedger', () => {
    it('computes a correct running balance across an ordered sequence', async () => {
      const findMany = jest.fn().mockResolvedValue([
        {
          id: 'line-1',
          debit: 100_000,
          credit: 0,
          description: null,
          account: { id: 'account-bank', code: '1110', name: 'Bank' },
          journalEntry: {
            id: 'je-1',
            journalNumber: 'JE-000001',
            date: new Date('2026-08-01'),
            description: 'A',
            reference: null,
            sourceType: 'MANUAL',
            sourceId: null,
            status: 'POSTED',
          },
        },
        {
          id: 'line-2',
          debit: 0,
          credit: 30_000,
          description: null,
          account: { id: 'account-bank', code: '1110', name: 'Bank' },
          journalEntry: {
            id: 'je-2',
            journalNumber: 'JE-000002',
            date: new Date('2026-08-02'),
            description: 'B',
            reference: null,
            sourceType: 'MANUAL',
            sourceId: null,
            status: 'POSTED',
          },
        },
      ]);
      const { service } = makeService({ findMany });

      const lines = await service.getLedger('org-1', { accountId: 'account-bank' });

      expect(lines[0]!.runningBalance).toBe(100_000);
      expect(lines[1]!.runningBalance).toBe(70_000);
    });

    it('only ever queries POSTED entries by default', async () => {
      const findMany = jest.fn().mockResolvedValue([]);
      const { service } = makeService({ findMany });

      await service.getLedger('org-1', {});

      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            journalEntry: expect.objectContaining({ status: 'POSTED' }),
          }),
        }),
      );
    });

    it('scopes every query to the organisation', async () => {
      const findMany = jest.fn().mockResolvedValue([]);
      const { service } = makeService({ findMany });

      await service.getLedger('org-1', { accountId: 'account-bank' });

      const callArgs = findMany.mock.calls[0]![0];
      expect(callArgs.where.account.organisationId).toBe('org-1');
      expect(callArgs.where.journalEntry.organisationId).toBe('org-1');
    });
  });

  describe('getTrialBalance', () => {
    it('always balances — Σdebit column === Σcredit column', async () => {
      // Bank: net +70,000 (debit-normal balance) — Revenue: net -70,000 (credit-normal
      // balance). Whole ledger sums to zero by double-entry construction.
      const groupBy = jest.fn().mockResolvedValue([
        { accountId: 'account-bank', _sum: { debit: 100_000, credit: 30_000 } },
        { accountId: 'account-revenue', _sum: { debit: 0, credit: 70_000 } },
      ]);
      const { service } = makeService({ groupBy });

      const { rows, totalDebit, totalCredit } = await service.getTrialBalance('org-1');

      expect(totalDebit).toBe(totalCredit);
      expect(totalDebit).toBe(70_000);
      expect(rows.find((r) => r.accountId === 'account-bank')).toMatchObject({
        debit: 70_000,
        credit: 0,
      });
      expect(rows.find((r) => r.accountId === 'account-revenue')).toMatchObject({
        debit: 0,
        credit: 70_000,
      });
    });

    it('returns zero totals when there are no posted journal entries', async () => {
      const { service } = makeService();
      const { rows, totalDebit, totalCredit } = await service.getTrialBalance('org-1');

      expect(rows).toHaveLength(0);
      expect(totalDebit).toBe(0);
      expect(totalCredit).toBe(0);
    });
  });

  describe('tenant isolation', () => {
    it('getAccountActivity 404s when the account does not belong to this organisation', async () => {
      const { service, chartOfAccountRepository } = makeService();
      chartOfAccountRepository.findById.mockResolvedValue(null);

      await expect(service.getAccountActivity('org-1', 'account-bank', {})).rejects.toThrow(
        'Account not found',
      );
    });
  });
});
