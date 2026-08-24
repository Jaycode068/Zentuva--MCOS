import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AccountType, ChartOfAccount, JournalEntryStatus } from '@prisma/client';

import { ChartOfAccountRepository } from './chart-of-account.repository';
import {
  ClosedPeriodError,
  JournalEntryRepository,
  JournalEntryStateError,
  JournalEntryWithRelations,
} from './journal-entry.repository';
import { JournalEntryService } from './journal-entry.service';

describe('JournalEntryService', () => {
  const account: ChartOfAccount = {
    id: 'account-1',
    organisationId: 'org-1',
    code: '1110',
    name: 'Bank',
    type: AccountType.ASSET,
    parentId: null,
    description: null,
    isActive: true,
    isSystemAccount: false,
    systemKey: null,
    createdById: 'user-1',
    updatedById: 'user-1',
    createdAt: new Date('2026-08-24'),
    updatedAt: new Date('2026-08-24'),
  };

  const entry = {
    id: 'entry-1',
    organisationId: 'org-1',
    journalNumber: 'JE-000001',
    date: new Date('2026-08-24'),
    accountingPeriodId: 'period-1',
    description: 'Manual entry',
    reference: null,
    sourceType: 'MANUAL',
    sourceId: null,
    status: JournalEntryStatus.DRAFT,
    postedAt: null,
    createdById: 'user-1',
    createdAt: new Date('2026-08-24'),
    updatedAt: new Date('2026-08-24'),
    accountingPeriod: { id: 'period-1', name: 'August 2026', status: 'OPEN' },
    lines: [],
  } as unknown as JournalEntryWithRelations;

  function makeService() {
    const journalEntryRepository = {
      create: jest.fn(),
      findById: jest.fn(),
      findManyByOrganisation: jest.fn(),
      post: jest.fn(),
      void: jest.fn(),
    } as unknown as jest.Mocked<JournalEntryRepository>;
    const chartOfAccountRepository = {
      findById: jest.fn().mockResolvedValue(account),
    } as unknown as jest.Mocked<ChartOfAccountRepository>;

    const service = new JournalEntryService(journalEntryRepository, chartOfAccountRepository);
    return { service, journalEntryRepository, chartOfAccountRepository };
  }

  const baseInput = {
    date: new Date('2026-08-24'),
    description: 'Manual entry',
    lines: [
      { accountId: 'account-1', debit: 100_000 },
      { accountId: 'account-2', credit: 100_000 },
    ],
  };

  describe('create', () => {
    it('creates a balanced entry', async () => {
      const { service, journalEntryRepository } = makeService();
      journalEntryRepository.create.mockResolvedValue(entry);

      await service.create('org-1', baseInput, 'user-1');

      expect(journalEntryRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          organisationId: 'org-1',
          lines: [
            { accountId: 'account-1', description: undefined, debit: 100_000, credit: 0 },
            { accountId: 'account-2', description: undefined, debit: 0, credit: 100_000 },
          ],
        }),
      );
    });

    it('rejects an unbalanced entry', async () => {
      const { service } = makeService();

      await expect(
        service.create(
          'org-1',
          {
            ...baseInput,
            lines: [
              { accountId: 'account-1', debit: 100_000 },
              { accountId: 'account-2', credit: 90_000 },
            ],
          },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a line whose account does not belong to this organisation', async () => {
      const { service, chartOfAccountRepository } = makeService();
      chartOfAccountRepository.findById.mockResolvedValue(null);

      await expect(service.create('org-1', baseInput, 'user-1')).rejects.toThrow(
        'One or more accounts do not belong to this organisation',
      );
    });

    it('rejects a line against an inactive account', async () => {
      const { service, chartOfAccountRepository } = makeService();
      chartOfAccountRepository.findById.mockResolvedValue({ ...account, isActive: false });

      await expect(service.create('org-1', baseInput, 'user-1')).rejects.toThrow(
        'Account "Bank" is inactive',
      );
    });

    it('translates a repository JournalEntryStateError (no period covers this date) to BadRequestException', async () => {
      const { service, journalEntryRepository } = makeService();
      journalEntryRepository.create.mockRejectedValue(
        new JournalEntryStateError('No accounting period covers this date'),
      );

      await expect(service.create('org-1', baseInput, 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('post', () => {
    it('posts a draft entry', async () => {
      const { service, journalEntryRepository } = makeService();
      journalEntryRepository.post.mockResolvedValue({
        ...entry,
        status: JournalEntryStatus.POSTED,
      });

      const posted = await service.post('org-1', 'entry-1', 'user-1');
      expect(posted.status).toBe(JournalEntryStatus.POSTED);
    });

    it('translates ClosedPeriodError to BadRequestException', async () => {
      const { service, journalEntryRepository } = makeService();
      journalEntryRepository.post.mockRejectedValue(
        new ClosedPeriodError('The accounting period "August 2026" is closed'),
      );

      await expect(service.post('org-1', 'entry-1', 'user-1')).rejects.toThrow(BadRequestException);
    });

    it('translates a not-found JournalEntryStateError to NotFoundException', async () => {
      const { service, journalEntryRepository } = makeService();
      journalEntryRepository.post.mockRejectedValue(
        new JournalEntryStateError('Journal entry not found'),
      );

      await expect(service.post('org-1', 'entry-1', 'user-1')).rejects.toThrow(NotFoundException);
    });

    it('translates a wrong-status JournalEntryStateError to BadRequestException', async () => {
      const { service, journalEntryRepository } = makeService();
      journalEntryRepository.post.mockRejectedValue(
        new JournalEntryStateError('Only a draft journal entry can be posted'),
      );

      await expect(service.post('org-1', 'entry-1', 'user-1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('void', () => {
    it('voids a draft or posted entry as a bare status flip', async () => {
      const { service, journalEntryRepository } = makeService();
      journalEntryRepository.void.mockResolvedValue({ ...entry, status: JournalEntryStatus.VOID });

      const voided = await service.void('org-1', 'entry-1', 'user-1');
      expect(voided.status).toBe(JournalEntryStatus.VOID);
    });

    it('throws NotFoundException for an unknown/cross-tenant entry', async () => {
      const { service, journalEntryRepository } = makeService();
      journalEntryRepository.void.mockResolvedValue(null);

      await expect(service.void('org-1', 'missing', 'user-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('tenant isolation', () => {
    it('getById 404s when the repository finds nothing for this organisation', async () => {
      const { service, journalEntryRepository } = makeService();
      journalEntryRepository.findById.mockResolvedValue(null);

      await expect(service.getById('org-1', 'entry-1')).rejects.toThrow(NotFoundException);
    });
  });
});
