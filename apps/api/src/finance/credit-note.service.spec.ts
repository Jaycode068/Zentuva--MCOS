import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CreditNoteStatus, InvoiceStatus } from '@prisma/client';

import {
  CreditNoteInvoiceConflictError,
  CreditNoteNotFoundError,
  CreditNoteRepository,
  CreditNoteStateError,
  CreditNoteWithRelations,
  OverCreditError,
} from './credit-note.repository';
import { CreditNoteService } from './credit-note.service';
import { InvoiceRepository, InvoiceWithRelations } from './invoice.repository';

describe('CreditNoteService', () => {
  const partiallyPaidInvoice: InvoiceWithRelations = {
    id: 'invoice-2',
    organisationId: 'org-1',
    invoiceCode: 'INV-000002',
    customerId: 'customer-1',
    status: InvoiceStatus.PARTIALLY_PAID,
    currency: 'NGN',
    total: 2_500_000,
    amountPaid: 1_000_000,
    amountCredited: 0,
  } as unknown as InvoiceWithRelations;

  const creditNote: CreditNoteWithRelations = {
    id: 'credit-note-1',
    organisationId: 'org-1',
    creditNoteCode: 'CN-000001',
    customerId: 'customer-1',
    invoiceId: 'invoice-2',
    reason: 'Returned goods — damaged in transit, 25 packs',
    amount: 250_000,
    currency: 'NGN',
    status: CreditNoteStatus.DRAFT,
    creditNoteDate: new Date('2026-08-23'),
    notes: null,
    idempotencyKey: null,
    createdById: 'user-1',
    updatedById: 'user-1',
    createdAt: new Date('2026-08-23'),
    updatedAt: new Date('2026-08-23'),
    customer: { id: 'customer-1', customerCode: 'CUS-000013', customerName: 'ABC Supermarket' },
    invoice: { id: 'invoice-2', invoiceCode: 'INV-000002' },
  } as unknown as CreditNoteWithRelations;

  function makeService() {
    const creditNoteRepository = {
      create: jest.fn(),
      issue: jest.fn(),
      void: jest.fn(),
      findById: jest.fn(),
      findManyByOrganisation: jest.fn(),
      existsByCode: jest.fn().mockResolvedValue(false),
    } as unknown as jest.Mocked<CreditNoteRepository>;
    const invoiceRepository = {
      findById: jest.fn(),
    } as unknown as jest.Mocked<InvoiceRepository>;

    const service = new CreditNoteService(creditNoteRepository, invoiceRepository);
    return { service, creditNoteRepository, invoiceRepository };
  }

  describe('create', () => {
    it('creates a DRAFT credit note within the outstanding balance', async () => {
      const { service, invoiceRepository, creditNoteRepository } = makeService();
      invoiceRepository.findById.mockResolvedValue(partiallyPaidInvoice);
      creditNoteRepository.create.mockResolvedValue(creditNote);

      const result = await service.create(
        'org-1',
        {
          invoiceId: 'invoice-2',
          amount: 250_000,
          reason: 'Returned goods — damaged in transit, 25 packs',
          creditNoteDate: new Date('2026-08-23'),
        },
        'user-1',
      );

      expect(creditNoteRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ creditNoteCode: 'CN-000001', amount: 250_000, currency: 'NGN' }),
      );
      expect(result.status).toBe(CreditNoteStatus.DRAFT);
    });

    it('rejects a credit exceeding the outstanding balance', async () => {
      const { service, invoiceRepository } = makeService();
      invoiceRepository.findById.mockResolvedValue(partiallyPaidInvoice);

      await expect(
        service.create(
          'org-1',
          {
            invoiceId: 'invoice-2',
            amount: 2_000_000,
            reason: 'too much',
            creditNoteDate: new Date(),
          },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it.each([['DRAFT'], ['PAID'], ['VOID']] as const)(
      'rejects a credit note against a %s invoice',
      async (status) => {
        const { service, invoiceRepository } = makeService();
        invoiceRepository.findById.mockResolvedValue({ ...partiallyPaidInvoice, status });

        await expect(
          service.create(
            'org-1',
            { invoiceId: 'invoice-2', amount: 100, reason: 'reason', creditNoteDate: new Date() },
            'user-1',
          ),
        ).rejects.toThrow('This invoice is not eligible to receive a credit note');
      },
    );

    it('throws NotFoundException for an unknown/cross-tenant invoice', async () => {
      const { service, invoiceRepository } = makeService();
      invoiceRepository.findById.mockResolvedValue(null);

      await expect(
        service.create(
          'org-1',
          { invoiceId: 'unknown', amount: 100, reason: 'reason', creditNoteDate: new Date() },
          'user-1',
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('issue', () => {
    it('applies the credit and returns the affected invoice id', async () => {
      const { service, creditNoteRepository } = makeService();
      creditNoteRepository.issue.mockResolvedValue({
        creditNote: { ...creditNote, status: CreditNoteStatus.ISSUED },
        invoiceId: 'invoice-2',
      });

      const result = await service.issue('org-1', 'credit-note-1', 'user-1');
      expect(result.creditNote.status).toBe(CreditNoteStatus.ISSUED);
      expect(result.invoiceId).toBe('invoice-2');
    });

    it('translates OverCreditError into a BadRequestException', async () => {
      const { service, creditNoteRepository } = makeService();
      creditNoteRepository.issue.mockRejectedValue(new OverCreditError('too much'));

      await expect(service.issue('org-1', 'credit-note-1', 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('translates CreditNoteInvoiceConflictError into a BadRequestException', async () => {
      const { service, creditNoteRepository } = makeService();
      creditNoteRepository.issue.mockRejectedValue(new CreditNoteInvoiceConflictError('conflict'));

      await expect(service.issue('org-1', 'credit-note-1', 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('translates CreditNoteStateError (already issued) into a BadRequestException', async () => {
      const { service, creditNoteRepository } = makeService();
      creditNoteRepository.issue.mockRejectedValue(
        new CreditNoteStateError('Only a draft credit note can be issued'),
      );

      await expect(service.issue('org-1', 'credit-note-1', 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('translates CreditNoteNotFoundError into a NotFoundException', async () => {
      const { service, creditNoteRepository } = makeService();
      creditNoteRepository.issue.mockRejectedValue(
        new CreditNoteNotFoundError('Credit note not found'),
      );

      await expect(service.issue('org-1', 'unknown', 'user-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('void', () => {
    it('reverses an issued credit note', async () => {
      const { service, creditNoteRepository } = makeService();
      creditNoteRepository.void.mockResolvedValue({
        creditNote: { ...creditNote, status: CreditNoteStatus.VOID },
        invoiceId: 'invoice-2',
      });

      const result = await service.void('org-1', 'credit-note-1', 'user-1');
      expect(result.creditNote.status).toBe(CreditNoteStatus.VOID);
    });

    it('throws NotFoundException for an unknown/cross-tenant credit note', async () => {
      const { service, creditNoteRepository } = makeService();
      creditNoteRepository.void.mockResolvedValue(null);

      await expect(service.void('org-1', 'unknown', 'user-1')).rejects.toThrow(NotFoundException);
    });
  });
});
