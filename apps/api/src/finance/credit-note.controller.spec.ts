import { CreditNoteStatus } from '@prisma/client';
import { Request } from 'express';

import { AuditService } from '../identity/audit/audit.service';
import { TokenPayload } from '../identity/auth/ports/token.port';
import { CreditNoteController } from './credit-note.controller';
import { CreditNoteWithRelations } from './credit-note.repository';
import { CreditNoteService } from './credit-note.service';
import { FINANCE_AUDIT_ACTIONS } from './finance-audit-actions';

describe('CreditNoteController', () => {
  const tokenUser: TokenPayload = {
    sub: 'user-1',
    organisationId: 'org-1',
    sessionId: 'session-1',
  };
  const req = { ip: '127.0.0.1', headers: { 'user-agent': 'jest' } } as unknown as Request;

  const creditNote = {
    id: 'credit-note-1',
    creditNoteCode: 'CN-000001',
    customer: { id: 'customer-1', customerCode: 'CUS-000013', customerName: 'ABC Supermarket' },
    invoice: { id: 'invoice-2', invoiceCode: 'INV-000002' },
    invoiceId: 'invoice-2',
    reason: 'Returned goods',
    amount: 250_000,
    currency: 'NGN',
    status: CreditNoteStatus.DRAFT,
    creditNoteDate: new Date('2026-08-23'),
    notes: null,
    createdAt: new Date('2026-08-23'),
    updatedAt: new Date('2026-08-23'),
  } as unknown as CreditNoteWithRelations;

  function makeController() {
    const creditNoteService = {
      list: jest.fn(),
      getById: jest.fn(),
      create: jest.fn(),
      issue: jest.fn(),
      void: jest.fn(),
    } as unknown as jest.Mocked<CreditNoteService>;
    const auditService = { record: jest.fn() } as unknown as jest.Mocked<AuditService>;

    const controller = new CreditNoteController(creditNoteService, auditService);
    return { controller, creditNoteService, auditService };
  }

  describe('create', () => {
    it('creates the credit note and records an audit entry', async () => {
      const { controller, creditNoteService, auditService } = makeController();
      creditNoteService.create.mockResolvedValue(creditNote);

      await controller.create(
        {
          invoiceId: 'invoice-2',
          amount: 250_000,
          reason: 'Returned goods',
          creditNoteDate: new Date(),
        },
        tokenUser,
        req,
      );

      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: FINANCE_AUDIT_ACTIONS.CREDIT_NOTE_CREATED,
          entityId: 'credit-note-1',
        }),
      );
    });
  });

  describe('issue / void', () => {
    it('issues and records an audit entry', async () => {
      const { controller, creditNoteService, auditService } = makeController();
      creditNoteService.issue.mockResolvedValue({
        creditNote: { ...creditNote, status: CreditNoteStatus.ISSUED },
        invoiceId: 'invoice-2',
      });

      await controller.issue('credit-note-1', tokenUser, req);

      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: FINANCE_AUDIT_ACTIONS.CREDIT_NOTE_ISSUED }),
      );
    });

    it('voids and records an audit entry', async () => {
      const { controller, creditNoteService, auditService } = makeController();
      creditNoteService.void.mockResolvedValue({
        creditNote: { ...creditNote, status: CreditNoteStatus.VOID },
        invoiceId: 'invoice-2',
      });

      await controller.void('credit-note-1', tokenUser, req);

      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: FINANCE_AUDIT_ACTIONS.CREDIT_NOTE_VOIDED }),
      );
    });
  });
});
