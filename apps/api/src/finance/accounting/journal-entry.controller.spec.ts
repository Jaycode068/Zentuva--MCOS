import { JournalEntryStatus } from '@prisma/client';
import { Request } from 'express';

import { AuditService } from '../../identity/audit/audit.service';
import { TokenPayload } from '../../identity/auth/ports/token.port';
import { ACCOUNTING_AUDIT_ACTIONS } from './accounting-audit-actions';
import { JournalEntryController } from './journal-entry.controller';
import { JournalEntryWithRelations } from './journal-entry.repository';
import { JournalEntryService } from './journal-entry.service';

describe('JournalEntryController', () => {
  const tokenUser: TokenPayload = {
    sub: 'user-1',
    organisationId: 'org-1',
    sessionId: 'session-1',
  };
  const req = { ip: '127.0.0.1', headers: { 'user-agent': 'jest' } } as unknown as Request;

  const entry = {
    id: 'entry-1',
    journalNumber: 'JE-000001',
    date: new Date('2026-08-24'),
    accountingPeriod: { id: 'period-1', name: 'August 2026', status: 'OPEN' },
    description: 'Manual entry',
    reference: null,
    sourceType: 'MANUAL',
    sourceId: null,
    status: JournalEntryStatus.DRAFT,
    postedAt: null,
    lines: [],
    createdAt: new Date('2026-08-24'),
  } as unknown as JournalEntryWithRelations;

  function makeController() {
    const journalEntryService = {
      list: jest.fn(),
      getById: jest.fn(),
      create: jest.fn(),
      post: jest.fn(),
      void: jest.fn(),
    } as unknown as jest.Mocked<JournalEntryService>;
    const auditService = { record: jest.fn() } as unknown as jest.Mocked<AuditService>;

    const controller = new JournalEntryController(journalEntryService, auditService);
    return { controller, journalEntryService, auditService };
  }

  it('creates an entry and records an audit entry', async () => {
    const { controller, journalEntryService, auditService } = makeController();
    journalEntryService.create.mockResolvedValue(entry);

    const result = await controller.create(
      {
        date: new Date('2026-08-24'),
        description: 'Manual entry',
        lines: [
          { accountId: 'account-1', debit: 100_000 },
          { accountId: 'account-2', credit: 100_000 },
        ],
      },
      tokenUser,
      req,
    );

    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: ACCOUNTING_AUDIT_ACTIONS.JOURNAL_ENTRY_CREATED }),
    );
    expect(result.journalNumber).toBe('JE-000001');
  });

  it('posts an entry and records an audit entry', async () => {
    const { controller, journalEntryService, auditService } = makeController();
    journalEntryService.post.mockResolvedValue({ ...entry, status: JournalEntryStatus.POSTED });

    await controller.post('entry-1', tokenUser, req);

    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: ACCOUNTING_AUDIT_ACTIONS.JOURNAL_ENTRY_POSTED }),
    );
  });

  it('voids an entry and records an audit entry', async () => {
    const { controller, journalEntryService, auditService } = makeController();
    journalEntryService.void.mockResolvedValue({ ...entry, status: JournalEntryStatus.VOID });

    await controller.void('entry-1', tokenUser, req);

    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: ACCOUNTING_AUDIT_ACTIONS.JOURNAL_ENTRY_VOIDED }),
    );
  });

  it('lists entries scoped to the caller organisation', async () => {
    const { controller, journalEntryService } = makeController();
    journalEntryService.list.mockResolvedValue([entry]);

    const result = await controller.list(tokenUser);
    expect(journalEntryService.list).toHaveBeenCalledWith('org-1', expect.any(Object));
    expect(result.items).toHaveLength(1);
  });
});
